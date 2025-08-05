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
import DashboardLayout from '../../components/DashboardLayout';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function CardioDetail() {
  const router = useRouter();
  const { efoId, genome: genomeQuery, trait: traitQuery } = router.query;

  const [result, setResult] = useState(null);
  const [summaries, setSummaries] = useState({});
  const [activeSummary, setActiveSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!router.isReady) {
      console.log('⏳ Router ist noch nicht bereit...');
      return;
    }

    const { efoId, genome: genomeQuery } = router.query;

    if (!efoId || !genomeQuery) {
      console.log('⚠️ efoId oder genomeQuery fehlen: ', { efoId, genomeQuery });
      return;
    }

    const path = `/results/${genomeQuery}/details/${efoId}.json`;

    console.log(`📥 Lade Datei: ${path}`);

    fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res.json();
      })
      .then(async (json) => {
        const detail = json[0] || {};
        setResult(detail);

        const snps = (detail.topVariants || [])
          .filter(v => Math.abs(v.score) > 0.2 && v.rsid)
          .map(v => v.rsid);

        console.log(`🔎 Verarbeite ${snps.length} SNPs...`);

        for (const rsid of snps) {
          console.log(`📡 Anfrage für SNP ${rsid}`);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000);

          try {
            const response = await fetch(`/api/snp-summary?rsid=${rsid}`, {
              signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            console.log(`✅ Antwort erhalten für ${rsid}`);

            setSummaries(prev => ({
              ...prev,
              [rsid]: {
                text: data?.text || 'Keine Zusammenfassung verfügbar.',
                url: data?.url || null,
                logs: data?.logs || [],
              },
            }));
          } catch (err) {
            clearTimeout(timeout);
            console.error(`❌ Fehler bei Summary-Fetch für ${rsid}:`, err);
            setSummaries(prev => ({
              ...prev,
              [rsid]: {
                text: 'Fehler beim Laden der Zusammenfassung.',
                url: null,
                logs: [`❌ Fehler beim Laden: ${err.message}`],
              },
            }));
          }
        }
      })
      .catch((err) => {
        const msg = `❌ Fehler beim Laden der Datei ${efoId}.json: ${err.message}`;
        console.error(msg);
        setError(msg);
      })
      .finally(() => {
        console.log('🏁 Fetch abgeschlossen.');
        setLoading(false);
      });

  }, [router.isReady, router.query]);



  if (error) {
    return (
      <DashboardLayout>
        <div className="text-red-600">❌ {error}</div>
      </DashboardLayout>
    );
  }

  if (loading) return <DashboardLayout><p className="p-8">Lade Details…</p></DashboardLayout>;
  if (!result) return <DashboardLayout><p className="p-8 text-red-500">Keine Daten gefunden.</p></DashboardLayout>;

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
    <DashboardLayout>
      <h2 className="text-3xl font-bold text-gray-800 mb-2">
        {displayTrait}
        <span className="block text-lg text-gray-500">(EFO-ID: {efoId})</span>
      </h2>

      <p className="mb-4 text-lg">
        <strong>PRS:</strong> {result.prs?.toFixed(4) || '-'}{' '}
        <span className="text-gray-600">
          (Z-Score {result.zScore?.toFixed(2) || '-'}, Perzentil {result.percentile || '-'}%)
        </span>
      </p>

      <div className="flex gap-6">
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
              {/* {activeSummary.logs && activeSummary.logs.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-md font-semibold text-gray-700 mb-2">🪵 Log-Ausgabe</h4>
                  <div className="bg-black text-green-400 font-mono text-xs p-3 rounded-lg max-h-64 overflow-y-auto whitespace-pre-wrap border border-gray-300">
                    {activeSummary.logs.join('\n')}
                  </div>
                </div>
              )} */}
            </>
          ) : (
            <p className="text-gray-500">Wähle eine Variante aus, um die Zusammenfassung zu sehen.</p>
          )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md mt-10">
        <Bar data={chartData} options={chartOptions} />
      </div>
    </DashboardLayout>
  );
}