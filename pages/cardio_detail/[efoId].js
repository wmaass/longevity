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
  const [abstracts, setAbstracts] = useState({});
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
            const res = await fetch(`/api/snp-abstract?rsid=${rsid}`).then(r => r.json());
            fetched[rsid] =
              res && (res.text || res.url || res.pmid)
                ? res
                : { text: 'Kein Abstract verfügbar.', url: null };
          } catch (err) {
            console.error(`Fehler bei Abstract-Fetch für ${rsid}:`, err);
            fetched[rsid] = { text: 'Fehler beim Laden des Abstracts.', url: null };
          }
        }
        setAbstracts(fetched);
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

        {/* Variants Table */}
        <div className="bg-white p-6 rounded-xl shadow-md overflow-x-auto">
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
                        {abstracts[v.rsid]?.text && (
                          <>
                            {' '}|{' '}
                            <a
                              href="#"
                              className="text-green-600 hover:underline"
                              onClick={(e) => {
                                e.preventDefault();
                                const abs = abstracts[v.rsid];
                                const newWin = window.open('', '_blank', 'width=700,height=500');
                                newWin.document.write(`
                                  <html>
                                    <head>
                                      <title>Abstract (${v.rsid})</title>
                                      <style>
                                        body { font-family: Arial, sans-serif; background: #f9fafb; padding: 20px; color: #1f2937; }
                                        .container { background: #fff; padding: 20px; border-radius: 12px; max-width: 650px; margin: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                                        h2 { font-size: 1.5rem; margin-bottom: 1rem; }
                                        p { line-height: 1.6; font-size: 1rem; }
                                        a.link { display: inline-block; margin-top: 1rem; background: #2563eb; color: #fff; padding: 8px 14px; border-radius: 6px; text-decoration: none; }
                                        a.link:hover { background: #1d4ed8; }
                                      </style>
                                    </head>
                                    <body>
                                      <div class="container">
                                        <h2>Abstract für ${v.rsid}</h2>
                                        ${abs.url ? `<p><a class="link" href="${abs.url}" target="_blank">Zur Publikation</a></p>` : ''}
                                        <p>${abs.text}</p>
                                      </div>
                                    </body>
                                  </html>
                                `);
                              }}
                            >
                              Abstract
                            </a>
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

        {/* Chart */}
        <div className="bg-white p-6 rounded-xl shadow-md">
          <Bar data={chartData} options={chartOptions} />
        </div>
      </main>
    </div>
  );
}
