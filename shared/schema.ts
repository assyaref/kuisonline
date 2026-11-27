import { z } from 'zod';

export const LIMITS = {
  titleMax: 120,
  descMax: 500,
  questionMax: 300,
  optionMax: 90,
  questionsMax: 100,
  nameMin: 1,
  nameMax: 20,
  playersMax: 300,
  timeMin: 5,
  timeMax: 240,
} as const;

export const TIME_CHOICES = [5, 10, 20, 30, 45, 60, 90, 120, 240];

const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL gambar harus diawali https://');

export const questionSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(['quiz', 'truefalse']),
    text: z.string().trim().min(1, 'Pertanyaan tidak boleh kosong').max(LIMITS.questionMax),
    image: z.union([httpsUrl, z.literal('')]).optional(),
    options: z.array(z.string().trim().max(LIMITS.optionMax)).min(2).max(4),
    correct: z.array(z.number().int().min(0).max(3)).min(1, 'Pilih minimal satu jawaban benar'),
    timeLimit: z.number().int().min(LIMITS.timeMin).max(LIMITS.timeMax),
    points: z.enum(['standard', 'double', 'none']),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'truefalse' && q.options.length !== 2) {
      ctx.addIssue({ code: 'custom', message: 'Benar/Salah harus punya 2 pilihan', path: ['options'] });
    }
    q.options.forEach((o, i) => {
      if (!o) ctx.addIssue({ code: 'custom', message: `Pilihan ${i + 1} kosong`, path: ['options', i] });
    });
    const lower = q.options.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      ctx.addIssue({ code: 'custom', message: 'Pilihan jawaban tidak boleh sama', path: ['options'] });
    }
    for (const c of q.correct) {
      if (c >= q.options.length) {
        ctx.addIssue({ code: 'custom', message: 'Jawaban benar tidak valid', path: ['correct'] });
      }
    }
    if (new Set(q.correct).size !== q.correct.length) {
      ctx.addIssue({ code: 'custom', message: 'Jawaban benar duplikat', path: ['correct'] });
    }
  });

export const quizSchema = z.object({
  title: z.string().trim().min(1, 'Judul tidak boleh kosong').max(LIMITS.titleMax),
  description: z.string().trim().max(LIMITS.descMax).default(''),
  questions: z.array(questionSchema).min(1, 'Kuis butuh minimal 1 pertanyaan').max(LIMITS.questionsMax),
});

export type Question = z.infer<typeof questionSchema>;
export type QuizData = z.infer<typeof quizSchema>;

export const nameSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(LIMITS.nameMin, 'Nama wajib diisi').max(LIMITS.nameMax, `Nama maksimal ${LIMITS.nameMax} karakter`));

export const pinSchema = z.string().trim().regex(/^\d{6}$/, 'PIN harus 6 angka');

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,24}$/, 'Username 3–24 karakter: huruf, angka, titik, garis bawah'),
  password: z.string().min(8, 'Password minimal 8 karakter').max(200),
});

export function firstError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Data tidak valid';
  const path = issue.path;
  if (path[0] === 'questions' && typeof path[1] === 'number') {
    return `Pertanyaan ${path[1] + 1}: ${issue.message}`;
  }
  return issue.message;
}
