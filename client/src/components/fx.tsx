import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Avatar } from '../../../shared/avatar';
import type { RankEntry, TeamEntry } from '../../../shared/types';
import { sound } from '../sound';
import { AvatarSvg } from './Avatar';

const CONFETTI_COLORS = ['#ff5a5f', '#ffd23f', '#0f9fb5', '#8b3fd9', '#12a46b', '#ff8fab', '#ffffff'];

export function Confetti({ count = 140 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2.5,
        dur: 2.8 + Math.random() * 2.5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 8,
        rot: Math.random() * 360,
        round: Math.random() < 0.3,
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            borderRadius: p.round ? '50%' : 2,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export interface FloatingReaction {
  id: number;
  e: string;
  x: number;
  avatar?: Avatar;
}

export function FloatingReactions({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="reactions-layer" aria-hidden="true">
      {items.map((r) => (
        <div key={r.id} className="floating-reaction" style={{ left: `${r.x}%` }}>
          {r.avatar && <AvatarSvg avatar={r.avatar} size={34} />}
          <span>{r.e}</span>
        </div>
      ))}
    </div>
  );
}

export function useMuted() {
  return useSyncExternalStore(
    (l) => sound.subscribe(l),
    () => sound.muted,
  );
}

export function MuteButton() {
  const muted = useMuted();
  return (
    <button
      className="btn secondary sm"
      onClick={() => {
        sound.unlock();
        sound.setMuted(!muted);
      }}
      aria-label={muted ? 'Nyalakan suara' : 'Matikan suara'}
      title={muted ? 'Nyalakan suara' : 'Matikan suara'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

const ROW_H = 64;

/** Leaderboard that animates from the previous ranking to the current one. */
export function AnimatedLeaderboard({ rows, max = 5 }: { rows: RankEntry[]; max?: number }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [rows]);

  const prevOrder = useMemo(() => {
    const sorted = rows.slice().sort((a, b) => a.prevRank - b.prevRank || a.rank - b.rank);
    return new Map(sorted.map((r, i) => [r.id, i]));
  }, [rows]);
  const curOrder = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  const visible = rows.filter((r) => (curOrder.get(r.id) ?? 99) < max || (prevOrder.get(r.id) ?? 99) < max);
  return (
    <div className="leader" style={{ height: Math.min(max, rows.length) * ROW_H, position: 'relative' }}>
      {visible.map((p) => {
        const pos = settled ? curOrder.get(p.id)! : prevOrder.get(p.id)!;
        const hidden = pos >= max;
        const up = (prevOrder.get(p.id) ?? 0) > (curOrder.get(p.id) ?? 0);
        return (
          <div
            key={p.id}
            className={`leader-row abs ${settled && up ? 'climbed' : ''}`}
            style={{ transform: `translateY(${pos * ROW_H}px)`, opacity: hidden ? 0 : 1 }}
          >
            <span className="rank">{settled ? p.rank : p.prevRank}</span>
            <AvatarSvg avatar={p.avatar} size={44} anim={settled && up ? 'jump' : undefined} />
            <span className="lname">{p.name}</span>
            {p.streak >= 2 && <span title="Streak" className="streak">🔥{p.streak}</span>}
            {p.delta > 0 && <span className="delta">+{p.delta.toLocaleString('id-ID')}</span>}
            <span className="score">{(settled ? p.score : p.score - p.delta).toLocaleString('id-ID')}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TeamBoard({ teams }: { teams: TeamEntry[] }) {
  const max = Math.max(1, ...teams.map((t) => t.score));
  return (
    <div className="teamboard">
      {teams.map((t) => (
        <div key={t.id} className="team-row">
          <span className="rank">{t.rank}</span>
          <span className="tname" style={{ color: t.color }}>{t.name}</span>
          <span className="muted" style={{ fontSize: 13 }}>{t.members} org</span>
          <div className="team-bar"><div style={{ width: `${(t.score / max) * 100}%`, background: t.color }} /></div>
          <span className="score">{t.score.toLocaleString('id-ID')}</span>
        </div>
      ))}
    </div>
  );
}
