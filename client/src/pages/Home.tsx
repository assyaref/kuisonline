import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LIMITS } from '../../../shared/schema';
import { emitAck, storage, useAuth } from '../lib';
import { Logo } from '../components/ui';

export interface PlayerSession {
  pin: string;
  playerId: string;
  playerKey: string;
  name: string;
}
export const PLAYER_KEY = 'gk_player';

export default function Home() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pin, setPin] = useState(params.get('pin')?.replace(/\D/g, '').slice(0, 6) ?? '');
  const [step, setStep] = useState<'pin' | 'name'>('pin');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = storage.get<PlayerSession>(PLAYER_KEY);

  useEffect(() => {
    // came via QR / link with PIN: verify right away
    if (pin.length === 6 && params.get('pin')) void checkPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkPin(e?: FormEvent) {
    e?.preventDefault();
    if (!/^\d{6}$/.test(pin)) return setError('PIN harus 6 angka');
    setBusy(true);
    setError('');
    const r = await emitAck<{ title: string }>('player:check', { pin });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setTitle(r.title);
    setStep('name');
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Nama wajib diisi');
    setBusy(true);
    setError('');
    const r = await emitAck<{ playerId: string; playerKey: string; name: string }>('player:join', { pin, name });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    storage.set(PLAYER_KEY, { pin, playerId: r.playerId, playerKey: r.playerKey, name: r.name } satisfies PlayerSession);
    navigate('/play');
  }

  return (
    <div className="stage">
      <div className="stage-bar">
        <div style={{ filter: 'brightness(0) invert(1)' }}>
          <Logo />
        </div>
        <div className="spacer" />
        <Link className="btn secondary sm" to={user ? '/dashboard' : '/login'}>
          {user ? 'Dashboard' : 'Masuk sebagai host'}
        </Link>
      </div>
      <main className="stage-main">
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)', textAlign: 'center', margin: 0 }}>Siap main kuis?</h1>
        <p className="muted center" style={{ margin: 0 }}>
          Masukkan PIN game yang tampil di layar host.
        </p>

        {existing && step === 'pin' && (
          <button className="btn secondary" onClick={() => navigate('/play')}>
            Lanjutkan game {existing.pin} sebagai {existing.name}
          </button>
        )}

        <div className="card join-box">
          {step === 'pin' ? (
            <form onSubmit={checkPin}>
              <input
                className="input pin-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="PIN Game"
                aria-label="PIN Game"
                value={pin}
                maxLength={6}
                autoFocus
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              {error && <p className="error" role="alert">{error}</p>}
              <button className="btn big block" style={{ marginTop: 12 }} disabled={busy || pin.length !== 6}>
                {busy ? 'Mengecek…' : 'Masuk'}
              </button>
            </form>
          ) : (
            <form onSubmit={join}>
              <p className="muted" style={{ marginTop: 0 }}>
                Gabung ke <b style={{ color: 'inherit' }}>{title}</b>
              </p>
              <input
                className="input pin-input"
                style={{ letterSpacing: 0, fontSize: 22 }}
                placeholder="Nama panggilan"
                aria-label="Nama panggilan"
                value={name}
                maxLength={LIMITS.nameMax}
                autoFocus
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
              />
              {error && <p className="error" role="alert">{error}</p>}
              <button className="btn big block" style={{ marginTop: 12 }} disabled={busy || !name.trim()}>
                {busy ? 'Bergabung…' : 'Gas!'}
              </button>
              <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setStep('pin'); setError(''); }}>
                Ganti PIN
              </button>
            </form>
          )}
        </div>
      </main>
      <p className="muted center" style={{ padding: 16, fontSize: 14 }}>
        Mau bikin kuis sendiri? <Link to="/register" style={{ color: '#ffd23f' }}>Daftar gratis</Link>
      </p>
    </div>
  );
}
