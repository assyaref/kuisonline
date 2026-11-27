import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_SETTINGS, firstError, quizSchema, type QuizData } from '../../../shared/schema';
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
interface AssignmentRow {
  id: string;
  pin: string;
  title: string;
  createdAt: number;
  deadline: number;
  open: boolean;
  playerCount: number;
}

type Tab = 'quizzes' | 'assignments' | 'reports';

export const fmt = (t: number) => new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'quizzes');
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [assignFor, setAssignFor] = useState<QuizRow | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api<{ quizzes: QuizRow[] }>('/quizzes').then((r) => setQuizzes(r.quizzes)).catch((e) => setError(e.message));
    api<{ reports: ReportRow[] }>('/reports').then((r) => setReports(r.reports)).catch(() => setReports([]));
    api<{ assignments: AssignmentRow[] }>('/assignments').then((r) => setAssignments(r.assignments)).catch(() => setAssignments([]));
  };
  useEffect(load, []);

  async function create(data?: QuizData) {
    try {
      if (!data) {
        navigate('/edit/new', { state: { quiz: { title: 'Kuis tanpa judul', description: '', public: false, questions: [blankQuestion()] } } });
        return;
      }
      const r = await api<{ id: string }>('/quizzes', { method: 'POST', body: data });
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

  async function share(q: QuizRow) {
    try {
      const r = await api<{ quiz: QuizData }>(`/quizzes/${q.id}`);
      if (!r.quiz.public) {
        if (!confirm('Kuis ini masih privat. Jadikan publik agar bisa dibagikan?')) return;
        await api(`/quizzes/${q.id}`, { method: 'PUT', body: { ...r.quiz, public: true } });
      }
      const url = `${location.origin}/q/${q.id}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast('Link kuis disalin: ' + url);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function exportQuiz(q: QuizRow) {
    try {
      const r = await api<{ quiz: QuizData }>(`/quizzes/${q.id}`);
      download(`${q.title.replace(/[^\w\- ]+/g, '').trim() || 'kuis'}.json`, JSON.stringify(r.quiz, null, 2), 'application/json');
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

  async function closeAssignment(a: AssignmentRow) {
    if (!confirm(`Tutup tugas "${a.title}"? Pemain tidak bisa lanjut mengerjakan.`)) return;
    try {
      await api(`/assignments/${a.id}/close`, { method: 'POST', body: {} });
      load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <TopBar />
      <main className="container">
        <div className="row" style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <div className="spacer" />
          <Link className="btn ghost" to="/jelajahi">🔎 Jelajahi</Link>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Impor JSON</button>
          <button className="btn" onClick={() => create()}>+ Buat kuis</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        </div>

        <div className="tabs" role="tablist">
          {([['quizzes', 'Kuis saya'], ['assignments', 'Tugas'], ['reports', 'Laporan']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        {tab === 'quizzes' &&
          (quizzes === null ? (
            !error && <div className="center"><Spinner dark /></div>
          ) : quizzes.length === 0 ? (
            <div className="card empty">
              <h2>Belum ada kuis</h2>
              <p className="muted">Buat kuis pertamamu, atau coba kuis contoh berisi semua tipe soal.</p>
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
                  <span className="muted" style={{ fontSize: 14 }}>{q.questionCount} pertanyaan · diubah {fmt(q.updatedAt)}</span>
                  <div className="row">
                    <button className="btn" onClick={() => navigate(`/host/new?quiz=${q.id}`)}>▶ Mainkan</button>
                    <button className="btn secondary" onClick={() => setAssignFor(q)}>📝 Tugaskan</button>
                    <Link className="btn secondary" to={`/edit/${q.id}`}>Edit</Link>
                  </div>
                  <div className="row">
                    <button className="btn ghost sm" onClick={() => share(q)}>Bagikan</button>
                    <button className="btn ghost sm" onClick={() => duplicate(q)}>Salin</button>
                    <button className="btn ghost sm" onClick={() => exportQuiz(q)}>Ekspor</button>
                    <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => remove(q)}>Hapus</button>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'assignments' &&
          (assignments === null ? (
            <div className="center"><Spinner dark /></div>
          ) : assignments.length === 0 ? (
            <div className="card empty">
              <h2>Belum ada tugas</h2>
              <p className="muted">Tugas = kuis yang dikerjakan pemain kapan saja sesuai kecepatan masing-masing sampai batas waktu. Klik “Tugaskan” pada kuis.</p>
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Kuis</th><th>PIN</th><th>Pemain</th><th>Batas waktu</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.title}</td>
                      <td><b>{a.pin}</b></td>
                      <td>{a.playerCount}</td>
                      <td>{fmt(a.deadline)}</td>
                      <td>{a.open ? <span style={{ color: 'var(--ok)', fontWeight: 700 }}>Aktif</span> : <span className="muted">Ditutup</span>}</td>
                      <td className="row" style={{ flexWrap: 'nowrap' }}>
                        <Link className="btn ghost sm" to={`/tugas-laporan/${a.id}`}>Hasil</Link>
                        {a.open && <button className="btn ghost sm" onClick={() => closeAssignment(a)}>Tutup</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === 'reports' &&
          (reports === null ? (
            <div className="center"><Spinner dark /></div>
          ) : reports.length === 0 ? (
            <div className="card empty">
              <h2>Belum ada laporan</h2>
              <p className="muted">Laporan otomatis tersimpan setiap kali game live selesai.</p>
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Kuis</th><th>Pemain</th><th>Selesai</th><th /></tr></thead>
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
      {assignFor && <AssignDialog quiz={assignFor} onClose={() => setAssignFor(null)} onCreated={() => { load(); setTab('assignments'); }} />}
    </>
  );
}

function AssignDialog({ quiz, onClose, onCreated }: { quiz: QuizRow; onClose(): void; onCreated(): void }) {
  const toast = useToast();
  const [hours, setHours] = useState(24);
  const [randomizeQuestions, setRQ] = useState(false);
  const [randomizeAnswers, setRA] = useState(false);
  const [nameGenerator, setNG] = useState(false);
  const [created, setCreated] = useState<{ pin: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ id: string; pin: string }>('/assignments', {
        method: 'POST',
        body: { quizId: quiz.id, hours, settings: { ...DEFAULT_SETTINGS, randomizeQuestions, randomizeAnswers, nameGenerator } },
      });
      setCreated(r);
      onCreated();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const link = created ? `${location.origin}/?pin=${created.pin}` : '';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Tugaskan kuis" onClick={(e) => e.stopPropagation()}>
        {created ? (
          <>
            <h2>Tugas dibuat! 📝</h2>
            <p className="muted">Bagikan PIN atau link ini ke pemain. Mereka bisa mengerjakan kapan saja sebelum batas waktu.</p>
            <div className="big-pin" style={{ fontSize: 56, color: 'var(--brand)' }}>{created.pin}</div>
            <div className="row">
              <input className="input" readOnly value={link} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => { void navigator.clipboard?.writeText(link); toast('Link disalin'); }}>Salin</button>
            </div>
            <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onClose}>Tutup</button>
          </>
        ) : (
          <>
            <h2>Tugaskan “{quiz.title}”</h2>
            <label className="field">
              <span>Batas waktu pengerjaan</span>
              <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {[[1, '1 jam'], [3, '3 jam'], [12, '12 jam'], [24, '1 hari'], [72, '3 hari'], [168, '1 minggu'], [336, '2 minggu'], [720, '30 hari']].map(([h, l]) => (
                  <option key={h} value={h}>{l}</option>
                ))}
              </select>
            </label>
            <label className="toggle-row"><input type="checkbox" checked={randomizeQuestions} onChange={(e) => setRQ(e.target.checked)} /><span><b>Acak urutan pertanyaan</b></span></label>
            <label className="toggle-row"><input type="checkbox" checked={randomizeAnswers} onChange={(e) => setRA(e.target.checked)} /><span><b>Acak urutan jawaban</b></span></label>
            <label className="toggle-row"><input type="checkbox" checked={nameGenerator} onChange={(e) => setNG(e.target.checked)} /><span><b>Generator nama lucu</b></span></label>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={onClose}>Batal</button>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={submit}>{busy ? 'Membuat…' : 'Buat tugas'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function blankQuestion(): QuizData['questions'][number] {
  return { id: uid(), type: 'quiz', text: '', image: '', options: ['', '', '', ''], correct: [0], accepted: [], timeLimit: 20, points: 'standard' };
}
