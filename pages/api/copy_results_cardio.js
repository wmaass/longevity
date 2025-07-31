// pages/api/copy_results_cardio.js
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { patientFolder } = req.body;
  const basePath = path.join(process.cwd(), 'public', 'results', patientFolder);

  const sourceResults = path.join(basePath, 'batch_results_cardio.csv');
  const sourceDetails = path.join(basePath, 'batch_details_cardio.csv');

  const destResults = path.join(process.cwd(), 'public', 'batch_results_cardio.csv');
  const destDetails = path.join(process.cwd(), 'public', 'batch_details_cardio.csv');

  try {
    fs.copyFileSync(sourceResults, destResults);
    fs.copyFileSync(sourceDetails, destDetails);
    res.status(200).json({ message: 'Erfolgreich kopiert' });
  } catch (err) {
    console.error('Fehler beim Kopieren:', err);
    res.status(500).json({ error: 'Fehler beim Kopieren der Ergebnisse' });
  }
}
