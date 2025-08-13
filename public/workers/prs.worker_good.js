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
const isAmbiguous = (a1, a2) => {
  if (!a1 || !a2) return false;
  const s = (a1+a2).toUpperCase();
  return s === 'AT' || s === 'TA' || s === 'CG' || s === 'GC';
};
const safeRatio = (num, den) => (Number.isFinite(num) && Number.isFinite(den) && den > 0) ? (num / den) : null;
const pct = v => v == null ? "n/a" : (v * 100).toFixed(1) + "%";

function logCoverage(stats, emitLog) {
  const n = stats?.nMatched ?? 0, nTot = stats?.nTotal ?? 0;
  const w = safeRatio(stats?.wMatched ?? 0, stats?.wTotal ?? 0);
  const q = safeRatio(stats?.qMatched ?? 0, stats?.qTotal ?? 0);
  emitLog?.(`ℹ️ Coverage: ${n}/${nTot} Varianten (weighted=${pct(w)}, Q=${pct(q)})`);
}


function findIdx(header, candidates){
  const lower = header.map(h => (h||'').toLowerCase());
  for (const name of candidates){
    const i = lower.indexOf(name.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

// --- helpers to parse header comments & robust stats ---
function parseHeaderMetaFromRawText(rawTxt){
  const meta = {};
  for (const line of rawTxt.split('\n')){
    if (!line.startsWith('#')) continue;
    const m = line.match(/^#\s*([^=\s]+)\s*=\s*(.+)$/); // e.g. "#weight_type=NR"
    if (m) meta[m[1].trim()] = m[2].trim();
  }
  return meta;
}

function median(arr){
  const a = arr.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if (!a.length) return NaN;
  const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
}

/**
 * Inspect effect_weight vs OR/HR columns to infer scale.
 * Returns { scale: 'log_or'|'log_hr'|'beta_or_unknown'|'or_ratio'|'hr_ratio', evidence }
 */
function detectWeightScale(scoreLines, emitLog){
  if (!scoreLines?.length) return { scale: 'beta_or_unknown', evidence: { reason: 'no lines' } };

  const header = scoreLines[0].split('\t').map(h => (h||'').toLowerCase());
  const idx = (names)=> {
    for (const n of names){
      const i = header.indexOf(n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const iW  = idx(['effect_weight','beta','weight']);
  const iOR = idx(['or','odds_ratio']);
  const iHR = idx(['hr','hazard_ratio']);
  if (iW === -1) return { scale: 'beta_or_unknown', evidence: { reason: 'no effect_weight col' } };

  const diffsLogOR = [], diffsOR = [];
  const diffsLogHR = [], diffsHR = [];
  const SAMPLE_MAX = 200; // keep it light

  let seenOR = 0, seenHR = 0, seenW = 0;

  for (let r = 1; r < scoreLines.length && (seenOR < SAMPLE_MAX || seenHR < SAMPLE_MAX); r++){
    const f = scoreLines[r].split('\t');
    const w = parseFloat(f[iW]);
    if (!Number.isFinite(w)) continue;
    seenW++;

    if (iOR !== -1){
      const or = parseFloat(f[iOR]);
      if (Number.isFinite(or) && or > 0){
        diffsLogOR.push(Math.abs(w - Math.log(or)));
        diffsOR.push(Math.abs(w - or));
        seenOR++;
      }
    }
    if (iHR !== -1){
      const hr = parseFloat(f[iHR]);
      if (Number.isFinite(hr) && hr > 0){
        diffsLogHR.push(Math.abs(w - Math.log(hr)));
        diffsHR.push(Math.abs(w - hr));
        seenHR++;
      }
    }
  }

  const eps_tight = 1e-6;   // exact conversions like your PGS000010
  const eps_loose = 5e-3;   // allow small rounding
  const mLogOR = median(diffsLogOR), mOR = median(diffsOR);
  const mLogHR = median(diffsLogHR), mHR = median(diffsHR);

  if (Number.isFinite(mLogOR) && mLogOR <= eps_loose && (mOR > eps_loose || mLogOR <= eps_tight)){
    emitLog?.(`🧪 Detected log-odds scale (median|β - ln(OR)|=${mLogOR.toExponential(2)})`);
    return { scale: 'log_or', evidence: { mLogOR, samples: diffsLogOR.length } };
  }
  if (Number.isFinite(mLogHR) && mLogHR <= eps_loose && (mHR > eps_loose || mLogHR <= eps_tight)){
    emitLog?.(`🧪 Detected log-hazard scale (median|β - ln(HR)|=${mLogHR.toExponential(2)})`);
    return { scale: 'log_hr', evidence: { mLogHR, samples: diffsLogHR.length } };
  }
  if (Number.isFinite(mOR) && mOR <= eps_loose){
    emitLog?.(`🧪 effect_weight ≈ OR (median|β - OR|=${mOR.toExponential(2)}).`);
    return { scale: 'or_ratio', evidence: { mOR, samples: diffsOR.length } };
  }
  if (Number.isFinite(mHR) && mHR <= eps_loose){
    emitLog?.(`🧪 effect_weight ≈ HR (median|β - HR|=${mHR.toExponential(2)}).`);
    return { scale: 'hr_ratio', evidence: { mHR, samples: diffsHR.length } };
  }

  emitLog?.(`ℹ️ Could not match effect_weight to OR/HR; treating as beta/unknown.`);
  return { scale: 'beta_or_unknown', evidence: { seenW, seenOR, seenHR } };
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

// NEW: try local enriched TSV first, then fall back to harmonized file
async function fetchPGSFile(pgsId, config, emitLog){
  // Local enriched candidates
  const localCandidates = [
    `/pgs_scores/enriched/${pgsId}_hmPOS_GRCh37_with_AF.tsv`,
    `/pgs_scores/enriched/${pgsId}_hmPOS_GRCh37_with_AF.txt`,
    `/pgs_scores/unpacked/${pgsId}_hmPOS_GRCh37.txt`
  ];
  const remoteUrl = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;

  if (config?.useLocalFiles){
    for (const url of localCandidates){
      try{
        emitLog(`📁 Lade PGS-Datei: ${url.split('/').pop()}`);
        emitLog(`🌐 Von Pfad: ${url}`);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) { continue; }
        const blob = await res.blob();
        const sizeMB = blob.size / 1024 / 1024;
        if (sizeMB > MAX_FILE_SIZE_MB) throw new Error(`📦 Datei zu groß: ${sizeMB.toFixed(2)} MB`);
        const txt = await blob.text();
        emitLog(`✅ Datei erfolgreich geladen (${sizeMB.toFixed(2)} MB)`);
        return { txt, source: url.includes('/enriched/') ? 'enriched' : 'harmonized' };
      }catch(err){
        // try next candidate
      }
    }
    throw new Error(`Nicht vorhanden oder nicht lesbar (lokal): ${pgsId}`);
  } else {
    const url = remoteUrl;
    emitLog(`📁 Lade PGS-Datei: ${pgsId}_hmPOS_GRCh37.txt`);
    emitLog(`🌐 Von Pfad: ${url}`);
    const txt = await fetchAndDecompress(url);
    emitLog(`✅ Datei erfolgreich geladen (remote .gz)`);
    return { txt, source: 'harmonized' };
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

// ---------- Core: matchPGS with Coverage + AF-µσ ----------
function matchPGS(
  variants,
  scoreLines,
  emitLog,
  afMap = null,
  opts = {}
){
  const {
    palinMaxMAF = 0.42,
    dropAmbigWithoutAF = true,
  } = opts;

  const ambigSeen = new Set();

  if (!scoreLines?.length) return { matches: [], stats: {} };

  const header = scoreLines[0].split('\t');
  const rows   = scoreLines.slice(1);

  const idx = {
    rsid:   findIdx(header, ['hm_rsid','hm_rsID','rsid','rsID']),
    chr:    findIdx(header, ['hm_chr','chr_name','chrom']),
    pos:    findIdx(header, ['hm_pos','chr_position','position']),
    eff:    findIdx(header, ['effect_allele','hm_effect_allele','ea','a1']),
    other:  findIdx(header, ['other_allele','oa','hm_inferOtherAllele','non_effect_allele','nea','a2']),
    beta:   findIdx(header, ['effect_weight','beta','weight']),
    afEff:  findIdx(header, ['af_eff','effect_allele_frequency','eaf','hm_effect_allele_frequency','hm_af'])
  };

  // fast lookups from genome
  const byRsid = new Map();
  const byLoc  = new Map();
  for (const v of variants ?? []){
    if (v?.rsid) byRsid.set(String(v.rsid), v);
    if (v?.chrom && v?.pos) byLoc.set(`${v.chrom}:${v.pos}`, v);
  }

  let W_total = 0, W_matched = 0;
  let Q_total = 0, Q_matched = 0;
  let nTotalWithBeta = 0, nMatched = 0, nTotal = 0;
  let droppedAmbigNoAF = 0; let droppedPalHighMAF = 0; let flipSuspects = 0;

  const matches = [];
  for (const line of rows){
    if (!line) continue;
    nTotal++;
    const f = line.split('\t');

    const rs     = (idx.rsid>=0 ? String(f[idx.rsid]||'').trim() : '');
    const chr    = (idx.chr>=0 ? String(f[idx.chr]||'').trim() : '');
    const pos    = (idx.pos>=0 ? String(f[idx.pos]||'').trim() : '');
    const eff    = idx.eff>=0 ? String(f[idx.eff]||'').trim().toUpperCase() : '';
    const beta   = idx.beta>=0 ? parseFloat(f[idx.beta]) : NaN;
    const pFromFile = idx.afEff>=0 ? parseFloat(f[idx.afEff]) : NaN;

    if (!eff || !isNum(beta)) continue;
    nTotalWithBeta++;

    // other allele parsing
    let oa = '';
    if (idx.other >= 0) {
      const rawOA = String(f[idx.other] || '').toUpperCase().replace(/\s+/g,'');
      if (/^[ACGT]$/.test(rawOA)) {
        oa = rawOA;
      } else if (rawOA && rawOA.includes('/')) {
        const parts = rawOA.split('/').map(x => x.trim());
        const cand = parts.find(x => x !== eff && /^[ACGT]$/.test(x));
        if (cand) oa = cand;
      }
    }

    const ab = Math.abs(beta);
    W_total += ab; Q_total += beta*beta;

    if (eff && oa && /^[ACGT]$/.test(eff) && /^[ACGT]$/.test(oa)) {
      if (isAmbiguous(eff, oa)) {
        const key = rs || `${chr}:${pos}`;
        if (!ambigSeen.has(key)) {
          ambigSeen.add(key);
          emitLog?.(`🔎 Strand-ambig: ${key} (${eff}/${oa}). Prüfe AF/Referenz sorgfältig.`);
        }
      }
    }

    // AF lookup preference: file -> AF map
    let pEA = Number.isFinite(pFromFile) ? pFromFile : null;
    if (!isNum(pEA) && afMap && rs){
      const row = afMap.get(rs);
      pEA = row?.[eff];
      if (isNum(pEA) && pEA > 0.5) {
        flipSuspects++;
        emitLog?.(`⚠️ Möglicher Allele-Flip bei ${rs} (AF(EA)=${pEA.toFixed(3)} > 0.5).`);
      }
    }

    const pal = eff && oa && isAmbiguous(eff, oa);
    if (pal) {
      if (dropAmbigWithoutAF && (!isNum(pEA) || !oa)) { droppedAmbigNoAF++; continue; }
      if (isNum(pEA)) {
        const maf = Math.min(pEA, 1 - pEA);
        if (maf >= palinMaxMAF) { droppedPalHighMAF++; continue; }
      }
    }

    const v = (rs && byRsid.get(rs)) || (chr && pos && byLoc.get(`${String(chr)}:${String(pos)}`));
    if (!v) continue;
    if (!/^[ACGT]{2}$/.test(v.genotype)) continue;

    const dosage = (v.genotype[0]===eff?1:0) + (v.genotype[1]===eff?1:0);
    if (dosage === 0) continue;

    nMatched++; W_matched += ab; Q_matched += beta*beta;

    matches.push({
      rsid: rs || '',
      variant: `${String(chr)}:${String(pos)}`,
      genotype: v.genotype,
      effectAllele: eff,
      otherAllele: oa || null,
      beta,
      dosage,
      score: beta * dosage,
      af: isNum(pFromFile) ? pFromFile : (isNum(pEA) ? pEA : null)
    });
  }

  if (emitLog && matches.length){
    emitLog('🔍 Beispiele: ' + matches.slice(0,5)
      .map(m => `${m.rsid || m.variant} ${m.genotype} (EA=${m.effectAllele}${m.otherAllele?`, OA=${m.otherAllele}`:''}) → dosage=${m.dosage}, β=${m.beta}`)
      .join(' | '));
  }

  // AF-basierte Referenz (über genau die Treffer – bevorzugt File-AF)
  let muAF = 0, varAF = 0, nAFused = 0;
  for (const m of matches){
    const p = m.af;
    if (isNum(p)) { muAF += 2*p*m.beta; varAF += 2*p*(1-p)*(m.beta**2); nAFused++; }
  }

  const stats = {
    nTotal,
    nTotalWithBeta,
    nMatched,
    W_total, W_matched,
    Q_total, Q_matched,
    coverage: nTotalWithBeta>0 ? nMatched/nTotalWithBeta : 0,
    wCoverage: W_total>0 ? W_matched/W_total : 0,
    qCoverage: Q_total>0 ? Q_matched/Q_total : 0,
    droppedAmbigNoAF,
    droppedPalHighMAF,
    flipSuspects,
    muAF: nAFused>0 ? muAF : null,
    sdAF: (nAFused>0 && varAF>0) ? Math.sqrt(varAF) : null,
    nAFused
  };

  if (emitLog){
    const cov = (stats.coverage*100).toFixed(1);
    const wcov = (stats.wCoverage*100).toFixed(1);
    emitLog(`📏 Coverage: n=${stats.nMatched}/${stats.nTotalWithBeta} (${cov}%), w=${wcov}%`
      + (stats.droppedAmbigNoAF? ` | gedroppt (ambig, kein AF/OA)=${stats.droppedAmbigNoAF}`:'')
      + (stats.droppedPalHighMAF? ` | gedroppt (pal MAF≥${palinMaxMAF})=${stats.droppedPalHighMAF}`:'')
    );
    if (stats.nAFused>0){
      emitLog(`📊 AF-Referenz möglich: µ_AF=${stats.muAF.toFixed(4)}, σ_AF=${stats.sdAF?.toFixed(4) ?? '0.0000'} (über ${stats.nAFused} SNPs).`);
    } else {
      emitLog('ℹ️ Keine AF-basierte Referenz (zu wenige/keine AFs für Treffer). Nutze Coverage-Skalierung als Fallback.');
    }
  }

  return { matches, stats };
}

// ---------- PRS-Auswertung mit AF-µσ oder Coverage-Fallback ----------
function evaluatePRS({ matches, stats }, ref = null, emitLog = () => {}, opts = {}) {
  const {
    minWeightedCoverage = 0.6,
    maxAbsZForPercentile = 5,
  } = opts;

  let rawScore = 0;
  for (const m of matches) rawScore += (m.beta ?? m.weight ?? 0) * (m.dosage ?? 0);
  const matchedVariants = matches.length;

  const wCov = safeRatio(stats?.wMatched ?? 0, stats?.wTotal ?? 0);
  const nCov = safeRatio(stats?.nMatched ?? 0, stats?.nTotal ?? 0);
  const coverage = (wCov ?? nCov ?? 0);

  let mu = null, sd = null, refUsed = "none";
  if (ref && Number.isFinite(ref.mu) && Number.isFinite(ref.sd) && ref.sd > 0) {
    mu = ref.mu; sd = ref.sd; refUsed = "provided";
  } else if (Number.isFinite(stats?.sdAF) && stats.sdAF > 0 && Number.isFinite(stats?.muAF)) {
    mu = stats.muAF; sd = stats.sdAF; refUsed = "af_based";
    emitLog?.(`ℹ️ z_adj: AF-basierte Referenz aus ${stats.nAFused} Treffern verwendet (μ=${mu.toFixed(4)}, σ=${sd.toFixed(4)})`);
  } else {
    mu = 0; sd = null; refUsed = "coverage_fallback";
    emitLog?.(`ℹ️ z_adj: Keine verwertbare AF-Referenz → nur Coverage-Skalierung (keine z/Perzentile).`);
  }

  let z = null, percentile = null, reason = null;
  if (sd == null || sd <= 0) {
    reason = "no_sigma";
  } else if (!(coverage >= minWeightedCoverage)) {
    reason = "low_coverage";
  } else {
    z = (rawScore - mu) / sd;
    if (Math.abs(z) > maxAbsZForPercentile) {
      reason = "extreme_z";
    } else {
      const cdf = 0.5 * (1 + Math.erf(z / Math.SQRT2));
      percentile = cdf * 100;
    }
  }

  emitLog?.(`coverage: weighted=${pct(wCov)} | n=${pct(nCov)} | used=${refUsed}`);
  if (z != null) emitLog?.(`z_adj: z=${z.toFixed(3)}${percentile!=null ? `, pct=${percentile.toFixed(1)}%` : ""}`);
  if (reason) emitLog?.(`Gründe fürs Weglassen von Perzentilen: ${reason}`);

  return { rawScore, matchedVariants, mu, sd, coverage, z, percentile, reason };
}

function computePRS(matches, emitLog){
  emitLog?.('🧮 Start PRS Berechnung');
  const raw = matches.reduce((s,m)=>s+m.score, 0);
  emitLog?.(`🧮 rawScore=${raw.toFixed(4)} aus ${matches.length} Treffern`);
  return { rawScore: raw, matchedVariants: matches };
}

/** Prefer in-file AF (AF_eff) for theoretical μ/σ; fallback to other common AF names */
function estimateTheoreticalStats(scoreLines, emitLog){
  if (!scoreLines.length) return null;
  const header = scoreLines[0].split('\t');
  const rows   = scoreLines.slice(1);

  const iW  = findIdx(header, ['effect_weight','beta','weight']);
  const iAF = findIdx(header, ['af_eff','effect_allele_frequency','eaf','hm_effect_allele_frequency','hm_af']);
  const iEA = findIdx(header, ['effect_allele','hm_effect_allele']);
  if (iW === -1 || iAF === -1 || iEA === -1) return null;

  let mu = 0, varSum = 0, used = 0;
  for (const line of rows){
    if (!line) continue;
    const f = line.split('\t');
    const beta = parseFloat(f[iW]);
    const p    = parseFloat(f[iAF]);
    const ea   = (f[iEA]||'').toUpperCase();
    if (!isNum(beta) || !isNum(p) || !ea || p<=0 || p>=1) continue;
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

  let mu = 0, varSum = 0, used = 0, total = 0;
  const missing = [];
  for (const line of rows){
    if (!line) continue; total++;
    const f = line.split('\t');
    const beta = parseFloat(f[iW]);
    const eff  = (f[iEff]||'').toUpperCase();
    const rs   = f[iRS];
    if (!isNum(beta) || !eff || !rs) continue;

    const rec = afMap.get(rs);
    const p = rec ? rec[eff] : undefined;
    if (!isNum(p) || p<=0 || p>=1){ if (missing.length<10) missing.push(rs); continue; }

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

  const isNum  = (v) => Number.isFinite(v);
  const toPct  = (z) => Math.max(0.1, Math.min(99.9, normalCdf(z) * 100));

  const refScores = (await loadReferenceStats()) || {};
  const afMap     = config?.useAFMap ? (await loadAFMap?.(emitLog)) : null;

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
      if (!pgsIds.length) { emitLog(`⚠️ Keine PGS für ${efo}`); continue; }

      emitLog(`📌 Verwende PGS für ${efo}: ${pgsIds.join(', ')}`);
      const efoDetailsForSave = [];

      for (const pgsId of pgsIds) {
        self.postMessage({ log: `⬇️ Lade ${pgsId}`, currentPGS: pgsId, progress: 0, efoId: efo });

        try {
          const { txt: rawTxt, source } = await fetchPGSFile(pgsId, config, emitLog);
          const scoreLines = rawTxt.split('\n').filter(l => l && !l.startsWith('#'));

          // Parse header comments for hints (weight_type etc.)
          const headerMeta = parseHeaderMetaFromRawText(rawTxt);
          const weightTypeHint = (headerMeta.weight_type || headerMeta.weightType || '').toUpperCase();

          const det = detectWeightScale(scoreLines, emitLog);
          let weightScale = det.scale;
          if ((weightTypeHint === 'BETA') && (weightScale !== 'log_or' && weightScale !== 'log_hr')){
            weightScale = 'beta_or_unknown';
          } else if (weightTypeHint === 'OR/HR') {
            if (weightScale === 'beta_or_unknown') weightScale = 'or_ratio';
          }
          emitLog?.(`🔎 Weight scale decided: ${weightScale} (hint=${weightTypeHint || 'none'})`);

          if (!scoreLines.length) { emitLog(`⚠️ ${pgsId}: leere oder ungültige PGS-Datei`); completed++; self.postMessage({ currentPGS: pgsId, progress: (completed / totalJobs) * 100, efoId: efo }); continue; }
          if (scoreLines.length - 1 > MAX_VARIANTS_ALLOWED) { emitLog(`⚠️ Überspringe ${pgsId}: zu viele Varianten (${scoreLines.length - 1})`); completed++; self.postMessage({ currentPGS: pgsId, progress: (completed / totalJobs) * 100, efoId: efo }); continue; }

          emitLog(`🔍 Vergleiche Varianten für ${pgsId}`);
          const { matches, stats } = matchPGS(variants, scoreLines, emitLog, afMap, { palinMaxMAF: 0.42, dropAmbigWithoutAF: true });
          emitLog(`✅ ${matches.length} Treffer für ${pgsId} gefunden`);
          logCoverage(stats, emitLog);

          const evalRes = evaluatePRS({ matches, stats }, /* ref */ null, emitLog, { minWeightedCoverage: 0.60, maxAbsZForPercentile: 5 });
          emitLog?.(`✅ PRS (additiv) für ${pgsId}: ${evalRes.rawScore.toFixed(4)} (aus ${evalRes.matchedVariants} Varianten)`);
          if (evalRes.z != null && evalRes.percentile != null) emitLog?.(`ℹ️ z=${evalRes.z.toFixed(3)}, Perzentil=${evalRes.percentile.toFixed(1)}%`);
          else emitLog?.(`⚠️ Perzentil nicht berechnet (Grund: ${evalRes.reason || 'nicht angegeben'})`);

          // Theoretical reference (prefer in-file AF like AF_eff)
          let muUsed = null, sdUsed = null, z = null, pct = null, refSource = null;
          const ref = refScores[pgsId];
          if (ref && isNum(ref.mu) && isNum(ref.sd) && ref.sd > 0) { muUsed = ref.mu; sdUsed = ref.sd; refSource = 'ref'; }
          else {
            const statsFile = estimateTheoreticalStats(scoreLines, emitLog);
            if (statsFile && isNum(statsFile.sd) && statsFile.sd > 0) { muUsed = statsFile.mu; sdUsed = statsFile.sd; refSource = 'file_af'; }
            else if (afMap) {
              const statsMap = estimateStatsFromAFMap(scoreLines, afMap, emitLog);
              if (statsMap && isNum(statsMap.sd) && statsMap.sd > 0) { muUsed = statsMap.mu; sdUsed = statsMap.sd; refSource = 'af_map'; }
            }
          }

          const rawScore = evalRes.rawScore;
          if (isNum(muUsed) && isNum(sdUsed) && sdUsed > 0) {
            z = (rawScore - muUsed) / sdUsed; pct = toPct(z);
            const srcLabel = refSource === 'ref' ? 'ref' : (refSource === 'file_af' ? 'AF in Datei' : 'AF-Map');
            emitLog(`🎯 Z/Perzentil (${srcLabel}) für ${pgsId}: z=${z.toFixed(3)}, %=${pct.toFixed(1)}`);
          } else {
            emitLog(`ℹ️ Keine Referenz/AF – Perzentil ausgelassen für ${pgsId}.`);
          }

          if (isNum(z) && Math.abs(z) > 6) emitLog?.(`⚠️ Sehr extremer Z-Wert (z=${z.toFixed(3)}). Prüfe Referenz (μ/σ), Allele-Flip/Strand-Ambiguität, Harmonisierung.`);

          let prsExp = null; let rrRel  = null; const isLogScale = (weightScale === 'log_or' || weightScale === 'log_hr');
          if (isLogScale) {
            prsExp = Math.exp(rawScore);
            if (isNum(muUsed)) rrRel = Math.exp(rawScore - muUsed);
            if (isNum(rrRel)) emitLog?.(`🧮 Interpretierbares relatives Risiko: exp(rawScore - μ) = ${rrRel.toFixed(4)} (${weightScale}) (1.0 ≈ Durchschnitt)`);
            else emitLog?.(`🧮 Interpretierbares relatives Risiko: exp(rawScore) = ${prsExp.toFixed(4)} (${weightScale})`);
          }

          if (isNum(muUsed) && isNum(sdUsed)) emitLog?.(`ℹ️ Referenz benutzt: μ=${muUsed.toFixed(4)}, σ=${sdUsed.toFixed(4)} (Quelle=${refSource})`);

          const traitName = traitsMap[efo] || '';
          const topVariants = matches
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
            prsExp: isLogScale && isNum(prsExp) ? prsExp : null,
            rrRel:  isLogScale && isNum(rrRel)  ? rrRel  : null,
            weightScale,
            zScore: isNum(z) ? z : null,
            percentile: isNum(pct) ? pct : null,
            matches: matches.length,
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
            matches: matches.length,
            totalVariants: scoreLines.length - 1
          });

        } catch (err) {
          emitLog(`❌ Fehler bei ${pgsId}: ${err.message}`);
        }

        completed++;
        const progress = (completed / totalJobs) * 100;
        self.postMessage({ currentPGS: pgsId, progress, efoId: efo });
      }

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
