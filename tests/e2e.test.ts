import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { startServer } from '../server/index';
import type { HostView, PlayerView } from '../shared/types';
import { randomAvatar } from '../shared/avatar';
const avatar = randomAvatar();

let server: ReturnType<typeof startServer>;
let base = '';
let cookie = '';
let quizId = '';

const quiz = {
  title: 'Kuis E2E',
  description: '',
  questions: [
    { id: 'q1', type: 'quiz', text: '2+2?', options: ['3', '4', '5'], correct: [1], timeLimit: 5, points: 'standard' },
    { id: 'q2', type: 'truefalse', text: 'Air basah?', options: ['Benar', 'Salah'], correct: [0], timeLimit: 5, points: 'double' },
  ],
};

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function sock(withCookie = false): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(base, { transports: ['websocket'], extraHeaders: withCookie ? { cookie } : {}, forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const emit = <T = Record<string, unknown>>(s: Socket, ev: string, data?: unknown) =>
  new Promise<T>((r) => (data === undefined ? s.emit(ev, r) : s.emit(ev, data, r)));

function waitFor<T>(s: Socket, ev: string, pred: (v: T) => boolean, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (v: T) => {
      if (pred(v)) {
        clearTimeout(t);
        s.off(ev, h);
        resolve(v);
      }
    };
    s.on(ev, h);
  });
}

beforeAll(async () => {
  server = startServer({ port: 0, dbFile: ':memory:' });
  base = `http://localhost:${await server.ready}`;
});
afterAll(async () => {
  await server.close();
});

describe('HTTP API', () => {
  it('rejects unauthenticated access and non-JSON writes', async () => {
    expect((await api('/api/quizzes')).status).toBe(401);
    const r = await fetch(base + '/api/auth/login', { method: 'POST', body: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(r.status).toBe(415);
  });

  it('registers, logs in, and manages quizzes', async () => {
    expect((await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'gu', password: 'x' }) })).status).toBe(400);
    const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'GuruBudi', password: 'rahasia123' }) });
    expect(reg.status).toBe(201);
    expect((await api('/api/auth/me')).body.user).toMatchObject({ username: 'gurubudi' });
    const dup = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'gurubudi', password: 'rahasia123' }) });
    expect(dup.status).toBe(409);

    const bad = await api('/api/quizzes', { method: 'POST', body: JSON.stringify({ ...quiz, questions: [] }) });
    expect(bad.status).toBe(400);
    const created = await api('/api/quizzes', { method: 'POST', body: JSON.stringify(quiz) });
    expect(created.status).toBe(201);
    quizId = created.body.id as string;
    expect(((await api('/api/quizzes')).body.quizzes as unknown[]).length).toBe(1);

    // other users can't read it
    const saved = cookie;
    cookie = '';
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'lain', password: 'rahasia123' }) });
    expect((await api(`/api/quizzes/${quizId}`)).status).toBe(404);
    cookie = saved;
    expect((await api(`/api/quizzes/${quizId}`)).status).toBe(200);
  });
});

describe('realtime game', () => {
  it('plays a full game with reconnection', async () => {
    const host = await sock(true);
    const anon = await sock(false);
    expect(await emit(anon, 'host:create', { quizId })).toMatchObject({ ok: false });

    const created = await emit<{ ok: boolean; pin: string; hostKey: string }>(host, 'host:create', { quizId });
    expect(created.ok).toBe(true);
    const { pin } = created;

    expect(await emit(anon, 'player:check', { pin: '000000' })).toMatchObject({ ok: false });
    expect(await emit(anon, 'player:check', { pin })).toMatchObject({ ok: true, title: 'Kuis E2E' });

    const p1 = await sock();
    const p2 = await sock();
    const lobbyP = waitFor<HostView>(host, 'host:state', (v) => v.playerCount === 2);
    const j1 = await emit<{ ok: boolean; playerId: string; playerKey: string }>(p1, 'player:join', { pin, name: 'Andi', avatar });
    expect(j1.ok).toBe(true);
    expect(await emit(p2, 'player:join', { pin, name: 'andi', avatar })).toMatchObject({ ok: false });
    expect(await emit(p2, 'player:join', { pin, name: 'Budi', avatar })).toMatchObject({ ok: true });
    await lobbyP;

    // non-host cannot control the game
    expect(await emit(p1, 'host:next', {})).toMatchObject({ ok: false });

    const q1P = waitFor<PlayerView>(p1, 'player:state', (v) => v.phase === 'question');
    expect(await emit(host, 'host:next', {})).toMatchObject({ ok: true }); // start
    const q1 = await q1P;
    expect(q1.question!.options).toEqual(['3', '4', '5']);
    expect(JSON.stringify(q1)).not.toContain('correct');

    // p1 drops and reconnects with its key mid-question, keeping identity
    p1.disconnect();
    const p1b = await sock();
    expect(await emit(p1b, 'player:resume', { pin, playerId: j1.playerId, playerKey: 'wrong-key-123' })).toMatchObject({ ok: false });
    expect(await emit(p1b, 'player:resume', { pin, playerId: j1.playerId, playerKey: j1.playerKey })).toMatchObject({ ok: true, name: 'Andi' });

    const revP = waitFor<PlayerView>(p1b, 'player:state', (v) => v.phase === 'reveal');
    const hostRevP = waitFor<HostView>(host, 'host:state', (v) => v.phase === 'reveal');
    expect(await emit(p1b, 'player:answer', { questionIndex: 0, answer: 1 })).toMatchObject({ ok: true });
    expect(await emit(p1b, 'player:answer', { questionIndex: 0, answer: 2 })).toMatchObject({ ok: false });
    expect(await emit(p2, 'player:answer', { questionIndex: 0, answer: 0 })).toMatchObject({ ok: true });

    const rev = await revP;
    expect(rev.result!.correct).toBe(true);
    expect(rev.me.score).toBeGreaterThan(500);
    const hostRev = await hostRevP;
    expect(hostRev.results).toEqual({ kind: 'options', counts: [1, 1, 0] });

    // host reconnects using hostKey
    host.disconnect();
    const host2 = await sock(false);
    expect(await emit(host2, 'host:resume', { pin, hostKey: created.hostKey })).toMatchObject({ ok: true });

    await emit(host2, 'host:next', {}); // leaderboard
    const q2P = waitFor<PlayerView>(p2, 'player:state', (v) => v.phase === 'question' && v.questionIndex === 1);
    await emit(host2, 'host:next', {}); // countdown q2
    await q2P;
    await emit(p2, 'player:answer', { questionIndex: 1, answer: 0 });
    const rev2P = waitFor<HostView>(host2, 'host:state', (v) => v.phase === 'reveal' && v.questionIndex === 1);
    await emit(host2, 'host:next', {}); // skip -> reveal
    await rev2P;
    const endP = waitFor<PlayerView>(p2, 'player:state', (v) => v.phase === 'ended');
    await emit(host2, 'host:next', {}); // ended
    const end = await endP;
    expect(end.podium!.length).toBe(2);
    expect(end.podium![0]!.name).toBe('Budi'); // double points

    const reports = await api('/api/reports');
    const list = reports.body.reports as { id: string }[];
    expect(list.length).toBe(1);
    const rep = await api(`/api/reports/${list[0]!.id}`);
    expect((rep.body.report as { playerCount: number }).playerCount).toBe(2);

    for (const s of [host2, anon, p1b, p2]) s.disconnect();
  }, 30_000);

  it('runs self-paced assignments over HTTP', async () => {
    const created = await api('/api/assignments', { method: 'POST', body: JSON.stringify({ quizId, hours: 24, settings: {} }) });
    expect(created.status).toBe(201);
    const pin = created.body.pin as string;
    expect(pin).toMatch(/^\d{7}$/);
    const saved = cookie;
    cookie = '';
    expect((await api('/api/play/check', { method: 'POST', body: JSON.stringify({ pin }) })).body).toMatchObject({ title: 'Kuis E2E' });
    const j = (await api('/api/play/join', { method: 'POST', body: JSON.stringify({ pin, name: 'Siswa', avatar }) })).body as Record<string, string>;
    const auth = { pin, playerId: j.playerId, playerKey: j.playerKey };
    let v = (await api('/api/play/state', { method: 'POST', body: JSON.stringify(auth) })).body;
    expect(v).toMatchObject({ state: 'ready', questionIndex: 0 });
    // answering before starting is rejected
    expect((await api('/api/play/answer', { method: 'POST', body: JSON.stringify({ ...auth, questionIndex: 0, answer: 1 }) })).status).toBe(400);
    v = (await api('/api/play/start', { method: 'POST', body: JSON.stringify({ ...auth, questionIndex: 0 }) })).body;
    expect(v).toMatchObject({ state: 'question' });
    expect(JSON.stringify(v)).not.toContain('correct"');
    v = (await api('/api/play/answer', { method: 'POST', body: JSON.stringify({ ...auth, questionIndex: 0, answer: 1 }) })).body;
    expect(v).toMatchObject({ questionIndex: 1, state: 'ready', lastResult: { correct: true } });
    await api('/api/play/start', { method: 'POST', body: JSON.stringify({ ...auth, questionIndex: 1 }) });
    v = (await api('/api/play/answer', { method: 'POST', body: JSON.stringify({ ...auth, questionIndex: 1, answer: 1 }) })).body;
    expect(v).toMatchObject({ state: 'finished', lastResult: { correct: false } });
    expect((await api('/api/play/state', { method: 'POST', body: JSON.stringify({ ...auth, playerKey: 'x'.repeat(32) }) })).status).toBe(404);
    cookie = saved;
    const rep = await api(`/api/assignments/${created.body.id}`);
    expect(rep.body.report).toMatchObject({ playerCount: 1, mode: 'assignment' });
    expect(await api(`/api/assignments/${created.body.id}/close`, { method: 'POST', body: '{}' })).toMatchObject({ status: 200 });
    expect((await api('/api/play/check', { method: 'POST', body: JSON.stringify({ pin }) })).status).toBe(404);
  });

  it('uploads images and shares public quizzes', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    const up = await fetch(base + '/api/images', { method: 'POST', body: png, headers: { 'content-type': 'image/png', cookie } });
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    const img = await fetch(base + url);
    expect(img.headers.get('content-type')).toBe('image/png');
    const bad = await fetch(base + '/api/images', { method: 'POST', body: Buffer.from('<svg></svg>'), headers: { 'content-type': 'image/png', cookie } });
    expect(bad.status).toBe(400);

    const pub = await api('/api/quizzes', { method: 'POST', body: JSON.stringify({ ...quiz, title: 'Kuis Publik', public: true }) });
    const saved = cookie;
    cookie = '';
    expect((await api(`/api/public/quizzes/${quizId}`)).status).toBe(404); // private
    expect((await api(`/api/public/quizzes/${pub.body.id}`)).body).toMatchObject({ author: 'gurubudi' });
    expect(((await api('/api/public/quizzes?q=publik')).body.quizzes as unknown[]).length).toBe(1);
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'penyalin', password: 'rahasia123' }) });
    expect((await api(`/api/public/quizzes/${pub.body.id}/copy`, { method: 'POST', body: '{}' })).status).toBe(201);
    cookie = saved;
  });

  it('validates malformed payloads without crashing', async () => {
    const s = await sock();
    expect(await emit(s, 'player:join', { pin: 'abc', name: 'x', avatar })).toMatchObject({ ok: false });
    expect(await emit(s, 'player:join', { pin: '123456', name: 'x', avatar: { h: 99 } })).toMatchObject({ ok: false });
    expect(await emit(s, 'player:join', null)).toMatchObject({ ok: false });
    expect(await emit(s, 'player:answer', { questionIndex: -1, answer: 'a' })).toMatchObject({ ok: false });
    s.emit('host:next', 'garbage'); // no ack
    expect(await emit(s, 'player:check', { pin: '999999' })).toMatchObject({ ok: false });
    s.disconnect();
  });
});
