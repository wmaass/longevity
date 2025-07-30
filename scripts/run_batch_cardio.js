// scripts/run_batch_cardio.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computePRS } from '../lib/computePRS.js';

// __dirname für ESM erzeugen
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dateipfade absolut setzen
const TRAITS_FILE = path.resolve(__dirname, '../public/traits.json');
const GENOME_FILE = path.resolve(__dirname, '../public/genome_WM_v4_Full_20170614045048.txt');
const OUTPUT_CSV  = path.resolve(__dirname, '../public/batch_results_cardio.csv');
const DETAILS_CSV = path.resolve(__dirname, '../public/batch_details_cardio.csv');

const traits = JSON.parse(fs.readFileSync(TRAITS_FILE, 'utf8'));
const MAX_PARALLEL = 1;

const CARDIO_EFO_IDS = [
  'EFO_0004611','EFO_0004612','EFO_0004530',
  'EFO_0001645','EFO_0006335','EFO_0004574',
  'EFO_0000537','EFO_0000275','EFO_0006336',
  'EFO_0004458','EFO_0004541'
];

const cardioTraits = traits.filter(t => CARDIO_EFO_IDS.includes(t.id));

function writeCSVHeader() {
  fs.writeFileSync(
    OUTPUT_CSV,
    'EFO-ID,Trait,PGS Count,Avg PRS,Max PRS,Min PRS,Avg Percentile,Max Percentile,Min Percentile,Total Variants\n'
  );
}

function writeDetailsHeader() {
  fs.writeFileSync(
    DETAILS_CSV,
    'EFO-ID,Trait,PGS-ID,PRS,Z-Score,Perzentil,Matches,Total Variants,DOI\n'
  );
}

function appendCSV(efoId, traitLabel, allResults) {
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

function appendDetailsCSV(efoId, traitLabel, allResults) {
  const lines = allResults.map(r => [
    efoId,
    `"${traitLabel}"`,
    r.id,
    r.prs.toFixed(6),
    r.zScore.toFixed(3),
    r.percentile,
    r.matches,
    r.totalVariants,
    r.doi || ''
  ].join(','));

  fs.appendFileSync(DETAILS_CSV, lines.join('\n') + '\n');
}

async function computePRSWithString(genomeText, progressCallback, efoId) {
  const fakeFile = { text: async () => genomeText };
  return computePRS(fakeFile, progressCallback, efoId);
}

async function runBatchCardio() {
  console.log(`==> Starte Batch-Analyse für ${cardioTraits.length} Traits...`);
  writeCSVHeader();
  writeDetailsHeader();

  const genomeText = fs.readFileSync(GENOME_FILE, 'utf8');

  let index = 0;
  let running = [];

  const runNext = async () => {
    if (index >= cardioTraits.length) return;

    const trait = cardioTraits[index++];
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
    if (running.length < MAX_PARALLEL) runNext();
  };

  for (let i = 0; i < MAX_PARALLEL; i++) runNext();
  await Promise.all(running);

  console.log(`==> Batch-Analyse abgeschlossen. Ergebnisse in:`);
  console.log(`   - ${OUTPUT_CSV}`);
  console.log(`   - ${DETAILS_CSV}`);
}

runBatchCardio().catch(err => console.error('Fehler bei Batch-Analyse:', err));
