// scripts/download_all_pgs.js
import fs from 'fs';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import path from 'path';

// Directory to store downloaded PGS files
const OUTPUT_DIR = './pgs_scores';
const SCORES_META_URL = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv';

// Fetch metadata and extract all PGS IDs
async function getAllPGSIds() {
  console.log('==> Lade PGS-Metadaten...');
  const res = await fetch(SCORES_META_URL);
  if (!res.ok) throw new Error(`Konnte PGS-Metadaten nicht laden: ${res.statusText}`);
  const csv = await res.text();
  const records = parse(csv, { columns: true, skip_empty_lines: true });
  return records.map(r => r['Polygenic Score (PGS) ID']);
}

// Download a single PGS file (gzipped), but skip if file exists
async function downloadPGS(pgsId) {
  const filePath = path.join(OUTPUT_DIR, `${pgsId}_hmPOS_GRCh37.txt.gz`);

  // Skip download if already present
  if (fs.existsSync(filePath)) {
    console.log(`✓ Überspringe ${pgsId} (bereits vorhanden)`);
    return;
  }

  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;
  console.log(`==> Lade PGS-Datei: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`✗ Fehler: ${pgsId} konnte nicht geladen werden (${res.statusText})`);
    return;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  console.log(`✓ Gespeichert: ${filePath}`);
}

// Main process
async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const allIds = await getAllPGSIds();
  console.log(`==> ${allIds.length} PGS Scores gefunden. Starte Download (überspringe vorhandene)...`);

  for (const id of allIds) {
    try {
      await downloadPGS(id);
    } catch (err) {
      console.error(`✗ Fehler bei ${id}: ${err.message}`);
    }
  }

  console.log(`==> Alle fehlenden PGS-Dateien wurden in ${OUTPUT_DIR} gespeichert.`);
}

run().catch(err => console.error('Fehler beim Download:', err));
