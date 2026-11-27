import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUESTION_TYPE_LABEL } from '../../../shared/schema';
import type { GameReport } from '../../../shared/types';
import { api, useToast } from '../lib';
import { Spinner, TopBar } from '../components/ui';
import { download } from './Dashboard';

type AssignmentReport = GameReport & { open?: boolean; deadline?: number };

export default function Report({ kind }: { kind: 'live' | 'assignment' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [report, setReport] = useState<AssignmentReport | null>(null);
  const [error, setError] = useState('');
  const base = kind === 'live' ? '/reports' : '/assignments';

  useEffect(() => {
    const load = () => api<{ report: AssignmentReport }>(`${base}/${id}`).then((r) => setReport(r.report)).catch((e) => setError(e.message));
    void load();
    if (kind === 'assignment') {
      const t = setInterval(load, 15000); // live-updating while students work
      return () => clearInterval(t);
    }
  }, [id, base, kind]);

  function downloadCsv() {
    if (!report) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Peringkat', 'Nama', 'Tim', 'Skor', 'Jawaban benar'].map(esc).join(',')];
    const scored = report.questions.filter((q) => q.scored).length;
    for (const r of report.ranking) lines.push([r.rank, r.name, r.team ?? '', r.score, `${r.correctCount}/${scored}`].map(esc).join(','));
    lines.push('');
    lines.push(['No', 'Tipe', 'Pertanyaan', 'Jawaban benar', '% benar', 'Ringkasan'].map(esc).join(','));
    report.questions.forEach((q, i) =>
      lines.push([i + 1, QUESTION_TYPE_LABEL[q.type], q.text, q.correctText, q.scored ? `${Math.round(q.correctRate * 100)}%` : '-', q.summary].map(esc).join(',')),
    );
    download(`laporan-${report.title.replace(/[^\w\- ]+/g, '').trim() || 'kuis'}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  async function remove() {
    if (!confirm(kind === 'live' ? 'Hapus laporan ini?' : 'Hapus tugas beserta semua hasilnya?')) return;
    try {
      await api(`${base}/${id}`, { method: 'DELETE' });
      navigate(kind === 'live' ? '/dashboard?tab=reports' : '/dashboard?tab=assignments');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const scoredCount = report?.questions.filter((q) => q.scored).length ?? 0;
  return (
    <>
      <TopBar>
        <Link className="btn ghost sm" to={`/dashboard?tab=${kind === 'live' ? 'reports' : 'assignments'}`}>← Dashboard</Link>
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
                  {kind === 'assignment' ? (
                    <>Tugas PIN <b>{report.pin}</b> · {report.open ? `aktif sampai ${new Date(report.deadline!).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}` : 'ditutup'}</>
                  ) : (
                    new Date(report.endedAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })
                  )}{' '}
                  · {report.playerCount} pemain
                </span>
              </div>
              <div className="spacer" />
              <button className="btn secondary" onClick={downloadCsv}>Unduh CSV</button>
              <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={remove}>Hapus</button>
            </div>

            {report.teams && report.teams.length > 0 && (
              <div className="card" style={{ marginBottom: 18 }}>
                <h2>Tim</h2>
                <table className="table">
                  <thead><tr><th>#</th><th>Tim</th><th>Anggota</th><th>Skor</th></tr></thead>
                  <tbody>
                    {report.teams.map((t) => (
                      <tr key={t.name}><td>{t.rank}</td><td>{t.name}</td><td>{t.members}</td><td>{t.score.toLocaleString('id-ID')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="card" style={{ marginBottom: 18, overflowX: 'auto' }}>
              <h2>Peringkat</h2>
              {report.ranking.length === 0 ? <p className="muted">Belum ada pemain.</p> : (
                <table className="table">
                  <thead><tr><th>#</th><th>Nama</th>{report.teams && <th>Tim</th>}<th>Skor</th><th>Benar</th></tr></thead>
                  <tbody>
                    {report.ranking.map((r, i) => (
                      <tr key={i}>
                        <td>{r.rank}</td>
                        <td>{r.name}</td>
                        {report.teams && <td>{r.team}</td>}
                        <td>{r.score.toLocaleString('id-ID')}</td>
                        <td>{r.correctCount}/{scoredCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ overflowX: 'auto' }}>
              <h2>Per pertanyaan</h2>
              <table className="table">
                <thead><tr><th>Pertanyaan</th><th>Jawaban benar</th><th>% benar</th><th>Ringkasan</th></tr></thead>
                <tbody>
                  {report.questions.map((q, i) => (
                    <tr key={i}>
                      <td>
                        {i + 1}. {q.text}
                        <div className="muted" style={{ fontSize: 12 }}>{QUESTION_TYPE_LABEL[q.type]}</div>
                      </td>
                      <td>{q.correctText || '—'}</td>
                      <td style={{ fontWeight: 700, color: !q.scored ? undefined : q.correctRate < 0.4 ? 'var(--danger)' : 'var(--ok)' }}>
                        {q.scored ? `${Math.round(q.correctRate * 100)}%` : '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>{q.summary}</td>
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
