'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function CardioDetail() {
  const router = useRouter();
  const { efoId, trait: traitQuery } = router.query;

  const [result, setResult] = useState(null);
  const [summaries, setSummaries] = useState({});
  const [activeSummary, setActiveSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!efoId) return;

    fetch(`/details/${efoId}.json`)
      .then(res => res.json())
      .then(async (json) => {
        const detail = json[0] || {};
        setResult(detail);

        const snps = (detail.topVariants || [])
          .filter(v => Math.abs(v.score) > 0.2 && v.rsid)
          .map(v => v.rsid);

        const fetched = {};
        for (const rsid of snps) {
          try {
            const res = await fetch(`/api/snp-summary?rsid=${rsid}`).then(r => r.json());
            fetched[rsid] = res && (res.text || res.url)
              ? res
              : { text: 'Keine Zusammenfassung verfügbar.', url: null };
          } catch (err) {
            console.error(`Fehler bei Summary-Fetch für ${rsid}:`, err);
            fetched[rsid] = { text: 'Fehler beim Laden der Zusammenfassung.', url: null };
          }
        }
        setSummaries(fetched);
      })
      .finally(() => setLoading(false));
  }, [efoId]);

  if (loading) return <p className="p-8">Lade Details…</p>;
  if (!result) return <p className="p-8 text-red-500">Keine Daten gefunden.</p>;

  const displayTrait = traitQuery || result.trait || 'Unbekannter Trait';
  const top10 = (result.topVariants || []).slice(0, 10);

  const chartData = {
    labels: top10.map(v => v.rsid || v.variant),
    datasets: [
      {
        label: 'β × z',
        data: top10.map(v => v.score),
        backgroundColor: 'rgba(96, 165, 250, 0.6)',
        hoverBackgroundColor: 'rgba(96, 165, 250, 0.8)',
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    animation: { duration: 500, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'Top 10 Varianten (β × z)', font: { size: 18 } },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#111827',
        bodyColor: '#374151',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: 10,
      },
    },
    indexAxis: 'y',
    scales: {
      x: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 14 }, color: '#374151' } },
      y: { grid: { color: '#ffffff' }, ticks: { font: { size: 14, weight: '500' }, color: '#111827' } },
    },
  };

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r shadow-md p-4">
        <h1 className="text-2xl font-bold text-green-600">PGS Dashboard</h1>
        <nav className="mt-6 flex flex-col space-y-3">
          <a href="/batch_ui_cardio" className="font-semibold text-green-700">← Zurück</a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-10 space-y-10">
        {/* Title */}
        <header>
          <h2 className="text-4xl font-extrabold text-gray-800">
            {displayTrait}
            <span className="block text-lg text-gray-500">(EFO-ID: {efoId})</span>
          </h2>
          <p className="mt-4 text-lg">
            <strong>PRS:</strong> {result.prs?.toFixed(4) || '-'}{' '}
            <span className="text-gray-600">
              (Z-Score {result.zScore?.toFixed(2) || '-'}, Perzentil {result.percentile || '-'}%)
            </span>
          </p>
        </header>

        {/* Table + Inline Summary Panel */}
        <div className="flex gap-6">
          {/* Variants Table */}
          <div className="flex-1 bg-white p-6 rounded-xl shadow-md overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead className="bg-blue-50 text-gray-700">
                <tr>
                  {['#', 'Variante', 'SNP', 'Genotyp', 'β × z'].map((col) => (
                    <th key={col} className="px-4 py-2 text-left font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top10.map((v, i) => (
                  <tr key={i} className="odd:bg-gray-50 even:bg-gray-100 hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-2">{i + 1}</td>
                    <td className="px-4 py-2">{v.variant}</td>
                    <td className="px-4 py-2">
                      {v.rsid ? (
                        <>
                          <a
                            href={`https://www.ncbi.nlm.nih.gov/snp/${v.rsid}`}
                            target="_blank"
                            className="text-blue-600 hover:underline"
                          >
                            {v.rsid}
                          </a>
                          {summaries[v.rsid]?.text && (
                            <>
                              {' '}|{' '}
                              <button
                                className="text-green-600 hover:underline"
                                onClick={() => setActiveSummary({ rsid: v.rsid, ...summaries[v.rsid] })}
                              >
                                Zusammenfassung
                              </button>
                            </>
                          )}
                        </>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-2">{v.alleles}</td>
                    <td className="px-4 py-2 font-semibold text-right">{v.score?.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Panel */}
          <div className="w-1/3 bg-white p-6 rounded-xl shadow-md sticky top-10 h-fit">
            {activeSummary ? (
              <>
                <h3 className="text-xl font-bold mb-4">Zusammenfassung für {activeSummary.rsid}</h3>
                {activeSummary.url && (
                  <p className="mb-4">
                    <a
                      href={activeSummary.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Zur Publikation
                    </a>
                  </p>
                )}
                <p className="whitespace-pre-line text-gray-800">{activeSummary.text}</p>
              </>
            ) : (
              <p className="text-gray-500">Wähle eine Variante aus, um die Zusammenfassung zu sehen.</p>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white p-6 rounded-xl shadow-md">
          <Bar data={chartData} options={chartOptions} />
        </div>
      </main>
    </div>
  );
}
