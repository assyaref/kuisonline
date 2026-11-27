import { randomBytes, randomUUID } from 'node:crypto';
import { LIMITS, type Question, type QuizData } from '../shared/schema.js';
import type { GameReport, HostView, Phase, PlayerView, RankEntry } from '../shared/types.js';

export const COUNTDOWN_MS = 3000;
/** extra time accepted after the deadline to absorb network latency */
export const ANSWER_GRACE_MS = 600;
export const STREAK_BONUS = 100;
export const STREAK_BONUS_MAX_STEPS = 5;

export interface Player {
  id: string;
  key: string;
  name: string;
  score: number;
  streak: number;
  correctCount: number;
  lastDelta: number;
  connected: boolean;
  joinedAt: number;
}

interface AnswerRecord {
  choice: number;
  elapsedMs: number;
  correct: boolean;
  points: number;
}

interface QuestionRecord {
  answers: Map<string, AnswerRecord>;
  distribution: number[];
}

export type GameError =
  | 'GAME_LOCKED'
  | 'GAME_FULL'
  | 'GAME_ENDED'
  | 'NAME_TAKEN'
  | 'BAD_NAME'
  | 'NOT_FOUND'
  | 'BAD_STATE'
  | 'ALREADY_ANSWERED'
  | 'TOO_LATE'
  | 'BAD_CHOICE';

export const GAME_ERROR_TEXT: Record<GameError, string> = {
  GAME_LOCKED: 'Game dikunci oleh host',
  GAME_FULL: 'Game sudah penuh',
  GAME_ENDED: 'Game sudah selesai',
  NAME_TAKEN: 'Nama sudah dipakai, coba nama lain',
  BAD_NAME: 'Nama tidak valid',
  NOT_FOUND: 'Data tidak ditemukan',
  BAD_STATE: 'Aksi tidak bisa dilakukan sekarang',
  ALREADY_ANSWERED: 'Kamu sudah menjawab',
  TOO_LATE: 'Waktu habis',
  BAD_CHOICE: 'Pilihan tidak valid',
};

export class GameFailure extends Error {
  constructor(public code: GameError) {
    super(GAME_ERROR_TEXT[code]);
  }
}

export function basePoints(q: Question): number {
  return q.points === 'double' ? 2000 : q.points === 'none' ? 0 : 1000;
}

/** Points for a correct answer: 50%–100% of base depending on speed, plus a capped streak bonus. */
export function calcPoints(q: Question, elapsedMs: number, streakBefore: number): number {
  const base = basePoints(q);
  if (base === 0) return 0;
  const limit = q.timeLimit * 1000;
  const ratio = Math.min(1, Math.max(0, elapsedMs / limit));
  const speed = Math.round(base * (1 - ratio / 2));
  const bonus = Math.min(streakBefore, STREAK_BONUS_MAX_STEPS) * STREAK_BONUS;
  return speed + bonus;
}

export interface GameHooks {
  onChange(game: Game): void;
  onEnd(game: Game): void;
}

export class Game {
  readonly hostKey = randomBytes(24).toString('base64url');
  readonly createdAt = Date.now();
  startedAt = 0;
  endedAt = 0;
  phase: Phase = 'lobby';
  locked = false;
  qIndex = -1;
  phaseDeadline: number | null = null;
  questionStartedAt = 0;
  lastActivity = Date.now();
  readonly players = new Map<string, Player>();
  private records: QuestionRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly pin: string,
    readonly quiz: QuizData,
    readonly quizId: string | null,
    readonly ownerId: string,
    private hooks: GameHooks,
  ) {}

  get question(): Question | null {
    return this.quiz.questions[this.qIndex] ?? null;
  }

  private get record(): QuestionRecord | undefined {
    return this.records[this.qIndex];
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  private changed() {
    this.touch();
    this.hooks.onChange(this);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  // ---------- players ----------

  addPlayer(rawName: string): Player {
    if (this.phase === 'ended') throw new GameFailure('GAME_ENDED');
    if (this.locked) throw new GameFailure('GAME_LOCKED');
    if (this.players.size >= LIMITS.playersMax) throw new GameFailure('GAME_FULL');
    const name = rawName;
    if (!name) throw new GameFailure('BAD_NAME');
    const lower = name.toLocaleLowerCase();
    for (const p of this.players.values()) {
      if (p.name.toLocaleLowerCase() === lower) throw new GameFailure('NAME_TAKEN');
    }
    const player: Player = {
      id: randomUUID(),
      key: randomBytes(24).toString('base64url'),
      name,
      score: 0,
      streak: 0,
      correctCount: 0,
      lastDelta: 0,
      connected: true,
      joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    this.changed();
    return player;
  }

  authPlayer(id: string, key: string): Player | null {
    const p = this.players.get(id);
    if (!p || !safeEqual(p.key, key)) return null;
    return p;
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players.get(id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    this.changed();
    if (!connected) this.maybeFinishEarly();
  }

  kick(id: string) {
    if (!this.players.delete(id)) throw new GameFailure('NOT_FOUND');
    this.record?.answers.delete(id);
    this.changed();
    this.maybeFinishEarly();
  }

  setLocked(locked: boolean) {
    this.locked = locked;
    this.changed();
  }

  // ---------- flow ----------

  start() {
    if (this.phase !== 'lobby') throw new GameFailure('BAD_STATE');
    this.startedAt = Date.now();
    this.beginCountdown(0);
  }

  /** host "next" button: advances from reveal / leaderboard / lobby */
  next() {
    switch (this.phase) {
      case 'lobby':
        return this.start();
      case 'reveal':
        if (this.qIndex >= this.quiz.questions.length - 1) return this.finish();
        this.phase = 'leaderboard';
        this.phaseDeadline = null;
        return this.changed();
      case 'leaderboard':
        return this.beginCountdown(this.qIndex + 1);
      case 'countdown':
        return this.beginQuestion();
      case 'question':
        return this.reveal();
      default:
        throw new GameFailure('BAD_STATE');
    }
  }

  private beginCountdown(index: number) {
    this.qIndex = index;
    this.records[index] = {
      answers: new Map(),
      distribution: new Array(this.quiz.questions[index]!.options.length).fill(0),
    };
    this.phase = 'countdown';
    this.phaseDeadline = Date.now() + COUNTDOWN_MS;
    this.schedule(COUNTDOWN_MS, () => this.beginQuestion());
    this.changed();
  }

  private beginQuestion() {
    const q = this.question;
    if (!q) return;
    this.phase = 'question';
    this.questionStartedAt = Date.now();
    this.phaseDeadline = this.questionStartedAt + q.timeLimit * 1000;
    this.schedule(q.timeLimit * 1000 + ANSWER_GRACE_MS, () => this.reveal());
    this.changed();
  }

  answer(playerId: string, questionIndex: number, choice: number): void {
    const p = this.players.get(playerId);
    const q = this.question;
    const rec = this.record;
    if (!p || !q || !rec) throw new GameFailure('NOT_FOUND');
    if (this.phase !== 'question' || questionIndex !== this.qIndex) throw new GameFailure('TOO_LATE');
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) throw new GameFailure('BAD_CHOICE');
    if (rec.answers.has(playerId)) throw new GameFailure('ALREADY_ANSWERED');
    const elapsedMs = Date.now() - this.questionStartedAt;
    if (elapsedMs > q.timeLimit * 1000 + ANSWER_GRACE_MS) throw new GameFailure('TOO_LATE');
    const correct = q.correct.includes(choice);
    rec.answers.set(playerId, {
      choice,
      elapsedMs,
      correct,
      points: correct ? calcPoints(q, elapsedMs, p.streak) : 0,
    });
    rec.distribution[choice]!++;
    this.changed();
    this.maybeFinishEarly();
  }

  private maybeFinishEarly() {
    if (this.phase !== 'question' || !this.record) return;
    const active = [...this.players.values()].filter((p) => p.connected);
    if (active.length > 0 && active.every((p) => this.record!.answers.has(p.id))) {
      this.reveal();
    }
  }

  private reveal() {
    if (this.phase !== 'question' && this.phase !== 'countdown') return;
    this.clearTimer();
    const rec = this.record!;
    for (const p of this.players.values()) {
      const a = rec.answers.get(p.id);
      if (a?.correct) {
        p.score += a.points;
        p.lastDelta = a.points;
        p.streak += 1;
        p.correctCount += 1;
      } else {
        p.lastDelta = 0;
        p.streak = 0;
      }
    }
    this.phase = 'reveal';
    this.phaseDeadline = null;
    this.changed();
  }

  finish() {
    if (this.phase === 'ended') return;
    if (this.phase === 'question') this.reveal();
    this.clearTimer();
    this.phase = 'ended';
    this.phaseDeadline = null;
    this.endedAt = Date.now();
    this.changed();
    this.hooks.onEnd(this);
  }

  dispose() {
    this.clearTimer();
  }

  // ---------- views ----------

  ranking(): RankEntry[] {
    const list = [...this.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
    let lastScore = Number.NaN;
    let lastRank = 0;
    return list.map((p, i) => {
      const rank = p.score === lastScore ? lastRank : i + 1;
      lastScore = p.score;
      lastRank = rank;
      return {
        id: p.id,
        name: p.name,
        score: p.score,
        rank,
        delta: p.lastDelta,
        streak: p.streak,
        connected: p.connected,
      };
    });
  }

  private revealed(): boolean {
    return this.phase === 'reveal' || this.phase === 'leaderboard' || this.phase === 'ended';
  }

  hostView(): HostView {
    const rec = this.record;
    return {
      role: 'host',
      pin: this.pin,
      title: this.quiz.title,
      phase: this.phase,
      locked: this.locked,
      serverNow: Date.now(),
      playerCount: this.players.size,
      players: this.ranking(),
      questionIndex: this.qIndex,
      questionCount: this.quiz.questions.length,
      question: this.question,
      deadline: this.phaseDeadline,
      answeredCount: rec?.answers.size ?? 0,
      distribution: rec && this.revealed() ? [...rec.distribution] : null,
    };
  }

  playerView(id: string, ranking = this.ranking()): PlayerView | null {
    const p = this.players.get(id);
    if (!p) return null;
    const q = this.question;
    const rec = this.record;
    const mine = rec?.answers.get(id);
    const showQuestion = q && this.phase !== 'lobby' && this.phase !== 'ended';
    const revealed = this.revealed() && this.phase !== 'ended';
    return {
      role: 'player',
      pin: this.pin,
      title: this.quiz.title,
      phase: this.phase,
      serverNow: Date.now(),
      me: {
        id: p.id,
        name: p.name,
        score: p.score,
        rank: ranking.find((r) => r.id === id)?.rank ?? 0,
        streak: p.streak,
      },
      playerCount: this.players.size,
      questionIndex: this.qIndex,
      questionCount: this.quiz.questions.length,
      question: showQuestion
        ? {
            type: q.type,
            text: q.text,
            image: q.image || undefined,
            options: this.phase === 'countdown' ? [] : q.options,
            timeLimit: q.timeLimit,
            points: q.points,
          }
        : null,
      deadline: this.phaseDeadline,
      myAnswer: mine?.choice ?? null,
      result:
        revealed && q
          ? { correct: !!mine?.correct, answered: !!mine, points: mine?.points ?? 0, correctOptions: q.correct }
          : null,
      podium: this.phase === 'ended' ? ranking.slice(0, 5) : null,
    };
  }

  report(id: string): GameReport {
    const ranking = this.ranking();
    const playerCount = this.players.size;
    return {
      id,
      quizId: this.quizId,
      title: this.quiz.title,
      pin: this.pin,
      startedAt: this.startedAt || this.createdAt,
      endedAt: this.endedAt || Date.now(),
      playerCount,
      questions: this.records
        .map((rec, i) => {
          const q = this.quiz.questions[i]!;
          const correctCount = [...rec.answers.values()].filter((a) => a.correct).length;
          return {
            text: q.text,
            options: q.options,
            correct: q.correct,
            distribution: rec.distribution,
            correctRate: playerCount ? correctCount / playerCount : 0,
          };
        })
        .filter(Boolean),
      ranking: ranking.map((r) => ({
        name: r.name,
        score: r.score,
        rank: r.rank,
        correctCount: this.players.get(r.id)?.correctCount ?? 0,
      })),
    };
  }
}

function safeEqual(a: string, b: string): boolean {
  if (typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
