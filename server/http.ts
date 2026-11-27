import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { credentialsSchema, firstError, quizSchema } from '../shared/schema.js';
import { SESSION_TTL_MS, type Store } from './db.js';
import { RateLimiter } from './ratelimit.js';

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

export function createApp(store: Store, opts: { secureCookies: boolean; clientDir?: string }) {
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

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));

  // CSRF defence: state-changing requests must be JSON (cross-site forms can't send it without CORS preflight)
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method !== 'DELETE' && !req.is('application/json')) {
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
