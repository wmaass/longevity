// pages/api/saveResultsCardioDetails.js

import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  try {
    const { genomeName, csvContent } = req.body;

    if (!genomeName || !csvContent) {
      return res.status(400).json({ error: 'Fehlende genomeName oder csvContent' });
    }

    const dir = path.join(process.cwd(), 'public', 'results', genomeName);
    const filePath = path.join(dir, 'batch_details_cardio.csv');

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, csvContent);

    return res.status(200).json({ path: `/results/${genomeName}/batch_details_cardio.csv` });
  } catch (err) {
    console.error('❌ Fehler beim Speichern der Detail-CSV:', err);
    return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
  }
}
