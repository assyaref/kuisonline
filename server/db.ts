import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { QuizData } from '../shared/schema.js';
import type { GameReport } from '../shared/types.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface QuizRow {
  id: string;
  title: string;
  questionCount: number;
  updatedAt: number;
  createdAt: number;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        pass_hash BLOB NOT NULL,
        salt BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        data TEXT NOT NULL,
        question_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS quizzes_owner ON quizzes(owner_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quiz_id TEXT,
        title TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_owner ON reports(owner_id, ended_at DESC);
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quiz_id TEXT,
        pin TEXT NOT NULL,
        title TEXT NOT NULL,
        quiz TEXT NOT NULL,
        settings TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        deadline INTEGER NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS assignments_owner ON assignments(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS assignments_pin ON assignments(pin);
      CREATE TABLE IF NOT EXISTS assignment_players (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        player_key TEXT NOT NULL,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        avatar TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        q_index INTEGER NOT NULL DEFAULT 0,
        q_started_at INTEGER,
        answers TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        UNIQUE (assignment_id, name_lower)
      );
      CREATE INDEX IF NOT EXISTS ap_assignment ON assignment_players(assignment_id, score DESC);
    `);
    const cols = this.db.prepare('PRAGMA table_info(quizzes)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'is_public')) {
      this.db.exec('ALTER TABLE quizzes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
    }
  }

  /** Run fn inside a transaction (node:sqlite is synchronous so this is atomic). */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- users ----------

  async createUser(username: string, password: string): Promise<{ id: string; username: string } | null> {
    const exists = this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) return null;
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt, 64);
    const id = randomUUID();
    try {
      this.db
        .prepare('INSERT INTO users (id, username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, username, hash, salt, Date.now());
    } catch {
      return null; // race on UNIQUE
    }
    return { id, username };
  }

  async verifyUser(username: string, password: string): Promise<{ id: string; username: string } | null> {
    const row = this.db.prepare('SELECT id, username, pass_hash, salt FROM users WHERE username = ?').get(username) as
      | { id: string; username: string; pass_hash: Uint8Array; salt: Uint8Array }
      | undefined;
    // hash anyway to keep timing similar for unknown users
    const salt = row ? Buffer.from(row.salt) : randomBytes(16);
    const hash = await scryptAsync(password, salt, 64);
    if (!row) return null;
    const stored = Buffer.from(row.pass_hash);
    if (stored.length !== hash.length || !timingSafeEqual(stored, hash)) return null;
    return { id: row.id, username: row.username };
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
    return token;
  }

  getSessionUser(token: string | undefined): { id: string; username: string } | null {
    if (!token || token.length > 100) return null;
    const row = this.db
      .prepare(
        'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      )
      .get(sha256(token)) as { id: string; username: string; expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    return { id: row.id, username: row.username };
  }

  deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  purgeExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }

  // ---------- quizzes ----------

  listQuizzes(ownerId: string): QuizRow[] {
    return this.db
      .prepare(
        `SELECT id, title, question_count AS questionCount, updated_at AS updatedAt, created_at AS createdAt
         FROM quizzes WHERE owner_id = ? ORDER BY updated_at DESC`,
      )
      .all(ownerId) as unknown as QuizRow[];
  }

  getQuiz(ownerId: string, id: string): QuizData | null {
    const row = this.db.prepare('SELECT data FROM quizzes WHERE id = ? AND owner_id = ?').get(id, ownerId) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as QuizData) : null;
  }

  createQuiz(ownerId: string, quiz: QuizData): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO quizzes (id, owner_id, title, data, question_count, created_at, updated_at, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, ownerId, quiz.title, JSON.stringify(quiz), quiz.questions.length, now, now, quiz.public ? 1 : 0);
    return id;
  }

  updateQuiz(ownerId: string, id: string, quiz: QuizData): boolean {
    const r = this.db
      .prepare('UPDATE quizzes SET title = ?, data = ?, question_count = ?, updated_at = ?, is_public = ? WHERE id = ? AND owner_id = ?')
      .run(quiz.title, JSON.stringify(quiz), quiz.questions.length, Date.now(), quiz.public ? 1 : 0, id, ownerId);
    return Number(r.changes) > 0;
  }

  deleteQuiz(ownerId: string, id: string): boolean {
    const r = this.db.prepare('DELETE FROM quizzes WHERE id = ? AND owner_id = ?').run(id, ownerId);
    return Number(r.changes) > 0;
  }

  getPublicQuiz(id: string): { quiz: QuizData; author: string } | null {
    const row = this.db
      .prepare('SELECT q.data, u.username FROM quizzes q JOIN users u ON u.id = q.owner_id WHERE q.id = ? AND q.is_public = 1')
      .get(id) as { data: string; username: string } | undefined;
    return row ? { quiz: JSON.parse(row.data) as QuizData, author: row.username } : null;
  }

  searchPublicQuizzes(term: string) {
    const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    return this.db
      .prepare(
        `SELECT q.id, q.title, q.question_count AS questionCount, q.updated_at AS updatedAt, u.username AS author
         FROM quizzes q JOIN users u ON u.id = q.owner_id
         WHERE q.is_public = 1 AND q.title LIKE ? ESCAPE '\\'
         ORDER BY q.updated_at DESC LIMIT 60`,
      )
      .all(like);
  }

  // ---------- images ----------

  saveImage(ownerId: string, mime: string, data: Buffer): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO images (id, owner_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, ownerId, mime, data, Date.now());
    return id;
  }

  getImage(id: string): { mime: string; data: Uint8Array } | null {
    return (this.db.prepare('SELECT mime, data FROM images WHERE id = ?').get(id) as { mime: string; data: Uint8Array } | undefined) ?? null;
  }

  countImages(ownerId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM images WHERE owner_id = ?').get(ownerId) as { n: number }).n);
  }

  countQuizzes(ownerId: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE owner_id = ?').get(ownerId) as { n: number };
    return Number(r.n);
  }

  // ---------- reports ----------

  saveReport(ownerId: string, report: GameReport) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO reports (id, owner_id, quiz_id, title, player_count, ended_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(report.id, ownerId, report.quizId, report.title, report.playerCount, report.endedAt, JSON.stringify(report));
  }

  listReports(ownerId: string) {
    return this.db
      .prepare(
        `SELECT id, title, player_count AS playerCount, ended_at AS endedAt
         FROM reports WHERE owner_id = ? ORDER BY ended_at DESC LIMIT 200`,
      )
      .all(ownerId);
  }

  getReport(ownerId: string, id: string): GameReport | null {
    const row = this.db.prepare('SELECT data FROM reports WHERE id = ? AND owner_id = ?').get(id, ownerId) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as GameReport) : null;
  }

  deleteReport(ownerId: string, id: string): boolean {
    const r = this.db.prepare('DELETE FROM reports WHERE id = ? AND owner_id = ?').run(id, ownerId);
    return Number(r.changes) > 0;
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
