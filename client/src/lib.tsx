import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

// ---------------- HTTP ----------------

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Tidak bisa terhubung ke server. Cek koneksi internetmu.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Error ${res.status}`);
  return data as T;
}

// ---------------- Socket ----------------

let socket: Socket | null = null;
let clockOffset = 0;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 10000 });
    const sync = () => {
      const t0 = Date.now();
      socket!.timeout(5000).emit('time:sync', (err: unknown, serverNow: number) => {
        if (err || typeof serverNow !== 'number') return;
        const t1 = Date.now();
        clockOffset = serverNow + (t1 - t0) / 2 - t1;
      });
    };
    socket.on('connect', sync);
  }
  return socket;
}

/** Reconnect socket so the handshake picks up a fresh login cookie. */
export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
}

export const serverNow = () => Date.now() + clockOffset;

export type AckResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

export function emitAck<T = Record<string, unknown>>(event: string, data: unknown = {}, ms = 8000): Promise<AckResult<T>> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(ms).emit(event, data, (err: unknown, res: AckResult<T>) => {
      if (err) resolve({ ok: false, error: 'Koneksi lambat, coba lagi' });
      else resolve(res ?? { ok: false, error: 'Respon tidak valid' });
    });
  });
}

export function useConnected(): boolean {
  const s = getSocket();
  const [connected, setConnected] = useState(s.connected);
  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('connect', on);
    s.on('disconnect', off);
    setConnected(s.connected);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, [s]);
  return connected;
}

export function ConnectionBanner() {
  const connected = useConnected();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (connected) return setShow(false);
    const t = setTimeout(() => setShow(true), 1200); // don't flash on brief blips
    return () => clearTimeout(t);
  }, [connected]);
  return show ? <div className="conn-banner" role="status">Koneksi terputus — mencoba menyambung lagi…</div> : null;
}

/** seconds remaining until a server-clock deadline */
export function useRemaining(deadline: number | null): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!deadline) return;
    let raf = 0;
    const id = setInterval(() => setNow(serverNow()), 200);
    setNow(serverNow());
    return () => {
      clearInterval(id);
      cancelAnimationFrame(raf);
    };
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

// ---------------- storage ----------------

export const storage = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// ---------------- auth ----------------

export interface User {
  id: string;
  username: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  setUser(u: User | null): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ user: User | null }>('/auth/me')
      .then((r) => setUserState(r.user))
      .catch(() => setUserState(null))
      .finally(() => setLoading(false));
  }, []);
  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    resetSocket();
  }, []);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setUser(null);
  }, [setUser]);
  return <AuthContext.Provider value={{ user, loading, setUser, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// ---------------- toasts ----------------

interface Toast {
  id: number;
  text: string;
  err?: boolean;
}
const ToastContext = createContext<(text: string, err?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, err = false) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
