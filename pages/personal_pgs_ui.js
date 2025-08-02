// pages/personal-pgs-ui.js
import { useState, useRef, useEffect } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { Bar } from 'react-chartjs-2';
import { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const CARDIO_EFO_IDS = [
  'EFO_0004530', // Triglyceride measurement
  'EFO_0006336', // LDL cholesterol
  'EFO_0006335', // HDL cholesterol
  'EFO_0004541', // Total cholesterol
  'EFO_0001645', // Heart rate
  'EFO_0004458', // Cardiac output
  'EFO_0004611', // Liver enzyme level
  'EFO_0004612', // Bilirubin measurement
  'EFO_0004574'  // Liver fat percentage
];

const CONFIG = {
  MAX_VARIANTS_ALLOWED: 100,
  METADATA_URL: 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv'
};

export default function PersonalPGSUI() {
  const [genomeText, setGenomeText] = useState('');
  const [results, setResults] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [genomeFileName, setGenomeFileName] = useState('genome_webworker');
  const [summaryResults, setSummaryResults] = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    setGenomeText(text.replace(/\0/g, '').trim());
    setGenomeFileName(file.name.replace(/\.txt$/, ''));
    setResults([]);
    setError(null);
  };

  const runAnalysis = () => {
    if (!genomeText) {
      setError('Bitte lade zuerst eine 23andMe-Datei hoch.');
      return;
    }

    setLoading(true);
    setError(null);
    setLog([]);
    const worker = new Worker('/workers/prs.worker.js');

    worker.postMessage({
      genomeTxt: genomeText,
      efoIds: CARDIO_EFO_IDS,
      config: CONFIG
    });

    worker.onmessage = async (event) => {
      const { results: resultList, log: newLog } = event.data;
      if (newLog) setLog((prev) => [...prev, newLog]);
      if (resultList) {
        setResults(resultList);
        setLoading(false);
        worker.terminate();

        if (!resultList.length) {
          setError('Keine Ergebnisse gefunden.');
          return;
        }

        const summary = summarizeResults(resultList);
        setSummaryResults(summary);

        try {
          const res = await fetch('/api/save_results_cardio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseName: genomeFileName,
              results: summary,
              details: resultList
            })
          });
          if (!res.ok) throw new Error(`Fehler beim Speichern: ${res.status}`);
        } catch (e) {
          console.error('Speichern fehlgeschlagen:', e);
          setError('Analyse abgeschlossen, aber Speichern fehlgeschlagen.');
        }
      }
    };

    worker.onerror = (err) => {
      console.error('Worker error:', err);
      setError('Analyse fehlgeschlagen.');
      setLoading(false);
    };
  };

  const summarizeResults = (rawResults) => {
    if (!Array.isArray(rawResults)) return [];
    const grouped = {};
    for (const r of rawResults) {
      if (!grouped[r.efoId]) grouped[r.efoId] = [];
      grouped[r.efoId].push(r);
    }
    return Object.entries(grouped).map(([efoId, scores]) => {
      const trait = scores[0]?.trait || '(unbekannt)';
      const pgsCount = scores.length;
      const avgPRS = scores.reduce((sum, s) => sum + s.prs, 0) / pgsCount;
      const maxPRS = Math.max(...scores.map(s => s.prs));
      const minPRS = Math.min(...scores.map(s => s.prs));
      const avgPercentile = scores.reduce((sum, s) => sum + s.percentile, 0) / pgsCount;
      const maxPercentile = Math.max(...scores.map(s => s.percentile));
      const minPercentile = Math.min(...scores.map(s => s.percentile));
      const totalVariants = scores.reduce((sum, s) => sum + (s.totalVariants || 0), 0);
      return {
        efoId,
        'EFO-ID': efoId,
        'Trait': trait,
        'PGS Count': pgsCount,
        'Avg PRS': parseFloat(avgPRS.toFixed(3)),
        'Max PRS': parseFloat(maxPRS.toFixed(3)),
        'Min PRS': parseFloat(minPRS.toFixed(3)),
        'Avg Percentile': parseFloat(avgPercentile.toFixed(1)),
        'Max Percentile': parseFloat(maxPercentile.toFixed(1)),
        'Min Percentile': parseFloat(minPercentile.toFixed(1)),
        'Total Variants': totalVariants
      };
    });
  };

  const renderSummaryChart = () => {
    if (!summaryResults.length) return null;
    const data = {
      labels: summaryResults.map(s => s['Trait']),
      datasets: [{
        label: 'Avg PRS',
        data: summaryResults.map(s => s['Avg PRS']),
        backgroundColor: 'rgba(54, 162, 235, 0.6)'
      }]
    };
    const options = {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Durchschnittlicher PRS pro Trait' }
      },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 90, minRotation: 45 } }
      }
    };
    return <Bar data={data} options={options} className="max-w-4xl mx-auto" />;
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">Persönliche PGS-Analyse (WebWorker)</h1>

        <input type="file" onChange={handleFileChange} accept=".txt" className="block text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />

        <button onClick={runAnalysis} disabled={loading || !genomeText} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? 'Analyse läuft…' : 'Analyse starten'}
        </button>

        {error && <p className="text-red-600 font-medium">{error}</p>}

        {log.length > 0 && (
          <div ref={logRef} className="bg-gray-100 border border-gray-300 rounded p-2 h-48 overflow-y-auto text-sm font-mono whitespace-pre-wrap">
            {log.map((line, idx) => <div key={idx}>{line}</div>)}
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-4">
            <h2 className="text-lg font-semibold">Ergebnisse</h2>
            <table className="min-w-full table-auto border mt-2 text-sm">
              <thead>
                <tr>
                  <th className="border px-2 py-1">EFO-ID</th>
                  <th className="border px-2 py-1">PGS-ID</th>
                  <th className="border px-2 py-1">RawScore</th>
                  <th className="border px-2 py-1">PRS</th>
                  <th className="border px-2 py-1">Percentile</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="border px-2 py-1">{r.efoId}</td>
                    <td className="border px-2 py-1">{r.id}</td>
                    <td className="border px-2 py-1">{r.rawScore.toFixed(3)}</td>
                    <td className="border px-2 py-1">{r.prs.toFixed(3)}</td>
                    <td className="border px-2 py-1">{r.percentile}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-8">
              {renderSummaryChart()}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
