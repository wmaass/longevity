// scripts/fetch_pgs_abstract.js
import fs from 'fs';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';

const META_URL = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv';
const OUTPUT_DIR = './pgs_abstracts';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

async function fetchMetadata() {
  console.log('==> Lade PGS-Metadaten...');
  const res = await fetch(META_URL);
  if (!res.ok) throw new Error(`Fehler beim Laden der Metadaten: ${res.statusText}`);
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true });
}

// Holt Abstract aus Europe PMC
async function fetchAbstract({ doi, pmid }) {
  let query = '';
  if (doi) {
    query = `search?query=DOI:${encodeURIComponent(doi)}&resultType=core`;
  } else if (pmid) {
    query = `search?query=EXT_ID:${pmid}&resultType=core`;
  } else {
    throw new Error('Kein DOI oder PMID vorhanden');
  }

  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${query}&format=json`;
  console.log(`==> Suche Abstract: ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fehler bei Europe PMC: ${res.statusText}`);
  const json = await res.json();

  const hit = json.resultList?.result?.[0];
  return hit?.abstractText || 'Kein Abstract gefunden.';
}

async function fetchPGSAbstract(pgsId) {
  console.log(`==> Starte Suche für ${pgsId}`);

  const records = await fetchMetadata();
  const record = records.find(r => r['Polygenic Score (PGS) ID'] === pgsId);

  if (!record) {
    console.error(`Kein Eintrag gefunden für ${pgsId}`);
    return;
  }

  const doi = record['Publication (doi)'] || '';
  const pmid = record['Publication (PMID)'] || '';
  console.log(`Gefunden: DOI=${doi}, PMID=${pmid}`);

  try {
    const abstract = await fetchAbstract({ doi, pmid });
    const outputFile = `${OUTPUT_DIR}/${pgsId}_abstract.txt`;
    fs.writeFileSync(outputFile, abstract, 'utf8');
    console.log(`✓ Abstract gespeichert: ${outputFile}`);
  } catch (err) {
    console.error(`✗ Fehler beim Abrufen des Abstracts für ${pgsId}: ${err.message}`);
  }
}

// Script starten (z. B. mit: node scripts/fetch_pgs_abstract.js PGS000570)
const targetPGS = process.argv[2] || 'PGS000570';
fetchPGSAbstract(targetPGS).catch(err => console.error(err));
