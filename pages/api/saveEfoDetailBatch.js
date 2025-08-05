import fs from 'fs';
import path from 'path';
import { parse } from 'json2csv';

export default async function handler(req, res) {
  console.log('🔔 [API] saveEfoDetailBatch aufgerufen');

  if (req.method !== 'POST') {
    console.warn('❌ [API] Methode nicht erlaubt:', req.method);
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { entries } = req.body;
    const genomeName = req.body.genomeName || req.query.genome;

    console.log(`📦 Anzahl empfangener Details: ${entries?.length}`);
    console.log(`🧬 Genomname: ${genomeName}`);

    if (!entries || !Array.isArray(entries) || entries.length === 0 || !genomeName) {
      console.warn('⚠️ [API] Ungültige Anfrage. Fehlende Daten.');
      return res.status(400).json({ error: 'Invalid request body or missing genomeName' });
    }

    const targetDir = path.join(process.cwd(), 'public', 'details');
    fs.mkdirSync(targetDir, { recursive: true });

    const flatEntries = [];

    for (const { efoId, detail } of entries) {
      if (!efoId || !detail) continue;

      // Speichere in /public/details/<EFO-ID>.json (Standard)
      const filePath = path.join(targetDir, `${efoId}.json`);
      let existing = [];

      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          existing = JSON.parse(raw);
        } catch (err) {
          console.warn(`⚠️ Fehler beim Lesen bestehender Datei ${filePath}: ${err.message}`);
        }
      }

      existing.push(detail);
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
      console.log(`✅ Datei geschrieben: ${filePath}`);

      // Zusätzlich auch in /public/results/<genomeName>/details/<EFO-ID>.json
      const resultDetailsDir = path.join(process.cwd(), 'public', 'results', genomeName, 'details');
      fs.mkdirSync(resultDetailsDir, { recursive: true });
      const genomeDetailPath = path.join(resultDetailsDir, `${efoId}.json`);
      fs.writeFileSync(genomeDetailPath, JSON.stringify([detail], null, 2), 'utf-8');

      flatEntries.push({
        efoId,
        id: detail.id,
        trait: detail.trait,
        rawScore: detail.rawScore,
        prs: detail.prs,
        zScore: detail.zScore,
        percentile: detail.percentile,
        matches: detail.matches,
        totalVariants: detail.totalVariants
      });
    }

    // 📄 CSV-Dateien schreiben
    const genomeDir = path.join(process.cwd(), 'public', 'details', genomeName);
    fs.mkdirSync(genomeDir, { recursive: true });

    const resultsCsv = parse(flatEntries);
    fs.writeFileSync(path.join(genomeDir, 'batch_results_cardio.csv'), resultsCsv, 'utf-8');

    const detailsCsv = parse(flatEntries, {
      fields: ['efoId', 'id', 'trait', 'rawScore', 'prs', 'zScore', 'percentile', 'matches', 'totalVariants']
    });
    fs.writeFileSync(path.join(genomeDir, 'batch_details_cardio.csv'), detailsCsv, 'utf-8');

    // 🔁 Kopiere Dateien erst jetzt nach /public/
    const resultDir = path.join(process.cwd(), 'public', 'details', genomeName);
    const files = fs.existsSync(resultDir) ? fs.readdirSync(resultDir) : [];

    for (const file of files) {
      const srcPath = path.join(resultDir, file);
      const destPath = path.join(process.cwd(), 'public', file);
      fs.copyFileSync(srcPath, destPath);
      console.log(`📤 Datei kopiert: ${file}`);
    }

    res.status(200).json({ ok: true, count: entries.length, copiedFiles: files.length });
  } catch (err) {
    console.error('💥 [API] Fehler beim Speichern/Kopieren:', err);
    res.status(500).json({ error: err.message });
  }
}
