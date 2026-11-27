import { memo, useState, type ReactNode } from 'react';
import { AVATAR_PARTS, randomAvatar, type Avatar as AvatarData, type AvatarPart } from '../../../shared/avatar';

export const AVATAR_COLORS = [
  '#ff7a59', '#ffb703', '#8ac926', '#2ec4b6', '#3a86ff', '#8338ec',
  '#ff4d8d', '#fb5607', '#7c7a8c', '#7cc6fe', '#c58b5a', '#f2d16b',
];

export const PART_LABELS: Record<AvatarPart, { title: string; names: string[] }> = {
  h: { title: 'Kepala', names: ['Hewan', 'Robot', 'Monster', 'Alien'] },
  c: { title: 'Warna', names: AVATAR_COLORS },
  r: { title: 'Telinga', names: ['Tanpa', 'Kucing', 'Kelinci', 'Beruang', 'Tanduk', 'Antena robot', 'Antena alien', 'Duri dino', 'Rubah'] },
  e: { title: 'Mata', names: ['Titik', 'Berbinar', 'Ngantuk', 'Satu mata', 'Visor', 'Galak', 'Bintang'] },
  m: { title: 'Mulut', names: ['Senyum', 'Tertawa', 'Taring', 'Melet', 'Robot', 'Kucing', 'Kaget'] },
  a: { title: 'Aksesori', names: ['Tanpa', 'Mahkota', 'Topi pesta', 'Kacamata', 'Pita', 'Headphone', 'Kupluk', 'Bunga', 'Topi'] },
  p: { title: 'Motif', names: ['Polos', 'Moncong', 'Totol', 'Belang'] },
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const INK = '#1d1535';

function headShape(h: number, fill: string, stroke: string): ReactNode {
  const common = { fill, stroke, strokeWidth: 3 };
  switch (h) {
    case 1:
      return <rect x="18" y="26" width="64" height="58" rx="12" {...common} />;
    case 2:
      return <path d="M20 58c0-22 13-36 30-36s30 14 30 36v22c-5 4-8-3-12 0s-7 4-11 0-8-4-12 0-7 3-12 0-9 4-13-1z" {...common} />;
    case 3:
      return <path d="M50 16c20 0 32 20 32 40 0 18-14 30-32 30S18 74 18 56c0-20 12-40 32-40z" {...common} />;
    default:
      return <circle cx="50" cy="56" r="32" {...common} />;
  }
}

function ears(r: number, fill: string, dark: string, light: string): ReactNode {
  const s = { stroke: dark, strokeWidth: 3 };
  switch (r) {
    case 1: // cat
      return (
        <g>
          <path d="M24 40 L22 12 L44 28Z" fill={fill} {...s} strokeLinejoin="round" />
          <path d="M76 40 L78 12 L56 28Z" fill={fill} {...s} strokeLinejoin="round" />
          <path d="M27 33 L26 19 L37 27Z" fill={light} />
          <path d="M73 33 L74 19 L63 27Z" fill={light} />
        </g>
      );
    case 2: // bunny
      return (
        <g>
          <ellipse cx="36" cy="16" rx="8" ry="20" fill={fill} {...s} transform="rotate(-10 36 16)" />
          <ellipse cx="64" cy="16" rx="8" ry="20" fill={fill} {...s} transform="rotate(10 64 16)" />
          <ellipse cx="36" cy="16" rx="3.5" ry="13" fill={light} transform="rotate(-10 36 16)" />
          <ellipse cx="64" cy="16" rx="3.5" ry="13" fill={light} transform="rotate(10 64 16)" />
        </g>
      );
    case 3: // bear
      return (
        <g>
          <circle cx="26" cy="30" r="11" fill={fill} {...s} />
          <circle cx="74" cy="30" r="11" fill={fill} {...s} />
          <circle cx="26" cy="30" r="5" fill={light} />
          <circle cx="74" cy="30" r="5" fill={light} />
        </g>
      );
    case 4: // horns
      return (
        <g fill="#f3e5c8" stroke="#8c7853" strokeWidth="3" strokeLinejoin="round">
          <path d="M30 34 C20 28 18 16 24 8 C26 18 32 24 40 28Z" />
          <path d="M70 34 C80 28 82 16 76 8 C74 18 68 24 60 28Z" />
        </g>
      );
    case 5: // robot antenna
      return (
        <g>
          <line x1="50" y1="26" x2="50" y2="9" stroke={INK} strokeWidth="3" />
          <circle className="av-glow" cx="50" cy="8" r="5" fill="#ff4d4d" stroke={INK} strokeWidth="2" />
          <rect x="10" y="48" width="9" height="16" rx="3" fill={dark} stroke={INK} strokeWidth="2" />
          <rect x="81" y="48" width="9" height="16" rx="3" fill={dark} stroke={INK} strokeWidth="2" />
        </g>
      );
    case 6: // alien antennae
      return (
        <g stroke={INK} strokeWidth="3" fill="none">
          <path d="M40 24 Q34 12 28 8" />
          <path d="M60 24 Q66 12 72 8" />
          <circle cx="28" cy="8" r="5" fill="#b8ff4d" strokeWidth="2" />
          <circle cx="72" cy="8" r="5" fill="#b8ff4d" strokeWidth="2" />
        </g>
      );
    case 7: // dino spikes
      return (
        <g fill={dark} stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M34 28 L38 12 L46 25Z" />
          <path d="M45 24 L50 6 L55 24Z" />
          <path d="M54 25 L62 12 L66 28Z" />
        </g>
      );
    case 8: // fox
      return (
        <g>
          <path d="M20 46 L14 8 L46 26Z" fill={fill} {...s} strokeLinejoin="round" />
          <path d="M80 46 L86 8 L54 26Z" fill={fill} {...s} strokeLinejoin="round" />
          <path d="M22 36 L19 16 L36 27Z" fill="#fff" opacity=".85" />
          <path d="M78 36 L81 16 L64 27Z" fill="#fff" opacity=".85" />
        </g>
      );
    default:
      return null;
  }
}

function pattern(p: number, h: number, dark: string, light: string): ReactNode {
  switch (p) {
    case 1:
      return <ellipse cx="50" cy={h === 1 ? 70 : 70} rx="20" ry="13" fill={light} />;
    case 2:
      return (
        <g fill={dark} opacity=".55">
          <circle cx="30" cy="42" r="5" />
          <circle cx="70" cy="38" r="4" />
          <circle cx="74" cy="66" r="5" />
          <circle cx="27" cy="68" r="3.5" />
        </g>
      );
    case 3:
      return (
        <g stroke={dark} strokeWidth="4" strokeLinecap="round" opacity=".6">
          <line x1="50" y1="27" x2="50" y2="38" />
          <line x1="39" y1="29" x2="41" y2="38" />
          <line x1="61" y1="29" x2="59" y2="38" />
        </g>
      );
    default:
      return null;
  }
}

function eyes(e: number, mood: Mood): ReactNode {
  if (mood === 'sad' && e !== 4) {
    return (
      <g stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round">
        <path d="M33 50 q5 5 10 0" />
        <path d="M57 50 q5 5 10 0" />
        <path className="av-tear" d="M36 56 q-2 5 1 7 q3 -2 1 -7z" fill="#7cc6fe" stroke="none" />
      </g>
    );
  }
  if (mood === 'happy' && e !== 4 && e !== 3) {
    return (
      <g stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round">
        <path d="M33 52 q5 -7 10 0" />
        <path d="M57 52 q5 -7 10 0" />
      </g>
    );
  }
  switch (e) {
    case 1:
      return (
        <g className="av-blink">
          <circle cx="38" cy="50" r="9" fill="#fff" stroke={INK} strokeWidth="2.5" />
          <circle cx="62" cy="50" r="9" fill="#fff" stroke={INK} strokeWidth="2.5" />
          <circle cx="39" cy="51" r="5" fill={INK} />
          <circle cx="63" cy="51" r="5" fill={INK} />
          <circle cx="41" cy="48.5" r="1.8" fill="#fff" />
          <circle cx="65" cy="48.5" r="1.8" fill="#fff" />
        </g>
      );
    case 2:
      return (
        <g stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round">
          <path d="M32 51 q6 4 12 0" />
          <path d="M56 51 q6 4 12 0" />
        </g>
      );
    case 3:
      return (
        <g className="av-blink">
          <circle cx="50" cy="48" r="13" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx="50" cy="49" r="7" fill={INK} />
          <circle cx="53" cy="46" r="2.4" fill="#fff" />
        </g>
      );
    case 4:
      return (
        <g>
          <rect x="26" y="42" width="48" height="16" rx="8" fill={INK} />
          <rect className="av-scan" x="31" y="48" width="12" height="4" rx="2" fill="#4dfff3" />
        </g>
      );
    case 5:
      return (
        <g>
          <g className="av-blink">
            <circle cx="38" cy="52" r="5" fill={INK} />
            <circle cx="62" cy="52" r="5" fill={INK} />
          </g>
          <path d="M30 41 L45 46 M70 41 L55 46" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case 6:
      return (
        <g fill="#ffd23f" stroke={INK} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M38 41l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
          <path d="M62 41l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
        </g>
      );
    default:
      return (
        <g className="av-blink">
          <circle cx="38" cy="51" r="4.5" fill={INK} />
          <circle cx="62" cy="51" r="4.5" fill={INK} />
        </g>
      );
  }
}

function mouth(m: number, mood: Mood): ReactNode {
  if (mood === 'sad') return <path d="M40 74 q10 -8 20 0" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />;
  if (mood === 'happy') m = 1;
  switch (m) {
    case 1:
      return (
        <g>
          <path d="M38 66 h24 q0 14 -12 14 q-12 0 -12 -14z" fill={INK} />
          <path d="M43 75 q7 -5 14 0 q-3 5 -7 5 q-4 0 -7 -5z" fill="#ff6b8b" />
        </g>
      );
    case 2:
      return (
        <g>
          <path d="M38 68 q12 10 24 0" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M42 70 l3 6 l3 -5z M58 70 l-3 6 l-3 -5z" fill="#fff" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
        </g>
      );
    case 3:
      return (
        <g>
          <path d="M40 68 q10 6 20 0" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M47 71 h9 v5 a4.5 4.5 0 0 1 -9 0z" fill="#ff6b8b" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 4:
      return (
        <g>
          <rect x="38" y="66" width="24" height="10" rx="2" fill="#fff" stroke={INK} strokeWidth="2.5" />
          <path d="M44 66v10M50 66v10M56 66v10" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 5:
      return <path d="M41 68 q4.5 6 9 0 q4.5 6 9 0" stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />;
    case 6:
      return <ellipse cx="50" cy="71" rx="5" ry="6" fill={INK} />;
    default:
      return <path d="M39 67 q11 10 22 0" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />;
  }
}

function accessory(a: number, h: number): ReactNode {
  const top = h === 1 ? 26 : h === 3 ? 18 : 24;
  switch (a) {
    case 1:
      return (
        <path d={`M34 ${top + 2} l-2 -16 l10 8 l8 -12 l8 12 l10 -8 l-2 16z`} fill="#ffd23f" stroke="#b8860b" strokeWidth="2.5" strokeLinejoin="round" />
      );
    case 2:
      return (
        <g transform={`translate(0 ${top - 24})`}>
          <path d="M40 26 L54 -6 L66 22Z" fill="#ff4d8d" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M47 11 L60 8 M44 18 L63 15" stroke="#ffd23f" strokeWidth="3" />
          <circle cx="54" cy="-6" r="4" fill="#ffd23f" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 3:
      return (
        <g fill="rgba(255,255,255,.25)" stroke={INK} strokeWidth="3">
          <circle cx="38" cy="51" r="10" />
          <circle cx="62" cy="51" r="10" />
          <path d="M48 50 h4" />
        </g>
      );
    case 4:
      return (
        <g transform={`translate(66 ${top + 2})`} fill="#ff4d8d" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M0 0 l-12 -8 v16z" />
          <path d="M0 0 l12 -8 v16z" />
          <circle r="3.5" />
        </g>
      );
    case 5:
      return (
        <g>
          <path d="M18 56 C18 14 82 14 82 56" stroke={INK} strokeWidth="5" fill="none" />
          <rect x="10" y="48" width="12" height="20" rx="5" fill="#3a3355" stroke={INK} strokeWidth="2" />
          <rect x="78" y="48" width="12" height="20" rx="5" fill="#3a3355" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 6:
      return (
        <g transform={`translate(0 ${top - 24})`}>
          <path d="M22 36 C22 6 78 6 78 36Z" fill="#2f80ed" stroke={INK} strokeWidth="2.5" />
          <rect x="20" y="31" width="60" height="9" rx="4" fill="#1b5fc1" stroke={INK} strokeWidth="2.5" />
          <circle cx="50" cy="8" r="6" fill="#ffd23f" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 7:
      return (
        <g transform={`translate(72 ${top + 8})`}>
          {[0, 72, 144, 216, 288].map((r) => (
            <ellipse key={r} cx="0" cy="-6" rx="4.5" ry="7" fill="#fff" stroke={INK} strokeWidth="1.5" transform={`rotate(${r})`} />
          ))}
          <circle r="4" fill="#ffd23f" stroke={INK} strokeWidth="1.5" />
        </g>
      );
    case 8:
      return (
        <g transform={`translate(0 ${top - 24})`}>
          <path d="M24 34 C24 10 76 10 76 34Z" fill="#ff5a5f" stroke={INK} strokeWidth="2.5" />
          <path d="M70 34 h22 q2 5 -4 6 h-20z" fill="#d6334a" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="50" cy="12" r="3" fill={INK} />
        </g>
      );
    default:
      return null;
  }
}

export type Mood = 'neutral' | 'happy' | 'sad';

export const AvatarSvg = memo(function AvatarSvg({
  avatar,
  size = 64,
  mood = 'neutral',
  anim,
  title,
}: {
  avatar: AvatarData;
  size?: number;
  mood?: Mood;
  anim?: 'bob' | 'dance' | 'jump' | 'shake' | 'pop';
  title?: string;
}) {
  const base = AVATAR_COLORS[avatar.c % AVATAR_COLORS.length]!;
  const dark = shade(base, -0.35);
  const light = shade(base, 0.55);
  const earsBehind = avatar.r !== 5 && avatar.r !== 6;
  return (
    <svg
      className={`avatar ${anim ? `av-${anim}` : ''}`}
      width={size}
      height={size}
      viewBox="0 -8 100 108"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ animationDelay: `${(avatar.c * 137 + avatar.e * 59) % 900}ms` }}
    >
      <ellipse cx="50" cy="96" rx="24" ry="4" fill="rgba(0,0,0,.18)" className="av-shadow" />
      <g className="av-body">
        {earsBehind && ears(avatar.r, base, dark, light)}
        {headShape(avatar.h, base, dark)}
        {pattern(avatar.p, avatar.h, dark, light)}
        {!earsBehind && ears(avatar.r, base, dark, light)}
        {avatar.h === 0 && (
          <g fill="#ff8fab" opacity=".55">
            <ellipse cx="28" cy="64" rx="5" ry="3.5" />
            <ellipse cx="72" cy="64" rx="5" ry="3.5" />
          </g>
        )}
        {eyes(avatar.e, mood)}
        {mouth(avatar.m, mood)}
        {accessory(avatar.a, avatar.h)}
      </g>
    </svg>
  );
});

/** Mix-and-match character builder */
export function AvatarBuilder({ value, onChange }: { value: AvatarData; onChange(a: AvatarData): void }) {
  const [part, setPart] = useState<AvatarPart>('h');
  const parts = Object.keys(AVATAR_PARTS) as AvatarPart[];
  const count = AVATAR_PARTS[part];
  return (
    <div className="builder">
      <div className="builder-preview">
        <AvatarSvg avatar={value} size={140} anim="bob" />
        <button type="button" className="btn secondary sm" onClick={() => onChange(randomAvatar())}>
          🎲 Acak
        </button>
      </div>
      <div className="builder-tabs" role="tablist">
        {parts.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={p === part} className={`builder-tab ${p === part ? 'active' : ''}`} onClick={() => setPart(p)}>
            {PART_LABELS[p].title}
          </button>
        ))}
      </div>
      <div className="builder-grid">
        {Array.from({ length: count }, (_, i) => {
          const preview = { ...value, [part]: i };
          const selected = value[part] === i;
          return (
            <button
              key={i}
              type="button"
              className={`builder-opt ${selected ? 'active' : ''}`}
              aria-pressed={selected}
              aria-label={`${PART_LABELS[part].title}: ${part === 'c' ? `warna ${i + 1}` : PART_LABELS[part].names[i]}`}
              onClick={() => onChange(preview)}
            >
              {part === 'c' ? <span className="swatch" style={{ background: AVATAR_COLORS[i] }} /> : <AvatarSvg avatar={preview} size={52} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
