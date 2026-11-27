import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { HostView, RankEntry } from '../../../shared/types';
import { ConnectionBanner, emitAck, getSocket, storage, useRemaining, useToast } from '../lib';
import { FullCenter, Shape, Spinner, Timer } from '../components/ui';

const hostKeyFor = (pin: string) => `gk_host_${pin}`;

export default function Host() {
  const { pin: routePin } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<HostView | null>(null);
  const [fatal, setFatal] = useState('');
  const creating = useRef(false);
  const pin = routePin !== 'new' ? routePin! : null;

  const resume = useCallback(async () => {
    if (!pin) return;
    const hostKey = storage.get<string>(hostKeyFor(pin));
    if (!hostKey) return setFatal('Sesi host untuk game ini tidak ditemukan di perangkat ini.');
    const r = await emitAck('host:resume', { pin, hostKey });
    if (!r.ok && getSocket().connected) {
      storage.remove(hostKeyFor(pin));
      setFatal(r.error);
    }
  }, [pin]);

  // create a new game
  useEffect(() => {
    if (pin || creating.current) return;
    const quizId = params.get('quiz');
    if (!quizId) return setFatal('Kuis tidak dipilih.');
    creating.current = true;
    void emitAck<{ pin: string; hostKey: string }>('host:create', { quizId }, 10000).then((r) => {
      if (!r.ok) return setFatal(r.error);
      storage.set(hostKeyFor(r.pin), r.hostKey);
      navigate(`/host/${r.pin}`, { replace: true });
    });
  }, [pin, params, navigate]);

  useEffect(() => {
    const s = getSocket();
    const onState = (v: HostView) => setView(v);
    const onClosed = () => setFatal('Game sudah ditutup.');
    s.on('host:state', onState);
    s.on('game:closed', onClosed);
    if (pin) {
      s.on('connect', resume);
      if (s.connected) void resume();
    }
    return () => {
      s.off('host:state', onState);
      s.off('game:closed', onClosed);
      s.off('connect', resume);
    };
  }, [pin, resume]);

  const act = async (event: string, data: unknown = {}) => {
    const r = await emitAck(event, data);
    if (!r.ok) toast(r.error, true);
  };

  if (fatal) {
    return (
      <FullCenter>
        <h2 className="center">{fatal}</h2>
        <Link className="btn big" to="/dashboard">Ke dashboard</Link>
      </FullCenter>
    );
  }
  if (!view || view.pin !== pin) {
    return (
      <FullCenter>
        <ConnectionBanner />
        <Spinner />
        <p className="muted">Menyiapkan game…</p>
      </FullCenter>
    );
  }

  return (
    <div className="stage">
      <ConnectionBanner />
      <div className="stage-bar">
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40vw' }}>{view.title}</b>
        {view.phase !== 'lobby' && <span className="pill">PIN {view.pin}</span>}
        <div className="spacer" />
        <span className="muted">👥 {view.playerCount}</span>
        <button className="btn secondary sm" onClick={() => toggleFullscreen()}>⛶ Layar penuh</button>
        {view.phase !== 'ended' && (
          <button className="btn secondary sm" onClick={() => confirm('Akhiri game sekarang?') && act('host:end')}>Akhiri</button>
        )}
      </div>
      <HostBody view={view} act={act} />
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function HostBody({ view, act }: { view: HostView; act(e: string, d?: unknown): Promise<void> }) {
  const remaining = useRemaining(view.deadline);
  const q = view.question;
  const isLast = view.questionIndex >= view.questionCount - 1;

  switch (view.phase) {
    case 'lobby':
      return <Lobby view={view} act={act} />;

    case 'countdown':
      return (
        <main className="stage-main center">
          <p className="muted" style={{ fontSize: 20 }}>Pertanyaan {view.questionIndex + 1} dari {view.questionCount}</p>
          <h1 className="q-text">{q?.text}</h1>
          {q?.points === 'double' && <span className="pill">⚡ Poin ganda!</span>}
          <Timer seconds={remaining} />
        </main>
      );

    case 'question':
    case 'reveal': {
      const revealed = view.phase === 'reveal';
      const dist = view.distribution;
      const max = Math.max(1, ...(dist ?? [1]));
      return (
        <main className="stage-main">
          <h1 className="q-text">{q!.text}</h1>
          <div className="row" style={{ width: '100%', maxWidth: 1100, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            {revealed ? <div style={{ width: 86 }} /> : <Timer seconds={remaining} />}
            {q!.image ? <img className="q-image" src={q!.image} alt="" referrerPolicy="no-referrer" /> : revealed && dist ? (
              <div className="bars" aria-label="Distribusi jawaban">
                {dist.map((n, i) => (
                  <div key={i} className="bar" style={{ height: `${(n / max) * 100}%`, background: `var(--opt-${i})`, opacity: q!.correct.includes(i) ? 1 : 0.4 }}>{n}</div>
                ))}
              </div>
            ) : <div />}
            <div className="center" style={{ minWidth: 86 }}>
              <div style={{ fontSize: 40, fontWeight: 800 }}>{view.answeredCount}</div>
              <div className="muted">jawaban</div>
            </div>
          </div>
          <div className="options">
            {q!.options.map((o, i) => {
              const correct = q!.correct.includes(i);
              return (
                <div key={i} className={`opt o${i} ${revealed && !correct ? 'dim' : ''}`}>
                  <Shape index={i} />
                  <span>{o}</span>
                  {revealed && (correct ? <span className="tick">✓</span> : null)}
                  {revealed && dist && !correct && <span className="count">{dist[i]}</span>}
                </div>
              );
            })}
          </div>
          <div className="row">
            {revealed ? (
              <button className="btn big" onClick={() => act('host:next')} autoFocus>
                {isLast ? 'Lihat juara 🏆' : 'Lanjut →'}
              </button>
            ) : (
              <button className="btn secondary" onClick={() => act('host:next')}>Lewati waktu</button>
            )}
          </div>
        </main>
      );
    }

    case 'leaderboard':
      return (
        <main className="stage-main">
          <h1>Papan Skor</h1>
          <Leaderboard rows={view.players.slice(0, 5)} />
          <button className="btn big" onClick={() => act('host:next')} autoFocus>Pertanyaan berikutnya →</button>
        </main>
      );

    case 'ended':
      return <Podium view={view} />;
  }
}

function Lobby({ view, act }: { view: HostView; act(e: string, d?: unknown): Promise<void> }) {
  const [qr, setQr] = useState('');
  const joinUrl = `${location.origin}/?pin=${view.pin}`;
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 300 }).then(setQr).catch(() => setQr(''));
  }, [joinUrl]);
  const copy = () => navigator.clipboard?.writeText(joinUrl).catch(() => {});

  return (
    <main className="stage-main" style={{ justifyContent: 'flex-start' }}>
      <div className="pin-panel">
        <div>
          <div style={{ fontWeight: 700 }}>
            Buka <b style={{ color: 'var(--brand)' }}>{location.host}</b> dan masukkan PIN:
          </div>
          <div className="big-pin">{view.pin}</div>
          <button className="btn ghost sm" style={{ marginTop: 8, color: '#1d1535' }} onClick={copy}>Salin link gabung</button>
        </div>
        {qr && <img src={qr} alt={`QR code untuk gabung game ${view.pin}`} />}
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <span className="pill" style={{ fontSize: 20 }}>👥 {view.playerCount} pemain</span>
        <button className="btn secondary" onClick={() => act('host:lock', { locked: !view.locked })}>
          {view.locked ? '🔒 Terkunci' : '🔓 Kunci game'}
        </button>
        <button className="btn big" disabled={view.playerCount === 0} onClick={() => act('host:next')}>
          Mulai ▶
        </button>
      </div>

      {view.playerCount === 0 ? (
        <p className="muted" style={{ fontSize: 20 }}>Menunggu pemain bergabung…</p>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Klik nama untuk mengeluarkan pemain</p>
          <div className="chips">
            {view.players
              .slice()
              .reverse()
              .map((p) => (
                <button
                  key={p.id}
                  className={`chip ${p.connected ? '' : 'off'}`}
                  title={p.connected ? 'Keluarkan' : 'Terputus — keluarkan'}
                  onClick={() => confirm(`Keluarkan ${p.name}?`) && act('host:kick', { playerId: p.id })}
                >
                  {p.name}
                </button>
              ))}
          </div>
        </>
      )}
    </main>
  );
}

function Leaderboard({ rows }: { rows: RankEntry[] }) {
  return (
    <div className="leader">
      {rows.map((p, i) => (
        <div key={p.id} className="leader-row" style={{ animationDelay: `${i * 80}ms` }}>
          <span className="rank">{p.rank}</span>
          <span style={{ overflowWrap: 'anywhere' }}>{p.name}</span>
          {p.streak >= 2 && <span title="Streak">🔥{p.streak}</span>}
          {p.delta > 0 && <span className="delta">+{p.delta}</span>}
          <span className="score">{p.score.toLocaleString('id-ID')}</span>
        </div>
      ))}
    </div>
  );
}

function Podium({ view }: { view: HostView }) {
  const top = view.players.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const heights = [140, 200, 100];
  const places = [2, 1, 3];
  return (
    <main className="stage-main">
      <h1 style={{ fontSize: 40 }}>🏆 Juara</h1>
      {top.length === 0 ? (
        <p className="muted">Tidak ada pemain.</p>
      ) : (
        <div className="podium">
          {order.map((p, i) =>
            p ? (
              <div key={p.id} className="step" style={{ animationDelay: `${[400, 900, 0][i]}ms` }}>
                <div className="name">{p.name}</div>
                <div className="pts">{p.score.toLocaleString('id-ID')}</div>
                <div className="block" style={{ height: heights[i] }}>{places[i]}</div>
              </div>
            ) : (
              <div key={i} className="step" />
            ),
          )}
        </div>
      )}
      {view.players.length > 3 && <Leaderboard rows={view.players.slice(3, 10)} />}
      <div className="row">
        <Link className="btn big" to="/dashboard">Ke dashboard</Link>
      </div>
      <p className="muted">Laporan lengkap tersimpan di tab Laporan pada dashboard.</p>
    </main>
  );
}
