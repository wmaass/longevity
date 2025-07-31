// lib/pgsCatalog.js

let traitToPGSCache = null;

export async function getPGSIdsForTrait(efoId) {
  if (!traitToPGSCache) {
    const res = await fetch('https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv');
    const text = await res.text();
    const lines = text.split('\n').filter(l => l && !l.startsWith('pgs_id'));

    // Mapping initialisieren
    traitToPGSCache = {};

    for (const line of lines) {
      const parts = line.split(',');

      const pgsId = parts[0].trim();

      // WICHTIG: Spalte 5 oder 6 verwenden
      const efos = (parts[5] || parts[6])?.split(';').map(e => e.trim()).filter(Boolean) || [];

      for (const efo of efos) {
        if (!traitToPGSCache[efo]) traitToPGSCache[efo] = [];
        traitToPGSCache[efo].push(pgsId);
      }
    }
  }

  return traitToPGSCache[efoId] || [];
}
