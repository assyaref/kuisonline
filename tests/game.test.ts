import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_GRACE_MS, calcPoints, COUNTDOWN_MS, Game, GameFailure } from '../server/game';
import { quizSchema, nameSchema, type Question, type QuizData } from '../shared/schema';

const q = (over: Partial<Question> = {}): Question => ({
  id: Math.random().toString(36).slice(2),
  type: 'quiz',
  text: 'Ibu kota Indonesia?',
  options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'],
  correct: [0],
  timeLimit: 20,
  points: 'standard',
  ...over,
});

const quiz: QuizData = {
  title: 'Tes',
  description: '',
  questions: [q(), q({ type: 'truefalse', text: 'Bumi bulat?', options: ['Benar', 'Salah'], correct: [0], timeLimit: 10 })],
};

function makeGame(data = quiz) {
  const hooks = { onChange: vi.fn(), onEnd: vi.fn() };
  return { game: new Game('123456', data, 'quiz1', 'owner1', hooks), hooks };
}

describe('calcPoints', () => {
  it('gives full points for instant answer, half at the deadline', () => {
    expect(calcPoints(q(), 0, 0)).toBe(1000);
    expect(calcPoints(q(), 20_000, 0)).toBe(500);
    expect(calcPoints(q(), 10_000, 0)).toBe(750);
    expect(calcPoints(q(), 99_999, 0)).toBe(500);
  });
  it('doubles and zeroes', () => {
    expect(calcPoints(q({ points: 'double' }), 0, 0)).toBe(2000);
    expect(calcPoints(q({ points: 'none' }), 0, 3)).toBe(0);
  });
  it('adds a capped streak bonus', () => {
    expect(calcPoints(q(), 0, 2)).toBe(1200);
    expect(calcPoints(q(), 0, 50)).toBe(1500);
  });
});

describe('Game flow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs a full game with scoring, streaks and ranking', () => {
    const { game, hooks } = makeGame();
    const a = game.addPlayer('Andi');
    const b = game.addPlayer('Budi');
    game.start();
    expect(game.phase).toBe('countdown');
    expect(() => game.answer(a.id, 0, 0)).toThrow(GameFailure);

    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(game.phase).toBe('question');
    // players never see correct answers before reveal
    expect(game.playerView(a.id)!.result).toBeNull();
    expect(JSON.stringify(game.playerView(a.id))).not.toContain('"correct"');

    vi.advanceTimersByTime(2000);
    game.answer(a.id, 0, 0); // correct after 2s
    expect(() => game.answer(a.id, 0, 1)).toThrow('sudah menjawab');
    expect(game.phase).toBe('question');
    game.answer(b.id, 0, 2); // wrong -> everyone answered -> reveal early
    expect(game.phase).toBe('reveal');
    expect(a.score).toBe(950);
    expect(b.score).toBe(0);
    expect(game.hostView().distribution).toEqual([1, 0, 1, 0]);
    expect(game.playerView(a.id)!.result).toMatchObject({ correct: true, points: 950 });
    expect(game.playerView(b.id)!.result).toMatchObject({ correct: false, answered: true });

    game.next();
    expect(game.phase).toBe('leaderboard');
    expect(game.ranking().map((r) => r.name)).toEqual(['Andi', 'Budi']);

    game.next();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 1, 0); // instant correct with streak 1
    // Budi doesn't answer -> timeout
    vi.advanceTimersByTime(10_000 + ANSWER_GRACE_MS);
    expect(game.phase).toBe('reveal');
    expect(a.score).toBe(950 + 1100);
    expect(a.streak).toBe(2);
    expect(game.playerView(b.id)!.result).toMatchObject({ answered: false, correct: false });

    game.next(); // last question -> ended
    expect(game.phase).toBe('ended');
    expect(hooks.onEnd).toHaveBeenCalledOnce();
    expect(game.playerView(b.id)!.podium![0]!.name).toBe('Andi');

    const report = game.report('r1');
    expect(report.questions).toHaveLength(2);
    expect(report.ranking[0]).toMatchObject({ name: 'Andi', correctCount: 2 });
    expect(report.questions[0]!.correctRate).toBe(0.5);
  });

  it('rejects late answers and wrong question index', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A');
    game.addPlayer('B');
    game.start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(() => game.answer(a.id, 1, 0)).toThrow('Waktu habis');
    expect(() => game.answer(a.id, 0, 9)).toThrow('Pilihan tidak valid');
    vi.advanceTimersByTime(20_000 + ANSWER_GRACE_MS);
    expect(game.phase).toBe('reveal');
    expect(() => game.answer(a.id, 0, 0)).toThrow('Waktu habis');
  });

  it('enforces unique names, lock and kicks', () => {
    const { game } = makeGame();
    game.addPlayer('Siti');
    expect(() => game.addPlayer('siti')).toThrow('Nama sudah dipakai');
    game.setLocked(true);
    expect(() => game.addPlayer('Rina')).toThrow('dikunci');
    game.setLocked(false);
    const r = game.addPlayer('Rina');
    game.kick(r.id);
    expect(game.players.size).toBe(1);
  });

  it('reveals early when remaining connected players have answered', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A');
    const b = game.addPlayer('B');
    game.start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    game.answer(a.id, 0, 0);
    game.setConnected(b.id, false);
    expect(game.phase).toBe('reveal');
  });

  it('authenticates resume with player key only', () => {
    const { game } = makeGame();
    const a = game.addPlayer('A');
    expect(game.authPlayer(a.id, a.key)).toBe(a);
    expect(game.authPlayer(a.id, 'x'.repeat(a.key.length))).toBeNull();
    expect(game.authPlayer(a.id, 'short')).toBeNull();
  });

  it('shares rank on ties', () => {
    const { game } = makeGame();
    game.addPlayer('A');
    game.addPlayer('B');
    expect(game.ranking().map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe('schemas', () => {
  it('validates quizzes', () => {
    expect(quizSchema.safeParse(quiz).success).toBe(true);
    expect(quizSchema.safeParse({ ...quiz, questions: [] }).success).toBe(false);
    expect(quizSchema.safeParse({ ...quiz, questions: [q({ correct: [3], options: ['a', 'b'] })] }).success).toBe(false);
    expect(quizSchema.safeParse({ ...quiz, questions: [q({ options: ['a', 'A'] , correct: [0]})] }).success).toBe(false);
    expect(quizSchema.safeParse({ ...quiz, questions: [q({ image: 'http://x.com/a.png' })] }).success).toBe(false);
    expect(quizSchema.safeParse({ ...quiz, questions: [q({ image: 'https://x.com/a.png' })] }).success).toBe(true);
  });
  it('cleans player names', () => {
    expect(nameSchema.parse('  Budi   Santoso ​')).toBe('Budi Santoso');
    expect(nameSchema.safeParse('   ').success).toBe(false);
    expect(nameSchema.safeParse('x'.repeat(21)).success).toBe(false);
  });
});
