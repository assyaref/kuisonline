import { randomInt } from 'node:crypto';
import {
  LIMITS,
  normalizeText,
  SCORED_TYPES,
  SLIDER_MARGIN_FRACTION,
  type GameSettings,
  type Question,
  type QuizData,
} from '../shared/schema.js';
import type { AnswerValue, PlayerQuestion, QuestionResults } from '../shared/types.js';

export const STREAK_BONUS = 100;
export const STREAK_BONUS_MAX_STEPS = 5;

export class BadAnswer extends Error {}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A shuffled order that differs from the identity (for puzzles). */
export function puzzleOrder(n: number): number[] {
  const identity = [...Array(n).keys()];
  for (let tries = 0; tries < 20; tries++) {
    const o = shuffle(identity);
    if (o.some((v, i) => v !== i)) return o;
  }
  return identity.slice().reverse();
}

export function isScored(q: Question): boolean {
  return SCORED_TYPES.has(q.type) && q.points !== 'none';
}

export function basePoints(q: Question): number {
  if (!isScored(q)) return 0;
  return q.points === 'double' ? 2000 : 1000;
}

/** Points for a correct answer: 50–100% of base by speed, scaled by accuracy (slider), plus a capped streak bonus. */
export function calcPoints(q: Question, elapsedMs: number, streakBefore: number, accuracy = 1): number {
  const base = basePoints(q);
  if (base === 0) return 0;
  const ratio = Math.min(1, Math.max(0, elapsedMs / (q.timeLimit * 1000)));
  const speed = Math.round(base * (1 - ratio / 2) * accuracy);
  const bonus = Math.min(streakBefore, STREAK_BONUS_MAX_STEPS) * STREAK_BONUS;
  return speed + bonus;
}

export interface Evaluated {
  value: AnswerValue;
  correct: boolean;
  accuracy: number;
}

function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') throw new BadAnswer();
  const s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s || s.length > LIMITS.textAnswerMax) throw new BadAnswer();
  return s;
}

/** Validate and grade a raw answer. Throws BadAnswer for malformed input. */
export function evaluate(q: Question, raw: unknown): Evaluated {
  switch (q.type) {
    case 'quiz':
    case 'truefalse':
    case 'poll': {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= q.options.length) throw new BadAnswer();
      return { value: raw, correct: q.type !== 'poll' && q.correct.includes(raw), accuracy: 1 };
    }
    case 'puzzle': {
      const n = q.options.length;
      if (!Array.isArray(raw) || raw.length !== n) throw new BadAnswer();
      const seen = new Set<number>();
      for (const v of raw) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) throw new BadAnswer();
        seen.add(v);
      }
      const order = raw as number[];
      return { value: order, correct: order.every((v, i) => v === i), accuracy: 1 };
    }
    case 'slider': {
      const s = q.slider!;
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < s.min - 1e-9 || raw > s.max + 1e-9) throw new BadAnswer();
      const snapped = roundTo(s.min + Math.round((raw - s.min) / s.step) * s.step, s.step);
      const tol = SLIDER_MARGIN_FRACTION[s.margin] * (s.max - s.min);
      const diff = Math.abs(snapped - s.answer);
      const correct = diff <= tol + 1e-9;
      const accuracy = !correct ? 0 : tol === 0 ? 1 : 1 - (0.5 * diff) / tol;
      return { value: snapped, correct, accuracy };
    }
    case 'typeanswer': {
      const s = cleanText(raw);
      const n = normalizeText(s);
      return { value: s, correct: !!n && q.accepted.some((a) => a && normalizeText(a) === n), accuracy: 1 };
    }
    case 'wordcloud':
      return { value: cleanText(raw), correct: false, accuracy: 1 };
  }
}

function roundTo(v: number, step: number): number {
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 2));
  return Number(v.toFixed(decimals));
}

export function formatNumber(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 6, useGrouping: Math.abs(n) >= 10000 });
}

export function correctText(q: Question): string {
  switch (q.type) {
    case 'quiz':
    case 'truefalse':
      return q.correct.map((c) => q.options[c]).join(', ');
    case 'typeanswer':
      return q.accepted.filter(Boolean).join(' / ');
    case 'puzzle':
      return q.options.join(' → ');
    case 'slider':
      return formatNumber(q.slider!.answer);
    default:
      return '';
  }
}

export function computeResults(q: Question, answers: Iterable<{ value: AnswerValue; correct: boolean }>): QuestionResults {
  const list = [...answers];
  switch (q.type) {
    case 'quiz':
    case 'truefalse':
    case 'poll': {
      const counts = new Array(q.options.length).fill(0);
      for (const a of list) counts[a.value as number]++;
      return { kind: 'options', counts };
    }
    case 'puzzle': {
      const correct = list.filter((a) => a.correct).length;
      return { kind: 'puzzle', correct, wrong: list.length - correct };
    }
    case 'slider':
      return { kind: 'slider', values: list.slice(0, 1000).map((a) => a.value as number) };
    case 'typeanswer':
    case 'wordcloud': {
      const groups = new Map<string, { text: string; count: number; correct: boolean }>();
      for (const a of list) {
        const key = normalizeText(a.value as string) || (a.value as string);
        const g = groups.get(key);
        if (g) g.count++;
        else groups.set(key, { text: a.value as string, count: 1, correct: a.correct });
      }
      return { kind: 'text', entries: [...groups.values()].sort((x, y) => y.count - x.count).slice(0, 40) };
    }
  }
}

export function summarizeResults(q: Question, r: QuestionResults): string {
  switch (r.kind) {
    case 'options':
      return q.options.map((o, i) => `${o}: ${r.counts[i] ?? 0}`).join(' · ');
    case 'puzzle':
      return `Benar: ${r.correct} · Salah: ${r.wrong}`;
    case 'slider': {
      if (!r.values.length) return 'Tidak ada jawaban';
      const avg = r.values.reduce((a, b) => a + b, 0) / r.values.length;
      return `Rata-rata: ${formatNumber(Math.round(avg * 100) / 100)}`;
    }
    case 'text':
      return r.entries.slice(0, 8).map((e) => `${e.text} (${e.count})`).join(' · ') || 'Tidak ada jawaban';
  }
}

export function playerQuestion(q: Question, order: number[] | null, showText: boolean, withChoices: boolean): PlayerQuestion {
  return {
    type: q.type,
    text: showText ? q.text : null,
    image: showText ? q.image || undefined : undefined,
    options: withChoices && (q.type === 'quiz' || q.type === 'truefalse' || q.type === 'poll') ? q.options : [],
    items: withChoices && q.type === 'puzzle' && order ? order.map((i) => ({ i, text: q.options[i]! })) : [],
    slider: withChoices && q.type === 'slider' && q.slider ? { min: q.slider.min, max: q.slider.max, step: q.slider.step } : null,
    timeLimit: q.timeLimit,
    points: isScored(q) ? q.points : 'none',
  };
}

/** Clone a quiz applying randomisation settings. */
export function prepareQuiz(quiz: QuizData, settings: Pick<GameSettings, 'randomizeAnswers' | 'randomizeQuestions'>): QuizData {
  let questions = quiz.questions.map((q) => ({ ...q, options: [...q.options], correct: [...q.correct] }));
  if (settings.randomizeAnswers) {
    questions = questions.map((q) => {
      if (q.type !== 'quiz' && q.type !== 'poll') return q;
      const order = shuffle(q.options.map((_, i) => i));
      return { ...q, options: order.map((i) => q.options[i]!), correct: q.correct.map((c) => order.indexOf(c)).sort() };
    });
  }
  if (settings.randomizeQuestions) questions = shuffle(questions);
  return { ...quiz, questions };
}
