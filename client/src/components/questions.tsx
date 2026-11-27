import { useEffect, useState, type FormEvent } from 'react';
import { LIMITS, type Question } from '../../../shared/schema';
import type { AnswerValue, PlayerQuestion, QuestionResults } from '../../../shared/types';
import { Shape } from './ui';

const fmtNum = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 6, useGrouping: Math.abs(n) >= 10000 });

/** Player-side answer controls for every question type. */
export function AnswerInput({ q, onSubmit }: { q: PlayerQuestion; onSubmit(a: AnswerValue): void }) {
  switch (q.type) {
    case 'quiz':
    case 'truefalse':
    case 'poll':
      return (
        <div className={`options player-options ${q.options.length === 2 ? 'two' : ''}`}>
          {q.options.map((o, i) => (
            <button key={i} className={`opt o${i}`} onClick={() => onSubmit(i)} aria-label={`Jawaban ${i + 1}: ${o}`}>
              <Shape index={i} />
              <span>{o}</span>
            </button>
          ))}
        </div>
      );
    case 'typeanswer':
    case 'wordcloud':
      return <TextAnswer placeholder={q.type === 'wordcloud' ? 'Tulis satu kata/frasa…' : 'Ketik jawabanmu…'} onSubmit={onSubmit} />;
    case 'puzzle':
      return <PuzzleAnswer items={q.items} onSubmit={onSubmit} />;
    case 'slider':
      return <SliderAnswer cfg={q.slider!} onSubmit={onSubmit} />;
  }
}

function TextAnswer({ placeholder, onSubmit }: { placeholder: string; onSubmit(a: string): void }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSubmit(text.trim());
  };
  return (
    <form className="answer-panel" onSubmit={submit}>
      <input
        className="input big-input"
        value={text}
        maxLength={LIMITS.textAnswerMax}
        placeholder={placeholder}
        autoFocus
        autoComplete="off"
        autoCapitalize="none"
        aria-label="Jawaban"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="muted" style={{ textAlign: 'right', fontSize: 13 }}>{text.length}/{LIMITS.textAnswerMax}</div>
      <button className="btn big block" disabled={!text.trim()}>Kirim</button>
    </form>
  );
}

function PuzzleAnswer({ items, onSubmit }: { items: { i: number; text: string }[]; onSubmit(a: number[]): void }) {
  const [order, setOrder] = useState(items);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setOrder(items), [items]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = order.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    setOrder(next);
  };
  const tap = (idx: number) => {
    if (picked === null) return setPicked(idx);
    if (picked !== idx) {
      const next = order.slice();
      [next[picked], next[idx]] = [next[idx]!, next[picked]!];
      setOrder(next);
    }
    setPicked(null);
  };
  return (
    <div className="answer-panel">
      <p className="muted center" style={{ margin: 0 }}>Ketuk dua kotak untuk menukar, atau pakai panah.</p>
      <ol className="puzzle-list">
        {order.map((it, idx) => (
          <li key={it.i} className={`puzzle-item o${idx % 4} ${picked === idx ? 'picked' : ''}`}>
            <button className="puzzle-text" onClick={() => tap(idx)}>
              <b>{idx + 1}.</b> {it.text}
            </button>
            <button className="mini" onClick={() => move(idx, idx - 1)} disabled={idx === 0} aria-label="Naik">▲</button>
            <button className="mini" onClick={() => move(idx, idx + 1)} disabled={idx === order.length - 1} aria-label="Turun">▼</button>
          </li>
        ))}
      </ol>
      <button className="btn big block" onClick={() => onSubmit(order.map((x) => x.i))}>Kirim urutan</button>
    </div>
  );
}

function SliderAnswer({ cfg, onSubmit }: { cfg: { min: number; max: number; step: number }; onSubmit(a: number): void }) {
  const mid = cfg.min + Math.round((cfg.max - cfg.min) / 2 / cfg.step) * cfg.step;
  const [v, setV] = useState(mid);
  const clamp = (x: number) => Math.min(cfg.max, Math.max(cfg.min, Number(x.toFixed(8))));
  return (
    <div className="answer-panel">
      <div className="slider-value">{fmtNum(v)}</div>
      <input
        className="range"
        type="range"
        min={cfg.min}
        max={cfg.max}
        step={cfg.step}
        value={v}
        aria-label="Nilai"
        onChange={(e) => setV(Number(e.target.value))}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{fmtNum(cfg.min)}</span>
        <div className="row">
          <button className="btn secondary" onClick={() => setV(clamp(v - cfg.step))} aria-label="Kurangi">−</button>
          <button className="btn secondary" onClick={() => setV(clamp(v + cfg.step))} aria-label="Tambah">+</button>
        </div>
        <span className="muted">{fmtNum(cfg.max)}</span>
      </div>
      <button className="btn big block" onClick={() => onSubmit(v)}>Kirim</button>
    </div>
  );
}

/** What the host screen shows while a question is open. */
export function HostQuestionBody({ q, puzzleItems }: { q: Question; puzzleItems: { i: number; text: string }[] | null }) {
  switch (q.type) {
    case 'quiz':
    case 'truefalse':
    case 'poll':
      return (
        <div className={`options ${q.options.length === 2 ? 'two' : ''}`}>
          {q.options.map((o, i) => (
            <div key={i} className={`opt o${i}`}>
              <Shape index={i} />
              <span>{o}</span>
            </div>
          ))}
        </div>
      );
    case 'puzzle':
      return (
        <div className="options">
          {(puzzleItems ?? []).map((it, idx) => (
            <div key={it.i} className={`opt o${idx}`}>
              <Shape index={idx} />
              <span>{it.text}</span>
            </div>
          ))}
        </div>
      );
    case 'slider':
      return (
        <div className="hint-card">
          🎚️ Geser slider di perangkatmu: {fmtNum(q.slider!.min)} – {fmtNum(q.slider!.max)}
        </div>
      );
    case 'typeanswer':
      return <div className="hint-card">⌨️ Ketik jawabanmu di perangkatmu!</div>;
    case 'wordcloud':
      return <div className="hint-card">☁️ Kirim satu kata/frasa dari perangkatmu!</div>;
  }
}

/** Results after reveal on the host screen. */
export function HostResults({ q, results, correctText }: { q: Question; results: QuestionResults; correctText: string | null }) {
  switch (results.kind) {
    case 'options': {
      const max = Math.max(1, ...results.counts);
      const isPoll = q.type === 'poll';
      return (
        <>
          <div className="bars" aria-label="Sebaran jawaban">
            {results.counts.map((n, i) => (
              <div key={i} className="bar-col">
                <div className="bar" style={{ height: `${(n / max) * 100}%`, background: `var(--opt-${i})`, opacity: isPoll || q.correct.includes(i) ? 1 : 0.4 }}>
                  {n}
                </div>
                <Shape index={i} />
              </div>
            ))}
          </div>
          <div className={`options ${q.options.length === 2 ? 'two' : ''}`}>
            {q.options.map((o, i) => {
              const correct = isPoll || q.correct.includes(i);
              return (
                <div key={i} className={`opt o${i} ${!correct ? 'dim' : ''}`}>
                  <Shape index={i} />
                  <span>{o}</span>
                  {!isPoll && correct && <span className="tick">✓</span>}
                </div>
              );
            })}
          </div>
        </>
      );
    }
    case 'puzzle':
      return (
        <>
          <div className="options">
            {q.options.map((o, i) => (
              <div key={i} className={`opt o${i}`}>
                <span className="order-badge">{i + 1}</span>
                <span>{o}</span>
              </div>
            ))}
          </div>
          <p className="pill" style={{ fontSize: 18 }}>✅ {results.correct} benar · ❌ {results.wrong} salah</p>
        </>
      );
    case 'slider': {
      const s = q.slider!;
      const span = s.max - s.min;
      const pct = (v: number) => ((v - s.min) / span) * 100;
      const buckets = new Map<number, number>();
      for (const v of results.values) {
        const b = Math.round(pct(v) / 2) * 2;
        buckets.set(b, (buckets.get(b) ?? 0) + 1);
      }
      const max = Math.max(1, ...buckets.values());
      return (
        <div className="slider-result">
          <div className="slider-track">
            {[...buckets].map(([b, n]) => (
              <div key={b} className="slider-stack" style={{ left: `${b}%`, height: `${20 + (n / max) * 80}%` }} title={`${n}`} />
            ))}
            <div className="slider-answer" style={{ left: `${pct(s.answer)}%` }}>
              <span>{fmtNum(s.answer)}</span>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{fmtNum(s.min)}</span>
            <span>{fmtNum(s.max)}</span>
          </div>
        </div>
      );
    }
    case 'text': {
      if (q.type === 'wordcloud') return <WordCloud entries={results.entries} />;
      return (
        <>
          <div className="hint-card">Jawaban benar: <b>{correctText}</b></div>
          <div className="text-answers">
            {results.entries.length === 0 && <span className="muted">Tidak ada jawaban</span>}
            {results.entries.map((e, i) => (
              <span key={i} className={`text-chip ${e.correct ? 'ok' : ''}`}>
                {e.text} <b>{e.count}</b>
              </span>
            ))}
          </div>
        </>
      );
    }
  }
}

export function WordCloud({ entries }: { entries: { text: string; count: number }[] }) {
  if (!entries.length) return <p className="muted">Belum ada jawaban</p>;
  const max = Math.max(...entries.map((e) => e.count));
  const colors = ['#ffd23f', '#ff8fab', '#7cc6fe', '#b8ff4d', '#ffffff', '#ffb38a'];
  return (
    <div className="wordcloud">
      {entries.map((e, i) => (
        <span key={i} style={{ fontSize: `${18 + (e.count / max) * 46}px`, color: colors[i % colors.length], animationDelay: `${i * 60}ms` }}>
          {e.text}
        </span>
      ))}
    </div>
  );
}
