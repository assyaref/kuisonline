import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_GRACE_MS, calcPoints, COUNTDOWN_MS, Game, GameFailure, MAX_REROLLS } from '../server/game';
import { evaluate, prepareQuiz } from '../server/questions';
import { randomAvatar } from '../shared/avatar';
import { DEFAULT_SETTINGS, quizSchema, nameSchema, normalizeText, type GameSettings, type Question, type QuizData } from '../shared/schema';

const q = (over: Partial<Question> = {}): Question => ({
  id: Math.random().toString(36).slice(2),
  type: 'quiz',
  text: 'Ibu kota Indonesia?',
  options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'],
  correct: [0],
  accepted: [],
  timeLimit: 20,
  points: 'standard',
  ...over,
});

const quiz: QuizData = {
  title: 'Tes',
  description: '',
  public: false,
  questions: [q(), q({ type: 'truefalse', text: 'Bumi bulat?', options: ['Benar', 'Salah'], correct: [0], timeLimit: 10 })],
};

const av = randomAvatar();

function makeGame(data = quiz, settings: Partial<GameSettings> = {}) {
  const hooks = { onChange: vi.fn(), onEnd: vi.fn() };
  return { game: new Game('123456', data, 'quiz1', 'owner1', { ...DEFAULT_SETTINGS, ...settings }, hooks), hooks };
}

describe('calcPoints', () => {
  it('gives full points for instant answer, half at the deadline', () => {
    expect(calcPoints(q(), 0, 0)).toBe(1000);
    expect(calcPoints(q(), 20_000, 0)).toBe(500);
    expect(calcPoints(q(), 10_000, 0)).toBe(750);
    expect(calcPoints(q(), 99_999, 0)).toBe(500);
  });
  it('doubles, zeroes, and ignores unscored types', () => {
    expect(calcPoints(q({ points: 'double' }), 0, 0)).toBe(2000);
    expect(calcPoints(q({ points: 'none' }), 0, 3)).toBe(0);
    expect(calcPoints(q({ type: 'poll' }), 0, 3)).toBe(0);
  });
  it('adds a capped streak bonus', () => {
    expect(calcPoints(q(), 0, 2)).toBe(1200);
    expect(calcPoints(q(), 0, 50)).toBe(1500);
  });
});

describe('evaluate', () => {
  it('grades type answers ignoring case, accents and punctuation', () => {
    const t = q({ type: 'typeanswer', options: [], correct: [], accepted: ['Jakarta', 'DKI Jakarta'] });
    expect(evaluate(t, '  jakárta! ').correct).toBe(true);
    expect(evaluate(t, 'dki-jakarta').correct).toBe(true);
    expect(evaluate(t, 'Bandung').correct).toBe(false);
    expect(() => evaluate(t, '')).toThrow();
    expect(() => evaluate(t, 'x'.repeat(21))).toThrow();
    expect(() => evaluate(t, 5)).toThrow();
  });
  it('grades puzzles as exact permutation', () => {
    const p = q({ type: 'puzzle', options: ['a', 'b', 'c'], correct: [] });
    expect(evaluate(p, [0, 1, 2]).correct).toBe(true);
    expect(evaluate(p, [1, 0, 2]).correct).toBe(false);
    expect(() => evaluate(p, [0, 0, 2])).toThrow();
    expect(() => evaluate(p, [0, 1])).toThrow();
  });
  it('grades sliders with margins', () => {
    const s = (margin: 'none' | 'medium' | 'max') => q({ type: 'slider', options: [], correct: [], slider: { min: 0, max: 100, step: 1, answer: 50, margin } });
    expect(evaluate(s('none'), 50)).toMatchObject({ correct: true, accuracy: 1 });
    expect(evaluate(s('none'), 51).correct).toBe(false);
    expect(evaluate(s('medium'), 55)).toMatchObject({ correct: true, accuracy: 0.75 });
    expect(evaluate(s('medium'), 61).correct).toBe(false);
    expect(evaluate(s('max'), 0).correct).toBe(true);
    expect(evaluate(s('none'), 49.6).value).toBe(50); // snapped to step
    expect(() => evaluate(s('none'), 101)).toThrow();
    expect(() => evaluate(s('none'), Number.NaN)).toThrow();
  });
  it('accepts polls and word clouds without grading', () => {
    expect(evaluate(q({ type: 'poll', correct: [] }), 2).correct).toBe(false);
    expect(evaluate(q({ type: 'wordcloud', options: [], correct: [] }), 'seru').value).toBe('seru');
  });
});

describe('prepareQuiz', () => {
  it('randomizes answers while keeping the correct answer mapped', () => {
    for (let i = 0; i < 20; i++) {
      const out = prepareQuiz(quiz, { randomizeAnswers: true, randomizeQuestions: true });
      const q1 = out.questions.find((x) => x.type === 'quiz')!;
      expect(q1.options[q1.correct[0]!]).toBe('Jakarta');
      expect(out.questions).toHaveLength(2);
    }
    expect(quiz.questions[0]!.options[0]).toBe('Jakarta'); // original untouched
  });
});

describe('Game flow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs a full game with scoring, streaks and ranking', () => {
    const { game, hooks } = makeGame();
    const a = game.addPlayer('Andi', av);
    const b = game.addPlayer('Budi', av);
    game.start();
    expect(game.phase).toBe('countdown');
    expect(() => game.answer(a.id, 0, 0)).toThrow(GameFailure);

    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(game.phase).toBe('question');
    expect(game.playerView(a.id)!.result).toBeNull();
    expect(JSON.stringify(game.playerView(a.id))).not.toMatch(/"correct"|"accepted"|"answer"/);

    vi.advanceTimersByTime(2000);
    game.answer(a.id, 0, 0);
    expect(() => game.answer(a.id, 0, 1)).toThrow('sudah menjawab');
    game.answer(b.id, 0, 2);
    expect(game.phase).toBe('reveal');
    expect(a.score).toBe(950);
    expect(b.score).toBe(0);
    expect(game.hostView().results).toEqual({ kind: 'options', counts: [1, 0, 1, 0] });
    expect(game.playerView(a.id)!.result).toMatchObject({ correct: true, points: 950, correctText: 'Jakarta' });
    expect(game.playerView(b.id)!.behind).toEqual({ name: 'Andi', gap: 950 });

    game.next();
    expect(game.phase).toBe('leaderboard');
    expect(game.ranking().map((r) => r.name)).toEqual(['Andi', 'Budi']);

    game.next();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 1, 0);
    vi.advanceTimersByTime(10_000 + ANSWER_GRACE_MS);
    expect(game.phase).toBe('reveal');
    expect(a.score).toBe(950 + 1100);
    expect(a.streak).toBe(2);

    game.next();
    expect(game.phase).toBe('ended');
    expect(hooks.onEnd).toHaveBeenCalledOnce();
    expect(game.playerView(b.id)!.podium![0]!.name).toBe('Andi');
    const report = game.report('r1');
    expect(report.questions[0]!.correctRate).toBe(0.5);
    expect(report.ranking[0]).toMatchObject({ name: 'Andi', correctCount: 2 });
  });

  it('handles every question type end to end', () => {
    const data: QuizData = {
      title: 'Semua tipe',
      description: '',
      public: false,
      questions: [
        q({ type: 'typeanswer', options: [], correct: [], accepted: ['Komodo'] }),
        q({ type: 'puzzle', options: ['1', '2', '3', '4'], correct: [] }),
        q({ type: 'slider', options: [], correct: [], slider: { min: 0, max: 10, step: 1, answer: 7, margin: 'none' } }),
        q({ type: 'poll', correct: [] }),
        q({ type: 'wordcloud', options: [], correct: [] }),
      ],
    };
    const { game } = makeGame(data);
    const a = game.addPlayer('A', av);
    game.start();
    // type answer
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 0, 'komodo');
    expect(game.hostView().results).toEqual({ kind: 'text', entries: [{ text: 'komodo', count: 1, correct: true }] });
    game.next();
    // puzzle: shuffled items are shown, solution isn't
    game.next();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const pv = game.playerView(a.id)!;
    expect(pv.question!.items.map((x) => x.i)).not.toEqual([0, 1, 2, 3]);
    game.answer(a.id, 1, [0, 1, 2, 3]);
    expect(game.playerView(a.id)!.result!.correct).toBe(true);
    game.next();
    game.next();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(game.playerView(a.id)!.question!.slider).toEqual({ min: 0, max: 10, step: 1 });
    game.answer(a.id, 2, 7);
    expect(a.streak).toBe(3);
    const scoreBeforePoll = a.score;
    game.next();
    game.next();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 3, 1);
    expect(game.phase).toBe('reveal');
    expect(a.score).toBe(scoreBeforePoll);
    expect(a.streak).toBe(3); // polls don't break streaks
    game.next(); // poll → straight to next countdown (no leaderboard)
    expect(game.phase).toBe('countdown');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 4, 'Seru');
    expect(game.hostView().results).toMatchObject({ kind: 'text' });
    game.next();
    expect(game.phase).toBe('ended');
  });

  it('rejects late and malformed answers', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A', av);
    game.addPlayer('B', av);
    game.start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(() => game.answer(a.id, 1, 0)).toThrow('Waktu habis');
    expect(() => game.answer(a.id, 0, 9)).toThrow('tidak valid');
    expect(() => game.answer(a.id, 0, 'Jakarta')).toThrow('tidak valid');
    vi.advanceTimersByTime(20_000 + ANSWER_GRACE_MS);
    expect(() => game.answer(a.id, 0, 0)).toThrow('Waktu habis');
  });

  it('enforces unique names, lock and kicks', () => {
    const { game } = makeGame();
    game.addPlayer('Siti', av);
    expect(() => game.addPlayer('siti', av)).toThrow('Nama sudah dipakai');
    game.setLocked(true);
    expect(() => game.addPlayer('Rina', av)).toThrow('dikunci');
    game.setLocked(false);
    const r = game.addPlayer('Rina', av);
    game.kick(r.id);
    expect(game.players.size).toBe(1);
  });

  it('generates funny names with limited rerolls', () => {
    const { game } = makeGame(quiz, { nameGenerator: true });
    const p = game.addPlayer('NamaKasar', av);
    expect(p.name).not.toBe('NamaKasar');
    for (let i = 0; i < MAX_REROLLS; i++) game.rerollName(p.id);
    expect(() => game.rerollName(p.id)).toThrow('habis');
  });

  it('balances teams and averages team scores', () => {
    const { game } = makeGame(quiz, { teamMode: true, teamCount: 2 });
    const ps = ['A', 'B', 'C', 'D'].map((n) => game.addPlayer(n, av));
    const counts = [0, 0];
    for (const p of ps) counts[p.teamId!]++;
    expect(counts).toEqual([2, 2]);
    game.start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    for (const p of ps) game.answer(p.id, 0, p.teamId === 0 ? 0 : 1);
    const teams = game.teamRanking()!;
    expect(teams[0]!.id).toBe(0);
    expect(teams[0]!.score).toBeGreaterThan(0);
    expect(teams[1]!.score).toBe(0);
    expect(game.playerView(ps[0]!.id)!.team!.name).toBe(teams.find((t) => t.id === ps[0]!.teamId)!.name);
  });

  it('reveals early when remaining connected players have answered', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A', av);
    const b = game.addPlayer('B', av);
    game.start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 0, 0);
    game.setConnected(b.id, false);
    expect(game.phase).toBe('reveal');
  });

  it('tracks previous rank for animated leaderboards', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A', av);
    const b = game.addPlayer('B', av);
    game.start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 0, 1);
    game.answer(b.id, 0, 0);
    const r = game.ranking();
    expect(r[0]).toMatchObject({ name: 'B', rank: 1, prevRank: 1 });
    expect(r[1]).toMatchObject({ name: 'A', rank: 2, prevRank: 1 });
  });

  it('authenticates resume with player key only', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A', av);
    expect(game.authPlayer(a.id, a.key)).toBe(a);
    expect(game.authPlayer(a.id, 'x'.repeat(a.key.length))).toBeNull();
  });
});

describe('schemas', () => {
  it('validates each question type', () => {
    const ok = (x: Partial<Question>) => quizSchema.safeParse({ ...quiz, questions: [q(x)] }).success;
    expect(ok({})).toBe(true);
    expect(ok({ correct: [3], options: ['a', 'b'] })).toBe(false);
    expect(ok({ options: ['a', 'A'] })).toBe(false);
    expect(ok({ image: 'http://x.com/a.png' })).toBe(false);
    expect(ok({ image: 'https://x.com/a.png' })).toBe(true);
    expect(ok({ image: '/api/images/123e4567-e89b-12d3-a456-426614174000' })).toBe(true);
    expect(ok({ type: 'typeanswer', options: [], correct: [], accepted: [] })).toBe(false);
    expect(ok({ type: 'typeanswer', options: [], correct: [], accepted: ['ya'] })).toBe(true);
    expect(ok({ type: 'puzzle', options: ['a', 'b'], correct: [] })).toBe(false);
    expect(ok({ type: 'puzzle', options: ['a', 'b', 'c'], correct: [] })).toBe(true);
    expect(ok({ type: 'slider', options: [], correct: [], slider: { min: 0, max: 10, step: 3, answer: 5, margin: 'none' } })).toBe(false);
    expect(ok({ type: 'slider', options: [], correct: [], slider: { min: 0, max: 10, step: 1, answer: 5, margin: 'low' } })).toBe(true);
    expect(ok({ type: 'poll', correct: [] })).toBe(true);
    expect(ok({ type: 'wordcloud', options: [], correct: [] })).toBe(true);
  });
  it('cleans names and text', () => {
    expect(nameSchema.parse('  Budi   Santoso ​')).toBe('Budi Santoso');
    expect(nameSchema.safeParse('   ').success).toBe(false);
    expect(normalizeText('  Éxito!!  ')).toBe('exito');
  });
});
