import { z } from 'zod';

export const LIMITS = {
  titleMax: 120,
  descMax: 500,
  questionMax: 300,
  optionMax: 90,
  textAnswerMax: 20,
  questionsMax: 100,
  nameMin: 1,
  nameMax: 20,
  playersMax: 300,
  timeMin: 5,
  timeMax: 240,
  imageMaxBytes: 2_000_000,
} as const;

export const TIME_CHOICES = [5, 10, 20, 30, 45, 60, 90, 120, 240];

export const QUESTION_TYPES = ['quiz', 'truefalse', 'typeanswer', 'puzzle', 'slider', 'poll', 'wordcloud'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  quiz: 'Pilihan ganda',
  truefalse: 'Benar / Salah',
  typeanswer: 'Ketik jawaban',
  puzzle: 'Puzzle (urutkan)',
  slider: 'Slider (tebak angka)',
  poll: 'Polling',
  wordcloud: 'Word cloud',
};

/** Question types that award points */
export const SCORED_TYPES: ReadonlySet<QuestionType> = new Set(['quiz', 'truefalse', 'typeanswer', 'puzzle', 'slider']);

export const SLIDER_MARGINS = ['none', 'low', 'medium', 'high', 'max'] as const;
export const SLIDER_MARGIN_FRACTION: Record<(typeof SLIDER_MARGINS)[number], number> = {
  none: 0,
  low: 0.05,
  medium: 0.1,
  high: 0.2,
  max: 1,
};
export const SLIDER_MARGIN_LABEL: Record<(typeof SLIDER_MARGINS)[number], string> = {
  none: 'Harus tepat',
  low: 'Rendah (±5%)',
  medium: 'Sedang (±10%)',
  high: 'Tinggi (±20%)',
  max: 'Maksimal (semua dapat poin)',
};

export const IMAGE_PATH_RE = /^\/api\/images\/[0-9a-f-]{36}$/;

const imageRef = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => {
    if (v === '' || IMAGE_PATH_RE.test(v)) return true;
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Gambar harus URL https:// atau hasil upload');

const sliderSchema = z.object({
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().finite().positive(),
  answer: z.number().finite(),
  margin: z.enum(SLIDER_MARGINS),
});
export type SliderConfig = z.infer<typeof sliderSchema>;

export const questionSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(QUESTION_TYPES),
    text: z.string().trim().min(1, 'Pertanyaan tidak boleh kosong').max(LIMITS.questionMax),
    image: imageRef.optional(),
    options: z.array(z.string().trim().max(LIMITS.optionMax)).max(4).default([]),
    correct: z.array(z.number().int().min(0).max(3)).max(4).default([]),
    accepted: z.array(z.string().trim().max(LIMITS.textAnswerMax)).max(4).default([]),
    slider: sliderSchema.optional(),
    timeLimit: z.number().int().min(LIMITS.timeMin).max(LIMITS.timeMax),
    points: z.enum(['standard', 'double', 'none']),
  })
  .superRefine((q, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
    const needOptions = (min: number, max: number) => {
      if (q.options.length < min || q.options.length > max) issue(`Butuh ${min}–${max} pilihan`, ['options']);
      q.options.forEach((o, i) => {
        if (!o) issue(`Pilihan ${i + 1} kosong`, ['options', i]);
      });
      const lower = q.options.map((o) => o.toLowerCase());
      if (new Set(lower).size !== lower.length) issue('Pilihan tidak boleh sama', ['options']);
    };
    const needCorrect = (exactlyOne: boolean) => {
      if (!q.correct.length) issue('Pilih minimal satu jawaban benar', ['correct']);
      if (exactlyOne && q.correct.length > 1) issue('Hanya boleh satu jawaban benar', ['correct']);
      if (q.correct.some((c) => c >= q.options.length)) issue('Jawaban benar tidak valid', ['correct']);
      if (new Set(q.correct).size !== q.correct.length) issue('Jawaban benar duplikat', ['correct']);
    };
    switch (q.type) {
      case 'quiz':
        needOptions(2, 4);
        needCorrect(false);
        break;
      case 'truefalse':
        needOptions(2, 2);
        needCorrect(true);
        break;
      case 'poll':
        needOptions(2, 4);
        break;
      case 'puzzle':
        needOptions(3, 4);
        break;
      case 'typeanswer': {
        const acc = q.accepted.filter(Boolean);
        if (!acc.length) issue('Isi minimal satu jawaban yang diterima', ['accepted']);
        break;
      }
      case 'slider': {
        const s = q.slider;
        if (!s) {
          issue('Atur nilai slider', ['slider']);
          break;
        }
        if (s.min >= s.max) issue('Nilai minimum harus lebih kecil dari maksimum', ['slider']);
        else if ((s.max - s.min) / s.step > 100_000) issue('Langkah slider terlalu kecil', ['slider']);
        if (s.answer < s.min || s.answer > s.max) issue('Jawaban slider harus di antara min dan maks', ['slider']);
        const k = (s.answer - s.min) / s.step;
        if (Math.abs(k - Math.round(k)) > 1e-6) issue('Jawaban slider harus sesuai kelipatan langkah', ['slider']);
        break;
      }
      case 'wordcloud':
        break;
    }
  });

export const quizSchema = z.object({
  title: z.string().trim().min(1, 'Judul tidak boleh kosong').max(LIMITS.titleMax),
  description: z.string().trim().max(LIMITS.descMax).default(''),
  coverImage: imageRef.optional(),
  public: z.boolean().default(false),
  questions: z.array(questionSchema).min(1, 'Kuis butuh minimal 1 pertanyaan').max(LIMITS.questionsMax),
});

export type Question = z.infer<typeof questionSchema>;
export type QuizData = z.infer<typeof quizSchema>;

export const gameSettingsSchema = z.object({
  teamMode: z.boolean().default(false),
  teamCount: z.number().int().min(2).max(6).default(4),
  randomizeQuestions: z.boolean().default(false),
  randomizeAnswers: z.boolean().default(false),
  nameGenerator: z.boolean().default(false),
  showQuestionOnDevice: z.boolean().default(true),
  music: z.boolean().default(true),
});
export type GameSettings = z.infer<typeof gameSettingsSchema>;
export const DEFAULT_SETTINGS: GameSettings = gameSettingsSchema.parse({});

export const nameSchema = z
  .string()
  .transform((s) =>
    s
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(z.string().min(LIMITS.nameMin, 'Nama wajib diisi').max(LIMITS.nameMax, `Nama maksimal ${LIMITS.nameMax} karakter`));

export const pinSchema = z.string().trim().regex(/^\d{6,7}$/, 'PIN harus 6 angka');

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,24}$/, 'Username 3–24 karakter: huruf, angka, titik, garis bawah'),
  password: z.string().min(8, 'Password minimal 8 karakter').max(200),
});

/** Normalise free text answers: case, accents, punctuation and extra spaces are ignored. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function firstError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Data tidak valid';
  const path = issue.path;
  if (path[0] === 'questions' && typeof path[1] === 'number') {
    return `Pertanyaan ${path[1] + 1}: ${issue.message}`;
  }
  return issue.message;
}
