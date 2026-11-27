import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { avatarSchema } from '../shared/avatar.js';
import { credentialsSchema, firstError, gameSettingsSchema, LIMITS, nameSchema, quizSchema } from '../shared/schema.js';
import type { Assignments } from './assignments.js';
import { SESSION_TTL_MS, type Store } from './db.js';
import { GameFailure } from './game.js';
import { RateLimiter } from './ratelimit.js';

const MAX_IMAGES_PER_USER = 2000;

function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const playerAuth = z.object({ pin: z.string().regex(/^\d{7}$/), playerId: z.string().min(1).max(64), playerKey: z.string().min(10).max(100) });

export const SESSION_COOKIE = 'gk_sid';
const MAX_QUIZZES_PER_USER = 500;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; username: string } | null;
    }
  }
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function createApp(store: Store, assignments: Assignments, opts: { secureCookies: boolean; clientDir?: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'https:', 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          upgradeInsecureRequests: opts.secureCookies ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const authLimiter = new RateLimiter(20, 15 * 60 * 1000);
  const writeLimiter = new RateLimiter(240, 60 * 1000);

  const playLimiter = new RateLimiter(60, 60 * 1000);

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use('/images', express.raw({ type: 'image/*', limit: LIMITS.imageMaxBytes }));

  // CSRF defence: state-changing requests must be JSON (cross-site forms can't send it without CORS preflight)
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method !== 'DELETE' && !req.is('application/json') && !(req.path === '/images' && req.is('image/*'))) {
      return res.status(415).json({ error: 'Content-Type harus application/json' });
    }
    if (!writeLimiter.take(clientIp(req))) return res.status(429).json({ error: 'Terlalu banyak permintaan' });
    next();
  });

  api.use((req, _res, next) => {
    req.user = store.getSessionUser(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    next();
  });

  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan login dulu' });
    next();
  };

  const setSession = (res: Response, token: string) => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookies,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  };

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/auth/me', (req, res) => res.json({ user: req.user ?? null }));

  api.post('/auth/register', async (req, res) => {
    if (!authLimiter.take('reg:' + clientIp(req))) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: firstError(parsed.error) });
    const user = await store.createUser(parsed.data.username, parsed.data.password);
    if (!user) return res.status(409).json({ error: 'Username sudah dipakai' });
    setSession(res, store.createSession(user.id));
    res.status(201).json({ user });
  });

  api.post('/auth/login', async (req, res) => {
    if (!authLimiter.take('login:' + clientIp(req))) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Username atau password salah' });
    const user = await store.verifyUser(parsed.data.username, parsed.data.password);
    if (!user) return res.status(401).json({ error: 'Username atau password salah' });
    setSession(res, store.createSession(user.id));
    res.json({ user });
  });

  api.post('/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) store.deleteSession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  api.get('/quizzes', requireUser, (req, res) => res.json({ quizzes: store.listQuizzes(req.user!.id) }));

  api.post('/quizzes', requireUser, (req, res) => {
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: firstError(parsed.error) });
    if (store.countQuizzes(req.user!.id) >= MAX_QUIZZES_PER_USER) {
      return res.status(400).json({ error: `Maksimal ${MAX_QUIZZES_PER_USER} kuis per akun` });
    }
    res.status(201).json({ id: store.createQuiz(req.user!.id, parsed.data) });
  });

  api.get('/quizzes/:id', requireUser, (req, res) => {
    const quiz = store.getQuiz(req.user!.id, String(req.params.id));
    if (!quiz) return res.status(404).json({ error: 'Kuis tidak ditemukan' });
    res.json({ quiz });
  });

  api.put('/quizzes/:id', requireUser, (req, res) => {
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: firstError(parsed.error) });
    if (!store.updateQuiz(req.user!.id, String(req.params.id), parsed.data)) {
      return res.status(404).json({ error: 'Kuis tidak ditemukan' });
    }
    res.json({ ok: true });
  });

  api.delete('/quizzes/:id', requireUser, (req, res) => {
    if (!store.deleteQuiz(req.user!.id, String(req.params.id))) return res.status(404).json({ error: 'Kuis tidak ditemukan' });
    res.json({ ok: true });
  });

  api.post('/quizzes/:id/duplicate', requireUser, (req, res) => {
    const quiz = store.getQuiz(req.user!.id, String(req.params.id));
    if (!quiz) return res.status(404).json({ error: 'Kuis tidak ditemukan' });
    const title = `${quiz.title} (salinan)`.slice(0, 120);
    res.status(201).json({ id: store.createQuiz(req.user!.id, { ...quiz, title }) });
  });

  // ---------- images ----------
  api.post('/images', requireUser, (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'File gambar kosong' });
    const mime = sniffImage(req.body);
    if (!mime) return res.status(400).json({ error: 'Format gambar harus PNG, JPG, GIF, atau WEBP' });
    if (store.countImages(req.user!.id) >= MAX_IMAGES_PER_USER) return res.status(400).json({ error: 'Kuota gambar penuh' });
    const id = store.saveImage(req.user!.id, mime, req.body);
    res.status(201).json({ url: `/api/images/${id}` });
  });

  api.get('/images/:id', (req, res) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(404).end();
    const img = store.getImage(id);
    if (!img) return res.status(404).end();
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.end(Buffer.from(img.data));
  });

  // ---------- public library ----------
  api.get('/public/quizzes', (req, res) => {
    const term = String(req.query.q ?? '').slice(0, 80);
    res.json({ quizzes: store.searchPublicQuizzes(term) });
  });

  api.get('/public/quizzes/:id', (req, res) => {
    const r = store.getPublicQuiz(String(req.params.id));
    if (!r) return res.status(404).json({ error: 'Kuis tidak ditemukan atau tidak publik' });
    res.json(r);
  });

  api.post('/public/quizzes/:id/copy', requireUser, (req, res) => {
    const r = store.getPublicQuiz(String(req.params.id));
    if (!r) return res.status(404).json({ error: 'Kuis tidak ditemukan atau tidak publik' });
    if (store.countQuizzes(req.user!.id) >= MAX_QUIZZES_PER_USER) return res.status(400).json({ error: 'Kuota kuis penuh' });
    res.status(201).json({ id: store.createQuiz(req.user!.id, { ...r.quiz, public: false }) });
  });

  // ---------- assignments (host) ----------
  const createAssignment = z.object({
    quizId: z.string().min(1).max(64),
    hours: z.number().int().min(1).max(24 * 30),
    settings: gameSettingsSchema.partial().default({}),
  });

  api.get('/assignments', requireUser, (req, res) => res.json({ assignments: assignments.list(req.user!.id) }));

  api.post('/assignments', requireUser, (req, res) => {
    const parsed = createAssignment.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: firstError(parsed.error) });
    try {
      res.status(201).json(assignments.create(req.user!.id, parsed.data.quizId, parsed.data.hours, parsed.data.settings));
    } catch (e) {
      if (e instanceof GameFailure) return res.status(404).json({ error: 'Kuis tidak ditemukan' });
      throw e;
    }
  });

  api.get('/assignments/:id', requireUser, (req, res) => {
    const r = assignments.report(req.user!.id, String(req.params.id));
    if (!r) return res.status(404).json({ error: 'Tugas tidak ditemukan' });
    res.json({ report: r });
  });

  api.post('/assignments/:id/close', requireUser, (req, res) => {
    if (!assignments.close(req.user!.id, String(req.params.id))) return res.status(404).json({ error: 'Tugas tidak ditemukan' });
    res.json({ ok: true });
  });

  api.delete('/assignments/:id', requireUser, (req, res) => {
    if (!assignments.delete(req.user!.id, String(req.params.id))) return res.status(404).json({ error: 'Tugas tidak ditemukan' });
    res.json({ ok: true });
  });

  // ---------- assignments (player) ----------
  const play = (handler: (body: unknown, req: Request) => unknown) => (req: Request, res: Response) => {
    if (!playLimiter.take('play:' + clientIp(req))) return res.status(429).json({ error: 'Terlalu banyak permintaan, tunggu sebentar' });
    try {
      res.json(handler(req.body, req));
    } catch (e) {
      if (e instanceof GameFailure) return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.message, code: e.code });
      if (e instanceof z.ZodError) return res.status(400).json({ error: firstError(e) });
      throw e;
    }
  };

  api.post('/play/check', play((body) => {
    const { pin } = z.object({ pin: z.string().regex(/^\d{7}$/, 'PIN tidak valid') }).parse(body);
    const r = assignments.check(pin);
    if (!r) throw new GameFailure('NOT_FOUND');
    return r;
  }));

  api.post('/play/join', play((body) => {
    const { pin, name, avatar } = z
      .object({ pin: z.string().regex(/^\d{7}$/), name: nameSchema.optional(), avatar: avatarSchema })
      .parse(body);
    return assignments.join(pin, name, avatar);
  }));

  api.post('/play/state', play((body) => {
    const b = playerAuth.parse(body);
    return assignments.view(b.pin, b.playerId, b.playerKey);
  }));

  api.post('/play/start', play((body) => {
    const b = playerAuth.extend({ questionIndex: z.number().int().min(0) }).parse(body);
    return assignments.start(b.pin, b.playerId, b.playerKey, b.questionIndex);
  }));

  api.post('/play/answer', play((body) => {
    const b = playerAuth.extend({ questionIndex: z.number().int().min(0), answer: z.unknown() }).parse(body);
    return assignments.answer(b.pin, b.playerId, b.playerKey, b.questionIndex, b.answer);
  }));

  api.get('/reports', requireUser, (req, res) => res.json({ reports: store.listReports(req.user!.id) }));

  api.get('/reports/:id', requireUser, (req, res) => {
    const report = store.getReport(req.user!.id, String(req.params.id));
    if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    res.json({ report });
  });

  api.delete('/reports/:id', requireUser, (req, res) => {
    if (!store.deleteReport(req.user!.id, String(req.params.id))) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    res.json({ ok: true });
  });

  api.use((_req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) return res.status(status).json({ error: 'Permintaan tidak valid' });
    console.error('[api] error', err);
    res.status(500).json({ error: 'Terjadi kesalahan di server' });
  });

  app.use('/api', api);

  const clientDir = opts.clientDir;
  if (clientDir && existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    app.get(/^(?!\/(api|socket\.io)\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  return app;
}
