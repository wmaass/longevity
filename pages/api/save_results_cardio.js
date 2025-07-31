// pages/api/save_results_cardio.js
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { baseName, results, details } = req.body;

  if (!baseName || !Array.isArray(results) || !Array.isArray(details)) {
    return res.status(400).json({ error: 'Ungültige Daten' });
  }

  const resultDir = path.join(process.cwd(), 'public', 'results', baseName);
  if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

  try {
    // Speichere vollständige CSV
    const resultsCsv = toResultsCSV(results);
    const detailsCsv = toDetailsCSV(details);

    fs.writeFileSync(path.join(resultDir, 'batch_results_cardio.csv'), resultsCsv);
    fs.writeFileSync(path.join(resultDir, 'batch_details_cardio.csv'), detailsCsv);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Fehler beim Schreiben:', err);
    return res.status(500).json({ error: 'Fehler beim Schreiben' });
  }
}

function toResultsCSV(results) {
  const header = [
    'EFO-ID',
    'Trait',
    'PGS Count',
    'Avg PRS',
    'Max PRS',
    'Min PRS',
    'Avg Percentile',
    'Max Percentile',
    'Min Percentile',
    'Total Variants'
  ];

  const rows = results.map(r => [
    r.efoId,
    r.trait,
    r.pgsCount,
    r.avgPRS,
    r.maxPRS,
    r.minPRS,
    r.avgPercentile,
    r.maxPercentile,
    r.minPercentile,
    r.totalVariants
  ]);

  return [header, ...rows].map(row => row.join(',')).join('\n');
}

function toDetailsCSV(details) {
  if (!details.length) return '';
  const keys = Object.keys(details[0]);
  const rows = details.map(obj =>
    keys.map(k => JSON.stringify(obj[k] ?? '')).join(',')
  );
  return [keys.join(','), ...rows].join('\n');
}
