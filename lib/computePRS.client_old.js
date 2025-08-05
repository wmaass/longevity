import pako from 'pako';
import { parse23andMe } from './parse23andme.client';
import { parse } from 'csv-parse/browser/esm/sync';

const CONFIG = {
  MAX_VARIANTS_ALLOWED: 100,
  MAX_TOP_VARIANTS: 100,
  METADATA_URL: 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv'
};

const cache = new Map();

function computeStats(rawScore) {
  const z = rawScore;
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
  if (cache.has(pgsId)) return cache.get(pgsId);

  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${pgsId}`);

  const uint8 = new Uint8Array(await res.arrayBuffer());
  const decompressed = pako.inflate(uint8, { to: 'string' });

  cache.set(pgsId, decompressed);
  return decompressed;
}

function matchGenotype(genomeMap, chr, pos, ea) {
  const genotype = genomeMap.get(`${chr}:${pos}`);
  if (!genotype || genotype.length !== 2) return { count: 0, genotype: null };
  let count = 0;
  if (genotype[0] === ea) count++;
  if (genotype[1] === ea) count++;
  return { count, genotype };
}

export async function computePRS(genomeFile, progressCallback, efoId) {
  const genomeTxt = await genomeFile.text();
  const snps = parse23andMe(genomeTxt);
  const genomeByChrPos = new Map(snps.map(s => [`${s.chrom}:${s.pos}`, s.genotype.toUpperCase()]));

  const res = await fetch(CONFIG.METADATA_URL);
  const metadata = parse(await res.text(), { columns: true, skip_empty_lines: true });

  const efoSet = new Set([efoId]);
  const pgsIds = metadata
    .filter(r => {
      const mapped = (r['Mapped Trait(s) (EFO ID)'] || '').split(';').map(e => e.trim());
      const original = (r['Trait EFO(s)'] || '').split(';').map(e => e.trim());
      return mapped.some(e => efoSet.has(e)) || original.some(e => efoSet.has(e));
    })
    .map(r => r['Polygenic Score (PGS) ID']);

  if (!pgsIds.length) {
    progressCallback?.(efoId, null, 'warn', `⚠️ Kein PGS für ${efoId} gefunden.`);
    return [];
  }

  const results = [];

  await Promise.allSettled(pgsIds.map(async (pgsId) => {
    try {
      progressCallback?.(efoId, pgsId, 'info', `↳ Lade PGS ${pgsId}`);
      const txt = await fetchPGSFile(pgsId);
      const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
      if (lines.length > CONFIG.MAX_VARIANTS_ALLOWED) {
        progressCallback?.(efoId, pgsId, 'warn', `❌ Übersprungen: ${pgsId}, zu viele Zeilen (${lines.length})`);
        return;
      }

      const [headerLine, ...dataLines] = lines;
      const header = headerLine.split('\t');
      const index = name => header.indexOf(name);
      const idx = {
        chr: index('hm_chr'),
        pos: index('hm_pos'),
        ea: index('effect_allele'),
        oa: index('other_allele'),
        weight: index('effect_weight'),
        rsid: index('rsID')
      };
      if (Object.values(idx).some(i => i === -1)) throw new Error(`Ungültiges PGS-Format: ${pgsId}`);

      let rawScore = 0;
      const topVariants = [];

      for (const line of dataLines) {
        const row = line.split('\t');
        const chr = row[idx.chr];
        const pos = row[idx.pos];
        const ea = row[idx.ea]?.toUpperCase();
        const beta = parseFloat(row[idx.weight]) || 0;

        const { count, genotype } = matchGenotype(genomeByChrPos, chr, pos, ea);
        if (!genotype) continue;

        const score = count * beta;
        rawScore += score;

        const entry = {
          variant: `Chr${chr}.${pos}:g.${row[idx.oa]}>${ea}`,
          rsid: row[idx.rsid],
          beta,
          z: count,
          score,
          alleles: genotype
        };

        if (topVariants.length < CONFIG.MAX_TOP_VARIANTS) {
          topVariants.push(entry);
        } else {
          const minIdx = topVariants.reduce((iMin, e, i, arr) => Math.abs(e.score) < Math.abs(arr[iMin].score) ? i : iMin, 0);
          if (Math.abs(entry.score) > Math.abs(topVariants[minIdx].score)) {
            topVariants[minIdx] = entry;
          }
        }
      }

      const PRS = Math.exp(rawScore);
      const { z, percentile } = computeStats(rawScore);

      results.push({
        id: pgsId,
        trait: `PGS für ${efoId}`,
        rawScore,
        prs: PRS,
        zScore: z,
        percentile,
        matches: topVariants.length,
        totalVariants: dataLines.length,
        topVariants
      });

      progressCallback?.(efoId, pgsId, 'success', `✓ ${pgsId} abgeschlossen (${topVariants.length} Matches)`);
    } catch (e) {
      const msg = `❌ Fehler bei ${pgsId}: ${e.message}`;
      console.warn(msg);
      progressCallback?.(efoId, pgsId, 'error', msg);
    }
  }));

  if (!results.length) {
    progressCallback?.(efoId, null, 'warn', `⚠️ Kein passender PGS mit Matches für ${efoId}.`);
    return [];
  }

  return results;
}