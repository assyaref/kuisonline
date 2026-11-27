import type { QuizData } from '../../shared/schema';
import { uid } from './lib';

export const SAMPLE_QUIZ = (): QuizData => ({
  title: 'Pengetahuan Umum Indonesia',
  description: 'Kuis contoh untuk mencoba GasKuis.',
  questions: [
    { id: uid(), type: 'quiz', text: 'Apa ibu kota provinsi Jawa Barat?', image: '', options: ['Semarang', 'Bandung', 'Bogor', 'Cirebon'], correct: [1], timeLimit: 20, points: 'standard' },
    { id: uid(), type: 'truefalse', text: 'Danau Toba terletak di Pulau Sumatra.', image: '', options: ['Benar', 'Salah'], correct: [0], timeLimit: 10, points: 'standard' },
    { id: uid(), type: 'quiz', text: 'Berapa jumlah sila dalam Pancasila?', image: '', options: ['3', '4', '5', '6'], correct: [2], timeLimit: 10, points: 'standard' },
    { id: uid(), type: 'quiz', text: 'Gunung tertinggi di Indonesia adalah…', image: '', options: ['Semeru', 'Rinjani', 'Kerinci', 'Puncak Jaya'], correct: [3], timeLimit: 20, points: 'double' },
    { id: uid(), type: 'quiz', text: 'Komodo adalah hewan asli dari provinsi…', image: '', options: ['NTT', 'Bali', 'NTB', 'Maluku'], correct: [0], timeLimit: 20, points: 'standard' },
  ],
});
