import { useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { computePRS } from '../lib/computePRS.client';

const CARDIO_EFO_IDS = [
  'EFO_0004541',
  'EFO_0004611',
  'EFO_0004612',
  'EFO_0004530',
  'EFO_0001645',
  'EFO_0006335',
  'EFO_0004574',
  'EFO_0000537',
  'EFO_0000275',
  'EFO_0006336',
  'EFO_0004458',
  'EFO_0004541'
];

export default function PersonalPGSUI() {
  const [genomeText, setGenomeText] = useState('');
  const [results, setResults] = useState([]);
  const [logMap, setLogMap] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapseMap, setCollapseMap] = useState({});
  const [resultsPrecomputed, setResultsPrecomputed] = useState(false);
  const [genomeFileName, setGenomeFileName] = useState('');

  const checkExistingResults = async (baseName) => {
    const head = async (path) => {
      try {
        const res = await fetch(path, { method: 'HEAD' });
        return res.ok;
      } catch {
        return false;
      }
    };
    return await head(`/results/${baseName}/batch_results_cardio.csv`) &&
           await head(`/results/${baseName}/batch_details_cardio.csv`);
  };

  const copyResultsToPublic = async (baseName) => {
    await fetch('/api/copy_results_cardio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientFolder: baseName })
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const text = await file.text();
      const baseName = file.name.replace(/\.txt$/, '');
      setGenomeFileName(baseName);
      setGenomeText(text.replace(/\0/g, '').trim());
      setLogMap([]);
      setResults([]);
      setError(null);

      if (await checkExistingResults(baseName)) {
        await copyResultsToPublic(baseName);
        setResultsPrecomputed(true);
        return;
      }
    }
  };

  const initializeEfoLog = (efoId) => {
    setLogMap((prev) => {
      if (prev.some((entry) => entry.efoId === efoId)) return prev;
      return [...prev, { efoId, messages: [`🔍 Analysiere ${efoId}…`] }];
    });
  };

  const appendToEfoLog = (efoId, message, finalize = false) => {
    setLogMap((prev) =>
      prev.map((entry) => {
        if (entry.efoId !== efoId) return entry;
        if (entry.messages.includes(message)) return entry;
        const nonTransient = entry.messages.filter((m) => m.startsWith('🔍') || m.startsWith('✅') || m.startsWith('⚠️'));
        const recent = entry.messages.filter((m) => !m.startsWith('🔍') && !m.startsWith('✅') && !m.startsWith('⚠️')).slice(-3);
        const newMessages = finalize ? [...nonTransient, message] : [...nonTransient, ...recent, message];
        return { ...entry, messages: newMessages };
      })
    );
  };

  const runBatch = async () => {
    if (!genomeText) {
      setError('Bitte lade zuerst eine 23andMe-Datei hoch.');
      return;
    }

    setLoading(true);
    setResults([]);
    setLogMap([]);
    setError(null);

    const allResults = [];
    const allDetails = [];

    for (const efoId of CARDIO_EFO_IDS) {
      initializeEfoLog(efoId);

      try {
        const scores = await computePRS(
          { text: async () => genomeText },
          (efo, pgsId, level, message) => appendToEfoLog(efo, message),
          efoId
        );

        if (!scores.length) throw new Error('Keine Scores gefunden');

        const traits = scores.map(s => s.trait).filter(Boolean);
        const pgsCount = scores.length;
        const avgPRS = (scores.reduce((sum, s) => sum + s.prs, 0) / pgsCount).toFixed(3);
        const maxPRS = Math.max(...scores.map(s => s.prs)).toFixed(3);
        const minPRS = Math.min(...scores.map(s => s.prs)).toFixed(3);
        const avgPercentile = (scores.reduce((sum, s) => sum + s.percentile, 0) / pgsCount).toFixed(1);
        const maxPercentile = Math.max(...scores.map(s => s.percentile)).toFixed(1);
        const minPercentile = Math.min(...scores.map(s => s.percentile)).toFixed(1);
        const totalVariants = scores.reduce((sum, s) => sum + (s.variants || 0), 0);

        allResults.push({
          efoId,
          trait: traits[0] ?? '',
          pgsCount,
          avgPRS,
          maxPRS,
          minPRS,
          avgPercentile,
          maxPercentile,
          minPercentile,
          totalVariants
        });

        scores.forEach(score => {
          allDetails.push({ efoId, ...score });
        });

        appendToEfoLog(efoId, `✅ ${efoId} abgeschlossen (${pgsCount} Scores)`, true);
      } catch (err) {
        appendToEfoLog(efoId, `⚠️ Fehler bei ${efoId}: ${err.message}`, true);
      }
    }

    try {
      await fetch('/api/save_results_cardio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseName: genomeFileName,
          results: allResults,
          details: allDetails
        })
      });
    } catch (e) {
      console.error('Fehler beim Speichern der Ergebnisse:', e);
    }

    setResults(allResults);
    setLoading(false);
    setResultsPrecomputed(true);
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">Persönliche PGS-Analyse (Kardiovaskulär)</h1>

        <input
          type="file"
          onChange={handleFileChange}
          accept=".txt"
          className="block text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />

        <button
          onClick={runBatch}
          disabled={loading || !genomeText || resultsPrecomputed}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Analyse läuft…' : 'Analyse starten'}
        </button>

        {error && <p className="text-red-600 font-medium">{error}</p>}

        {resultsPrecomputed && (
          <div className="bg-green-100 text-green-800 p-4 rounded shadow">
            Ergebnisse bereits vorhanden –{' '}
            <a
              href="/batch_ui_cardio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              zur Auswertung
            </a>
          </div>
        )}

        <div className="bg-gray-100 p-4 rounded shadow-inner">
          <h2 className="font-semibold text-gray-800 mb-2">🔍 Analyseverlauf</h2>
          {logMap.map(({ efoId, messages }) => {
            const isOpen = collapseMap[efoId] ?? true;
            const toggle = () =>
              setCollapseMap((prev) => ({ ...prev, [efoId]: !prev[efoId] }));

            return (
              <div key={efoId} className="mb-4 rounded border border-gray-300 bg-white shadow-sm">
                <button
                  className="w-full text-left px-3 py-2 flex items-center justify-between bg-gray-200 hover:bg-gray-300 rounded-t"
                  onClick={toggle}
                >
                  <span className="font-medium text-blue-800">{efoId}</span>
                  <svg
                    className={`w-4 h-4 transform transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {isOpen && (
                  <ul className="ml-5 py-2 text-sm list-disc text-gray-700">
                    {messages.map((line, i) => (
                      <li key={i} className="leading-snug">{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {results.length > 0 && (
          <>
            <table className="min-w-full table-auto border mt-4 text-sm">
              <thead>
                <tr>
                  <th className="border px-2 py-1">EFO-ID</th>
                  <th className="border px-2 py-1"># Scores</th>
                  <th className="border px-2 py-1">Durchschnittlicher PRS</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.efoId}>
                    <td className="border px-2 py-1">{r.efoId}</td>
                    <td className="border px-2 py-1">{r.pgsCount}</td>
                    <td className="border px-2 py-1">{r.avgPRS}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4">
              <a
                href="/batch_ui_cardio"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-green-600 text-white font-semibold px-4 py-2 rounded shadow hover:bg-green-700"
              >
                → Ergebnisse im PGS Dashboard ansehen
              </a>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}