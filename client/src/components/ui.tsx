import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib';

const SHAPES = [
  // star
  <path key="0" d="M16 2l4.2 8.6 9.4 1.4-6.8 6.6 1.6 9.4L16 23.6 7.6 28l1.6-9.4L2.4 12l9.4-1.4z" />,
  // hexagon
  <path key="1" d="M16 2l12 7v14l-12 7-12-7V9z" />,
  // circle
  <circle key="2" cx="16" cy="16" r="13" />,
  // plus
  <path key="3" d="M11 3h10v8h8v10h-8v8H11v-8H3V11h8z" />,
];

export const OPTION_LABELS = ['Bintang', 'Segi enam', 'Lingkaran', 'Plus'];

export function Shape({ index }: { index: number }) {
  return (
    <svg className="shape" viewBox="0 0 32 32" fill="#fff" aria-hidden="true">
      {SHAPES[index % 4]}
    </svg>
  );
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="GasKuis beranda">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="#6c3cf0" />
        <path d="M36 8 18 36h12l-4 20 20-30H34z" fill="#ffd23f" />
      </svg>
      GasKuis
    </Link>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <Logo to={user ? '/dashboard' : '/'} />
      <div className="spacer" />
      {children}
      {user ? (
        <>
          <span className="muted" style={{ fontWeight: 600 }}>
            @{user.username}
          </span>
          <button className="btn ghost sm" onClick={logout}>
            Keluar
          </button>
        </>
      ) : (
        <Link className="btn sm" to="/login">
          Masuk
        </Link>
      )}
    </header>
  );
}

export function Timer({ seconds }: { seconds: number }) {
  return (
    <div className={`timer ${seconds <= 5 ? 'low' : ''}`} role="timer" aria-label={`${seconds} detik tersisa`}>
      {seconds}
    </div>
  );
}

export function Spinner({ dark }: { dark?: boolean }) {
  return <div className={`spinner ${dark ? 'dark' : ''}`} role="status" aria-label="Memuat" />;
}

export function FullCenter({ children }: { children: ReactNode }) {
  return (
    <div className="stage">
      <div className="stage-main">{children}</div>
    </div>
  );
}
