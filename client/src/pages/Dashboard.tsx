import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { firstError, quizSchema, type QuizData } from '../../../shared/schema';
import { api, uid, useToast } from '../lib';
import { Spinner, TopBar } from '../components/ui';
import { SAMPLE_QUIZ } from '../sample';

interface QuizRow {
  id: string;
  title: string;
  questionCount: number;
  updatedAt: number;
}
interface ReportRow {
  id: string;
  title: string;
  playerCount: number;
  endedAt: number;
}

const fmt = (t: number) => new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'quizzes' | 'reports'>('quizzes');
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api<{ quizzes: QuizRow[] }>('/quizzes').then((r) => setQuizzes(r.quizzes)).catch((e) => setError(e.message));
    api<{ reports: ReportRow[] }>('/reports').then((r) => setReports(r.reports)).catch(() => setReports([]));
  };
  useEffect(load, []);

  async function create(data?: QuizData) {
    try {
      const quiz = data ?? { title: 'Kuis tanpa judul', description: '', questions: [blankQuestion()] };
      if (!data) {
        // new empty quiz: go straight to editor without saving an invalid quiz
        navigate('/edit/new', { state: { quiz } });
        return;
      }
      const r = await api<{ id: string }>('/quizzes', { method: 'POST', body: quiz });
      navigate(`/edit/${r.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function remove(q: QuizRow) {
    if (!confirm(`Hapus kuis "${q.title}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await api(`/quizzes/${q.id}`, { method: 'DELETE' });
      setQuizzes((list) => list?.filter((x) => x.id !== q.id) ?? null);
      toast('Kuis dihapus');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function duplicate(q: QuizRow) {
    try {
      await api(`/quizzes/${q.id}/duplicate`, { method: 'POST', body: {} });
      load();
      toast('Kuis disalin');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function exportQuiz(q: QuizRow) {
    try {
      const r = await api<{ quiz: QuizData }>(`/quizzes/${q.id}`);
      const blob = new Blob([JSON.stringify(r.quiz, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${q.title.replace(/[^\w\- ]+/g, '').trim() || 'kuis'}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function importFile(file: File) {
    try {
      if (file.size > 1_000_000) throw new Error('File terlalu besar (maks 1 MB)');
      const raw = JSON.parse(await file.text());
      if (raw && Array.isArray(raw.questions)) {
        raw.questions = raw.questions.map((q: Record<string, unknown>) => ({ ...q, id: typeof q.id === 'string' ? q.id : uid() }));
      }
      const parsed = quizSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`File tidak valid — ${firstError(parsed.error)}`);
      await create(parsed.data);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'File bukan JSON yang valid' : (e as Error).message, true);
    }
  }

  return (
    <>
      <TopBar />
      <main className="container">
        <div className="row" style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <div className="spacer" />
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Impor JSON</button>
          <button className="btn" onClick={() => create()}>+ Buat kuis</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'quizzes'} className={`tab ${tab === 'quizzes' ? 'active' : ''}`} onClick={() => setTab('quizzes')}>
            Kuis saya
          </button>
          <button role="tab" aria-selected={tab === 'reports'} className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
            Laporan
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {tab === 'quizzes' &&
          (quizzes === null ? (
            !error && <div className="center"><Spinner dark /></div>
          ) : quizzes.length === 0 ? (
            <div className="card empty">
              <h2>Belum ada kuis</h2>
              <p className="muted">Buat kuis pertamamu, atau coba kuis contoh dulu.</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => create()}>+ Buat kuis</button>
                <button className="btn secondary" onClick={() => create(SAMPLE_QUIZ())}>Pakai kuis contoh</button>
              </div>
            </div>
          ) : (
            <div className="quiz-grid">
              {quizzes.map((q) => (
                <div key={q.id} className="card quiz-card">
                  <h3>{q.title}</h3>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {q.questionCount} pertanyaan · diubah {fmt(q.updatedAt)}
                  </span>
                  <div className="row">
                    <button className="btn" onClick={() => navigate(`/host/new?quiz=${q.id}`)}>▶ Mainkan</button>
                    <Link className="btn secondary" to={`/edit/${q.id}`}>Edit</Link>
                  </div>
                  <div className="row">
                    <button className="btn ghost sm" onClick={() => duplicate(q)}>Salin</button>
                    <button className="btn ghost sm" onClick={() => exportQuiz(q)}>Ekspor</button>
                    <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => remove(q)}>Hapus</button>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'reports' &&
          (reports === null ? (
            <div className="center"><Spinner dark /></div>
          ) : reports.length === 0 ? (
            <div className="card empty">
              <h2>Belum ada laporan</h2>
              <p className="muted">Laporan otomatis tersimpan setiap kali game selesai.</p>
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Kuis</th><th>Pemain</th><th>Selesai</th><th /></tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      <td>{r.playerCount}</td>
                      <td>{fmt(r.endedAt)}</td>
                      <td><Link to={`/reports/${r.id}`}>Lihat</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </main>
    </>
  );
}

export function blankQuestion(): QuizData['questions'][number] {
  return { id: uid(), type: 'quiz', text: '', image: '', options: ['', '', '', ''], correct: [0], timeLimit: 20, points: 'standard' };
}
