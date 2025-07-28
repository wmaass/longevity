// scripts/fetch_traits.js
import fs from 'fs';
import fetch from 'node-fetch';

const API_URL = 'https://www.pgscatalog.org/rest/trait_category/all';
const OUTPUT_FILE = './public/traits.json';

async function fetchAllTraits() {
  console.log('==> Lade Traits (inkl. Kategorien) aus PGS Catalog...');

  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`Fehler beim Abrufen: ${res.statusText}`);
  }

  const data = await res.json();

  const allTraits = [];

  // Jede Kategorie durchlaufen und Traits extrahieren
  data.results.forEach(category => {
    const catLabel = category.label;
    category.efotraits.forEach(trait => {
      allTraits.push({
        id: trait.id,
        label: trait.label,
        description: trait.description,
        url: trait.url,
        category: catLabel,
      });
    });
  });

  console.log(`==> ${allTraits.length} Traits gefunden. Speichere in ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allTraits, null, 2));
  console.log('==> Fertig! Datei erstellt.');
}

fetchAllTraits().catch(err => {
  console.error('Fehler beim Erstellen von traits.json:', err);
});
