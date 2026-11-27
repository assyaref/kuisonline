/**
 * Tiny Web Audio synthesizer: original looping music and sound effects, no audio files.
 * Browsers only allow audio after a user gesture, so call `sound.unlock()` from a click handler.
 */
import { storage } from './lib';

type Track = 'lobby' | 'question' | null;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// ---- original compositions (8th-note steps) ----
// Lobby: bouncy I–vi–IV–V in F major, 112 bpm
const LOBBY = {
  bpm: 112,
  chords: [
    [53, 57, 60], [53, 57, 60], [50, 53, 57], [50, 53, 57],
    [46, 50, 53], [46, 50, 53], [48, 52, 55], [48, 52, 55],
  ], // one chord per 4 steps
  bass: [41, null, 41, 48, 38, null, 38, 45, 34, null, 34, 41, 36, null, 36, 43],
  lead: [
    72, null, 69, 72, 74, null, 72, null, 69, null, 65, 69, 72, null, null, null,
    70, null, 69, 70, 72, null, 70, 69, 67, null, 64, 67, 72, null, 74, null,
  ],
};
// Question: driving A-minor pulse, 148 bpm
const QUESTION = {
  bpm: 148,
  bass: [45, 45, 57, 45, 45, 57, 45, 48, 43, 43, 55, 43, 41, 41, 53, 40],
  lead: [
    null, null, 76, null, null, 74, null, 72, null, null, 71, null, 72, null, 69, null,
    null, null, 76, null, null, 77, null, 76, null, null, 74, null, 72, null, 71, null,
  ],
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track = null;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  muted = storage.get<boolean>('gk_muted') ?? false;
  private listeners = new Set<() => void>();

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.55;
      this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMuted(m: boolean) {
    this.muted = m;
    storage.set('gk_muted', m);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    this.listeners.forEach((l) => l());
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // ---------- primitives ----------
  private tone(freq: number, t: number, dur: number, opts: { type?: OscillatorType; gain?: number; dest?: AudioNode; slide?: number; attack?: number } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'triangle';
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.dest ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hit(t: number, opts: { dur?: number; gain?: number; freq?: number; dest?: AudioNode; type?: BiquadFilterType } = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'highpass';
    f.frequency.value = opts.freq ?? 7000;
    const g = ctx.createGain();
    const dur = opts.dur ?? 0.05;
    g.gain.setValueAtTime(opts.gain ?? 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(opts.dest ?? this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private kick(t: number, dest: AudioNode, gain = 0.5) {
    this.tone(120, t, 0.18, { type: 'sine', gain, slide: 0.35, dest, attack: 0.002 });
  }

  // ---------- music ----------
  play(track: Track) {
    if (track === this.track) return;
    this.track = track;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!track || !this.ctx) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop() {
    this.play(null);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.track) return;
    const song = this.track === 'lobby' ? LOBBY : QUESTION;
    const stepDur = 60 / song.bpm / 2;
    // if the tab was in the background, skip ahead instead of bursting notes
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.track, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(track: 'lobby' | 'question', s: number, t: number, d: number) {
    const dest = this.musicGain!;
    if (track === 'lobby') {
      const i16 = s % 16;
      const bass = LOBBY.bass[i16];
      if (bass) this.tone(midi(bass), t, d * 1.6, { type: 'sine', gain: 0.32, dest });
      if (s % 4 === 0) this.kick(t, dest, 0.35);
      if (s % 2 === 1) this.hit(t, { gain: 0.05, dest });
      if (s % 8 === 4) this.hit(t, { gain: 0.12, dur: 0.12, freq: 1800, type: 'bandpass', dest });
      const chord = LOBBY.chords[Math.floor(s / 4) % LOBBY.chords.length]!;
      if (s % 4 === 2) chord.forEach((n) => this.tone(midi(n + 12), t, d * 1.5, { type: 'square', gain: 0.025, dest }));
      const lead = LOBBY.lead[s % LOBBY.lead.length];
      if (lead) this.tone(midi(lead), t, d * 1.8, { type: 'triangle', gain: 0.09, dest });
    } else {
      const bass = QUESTION.bass[s % 16];
      if (bass) this.tone(midi(bass), t, d * 0.9, { type: 'sawtooth', gain: 0.07, dest });
      if (s % 2 === 0) this.kick(t, dest, 0.3);
      this.hit(t, { gain: s % 2 ? 0.03 : 0.06, dest });
      const lead = QUESTION.lead[s % QUESTION.lead.length];
      if (lead) this.tone(midi(lead), t, d * 1.4, { type: 'square', gain: 0.03, dest });
    }
  }

  // ---------- sound effects ----------
  private sfx(fn: (t: number) => void) {
    if (!this.ctx || this.muted) return;
    fn(this.ctx.currentTime + 0.01);
  }

  join() {
    this.sfx((t) => {
      this.tone(midi(84), t, 0.09, { type: 'square', gain: 0.06 });
      this.tone(midi(91), t + 0.07, 0.12, { type: 'square', gain: 0.06 });
    });
  }
  tick(urgent = false) {
    this.sfx((t) => this.tone(urgent ? 1400 : 1000, t, 0.05, { type: 'square', gain: urgent ? 0.1 : 0.05 }));
  }
  go() {
    this.sfx((t) => [60, 64, 67, 72].forEach((n, i) => this.tone(midi(n + 12), t + i * 0.06, 0.25, { type: 'square', gain: 0.07 })));
  }
  timeUp() {
    this.sfx((t) => {
      this.tone(midi(43), t, 1.2, { type: 'triangle', gain: 0.35 });
      this.tone(midi(55), t, 1.0, { type: 'sine', gain: 0.2 });
      this.hit(t, { dur: 0.6, gain: 0.15, freq: 900, type: 'lowpass' });
    });
  }
  correct() {
    this.sfx((t) => [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.08, 0.3, { type: 'triangle', gain: 0.18 })));
  }
  wrong() {
    this.sfx((t) => {
      this.tone(220, t, 0.25, { type: 'sawtooth', gain: 0.08, slide: 0.7 });
      this.tone(165, t + 0.22, 0.4, { type: 'sawtooth', gain: 0.08, slide: 0.6 });
    });
  }
  whoosh() {
    this.sfx((t) => this.hit(t, { dur: 0.35, gain: 0.12, freq: 1200, type: 'bandpass' }));
  }
  pop() {
    this.sfx((t) => this.tone(600 + Math.random() * 400, t, 0.08, { type: 'sine', gain: 0.12, slide: 1.8 }));
  }
  drumroll(seconds: number) {
    this.sfx((t) => {
      for (let x = 0; x < seconds; x += 0.045) this.hit(t + x, { gain: 0.04 + (x / seconds) * 0.12, dur: 0.05, freq: 2500, type: 'bandpass' });
    });
  }
  fanfare() {
    this.sfx((t) => {
      const seq: [number, number, number][] = [
        [67, 0, 0.15], [67, 0.15, 0.15], [67, 0.3, 0.15], [72, 0.45, 0.6], [76, 1.05, 0.25], [79, 1.3, 0.9],
      ];
      for (const [n, at, dur] of seq) {
        this.tone(midi(n), t + at, dur, { type: 'sawtooth', gain: 0.08 });
        this.tone(midi(n - 12), t + at, dur, { type: 'triangle', gain: 0.12 });
      }
      this.hit(t + 1.3, { dur: 1.2, gain: 0.12, freq: 5000 });
    });
  }
}

export const sound = new SoundEngine();
