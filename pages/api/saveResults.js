import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  console.log('📥 saveResult API aufgerufen');

  if (req.method !== 'POST') {
    console.warn('❌ Methode nicht erlaubt:', req.method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { genomeName, csvContent } = req.body;
    console.log('🧬 Empfangen:', genomeName);

    if (!genomeName || !csvContent) {
      console.warn('⚠️ Ungültige Anfrage:', req.body);
      res.status(400).json({ error: 'Missing genomeName or csvContent' });
      return;
    }

    const dir = path.join(process.cwd(), 'public', 'results', genomeName);
    const filePath = path.join(dir, 'batch_results_cardio.csv');

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, csvContent, 'utf-8');

    console.log(`✅ CSV gespeichert unter: ${filePath}`);

    res.status(200).json({ path: `/results/${genomeName}/batch_results_cardio.csv` });

  } catch (err) {
    console.error('❌ Fehler beim Speichern:', err);
    res.status(500).json({ error: 'Serverfehler beim Speichern der Datei' });
  }
}
