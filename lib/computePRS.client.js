import pako from 'pako';
import { parse23andMe } from './parse23andme.client';
import { parse } from 'csv-parse/browser/esm/sync';

const MAX_VARIANTS_ALLOWED = 100;
const MAX_TOP_VARIANTS = 100;
const METADATA_URL = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv';

function computeStats(rawScore) {
  const mean = 0;
  const stdDev = 1;
  const z = (rawScore - mean) / stdDev;

  const erf = (x) => {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const tau = t * Math.exp(-x * x - 1.26551223 +
      t * (1.00002368 + t * (0.37409196 + t *
        (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t *
          (-1.13520398 + t * (1.48851587 + t *
            (-0.82215223 + t * 0.17087277)))))))));
    return sign * (1 - tau);
  };

  const percentile = Math.round(((1 + erf(z / Math.sqrt(2))) / 2) * 100);
  return { z, percentile };
}

export async function fetchPGSFile(pgsId) {
  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${pgsId}`);

  const arrayBuffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const decompressed = pako.inflate(uint8, { to: 'string' });

  return decompressed;
}

export async function computePRS(genomeFile, progressCallback, efoId) {
  const genomeTxt = await genomeFile.text();
  const snps = parse23andMe(genomeTxt);

  const genomeByChrPos = {};
  snps.forEach(s => {
    genomeByChrPos[`${s.chrom}:${s.pos}`] = s.genotype.toUpperCase();
  });

  const res = await fetch(METADATA_URL);
  const csvText = await res.text();

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true
  });

  const pgsIds = records
    .filter(r => {
      const mapped = (r['Mapped Trait(s) (EFO ID)'] || '')
        .split(';').map(e => e.trim());
      const original = (r['Trait EFO(s)'] || '')
        .split(';').map(e => e.trim());
      return mapped.includes(efoId) || original.includes(efoId);
    })
    .map(r => r['Polygenic Score (PGS) ID']);

  if (!pgsIds.length) {
    throw new Error(`Kein PGS für Trait ${efoId} gefunden.`);
  }

  const results = [];

  for (const id of pgsIds) {
    try {
      progressCallback?.(efoId, id, 'info', `↳ Lade PGS ${id}`);

      const txt = await fetchPGSFile(id);
      const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
      if (lines.length > MAX_VARIANTS_ALLOWED) {
        progressCallback?.(efoId, id, 'warn', `❌ Übersprungen: ${id}, zu viele Zeilen (${lines.length})`);
        continue;
      }

      const header = lines[0].split('\t');
      const rows = lines.slice(1).map(l => l.split('\t'));

      const indChr = header.indexOf('hm_chr');
      const indPos = header.indexOf('hm_pos');
      const indEA = header.indexOf('effect_allele');
      const indOA = header.indexOf('other_allele');
      const indWeight = header.indexOf('effect_weight');
      const indRSID = header.indexOf('rsID');

      let rawScore = 0;
      let topVariants = [];

      for (const row of rows) {
        const chr = row[indChr];
        const pos = row[indPos];
        const ea = row[indEA]?.toUpperCase();
        const beta = parseFloat(row[indWeight]) || 0;
        const genotype = genomeByChrPos[`${chr}:${pos}`];
        if (!genotype || !/^[ACGT]{2}$/.test(genotype)) continue;

        const count = (genotype.match(new RegExp(ea, 'g')) || []).length;
        const score = count * beta;
        rawScore += score;

        const entry = {
          variant: `Chr${chr}.${pos}:g.${row[indOA]}>${ea}`,
          rsid: row[indRSID],
          beta,
          z: count,
          score,
          alleles: genotype
        };

        topVariants.push(entry);
        topVariants.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        if (topVariants.length > MAX_TOP_VARIANTS) topVariants.pop();
      }

      const PRS = Math.exp(rawScore);
      const { z, percentile } = computeStats(rawScore);

      results.push({
        id,
        trait: `PGS für ${efoId}`,
        rawScore,
        prs: PRS,
        zScore: z,
        percentile,
        matches: topVariants.length,
        totalVariants: rows.length,
        topVariants
      });

      progressCallback?.(efoId, id, 'success', `✓ ${id} abgeschlossen (${topVariants.length} Matches)`);

    } catch (e) {
      const msg = `❌ Fehler bei ${id}: ${e.message}`;
      console.warn(msg);
      progressCallback?.(efoId, id, 'error', msg);
    }
  }

    if (!results.length) {
      progressCallback?.(efoId, null, 'warn', `⚠️ Kein passender PGS mit Matches für ${efoId}.`);
      return []; // Kein Fehler werfen, damit nächster EFO läuft
    }



  return results;
}
