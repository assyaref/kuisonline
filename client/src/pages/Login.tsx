import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, useAuth, type User } from '../lib';
import { TopBar } from '../components/ui';

export default function Login({ mode }: { mode: 'login' | 'register' }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next') ?? '/dashboard';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: User }>(`/auth/${mode}`, { method: 'POST', body: { username, password } });
      setUser(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card">
          <h1>{isLogin ? 'Masuk' : 'Buat akun host'}</h1>
          <p className="muted">{isLogin ? 'Masuk untuk membuat dan memandu kuis.' : 'Gratis. Pemain tidak perlu akun — cukup PIN.'}</p>
          <form onSubmit={submit}>
            <label className="field">
              <span>Username</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                minLength={isLogin ? undefined : 8}
                required
              />
            </label>
            {!isLogin && <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>Minimal 8 karakter.</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn block big" disabled={busy}>
              {busy ? 'Memproses…' : isLogin ? 'Masuk' : 'Daftar'}
            </button>
          </form>
          <p className="center muted" style={{ marginBottom: 0 }}>
            {isLogin ? (
              <>Belum punya akun? <Link to={`/register?next=${encodeURIComponent(next)}`}>Daftar</Link></>
            ) : (
              <>Sudah punya akun? <Link to={`/login?next=${encodeURIComponent(next)}`}>Masuk</Link></>
            )}
          </p>
        </div>
      </main>
    </>
  );
}
