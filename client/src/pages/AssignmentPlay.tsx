import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Avatar } from '../../../shared/avatar';
import type { AnswerValue, PlayerQuestion, PlayerResult } from '../../../shared/types';
import { api, ApiError, storage, useToast } from '../lib';
import { FullCenter, Spinner, Timer } from '../components/ui';
import { AvatarSvg } from '../components/Avatar';
import { AnswerInput } from '../components/questions';
import { Confetti, MuteButton } from '../components/fx';
import { sound } from '../sound';
import { ASSIGN_KEY, type PlayerSession } from './Home';

interface View {
  title: string;
  deadline: number;
  open: boolean;
  serverNow: number;
  me: { name: string; avatar: Avatar; score: number; rank: number; streak: number };
  playerCount: number;
  questionIndex: number;
  questionCount: number;
  state: 'ready' | 'question' | 'finished';
  question: PlayerQuestion | null;
  questionDeadline: number | null;
  lastResult: PlayerResult | null;
}

export default function AssignmentPlay() {
  const navigate = useNavigate();
  const toast = useToast();
  const [session] = useState(() => storage.get<PlayerSession>(ASSIGN_KEY));
  const [view, setView] = useState<View | null>(null);
  const [offset, setOffset] = useState(0);
  const [showResult, setShowResult] = useState<PlayerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const auth = session ? { pin: session.pin, playerId: session.playerId, playerKey: session.playerKey } : null;

  const apply = useCallback((v: View) => {
    setOffset(v.serverNow - Date.now());
    setView(v);
    if (v.lastResult) {
      setShowResult(v.lastResult);
      if (!v.lastResult.scored) sound.pop();
      else if (v.lastResult.correct) sound.correct();
      else sound.wrong();
    }
  }, []);

  const call = useCallback(
    async (path: string, extra: object = {}) => {
      if (!auth) return;
      setBusy(true);
      try {
        apply(await api<View>(path, { method: 'POST', body: { ...auth, ...extra } }));
        setError('');
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          storage.remove(ASSIGN_KEY);
          setError('Tugas tidak ditemukan atau sudah ditutup.');
        } else toast((e as Error).message, true);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );

  useEffect(() => {
    if (!session) navigate('/', { replace: true });
    else void call('/play/state');
  }, [session, navigate, call]);

  // timer for the current question
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (view?.state !== 'question') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [view?.state, view?.questionIndex]);
  const remaining = view?.questionDeadline ? Math.max(0, Math.ceil((view.questionDeadline - (now + offset)) / 1000)) : 0;
  const expiredRef = useRef(-1);
  useEffect(() => {
    if (view?.state === 'question' && remaining === 0 && expiredRef.current !== view.questionIndex) {
      expiredRef.current = view.questionIndex;
      const t = setTimeout(() => void call('/play/state'), 1800); // server records the miss after the grace period
      return () => clearTimeout(t);
    }
  }, [remaining, view, call]);

  if (error) {
    return (
      <FullCenter>
        <h2 className="center">{error}</h2>
        <button className="btn big" onClick={() => navigate('/')}>Kembali ke beranda</button>
      </FullCenter>
    );
  }
  if (!view) {
    return (
      <FullCenter>
        <Spinner />
      </FullCenter>
    );
  }

  const answer = (a: AnswerValue) => {
    if (busy) return;
    navigator.vibrate?.(30);
    void call('/play/answer', { questionIndex: view.questionIndex, answer: a });
  };

  let body;
  if (showResult && view.state !== 'question') {
    const r = showResult;
    const cls = !r.scored ? 'result-wait' : !r.answered ? 'result-wait' : r.correct ? 'result-ok' : 'result-bad';
    body = (
      <main className={`stage-main center ${cls}`}>
        <AvatarSvg avatar={view.me.avatar} size={130} mood={!r.scored ? 'happy' : r.correct ? 'happy' : 'sad'} anim={r.correct ? 'jump' : 'shake'} />
        <div className="result-banner">{!r.scored ? 'Terkirim! 🙌' : !r.answered ? 'Waktu habis ⏰' : r.correct ? 'Benar! ✅' : 'Salah ❌'}</div>
        {r.correct && r.points > 0 && <span className="pill big-pill">+{r.points.toLocaleString('id-ID')}</span>}
        {!r.correct && r.correctText && <p style={{ fontSize: 18 }}>Jawaban benar: <b>{r.correctText}</b></p>}
        {view.me.streak >= 2 && <span className="pill">🔥 Streak {view.me.streak}</span>}
        <button className="btn big" onClick={() => { sound.unlock(); setShowResult(null); }} autoFocus>Lanjut →</button>
      </main>
    );
  } else if (view.state === 'finished') {
    const top3 = view.me.rank <= 3;
    body = (
      <main className="stage-main center">
        {top3 && <Confetti count={80} />}
        <AvatarSvg avatar={view.me.avatar} size={150} mood="happy" anim="dance" />
        <h1 style={{ margin: 0 }}>{view.open ? 'Tugas selesai! 🎉' : 'Tugas sudah ditutup'}</h1>
        <div className="result-banner">{view.me.score.toLocaleString('id-ID')} poin</div>
        <p style={{ fontSize: 18 }}>Peringkat sementara <b>#{view.me.rank}</b> dari {view.playerCount} pemain</p>
        <button className="btn big" onClick={() => { storage.remove(ASSIGN_KEY); navigate('/'); }}>Selesai</button>
      </main>
    );
  } else if (view.state === 'ready') {
    body = (
      <main className="stage-main center">
        <AvatarSvg avatar={view.me.avatar} size={120} anim="bob" />
        <p className="muted" style={{ margin: 0 }}>{view.title}</p>
        <h1 style={{ margin: 0 }}>Pertanyaan {view.questionIndex + 1} dari {view.questionCount}</h1>
        <p className="muted">Timer mulai berjalan saat kamu menekan tombol di bawah.</p>
        <button className="btn big" disabled={busy} onClick={() => { sound.unlock(); sound.go(); void call('/play/start', { questionIndex: view.questionIndex }); }}>
          Mulai ▶
        </button>
        <p className="muted" style={{ fontSize: 13 }}>Batas tugas: {new Date(view.deadline).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      </main>
    );
  } else {
    const q = view.question!;
    body = (
      <main className="stage-main" style={{ justifyContent: 'flex-start' }}>
        <div className="row" style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <p className="q-small">{q.text}</p>
          <Timer seconds={remaining} />
        </div>
        {q.image && <img className="q-image small" src={q.image} alt="" referrerPolicy="no-referrer" />}
        {remaining > 0 && !busy ? <AnswerInput q={q} onSubmit={answer} /> : <Spinner />}
      </main>
    );
  }

  return (
    <div className="stage">
      {body}
      <div className="stage-bar">
        <AvatarSvg avatar={view.me.avatar} size={38} />
        <b className="ellipsis">{view.me.name}</b>
        <div className="spacer" />
        <span className="muted">{Math.min(view.questionIndex + 1, view.questionCount)}/{view.questionCount}</span>
        <MuteButton />
        <span className="pill">{view.me.score.toLocaleString('id-ID')}</span>
      </div>
    </div>
  );
}
