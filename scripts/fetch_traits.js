// scripts/fetch_traits.js
import fs from 'fs';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';

const TRAITS_CSV = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_efo_traits.csv';
const SCORES_CSV = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv';
const OUTPUT_FILE = './public/traits.json';

async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fehler beim Abrufen von ${url}: ${res.statusText}`);
  return parse(await res.text(), { columns: true, skip_empty_lines: true });
}

async function fetchAndCombineTraits() {
  console.log('==> Lade PGS-Metadaten vom FTP-Server...');
  const traits = await fetchCSV(TRAITS_CSV);
  const scores = await fetchCSV(SCORES_CSV);

  console.log(`==> ${traits.length} Traits und ${scores.length} Scores geladen.`);

  // Häufigkeit je EFO-Trait zählen
  const counts = {};
  scores.forEach(s => {
    const efoField = s['Mapped Trait(s) (EFO ID)'] || '';
    efoField.split(',').map(x => x.trim()).forEach(efo => {
      if (!efo) return;
      counts[efo] = (counts[efo] || 0) + 1;
    });
  });

  // Nur EFO-Traits behalten
  const combined = traits
    .filter(t => counts[t['Ontology Trait ID']] && t['Ontology Trait ID'].startsWith('EFO_'))
    .map(t => ({
      id: t['Ontology Trait ID'],
      label: t['Ontology Trait Label'],
      description: t['Ontology Trait Description'],
      url: t['Ontology URL'],
      count_pgs: counts[t['Ontology Trait ID']]
    }))
    .sort((a, b) => b.count_pgs - a.count_pgs); // Kein .slice()

    console.log(`==> ${combined.length} gültige Traits gefunden. Speichere in ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(combined, null, 2));
    console.log('==> Fertig! traits.json erstellt.');
  }

fetchAndCombineTraits().catch(err => {
  console.error('Fehler beim Erstellen von traits.json:', err);
});
