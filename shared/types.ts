import type { Question } from './schema.js';

export type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'leaderboard' | 'ended';

export interface RankEntry {
  id: string;
  name: string;
  score: number;
  rank: number;
  /** points earned on the last revealed question */
  delta: number;
  streak: number;
  connected: boolean;
}

export interface HostView {
  role: 'host';
  pin: string;
  title: string;
  phase: Phase;
  locked: boolean;
  serverNow: number;
  playerCount: number;
  players: RankEntry[];
  questionIndex: number;
  questionCount: number;
  question: Question | null;
  /** epoch ms (server clock) when the current countdown/question ends */
  deadline: number | null;
  answeredCount: number;
  /** answers per option, shown after reveal */
  distribution: number[] | null;
}

export interface PlayerQuestion {
  type: Question['type'];
  text: string;
  image?: string;
  options: string[];
  timeLimit: number;
  points: Question['points'];
}

export interface PlayerResult {
  correct: boolean;
  answered: boolean;
  points: number;
  correctOptions: number[];
}

export interface PlayerView {
  role: 'player';
  pin: string;
  title: string;
  phase: Phase;
  serverNow: number;
  me: { id: string; name: string; score: number; rank: number; streak: number };
  playerCount: number;
  questionIndex: number;
  questionCount: number;
  question: PlayerQuestion | null;
  deadline: number | null;
  myAnswer: number | null;
  result: PlayerResult | null;
  podium: RankEntry[] | null;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface GameReport {
  id: string;
  quizId: string | null;
  title: string;
  pin: string;
  startedAt: number;
  endedAt: number;
  playerCount: number;
  questions: { text: string; options: string[]; correct: number[]; distribution: number[]; correctRate: number }[];
  ranking: { name: string; score: number; rank: number; correctCount: number }[];
}
