import type { Question, QuizData } from '../../shared/schema';
import { uid } from './lib';

const base = (q: Partial<Question>): Question => ({
  id: uid(),
  type: 'quiz',
  text: '',
  image: '',
  options: [],
  correct: [],
  accepted: [],
  timeLimit: 20,
  points: 'standard',
  ...q,
});

export const SAMPLE_QUIZ = (): QuizData => ({
  title: 'Pengetahuan Umum Indonesia',
  description: 'Kuis contoh berisi semua tipe soal GasKuis.',
  public: false,
  questions: [
    base({ text: 'Apa ibu kota provinsi Jawa Barat?', options: ['Semarang', 'Bandung', 'Bogor', 'Cirebon'], correct: [1] }),
    base({ type: 'truefalse', text: 'Danau Toba terletak di Pulau Sumatra.', options: ['Benar', 'Salah'], correct: [0], timeLimit: 10 }),
    base({ type: 'typeanswer', text: 'Hewan purba asal NTT yang jadi ikon Indonesia?', accepted: ['Komodo', 'Biawak komodo'], timeLimit: 30 }),
    base({ type: 'puzzle', text: 'Urutkan pulau dari yang TERBESAR ke terkecil', options: ['Kalimantan', 'Sumatra', 'Sulawesi', 'Jawa'], timeLimit: 45 }),
    base({ type: 'slider', text: 'Tahun berapa Indonesia merdeka?', slider: { min: 1900, max: 2000, step: 1, answer: 1945, margin: 'low' }, timeLimit: 30 }),
    base({ type: 'quiz', text: 'Gunung tertinggi di Indonesia adalah…', options: ['Semeru', 'Rinjani', 'Kerinci', 'Puncak Jaya'], correct: [3], points: 'double' }),
    base({ type: 'poll', text: 'Makanan khas favoritmu?', options: ['Rendang', 'Sate', 'Gudeg', 'Pempek'], points: 'none' }),
    base({ type: 'wordcloud', text: 'Satu kata untuk menggambarkan Indonesia!', points: 'none', timeLimit: 30 }),
  ],
});
