// pages/api/save_results_cardio.js
import fs from 'fs';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { baseName, results, details } = req.body;
  if (!baseName || !Array.isArray(results) || !Array.isArray(details)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const rootDir = path.join(process.cwd(), 'public', 'results');
    const subDir = path.join(rootDir, baseName);
    mkdirSync(subDir, { recursive: true });

    const resultsPath = path.join(subDir, 'batch_results_cardio.csv');
    const detailsPath = path.join(subDir, 'batch_details_cardio.csv');

    const summaryHeader = [
      'EFO-ID', 'Trait', 'PGS Count', 'Avg PRS', 'Max PRS', 'Min PRS',
      'Avg Percentile', 'Max Percentile', 'Min Percentile', 'Total Variants'
    ];

    const summaryLines = [summaryHeader.join('\t')];

    const groupedByEfo = {};
    details.forEach(d => {
      const efoId = d.efoId || '(unbekannt)';
      if (!groupedByEfo[efoId]) groupedByEfo[efoId] = [];
      groupedByEfo[efoId].push(d);
    });

    Object.entries(groupedByEfo).forEach(([efoId, entries]) => {
      const traitCandidates = entries.map(d => d.trait).filter(t => t && t !== '(unbekannt)' && t !== `PGS für ${efoId}`);
      const trait = traitCandidates[0] || '(unbekannt)';

      const filteredPRS = entries.map(d => Number(d.prs)).filter(v => !isNaN(v));
      const filteredPercentiles = entries.map(d => Number(d.percentile)).filter(v => !isNaN(v));
      const filteredVariants = entries.map(d => Number(d.totalVariants)).filter(v => !isNaN(v));

      const avgPRS = filteredPRS.length ? (filteredPRS.reduce((a, b) => a + b, 0) / filteredPRS.length).toFixed(3) : '';
      const maxPRS = filteredPRS.length ? Math.max(...filteredPRS).toFixed(3) : '';
      const minPRS = filteredPRS.length ? Math.min(...filteredPRS).toFixed(3) : '';

      const avgPercentile = filteredPercentiles.length ? (filteredPercentiles.reduce((a, b) => a + b, 0) / filteredPercentiles.length).toFixed(1) : '';
      const maxPercentile = filteredPercentiles.length ? Math.max(...filteredPercentiles).toFixed(1) : '';
      const minPercentile = filteredPercentiles.length ? Math.min(...filteredPercentiles).toFixed(1) : '';

      const totalVariants = filteredVariants.length ? filteredVariants.reduce((a, b) => a + b, 0) : '';

      summaryLines.push([
        efoId,
        trait,
        entries.length,
        avgPRS,
        maxPRS,
        minPRS,
        avgPercentile,
        maxPercentile,
        minPercentile,
        totalVariants
      ].join('\t'));
    });

    writeFileSync(resultsPath, summaryLines.join('\n'), 'utf-8');

    const detailKeys = [
      'efoId', 'id', 'trait', 'rawScore', 'prs', 'zScore', 'percentile',
      'matches', 'totalVariants'
    ];

    const detailsLines = [
      detailKeys.join('\t'),
      ...details.map(d => detailKeys.map(k => d[k] ?? '').join('\t'))
    ];

    writeFileSync(detailsPath, detailsLines.join('\n'), 'utf-8');

    return res.status(200).json({ message: 'Files saved successfully.' });
  } catch (e) {
    console.error('Save error:', e);
    return res.status(500).json({ error: 'Failed to save files.' });
  }
}