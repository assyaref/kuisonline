import type { Avatar } from './avatar.js';
import type { GameSettings, Question, QuestionType } from './schema.js';

export type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'leaderboard' | 'ended';

export interface RankEntry {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  rank: number;
  /** rank before the last revealed question (for animated reordering) */
  prevRank: number;
  /** points earned on the last revealed question */
  delta: number;
  streak: number;
  connected: boolean;
  teamId: number | null;
}

export interface TeamEntry {
  id: number;
  name: string;
  color: string;
  score: number;
  rank: number;
  prevRank: number;
  members: number;
}

export type QuestionResults =
  | { kind: 'options'; counts: number[] }
  | { kind: 'puzzle'; correct: number; wrong: number }
  | { kind: 'slider'; values: number[] }
  | { kind: 'text'; entries: { text: string; count: number; correct: boolean }[] };

/** What the question looks like on a player's device (never contains the solution). */
export interface PlayerQuestion {
  type: QuestionType;
  text: string | null;
  image?: string;
  /** options for quiz / truefalse / poll */
  options: string[];
  /** shuffled items for puzzle, with their original index */
  items: { i: number; text: string }[];
  slider: { min: number; max: number; step: number } | null;
  timeLimit: number;
  points: Question['points'];
}

export interface HostView {
  role: 'host';
  pin: string;
  title: string;
  phase: Phase;
  locked: boolean;
  settings: GameSettings;
  serverNow: number;
  playerCount: number;
  players: RankEntry[];
  teams: TeamEntry[] | null;
  questionIndex: number;
  questionCount: number;
  question: Question | null;
  /** shuffled puzzle order shown while the question is open */
  puzzleItems: { i: number; text: string }[] | null;
  deadline: number | null;
  answeredCount: number;
  results: QuestionResults | null;
  correctText: string | null;
}

export interface PlayerResult {
  scored: boolean;
  correct: boolean;
  answered: boolean;
  points: number;
  correctText: string;
}

export interface PlayerView {
  role: 'player';
  pin: string;
  title: string;
  phase: Phase;
  serverNow: number;
  me: { id: string; name: string; avatar: Avatar; score: number; rank: number; streak: number; rerollsLeft: number };
  team: TeamEntry | null;
  behind: { name: string; gap: number } | null;
  nameGenerator: boolean;
  playerCount: number;
  questionIndex: number;
  questionCount: number;
  question: PlayerQuestion | null;
  deadline: number | null;
  answered: boolean;
  result: PlayerResult | null;
  podium: RankEntry[] | null;
  teamPodium: TeamEntry[] | null;
}

export type AnswerValue = number | number[] | string;

export interface GameReport {
  id: string;
  quizId: string | null;
  title: string;
  pin: string;
  mode: 'live' | 'assignment';
  startedAt: number;
  endedAt: number;
  playerCount: number;
  questions: {
    type: QuestionType;
    text: string;
    correctText: string;
    scored: boolean;
    correctRate: number;
    summary: string;
  }[];
  ranking: { name: string; score: number; rank: number; correctCount: number; team?: string }[];
  teams?: { name: string; score: number; rank: number; members: number }[];
}
