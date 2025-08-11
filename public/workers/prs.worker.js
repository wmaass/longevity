// public/workers/prs.worker.js
/* eslint-disable no-restricted-globals */
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

const MAX_VARIANTS_ALLOWED = 10000; // skip gigantic scoring files for browser performance
const MAX_FILE_SIZE_MB     = 10;    // safety guard for local files
const MAX_TOP_VARIANTS     = 10;    // number of top variants to keep per PGS

/** -------------------- Small utils -------------------- */
const splitAny = (s) => (s || '').trim().split(/[\t,; ]+/);
const isNum = (x) => Number.isFinite(x);
const clampPct = (p) => Math.max(0.1, Math.min(99.9, p));
function erf(x){ const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1, t=1/(1+p*Math.abs(x));
  const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y; }
const normalCdf = (z) => 0.5 * (1 + erf(z/Math.SQRT2));
function findIdx(header, candidates){
  const lower = header.map(h => (h||'').toLowerCase());
  for (const name of candidates){
    const i = lower.indexOf(name.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

/** -------------------- Inputs / fetching -------------------- */

function parse23andMe(text){
  return (text || '')
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [rsid, chr, pos, genotypeRaw] = line.trim().split('\t');
      const genotype = (genotypeRaw || '').toUpperCase(); // "AA","AG","--"
      return { rsid, chrom: String(chr || ''), pos: String(pos || ''), genotype };
    });
}

async function fetchAndDecompress(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder().decode(pako.ungzip(new Uint8Array(buf)));
}

async function fetchPGSFile(pgsId, config, emitLog){
  const fileName = `${pgsId}_hmPOS_GRCh37.txt`;
  const url = config?.useLocalFiles
    ? `/pgs_scores/unpacked/${fileName}`
    : `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${fileName}.gz`;

  emitLog(`📁 Lade PGS-Datei: ${fileName}`);
  emitLog(`🌐 Von Pfad: ${url}`);

  try {
    if (config?.useLocalFiles){
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Nicht vorhanden oder nicht lesbar: ${fileName}`);
      const blob = await res.blob();
      const sizeMB = blob.size / 1024 / 1024;
      if (sizeMB > MAX_FILE_SIZE_MB) throw new Error(`📦 Datei zu groß: ${sizeMB.toFixed(2)} MB`);
      const txt = await blob.text();
      emitLog(`✅ Datei erfolgreich geladen (${sizeMB.toFixed(2)} MB)`);
      return txt;
    } else {
      const txt = await fetchAndDecompress(url);
      emitLog(`✅ Datei erfolgreich geladen (remote .gz)`);
      return txt;
    }
  } catch (err) {
    emitLog(`❌ Fehler beim Laden der Datei ${fileName}: ${err.message}`);
    throw err;
  }
}

// Reference stats: public/reference_stats.json with shape { scores: { PGSxxxx: {mu, sd, used?} } }
async function loadReferenceStats() {
  try {
    const res = await fetch("/reference_stats.json", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.scores || null;
  } catch {
    return null;
  }
}

/** AF map: public/eur_af_by_rsid.tsv
 * header: rsid [tab] A [tab] C [tab] G [tab] T
 * rows:   rs123   0.12  0.34  0.21  0.33     (frequencies sum ~1)
 */
async function loadAFMap(emitLog){
  try{
    const res = await fetch('/eur_af_by_rsid.tsv', { cache: 'no-store' });
    if (!res.ok){
      emitLog?.('ℹ️ Kein eur_af_by_rsid.tsv gefunden (AF-Map-Fallback deaktiviert).');
      return null;
    }
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return null;
    const head = splitAny(lines[0]).map(s => s.toUpperCase());
    const iRS = head.indexOf('RSID');
    const iA  = head.indexOf('A');
    const iC  = head.indexOf('C');
    const iG  = head.indexOf('G');
    const iT  = head.indexOf('T');
    if (iRS === -1 || [iA,iC,iG,iT].some(i=>i===-1)){
      emitLog?.('⚠️ eur_af_by_rsid.tsv Header erwartet: rsid A C G T');
      return null;
    }
    const map = new Map();
    for (let i=1;i<lines.length;i++){
      const f = splitAny(lines[i]);
      if (!f[iRS]) continue;
      const rec = {
        A: parseFloat(f[iA]), C: parseFloat(f[iC]),
        G: parseFloat(f[iG]), T: parseFloat(f[iT])
      };
      map.set(f[iRS], rec);
    }
    emitLog?.(`✅ AF-Map geladen (${map.size} rsIDs)`);
    return map;
  }catch(e){
    emitLog?.(`⚠️ AF-Map konnte nicht geladen werden: ${e.message}`);
    return null;
  }
}

/** -------------------- Scoring & matching -------------------- */

function matchPGS(variants, scoreLines, emitLog){
  if (!scoreLines.length) return [];
  const header = scoreLines[0].split('\t');
  const rows   = scoreLines.slice(1);

  const idx = {
    rsid:   findIdx(header, ['rsid','rsID']),
    hmRsid: findIdx(header, ['hm_rsid','hm_rsID']),
    chr:    findIdx(header, ['chr_name','chrom']),
    pos:    findIdx(header, ['chr_position','position']),
    hmChr:  findIdx(header, ['hm_chr']),
    hmPos:  findIdx(header, ['hm_pos']),
    eff:    findIdx(header, ['effect_allele','hm_effect_allele']),
    beta:   findIdx(header, ['effect_weight','beta','weight'])
  };

  const byRsid = new Map();
  const byLoc  = new Map();
  for (const v of variants){
    if (v.rsid) byRsid.set(v.rsid, v);
    if (v.chrom && v.pos) byLoc.set(`${v.chrom}:${v.pos}`, v);
  }

  const matches = [];
  for (const line of rows){
    if (!line) continue;
    const f = line.split('\t');

    const rs   = (idx.hmRsid>=0 ? f[idx.hmRsid] : '') || (idx.rsid>=0 ? f[idx.rsid] : '') || '';
    const chr  = (idx.hmChr>=0 ? f[idx.hmChr] : '') || (idx.chr>=0 ? f[idx.chr] : '') || '';
    const pos  = (idx.hmPos>=0 ? f[idx.hmPos] : '') || (idx.pos>=0 ? f[idx.pos] : '') || '';
    const eff  = idx.eff>=0 ? String(f[idx.eff]||'').toUpperCase() : '';
    const beta = idx.beta>=0 ? parseFloat(f[idx.beta]) : NaN;

    if (!eff || !isNum(beta)) continue;

    const v = (rs && byRsid.get(rs)) || (chr && pos && byLoc.get(`${String(chr)}:${String(pos)}`));
    if (!v) continue;
    if (!/^[ACGT]{2}$/.test(v.genotype)) continue;

    const dosage = (v.genotype[0]===eff?1:0) + (v.genotype[1]===eff?1:0);
    if (dosage === 0) continue;

    matches.push({
      rsid: rs || '',
      variant: `${String(chr)}:${String(pos)}`,
      genotype: v.genotype,
      effectAllele: eff,
      beta,
      dosage,
      score: beta * dosage
    });
  }

  if (emitLog && matches.length){
    emitLog('🔍 Beispiele: ' + matches.slice(0,5)
      .map(m => `${m.rsid || m.variant} ${m.genotype} (EA=${m.effectAllele}) → dosage=${m.dosage}, β=${m.beta}`)
      .join(' | '));
  }
  return matches;
}

function computePRS(matches, emitLog){
  emitLog?.('🧮 Start PRS Berechnung');
  const raw = matches.reduce((s,m)=>s+m.score, 0);
  const prsExp = Math.exp(raw);
  emitLog?.(`🧮 rawScore=${raw.toFixed(4)}, PRS(exp(raw))=${prsExp.toFixed(4)} aus ${matches.length} Treffern`);
  return { rawScore: raw, prsExp, matchedVariants: matches };
}

/** AF in FILE (preferred to AF-map) */
function estimateTheoreticalStats(scoreLines, emitLog){
  if (!scoreLines.length) return null;
  const header = scoreLines[0].split('\t');
  const rows   = scoreLines.slice(1);

  const iW = findIdx(header, ['effect_weight','beta','weight']);
  const iAF = findIdx(header, [
    'effect_allele_frequency','eaf','hm_af','hm_effect_allele_frequency',
    'effect_allele_frequency_in_training','ref_allele_frequency','allele_frequency'
  ]);
  const iEff = findIdx(header, ['effect_allele','hm_effect_allele']);
  if (iW === -1 || iAF === -1 || iEff === -1) return null;

  let mu = 0, varSum = 0, used = 0;
  for (const line of rows){
    if (!line) continue;
    const f = line.split('\t');
    const beta = parseFloat(f[iW]);
    const p    = parseFloat(f[iAF]);
    const eff  = (f[iEff]||'').toUpperCase();
    if (!isNum(beta) || !isNum(p) || !eff || p<=0 || p>=1) continue;
    mu     += 2*p*beta;
    varSum += 2*p*(1-p)*beta*beta;
    used++;
  }
  if (!used || varSum<=0) return null;
  const sd = Math.sqrt(varSum);
  emitLog?.(`📈 Referenz (theoretisch, Datei): μ=${mu.toFixed(4)}, σ=${sd.toFixed(4)} aus ${used} Varianten`);
  return { mu, sd, used };
}

/** AF MAP fallback (eur_af_by_rsid.tsv) */
function estimateStatsFromAFMap(scoreLines, afMap, emitLog){
  if (!scoreLines.length || !afMap || !afMap.size) return null;
  const header = scoreLines[0].split('\t');
  const rows   = scoreLines.slice(1);

  const iW   = findIdx(header, ['effect_weight','beta','weight']);
  const iEff = findIdx(header, ['effect_allele','hm_effect_allele']);
  const iRS  = (() => {
    const r1 = findIdx(header, ['hm_rsid','hm_rsID']);
    if (r1 !== -1) return r1;
    return findIdx(header, ['rsid','rsID']);
  })();

  if ([iW, iEff, iRS].some(i => i === -1)) return null;

  let mu = 0, varSum = 0, used = 0;
  for (const line of rows){
    if (!line) continue;
    const f = line.split('\t');
    const beta = parseFloat(f[iW]);
    const eff  = (f[iEff]||'').toUpperCase();
    const rs   = f[iRS];
    if (!isNum(beta) || !eff || !rs) continue;

    const rec = afMap.get(rs);
    const p = rec ? rec[eff] : undefined;
    if (!isNum(p) || p<=0 || p>=1) continue;

    mu     += 2*p*beta;
    varSum += 2*p*(1-p)*beta*beta;
    used++;
  }
  if (!used || varSum<=0) return null;
  const sd = Math.sqrt(varSum);
  emitLog?.(`📈 Referenz (AF-Map): μ=${mu.toFixed(4)}, σ=${sd.toFixed(4)} aus ${used} Varianten`);
  return { mu, sd, used };
}

function estimateStatsFromAFMap(scoreLines, afMap, emitLog){
  if (!scoreLines.length || !afMap || !afMap.size) return null;
  const header = scoreLines[0].split('\t');
  const rows   = scoreLines.slice(1);

  const iW   = findIdx(header, ['effect_weight','beta','weight']);
  const iEff = findIdx(header, ['effect_allele','hm_effect_allele']);
  const iRS  = (() => {
    const r1 = findIdx(header, ['hm_rsid','hm_rsID']);
    if (r1 !== -1) return r1;
    return findIdx(header, ['rsid','rsID']);
  })();
  if ([iW,iEff,iRS].some(i => i === -1)) return null;

  let mu = 0, varSum = 0, used = 0, total = 0;
  const missing = [];
  for (const line of rows){
    if (!line) continue;
    total++;
    const f = line.split('\t');
    const beta = parseFloat(f[iW]);
    const eff  = (f[iEff]||'').toUpperCase();
    const rs   = f[iRS];
    if (!Number.isFinite(beta) || !eff || !rs) continue;

    const rec = afMap.get(rs);
    const p = rec ? rec[eff] : undefined;
    if (!Number.isFinite(p)){ if (missing.length < 10) missing.push(rs); continue; }
    if (p <= 0 || p >= 1) continue;

    mu     += 2*p*beta;
    varSum += 2*p*(1-p)*beta*beta;
    used++;
  }
  if (!used || varSum <= 0){
    emitLog?.(`ℹ️ AF-Map: 0/${total} Varianten mit AF – Beispiele fehlen: ${missing.join(', ')}`);
    return null;
  }
  const sd = Math.sqrt(varSum);
  emitLog?.(`📈 Referenz (AF-Map): μ=${mu.toFixed(4)}, σ=${sd.toFixed(4)} aus ${used}/${total} Varianten`);
  return { mu, sd, used };
}

/** -------------------- Aggregation -------------------- */
function aggregateResults(results){
  const grouped = {};
  for (const r of results){
    if (!grouped[r.efoId]){
      grouped[r.efoId] = { efoId: r.efoId, trait: r.trait || '', prsValues: [], percentiles: [], totalVariants: 0 };
    }
    grouped[r.efoId].prsValues.push(r.prs);
    if (isNum(r.percentile)) grouped[r.efoId].percentiles.push(r.percentile);
    grouped[r.efoId].totalVariants += r.totalVariants;
  }
  const avg = (arr) => (arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN);

  return Object.values(grouped).map(g => ({
    'EFO-ID': g.efoId,
    Trait: g.trait,
    'PGS Count': g.prsValues.length,
    'Avg PRS': (avg(g.prsValues) || 0).toFixed(3),
    'Max PRS': Math.max(...g.prsValues).toFixed(3),
    'Min PRS': Math.min(...g.prsValues).toFixed(3),
    'Avg Percentile': isNum(avg(g.percentiles)) ? avg(g.percentiles).toFixed(1) : '',
    'Max Percentile': g.percentiles.length ? Math.max(...g.percentiles).toFixed(1) : '',
    'Min Percentile': g.percentiles.length ? Math.min(...g.percentiles).toFixed(1) : '',
    'Total Variants': g.totalVariants
  }));
}

/** -------------------- Worker entrypoint -------------------- */

self.onmessage = async function (e) {
  const { genomeTxt, efoIds = [], config = {}, efoToPgsMap: providedMap = {} } = e.data || {};
  const emitLog = (msg) => self.postMessage({ log: msg });

  // small helpers local to this scope
  const isNum  = (v) => Number.isFinite(v);
  const toPct  = (z) => Math.max(0.1, Math.min(99.9, normalCdf(z) * 100));

  // Only load the tiny JSON with mu/sd; AF TSV is optional + guarded
  const refScores = (await loadReferenceStats()) || {};
  const afMap     = config?.useAFMap ? (await loadAFMap?.(emitLog)) : null;

  // Use AF TSV (Map<rsid,{A,C,G,T}>) to estimate μ/σ from a scoring file's rsIDs
  function estimateStatsFromAFMap(scoreLines, afMap, emitLog) {
    if (!afMap || !scoreLines?.length) return null;

    const header = scoreLines[0].split('\t').map(h => (h || '').toLowerCase());
    const fidx = (names) => {
      for (const n of names) {
        const i = header.indexOf(n.toLowerCase());
        if (i !== -1) return i;
      }
      return -1;
    };

    const iRS   = fidx(['hm_rsid','hmrsid','rsid','rs']);
    const iEA   = fidx(['effect_allele','hm_effect_allele','ea','a1']);
    const iBETA = fidx(['effect_weight','beta','weight']);
    if (iEA === -1 || iBETA === -1 || iRS === -1) {
      emitLog?.('ℹ️ AF-Map Fallback: benötigte Spalten (rsID & effect_allele & effect_weight) nicht gefunden.');
      return null;
    }

    let mu = 0, varSum = 0, used = 0;
    for (let i = 1; i < scoreLines.length; i++) {
      const line = scoreLines[i];
      if (!line) continue;
      const f = line.split('\t');
      const rs   = String(f[iRS] || '').trim();
      const ea   = String(f[iEA] || '').trim().toUpperCase();
      const beta = parseFloat(f[iBETA]);
      if (!rs || !['A','C','G','T'].includes(ea) || !isNum(beta)) continue;

      const row = afMap.get(rs);
      if (!row) continue;
      const p = row[ea];
      if (!isNum(p) || p <= 0 || p >= 1) continue;

      mu     += 2 * p * beta;
      varSum += 2 * p * (1 - p) * beta * beta;
      used++;
    }

    if (used === 0 || varSum <= 0) return null;
    const sd = Math.sqrt(varSum);
    emitLog?.(`📈 Referenz (AF-Map): μ=${mu.toFixed(4)}, σ=${sd.toFixed(4)} aus ${used} Varianten`);
    return { mu, sd, used };
  }

  try {
    // Parse genome
    const variants = parse23andMe(genomeTxt);
    const genomeName = config?.genomeFileName || '(unknown)';
    emitLog(`🧬 Genome Name [worker]: ${genomeName}`);
    emitLog(`🧬 Genom enthält ${variants.length} Varianten`);

    // Load trait labels
    let traitsMap = {};
    emitLog('📥 Lade traits.json...');
    try {
      const traitsRes = await fetch('/traits.json');
      const traitsJson = await traitsRes.json();
      for (const t of traitsJson) if (t.id && t.label) traitsMap[String(t.id).trim()] = String(t.label).trim();
      emitLog(`✅ traits.json geladen (${Object.keys(traitsMap).length} Traits)`);
    } catch (err) {
      emitLog(`❌ Fehler beim Laden von traits.json: ${err.message}`);
    }

    // Build EFO -> PGS mapping (prefer provided)
    const effectiveMap = {};
    for (const efo of efoIds) {
      if (Array.isArray(providedMap[efo]) && providedMap[efo].length) {
        effectiveMap[efo] = providedMap[efo];
      } else {
        emitLog(`🔍 Suche PGS für ${efo} in EBI-Metadaten`);
        try {
          const metaRes = await fetch('https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv');
          const csv = await metaRes.text();
          const lines = csv.split('\n');
          const ids = lines
            .filter(l => {
              const cols = l.split(',');
              const efoCol = cols[5] || '';
              return efoCol.split('|').includes(efo) && l.includes('GRCh37');
            })
            .map(l => l.split(',')[0])
            .filter(Boolean);
          effectiveMap[efo] = ids;
        } catch (err) {
          emitLog(`❌ Metadaten-Fehler: ${err.message}`);
          effectiveMap[efo] = [];
        }
      }
    }

    const results = [];
    const detailRows = [];
    const totalJobs = Object.values(effectiveMap).reduce((s, arr) => s + arr.length, 0) || 1;
    let completed = 0;

    for (const efo of efoIds) {
      const pgsIds = effectiveMap[efo] || [];
      if (!pgsIds.length) {
        emitLog(`⚠️ Keine PGS für ${efo}`);
        continue;
      }

      emitLog(`📌 Verwende PGS für ${efo}: ${pgsIds.join(', ')}`);
      const efoDetailsForSave = [];

      for (const pgsId of pgsIds) {
        self.postMessage({ log: `⬇️ Lade ${pgsId}`, currentPGS: pgsId, progress: 0, efoId: efo });

        try {
          const rawTxt = await fetchPGSFile(pgsId, config, emitLog);
          const scoreLines = rawTxt.split('\n').filter(l => l && !l.startsWith('#'));
          if (!scoreLines.length) {
            emitLog(`⚠️ ${pgsId}: leere oder ungültige PGS-Datei`);
            completed++;
            self.postMessage({ currentPGS: pgsId, progress: (completed / totalJobs) * 100, efoId: efo });
            continue;
          }
          if (scoreLines.length - 1 > MAX_VARIANTS_ALLOWED) {
            emitLog(`⚠️ Überspringe ${pgsId}: zu viele Varianten (${scoreLines.length - 1})`);
            completed++;
            self.postMessage({ currentPGS: pgsId, progress: (completed / totalJobs) * 100, efoId: efo });
            continue;
          }

          // Match & PRS
          emitLog(`🔍 Vergleiche Varianten für ${pgsId}`);
          const matches = matchPGS(variants, scoreLines, emitLog);
          emitLog(`✅ ${matches.length} Treffer für ${pgsId} gefunden`);

          const { rawScore, matchedVariants } = computePRS(matches, emitLog);
          emitLog(`✅ PRS für ${pgsId}: ${rawScore.toFixed(4)} (aus ${matchedVariants.length} Varianten)`);

          // Percentile: reference → AF in file → AF-Map (if enabled)
          let z = null, pct = null;
          const ref = refScores[pgsId];

          if (ref && isNum(ref.mu) && isNum(ref.sd) && ref.sd > 0) {
            z = (rawScore - ref.mu) / ref.sd;
            pct = toPct(z);
            emitLog(`🎯 Z/Perzentil (ref) für ${pgsId}: z=${z.toFixed(3)}, %=${pct.toFixed(1)}`);
          } else {
            const statsFile = estimateTheoreticalStats(scoreLines, emitLog);
            if (statsFile && isNum(statsFile.sd) && statsFile.sd > 0) {
              z = (rawScore - statsFile.mu) / statsFile.sd;
              pct = toPct(z);
              emitLog(`🎯 Z/Perzentil (AF in Datei) für ${pgsId}: z=${z.toFixed(3)}, %=${pct.toFixed(1)}`);
            } else if (afMap) {
              const statsMap = estimateStatsFromAFMap(scoreLines, afMap, emitLog);
              if (statsMap && isNum(statsMap.sd) && statsMap.sd > 0) {
                z = (rawScore - statsMap.mu) / statsMap.sd;
                pct = toPct(z);
                emitLog(`🎯 Z/Perzentil (AF-Map) für ${pgsId}: z=${z.toFixed(3)}, %=${pct.toFixed(1)}`);
              } else {
                emitLog(`ℹ️ Keine Referenz/AF – Perzentil ausgelassen für ${pgsId}.`);
              }
            } else {
              emitLog(`ℹ️ Keine Referenz/AF – Perzentil ausgelassen für ${pgsId}.`);
            }
          }

          const traitName = traitsMap[efo] || '';
          const topVariants = matchedVariants
            .slice()
            .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
            .slice(0, MAX_TOP_VARIANTS)
            .map(v => ({ rsid: v.rsid, variant: v.variant, alleles: v.genotype, score: v.score }));

          const detail = {
            id: pgsId,
            efoId: efo,
            trait: traitName,
            prs: rawScore,
            rawScore,
            zScore: isNum(z) ? z : null,
            percentile: isNum(pct) ? pct : null,
            matches: matchedVariants.length,
            totalVariants: scoreLines.length - 1,
            topVariants
          };

          results.push(detail);
          efoDetailsForSave.push(detail);

          detailRows.push({
            efoId: efo,
            id: pgsId,
            trait: traitName,
            rawScore,
            prs: rawScore,
            zScore: isNum(z) ? z : null,
            percentile: isNum(pct) ? pct : null,
            matches: matchedVariants.length,
            totalVariants: scoreLines.length - 1
          });

        } catch (err) {
          emitLog(`❌ Fehler bei ${pgsId}: ${err.message}`);
        }

        completed++;
        const progress = (completed / totalJobs) * 100;
        self.postMessage({ currentPGS: pgsId, progress, efoId: efo });
      }

      // optional: persist detail JSON per EFO
      const genomeNameForSave = config?.genomeFileName || config?.genomeName || '';
      if (genomeNameForSave && efoDetailsForSave.length) {
        try {
          const res = await fetch('/api/saveEfoDetail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ genomeName: genomeNameForSave, efoId: efo, detail: efoDetailsForSave })
          });
          if (!res.ok) {
            const errTxt = await res.text();
            emitLog(`⚠️ Fehler beim Speichern der JSON für ${efo}: ${errTxt}`);
          } else {
            emitLog(`✅ Detail-JSON gespeichert für ${efo}`);
          }
        } catch (e2) {
          emitLog(`❌ Netzwerkfehler beim Speichern von ${efo}: ${e2.message}`);
        }
      }
    }

    // Aggregate
    const aggregated = aggregateResults(results);

    const efoDetailsMap = {};
    for (const r of results) {
      if (!efoDetailsMap[r.efoId]) efoDetailsMap[r.efoId] = [];
      efoDetailsMap[r.efoId].push({
        id: r.id,
        trait: r.trait,
        rawScore: r.rawScore,
        prs: r.prs,
        zScore: r.zScore,
        percentile: r.percentile,
        matches: r.matches,
        totalVariants: r.totalVariants,
        topVariants: r.topVariants
      });
    }

    self.postMessage({
      results,
      aggregated,
      detailRows,
      efoDetailsMap,
      logs: [`✅ Analyse abgeschlossen (${results.length} Resultate)`],
      log:  `✅ Analyse abgeschlossen (${results.length} Resultate)`
    });

  } catch (err) {
    self.postMessage({ logs: [`❌ Worker-Fehler: ${err.message}`] });
    self.postMessage({ error: err.message });
  }
};
