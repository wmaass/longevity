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

// Plugin to show labels on bars
const barLabelPlugin = {
  id: 'barLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx, scales } = chart;
    const xAxis = scales.x;
    const yAxis = scales.y;

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      chart.getDatasetMeta(datasetIndex).data.forEach((bar, index) => {
        const value = dataset.data[index].toFixed(3);
        ctx.save();
        ctx.fillStyle = '#111827';
        ctx.font = '12px Arial';
        ctx.textAlign = dataset.data[index] >= 0 ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        const x = bar.x + (dataset.data[index] >= 0 ? 6 : -6);
        const y = bar.y;
        ctx.fillText(value, x, y);
        ctx.restore();
      });
    });
  },
};

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const GLOBAL_MAX = 1.2;

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
            fetched[rsid] = res && (res.text || res.url || res.pmid)
              ? res
              : { text: 'Kein Abstract verfügbar.', url: null };
          } catch {
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

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: 'Top 10 Varianten (β × z)',
        font: { size: 16 },
        padding: { top: 5, bottom: 10 },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#111827',
        bodyColor: '#374151',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: 8,
      },
    },
    indexAxis: 'y',
    layout: {
      padding: { left: 10, right: 10, top: 5, bottom: 5 },
    },
    scales: {
      x: {
        min: -GLOBAL_MAX,
        max: GLOBAL_MAX,
        grid: {
          color: '#e5e7eb',
          lineWidth: 1,
          drawTicks: false,
        },
        ticks: {
          font: { size: 12 },
          color: '#374151',
        },
      },
      y: {
        grid: { display: false },
        ticks: {
          font: { size: 12, weight: '500' },
          color: '#111827',
        },
      },
    },
  };

  const chartData = {
    labels: top10.map(v => v.rsid || v.variant),
    datasets: [
      {
        label: 'β × z',
        data: top10.map(v => v.score),
        backgroundColor: top10.map(v =>
          v.score < 0 && Math.abs(v.score) > 0.2
            ? 'rgba(239, 68, 68, 0.7)'  // Red for high-risk
            : 'rgba(96, 165, 250, 0.7)' // Blue for others
        ),
        hoverBackgroundColor: top10.map(v =>
          v.score < 0 && Math.abs(v.score) > 0.2
            ? 'rgba(220, 38, 38, 0.9)'
            : 'rgba(59, 130, 246, 0.8)'
        ),
        borderRadius: 5,
        borderSkipped: false,
        barThickness: 26,         // Thicker bars
        categoryPercentage: 0.8,  // Reduces vertical spacing
      },
    ],
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

      {/* Main */}
      <main className="flex-1 p-6 space-y-8">
        {/* Title */}
        <header>
          <h2 className="text-3xl font-extrabold text-gray-800">
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

        {/* Responsive Table and Chart Container */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Table */}
          <div className="flex-1 bg-white p-4 rounded-xl shadow-md overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead className="bg-blue-50 text-gray-700">
                <tr>
                  {['#', 'Variante', 'SNP', 'Genotyp', 'β × z'].map((col) => (
                    <th key={col} className="px-3 py-2 text-left font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top10.map((v, i) => {
                  const score = v.score.toFixed(3);
                  const isHighRisk = v.score < 0 && Math.abs(v.score) > 0.2;
                  return (
                    <tr
                      key={i}
                      className={`odd:bg-gray-50 even:bg-gray-100 hover:bg-blue-50 transition-colors ${
                        isHighRisk ? 'bg-red-50 text-red-700 font-semibold' : ''
                      }`}
                    >
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2">{v.variant}</td>
                      <td className="px-3 py-2">
                        {v.rsid ? (
                          <>
                            <a
                              href={`https://www.ncbi.nlm.nih.gov/snp/${v.rsid}`}
                              target="_blank"
                              className="text-blue-600 hover:underline"
                            >
                              {v.rsid}
                            </a>
                            {abstracts[v.rsid] && (
                              <>
                                {' '}|{' '}
                                <a
                                  href="#"
                                  className="text-green-600 hover:underline"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    const newWin = window.open('', '_blank', 'width=700,height=500');
                                    newWin.document.write(`
                                      <html>
                                        <head>
                                          <title>Abstract für ${v.rsid}</title>
                                          <style>
                                            body {
                                              font-family: Arial, sans-serif;
                                              background-color: #f9fafb;
                                              color: #1f2937;
                                              margin: 0;
                                              padding: 20px;
                                            }
                                            .container {
                                              max-width: 650px;
                                              margin: 0 auto;
                                              background: #ffffff;
                                              padding: 20px 24px;
                                              border-radius: 12px;
                                              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                                            }
                                            h2 {
                                              font-size: 1.5rem;
                                              font-weight: bold;
                                              margin-bottom: 12px;
                                              color: #111827;
                                            }
                                            a.link {
                                              display: inline-block;
                                              margin-bottom: 16px;
                                              background: #2563eb;
                                              color: #ffffff;
                                              text-decoration: none;
                                              padding: 8px 14px;
                                              border-radius: 6px;
                                              font-size: 0.95rem;
                                              transition: background 0.2s ease-in-out;
                                            }
                                            a.link:hover {
                                              background: #1d4ed8;
                                            }
                                            p {
                                              font-size: 1rem;
                                              line-height: 1.6;
                                            }
                                          </style>
                                        </head>
                                        <body>
                                          <div class="container">
                                            <h2>Abstract für ${v.rsid}</h2>
                                            ${abstracts[v.rsid].url ? `<a class="link" href="${abstracts[v.rsid].url}" target="_blank">Zur Publikation</a>` : ''}
                                            <p>${abstracts[v.rsid].text}</p>
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
                      <td className="px-3 py-2">{v.alleles}</td>
                      <td className="px-3 py-2 font-semibold text-right">{score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Chart */}
          <div className="flex-1 bg-white p-4 rounded-xl shadow-md relative" style={{ minHeight: '400px' }}>
            <Bar data={chartData} options={chartOptions} plugins={[barLabelPlugin]} />
          </div>
        </div>
      </main>

    </div>
  );
}
