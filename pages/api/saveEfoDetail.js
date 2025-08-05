import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  try {
    const genomeName = req.body.genomeName || req.body.genomeFileName;
    const { efoId, detail } = req.body;

    if (!genomeName || !efoId || !Array.isArray(detail)) {
      return res.status(400).json({ error: 'Fehlende oder ungültige Felder: genomeName, efoId oder detail (kein Array)' });
    }

    const dir = path.join(process.cwd(), 'public', 'results', genomeName, 'details');
    const filePath = path.join(dir, `${efoId}.json`);

    fs.mkdirSync(dir, { recursive: true });

    // 💾 Schreibe Array von PGS-Ergebnissen
    fs.writeFileSync(filePath, JSON.stringify(detail, null, 2));

    return res.status(200).json({ path: `/results/${genomeName}/details/${efoId}.json` });
  } catch (err) {
    console.error('❌ Fehler beim Speichern:', err);
    return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
  }
}
