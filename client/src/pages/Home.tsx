import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { randomAvatar, type Avatar } from '../../../shared/avatar';
import { LIMITS } from '../../../shared/schema';
import { api, emitAck, storage, useAuth } from '../lib';
import { Logo } from '../components/ui';
import { AvatarBuilder, AvatarSvg } from '../components/Avatar';
import { sound } from '../sound';

export interface PlayerSession {
  pin: string;
  playerId: string;
  playerKey: string;
  name: string;
}
export const PLAYER_KEY = 'gk_player';
export const ASSIGN_KEY = 'gk_assign';
const AVATAR_KEY = 'gk_avatar';

type Step = 'pin' | 'name' | 'avatar';

export default function Home() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pin, setPin] = useState(params.get('pin')?.replace(/\D/g, '').slice(0, 7) ?? '');
  const [step, setStep] = useState<Step>('pin');
  const [title, setTitle] = useState('');
  const [nameGen, setNameGen] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<Avatar>(() => storage.get<Avatar>(AVATAR_KEY) ?? randomAvatar());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = storage.get<PlayerSession>(PLAYER_KEY);
  const existingAssign = storage.get<PlayerSession>(ASSIGN_KEY);
  const isAssignment = pin.length === 7;

  useEffect(() => {
    if (params.get('pin') && (pin.length === 6 || pin.length === 7)) void checkPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkPin(e?: FormEvent) {
    e?.preventDefault();
    sound.unlock();
    if (!/^\d{6,7}$/.test(pin)) return setError('PIN harus 6 atau 7 angka');
    setBusy(true);
    setError('');
    try {
      let info: { title: string; nameGenerator: boolean };
      if (pin.length === 7) {
        info = await api<{ title: string; nameGenerator: boolean }>('/play/check', { method: 'POST', body: { pin } });
      } else {
        const r = await emitAck<{ title: string; nameGenerator: boolean }>('player:check', { pin });
        if (!r.ok) throw new Error(r.error);
        info = r;
      }
      setTitle(info.title);
      setNameGen(info.nameGenerator);
      setStep(info.nameGenerator ? 'avatar' : 'name');
    } catch (err) {
      setError((err as Error).message.includes('tidak ditemukan') || (err as Error).message.includes('Tidak ditemukan') ? 'PIN tidak ditemukan' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    setError('');
    storage.set(AVATAR_KEY, avatar);
    const payload = { pin, name: nameGen ? undefined : name, avatar };
    try {
      if (isAssignment) {
        const r = await api<{ playerId: string; playerKey: string; name: string }>('/play/join', { method: 'POST', body: payload });
        storage.set(ASSIGN_KEY, { pin, playerId: r.playerId, playerKey: r.playerKey, name: r.name } satisfies PlayerSession);
        navigate('/tugas');
      } else {
        const r = await emitAck<{ playerId: string; playerKey: string; name: string }>('player:join', payload);
        if (!r.ok) throw new Error(r.error);
        storage.set(PLAYER_KEY, { pin, playerId: r.playerId, playerKey: r.playerKey, name: r.name } satisfies PlayerSession);
        navigate('/play');
      }
    } catch (err) {
      setError((err as Error).message);
      if (/Nama/.test((err as Error).message)) setStep('name');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage">
      <div className="stage-bar">
        <div className="logo-invert">
          <Logo />
        </div>
        <div className="spacer" />
        <Link className="btn secondary sm" to="/jelajahi">Jelajahi kuis</Link>
        <Link className="btn secondary sm" to={user ? '/dashboard' : '/login'}>
          {user ? 'Dashboard' : 'Masuk sebagai host'}
        </Link>
      </div>
      <main className="stage-main">
        {step === 'pin' && (
          <>
            <div className="hero-avatars" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <AvatarSvg key={i} avatar={HERO[i]!} size={i === 2 ? 110 : 76} anim="bob" />
              ))}
            </div>
            <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)', textAlign: 'center', margin: 0 }}>Siap main kuis?</h1>
            <p className="muted center" style={{ margin: 0 }}>Masukkan PIN game yang tampil di layar host.</p>
            {existing && (
              <button className="btn secondary" onClick={() => navigate('/play')}>
                Lanjutkan game {existing.pin} sebagai {existing.name}
              </button>
            )}
            {existingAssign && (
              <button className="btn secondary" onClick={() => navigate('/tugas')}>
                Lanjutkan tugas {existingAssign.pin} sebagai {existingAssign.name}
              </button>
            )}
          </>
        )}

        <div className={`card join-box ${step === 'avatar' ? 'wide' : ''}`}>
          {step === 'pin' && (
            <form onSubmit={checkPin}>
              <input
                className="input pin-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="PIN Game"
                aria-label="PIN Game"
                value={pin}
                maxLength={7}
                autoFocus
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 7))}
              />
              {error && <p className="error" role="alert">{error}</p>}
              <button className="btn big block" style={{ marginTop: 12 }} disabled={busy || pin.length < 6}>
                {busy ? 'Mengecek…' : 'Masuk'}
              </button>
            </form>
          )}

          {step === 'name' && (
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { setError(''); setStep('avatar'); } }}>
              <p className="muted" style={{ marginTop: 0 }}>
                {isAssignment ? 'Tugas' : 'Gabung ke'} <b style={{ color: 'inherit' }}>{title}</b>
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
              <button className="btn big block" style={{ marginTop: 12 }} disabled={!name.trim()}>Lanjut →</button>
              <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setStep('pin'); setError(''); }}>
                Ganti PIN
              </button>
            </form>
          )}

          {step === 'avatar' && (
            <div>
              <h2 style={{ marginTop: 0 }}>Buat karaktermu!</h2>
              {nameGen && <p className="muted" style={{ marginTop: -6 }}>Nama lucumu akan dipilihkan otomatis 😄</p>}
              <AvatarBuilder value={avatar} onChange={setAvatar} />
              {error && <p className="error" role="alert">{error}</p>}
              <div className="row" style={{ marginTop: 14 }}>
                <button type="button" className="btn ghost" onClick={() => setStep(nameGen ? 'pin' : 'name')}>← Kembali</button>
                <button className="btn big" style={{ flex: 1 }} disabled={busy} onClick={join}>
                  {busy ? 'Bergabung…' : 'Gas! 🚀'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <p className="muted center" style={{ padding: 16, fontSize: 14 }}>
        Mau bikin kuis sendiri? <Link to="/register" style={{ color: '#ffd23f' }}>Daftar gratis</Link>
      </p>
    </div>
  );
}

const HERO: Avatar[] = [
  { h: 0, c: 0, r: 1, e: 1, m: 5, a: 0, p: 1 },
  { h: 1, c: 4, r: 5, e: 4, m: 4, a: 5, p: 0 },
  { h: 2, c: 5, r: 4, e: 3, m: 2, a: 1, p: 2 },
  { h: 3, c: 2, r: 6, e: 1, m: 1, a: 3, p: 0 },
  { h: 0, c: 1, r: 2, e: 6, m: 3, a: 7, p: 3 },
];
