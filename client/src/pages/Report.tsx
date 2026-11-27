import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GameReport } from '../../../shared/types';
import { api, useToast } from '../lib';
import { Spinner, TopBar } from '../components/ui';

export default function Report() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [report, setReport] = useState<GameReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ report: GameReport }>(`/reports/${id}`).then((r) => setReport(r.report)).catch((e) => setError(e.message));
  }, [id]);

  function downloadCsv() {
    if (!report) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Peringkat', 'Nama', 'Skor', 'Jawaban benar'].map(esc).join(',')];
    for (const r of report.ranking) lines.push([r.rank, r.name, r.score, `${r.correctCount}/${report.questions.length}`].map(esc).join(','));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `laporan-${report.title.replace(/[^\w\- ]+/g, '').trim() || 'kuis'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function remove() {
    if (!confirm('Hapus laporan ini?')) return;
    try {
      await api(`/reports/${id}`, { method: 'DELETE' });
      navigate('/dashboard');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <TopBar>
        <Link className="btn ghost sm" to="/dashboard">← Dashboard</Link>
      </TopBar>
      <main className="container">
        {error && <p className="error">{error}</p>}
        {!report && !error && <div className="center"><Spinner dark /></div>}
        {report && (
          <>
            <div className="row" style={{ marginBottom: 16 }}>
              <div>
                <h1 style={{ marginBottom: 4 }}>{report.title}</h1>
                <span className="muted">
                  {new Date(report.endedAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })} · {report.playerCount} pemain
                </span>
              </div>
              <div className="spacer" />
              <button className="btn secondary" onClick={downloadCsv}>Unduh CSV</button>
              <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={remove}>Hapus</button>
            </div>

            <div className="card" style={{ marginBottom: 18, overflowX: 'auto' }}>
              <h2>Peringkat</h2>
              <table className="table">
                <thead><tr><th>#</th><th>Nama</th><th>Skor</th><th>Benar</th></tr></thead>
                <tbody>
                  {report.ranking.map((r, i) => (
                    <tr key={i}>
                      <td>{r.rank}</td>
                      <td>{r.name}</td>
                      <td>{r.score.toLocaleString('id-ID')}</td>
                      <td>{r.correctCount}/{report.questions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ overflowX: 'auto' }}>
              <h2>Per pertanyaan</h2>
              <table className="table">
                <thead><tr><th>Pertanyaan</th><th>Jawaban benar</th><th>% benar</th><th>Sebaran</th></tr></thead>
                <tbody>
                  {report.questions.map((q, i) => (
                    <tr key={i}>
                      <td>{i + 1}. {q.text}</td>
                      <td>{q.correct.map((c) => q.options[c]).join(', ')}</td>
                      <td style={{ fontWeight: 700, color: q.correctRate < 0.4 ? 'var(--danger)' : 'var(--ok)' }}>{Math.round(q.correctRate * 100)}%</td>
                      <td className="muted" style={{ fontSize: 13 }}>{q.options.map((o, j) => `${o}: ${q.distribution[j] ?? 0}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
