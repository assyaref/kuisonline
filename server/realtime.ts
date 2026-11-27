import { randomInt, randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { avatarSchema, REACTIONS } from '../shared/avatar.js';
import { firstError, gameSettingsSchema, nameSchema, pinSchema, type GameSettings } from '../shared/schema.js';
import type { Store } from './db.js';
import { Game, GameFailure } from './game.js';
import { parseCookies, SESSION_COOKIE } from './http.js';
import { RateLimiter } from './ratelimit.js';

const ENDED_GAME_TTL_MS = 30 * 60 * 1000;
const IDLE_GAME_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_ACTIVE_GAMES_PER_HOST = 5;
const MAX_GAMES = 5000;

interface SocketData {
  userId: string | null;
  ip: string;
  pin?: string;
  role?: 'host' | 'player';
  playerId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvents = Record<string, (...args: any[]) => void>;
type GSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;

type AckFn = (res: unknown) => void;

export class GameManager {
  readonly games = new Map<string, Game>();
  private hostSockets = new Map<string, Set<string>>();
  private playerSockets = new Map<string, Map<string, string>>();
  private dirty = new Set<string>();
  private flushScheduled = false;
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private io: Server,
    private store: Store,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    this.sweepTimer.unref();
  }

  private newPin(): string {
    for (let i = 0; i < 50; i++) {
      const pin = String(randomInt(100000, 1000000));
      if (!this.games.has(pin)) return pin;
    }
    throw new Error('Could not allocate PIN');
  }

  create(ownerId: string, quizId: string, settings: GameSettings): Game {
    const quiz = this.store.getQuiz(ownerId, quizId);
    if (!quiz) throw new GameFailure('NOT_FOUND');
    const active = [...this.games.values()].filter((g) => g.ownerId === ownerId && g.phase !== 'ended');
    if (active.length >= MAX_ACTIVE_GAMES_PER_HOST) {
      // end the oldest so hosts never get stuck
      active.sort((a, b) => a.createdAt - b.createdAt)[0]!.finish();
    }
    if (this.games.size >= MAX_GAMES) this.sweep(true);
    const pin = this.newPin();
    const game = new Game(pin, quiz, quizId, ownerId, settings, {
      onChange: (g) => this.markDirty(g.pin),
      onEnd: (g) => this.onEnd(g),
    });
    this.games.set(pin, game);
    this.hostSockets.set(pin, new Set());
    this.playerSockets.set(pin, new Map());
    return game;
  }

  private onEnd(game: Game) {
    if (game.players.size === 0) return;
    try {
      this.store.saveReport(game.ownerId, game.report(randomUUID()));
    } catch (err) {
      console.error('[game] failed to save report', err);
    }
  }

  bindHost(socket: GSocket, game: Game) {
    this.unbind(socket);
    socket.data.pin = game.pin;
    socket.data.role = 'host';
    this.hostSockets.get(game.pin)!.add(socket.id);
    socket.join(`host:${game.pin}`);
  }

  bindPlayer(socket: GSocket, game: Game, playerId: string) {
    this.unbind(socket);
    const map = this.playerSockets.get(game.pin)!;
    const prev = map.get(playerId);
    if (prev && prev !== socket.id) {
      const old = this.io.sockets.sockets.get(prev) as GSocket | undefined;
      if (old) {
        old.data.pin = undefined;
        old.data.role = undefined;
        old.data.playerId = undefined;
        old.emit('session:replaced');
      }
    }
    map.set(playerId, socket.id);
    socket.data.pin = game.pin;
    socket.data.role = 'player';
    socket.data.playerId = playerId;
    game.setConnected(playerId, true);
  }

  unbind(socket: GSocket) {
    const { pin, role, playerId } = socket.data;
    if (!pin) return;
    if (role === 'host') {
      this.hostSockets.get(pin)?.delete(socket.id);
      socket.leave(`host:${pin}`);
    } else if (role === 'player' && playerId) {
      const map = this.playerSockets.get(pin);
      if (map?.get(playerId) === socket.id) {
        map.delete(playerId);
        this.games.get(pin)?.setConnected(playerId, false);
      }
    }
    socket.data.pin = undefined;
    socket.data.role = undefined;
    socket.data.playerId = undefined;
  }

  kick(game: Game, playerId: string) {
    const sid = this.playerSockets.get(game.pin)?.get(playerId);
    this.playerSockets.get(game.pin)?.delete(playerId);
    game.kick(playerId);
    if (sid) {
      const s = this.io.sockets.sockets.get(sid) as GSocket | undefined;
      if (s) {
        s.data.pin = undefined;
        s.data.role = undefined;
        s.data.playerId = undefined;
        s.emit('kicked');
      }
    }
  }

  markDirty(pin: string) {
    this.dirty.add(pin);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.flush());
  }

  private flush() {
    this.flushScheduled = false;
    const pins = [...this.dirty];
    this.dirty.clear();
    for (const pin of pins) this.broadcast(pin);
  }

  broadcast(pin: string) {
    const game = this.games.get(pin);
    if (!game) return;
    this.io.to(`host:${pin}`).emit('host:state', game.hostView());
    const ranking = game.ranking();
    const teams = game.teamRanking();
    for (const [playerId, sid] of this.playerSockets.get(pin) ?? []) {
      const view = game.playerView(playerId, ranking, teams);
      if (view) this.io.to(sid).emit('player:state', view);
    }
  }

  private remove(pin: string) {
    const game = this.games.get(pin);
    if (!game) return;
    game.dispose();
    this.io.to(`host:${pin}`).emit('game:closed');
    for (const sid of this.playerSockets.get(pin)?.values() ?? []) this.io.to(sid).emit('game:closed');
    this.games.delete(pin);
    this.hostSockets.delete(pin);
    this.playerSockets.delete(pin);
  }

  sweep(aggressive = false) {
    const now = Date.now();
    for (const [pin, g] of this.games) {
      const endedLongAgo = g.phase === 'ended' && now - g.endedAt > (aggressive ? 60_000 : ENDED_GAME_TTL_MS);
      const idle = now - g.lastActivity > IDLE_GAME_TTL_MS;
      if (endedLongAgo || idle) {
        if (g.phase !== 'ended') g.finish();
        this.remove(pin);
      }
    }
    this.store.purgeExpiredSessions();
  }

  shutdown() {
    clearInterval(this.sweepTimer);
    for (const g of this.games.values()) {
      if (g.phase !== 'ended' && g.players.size > 0) g.finish();
      g.dispose();
    }
  }
}

const createSchema = z.object({ quizId: z.string().min(1).max(64), settings: gameSettingsSchema.default(gameSettingsSchema.parse({})) });
const hostResumeSchema = z.object({ pin: pinSchema, hostKey: z.string().min(10).max(100) });
const joinSchema = z.object({ pin: pinSchema, name: nameSchema.optional(), avatar: avatarSchema });
const avatarUpdateSchema = z.object({ avatar: avatarSchema });
const reactSchema = z.object({ e: z.number().int().min(0).max(REACTIONS.length - 1) });
const checkSchema = z.object({ pin: pinSchema });
const playerResumeSchema = z.object({ pin: pinSchema, playerId: z.string().min(1).max(64), playerKey: z.string().min(10).max(100) });
const answerSchema = z.object({
  questionIndex: z.number().int().min(0).max(1000),
  answer: z.union([z.number().finite(), z.array(z.number().int()).max(4), z.string().max(60)]),
});
const kickSchema = z.object({ playerId: z.string().min(1).max(64) });
const lockSchema = z.object({ locked: z.boolean() });
const empty = z.object({}).passthrough().optional();

export function attachRealtime(httpServer: HttpServer, store: Store, opts: { corsOrigin?: string } = {}) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16_000,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: opts.corsOrigin ? { origin: opts.corsOrigin, credentials: true } : undefined,
    connectionStateRecovery: { maxDisconnectionDuration: 0 },
  });
  const manager = new GameManager(io, store);
  const joinLimiter = new RateLimiter(30, 60_000);

  io.use((socket, next) => {
    const s = socket as unknown as GSocket;
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    s.data.userId = store.getSessionUser(token)?.id ?? null;
    const fwd = socket.handshake.headers['x-forwarded-for'];
    s.data.ip = (typeof fwd === 'string' ? fwd.split(',')[0]!.trim() : '') || socket.handshake.address;
    next();
  });

  io.on('connection', (raw) => {
    const socket = raw as unknown as GSocket;
    const eventLimiter = new RateLimiter(40, 5_000);

    function on<S extends z.ZodType>(event: string, schema: S, handler: (data: z.infer<S>, ack: AckFn) => void) {
      socket.on(event, ((payload: unknown, maybeAck?: unknown) => {
        const ack: AckFn = typeof maybeAck === 'function' ? (maybeAck as AckFn) : typeof payload === 'function' ? (payload as AckFn) : () => {};
        if (!eventLimiter.take(socket.id)) return ack({ ok: false, error: 'Terlalu cepat, pelan-pelan ya' });
        const parsed = schema.safeParse(typeof payload === 'function' ? undefined : payload);
        if (!parsed.success) return ack({ ok: false, error: firstError(parsed.error) });
        try {
          handler(parsed.data, ack);
        } catch (err) {
          if (err instanceof GameFailure) return ack({ ok: false, error: err.message, code: err.code });
          console.error(`[socket] ${event} failed`, err);
          ack({ ok: false, error: 'Terjadi kesalahan di server' });
        }
      }) as never);
    }

    const hostGame = (): Game => {
      const { pin, role } = socket.data;
      const game = pin && role === 'host' ? manager.games.get(pin) : undefined;
      if (!game) throw new GameFailure('NOT_FOUND');
      return game;
    };

    // ---------- host ----------
    on('host:create', createSchema, ({ quizId, settings }, ack) => {
      if (!socket.data.userId) return ack({ ok: false, error: 'Silakan login dulu' });
      const game = manager.create(socket.data.userId, quizId, settings);
      manager.bindHost(socket, game);
      ack({ ok: true, pin: game.pin, hostKey: game.hostKey });
      socket.emit('host:state', game.hostView());
    });

    on('host:resume', hostResumeSchema, ({ pin, hostKey }, ack) => {
      const game = manager.games.get(pin);
      if (!game || game.hostKey !== hostKey) return ack({ ok: false, error: 'Game tidak ditemukan atau sudah ditutup' });
      manager.bindHost(socket, game);
      ack({ ok: true, pin });
      socket.emit('host:state', game.hostView());
    });

    on('host:next', empty, (_d, ack) => {
      hostGame().next();
      ack({ ok: true });
    });

    on('host:end', empty, (_d, ack) => {
      hostGame().finish();
      ack({ ok: true });
    });

    on('host:lock', lockSchema, ({ locked }, ack) => {
      hostGame().setLocked(locked);
      ack({ ok: true });
    });

    on('host:kick', kickSchema, ({ playerId }, ack) => {
      manager.kick(hostGame(), playerId);
      ack({ ok: true });
    });

    // ---------- player ----------
    on('player:check', checkSchema, ({ pin }, ack) => {
      if (!joinLimiter.take(socket.data.ip)) return ack({ ok: false, error: 'Terlalu banyak percobaan, tunggu sebentar' });
      const game = manager.games.get(pin);
      if (!game || game.phase === 'ended') return ack({ ok: false, error: 'PIN tidak ditemukan' });
      if (game.locked) return ack({ ok: false, error: 'Game dikunci oleh host' });
      ack({ ok: true, title: game.quiz.title, nameGenerator: game.settings.nameGenerator, teamMode: game.settings.teamMode });
    });

    on('player:join', joinSchema, ({ pin, name, avatar }, ack) => {
      if (!joinLimiter.take(socket.data.ip)) return ack({ ok: false, error: 'Terlalu banyak percobaan, tunggu sebentar' });
      const game = manager.games.get(pin);
      if (!game) return ack({ ok: false, error: 'PIN tidak ditemukan' });
      const player = game.addPlayer(name, avatar);
      manager.bindPlayer(socket, game, player.id);
      ack({ ok: true, playerId: player.id, playerKey: player.key, name: player.name });
      manager.markDirty(pin);
    });

    on('player:resume', playerResumeSchema, ({ pin, playerId, playerKey }, ack) => {
      const game = manager.games.get(pin);
      const player = game?.authPlayer(playerId, playerKey);
      if (!game || !player) return ack({ ok: false, error: 'Sesi tidak ditemukan' });
      manager.bindPlayer(socket, game, player.id);
      ack({ ok: true, name: player.name });
      manager.markDirty(pin);
    });

    const playerGame = () => {
      const { pin, role, playerId } = socket.data;
      const game = pin && role === 'player' ? manager.games.get(pin) : undefined;
      if (!game || !playerId) throw new GameFailure('NOT_FOUND');
      return { game, playerId };
    };

    on('player:answer', answerSchema, ({ questionIndex, answer }, ack) => {
      const { game, playerId } = playerGame();
      game.answer(playerId, questionIndex, answer);
      ack({ ok: true });
    });

    on('player:reroll', empty, (_d, ack) => {
      const { game, playerId } = playerGame();
      ack({ ok: true, name: game.rerollName(playerId) });
    });

    on('player:avatar', avatarUpdateSchema, ({ avatar }, ack) => {
      const { game, playerId } = playerGame();
      game.setAvatar(playerId, avatar);
      ack({ ok: true });
    });

    const reactLimiter = new RateLimiter(1, 700);
    on('player:react', reactSchema, ({ e }, ack) => {
      const { game, playerId } = playerGame();
      if (!reactLimiter.take(socket.id)) return ack({ ok: false, error: 'Pelan-pelan 😄' });
      const p = game.players.get(playerId);
      io.to(`host:${game.pin}`).emit('host:reaction', { e, name: p?.name ?? '', avatar: p?.avatar });
      ack({ ok: true });
    });

    on('player:leave', empty, (_d, ack) => {
      const { pin, role, playerId } = socket.data;
      const game = pin && role === 'player' ? manager.games.get(pin) : undefined;
      if (game && playerId && game.phase === 'lobby') {
        manager.kick(game, playerId);
      } else {
        manager.unbind(socket);
      }
      ack({ ok: true });
    });

    socket.on('time:sync', ((ack: unknown) => {
      if (typeof ack === 'function') (ack as AckFn)(Date.now());
    }) as never);

    socket.on('disconnect', () => manager.unbind(socket));
  });

  return { io, manager };
}
