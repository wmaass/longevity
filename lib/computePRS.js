// lib/computePRS.js
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import pako from 'pako';
import { parse23andMe } from './parse23andme.client.js';
import { parse } from 'csv-parse/sync';

const SCORES_META_URL = 'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv';
const MAX_TOP_VARIANTS = 100;
const MAX_VARIANTS_ALLOWED = 1_000_000;  // Skip ultra-large PGS files
const MAX_RETRIES = 5;                   // Retry for failed downloads
const RETRY_DELAY_MS = 8000;             // 3 seconds between retries
const MAX_SIZE_MB = 10;                  // Skip files over 10 MB (can adjust)

// Local directories
const LOCAL_PGS_DIR = './pgs_scores';
const UNPACKED_DIR = './pgs_scores/unpacked';

// Ensure directories exist
if (!fs.existsSync(LOCAL_PGS_DIR)) fs.mkdirSync(LOCAL_PGS_DIR, { recursive: true });
if (!fs.existsSync(UNPACKED_DIR)) fs.mkdirSync(UNPACKED_DIR, { recursive: true });

/**
 * Retry-enabled fetch (handles FTP hiccups)
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

// Stelle sicher, dass das Verzeichnis existiert
if (!fs.existsSync(UNPACKED_DIR)) fs.mkdirSync(UNPACKED_DIR, { recursive: true });

export async function fetchPGSFile(id) {
  const unpackedPath = path.join(UNPACKED_DIR, `${id}_hmPOS_GRCh37.txt`);
  const gzPath = path.join(LOCAL_PGS_DIR, `${id}_hmPOS_GRCh37.txt.gz`);
  const ftpUrl = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh37.txt.gz`;

  // 1) Unpacked-Version vorhanden?
  if (fs.existsSync(unpackedPath)) {
    //console.log(`==> Verwende entpackte PGS-Datei: ${unpackedPath}`);
    return fs.readFileSync(unpackedPath, 'utf8');
  }

  let gzBuffer;
  // 2) Gzipped-Version vorhanden? Dann lesen
  if (fs.existsSync(gzPath)) {
    console.log(`==> Entpacke lokale PGS-Datei: ${gzPath}`);
    gzBuffer = fs.readFileSync(gzPath);
  } else {
    // 3) Andernfalls von FTP laden
    console.log(`==> Lade PGS-Datei von FTP: ${ftpUrl}`);
    const res = await fetchWithRetry(ftpUrl);
    if (!res.ok) {
      throw new Error(`PGS-Datei ${id} konnte weder lokal gefunden noch von FTP geladen werden (${res.statusText})`);
    }
    gzBuffer = Buffer.from(await res.arrayBuffer());
    // Lokal speichern (gzipped)
    fs.writeFileSync(gzPath, gzBuffer);
  }

  // Entpacken
  const decompressed = pako.ungzip(new Uint8Array(gzBuffer), { to: 'string' });
  if (typeof decompressed !== 'string') {
    throw new Error(`PGS-Datei (${id}) konnte nicht entpackt werden`);
  }

  // Entpackte Version speichern für spätere Runs
  fs.writeFileSync(unpackedPath, decompressed, 'utf8');
  console.log(`==> Entpackte PGS-Datei gespeichert: ${unpackedPath}`);

  return decompressed;
}

/**
 * Get all PGS IDs for a given EFO ID by scanning the metadata CSV.
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
 * Compute PRS values for a 23andMe genome and a given EFO ID (client-safe).
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
      const blockSize = 1000;
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
      completedPGS++;
    }
  }

  if (!results.length) {
    throw new Error(`Kein PGS mit Betas und Matches gefunden für ${efoId}.`);
  }
  return results;
}
