import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REACTIONS, type Avatar } from '../../../shared/avatar';
import type { AnswerValue, PlayerView } from '../../../shared/types';
import { ConnectionBanner, emitAck, getSocket, storage, useRemaining, useToast } from '../lib';
import { FullCenter, Spinner, Timer } from '../components/ui';
import { AvatarBuilder, AvatarSvg } from '../components/Avatar';
import { AnswerInput } from '../components/questions';
import { Confetti, MuteButton } from '../components/fx';
import { sound } from '../sound';
import { PLAYER_KEY, type PlayerSession } from './Home';

type Status = 'connecting' | 'ok' | 'gone' | 'kicked' | 'replaced';

export default function Play() {
  const navigate = useNavigate();
  const toast = useToast();
  const [session] = useState(() => storage.get<PlayerSession>(PLAYER_KEY));
  const [view, setView] = useState<PlayerView | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [pending, setPending] = useState(false);

  const resume = useCallback(async () => {
    if (!session) return;
    const r = await emitAck('player:resume', { pin: session.pin, playerId: session.playerId, playerKey: session.playerKey });
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

  useEffect(() => setPending(false), [view?.questionIndex, view?.phase]);

  // sound effects on phase changes
  const lastPhase = useRef<string>('');
  useEffect(() => {
    if (!view) return;
    const key = `${view.phase}:${view.questionIndex}`;
    if (key === lastPhase.current) return;
    lastPhase.current = key;
    if (view.phase === 'question') sound.go();
    if (view.phase === 'reveal' && view.result) {
      if (!view.result.scored) sound.pop();
      else if (view.result.correct) sound.correct();
      else sound.wrong();
      navigator.vibrate?.(view.result.correct ? [40, 60, 40] : 200);
    }
    if (view.phase === 'ended') sound.fanfare();
  }, [view]);

  async function answer(value: AnswerValue) {
    if (!view || view.answered || pending) return;
    setPending(true);
    navigator.vibrate?.(30);
    const r = await emitAck('player:answer', { questionIndex: view.questionIndex, answer: value });
    if (!r.ok) {
      setPending(false);
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
        <h2 className="center">{msg}</h2>
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

  const teamColor = view.team?.color;
  return (
    <div className="stage" onClickCapture={() => sound.unlock()}>
      <ConnectionBanner />
      {view.team && (
        <div className="team-strip" style={{ background: teamColor }}>
          {view.team.name} · #{view.team.rank} · {view.team.score.toLocaleString('id-ID')}
        </div>
      )}
      <PlayerBody view={view} pending={pending} onAnswer={answer} onLeave={leave} />
      <div className="stage-bar">
        <AvatarSvg avatar={view.me.avatar} size={38} />
        <b className="ellipsis">{view.me.name}</b>
        <div className="spacer" />
        {view.questionIndex >= 0 && view.phase !== 'ended' && (
          <span className="muted">{view.questionIndex + 1}/{view.questionCount}</span>
        )}
        <MuteButton />
        <span className="pill">{view.me.score.toLocaleString('id-ID')}</span>
      </div>
    </div>
  );
}

function ReactionBar() {
  const [cool, setCool] = useState(false);
  const send = async (e: number) => {
    if (cool) return;
    setCool(true);
    setTimeout(() => setCool(false), 800);
    sound.pop();
    await emitAck('player:react', { e });
  };
  return (
    <div className="reaction-bar" role="group" aria-label="Kirim reaksi">
      {REACTIONS.map((r, i) => (
        <button key={i} disabled={cool} onClick={() => send(i)} aria-label={`Reaksi ${r}`}>
          {r}
        </button>
      ))}
    </div>
  );
}

function LobbyPanel({ view, onLeave }: { view: PlayerView; onLeave(): void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Avatar>(view.me.avatar);
  const reroll = async () => {
    const r = await emitAck<{ name: string }>('player:reroll');
    if (!r.ok) toast(r.error, true);
    else sound.pop();
  };
  const saveAvatar = async () => {
    const r = await emitAck('player:avatar', { avatar: draft });
    if (!r.ok) return toast(r.error, true);
    storage.set('gk_avatar', draft);
    setEditing(false);
  };
  if (editing) {
    return (
      <main className="stage-main">
        <div className="card join-box wide">
          <AvatarBuilder value={draft} onChange={setDraft} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setEditing(false)}>Batal</button>
            <button className="btn" style={{ flex: 1 }} onClick={saveAvatar}>Simpan</button>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="stage-main center">
      <AvatarSvg avatar={view.me.avatar} size={150} anim="dance" />
      <h1 style={{ margin: 0 }}>{view.me.name}</h1>
      <p className="muted" style={{ fontSize: 18, margin: 0 }}>Kamu sudah masuk! Lihat namamu di layar host 🎉</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn secondary sm" onClick={() => { setDraft(view.me.avatar); setEditing(true); }}>✏️ Ubah karakter</button>
        {view.nameGenerator && view.me.rerollsLeft > 0 && (
          <button className="btn secondary sm" onClick={reroll}>🎲 Ganti nama ({view.me.rerollsLeft})</button>
        )}
      </div>
      <p className="pill">{view.playerCount} pemain</p>
      <ReactionBar />
      <button className="btn ghost sm" onClick={onLeave}>Keluar dari game</button>
    </main>
  );
}

function PlayerBody({ view, pending, onAnswer, onLeave }: { view: PlayerView; pending: boolean; onAnswer(a: AnswerValue): void; onLeave(): void }) {
  const remaining = useRemaining(view.deadline);

  switch (view.phase) {
    case 'lobby':
      return <LobbyPanel view={view} onLeave={onLeave} />;

    case 'countdown':
      return (
        <main className="stage-main center">
          <p className="muted">Pertanyaan {view.questionIndex + 1} dari {view.questionCount}</p>
          {view.question?.text ? <h1 className="q-text">{view.question.text}</h1> : <h1 className="q-text">Bersiap!</h1>}
          {view.question?.points === 'double' && <span className="pill big-pill">⚡ Poin ganda!</span>}
          <div className="countdown-ring">{remaining}</div>
        </main>
      );

    case 'question': {
      const q = view.question!;
      if (view.answered || pending) {
        return (
          <main className="stage-main center">
            <AvatarSvg avatar={view.me.avatar} size={120} anim="bob" />
            <h2>Jawaban terkirim!</h2>
            <p className="muted">Kira-kira benar nggak ya… 🤔</p>
          </main>
        );
      }
      return (
        <main className="stage-main" style={{ justifyContent: 'flex-start' }}>
          <div className="row" style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <p className="q-small">{q.text ?? 'Lihat pertanyaan di layar host 👀'}</p>
            <Timer seconds={remaining} />
          </div>
          {q.image && <img className="q-image small" src={q.image} alt="" referrerPolicy="no-referrer" />}
          <AnswerInput q={q} onSubmit={onAnswer} />
        </main>
      );
    }

    case 'reveal': {
      const r = view.result;
      if (r && !r.scored) {
        return (
          <main className="stage-main center result-wait">
            <AvatarSvg avatar={view.me.avatar} size={130} mood="happy" anim="bob" />
            <div className="result-banner">{r.answered ? 'Terima kasih! 🙌' : 'Jawaban tidak terkirim'}</div>
            <p className="muted">Lihat hasilnya di layar host</p>
            <ReactionBar />
          </main>
        );
      }
      const cls = !r?.answered ? 'result-wait' : r.correct ? 'result-ok' : 'result-bad';
      return (
        <main className={`stage-main center ${cls}`}>
          <AvatarSvg avatar={view.me.avatar} size={130} mood={r?.correct ? 'happy' : 'sad'} anim={r?.correct ? 'jump' : 'shake'} />
          <div className="result-banner">{!r?.answered ? 'Waktu habis ⏰' : r.correct ? 'Benar! ✅' : 'Salah ❌'}</div>
          {r?.correct ? (
            <span className="pill big-pill">+{r.points.toLocaleString('id-ID')}</span>
          ) : (
            r?.correctText && <p style={{ fontSize: 18, margin: 0 }}>Jawaban benar: <b>{r.correctText}</b></p>
          )}
          {view.me.streak >= 2 && <span className="pill">🔥 Streak {view.me.streak} jawaban!</span>}
          <p style={{ fontSize: 18, margin: 0 }}>
            Peringkat <b>#{view.me.rank}</b>
            {view.behind && view.behind.gap > 0 && <> · {view.behind.gap.toLocaleString('id-ID')} poin di belakang <b>{view.behind.name}</b></>}
          </p>
          <ReactionBar />
        </main>
      );
    }

    case 'leaderboard':
      return (
        <main className="stage-main center">
          <AvatarSvg avatar={view.me.avatar} size={110} anim="bob" />
          <p className="muted" style={{ margin: 0 }}>Peringkatmu</p>
          <div className="result-banner">#{view.me.rank}</div>
          <p style={{ fontSize: 20, margin: 0 }}>{view.me.score.toLocaleString('id-ID')} poin</p>
          {view.behind && view.behind.gap > 0 && (
            <p className="muted" style={{ margin: 0 }}>Kejar <b>{view.behind.name}</b> — selisih {view.behind.gap.toLocaleString('id-ID')} poin!</p>
          )}
          {view.me.rank === 1 && <p className="pill">👑 Kamu memimpin!</p>}
          <ReactionBar />
        </main>
      );

    case 'ended': {
      const rank = view.me.rank;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
      return (
        <main className="stage-main center">
          {rank <= 3 && <Confetti count={80} />}
          <AvatarSvg avatar={view.me.avatar} size={150} mood={rank <= 3 ? 'happy' : 'neutral'} anim={rank <= 3 ? 'dance' : 'bob'} />
          <p className="muted" style={{ margin: 0 }}>Game selesai!</p>
          <div className="result-banner">{medal ? `${medal} Juara ${rank}!` : `Peringkat #${rank}`}</div>
          <p style={{ fontSize: 20, margin: 0 }}>{view.me.score.toLocaleString('id-ID')} poin</p>
          {view.team && <p className="pill" style={{ background: view.team.color }}>{view.team.name}: peringkat tim #{view.team.rank}</p>}
          <button className="btn big" onClick={onLeave}>Main lagi</button>
        </main>
      );
    }
  }
}
