// scripts/run_batch.js
import fs from 'fs';
import path from 'path';
import { computePRS } from '../lib/computePRS.js';
import traits from '../public/traits.json' assert { type: 'json' };

const MAX_PARALLEL = 5;
const GENOME_FILE = './public/sample_genome.txt';
const OUTPUT_CSV = './public/batch_results.csv';
const OUTPUT_DIR = './public/details';

// CSV-Header schreiben
function writeCSVHeader() {
  fs.writeFileSync(
    OUTPUT_CSV,
    'EFO-ID,Trait,PGS Count,Avg PRS,Max PRS,Min PRS,Avg Percentile,Max Percentile,Min Percentile,Total Variants\n'
  );
}

// Zeilen in CSV schreiben + JSON speichern
function saveResults(efoId, traitLabel, allResults) {
  // JSON pro EFO speichern (Detaildaten)
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }
  const jsonPath = path.join(OUTPUT_DIR, `${efoId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));

  // Aggregierte CSV schreiben
  const prsValues = allResults.map(r => r.prs || 0);
  const percValues = allResults.map(r => r.percentile || 0);
  const totalVariants = allResults.reduce((a, b) => a + (b.matches || 0), 0);

  const row = [
    efoId,
    `"${traitLabel}"`,
    allResults.length,
    (prsValues.reduce((a, b) => a + b, 0) / prsValues.length).toFixed(3),
    Math.max(...prsValues).toFixed(3),
    Math.min(...prsValues).toFixed(3),
    (percValues.reduce((a, b) => a + b, 0) / percValues.length).toFixed(1),
    Math.max(...percValues).toFixed(1),
    Math.min(...percValues).toFixed(1),
    totalVariants
  ].join(',');

  fs.appendFileSync(OUTPUT_CSV, row + '\n');
}

// Patch: computePRS so verwenden, dass es String-Input akzeptiert
async function computePRSWithString(genomeText, efoId) {
  const fakeFile = { text: async () => genomeText };
  return computePRS(fakeFile, () => {}, efoId);
}

async function runBatch() {
  console.log(`==> Starte Batch-Analyse für ${traits.length} EFO-Traits...`);
  writeCSVHeader();

  const genomeText = fs.readFileSync(GENOME_FILE, 'utf8');

  let index = 0;
  let running = [];

  const runNext = async () => {
    if (index >= traits.length) return;

    const trait = traits[index++];
    const efoId = trait.id;
    const label = trait.label;

    console.log(`--> Starte Berechnung für ${label} (${efoId})...`);

    const task = computePRSWithString(genomeText, efoId)
      .then(results => {
        saveResults(efoId, label, results);
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

  console.log(`==> Batch-Analyse abgeschlossen. Ergebnisse in ${OUTPUT_CSV} und JSONs in ${OUTPUT_DIR}.`);
}

runBatch().catch(err => console.error('Fehler bei Batch-Analyse:', err));
