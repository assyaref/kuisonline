import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { firstError, LIMITS, questionSchema, quizSchema, TIME_CHOICES, type Question, type QuizData } from '../../../shared/schema';
import { api, uid, useToast } from '../lib';
import { Shape, Spinner, TopBar } from '../components/ui';
import { blankQuestion } from './Dashboard';

export default function Editor() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const [quiz, setQuiz] = useState<QuizData | null>(() =>
    isNew ? ((location.state as { quiz?: QuizData } | null)?.quiz ?? { title: 'Kuis tanpa judul', description: '', questions: [blankQuestion()] }) : null,
  );
  const [active, setActive] = useState(0);
  const [dirty, setDirty] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew) return;
    api<{ quiz: QuizData }>(`/quizzes/${id}`)
      .then((r) => setQuiz({ ...r.quiz, questions: r.quiz.questions.map((q) => ({ image: '', ...q })) }))
      .catch((e) => setError(e.message));
  }, [id, isNew]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const invalid = useMemo(() => quiz?.questions.map((q) => !questionSchema.safeParse(q).success) ?? [], [quiz]);

  if (error && !quiz) return (<><TopBar /><main className="container"><p className="error">{error}</p></main></>);
  if (!quiz) return (<><TopBar /><main className="container center"><Spinner dark /></main></>);

  const q = quiz.questions[Math.min(active, quiz.questions.length - 1)]!;
  const qi = quiz.questions.indexOf(q);

  const update = (patch: Partial<QuizData>) => {
    setQuiz({ ...quiz, ...patch });
    setDirty(true);
  };
  const updateQ = (patch: Partial<Question>) => {
    const questions = quiz.questions.slice();
    questions[qi] = { ...q, ...patch };
    update({ questions });
  };

  function setType(type: Question['type']) {
    if (type === q.type) return;
    if (type === 'truefalse') updateQ({ type, options: ['Benar', 'Salah'], correct: [0] });
    else updateQ({ type, options: ['', '', '', ''], correct: [0] });
  }

  function toggleCorrect(i: number) {
    const has = q.correct.includes(i);
    if (q.type === 'truefalse') return updateQ({ correct: [i] });
    if (has && q.correct.length === 1) return; // at least one
    updateQ({ correct: has ? q.correct.filter((c) => c !== i) : [...q.correct, i].sort() });
  }

  function removeOption(i: number) {
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, j) => j !== i);
    let correct = q.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
    if (!correct.length) correct = [0];
    updateQ({ options, correct });
  }

  function addQuestion() {
    if (quiz!.questions.length >= LIMITS.questionsMax) return toast(`Maksimal ${LIMITS.questionsMax} pertanyaan`, true);
    const questions = [...quiz!.questions];
    questions.splice(qi + 1, 0, { ...blankQuestion(), timeLimit: q.timeLimit });
    update({ questions });
    setActive(qi + 1);
  }

  function duplicateQuestion() {
    if (quiz!.questions.length >= LIMITS.questionsMax) return;
    const questions = [...quiz!.questions];
    questions.splice(qi + 1, 0, { ...q, id: uid(), options: [...q.options], correct: [...q.correct] });
    update({ questions });
    setActive(qi + 1);
  }

  function deleteQuestion() {
    if (quiz!.questions.length <= 1) return toast('Kuis butuh minimal 1 pertanyaan', true);
    update({ questions: quiz!.questions.filter((_, j) => j !== qi) });
    setActive(Math.max(0, qi - 1));
  }

  function move(dir: -1 | 1) {
    const j = qi + dir;
    if (j < 0 || j >= quiz!.questions.length) return;
    const questions = [...quiz!.questions];
    [questions[qi], questions[j]] = [questions[j]!, questions[qi]!];
    update({ questions });
    setActive(j);
  }

  async function save(thenPlay = false) {
    const parsed = quizSchema.safeParse(quiz);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path;
      if (path?.[0] === 'questions' && typeof path[1] === 'number') setActive(path[1]);
      setError(firstError(parsed.error));
      return;
    }
    setError('');
    setSaving(true);
    try {
      let quizId = id!;
      if (isNew) {
        quizId = (await api<{ id: string }>('/quizzes', { method: 'POST', body: parsed.data })).id;
      } else {
        await api(`/quizzes/${id}`, { method: 'PUT', body: parsed.data });
      }
      setDirty(false);
      toast('Tersimpan ✓');
      if (thenPlay) navigate(`/host/new?quiz=${quizId}`);
      else if (isNew) navigate(`/edit/${quizId}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function back() {
    if (dirty && !confirm('Ada perubahan yang belum disimpan. Tetap keluar?')) return;
    navigate('/dashboard');
  }

  return (
    <>
      <TopBar>
        <button className="btn ghost sm" onClick={back}>← Kembali</button>
        <button className="btn secondary sm" onClick={() => save(false)} disabled={saving}>
          {saving ? 'Menyimpan…' : dirty ? 'Simpan' : 'Tersimpan'}
        </button>
        <button className="btn sm" onClick={() => save(true)} disabled={saving}>Simpan & Main</button>
      </TopBar>
      <main className="container" style={{ maxWidth: 1200 }}>
        <div className="card" style={{ marginBottom: 18 }}>
          <label className="field">
            <span>Judul kuis</span>
            <input className="input" value={quiz.title} maxLength={LIMITS.titleMax} onChange={(e) => update({ title: e.target.value })} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>Deskripsi (opsional)</span>
            <input className="input" value={quiz.description} maxLength={LIMITS.descMax} onChange={(e) => update({ description: e.target.value })} />
          </label>
        </div>
        {error && <p className="error" role="alert">⚠ {error}</p>}

        <div className="editor">
          <nav className="q-list" aria-label="Daftar pertanyaan">
            {quiz.questions.map((x, i) => (
              <button key={x.id} className={`q-item ${i === qi ? 'active' : ''} ${invalid[i] ? 'invalid' : ''}`} onClick={() => setActive(i)}>
                <small>{i + 1}. {x.type === 'truefalse' ? 'Benar/Salah' : 'Pilihan ganda'}{invalid[i] ? ' · belum lengkap' : ''}</small>
                <div>{x.text || <i className="muted">(belum ada teks)</i>}</div>
              </button>
            ))}
            <button className="btn secondary" onClick={addQuestion}>+ Pertanyaan</button>
          </nav>

          <section className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <b>Pertanyaan {qi + 1} dari {quiz.questions.length}</b>
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => move(-1)} disabled={qi === 0} aria-label="Pindah ke atas">↑</button>
              <button className="btn ghost sm" onClick={() => move(1)} disabled={qi === quiz.questions.length - 1} aria-label="Pindah ke bawah">↓</button>
              <button className="btn ghost sm" onClick={duplicateQuestion}>Salin</button>
              <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={deleteQuestion}>Hapus</button>
            </div>

            <div className="row" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
                <span>Tipe</span>
                <select className="input" value={q.type} onChange={(e) => setType(e.target.value as Question['type'])}>
                  <option value="quiz">Pilihan ganda</option>
                  <option value="truefalse">Benar / Salah</option>
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 120px', marginBottom: 0 }}>
                <span>Batas waktu</span>
                <select className="input" value={q.timeLimit} onChange={(e) => updateQ({ timeLimit: Number(e.target.value) })}>
                  {TIME_CHOICES.map((t) => <option key={t} value={t}>{t} detik</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                <span>Poin</span>
                <select className="input" value={q.points} onChange={(e) => updateQ({ points: e.target.value as Question['points'] })}>
                  <option value="standard">Standar</option>
                  <option value="double">Ganda (2×)</option>
                  <option value="none">Tanpa poin</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>Pertanyaan</span>
              <textarea className="input" style={{ fontSize: 20, fontWeight: 700 }} value={q.text} maxLength={LIMITS.questionMax} placeholder="Tulis pertanyaanmu…" onChange={(e) => updateQ({ text: e.target.value })} />
            </label>
            <label className="field">
              <span>URL gambar (opsional, https://)</span>
              <input className="input" value={q.image ?? ''} placeholder="https://contoh.com/gambar.jpg" onChange={(e) => updateQ({ image: e.target.value })} />
            </label>
            {q.image && /^https:\/\//.test(q.image) && (
              <img src={q.image} alt="" referrerPolicy="no-referrer" style={{ maxHeight: 180, borderRadius: 10, marginBottom: 14 }} />
            )}

            <p className="muted" style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>
              Pilihan jawaban — klik ✓ untuk menandai jawaban benar{q.type === 'quiz' ? ' (boleh lebih dari satu)' : ''}
            </p>
            <div className="opt-grid">
              {q.options.map((o, i) => (
                <div key={i} className="opt-edit" style={{ background: `var(--opt-${i})` }}>
                  <Shape index={i} />
                  <input
                    className="input"
                    value={o}
                    maxLength={LIMITS.optionMax}
                    placeholder={`Jawaban ${i + 1}`}
                    readOnly={q.type === 'truefalse'}
                    onChange={(e) => {
                      const options = q.options.slice();
                      options[i] = e.target.value;
                      updateQ({ options });
                    }}
                  />
                  <button
                    type="button"
                    className={`correct-toggle ${q.correct.includes(i) ? 'on' : ''}`}
                    onClick={() => toggleCorrect(i)}
                    aria-pressed={q.correct.includes(i)}
                    aria-label={`Tandai jawaban ${i + 1} benar`}
                  >
                    ✓
                  </button>
                  {q.type === 'quiz' && q.options.length > 2 && (
                    <button type="button" className="correct-toggle" style={{ borderWidth: 0 }} onClick={() => removeOption(i)} aria-label={`Hapus jawaban ${i + 1}`}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {q.type === 'quiz' && q.options.length < 4 && (
              <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => updateQ({ options: [...q.options, ''] })}>
                + Tambah pilihan
              </button>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
