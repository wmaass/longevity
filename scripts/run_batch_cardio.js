// scripts/run_batch_cardio_client.js
import { computePRS } from '../lib/computePRS.js';

// URLs for loading data (must be in /public folder so Next.js can serve them)
const TRAITS_URL = '/traits.json';
const GENOME_URL = '/genome_WM_v4_Full_20170614045048.txt';

const MAX_PARALLEL = 5;

// Nur diese EFOs analysieren (Cardio-relevant)
const CARDIO_EFO_IDS = [
  'EFO_0004611', // LDL cholesterol
  'EFO_0004612', // HDL cholesterol
  'EFO_0004530', // Triglycerides
  'EFO_0001645', // Coronary artery disease
  'EFO_0006335', // Systolic blood pressure
  'EFO_0004574', // Total cholesterol
  'EFO_0000537', // Hypertension
  'EFO_0000275', // Atrial fibrillation
  'EFO_0006336', // Diastolic blood pressure
  'EFO_0004458', // CRP measurement
  'EFO_0004541'  // HbA1c measurement
];

// Helper: fetch text from public files
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.text();
}

// Helper: trigger CSV download in browser
function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Wrapper to run computePRS with a plain text genome file
async function computePRSWithString(genomeText, progressCallback, efoId) {
  const fakeFile = { text: async () => genomeText };
  return computePRS(fakeFile, progressCallback, efoId);
}

// Main batch function (client-side)
export async function runBatchCardioClient() {
  console.log('==> Lade Daten...');
  const [traitsJSON, genomeText] = await Promise.all([
    fetchText(TRAITS_URL).then(JSON.parse),
    fetchText(GENOME_URL)
  ]);

  const cardioTraits = traitsJSON.filter(t => CARDIO_EFO_IDS.includes(t.id));
  console.log(`==> Analysiere ${cardioTraits.length} kardiovaskuläre Traits...`);

  // Prepare CSV headers (kept like original)
  let summaryRows = [
    'EFO-ID,Trait,PGS Count,Avg PRS,Max PRS,Min PRS,Avg Percentile,Max Percentile,Min Percentile,Total Variants'
  ];
  let detailsRows = [
    'EFO-ID,Trait,PGS-ID,PRS,Z-Score,Perzentil,Matches,Total Variants,DOI'
  ];

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
        // Summarize results for this trait
        const prsVals = results.map(r => r.prs || 0);
        const percVals = results.map(r => r.percentile || 0);
        const totalVariants = results.reduce((a, b) => a + (b.matches || 0), 0);

        summaryRows.push([
          efoId,
          `"${label}"`,
          results.length,
          (prsVals.reduce((a, b) => a + b, 0) / prsVals.length).toFixed(3),
          Math.max(...prsVals).toFixed(3),
          Math.min(...prsVals).toFixed(3),
          (percVals.reduce((a, b) => a + b, 0) / percVals.length).toFixed(1),
          Math.max(...percVals).toFixed(1),
          Math.min(...percVals).toFixed(1),
          totalVariants
        ].join(','));

        // Detailed per-PGS rows
        results.forEach(r => {
          detailsRows.push([
            efoId,
            `"${label}"`,
            r.id,
            r.prs.toFixed(6),
            r.zScore.toFixed(3),
            r.percentile,
            r.matches,
            r.totalVariants,
            r.doi || ''
          ].join(','));
        });

        console.log(`✓ Fertig: ${label} (${efoId})`);
      })
      .catch(err => console.error(`✗ Fehler bei ${label} (${efoId}): ${err.message}`))
      .finally(() => {
        running = running.filter(r => r !== task);
        runNext();
      });

    running.push(task);
    if (running.length < MAX_PARALLEL) runNext();
  };

  // Run batch with MAX_PARALLEL
  for (let i = 0; i < MAX_PARALLEL; i++) runNext();
  await Promise.all(running);

  // Download CSVs once complete
  downloadCSV('batch_results_cardio.csv', summaryRows.join('\n'));
  downloadCSV('batch_details_cardio.csv', detailsRows.join('\n'));

  console.log('==> Batch-Analyse abgeschlossen. CSV-Dateien wurden heruntergeladen.');
}

// Optional: auto-run when loaded
runBatchCardioClient().catch(err => console.error('Fehler bei Batch-Analyse:', err));
