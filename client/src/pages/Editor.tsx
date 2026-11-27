import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  firstError,
  LIMITS,
  QUESTION_TYPE_LABEL,
  QUESTION_TYPES,
  questionSchema,
  quizSchema,
  SCORED_TYPES,
  SLIDER_MARGIN_LABEL,
  SLIDER_MARGINS,
  TIME_CHOICES,
  type Question,
  type QuestionType,
  type QuizData,
} from '../../../shared/schema';
import { api, uid, useToast } from '../lib';
import { Shape, Spinner, TopBar } from '../components/ui';
import { blankQuestion } from './Dashboard';

const TYPE_ICON: Record<QuestionType, string> = {
  quiz: '🔘', truefalse: '⚖️', typeanswer: '⌨️', puzzle: '🧩', slider: '🎚️', poll: '📊', wordcloud: '☁️',
};

export function convertType(q: Question, type: QuestionType): Question {
  const base = { ...q, type, correct: [] as number[], accepted: [] as string[], slider: undefined as Question['slider'] };
  switch (type) {
    case 'quiz':
      return { ...base, options: padOptions(q.options, 4), correct: [0] };
    case 'truefalse':
      return { ...base, options: ['Benar', 'Salah'], correct: [0] };
    case 'poll':
      return { ...base, options: padOptions(q.options, 4), points: 'none' };
    case 'puzzle':
      return { ...base, options: padOptions(q.options, 4) };
    case 'typeanswer':
      return { ...base, options: [], accepted: [''] };
    case 'slider':
      return { ...base, options: [], slider: { min: 0, max: 100, step: 1, answer: 50, margin: 'medium' } };
    case 'wordcloud':
      return { ...base, options: [], points: 'none' };
  }
}

function padOptions(opts: string[], n: number) {
  const o = opts.filter((x) => x !== 'Benar' && x !== 'Salah').slice(0, n);
  while (o.length < n) o.push('');
  return o;
}

export default function Editor() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const [quiz, setQuiz] = useState<QuizData | null>(() =>
    isNew
      ? ((location.state as { quiz?: QuizData } | null)?.quiz ?? { title: 'Kuis tanpa judul', description: '', public: false, questions: [blankQuestion()] })
      : null,
  );
  const [active, setActive] = useState(0);
  const [dirty, setDirty] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNew) return;
    api<{ quiz: QuizData }>(`/quizzes/${id}`)
      .then((r) =>
        setQuiz({
          ...r.quiz,
          public: r.quiz.public ?? false,
          questions: r.quiz.questions.map((q) => ({ ...q, image: q.image ?? '', accepted: q.accepted ?? [], correct: q.correct ?? [], options: q.options ?? [] })),
        }),
      )
      .catch((e) => setError(e.message));
  }, [id, isNew]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const invalid = useMemo(() => quiz?.questions.map((q) => !questionSchema.safeParse(q).success) ?? [], [quiz]);

  if (error && !quiz) return (<><TopBar /><main className="container"><p className="error">{error}</p></main></>);
  if (!quiz) return (<><TopBar /><main className="container center"><Spinner dark /></main></>);

  const q = quiz.questions[Math.min(active, quiz.questions.length - 1)]!;
  const qi = quiz.questions.indexOf(q);
  const scoredType = SCORED_TYPES.has(q.type);

  const update = (patch: Partial<QuizData>) => {
    setQuiz({ ...quiz, ...patch });
    setDirty(true);
  };
  const updateQ = (patch: Partial<Question>) => {
    const questions = quiz.questions.slice();
    questions[qi] = { ...q, ...patch };
    update({ questions });
  };

  function toggleCorrect(i: number) {
    const has = q.correct.includes(i);
    if (q.type === 'truefalse') return updateQ({ correct: [i] });
    if (has && q.correct.length === 1) return;
    updateQ({ correct: has ? q.correct.filter((c) => c !== i) : [...q.correct, i].sort() });
  }

  function removeOption(i: number) {
    const min = q.type === 'puzzle' ? 3 : 2;
    if (q.options.length <= min) return;
    const options = q.options.filter((_, j) => j !== i);
    let correct = q.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
    if (!correct.length && q.type === 'quiz') correct = [0];
    updateQ({ options, correct });
  }

  function addQuestion(type: QuestionType = 'quiz') {
    if (quiz!.questions.length >= LIMITS.questionsMax) return toast(`Maksimal ${LIMITS.questionsMax} pertanyaan`, true);
    const questions = [...quiz!.questions];
    questions.splice(qi + 1, 0, convertType({ ...blankQuestion(), timeLimit: q.timeLimit }, type));
    update({ questions });
    setActive(qi + 1);
  }

  function duplicateQuestion() {
    if (quiz!.questions.length >= LIMITS.questionsMax) return;
    const questions = [...quiz!.questions];
    questions.splice(qi + 1, 0, structuredClone({ ...q, id: uid() }));
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

  async function upload(file: File) {
    if (file.size > LIMITS.imageMaxBytes) return toast('Gambar maksimal 2 MB', true);
    setUploading(true);
    try {
      const res = await fetch('/api/images', { method: 'POST', body: file, headers: { 'content-type': file.type || 'image/png' }, credentials: 'same-origin' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload gagal');
      updateQ({ image: data.url });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setUploading(false);
    }
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
      if (isNew) quizId = (await api<{ id: string }>('/quizzes', { method: 'POST', body: parsed.data })).id;
      else await api(`/quizzes/${id}`, { method: 'PUT', body: parsed.data });
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

  const s = q.slider;
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
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <label className="field" style={{ flex: '2 1 260px' }}>
              <span>Judul kuis</span>
              <input className="input" value={quiz.title} maxLength={LIMITS.titleMax} onChange={(e) => update({ title: e.target.value })} />
            </label>
            <label className="field" style={{ flex: '3 1 260px' }}>
              <span>Deskripsi (opsional)</span>
              <input className="input" value={quiz.description} maxLength={LIMITS.descMax} onChange={(e) => update({ description: e.target.value })} />
            </label>
          </div>
          <label className="toggle-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={quiz.public} onChange={(e) => update({ public: e.target.checked })} />
            <span>
              <b>Publik</b>
              <small>Kuis bisa ditemukan di halaman Jelajahi dan disalin oleh host lain</small>
            </span>
          </label>
        </div>
        {error && <p className="error" role="alert">⚠ {error}</p>}

        <div className="editor">
          <nav className="q-list" aria-label="Daftar pertanyaan">
            {quiz.questions.map((x, i) => (
              <button key={x.id} className={`q-item ${i === qi ? 'active' : ''} ${invalid[i] ? 'invalid' : ''}`} onClick={() => setActive(i)}>
                <small>{i + 1}. {TYPE_ICON[x.type]} {QUESTION_TYPE_LABEL[x.type]}{invalid[i] ? ' · belum lengkap' : ''}</small>
                <div>{x.text || <i className="muted">(belum ada teks)</i>}</div>
              </button>
            ))}
            <details className="add-q">
              <summary className="btn secondary block">+ Pertanyaan</summary>
              <div className="add-q-menu">
                {QUESTION_TYPES.map((t) => (
                  <button key={t} className="btn ghost sm" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; addQuestion(t); }}>
                    {TYPE_ICON[t]} {QUESTION_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </details>
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
              <label className="field" style={{ flex: '1 1 180px', marginBottom: 0 }}>
                <span>Tipe</span>
                <select className="input" value={q.type} onChange={(e) => updateQ(convertType(q, e.target.value as QuestionType))}>
                  {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_ICON[t]} {QUESTION_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 120px', marginBottom: 0 }}>
                <span>Batas waktu</span>
                <select className="input" value={q.timeLimit} onChange={(e) => updateQ({ timeLimit: Number(e.target.value) })}>
                  {TIME_CHOICES.map((t) => <option key={t} value={t}>{t} detik</option>)}
                </select>
              </label>
              {scoredType && (
                <label className="field" style={{ flex: '1 1 140px', marginBottom: 0 }}>
                  <span>Poin</span>
                  <select className="input" value={q.points} onChange={(e) => updateQ({ points: e.target.value as Question['points'] })}>
                    <option value="standard">Standar</option>
                    <option value="double">Ganda (2×)</option>
                    <option value="none">Tanpa poin</option>
                  </select>
                </label>
              )}
            </div>

            <label className="field">
              <span>Pertanyaan</span>
              <textarea className="input" style={{ fontSize: 20, fontWeight: 700 }} value={q.text} maxLength={LIMITS.questionMax} placeholder="Tulis pertanyaanmu…" onChange={(e) => updateQ({ text: e.target.value })} />
            </label>

            <div className="field">
              <span className="field-label">Gambar (opsional)</span>
              <div className="row">
                <button className="btn secondary sm" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Mengunggah…' : '📷 Upload gambar'}
                </button>
                <input className="input" style={{ flex: 1, minWidth: 200 }} value={q.image ?? ''} placeholder="…atau tempel URL https://" onChange={(e) => updateQ({ image: e.target.value })} />
                {q.image && <button className="btn ghost sm" onClick={() => updateQ({ image: '' })}>Hapus</button>}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
              </div>
              {q.image && (/^https:\/\//.test(q.image) || q.image.startsWith('/api/images/')) && (
                <img src={q.image} alt="" referrerPolicy="no-referrer" style={{ maxHeight: 180, borderRadius: 10, marginTop: 10 }} />
              )}
            </div>

            {(q.type === 'quiz' || q.type === 'truefalse' || q.type === 'poll' || q.type === 'puzzle') && (
              <>
                <p className="muted field-label">
                  {q.type === 'puzzle'
                    ? 'Tulis item dalam URUTAN YANG BENAR — pemain akan melihatnya teracak'
                    : q.type === 'poll'
                      ? 'Pilihan polling (tidak ada jawaban benar)'
                      : `Pilihan jawaban — klik ✓ untuk menandai jawaban benar${q.type === 'quiz' ? ' (boleh lebih dari satu)' : ''}`}
                </p>
                <div className={q.type === 'puzzle' ? 'opt-list' : 'opt-grid'}>
                  {q.options.map((o, i) => (
                    <div key={i} className="opt-edit" style={{ background: `var(--opt-${i})` }}>
                      {q.type === 'puzzle' ? <span className="order-badge">{i + 1}</span> : <Shape index={i} />}
                      <input
                        className="input"
                        value={o}
                        maxLength={LIMITS.optionMax}
                        placeholder={q.type === 'puzzle' ? `Item ke-${i + 1}` : `Jawaban ${i + 1}`}
                        readOnly={q.type === 'truefalse'}
                        onChange={(e) => {
                          const options = q.options.slice();
                          options[i] = e.target.value;
                          updateQ({ options });
                        }}
                      />
                      {(q.type === 'quiz' || q.type === 'truefalse') && (
                        <button type="button" className={`correct-toggle ${q.correct.includes(i) ? 'on' : ''}`} onClick={() => toggleCorrect(i)} aria-pressed={q.correct.includes(i)} aria-label={`Tandai jawaban ${i + 1} benar`}>✓</button>
                      )}
                      {q.type !== 'truefalse' && q.options.length > (q.type === 'puzzle' ? 3 : 2) && (
                        <button type="button" className="correct-toggle" style={{ borderWidth: 0 }} onClick={() => removeOption(i)} aria-label={`Hapus pilihan ${i + 1}`}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
                {q.type !== 'truefalse' && q.options.length < 4 && (
                  <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => updateQ({ options: [...q.options, ''] })}>+ Tambah pilihan</button>
                )}
              </>
            )}

            {q.type === 'typeanswer' && (
              <>
                <p className="muted field-label">Jawaban yang diterima (maks {LIMITS.textAnswerMax} karakter; huruf besar/kecil, aksen & tanda baca diabaikan)</p>
                {q.accepted.map((a, i) => (
                  <div key={i} className="row" style={{ marginBottom: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      value={a}
                      maxLength={LIMITS.textAnswerMax}
                      placeholder={i === 0 ? 'Jawaban utama' : 'Variasi jawaban lain'}
                      onChange={(e) => {
                        const accepted = q.accepted.slice();
                        accepted[i] = e.target.value;
                        updateQ({ accepted });
                      }}
                    />
                    {q.accepted.length > 1 && <button className="btn ghost sm" onClick={() => updateQ({ accepted: q.accepted.filter((_, j) => j !== i) })}>✕</button>}
                  </div>
                ))}
                {q.accepted.length < 4 && <button className="btn ghost sm" onClick={() => updateQ({ accepted: [...q.accepted, ''] })}>+ Variasi jawaban</button>}
              </>
            )}

            {q.type === 'slider' && s && (
              <div className="slider-edit">
                {(['min', 'max', 'step', 'answer'] as const).map((k) => (
                  <label key={k} className="field">
                    <span>{{ min: 'Minimum', max: 'Maksimum', step: 'Langkah', answer: 'Jawaban benar' }[k]}</span>
                    <input
                      className="input"
                      type="number"
                      step="any"
                      value={Number.isFinite(s[k]) ? s[k] : ''}
                      onChange={(e) => updateQ({ slider: { ...s, [k]: e.target.value === '' ? Number.NaN : Number(e.target.value) } })}
                    />
                  </label>
                ))}
                <label className="field">
                  <span>Toleransi</span>
                  <select className="input" value={s.margin} onChange={(e) => updateQ({ slider: { ...s, margin: e.target.value as typeof s.margin } })}>
                    {SLIDER_MARGINS.map((m) => <option key={m} value={m}>{SLIDER_MARGIN_LABEL[m]}</option>)}
                  </select>
                </label>
              </div>
            )}

            {q.type === 'wordcloud' && <p className="muted">Pemain mengirim kata/frasa singkat. Jawaban yang sama akan tampil lebih besar di layar host.</p>}
            {q.type === 'poll' && <p className="muted" style={{ marginTop: 10 }}>Polling tidak memberi poin dan tidak memutus streak.</p>}
          </section>
        </div>
      </main>
    </>
  );
}
