// lib/computePRS.js
import fs from 'fs';
import path from 'path';
import pako from 'pako';
import { parse23andMe } from './parse23andme.client.js';
import { parse } from 'csv-parse/sync';

const SCORES_META_URL = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv';
const MAX_TOP_VARIANTS = 100;
const MAX_VARIANTS_ALLOWED = 1_000_000;  // Skip ultra-large PGS files
const MAX_RETRIES = 3;                   // Retry for failed downloads
const RETRY_DELAY_MS = 3000;             // 3 seconds between retries

// Lokales Caching
const LOCAL_PGS_DIR = './pgs_scores';
const UNPACKED_DIR = './pgs_scores/unpacked';
fs.mkdirSync(LOCAL_PGS_DIR, { recursive: true });
fs.mkdirSync(UNPACKED_DIR, { recursive: true });

/**
 * Download mit Retry-Logik (für instabile FTP-Server)
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return res;
    } catch (err) {
      console.warn(`Fetch fehlgeschlagen (${url}), Versuch ${i}/${retries}: ${err.message}`);
      if (i < retries) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(`Download fehlgeschlagen nach ${retries} Versuchen: ${url}`);
}

/**
 * Lädt und dekomprimiert eine PGS-Datei, bevorzugt lokal.
 */
export async function fetchPGSFile(id) {
  const unpackedPath = path.join(UNPACKED_DIR, `${id}_hmPOS_GRCh37.txt`);
  const gzPath = path.join(LOCAL_PGS_DIR, `${id}_hmPOS_GRCh37.txt.gz`);

  // 1) Wenn bereits entpackt vorhanden, direkt zurückgeben
  if (fs.existsSync(unpackedPath)) {
    return fs.readFileSync(unpackedPath, 'utf8');
  }

  let buffer;

  // 2) Wenn komprimiert lokal vorhanden, laden
  if (fs.existsSync(gzPath)) {
    buffer = fs.readFileSync(gzPath);
  } else {
    // 3) Sonst vom FTP-Server herunterladen
    const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh37.txt.gz`;
    const res = await fetchWithRetry(url);
    buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(gzPath, buffer); // lokal cachen
  }

  // 4) Dekomprimieren und entpackt speichern
  const decompressed = pako.ungzip(buffer, { to: 'string' });
  if (typeof decompressed !== 'string') {
    throw new Error(`PGS-Datei (${id}) konnte nicht entpackt werden`);
  }

  fs.writeFileSync(unpackedPath, decompressed, 'utf8');
  return decompressed;
}

/**
 * Holt alle PGS-IDs für eine gegebene EFO-ID aus der Metadaten-CSV.
 */
async function getPGSForEFO(efoId) {
  const res = await fetchWithRetry(SCORES_META_URL);
  const csvText = await res.text();
  const records = parse(csvText, { columns: true, skip_empty_lines: true });

  return records
    .filter(r => (r['Mapped Trait(s) (EFO ID)'] || '')
      .split(',')
      .map(x => x.trim())
      .includes(efoId))
    .map(r => r['Polygenic Score (PGS) ID']);
}

function hasValidBetas(minScore, maxScore) {
  return !(minScore === 0 && maxScore > 1);
}

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

/**
 * Berechnet PRS-Werte für ein 23andMe-Genom und eine EFO-ID.
 */
export async function computePRS(genomeFile, progressCallback, efoId) {
  console.log(`==> Starte computePRS für ${efoId}`);
  if (!efoId || !/^EFO_\d+$/.test(efoId)) {
    throw new Error(`Ungültige ID: "${efoId}". Erwartet wird EFO_xxxx.`);
  }

  const pgsIds = await getPGSForEFO(efoId);
  if (!pgsIds.length) throw new Error(`Kein PGS für Trait ${efoId} gefunden.`);
  console.log(`==> ${pgsIds.length} PGS Scores für ${efoId} gefunden.`);

  const genomeTxt = await genomeFile.text();
  const snps = parse23andMe(genomeTxt);
  console.log(`==> 23andMe enthält ${snps.length} Varianten.`);

  const genomeByChrPos = {};
  snps.forEach(s => { genomeByChrPos[`${s.chrom}:${s.pos}`] = s.genotype.toUpperCase(); });

  const results = [];
  let completedPGS = 0;

  for (const id of pgsIds) {
    let phase = 'Lädt PGS…';
    progressCallback?.(id, 0, 0, phase, completedPGS, pgsIds.length);

    try {
      const txt = await fetchPGSFile(id);
      const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));

      if (lines.length > MAX_VARIANTS_ALLOWED) {
        //console.warn(`Überspringe ${id}: ${lines.length} Varianten (zu groß)`);
        completedPGS++;
        continue;
      }

      phase = 'Verarbeite Datei…';
      progressCallback?.(id, 10, 0, phase, completedPGS, pgsIds.length);

      const header = lines.shift().split('\t');
      const rows = lines.map(l => l.split('\t'));

      const indChr = header.indexOf('hm_chr');
      const indPos = header.indexOf('hm_pos');
      const indEA = header.indexOf('effect_allele');
      const indOA = header.indexOf('other_allele') !== -1
        ? header.indexOf('other_allele')
        : header.indexOf('hm_inferOtherAllele');
      const indWeight = header.indexOf('effect_weight');
      const indRSID = header.indexOf('rsID') >= 0 ? header.indexOf('rsID') : null;

      const totalRows = rows.length;
      const blockSize = 1000; // Speicherfreundlich
      let lastPct = 0;

      let rawScore = 0;
      let minScore = Infinity, maxScore = -Infinity;
      let topVariants = [];

      for (let start = 0; start < totalRows; start += blockSize) {
        const block = rows.slice(start, start + blockSize);

        for (const row of block) {
          const chr = row[indChr];
          const pos = row[indPos];
          const ea = row[indEA]?.toUpperCase();
          const beta = parseFloat(row[indWeight]) || 0;
          const genotype = genomeByChrPos[`${chr}:${pos}`];
          const rsid = indRSID !== null ? row[indRSID] : '';
          if (!genotype || !/^[ACGT]{2}$/.test(genotype)) continue;

          const count = (genotype.match(new RegExp(ea, 'g')) || []).length;
          const score = count * beta;
          rawScore += score;
          minScore = Math.min(minScore, score);
          maxScore = Math.max(maxScore, score);

          const entry = {
            variant: `Chr${chr}.${pos}:g.${row[indOA]}>${ea}`,
            rsid, beta, z: count, score, alleles: genotype
          };

          topVariants.push(entry);
          topVariants.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
          if (topVariants.length > MAX_TOP_VARIANTS) topVariants.pop();
        }

        const pct = ((start + block.length) / totalRows) * 90 + 10;
        if (progressCallback && pct - lastPct >= 5) {
          lastPct = pct;
          progressCallback(id, pct, start, 'Berechne Matches…', completedPGS, pgsIds.length);
        }
      }

      if (!topVariants.length || !hasValidBetas(minScore, maxScore)) {
        completedPGS++;
        continue;
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
        matches: totalRows,
        totalVariants: totalRows,
        topVariants,
      });

      progressCallback?.(id, 100, totalRows, 'Abgeschlossen', ++completedPGS, pgsIds.length);

    } catch (e) {
      //console.error(`Fehler bei PGS ${id}: ${e.message}`);
      completedPGS++;
    }
  }

  if (!results.length) {
    throw new Error(`Kein PGS mit Betas und Matches gefunden für ${efoId}.`);
  }
  return results;
}
