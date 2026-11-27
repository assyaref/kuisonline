import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUESTION_TYPE_LABEL, type QuizData } from '../../../shared/schema';
import { api, useAuth, useToast } from '../lib';
import { Spinner, TopBar } from '../components/ui';
import { fmt } from './Dashboard';

interface PublicRow {
  id: string;
  title: string;
  questionCount: number;
  updatedAt: number;
  author: string;
}

export function Explore() {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<PublicRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ quizzes: PublicRow[] }>(`/public/quizzes?q=${encodeURIComponent(term)}`)
        .then((r) => setRows(r.quizzes))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [term]);
  return (
    <>
      <TopBar />
      <main className="container">
        <h1>Jelajahi kuis publik</h1>
        <input className="input" placeholder="Cari judul kuis…" value={term} onChange={(e) => setTerm(e.target.value)} style={{ marginBottom: 18 }} />
        {error && <p className="error">{error}</p>}
        {rows === null ? (
          <div className="center"><Spinner dark /></div>
        ) : rows.length === 0 ? (
          <div className="card empty"><p className="muted">Belum ada kuis publik{term && ' yang cocok'}.</p></div>
        ) : (
          <div className="quiz-grid">
            {rows.map((r) => (
              <Link key={r.id} to={`/q/${r.id}`} className="card quiz-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                <h3>{r.title}</h3>
                <span className="muted" style={{ fontSize: 14 }}>{r.questionCount} pertanyaan · oleh @{r.author}</span>
                <span className="muted" style={{ fontSize: 13 }}>{fmt(r.updatedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export function PublicQuiz() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<{ quiz: QuizData; author: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ quiz: QuizData; author: string }>(`/public/quizzes/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  async function copy(thenPlay: boolean) {
    if (!user) return navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
    try {
      const r = await api<{ id: string }>(`/public/quizzes/${id}/copy`, { method: 'POST', body: {} });
      toast('Kuis disalin ke akunmu');
      navigate(thenPlay ? `/host/new?quiz=${r.id}` : `/edit/${r.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 760 }}>
        {error && <p className="error">{error}</p>}
        {!data && !error && <div className="center"><Spinner dark /></div>}
        {data && (
          <>
            <h1 style={{ marginBottom: 4 }}>{data.quiz.title}</h1>
            <p className="muted">oleh @{data.author} · {data.quiz.questions.length} pertanyaan</p>
            {data.quiz.description && <p>{data.quiz.description}</p>}
            <div className="row" style={{ marginBottom: 18 }}>
              <button className="btn" onClick={() => copy(true)}>▶ Mainkan</button>
              <button className="btn secondary" onClick={() => copy(false)}>Salin & edit</button>
            </div>
            <div className="card">
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {data.quiz.questions.map((q) => (
                  <li key={q.id} style={{ marginBottom: 10 }}>
                    <b>{q.text}</b>
                    <div className="muted" style={{ fontSize: 13 }}>{QUESTION_TYPE_LABEL[q.type]} · {q.timeLimit} detik</div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </main>
    </>
  );
}
