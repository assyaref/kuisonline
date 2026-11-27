import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlayerView } from '../../../shared/types';
import { ConnectionBanner, emitAck, getSocket, storage, useRemaining, useToast } from '../lib';
import { FullCenter, Shape, Spinner, Timer } from '../components/ui';
import { PLAYER_KEY, type PlayerSession } from './Home';

type Status = 'connecting' | 'ok' | 'gone' | 'kicked' | 'replaced';

export default function Play() {
  const navigate = useNavigate();
  const toast = useToast();
  const [session] = useState(() => storage.get<PlayerSession>(PLAYER_KEY));
  const [view, setView] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [pending, setPending] = useState<number | null>(null);

  const resume = useCallback(async () => {
    if (!session) return;
    const r = await emitAck('player:resume', {
      pin: session.pin,
      playerId: session.playerId,
      playerKey: session.playerKey,
    });
    if (r.ok) setStatus('ok');
    else if (getSocket().connected) {
      storage.remove(PLAYER_KEY);
      setStatus('gone');
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      navigate('/', { replace: true });
      return;
    }
    const s = getSocket();
    const onState = (v: PlayerView) => setView(v);
    const onKicked = () => {
      storage.remove(PLAYER_KEY);
      setStatus('kicked');
    };
    const onClosed = () => {
      storage.remove(PLAYER_KEY);
      setStatus('gone');
    };
    const onReplaced = () => setStatus('replaced');
    s.on('player:state', onState);
    s.on('kicked', onKicked);
    s.on('game:closed', onClosed);
    s.on('session:replaced', onReplaced);
    s.on('connect', resume);
    if (s.connected) void resume();
    return () => {
      s.off('player:state', onState);
      s.off('kicked', onKicked);
      s.off('game:closed', onClosed);
      s.off('session:replaced', onReplaced);
      s.off('connect', resume);
    };
  }, [session, navigate, resume]);

  // reset optimistic answer when question changes
  useEffect(() => setPending(null), [view?.questionIndex, view?.phase]);

  async function answer(choice: number) {
    if (!view || view.myAnswer !== null || pending !== null) return;
    setPending(choice);
    navigator.vibrate?.(30);
    const r = await emitAck('player:answer', { questionIndex: view.questionIndex, choice });
    if (!r.ok) {
      setPending(null);
      toast(r.error, true);
    }
  }

  function leave() {
    void emitAck('player:leave');
    storage.remove(PLAYER_KEY);
    navigate('/');
  }

  if (status === 'kicked' || status === 'gone' || status === 'replaced') {
    const msg =
      status === 'kicked'
        ? 'Kamu dikeluarkan dari game oleh host.'
        : status === 'replaced'
          ? 'Game ini dibuka di tab atau perangkat lain.'
          : 'Game sudah ditutup atau tidak ditemukan.';
    return (
      <FullCenter>
        <h2>{msg}</h2>
        {status === 'replaced' ? (
          <button className="btn big" onClick={() => { setStatus('connecting'); void resume(); }}>Main di sini</button>
        ) : (
          <button className="btn big" onClick={() => navigate('/')}>Kembali ke beranda</button>
        )}
      </FullCenter>
    );
  }

  if (!view || !session) {
    return (
      <FullCenter>
        <ConnectionBanner />
        <Spinner />
        <p className="muted">Menyambungkan…</p>
      </FullCenter>
    );
  }

  return (
    <div className="stage">
      <ConnectionBanner />
      <PlayerBody view={view} pending={pending} onAnswer={answer} onLeave={leave} />
      <div className="stage-bar">
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{view.me.name}</b>
        <div className="spacer" />
        {view.questionIndex >= 0 && view.phase !== 'ended' && (
          <span className="muted">
            {view.questionIndex + 1}/{view.questionCount}
          </span>
        )}
        <span className="pill">{view.me.score.toLocaleString('id-ID')}</span>
      </div>
    </div>
  );
}

function PlayerBody({
  view,
  pending,
  onAnswer,
  onLeave,
}: {
  view: PlayerView;
  pending: number | null;
  onAnswer(i: number): void;
  onLeave(): void;
}) {
  const remaining = useRemaining(view.deadline);
  const chosen = view.myAnswer ?? pending;

  switch (view.phase) {
    case 'lobby':
      return (
        <main className="stage-main center">
          <h1>Kamu sudah masuk! 🎉</h1>
          <p className="muted" style={{ fontSize: 18 }}>
            Lihat namamu di layar host. Tunggu game dimulai…
          </p>
          <p className="pill">{view.playerCount} pemain</p>
          <button className="btn ghost sm" onClick={onLeave}>
            Keluar dari game
          </button>
        </main>
      );

    case 'countdown':
      return (
        <main className="stage-main center">
          <p className="muted">Pertanyaan {view.questionIndex + 1}</p>
          <h1 className="q-text">{view.question?.text}</h1>
          {view.question?.points === 'double' && <span className="pill">⚡ Poin ganda!</span>}
          <Timer seconds={remaining} />
        </main>
      );

    case 'question': {
      const q = view.question!;
      if (chosen !== null) {
        return (
          <main className="stage-main center">
            <Spinner />
            <h2>Jawaban terkirim!</h2>
            <p className="muted">Menunggu pemain lain…</p>
          </main>
        );
      }
      return (
        <main className="stage-main" style={{ justifyContent: 'flex-start' }}>
          <div className="row" style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 18, overflowWrap: 'anywhere' }}>{q.text}</p>
            <Timer seconds={remaining} />
          </div>
          <div className="options player-options">
            {q.options.map((o, i) => (
              <button key={i} className={`opt o${i}`} onClick={() => onAnswer(i)} aria-label={`Jawaban ${i + 1}: ${o}`}>
                <Shape index={i} />
                <span>{o}</span>
              </button>
            ))}
          </div>
        </main>
      );
    }

    case 'reveal': {
      const r = view.result;
      const cls = !r?.answered ? 'result-wait' : r.correct ? 'result-ok' : 'result-bad';
      return (
        <main className={`stage-main center ${cls}`}>
          <div className="result-banner">{!r?.answered ? 'Waktu habis ⏰' : r.correct ? 'Benar! ✅' : 'Salah ❌'}</div>
          {r?.correct ? (
            <span className="pill" style={{ fontSize: 22 }}>+{r.points.toLocaleString('id-ID')}</span>
          ) : (
            view.question && (
              <p style={{ fontSize: 18 }}>
                Jawaban benar: <b>{r?.correctOptions.map((i) => view.question!.options[i]).join(', ')}</b>
              </p>
            )
          )}
          {view.me.streak >= 2 && <span className="pill">🔥 Streak {view.me.streak}</span>}
          <p style={{ fontSize: 18 }}>Kamu di peringkat <b>#{view.me.rank}</b></p>
        </main>
      );
    }

    case 'leaderboard':
      return (
        <main className="stage-main center">
          <p className="muted">Peringkatmu</p>
          <div className="result-banner">#{view.me.rank}</div>
          <p style={{ fontSize: 20 }}>{view.me.score.toLocaleString('id-ID')} poin</p>
          <p className="muted">Bersiap untuk pertanyaan berikutnya…</p>
        </main>
      );

    case 'ended': {
      const rank = view.me.rank;
      return (
        <main className="stage-main center">
          <p className="muted">Game selesai!</p>
          <div className="result-banner">{rank === 1 ? '🏆 Juara 1!' : rank <= 3 ? `🥈 Juara ${rank}!` : `#${rank}`}</div>
          <p style={{ fontSize: 20 }}>{view.me.score.toLocaleString('id-ID')} poin</p>
          <button className="btn big" onClick={onLeave}>
            Main lagi
          </button>
        </main>
      );
    }
  }
}
