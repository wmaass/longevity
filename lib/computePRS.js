import pako from 'pako';
import { parse23andMe } from './parse23andme.client.js';

// Stroke-relevante PGS IDs (größte mit einbezogen – kann dauern)
const PGS_IDS = ['PGS000004', 'PGS000894', 'PGS002274', 'PGS003637'];

// PGS-Datei herunterladen & entpacken
async function fetchPGS(id) {
  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh37.txt.gz`;
  console.log(`==> Lade PGS (GRCh37): ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`PGS-Download fehlgeschlagen (${id}): ${res.statusText}`);

  const buffer = await res.arrayBuffer();
  const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
  if (typeof decompressed !== 'string') {
    throw new Error(`PGS-Datei (${id}) konnte nicht als String entpackt werden`);
  }
  return decompressed;
}

// Betas prüfen (um Hazard Ratios auszuschließen)
function hasValidBetas(scores) {
  if (!scores || scores.length === 0) return false;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  return !(minScore === 0 && maxScore > 1);
}

// Z‑Score & Perzentil berechnen (annähernd, ohne Referenzpopulation)
function computeStats(rawScore) {
  const mean = 0;
  const stdDev = 1;
  const z = (rawScore - mean) / stdDev;

  const erf = (x) => {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const tau =
      t *
      Math.exp(
        -x * x -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t *
                            (0.27886807 +
                              t *
                                (-1.13520398 +
                                  t *
                                    (1.48851587 +
                                      t *
                                        (-0.82215223 + t * 0.17087277))))))))
      );
    return sign * (1 - tau);
  };

  const percentile = Math.round(((1 + erf(z / Math.sqrt(2))) / 2) * 100);
  return { z, percentile };
}

// Hauptlogik: PRS berechnen
export async function computePRS(genomeFile, progressCallback, efoId) {
  // → fetch PGS IDs via traits API oder scores API:
  const res = await fetch(`https://www.pgscatalog.org/rest/scores?efo_id=${efoId}`);
  const json = await res.json();
  const pgsIds = json._embedded.scores.map(s => s.pgs_id);
  
  const genomeTxt = await genomeFile.text();
  const snps = parse23andMe(genomeTxt);
  console.log(`==> 23andMe enthält ${snps.length} Varianten`);

  const genomeByChrPos = {};
  snps.forEach(s => {
    genomeByChrPos[`${s.chrom}:${s.pos}`] = s.genotype.toUpperCase();
  });

  const results = [];
  let completedPGS = 0;

  for (const id of PGS_IDS) {
    let phase = 'Lädt PGS…';
    progressCallback?.(id, 0, 0, phase, completedPGS, PGS_IDS.length);

    try {
      const txt = await fetchPGS(id);
      phase = 'Verarbeite Datei…';
      progressCallback?.(id, 10, 0, phase, completedPGS, PGS_IDS.length);

      const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
      const header = lines.shift().split('\t');
      const rows = lines.map(l => l.split('\t'));

      const indChr = header.indexOf('hm_chr');
      const indPos = header.indexOf('hm_pos');
      const indEA = header.indexOf('effect_allele');
      const indOA = header.indexOf('other_allele') !== -1 ? header.indexOf('other_allele') : header.indexOf('hm_inferOtherAllele');
      const indWeight = header.indexOf('effect_weight');
      const indRSID = header.indexOf('rsID') >= 0 ? header.indexOf('rsID') : null;

      const matches = [];
      const riskScores = [];
      const totalRows = rows.length;

      rows.forEach((row, idx) => {
        const chr = row[indChr];
        const pos = row[indPos];
        const ea = row[indEA]?.toUpperCase();
        const beta = parseFloat(row[indWeight]) || 0;
        const genotype = genomeByChrPos[`${chr}:${pos}`];
        const rsid = indRSID !== null ? row[indRSID] : '';

        if (!genotype || !/^[ACGT]{2}$/.test(genotype)) return;

        const count = (genotype.match(new RegExp(ea, 'g')) || []).length;
        const score = count * beta;

        matches.push({
          variant: `Chr${chr}.${pos}:g.${row[indOA]}>${ea}`,
          rsid,
          beta,
          z: count,
          score,
          alleles: genotype,
        });

        riskScores.push(score);

        if (idx % 500 === 0) {
          const pct = (idx / totalRows) * 90 + 10;
          phase = 'Berechne Matches…';
          progressCallback?.(id, pct, matches.length, phase, completedPGS, PGS_IDS.length);
        }
      });

      if (!matches.length || !hasValidBetas(riskScores)) {
        completedPGS++;
        continue;
      }

      const rawScore = riskScores.reduce((a, b) => a + b, 0);
      const PRS = Math.exp(rawScore);
      const { z, percentile } = computeStats(rawScore);

      matches.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

      // DOI aus Metadaten oder Kommentar extrahieren
      const metaLine = lines.find(l => l.includes('10.')) || '';
      const doiMatch = metaLine.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
      const doi = doiMatch ? `https://doi.org/${doiMatch[0]}` : null;

      results.push({
        id,
        trait: 'Stroke (PGS)',
        rawScore,
        prs: PRS,
        zScore: z,
        percentile,
        matches: matches.length,
        totalVariants: totalRows,
        doi,
        topVariants: matches.slice(0, 20),
      });

      phase = 'Abgeschlossen';
      progressCallback?.(id, 100, matches.length, phase, ++completedPGS, PGS_IDS.length);
    } catch (e) {
      console.error(`Fehler bei PGS ${id}: ${e.message}`);
      completedPGS++;
    }
  }

  if (!results.length) throw new Error('Kein geeignetes Stroke-PGS mit Betas und Matches gefunden.');
  return results;
}
