import fs from 'fs';
import path from 'path';
import { computePRS } from '../lib/computePRS.js';

const traitsPath = path.resolve('./public/traits.json');
const traits = JSON.parse(fs.readFileSync(traitsPath, 'utf8'));


const MAX_PARALLEL = 5;
const GENOME_FILE = './public/genome_WM_v4_Full_20170614045048.txt';
const OUTPUT_CSV = './public/batch_results.csv';
const DETAILS_CSV = './public/batch_details.csv';

// CSV-Header für die Übersicht
function writeCSVHeader() {
  fs.writeFileSync(
    OUTPUT_CSV,
    'EFO-ID,Trait,PGS Count,Avg PRS,Max PRS,Min PRS,Avg Percentile,Max Percentile,Min Percentile,Total Variants\n'
  );
}

// CSV-Header für Details
function writeDetailsHeader() {
  fs.writeFileSync(
    DETAILS_CSV,
    'EFO-ID,Trait,PGS-ID,PRS,Z-Score,Perzentil,Matches,Total Variants,DOI\n'
  );
}

// Zeilen in batch_results.csv schreiben
function appendCSV(efoId, traitLabel, allResults) {
  const prsValues = allResults.map(r => r.prs || 0);
  const percValues = allResults.map(r => r.percentile || 0);
  const totalVariants = allResults.reduce((a, b) => a + (b.matches || 0), 0);

  const avgPRS = prsValues.length
    ? (prsValues.reduce((a, b) => a + b, 0) / prsValues.length).toFixed(3)
    : 0;

  const avgPerc = percValues.length
    ? (percValues.reduce((a, b) => a + b, 0) / percValues.length).toFixed(1)
    : 0;

  const row = [
    efoId,
    `"${traitLabel}"`,
    allResults.length,
    avgPRS,
    prsValues.length ? Math.max(...prsValues).toFixed(3) : 0,
    prsValues.length ? Math.min(...prsValues).toFixed(3) : 0,
    avgPerc,
    percValues.length ? Math.max(...percValues).toFixed(1) : 0,
    percValues.length ? Math.min(...percValues).toFixed(1) : 0,
    totalVariants
  ].join(',');

  fs.appendFileSync(OUTPUT_CSV, row + '\n');
}

// Alle PGS-Detailergebnisse pro Trait in batch_details.csv speichern
function appendDetailsCSV(efoId, traitLabel, allResults) {
  const lines = allResults.map(r => {
    return [
      efoId,
      `"${traitLabel}"`,
      r.id,
      r.prs?.toFixed(6) ?? 0,
      r.zScore?.toFixed(3) ?? 0,
      r.percentile ?? 0,
      r.matches ?? 0,
      r.totalVariants ?? 0,
      r.doi || ''
    ].join(',');
  });

  fs.appendFileSync(DETAILS_CSV, lines.join('\n') + '\n');
}

// computePRS so anpassen, dass es String statt File akzeptiert
async function computePRSWithString(genomeText, progressCallback, efoId) {
  const fakeFile = { text: async () => genomeText };
  return computePRS(fakeFile, progressCallback, efoId);
}

// Batch Runner
async function runBatch() {
  console.log(`==> Starte Batch-Analyse für ${traits.length} EFO-Traits...`);
  writeCSVHeader();
  writeDetailsHeader();

  const genomeText = fs.readFileSync(GENOME_FILE, 'utf8');

  let index = 0;
  let running = [];

  const runNext = async () => {
    if (index >= traits.length) return;

    const trait = traits[index++];
    const efoId = trait.id;
    const label = trait.label;

    console.log(`--> Starte Berechnung für ${label} (${efoId})...`);

    const task = computePRSWithString(genomeText, () => {}, efoId)
      .then(results => {
        appendCSV(efoId, label, results);
        appendDetailsCSV(efoId, label, results);
        console.log(`✓ Fertig: ${label} (${efoId})`);
      })
      .catch(err => {
        console.error(`✗ Fehler bei ${label} (${efoId}): ${err.message}`);
      })
      .finally(() => {
        running = running.filter(r => r !== task);
        runNext();
      });

    running.push(task);

    if (running.length < MAX_PARALLEL) {
      runNext();
    }
  };

  for (let i = 0; i < MAX_PARALLEL; i++) {
    runNext();
  }

  await Promise.all(running);

  console.log(`==> Batch-Analyse abgeschlossen. Ergebnisse in:`);
  console.log(`   - ${OUTPUT_CSV} (Zusammenfassung)`);
  console.log(`   - ${DETAILS_CSV} (Alle PGS-Ergebnisse)`);
}

runBatch().catch(err => console.error('Fehler bei Batch-Analyse:', err));
