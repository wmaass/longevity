import { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import ProgressBar from '../components/ProgressBar';
import Papa from 'papaparse';

export default function PersonalUICardio() {
  const [genomeText, setGenomeText] = useState('');
  const [genomeName, setGenomeName] = useState('');
  const [results, setResults] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progressState, setProgressState] = useState({ currentPGS: '', percent: 0 });

  useEffect(() => {
    if (log.length > 0) {
      const logContainer = document.getElementById('log-container');
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
  }, [log]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    setGenomeText(text.replace(/\0/g, '').trim());
    setGenomeName(file.name.replace(/\.txt$/i, ''));
    setResults([]);
    setError(null);
  };

  const runAnalysis = () => {
    if (!genomeText) {
      setError('Bitte lade eine 23andMe-Datei hoch.');
      return;
    }

    setLoading(true);
    setLog([]);
    setResults([]);

    const worker = new Worker('/workers/prs.worker.js');

    worker.postMessage({
      genomeTxt: genomeText,
      efoIds: Array.from(new Set([
          "EFO_0004541", // HbA1c measurement
          "EFO_0004611", // LDL cholesterol
          "EFO_0004612", // HDL cholesterol
          "EFO_0004530", // Triglycerides
          "EFO_0001645", // Coronary artery disease
          "EFO_0006335", // Systolic blood pressure
          "EFO_0004574", // Total cholesterol
          "EFO_0004458", // C-reactive protein
          "EFO_0006336"  // Diastolic blood pressure
      ])),
      config: {
        useLocalFiles: true,
        genomeFileName: genomeName
      },
      efoToPgsMap: {
        "EFO_0004541": [
          "PGS000127", "PGS000128", "PGS000129", "PGS000130", "PGS000131", "PGS000132", "PGS000304"
        ],
        "EFO_0004611": [
          "PGS000061", "PGS000065", "PGS000115", "PGS000310", "PGS000340", "PGS000661"
        ],
        "EFO_0004612": [
          "PGS000060", "PGS000064", "PGS000309", "PGS000660"
        ],
        "EFO_0004530": [
          "PGS000063", "PGS000066", "PGS000312", "PGS000659"
        ],
        "EFO_0001645": [
          "PGS000010", "PGS000011", "PGS000012", "PGS000019", "PGS000057", "PGS000058",
          "PGS000059", "PGS000116", "PGS000200", "PGS000337", "PGS000349"
        ],
        "EFO_0006335": [
          "PGS000301", "PGS002009"
        ],
        "EFO_0004574": [
          "PGS000062", "PGS000311", "PGS000658", "PGS000677"
        ],
        "EFO_0004458": [
          "PGS000314", "PGS000675"
        ],
        "EFO_0006336": [
          "PGS000302", "PGS001900"
        ]
      }
    });

    worker.onmessage = (event) => {
      const { results: resultList, log: logEntry, logs, currentPGS, progress, efoId, aggregated } = event.data;

      // 📘 Log-Ausgabe
      if (Array.isArray(logs)) {
        setLog(prev => [...prev, ...logs]);
      } else if (logEntry) {
        setLog(prev => [...prev, logEntry]);
      }

      // 📊 Ergebnisse speichern
      if (resultList) {
        setResults(resultList);
        setLoading(false);
        worker.terminate();

        // 🧾 Detaillierte Ergebnisse (batch_details_cardio.csv)
        if (genomeName) {
          const detailRows = resultList.map(r => ({
            efoId: r.efoId,
            id: r.id,
            trait: r.trait,
            rawScore: r.rawScore,
            prs: r.prs,
            zScore: r.zScore,
            percentile: r.percentile,
            matches: r.matches,
            totalVariants: r.totalVariants
          }));

          const detailCsv = Papa.unparse(detailRows);
          fetch('/api/saveResultsCardioDetails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ genomeName, csvContent: detailCsv })
          })
            .then(res => res.json())
            .then(data => {
              if (data.path) {
                const msg = `✅ Detail-CSV gespeichert unter: ${data.path}`;
                console.log(msg);
                setLog(prev => [...prev, msg]);
              } else {
                const warn = '⚠️ Detail-CSV konnte nicht gespeichert werden.';
                console.warn(warn);
                setLog(prev => [...prev, warn]);
              }
            })
            .catch(err => {
              console.error('❌ Fehler beim Speichern der Detail-CSV:', err);
              setLog(prev => [...prev, '❌ Fehler beim Speichern der Detail-CSV']);
            });
        }
      }

      // 📈 Aggregierte Ergebnisse (batch_results_cardio.csv)
      if (aggregated && genomeName) {
        const csv = Papa.unparse(aggregated);
        fetch('/api/saveResults', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genomeName, csvContent: csv })
        })
          .then(res => res.json())
          .then(data => {
            if (data.path) {
              const msg = `✅ CSV gespeichert unter: ${data.path}`;
              console.log(msg);
              setLog(prev => [...prev, msg]);
            } else {
              const warn = '⚠️ CSV konnte nicht gespeichert werden.';
              console.warn(warn);
              setLog(prev => [...prev, warn]);
            }
          })
          .catch(err => {
            console.error('❌ Fehler beim Speichern der CSV:', err);
            setLog(prev => [...prev, '❌ Fehler beim Speichern der CSV']);
          });
      }

      if (event.data.detailRows && genomeName) {
        const detailCsv = Papa.unparse(event.data.detailRows);
        fetch('/api/saveDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genomeName, csvContent: detailCsv })
        })
          .then(res => res.json())
          .then(data => {
            if (data.path) {
              const msg = `✅ Detail-CSV gespeichert unter: ${data.path}`;
              console.log(msg);
              setLog(prev => [...prev, msg]);
            } else {
              const warn = '⚠️ Detail-CSV konnte nicht gespeichert werden.';
              console.warn(warn);
              setLog(prev => [...prev, warn]);
            }
          })
          .catch(err => {
            console.error('❌ Fehler beim Speichern der Detail-CSV:', err);
            setLog(prev => [...prev, `❌ Fehler beim Speichern der Detail-CSV: ${err.message}`]);
          });
      }

            // 💾 EFO-JSON-Dateien speichern (Variante B)
      if (event.data.efoDetailsMap && genomeName) {
        const efoDetailsMap = event.data.efoDetailsMap;

        for (const [efoId, detail] of Object.entries(efoDetailsMap)) {
          fetch('/api/saveEfoDetail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ genomeName, efoId, detail })
          })
            .then(res => res.json())
            .then(data => {
              if (data.path) {
                const msg = `✅ Detail-JSON gespeichert für ${efoId}: ${data.path}`;
                console.log(msg);
                setLog(prev => [...prev, msg]);
              } else {
                const warn = `⚠️ Detail-JSON für ${efoId} konnte nicht gespeichert werden.`;
                console.warn(warn);
                setLog(prev => [...prev, warn]);
              }
            })
            .catch(err => {
              const errMsg = `❌ Fehler beim Speichern von ${efoId}: ${err.message}`;
              console.error(errMsg);
              setLog(prev => [...prev, errMsg]);
            });
        }
      }


      // 🔄 Fortschrittsanzeige
      if (currentPGS && typeof progress === 'number') {
        setProgressState({ currentPGS: `${efoId || ''} – ${currentPGS}`, percent: progress });
      }
    };


    worker.onerror = (err) => {
      setError('Analyse fehlgeschlagen.');
      setLoading(false);
      console.error('Worker error:', err);
    };
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">Cardio PGS Analyse</h1>

        <input type="file" onChange={handleFileChange} accept=".txt" />

        <button onClick={runAnalysis} disabled={loading || !genomeText} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          {loading ? 'Analyse läuft…' : 'Analyse starten'}
        </button>

        {error && <p className="text-red-600 font-medium">{error}</p>}

        {loading && <ProgressBar currentPGS={progressState.currentPGS} percent={progressState.percent} />}

        {results.length > 0 && (
          <table className="min-w-full mt-4 table-auto border text-sm">
            <thead>
              <tr>
                <th className="border px-2 py-1">EFO-ID</th>
                <th className="border px-2 py-1">Trait</th>
                <th className="border px-2 py-1">RawScore</th>
                <th className="border px-2 py-1">PRS</th>
                <th className="border px-2 py-1">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td className="border px-2 py-1">{r.efoId}</td>
                  <td className="border px-2 py-1">{r.trait}</td>
                  <td className="border px-2 py-1">{r.rawScore.toFixed(3)}</td>
                  <td className="border px-2 py-1">{r.prs.toFixed(3)}</td>
                  <td className="border px-2 py-1">{r.percentile >= 0 ? r.percentile.toFixed(1) : '–'}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {log.length > 0 && (
          <div id="log-container" className="mt-6 max-h-64 overflow-y-auto bg-white border border-gray-300 rounded p-3 text-sm font-mono text-gray-800 shadow-inner">
            {log.map((entry, idx) => <div key={idx}>{entry}</div>)}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
