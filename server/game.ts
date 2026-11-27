import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { generateName, type Avatar } from '../shared/avatar.js';
import { LIMITS, type GameSettings, type Question, type QuizData } from '../shared/schema.js';
import type { AnswerValue, GameReport, HostView, Phase, PlayerView, RankEntry, TeamEntry } from '../shared/types.js';
import {
  BadAnswer,
  calcPoints,
  computeResults,
  correctText,
  evaluate,
  isScored,
  playerQuestion,
  prepareQuiz,
  puzzleOrder,
  summarizeResults,
} from './questions.js';

export { calcPoints } from './questions.js';

export const COUNTDOWN_MS = 4000;
/** extra time accepted after the deadline to absorb network latency */
export const ANSWER_GRACE_MS = 600;
export const MAX_REROLLS = 3;

export const TEAMS = [
  { name: 'Tim Merah', color: '#ff5a5f' },
  { name: 'Tim Biru', color: '#2f80ed' },
  { name: 'Tim Hijau', color: '#12a46b' },
  { name: 'Tim Kuning', color: '#f4a300' },
  { name: 'Tim Ungu', color: '#8b3fd9' },
  { name: 'Tim Tosca', color: '#0f9fb5' },
];

export interface Player {
  id: string;
  key: string;
  name: string;
  avatar: Avatar;
  score: number;
  streak: number;
  correctCount: number;
  lastDelta: number;
  prevRank: number;
  connected: boolean;
  joinedAt: number;
  teamId: number | null;
  rerolls: number;
}

interface AnswerRecord {
  value: AnswerValue;
  elapsedMs: number;
  correct: boolean;
  points: number;
}

interface QuestionRecord {
  answers: Map<string, AnswerRecord>;
  order: number[] | null;
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
  | 'BAD_CHOICE'
  | 'NO_REROLLS';

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
  BAD_CHOICE: 'Jawaban tidak valid',
  NO_REROLLS: 'Kesempatan ganti nama sudah habis',
};

export class GameFailure extends Error {
  constructor(public code: GameError) {
    super(GAME_ERROR_TEXT[code]);
  }
}

export interface GameHooks {
  onChange(game: Game): void;
  onEnd(game: Game): void;
}

export class Game {
  readonly hostKey = randomBytes(24).toString('base64url');
  readonly createdAt = Date.now();
  readonly quiz: QuizData;
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
  private teamPrevRanks = new Map<number, number>();

  constructor(
    readonly pin: string,
    quiz: QuizData,
    readonly quizId: string | null,
    readonly ownerId: string,
    readonly settings: GameSettings,
    private hooks: GameHooks,
  ) {
    this.quiz = prepareQuiz(quiz, settings);
  }

  get question(): Question | null {
    return this.quiz.questions[this.qIndex] ?? null;
  }

  private get record(): QuestionRecord | undefined {
    return this.records[this.qIndex];
  }

  private changed() {
    this.lastActivity = Date.now();
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

  private nameTaken(name: string, exceptId?: string) {
    const lower = name.toLocaleLowerCase();
    for (const p of this.players.values()) if (p.id !== exceptId && p.name.toLocaleLowerCase() === lower) return true;
    return false;
  }

  private uniqueGeneratedName(exceptId?: string): string {
    for (let i = 0; i < 30; i++) {
      const n = generateName((k) => randomInt(k));
      if (!this.nameTaken(n, exceptId)) return n;
    }
    let n: string;
    do n = `${generateName((k) => randomInt(k)).split(' ')[0]} ${randomInt(100, 1000)}`;
    while (this.nameTaken(n, exceptId));
    return n;
  }

  private pickTeam(): number | null {
    if (!this.settings.teamMode) return null;
    const counts = new Array(this.settings.teamCount).fill(0);
    for (const p of this.players.values()) if (p.teamId !== null) counts[p.teamId]++;
    const min = Math.min(...counts);
    const candidates = counts.map((c, i) => (c === min ? i : -1)).filter((i) => i >= 0);
    return candidates[randomInt(candidates.length)]!;
  }

  addPlayer(rawName: string | undefined, avatar: Avatar): Player {
    if (this.phase === 'ended') throw new GameFailure('GAME_ENDED');
    if (this.locked) throw new GameFailure('GAME_LOCKED');
    if (this.players.size >= LIMITS.playersMax) throw new GameFailure('GAME_FULL');
    let name: string;
    if (this.settings.nameGenerator) {
      name = this.uniqueGeneratedName();
    } else {
      if (!rawName) throw new GameFailure('BAD_NAME');
      if (this.nameTaken(rawName)) throw new GameFailure('NAME_TAKEN');
      name = rawName;
    }
    const player: Player = {
      id: randomUUID(),
      key: randomBytes(24).toString('base64url'),
      name,
      avatar,
      score: 0,
      streak: 0,
      correctCount: 0,
      lastDelta: 0,
      prevRank: 0,
      connected: true,
      joinedAt: Date.now(),
      teamId: this.pickTeam(),
      rerolls: 0,
    };
    this.players.set(player.id, player);
    this.changed();
    return player;
  }

  rerollName(id: string): string {
    const p = this.players.get(id);
    if (!p) throw new GameFailure('NOT_FOUND');
    if (!this.settings.nameGenerator || this.phase !== 'lobby') throw new GameFailure('BAD_STATE');
    if (p.rerolls >= MAX_REROLLS) throw new GameFailure('NO_REROLLS');
    p.rerolls++;
    p.name = this.uniqueGeneratedName(p.id);
    this.changed();
    return p.name;
  }

  setAvatar(id: string, avatar: Avatar) {
    const p = this.players.get(id);
    if (!p) throw new GameFailure('NOT_FOUND');
    p.avatar = avatar;
    this.changed();
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

  /** host "next" button */
  next() {
    switch (this.phase) {
      case 'lobby':
        return this.start();
      case 'reveal':
        if (this.qIndex >= this.quiz.questions.length - 1) return this.finish();
        if (!isScored(this.question!)) return this.beginCountdown(this.qIndex + 1); // no scoreboard after polls
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
    const q = this.quiz.questions[index]!;
    this.qIndex = index;
    this.records[index] = { answers: new Map(), order: q.type === 'puzzle' ? puzzleOrder(q.options.length) : null };
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

  answer(playerId: string, questionIndex: number, raw: unknown): void {
    const p = this.players.get(playerId);
    const q = this.question;
    const rec = this.record;
    if (!p || !q || !rec) throw new GameFailure('NOT_FOUND');
    if (this.phase !== 'question' || questionIndex !== this.qIndex) throw new GameFailure('TOO_LATE');
    if (rec.answers.has(playerId)) throw new GameFailure('ALREADY_ANSWERED');
    const elapsedMs = Date.now() - this.questionStartedAt;
    if (elapsedMs > q.timeLimit * 1000 + ANSWER_GRACE_MS) throw new GameFailure('TOO_LATE');
    let ev;
    try {
      ev = evaluate(q, raw);
    } catch (e) {
      if (e instanceof BadAnswer) throw new GameFailure('BAD_CHOICE');
      throw e;
    }
    rec.answers.set(playerId, {
      value: ev.value,
      elapsedMs,
      correct: ev.correct,
      points: ev.correct ? calcPoints(q, elapsedMs, p.streak, ev.accuracy) : 0,
    });
    this.changed();
    this.maybeFinishEarly();
  }

  private maybeFinishEarly() {
    if (this.phase !== 'question' || !this.record) return;
    const active = [...this.players.values()].filter((p) => p.connected);
    if (active.length > 0 && active.every((p) => this.record!.answers.has(p.id))) this.reveal();
  }

  private reveal() {
    if (this.phase !== 'question' && this.phase !== 'countdown') return;
    this.clearTimer();
    const q = this.question!;
    const rec = this.record!;
    if (isScored(q)) {
      const before = this.ranking();
      for (const r of before) this.players.get(r.id)!.prevRank = r.rank;
      this.teamPrevRanks = new Map(this.teamRanking()?.map((t) => [t.id, t.rank]) ?? []);
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
    } else {
      for (const p of this.players.values()) p.lastDelta = 0;
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
    return withRanks(list, (p) => p.score).map(([p, rank]) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      rank,
      prevRank: p.prevRank || rank,
      delta: p.lastDelta,
      streak: p.streak,
      connected: p.connected,
      teamId: p.teamId,
    }));
  }

  teamRanking(): TeamEntry[] | null {
    if (!this.settings.teamMode) return null;
    const teams = TEAMS.slice(0, this.settings.teamCount).map((t, id) => {
      const members = [...this.players.values()].filter((p) => p.teamId === id);
      const score = members.length ? Math.round(members.reduce((s, p) => s + p.score, 0) / members.length) : 0;
      return { id, name: t.name, color: t.color, score, members: members.length };
    });
    const active = teams.filter((t) => t.members > 0).sort((a, b) => b.score - a.score || a.id - b.id);
    return withRanks(active, (t) => t.score).map(([t, rank]) => ({ ...t, rank, prevRank: this.teamPrevRanks.get(t.id) ?? rank }));
  }

  private revealed(): boolean {
    return this.phase === 'reveal' || this.phase === 'leaderboard' || this.phase === 'ended';
  }

  hostView(): HostView {
    const rec = this.record;
    const q = this.question;
    const showResults = !!(rec && q && this.revealed());
    return {
      role: 'host',
      pin: this.pin,
      title: this.quiz.title,
      phase: this.phase,
      locked: this.locked,
      settings: this.settings,
      serverNow: Date.now(),
      playerCount: this.players.size,
      players: this.ranking(),
      teams: this.teamRanking(),
      questionIndex: this.qIndex,
      questionCount: this.quiz.questions.length,
      question: q,
      puzzleItems: q?.type === 'puzzle' && rec?.order ? rec.order.map((i) => ({ i, text: q.options[i]! })) : null,
      deadline: this.phaseDeadline,
      answeredCount: rec?.answers.size ?? 0,
      results: showResults ? computeResults(q!, rec!.answers.values()) : null,
      correctText: showResults ? correctText(q!) : null,
    };
  }

  playerView(id: string, ranking = this.ranking(), teams = this.teamRanking()): PlayerView | null {
    const p = this.players.get(id);
    if (!p) return null;
    const q = this.question;
    const rec = this.record;
    const mine = rec?.answers.get(id);
    const idx = ranking.findIndex((r) => r.id === id);
    const above = idx > 0 ? ranking[idx - 1] : undefined;
    const inQuestion = !!q && this.phase !== 'lobby' && this.phase !== 'ended';
    const revealed = this.revealed() && this.phase !== 'ended' && !!q;
    return {
      role: 'player',
      pin: this.pin,
      title: this.quiz.title,
      phase: this.phase,
      serverNow: Date.now(),
      me: {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        rank: ranking[idx]?.rank ?? 0,
        streak: p.streak,
        rerollsLeft: this.settings.nameGenerator ? MAX_REROLLS - p.rerolls : 0,
      },
      team: p.teamId !== null ? (teams?.find((t) => t.id === p.teamId) ?? null) : null,
      behind: above ? { name: above.name, gap: above.score - p.score } : null,
      nameGenerator: this.settings.nameGenerator,
      playerCount: this.players.size,
      questionIndex: this.qIndex,
      questionCount: this.quiz.questions.length,
      question: inQuestion ? playerQuestion(q!, rec?.order ?? null, this.settings.showQuestionOnDevice, this.phase === 'question') : null,
      deadline: this.phaseDeadline,
      answered: !!mine,
      result: revealed
        ? {
            scored: isScored(q!),
            correct: !!mine?.correct,
            answered: !!mine,
            points: mine?.points ?? 0,
            correctText: correctText(q!),
          }
        : null,
      podium: this.phase === 'ended' ? ranking.slice(0, 5) : null,
      teamPodium: this.phase === 'ended' ? teams : null,
    };
  }

  report(id: string): GameReport {
    const ranking = this.ranking();
    const teams = this.teamRanking();
    const playerCount = this.players.size;
    return {
      id,
      quizId: this.quizId,
      title: this.quiz.title,
      pin: this.pin,
      mode: 'live',
      startedAt: this.startedAt || this.createdAt,
      endedAt: this.endedAt || Date.now(),
      playerCount,
      questions: this.records.map((rec, i) => {
        const q = this.quiz.questions[i]!;
        const correctCount = [...rec.answers.values()].filter((a) => a.correct).length;
        return {
          type: q.type,
          text: q.text,
          correctText: correctText(q),
          scored: isScored(q),
          correctRate: playerCount ? correctCount / playerCount : 0,
          summary: summarizeResults(q, computeResults(q, rec.answers.values())),
        };
      }),
      ranking: ranking.map((r) => ({
        name: r.name,
        score: r.score,
        rank: r.rank,
        correctCount: this.players.get(r.id)?.correctCount ?? 0,
        team: r.teamId !== null ? TEAMS[r.teamId]!.name : undefined,
      })),
      teams: teams?.map((t) => ({ name: t.name, score: t.score, rank: t.rank, members: t.members })),
    };
  }
}

export function withRanks<T>(sorted: T[], score: (t: T) => number): [T, number][] {
  let lastScore = Number.NaN;
  let lastRank = 0;
  return sorted.map((t, i) => {
    const s = score(t);
    const rank = s === lastScore ? lastRank : i + 1;
    lastScore = s;
    lastRank = rank;
    return [t, rank];
  });
}

export function safeEqual(a: string, b: string): boolean {
  if (typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
