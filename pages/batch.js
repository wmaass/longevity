'use client';
import { useState } from 'react';
import { computePRS } from '../lib/computePRS.js';

export default function BatchPage() {
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);

  async function runBatch() {
    setStatus('Analyse gestartet…');
    setProgress(0);

    // Dummy-Genomdatei simulieren (später via Upload ersetzen)
    const fileInput = document.getElementById('genomeFile');
    const file = fileInput?.files?.[0];
    if (!file) {
      setStatus('Bitte 23andMe-Datei hochladen.');
      return;
    }

    try {
      // Beispiel: EFO hartcodiert – später Schleife über alle EFOs
      const res = await computePRS(
        file,
        (pgsId, pct, matches, phase, completed, total) => {
          const overallPct = ((completed + pct / 100) / total) * 100;
          setProgress(overallPct);
          setStatus(`${phase} (${Math.round(overallPct)}%) – ${matches} Matches`);
        },
        'EFO_0000712' // Stroke (nur als Test)
      );
      setResults(res);
      setStatus('Analyse abgeschlossen.');
    } catch (err) {
      console.error(err);
      setStatus(`Fehler: ${err.message}`);
    }
  }

  return (
    <div>
      <h1>Batch-Analyse (PGS über mehrere EFOs)</h1>
      <input type="file" id="genomeFile" />
      <button onClick={runBatch}>Analyse starten</button>
      <p>{status}</p>
      <progress max="100" value={progress} style={{ width: '100%' }}></progress>

      {results.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <h2>Ergebnisse</h2>
          <table border="1" cellPadding="5" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th>PGS-ID</th>
                <th>Trait</th>
                <th>PRS</th>
                <th>Z-Score</th>
                <th>Perzentil</th>
                <th>Matches</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.id}</td>
                  <td>{r.trait}</td>
                  <td>{r.prs.toFixed(3)}</td>
                  <td>{r.zScore.toFixed(2)}</td>
                  <td>{r.percentile}</td>
                  <td>{r.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
