// lib/matchPGS.js
import { fetchPGSFile } from './fetchPGSFile';
import { getPGSIdsForTrait } from './pgsCatalog';

export async function matchPGS(variants, efoId) {
  const matchedScores = [];
  const pgsIds = await getPGSIdsForTrait(efoId);

  for (const pgsId of pgsIds) {
    try {
      const txt = await fetchPGSFile(pgsId);
      const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
      const records = lines.map(l => l.split('\t'));
      const snpBetas = {};

      for (const [rsid, , , , betaStr] of records) {
        snpBetas[rsid] = parseFloat(betaStr);
      }

      let prs = 0;
      let matched = 0;

      for (const v of variants) {
        if (snpBetas[v.rsid]) {
          const dosage = v.dosage ?? 1;
          prs += snpBetas[v.rsid] * dosage;
          matched++;
        }
      }

      if (matched > 0) {
        matchedScores.push({
          id: pgsId,
          prs,
          zScore: prs, // optional: z-transformieren
          percentile: Math.round(Math.random() * 100), // placeholder
          matches: matched,
          totalVariants: Object.keys(snpBetas).length,
          doi: `https://www.pgscatalog.org/score/${pgsId}`
        });
      }
    } catch (err) {
      console.warn(`❌ Fehler bei ${pgsId}: ${err.message}`);
    }
  }

  return matchedScores;
}
