import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { generateName, type Avatar } from '../shared/avatar.js';
import { gameSettingsSchema, type GameSettings, type QuizData } from '../shared/schema.js';
import type { AnswerValue, GameReport, PlayerQuestion, PlayerResult } from '../shared/types.js';
import type { Store } from './db.js';
import { GameFailure, safeEqual, withRanks } from './game.js';
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

const GRACE_MS = 1500;
const MAX_PLAYERS = 1000;

interface AssignmentRow {
  id: string;
  owner_id: string;
  quiz_id: string | null;
  pin: string;
  title: string;
  quiz: string;
  settings: string;
  created_at: number;
  deadline: number;
  closed: number;
}

interface PlayerRow {
  id: string;
  assignment_id: string;
  player_key: string;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  correct_count: number;
  q_index: number;
  q_started_at: number | null;
  answers: string;
  created_at: number;
  finished_at: number | null;
}

interface StoredAnswer {
  q: number;
  value: AnswerValue | null;
  correct: boolean;
  points: number;
  order?: number[];
}

export interface AssignmentPlayerView {
  mode: 'assignment';
  title: string;
  deadline: number;
  open: boolean;
  serverNow: number;
  me: { id: string; name: string; avatar: Avatar; score: number; rank: number; streak: number };
  playerCount: number;
  questionIndex: number;
  questionCount: number;
  state: 'ready' | 'question' | 'finished';
  question: PlayerQuestion | null;
  questionDeadline: number | null;
  lastResult: PlayerResult | null;
}

export class Assignments {
  constructor(private store: Store) {}

  private get db() {
    return this.store.db;
  }

  private row(pin: string): AssignmentRow | null {
    return (
      (this.db.prepare('SELECT * FROM assignments WHERE pin = ? ORDER BY created_at DESC LIMIT 1').get(pin) as AssignmentRow | undefined) ??
      null
    );
  }

  private isOpen(a: AssignmentRow) {
    return !a.closed && a.deadline > Date.now();
  }

  private newPin(): string {
    for (let i = 0; i < 50; i++) {
      const pin = String(randomInt(1_000_000, 10_000_000));
      const existing = this.row(pin);
      if (!existing || !this.isOpen(existing)) return pin;
    }
    throw new Error('Could not allocate assignment PIN');
  }

  create(ownerId: string, quizId: string, hours: number, rawSettings: Partial<GameSettings>) {
    const quiz = this.store.getQuiz(ownerId, quizId);
    if (!quiz) throw new GameFailure('NOT_FOUND');
    const settings = gameSettingsSchema.parse({ ...rawSettings, teamMode: false });
    const prepared = prepareQuiz(quiz, settings);
    // fixed puzzle orders per assignment so every player gets the same shuffle
    const orders = prepared.questions.map((q) => (q.type === 'puzzle' ? puzzleOrder(q.options.length) : null));
    const id = randomUUID();
    const pin = this.newPin();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO assignments (id, owner_id, quiz_id, pin, title, quiz, settings, created_at, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, ownerId, quizId, pin, quiz.title, JSON.stringify({ ...prepared, orders }), JSON.stringify(settings), now, now + hours * 3600_000);
    return { id, pin };
  }

  list(ownerId: string) {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.pin, a.title, a.created_at AS createdAt, a.deadline, a.closed,
           (SELECT COUNT(*) FROM assignment_players p WHERE p.assignment_id = a.id) AS playerCount
         FROM assignments a WHERE a.owner_id = ? ORDER BY a.created_at DESC LIMIT 200`,
      )
      .all(ownerId) as { id: string; pin: string; title: string; createdAt: number; deadline: number; closed: number; playerCount: number }[];
    return rows.map((r) => ({ ...r, open: !r.closed && r.deadline > Date.now(), closed: undefined }));
  }

  close(ownerId: string, id: string): boolean {
    return Number(this.db.prepare('UPDATE assignments SET closed = 1 WHERE id = ? AND owner_id = ?').run(id, ownerId).changes) > 0;
  }

  delete(ownerId: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM assignments WHERE id = ? AND owner_id = ?').run(id, ownerId).changes) > 0;
  }

  report(ownerId: string, id: string): (GameReport & { open: boolean; deadline: number; assignmentPin: string }) | null {
    const a = this.db.prepare('SELECT * FROM assignments WHERE id = ? AND owner_id = ?').get(id, ownerId) as AssignmentRow | undefined;
    if (!a) return null;
    const quiz = JSON.parse(a.quiz) as QuizData;
    const players = this.db
      .prepare('SELECT * FROM assignment_players WHERE assignment_id = ? ORDER BY score DESC, created_at ASC')
      .all(a.id) as unknown as PlayerRow[];
    const answers = players.map((p) => JSON.parse(p.answers) as StoredAnswer[]);
    return {
      id: a.id,
      quizId: a.quiz_id,
      title: a.title,
      pin: a.pin,
      assignmentPin: a.pin,
      mode: 'assignment',
      open: this.isOpen(a),
      deadline: a.deadline,
      startedAt: a.created_at,
      endedAt: Math.min(a.deadline, Date.now()),
      playerCount: players.length,
      questions: quiz.questions.map((q, i) => {
        const qa = answers.flatMap((list) => list.filter((x) => x.q === i && x.value !== null)) as { value: AnswerValue; correct: boolean }[];
        return {
          type: q.type,
          text: q.text,
          correctText: correctText(q),
          scored: isScored(q),
          correctRate: players.length ? qa.filter((x) => x.correct).length / players.length : 0,
          summary: summarizeResults(q, computeResults(q, qa)),
        };
      }),
      ranking: withRanks(players, (p) => p.score).map(([p, rank]) => ({
        name: p.finished_at ? p.name : `${p.name} (${p.q_index}/${quiz.questions.length})`,
        score: p.score,
        rank,
        correctCount: p.correct_count,
      })),
    };
  }

  // ---------------- player side ----------------

  check(pin: string) {
    const a = this.row(pin);
    if (!a || !this.isOpen(a)) return null;
    const settings = JSON.parse(a.settings) as GameSettings;
    return { title: a.title, nameGenerator: settings.nameGenerator, mode: 'assignment' as const };
  }

  join(pin: string, rawName: string | undefined, avatar: Avatar) {
    const a = this.row(pin);
    if (!a || !this.isOpen(a)) throw new GameFailure('GAME_ENDED');
    const settings = JSON.parse(a.settings) as GameSettings;
    return this.store.tx(() => {
      const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM assignment_players WHERE assignment_id = ?').get(a.id) as { n: number }).n);
      if (count >= MAX_PLAYERS) throw new GameFailure('GAME_FULL');
      const taken = (n: string) =>
        !!this.db.prepare('SELECT 1 FROM assignment_players WHERE assignment_id = ? AND name_lower = ?').get(a.id, n.toLocaleLowerCase());
      let name: string;
      if (settings.nameGenerator) {
        let tries = 0;
        do name = tries++ < 30 ? generateName((k) => randomInt(k)) : `${generateName((k) => randomInt(k))} ${randomInt(100, 1000)}`;
        while (taken(name));
      } else {
        if (!rawName) throw new GameFailure('BAD_NAME');
        if (taken(rawName)) throw new GameFailure('NAME_TAKEN');
        name = rawName;
      }
      const id = randomUUID();
      const key = randomBytes(24).toString('base64url');
      this.db
        .prepare(
          'INSERT INTO assignment_players (id, assignment_id, player_key, name, name_lower, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, a.id, key, name, name.toLocaleLowerCase(), JSON.stringify(avatar), Date.now());
      return { playerId: id, playerKey: key, name };
    });
  }

  private auth(pin: string, playerId: string, key: string) {
    const a = this.row(pin);
    if (!a) throw new GameFailure('NOT_FOUND');
    const p = this.db.prepare('SELECT * FROM assignment_players WHERE id = ? AND assignment_id = ?').get(playerId, a.id) as PlayerRow | undefined;
    if (!p || !safeEqual(p.player_key, key)) throw new GameFailure('NOT_FOUND');
    return { a, p, quiz: JSON.parse(a.quiz) as QuizData & { orders: (number[] | null)[] }, settings: JSON.parse(a.settings) as GameSettings };
  }

  /** Record a miss if the current question's time ran out. Returns true if it advanced. */
  private expireIfNeeded(a: AssignmentRow, p: PlayerRow, quiz: QuizData): boolean {
    if (p.q_started_at === null || p.q_index >= quiz.questions.length) return false;
    const q = quiz.questions[p.q_index]!;
    if (Date.now() - p.q_started_at <= q.timeLimit * 1000 + GRACE_MS) return false;
    this.advance(a, p, quiz, { q: p.q_index, value: null, correct: false, points: 0 }, isScored(q));
    return true;
  }

  private advance(_a: AssignmentRow, p: PlayerRow, quiz: QuizData, ans: StoredAnswer, scored: boolean) {
    const answers = JSON.parse(p.answers) as StoredAnswer[];
    answers.push(ans);
    const streak = scored ? (ans.correct ? p.streak + 1 : 0) : p.streak;
    const next = p.q_index + 1;
    const finished = next >= quiz.questions.length ? Date.now() : null;
    this.db
      .prepare(
        `UPDATE assignment_players SET score = score + ?, streak = ?, correct_count = correct_count + ?, q_index = ?,
         q_started_at = NULL, answers = ?, finished_at = ? WHERE id = ? AND q_index = ?`,
      )
      .run(ans.points, streak, scored && ans.correct ? 1 : 0, next, JSON.stringify(answers), finished, p.id, p.q_index);
  }

  view(pin: string, playerId: string, key: string, lastResult: PlayerResult | null = null): AssignmentPlayerView {
    const { a, quiz, settings } = this.auth(pin, playerId, key);
    let { p } = this.auth(pin, playerId, key);
    if (this.expireIfNeeded(a, p, quiz)) {
      p = this.auth(pin, playerId, key).p;
      if (!lastResult) {
        const q = quiz.questions[p.q_index - 1]!;
        lastResult = { scored: isScored(q), correct: false, answered: false, points: 0, correctText: correctText(q) };
      }
    }
    const scores = this.db.prepare('SELECT id, score FROM assignment_players WHERE assignment_id = ? ORDER BY score DESC, created_at ASC').all(a.id) as {
      id: string;
      score: number;
    }[];
    const rank = withRanks(scores, (s) => s.score).find(([s]) => s.id === p.id)?.[1] ?? 0;
    const done = p.q_index >= quiz.questions.length || !this.isOpen(a);
    const q = quiz.questions[p.q_index];
    const started = !done && p.q_started_at !== null;
    return {
      mode: 'assignment',
      title: a.title,
      deadline: a.deadline,
      open: this.isOpen(a),
      serverNow: Date.now(),
      me: { id: p.id, name: p.name, avatar: JSON.parse(p.avatar) as Avatar, score: p.score, rank, streak: p.streak },
      playerCount: scores.length,
      questionIndex: p.q_index,
      questionCount: quiz.questions.length,
      state: done ? 'finished' : started ? 'question' : 'ready',
      question: started && q ? playerQuestion(q, quiz.orders[p.q_index] ?? null, true, true) : null,
      questionDeadline: started && q ? p.q_started_at! + q.timeLimit * 1000 : null,
      lastResult,
    };
  }

  start(pin: string, playerId: string, key: string, questionIndex: number): AssignmentPlayerView {
    const { a, p, quiz } = this.auth(pin, playerId, key);
    if (!this.isOpen(a)) throw new GameFailure('GAME_ENDED');
    if (p.q_index === questionIndex && p.q_started_at === null && p.q_index < quiz.questions.length) {
      this.db.prepare('UPDATE assignment_players SET q_started_at = ? WHERE id = ? AND q_started_at IS NULL').run(Date.now(), p.id);
    }
    return this.view(pin, playerId, key);
  }

  answer(pin: string, playerId: string, key: string, questionIndex: number, raw: unknown): AssignmentPlayerView {
    const { a, quiz } = this.auth(pin, playerId, key);
    return this.store.tx(() => {
      const { p } = this.auth(pin, playerId, key);
      if (p.q_index !== questionIndex || p.q_started_at === null) throw new GameFailure('TOO_LATE');
      const q = quiz.questions[p.q_index]!;
      const elapsed = Date.now() - p.q_started_at;
      if (elapsed > q.timeLimit * 1000 + GRACE_MS) {
        // too late: view() records the miss and reports it as the last result
        return this.view(pin, playerId, key);
      }
      let ev;
      try {
        ev = evaluate(q, raw);
      } catch (e) {
        if (e instanceof BadAnswer) throw new GameFailure('BAD_CHOICE');
        throw e;
      }
      const scored = isScored(q);
      const points = ev.correct ? calcPoints(q, elapsed, p.streak, ev.accuracy) : 0;
      this.advance(a, p, quiz, { q: p.q_index, value: ev.value, correct: ev.correct, points }, scored);
      return this.view(pin, playerId, key, { scored, correct: ev.correct, answered: true, points, correctText: correctText(q) });
    });
  }
}
