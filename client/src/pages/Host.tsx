import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { Avatar } from '../../../shared/avatar';
import { REACTIONS } from '../../../shared/avatar';
import { DEFAULT_SETTINGS, QUESTION_TYPE_LABEL, type GameSettings } from '../../../shared/schema';
import type { HostView, RankEntry } from '../../../shared/types';
import { ConnectionBanner, emitAck, getSocket, storage, useRemaining, useToast } from '../lib';
import { FullCenter, Spinner, Timer } from '../components/ui';
import { AvatarSvg } from '../components/Avatar';
import { HostQuestionBody, HostResults } from '../components/questions';
import { AnimatedLeaderboard, Confetti, FloatingReactions, MuteButton, TeamBoard, type FloatingReaction } from '../components/fx';
import { sound } from '../sound';

const hostKeyFor = (pin: string) => `gk_host_${pin}`;
const SETTINGS_KEY = 'gk_settings';

export default function Host() {
  const { pin: routePin } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<HostView | null>(null);
  const [fatal, setFatal] = useState('');
  const [creating, setCreating] = useState(false);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
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

  async function create(settings: GameSettings) {
    const quizId = params.get('quiz');
    if (!quizId) return setFatal('Kuis tidak dipilih.');
    sound.unlock();
    storage.set(SETTINGS_KEY, settings);
    setCreating(true);
    const r = await emitAck<{ pin: string; hostKey: string }>('host:create', { quizId, settings }, 10000);
    setCreating(false);
    if (!r.ok) return setFatal(r.error);
    storage.set(hostKeyFor(r.pin), r.hostKey);
    navigate(`/host/${r.pin}`, { replace: true });
  }

  useEffect(() => {
    const s = getSocket();
    const onState = (v: HostView) => setView(v);
    const onClosed = () => setFatal('Game sudah ditutup.');
    let rid = 0;
    const onReaction = (r: { e: number; avatar?: Avatar }) => {
      const id = ++rid + Date.now();
      sound.pop();
      setReactions((list) => [...list.slice(-30), { id, e: REACTIONS[r.e] ?? '👍', x: 5 + Math.random() * 85, avatar: r.avatar }]);
      setTimeout(() => setReactions((list) => list.filter((x) => x.id !== id)), 3200);
    };
    s.on('host:state', onState);
    s.on('game:closed', onClosed);
    s.on('host:reaction', onReaction);
    if (pin) {
      s.on('connect', resume);
      if (s.connected) void resume();
    }
    return () => {
      s.off('host:state', onState);
      s.off('game:closed', onClosed);
      s.off('host:reaction', onReaction);
      s.off('connect', resume);
    };
  }, [pin, resume]);

  useEffect(() => () => sound.stop(), []);

  const act = async (event: string, data: unknown = {}) => {
    sound.unlock();
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
  if (!pin) return <SettingsScreen busy={creating} onCreate={create} />;
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
    <div className="stage" onClickCapture={() => sound.unlock()}>
      <ConnectionBanner />
      <HostAudio view={view} />
      <FloatingReactions items={reactions} />
      <div className="stage-bar">
        <b className="ellipsis" style={{ maxWidth: '40vw' }}>{view.title}</b>
        {view.phase !== 'lobby' && <span className="pill">PIN {view.pin}</span>}
        <div className="spacer" />
        <span className="muted">👥 {view.playerCount}</span>
        <MuteButton />
        <button className="btn secondary sm" onClick={toggleFullscreen} aria-label="Layar penuh">⛶</button>
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

/** Drives music and sound effects from game state. */
function HostAudio({ view }: { view: HostView }) {
  const remaining = useRemaining(view.phase === 'question' || view.phase === 'countdown' ? view.deadline : null);
  const prev = useRef({ phase: '', count: view.playerCount, q: -1 });
  useEffect(() => {
    if (!view.settings.music) return sound.stop();
    if (view.phase === 'lobby') sound.play('lobby');
    else if (view.phase === 'question') sound.play('question');
    else if (view.phase === 'leaderboard') sound.play('lobby');
    else sound.stop();
  }, [view.phase, view.settings.music]);
  useEffect(() => {
    const p = prev.current;
    if (view.phase !== p.phase || view.questionIndex !== p.q) {
      if (view.phase === 'reveal' && p.phase === 'question') sound.timeUp();
      if (view.phase === 'question') sound.go();
      if (view.phase === 'leaderboard') sound.whoosh();
    }
    if (view.phase === 'lobby' && view.playerCount > p.count) sound.join();
    prev.current = { phase: view.phase, count: view.playerCount, q: view.questionIndex };
  }, [view.phase, view.playerCount, view.questionIndex]);
  useEffect(() => {
    if (view.phase === 'question' && remaining > 0 && remaining <= 5) sound.tick(true);
    if (view.phase === 'countdown' && remaining > 0) sound.tick(false);
  }, [remaining, view.phase]);
  return null;
}

function SettingsScreen({ busy, onCreate }: { busy: boolean; onCreate(s: GameSettings): void }) {
  const [s, setS] = useState<GameSettings>(() => ({ ...DEFAULT_SETTINGS, ...(storage.get<Partial<GameSettings>>(SETTINGS_KEY) ?? {}) }));
  const set = (patch: Partial<GameSettings>) => setS({ ...s, ...patch });
  const Toggle = ({ k, label, hint }: { k: keyof GameSettings; label: string; hint: string }) => (
    <label className="toggle-row">
      <input type="checkbox" checked={!!s[k]} onChange={(e) => set({ [k]: e.target.checked })} />
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </label>
  );
  return (
    <div className="stage">
      <main className="stage-main">
        <h1>Pilih mode permainan</h1>
        <div className="mode-cards">
          <button className={`mode-card ${!s.teamMode ? 'active' : ''}`} onClick={() => set({ teamMode: false })}>
            <div className="mode-avatars">
              <AvatarSvg avatar={{ h: 0, c: 3, r: 1, e: 1, m: 0, a: 0, p: 1 }} size={70} anim="bob" />
            </div>
            <b>Klasik</b>
            <small>Pemain vs pemain, masing-masing pakai perangkat sendiri</small>
          </button>
          <button className={`mode-card ${s.teamMode ? 'active' : ''}`} onClick={() => set({ teamMode: true })}>
            <div className="mode-avatars">
              <AvatarSvg avatar={{ h: 1, c: 4, r: 5, e: 4, m: 4, a: 0, p: 0 }} size={56} anim="bob" />
              <AvatarSvg avatar={{ h: 2, c: 6, r: 4, e: 3, m: 2, a: 0, p: 2 }} size={56} anim="bob" />
              <AvatarSvg avatar={{ h: 3, c: 2, r: 6, e: 1, m: 1, a: 0, p: 0 }} size={56} anim="bob" />
            </div>
            <b>Mode Tim</b>
            <small>Pemain dibagi otomatis ke tim, skor tim = rata-rata anggota</small>
          </button>
        </div>
        {s.teamMode && (
          <label className="row" style={{ fontWeight: 700 }}>
            Jumlah tim:
            <select className="input" style={{ width: 90 }} value={s.teamCount} onChange={(e) => set({ teamCount: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <div className="card settings-card">
          <Toggle k="randomizeQuestions" label="Acak urutan pertanyaan" hint="Pertanyaan tampil dalam urutan acak" />
          <Toggle k="randomizeAnswers" label="Acak urutan jawaban" hint="Pilihan jawaban diacak (pilihan ganda & polling)" />
          <Toggle k="nameGenerator" label="Generator nama lucu" hint="Pemain dapat nama acak yang aman (bisa ganti 3×)" />
          <Toggle k="showQuestionOnDevice" label="Tampilkan pertanyaan di perangkat pemain" hint="Matikan agar pemain harus melihat layar host" />
          <Toggle k="music" label="Musik latar" hint="Musik di lobby & saat menjawab (efek suara tetap ada)" />
        </div>
        <button className="btn big" disabled={busy} onClick={() => onCreate(s)}>
          {busy ? 'Membuat game…' : 'Buka lobby 🚀'}
        </button>
        <Link className="btn ghost sm" to="/dashboard">Batal</Link>
      </main>
    </div>
  );
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
          <p className="muted" style={{ fontSize: 20, margin: 0 }}>
            Pertanyaan {view.questionIndex + 1} dari {view.questionCount} · {q && QUESTION_TYPE_LABEL[q.type]}
          </p>
          <h1 className="q-text zoom-in">{q?.text}</h1>
          {q?.points === 'double' && <span className="pill big-pill">⚡ Poin ganda!</span>}
          <div className="countdown-ring">{remaining}</div>
        </main>
      );

    case 'question':
      return (
        <main className="stage-main">
          <h1 className="q-text">{q!.text}</h1>
          <div className="q-middle">
            <Timer seconds={remaining} />
            {q!.image ? <img className="q-image" src={q!.image} alt="" referrerPolicy="no-referrer" /> : <div />}
            <div className="center answered-count">
              <div>{view.answeredCount}</div>
              <div className="muted">jawaban</div>
            </div>
          </div>
          <HostQuestionBody q={q!} puzzleItems={view.puzzleItems} />
          <button className="btn secondary" onClick={() => act('host:next')}>Lewati waktu ⏭</button>
        </main>
      );

    case 'reveal':
      return (
        <main className="stage-main">
          <h1 className="q-text">{q!.text}</h1>
          {view.results && <HostResults q={q!} results={view.results} correctText={view.correctText} />}
          <button className="btn big" onClick={() => act('host:next')} autoFocus>
            {isLast ? 'Lihat juara 🏆' : 'Lanjut →'}
          </button>
        </main>
      );

    case 'leaderboard':
      return (
        <main className="stage-main">
          <h1>Papan Skor</h1>
          {view.teams && <TeamBoard teams={view.teams} />}
          <AnimatedLeaderboard rows={view.players} max={5} />
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
  const teams = view.settings.teamMode && view.teams;

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
        <span className="pill big-pill">👥 {view.playerCount}</span>
        <button className="btn secondary" onClick={() => act('host:lock', { locked: !view.locked })}>
          {view.locked ? '🔒 Terkunci' : '🔓 Kunci'}
        </button>
        <button className="btn big" disabled={view.playerCount === 0} onClick={() => act('host:next')}>Mulai ▶</button>
      </div>

      {view.playerCount === 0 ? (
        <div className="center">
          <div className="waiting-dots"><span /><span /><span /></div>
          <p className="muted" style={{ fontSize: 20 }}>Menunggu pemain bergabung…</p>
        </div>
      ) : teams ? (
        <div className="team-columns">
          {teams.map((t) => (
            <div key={t.id} className="team-col" style={{ borderColor: t.color }}>
              <b style={{ color: t.color }}>{t.name}</b>
              <div className="lobby-grid">
                {view.players.filter((p) => p.teamId === t.id).map((p) => <LobbyPlayer key={p.id} p={p} act={act} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Klik pemain untuk mengeluarkannya</p>
          <div className="lobby-grid">
            {view.players.slice().reverse().map((p) => <LobbyPlayer key={p.id} p={p} act={act} />)}
          </div>
        </>
      )}
    </main>
  );
}

function LobbyPlayer({ p, act }: { p: RankEntry; act(e: string, d?: unknown): Promise<void> }) {
  return (
    <button
      className={`lobby-player ${p.connected ? '' : 'off'}`}
      title={p.connected ? 'Keluarkan' : 'Terputus — keluarkan'}
      onClick={() => confirm(`Keluarkan ${p.name}?`) && act('host:kick', { playerId: p.id })}
    >
      <AvatarSvg avatar={p.avatar} size={72} anim="dance" />
      <span>{p.name}</span>
    </button>
  );
}

function Podium({ view }: { view: HostView }) {
  const [stage, setStage] = useState(0); // 0 drumroll, 1 third, 2 second, 3 first
  useEffect(() => {
    sound.stop();
    sound.drumroll(2.2);
    const ts = [
      setTimeout(() => { setStage(1); sound.pop(); }, 1200),
      setTimeout(() => { setStage(2); sound.pop(); }, 2000),
      setTimeout(() => { setStage(3); sound.fanfare(); }, 2600),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);
  const top = view.players.slice(0, 3);
  const slots = [
    { p: top[1], place: 2, height: 150, show: stage >= 2 },
    { p: top[0], place: 1, height: 210, show: stage >= 3 },
    { p: top[2], place: 3, height: 110, show: stage >= 1 },
  ];
  return (
    <main className="stage-main">
      {stage >= 3 && <Confetti />}
      <h1 style={{ fontSize: 40, margin: 0 }}>🏆 Podium</h1>
      {view.teams && stage >= 3 && (
        <p className="pill big-pill" style={{ background: view.teams[0]?.color }}>Tim juara: {view.teams[0]?.name}</p>
      )}
      {top.length === 0 ? (
        <p className="muted">Tidak ada pemain.</p>
      ) : (
        <div className="podium">
          {slots.map(({ p, place, height, show }) => (
            <div key={place} className="step">
              {p && show && (
                <div className="podium-player">
                  <AvatarSvg avatar={p.avatar} size={place === 1 ? 120 : 96} mood="happy" anim={place === 1 ? 'dance' : 'bob'} />
                  <div className="name">{p.name}</div>
                  <div className="pts">{p.score.toLocaleString('id-ID')}</div>
                </div>
              )}
              <div className={`block place-${place}`} style={{ height }}>{place}</div>
            </div>
          ))}
        </div>
      )}
      {stage >= 3 && view.teams && <TeamBoard teams={view.teams} />}
      {stage >= 3 && view.players.length > 3 && (
        <div className="leader">
          {view.players.slice(3, 10).map((p) => (
            <div key={p.id} className="leader-row">
              <span className="rank">{p.rank}</span>
              <AvatarSvg avatar={p.avatar} size={40} />
              <span className="lname">{p.name}</span>
              <span className="score">{p.score.toLocaleString('id-ID')}</span>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <Link className="btn big" to="/dashboard">Ke dashboard</Link>
      </div>
      <p className="muted">Laporan lengkap tersimpan di tab Laporan pada dashboard.</p>
    </main>
  );
}
