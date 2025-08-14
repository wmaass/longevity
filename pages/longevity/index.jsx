'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DashboardLayout from '../../components/DashboardLayout';
import Papa from 'papaparse';

/*********************************
 * Utilities (math + parsing)
 *********************************/
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const erf = (x) => {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1/(1+p*Math.abs(x));
  const y = 1-((((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x);
  return sign*y;
};
const cdf = (z)=> 0.5*(1+erf(z/Math.SQRT2));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clampPct = (p)=> Math.max(0.1, Math.min(99.9, p));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const toPct = (x) => Math.round(100 * clamp01(x));
const safeNum = (v) => (Number.isFinite(+v) ? +v : null);

/** pick a value by several candidate keys (case-insensitive) */
function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
    const found = Object.keys(row).find((kk) => kk.toLowerCase() === k.toLowerCase());
    if (found && String(row[found]).trim() !== '') return row[found];
  }
  return null;
}




/*********************************
 * Apple Watch loader (summary.json)
 *********************************/
async function loadAppleWatchSummary(genomeName) {
  try {
    // 1) API ruft Export ein, prüft Zeitstempel und schreibt summary.json ggf. neu
    const url = `/api/apple_watch/refresh-summary?genome=${encodeURIComponent(genomeName)}`;
    let res = await fetch(url);
    // Fallback: Wenn z.B. in dev die API nicht verfügbar ist
    if (!res.ok) {
      // 2) direkter Fallback auf vorhandene summary.json im Public-Ordner
      const sumUrl = `/results/${encodeURIComponent(genomeName)}/apple_watch/summary.json`;
      res = await fetch(sumUrl);
      if (!res.ok) return null;
    }
    const j = await res.json();
    const out = {};
    const n = (x) => (Number.isFinite(+x) ? +x : null);
    if (n(j?.rhr) != null) out.rhr = n(j.rhr);
    if (n(j?.hrv_rmssd) != null) out.hrv_rmssd = n(j.hrv_rmssd);
    if (n(j?.hrv) != null && out.hrv_rmssd == null) out.hrv_rmssd = n(j.hrv);
    if (n(j?.vo2max) != null) out.vo2max = n(j.vo2max);
    if (n(j?.sleep_hours) != null) out.sleep_hours = n(j.sleep_hours);
    if (n(j?.steps) != null) out.steps = n(j.steps);
    out.window = j?.window || null;
    out.asOf = j?.asOf || null;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}


function calcAge(dobISO, refISO) {
  if (!dobISO) return null;
  const dob = new Date(dobISO);
  const ref = refISO ? new Date(refISO) : new Date();
  if (Number.isNaN(dob.getTime()) || Number.isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) age--;
  return age;
}

const get = (obj, path, def = null) =>
  path.split('.').reduce((o, k) => (o && k in o ? o[k] : def), obj ?? {});

/*********************************
 * Clinical biomarkers block (unchanged logic, heuristic display)
 *********************************/
function computeBiomarkerGoodness01(bm) {
  const vitals = get(bm, 'biomarkers.vitals', {});
  const blood  = get(bm, 'biomarkers.bloodTests', {});
  const other  = get(bm, 'biomarkers.other', {});

  const systolic  = get(vitals, 'bloodPressure.systolic', null);
  const diastolic = get(vitals, 'bloodPressure.diastolic', null);
  const bmi       = get(other,  'bmi.value', get(other, 'bmi', null));
  const hdl       = get(blood,  'hdlCholesterol.value', get(blood, 'hdlCholesterol', null));
  const ldl       = get(blood,  'ldlCholesterol.value', get(blood, 'ldlCholesterol', null));
  const tg        = get(blood,  'triglycerides.value', get(blood, 'triglycerides', null));
  const glu       = get(blood,  'fastingGlucose.value', get(blood, 'fastingGlucose', null));
  const a1c       = get(blood,  'hba1c.value', get(blood, 'hba1c', null));

  const comp = [];

  // Blutdruck
  if (systolic != null && diastolic != null) {
    const s = clamp01((160 - systolic) / (160 - 110));
    const d = clamp01((100 - diastolic) / (100 - 70));
    comp.push({
      key: 'Blutdruck',
      score: clamp01(0.6 * s + 0.4 * d),
      displayValue: `${systolic}/${diastolic}`,
      unit: 'mmHg',
    });
  }

  // BMI
  if (bmi != null) {
    let score;
    if (bmi >= 20 && bmi <= 25) score = 1;
    else if (bmi >= 18 && bmi < 20) score = clamp01((bmi - 18) / 2);
    else if (bmi > 25 && bmi <= 30) score = clamp01((30 - bmi) / 5);
    else score = 0;
    comp.push({ key: 'BMI', score, displayValue: bmi, unit: 'kg/m²' });
  }

  // HDL
  if (hdl != null) {
    const score = clamp01((hdl - 40) / 30);
    comp.push({ key: 'HDL', score, displayValue: hdl, unit: 'mg/dL' });
  }

  // LDL
  if (ldl != null) {
    const score = clamp01((160 - ldl) / 90);
    comp.push({ key: 'LDL', score, displayValue: ldl, unit: 'mg/dL' });
  }

  // Triglyceride
  if (tg != null) {
    const score = clamp01((300 - tg) / 220);
    comp.push({ key: 'Triglyceride', score, displayValue: tg, unit: 'mg/dL' });
  }

  // Nüchternglukose
  if (glu != null) {
    let score;
    if (glu <= 99 && glu >= 70) score = 1;
    else if (glu > 99 && glu <= 125) score = clamp01((125 - glu) / 26);
    else score = 0;
    comp.push({ key: 'Nüchternglukose', score, displayValue: glu, unit: 'mg/dL' });
  }

  // HbA1c
  if (a1c != null) {
    let score;
    if (a1c < 5.7) score = 1;
    else if (a1c < 6.5) score = clamp01((6.5 - a1c) / 0.8);
    else score = 0;
    comp.push({ key: 'HbA1c', score, displayValue: a1c, unit: '%' });
  }

  const overall = comp.length ? mean(comp.map((c) => c.score)) : 0;
  return { overall, components: comp };
}


/*********************************
 * GENETICS — hazard-based contribution using β × z
 *********************************/
// Combine per-PGS rows on the log-hazard scale. Higher RR = higher risk.
function computeGeneticHazard(rows) {
  const parts = [];
  let sumLog = 0;
  for (const r of rows) {
    const zRaw = safeNum(r.zScore);
    const beta = safeNum(r.betaPerSD);
    if (zRaw == null || beta == null) continue;
    const direction = r.direction || 'higher-worse';
    const signedZ = direction === 'higher-better' ? -zRaw : zRaw;
    // Winsorize z to avoid outlier dominance (±3 SD) – common in PRS aggregation
    const z = Math.max(-3, Math.min(3, signedZ));
    const logHR = beta * z;
    const RR = Math.exp(logHR);
    sumLog += logHR;
    parts.push({
      pgsId: r.pgsId || r.id || r.PGS || null,
      trait: r.trait || r.Trait || r.efoId || r.EFO || null,
      z,
      betaPerSD: beta,
      logHR,
      RR,
    });
  }
  const logHR_genetic = parts.length ? sumLog : null;
  const RR_genetic = parts.length ? Math.exp(logHR_genetic) : null;
  const index01 = parts.length ? 1 / (1 + Math.exp(logHR_genetic)) : null; // display only
  return { logHR_genetic, RR_genetic, index01, components: parts };
}

/*********************************
 * LIFESTYLE / VITALS (separate, experimental)
 *********************************/
const LIFESTYLE_CONFIG = [
  { key: 'restingHeartRate', label: 'Ruhepuls (RHR)', path: 'biomarkers.vitals.restingHeartRate', unit: 'bpm', direction: 'lower-better', target: 60, sd: 10, hazardBetaPerUnit: null },
  { key: 'heartRateVariability', label: 'HRV (rMSSD)', path: 'biomarkers.vitals.heartRateVariability', unit: 'ms', direction: 'higher-better', target: 60, sd: 20, hazardBetaPerUnit: null },
  { key: 'vo2max', label: 'VO₂max', path: 'biomarkers.vitals.vo2max', unit: 'ml/kg/min', direction: 'higher-better', target: 40, sd: 8, hazardBetaPerUnit: null },
  { key: 'sleepDuration', label: 'Schlafdauer', path: 'biomarkers.vitals.sleep.duration', unit: 'h', direction: 'window-7-9', target: 7.5, sd: 1.0, hazardBetaPerUnit: null },
  { key: 'steps', label: 'Schritte/Tag', path: 'biomarkers.vitals.activity.steps', unit: 'steps', direction: 'higher-better', target: 8000, sd: 3000, hazardBetaPerUnit: null },
];
function logistic01(x) { return 1 / (1 + Math.exp(x)); }
function computeLifestyleScores(bm, mode = 'z', cfg = LIFESTYLE_CONFIG) {
  if (!bm) return { mode, components: [], overallZ: null, overallHR: null, index01: null };
  
  const comps = [];
  let sumZ = 0, nZ = 0, sumLogHR = 0, anyHR = false;

  for (const m of cfg) {
    let raw = get(bm, `${m.path}.value`, get(bm, m.path, null));
    raw = safeNum(raw);

    if (raw == null) continue;
    if ((m.key === 'vo2max' || m.key === 'sleepDuration') && raw <= 0) continue;

    let z;
    if (m.direction === 'window-7-9') { 
      z = Math.abs(raw - m.target) / (m.sd || 1); 
    } else if (m.direction === 'lower-better') { 
      z = (raw - m.target) / (m.sd || 1); 
    } else { 
      z = (m.target - raw) / (m.sd || 1); 
    }

    let logHR = null, HR = null;
    if (Number.isFinite(m.hazardBetaPerUnit)) {
      const ref = m.target; 
      logHR = m.hazardBetaPerUnit * (raw - ref); 
      HR = Math.exp(logHR); 
      sumLogHR += logHR; 
      anyHR = true;
    }

    sumZ += z; 
    nZ += 1;

    comps.push({ key: m.key, label: m.label, unit: m.unit, value: raw, z, display01: logistic01(z), logHR, HR });
  }

  const overallZ = nZ ? (sumZ / nZ) : null;
  const overallHR = anyHR ? Math.exp(sumLogHR) : null;
  const index01 = overallZ != null ? logistic01(overallZ) : null;

  return { mode, components: comps, overallZ, overallHR, index01 };
}


/*********************************
 * UI widgets
 *********************************/

/** 10-stufige Farbskala (rot→grün) für 0–100 % */
function colorClassForPct(pct) {
  const palette = [
    'bg-red-600',     // 0–9
    'bg-red-500',     // 10–19
    'bg-orange-500',  // 20–29
    'bg-amber-500',   // 30–39
    'bg-yellow-500',  // 40–49
    'bg-lime-500',    // 50–59
    'bg-lime-600',    // 60–69
    'bg-green-500',   // 70–79
    'bg-green-600',   // 80–89
    'bg-emerald-600', // 90–100
  ];
  const i = Math.max(0, Math.min(9, Math.floor((pct ?? 0) / 10)));
  return palette[i];
}

const MIN_VISIBLE_PCT = 5; // Mindestbreite für "sehr schlecht"

const Bar = ({ value01, colorClass, forceVisible = false }) => {
  const hasValue = Number.isFinite(value01);
  if (!hasValue) {
    // fehlender Wert → nur Hintergrund, kein farbiger Balken
    return <div className="w-full h-2 rounded bg-gray-200" />;
  }

  // value01: 0..1 → Prozent
  let pct = Math.round(100 * clamp01(value01));

  // Sichtbaren roten Balken auch bei 0–10 % erzwingen
  if (forceVisible && pct < MIN_VISIBLE_PCT) pct = MIN_VISIBLE_PCT;

  const width = `${pct}%`;
  const barColor = colorClass || 'bg-emerald-600';

  return (
    <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
      <div className={`h-full ${barColor}`} style={{ width }} aria-hidden />
    </div>
  );
};


const AgeCompareBar = ({ chrono, bio }) => {
  if (chrono == null || bio == null) return null;
  const min = Math.min(chrono, bio) - 2;
  const max = Math.max(chrono, bio) + 2;
  const scale = (v) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="mt-3">
      <div className="text-xs text-gray-600 mb-1">Alter (Jahre)</div>
      <div className="relative w-full h-3 rounded bg-gray-200">
        <div className="absolute top-0 bottom-0 w-0.5 bg-gray-700" style={{ left: scale(chrono) }} title={`Chronologisch: ${chrono}`} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-500" style={{ left: scale(bio) }} title={`Biologisch: ${bio}`} />
      </div>
      <div className="flex justify-between text-xs mt-1 text-gray-600">
        <span>{Math.floor(min)}</span>
        <span>{Math.ceil(max)}</span>
      </div>
    </div>
  );
};

/*********************************
 * Page component
 *********************************/
const GENETIC_COMPONENTS = [
  // Optional: if you want to fetch per-EFO JSON details in addition to CSV
];

const OVERALL_WEIGHTS = { genetic: 0.6, biomarker: 0.4 }; // Lifestyle is SHOWN but not merged yet
// Ancestry filter keyword (matches substrings like 'European', 'Europe')
const ANCESTRY_FILTER = 'europe';

export default function LongevityPage() {
  const router = useRouter();

  const genomeName = useMemo(() => {
    const g = router.query.genome ?? router.query.genomeName ?? '';
    return Array.isArray(g) ? g[0] : g;
  }, [router.query.genome, router.query.genomeName]);

  // state
  const [availableByEfo, setAvailableByEfo] = useState({});
  const [pgsConfig, setPgsConfig] = useState([]);
  const [pgsBetaMap, setPgsBetaMap] = useState({});
  const [biomarkers, setBiomarkers] = useState(null);
  const [appleVitals, setAppleVitals] = useState(null);
  const [appleError, setAppleError] = useState(null);
  const [geneticRows, setGeneticRows] = useState([]); // NEW: per-PGS rows with z & beta
  const [ancestryByPgs, setAncestryByPgs] = useState({}); // { PGS000xxx: { ancestries: string[], pss: string[] } }
  const [whatIf, setWhatIf] = useState({});
  const [loading, setLoading] = useState(true);
  const [showMethods, setShowMethods] = useState(false);
  const [showMethodsBiomarker, setShowMethodsBiomarker] = useState(false);


  // load config once
  useEffect(() => {
    fetch('/longevity_pgs.json')
      .then(r => (r.ok ? r.json() : []))
      .then(arr => setPgsConfig(Array.isArray(arr) ? arr : []))
      .catch(() => setPgsConfig([]));
  }, []);

  // load beta map once (Option 1)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/pgs_beta_map.json');
        if (!res.ok) { setPgsBetaMap({}); return; }
        const j = await res.json();
        setPgsBetaMap(j && typeof j === 'object' ? j : {});
      } catch {
        setPgsBetaMap({});
      }
    })();
  }, []);

  // load ancestry mapping from PGS Catalog evaluation sample sets (local copy under public/pgs_scores/metadata)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/pgs_scores/metadata/pgs_all_metadata_evaluation_sample_sets.csv');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
        const map = new Map(); // pgsId -> { ancestries:Set, pss:Set }
        for (const row of data) {
          const pgsId = String(pick(row, ['Evaluated Score','pgs_id','score_id','PGS ID','PGS']) || '').trim();
          if (!pgsId) continue;
          const anc = String(pick(row, ['Ancestry','Ancestry (broad)','ancestry','Sample Ancestry (broad)','PGS Sample Ancestry','Ancestry Category']) || '').trim();
          const pss = String(pick(row, ['PGS Sample Set (PSS)','pss_id','PSS ID']) || '').trim();
          if (!map.has(pgsId)) map.set(pgsId, { ancestries: new Set(), pss: new Set() });
          if (anc) map.get(pgsId).ancestries.add(anc);
          if (pss) map.get(pgsId).pss.add(pss);
        }
        const out = {};
        for (const [id, v] of map.entries()) out[id] = { ancestries: Array.from(v.ancestries), pss: Array.from(v.pss) };
        setAncestryByPgs(out);
      } catch (e) {
        console.warn('Ancestry load failed:', e);
        setAncestryByPgs({});
      }
    })();
  }, []);

  // load details CSV for this genome — build (a) avg percentiles per EFO and (b) per-PGS rows with z & beta
  useEffect(() => {
    if (!genomeName) return;
    const detPath = `/results/${encodeURIComponent(genomeName)}/batch_details_cardio.csv`;
    (async () => {
      try {
        const csv = await fetch(detPath).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
        const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });

        // Build quick lookup of beta per PGS from optional config
        const betaFromCfg = new Map();
        for (const c of (pgsConfig || [])) {
          if (c.pgsId && Number.isFinite(+c.betaPerSD)) betaFromCfg.set(String(c.pgsId), +c.betaPerSD);
        }

        const bins = new Map();
        const rows = [];
        for (const row of data) {
          const efo = String((row['efoId'] ?? row['EFO-ID'] ?? row['EFO ID'] ?? row['EFO'] ?? '')).trim();
          if (efo) {
            let pct = parseFloat(row.percentile ?? row.Percentile);
            if (!Number.isFinite(pct)) {
              const zTmp = parseFloat(row.zScore ?? row.z ?? row['Z-Score'] ?? row['Z']);
              if (Number.isFinite(zTmp)) pct = clampPct(cdf(zTmp) * 100);
            }
            if (Number.isFinite(pct)) {
              if (!bins.has(efo)) bins.set(efo, []);
              bins.get(efo).push(pct);
            }
          }

          // --- collect hazard inputs ---
          const z = num(row.zScore ?? row.z ?? row['Z-Score'] ?? row['Z']);
          const prs = num(row.prs ?? row.PRS ?? row['PRS Score'] ?? row['prs_score']);

          // Accept many coefficient spellings; convert OR/HR → beta (log scale)
          let betaPerSD = num(
            row.betaPerSD ?? row['beta_per_sd'] ?? row['beta_perSD'] ?? row['BetaPerSD'] ?? row['betaSD']
          );
          const hrPerSD = num(row.hrPerSD ?? row['HR_per_SD'] ?? row['HRperSD'] ?? row['HR per SD'] ?? row['HR']);
          const orPerSD = num(row.orPerSD ?? row['OR_per_SD'] ?? row['ORperSD'] ?? row['OR per SD'] ?? row['OR'] ?? row['oddsRatioPerSD']);
          const logHRperSD = num(row.logHR_perSD ?? row['logHR per SD']);
          const logORperSD = num(row.logOR_perSD ?? row['logOR per SD']);

          if (!Number.isFinite(betaPerSD)) {
            if (Number.isFinite(logHRperSD)) betaPerSD = logHRperSD;
            else if (Number.isFinite(logORperSD)) betaPerSD = logORperSD;
            else if (Number.isFinite(hrPerSD)) betaPerSD = Math.log(hrPerSD);
            else if (Number.isFinite(orPerSD)) betaPerSD = Math.log(orPerSD);
          }

          const pgsId = (row.id ?? row.PGS ?? row.pgsId ?? row['PGS ID'] ?? '').toString();
          const trait = row.trait ?? row.Trait ?? efo;

          // Fallback: pull beta from config by PGS id
          const cfgBeta = betaFromCfg.get(pgsId);
          const mapBeta = pgsBetaMap ? pgsBetaMap[pgsId] : undefined;
          if (!Number.isFinite(betaPerSD) && Number.isFinite(cfgBeta)) betaPerSD = cfgBeta;
          if (!Number.isFinite(betaPerSD) && Number.isFinite(mapBeta)) betaPerSD = mapBeta;

          if (pgsId && (z != null || prs != null)) {
            rows.push({ pgsId, trait, efoId: efo, zScore: z, prs, betaPerSD, direction: 'higher-worse' });
          }
        }
        const out = {}; for (const [e, arr] of bins.entries()) out[e] = arr.reduce((a,b)=>a+b,0)/arr.length;
        setAvailableByEfo(out);
        setGeneticRows(rows);
      } catch (e) {
        console.error('details load failed', e);
        setAvailableByEfo({});
        setGeneticRows([]);
      }
    })();
  }, [genomeName, pgsConfig, pgsBetaMap]);

  // load biomarker file
  useEffect(() => {
    if (!router.isReady || !genomeName) return;
    (async () => {
      setLoading(true);
      try {
        const bmUrl = `/results/${encodeURIComponent(genomeName)}/biomarkers.json`;
        const bmRes = await fetch(bmUrl);
        if (bmRes.ok) setBiomarkers(await bmRes.json()); else setBiomarkers(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, genomeName]);

  useEffect(() => {
    if (!genomeName) return;
    (async () => {
      try {
        const aw = await loadAppleWatchSummary(genomeName);
        setAppleVitals(aw);
        setAppleError(null);
      } catch (e) {
        setAppleVitals(null);
        setAppleError(String(e));
      }
    })();
  }, [genomeName]);


  // Select one PGS per trait/EFO with available betaPerSD, prefer highest |z|
  const selectedPgsRows = useMemo(() => {
    const byTrait = new Map();
    for (const r of geneticRows) {
      // Filter by ancestry if we have metadata
      const meta = ancestryByPgs[r.pgsId];
      const okAncestry = !meta || !meta.ancestries?.length
        ? true
        : meta.ancestries.some(a => a && a.toLowerCase().includes(ANCESTRY_FILTER));
      if (!okAncestry) continue;

      const k = r.trait || r.efoId || 'NA';
      const cur = byTrait.get(k);
      if (!cur || Math.abs(r.zScore ?? 0) > Math.abs(cur.zScore ?? 0)) byTrait.set(k, r);
    }
    return Array.from(byTrait.values());
  }, [geneticRows, ancestryByPgs]);

  // Compute hazard-based genetic contribution
  const geneticHazard = useMemo(() => computeGeneticHazard(selectedPgsRows.filter(r => Number.isFinite(r.betaPerSD))), [selectedPgsRows]);

  // NOTE: No z-only fallback for aggregation anymore (scientific defensibility). If β not available, we do not aggregate into risk.

  // Lifestyle/Vitals summary (z-score aggregation by default)
  const lifestyleSummary = useMemo(() => {
    const overlay = JSON.parse(JSON.stringify(biomarkers || {}));
    if (appleVitals) {
      overlay.biomarkers = overlay.biomarkers || {};
      overlay.biomarkers.vitals = overlay.biomarkers.vitals || {};
      if (appleVitals.rhr != null) {
        overlay.biomarkers.vitals.restingHeartRate = { value: appleVitals.rhr, unit: 'bpm' };
      }
      if (appleVitals.hrv_rmssd != null) {
        overlay.biomarkers.vitals.heartRateVariability = { value: appleVitals.hrv_rmssd, unit: 'ms' };
      }
      if (appleVitals.vo2max != null) {
        overlay.biomarkers.vitals.vo2max = { value: appleVitals.vo2max, unit: 'ml/kg/min' };
      }
      if (appleVitals.sleep_hours != null) {
        overlay.biomarkers.vitals.sleep = { duration: { value: appleVitals.sleep_hours, unit: 'h' } };
      }
      if (appleVitals.steps != null) {
        overlay.biomarkers.vitals.activity = { steps: { value: appleVitals.steps, unit: 'steps' } };
      }
    }
    return computeLifestyleScores(overlay, 'z');
  }, [biomarkers, appleVitals]);


  // Biomarker summary
  const biomarkerSummary = useMemo(() => {
    if (!biomarkers) return { overall: 0, components: [] };
    const overlay = JSON.parse(JSON.stringify(biomarkers || {}));
    if (whatIf.systolic != null || whatIf.diastolic != null) {
      overlay.biomarkers = overlay.biomarkers || {};
      overlay.biomarkers.vitals = overlay.biomarkers.vitals || {};
      overlay.biomarkers.vitals.bloodPressure = overlay.biomarkers.vitals.bloodPressure || {};
      if (whatIf.systolic != null) overlay.biomarkers.vitals.bloodPressure.systolic = whatIf.systolic;
      if (whatIf.diastolic != null) overlay.biomarkers.vitals.bloodPressure.diastolic = whatIf.diastolic;
    }
    if (whatIf.bmi != null) {
      overlay.biomarkers = overlay.biomarkers || {};
      overlay.biomarkers.other = overlay.biomarkers.other || {};
      overlay.biomarkers.other.bmi = { value: whatIf.bmi, unit: get(biomarkers, 'biomarkers.other.bmi.unit', '') };
    }
    if (whatIf.hba1c != null) {
      overlay.biomarkers = overlay.biomarkers || {};
      overlay.biomarkers.bloodTests = overlay.biomarkers.bloodTests || {};
      overlay.biomarkers.bloodTests.hba1c = { value: whatIf.hba1c, unit: '%' };
    }
    return computeBiomarkerGoodness01(overlay);
  }, [biomarkers, whatIf]);

    /** Linearer Mix */
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

  /** Altersabhängige Gewichte (Anker: 30/50/70 J.) */
  function ageWeightedWeights(age) {
    // Defaults falls Alter unbekannt
    if (!Number.isFinite(age)) return { g: 0.5, b: 0.35, l: 0.15 };

    // Anker:
    // 30 J: Genetik 0.70 · Biomarker 0.20 · Lifestyle 0.10
    // 50 J: Genetik 0.50 · Biomarker 0.35 · Lifestyle 0.15
    // 70 J: Genetik 0.30 · Biomarker 0.50 · Lifestyle 0.20

    if (age <= 40) {
      const t = (age - 30) / 20; // 30→50
      return {
        g: lerp(0.70, 0.50, t),
        b: lerp(0.20, 0.35, t),
        l: lerp(0.10, 0.15, t),
      };
    } else if (age <= 60) {
      const t = (age - 50) / 20; // 50→70
      return {
        g: lerp(0.50, 0.30, t),
        b: lerp(0.35, 0.50, t),
        l: lerp(0.15, 0.20, t),
      };
    } else {
      // >70: halte die 70er-Gewichte konstant
      return { g: 0.30, b: 0.50, l: 0.20 };
    }
  }


  // Longevity index (altersabhängige Gewichte; alle drei Beiträge integriert)
  const longevityIndex01 = useMemo(() => {
    // 1) Teil-Scores sammeln
    const hasGen  = Number.isFinite(geneticHazard.index01) && (geneticHazard.components?.length > 0);
    const hasBio  = Number.isFinite(biomarkerSummary?.overall);
    const hasLife = Number.isFinite(lifestyleSummary?.index01);

    const g = hasGen  ? geneticHazard.index01    : null; // 0..1 (höher besser)
    const b = hasBio  ? biomarkerSummary.overall : null; // 0..1
    const l = hasLife ? lifestyleSummary.index01 : null; // 0..1

    // 2) Alter bestimmen (aus biomarkers.json)
    const dob = biomarkers?.dateOfBirth || biomarkers?.person?.dateOfBirth;
    const ref = biomarkers?.dateRecorded || biomarkers?.biomarkers?.dateRecorded;
    const age = calcAge(dob, ref);

    // 3) Altersabhängige Basis-Gewichte holen
    const base = ageWeightedWeights(age); // { g,b,l }

    // 4) Gewichte auf tatsächlich vorhandene Anteile renormalisieren
    const w = {
      g: hasGen  ? Math.abs(base.g) : 0,
      b: hasBio  ? Math.abs(base.b) : 0,
      l: hasLife ? Math.abs(base.l) : 0,
    };
    const Z = (w.g + w.b + w.l) || 1;
    const wg = w.g / Z, wb = w.b / Z, wl = w.l / Z;

    // 5) Index berechnen (fehlt etwas → Gewicht 0)
    const idx =
      (hasGen  ? wg * g : 0) +
      (hasBio  ? wb * b : 0) +
      (hasLife ? wl * l : 0);

    return clamp01(idx);
  }, [geneticHazard.index01, geneticHazard.components, biomarkerSummary?.overall, lifestyleSummary?.index01, biomarkers]);


  // Ages (heuristic mapping retained but de-emphasized)
  const { chronoAge, bioAge, bioDelta } = useMemo(() => {
    if (!biomarkers) return { chronoAge: null, bioAge: null, bioDelta: null };
    const dob = biomarkers?.dateOfBirth || biomarkers?.person?.dateOfBirth;
    const refDate = biomarkers?.dateRecorded || biomarkers?.biomarkers?.dateRecorded;
    const cAge = calcAge(dob, refDate);
    const delta = Math.round((0.5 - (longevityIndex01 ?? 0.5)) * 20);
    const bAge = (cAge != null) ? cAge + delta : null;
    return { chronoAge: cAge, bioAge: bAge, bioDelta: delta };
  }, [biomarkers, longevityIndex01]);


  if (loading) {
    return (
      <DashboardLayout>
        <p className="p-8">Lade Longevity-Ansicht…</p>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <h2 className="text-3xl font-bold text-gray-800 mb-2">
        Longevity
        <span className="block text-lg text-gray-500">(Genome: {genomeName || '—'})</span>
      </h2>

      <div className="bg-white p-5 rounded-lg shadow mb-6">
        <h3 className="text-lg font-semibold">Biologisches vs. Chronologisches Alter</h3>
        {chronoAge == null || bioAge == null ? (
          <div className="text-gray-500 text-sm mt-2">Kein Geburtsdatum gefunden in <code>biomarkers.json</code>, oder Longevity-Index noch nicht berechnet.</div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <div className="text-sm text-gray-600">Chronologisches Alter</div>
                <div className="text-3xl font-extrabold">{chronoAge}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Biologisches Alter</div>
                <div className="text-3xl font-extrabold">{bioAge}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Differenz</div>
                <div className={`text-3xl font-extrabold ${bioDelta <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{bioDelta > 0 ? `+${bioDelta}` : bioDelta} Jahre</div>
              </div>
            </div>
            {/* <AgeCompareBar chrono={chronoAge} bio={bioAge} /> */}
            <div className="mt-3 text-xs text-gray-600">Heuristische Schätzung, nur zur Veranschaulichung. Validierte Kalibration ausstehend.</div>
          </>
        )}
      </div>

      {/* Top cards: Longevity · Genetic · Biomarker · Lifestyle */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        {/* Longevity Index */}
        <div className="bg-white p-5 rounded-lg shadow h-full flex flex-col">
          {/* Titel */}
          <h3 className="text-lg font-semibold mb-2">Longevity Index</h3>

          {/* Große Zahl */}
          <div className="h-16 flex items-end">
            <div className="text-5xl font-extrabold leading-none tabular-nums">
              {toPct(longevityIndex01)}
            </div>
          </div>

          {/* Untertitel-Zeile wie (experimentell) */}
          <div className="text-sm text-gray-500 mt-2">
            Genetik {Number.isFinite(geneticHazard.index01) ? toPct(geneticHazard.index01) : '—'} ·
            Biomarker {toPct(biomarkerSummary.overall)} ·
            Lifestyle {Number.isFinite(lifestyleSummary.index01) ? toPct(lifestyleSummary.index01) : '—'}
          </div>

          {/* Erklärung */}
          <div className="mt-3 text-xs text-gray-600">
            0–100 Skala (höher ist besser). Nicht-diagnostisch.
          </div>
        </div>

        {/* Genetic (hazard-based) */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Genetischer Beitrag</h3>
            <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setShowMethods(true)}>
              Methoden & Referenzen
            </button>
          </div>

          {/* Index-Zahl für Genetik (für die gemeinsame Linie) */}
          <div className="h-16 flex items-end">
            <div className="text-5xl font-extrabold leading-none tabular-nums">
              {Number.isFinite(geneticHazard.index01) ? toPct(geneticHazard.index01) : '—'}
            </div>
          </div>

          {/* Zusatzinfos darunter */}
          {selectedPgsRows.length === 0 ? (
            <p className="text-gray-500 text-sm mt-3">Keine PGS-Zeilen gefunden.</p>
          ) : geneticHazard.components.length ? (
            <>
              <div className="text-sm text-gray-600 mt-3">Relatives Risiko (vs. Median):</div>
              <div className="text-2xl font-bold">{geneticHazard.RR_genetic.toFixed(2)}×</div>
              <div className="text-xs text-gray-500">log(HR) gesamt: {geneticHazard.logHR_genetic.toFixed(3)} (z winsorized ±3)</div>
              <ul className="mt-3 text-sm text-gray-700 list-disc ml-4">
                {geneticHazard.components.map((c) => {
                  const meta = ancestryByPgs[c.pgsId];
                  const ancStr = meta?.ancestries?.length ? ` · Ancestry: ${meta.ancestries.join(', ')}` : '';
                  return (
                    <li key={c.pgsId}>
                      <span className="font-medium">{c.trait || 'Trait'}</span> · PGS {c.pgsId} — z={c.z.toFixed(2)}, β/SD={c.betaPerSD}, RR={c.RR.toFixed(2)}{ancStr}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 text-xs text-amber-600">
                Hinweis: Aggregation beruht auf publizierten β pro SD; z-Scores werden bei ±3 gekappt.
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-gray-600 mt-3">
                Keine validierten β-Koeffizienten gefunden – genetischer Beitrag wird nicht aggregiert.
              </div>
            </>
          )}
        </div>

        {/* Biomarker */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Biomarker</h3>
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline"
              onClick={() => setShowMethodsBiomarker(true)}
            >
              Methoden & Referenzen
            </button>
          </div>

            {/* Gesamt-Index (große Zahl, für Ausrichtung h-16) */}
          <div className="h-16 flex items-end">
            <div className="text-5xl font-extrabold leading-none tabular-nums">
              {toPct(biomarkerSummary.overall)}
            </div>
          </div>

          {biomarkerSummary.components.length ? (
            <>
              <div className="mt-3 text-xs text-gray-600">
                0–100 Skala (höher ist besser). Nicht-diagnostisch.
              </div>
              <ul className="mt-3 space-y-4">
                {biomarkerSummary.components.map((c, i) => {
                  const pct = toPct(c.score); // für Farbe/Balkenbreite
                  const right = c.displayValue != null
                    ? `${c.displayValue}${c.unit ? ` ${c.unit}` : ''}`
                    : '—';
                  return (
                    <li key={i} className="relative">
                      <div className="flex justify-between px-1 mb-0.5">
                        <span className="text-sm">{c.key}</span>
                        <span className="text-sm font-mono">{right}</span>
                      </div>
                      <Bar
                        value01={c.score}
                        colorClass={colorClassForPct(pct)}
                        forceVisible
                      />
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="text-gray-500 text-sm mt-3">Keine verwertbaren Biomarker gefunden.</div>
          )}
        </div>

        {/* Vitalwerte (Lifestyle) */}
        <div className="bg-white p-5 rounded-lg shadow h-full flex flex-col">
          <h3 className="text-lg font-semibold mb-2">Vitalwerte</h3>

          {/* große Zahl */}
          <div className="h-16 flex items-end">
            <div className="text-5xl font-extrabold leading-none tabular-nums">
              {Number.isFinite(lifestyleSummary.index01) ? toPct(lifestyleSummary.index01) : '—'}
            </div>
          </div>

          {appleVitals && (
            <div className="text-xs text-gray-500 mt-2">
              Quelle: Apple Watch
              {appleVitals.window ? ` · ${appleVitals.window}` : ''}
              {appleVitals.asOf ? ` · Stand: ${new Date(appleVitals.asOf).toLocaleDateString()}` : ''}
            </div>
          )}
          {lifestyleSummary.overallZ != null && (
            <div className="text-xs text-gray-500 mt-1">
              Gesamt-z (worse↑): {lifestyleSummary.overallZ.toFixed(2)}
            </div>
          )}
          {lifestyleSummary.components.length ? (
            <>
              <ul className="mt-3 space-y-2">
                {lifestyleSummary.components.map((c) => {
                  const pct = toPct(c.display01);
                  return (
                    <li key={c.key}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm">{c.label}</div>
                        <div className="text-xs text-gray-600">
                          {c.value}{c.unit ? ` ${c.unit}` : ''} · z={c.z.toFixed(2)}
                        </div>
                      </div>
                     <Bar
                        value01={c.display01}
                        colorClass={colorClassForPct(toPct(c.display01))}
                        forceVisible
                      />
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 text-xs text-gray-500">
                * Z-Score relativ zu Zielwerten (Demo).
              </div>
              <div className="mt-1 text-xs text-amber-600">
                Wearable-basierte Scores sind experimentell.
              </div>
            </>
          ) : (
            <div className="text-gray-500 text-sm mt-3">Keine Lifestyle-/Vitals-Metriken gefunden.</div>
          )}
        </div>

      </div>


      {/* Methoden & Referenzen Modal */}
      {showMethods && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setShowMethods(false)}
        />
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6">
          <div className="flex items-start justify-between mb-4">
            <h4 className="text-xl font-semibold">Genetischer Beitrag – Methoden & Referenzen</h4>
            <button
              className="text-gray-500 hover:text-gray-700"
              onClick={() => setShowMethods(false)}
            >
              ✕
            </button>
          </div>
          <div className="prose prose-sm max-w-none text-gray-700">
            <ul>
              <li>
                <h5 className="text-lg font-bold mt-4 mb-2">Datenquellen:</h5>
                PGS Catalog <em>Performance Metrics</em> (<code>pgs_all_metadata_performance_metrics.csv</code>) und 
                <em> Evaluation Sample Sets</em> (<code>pgs_all_metadata_evaluation_sample_sets.csv</code>).
              </li>
              <li>
                <h5 className="text-lg font-bold mt-4 mb-2">Effektgrößen:</h5>
                Für jedes PGS wird die publizierte Effektgröße pro 1 SD verwendet. Falls als HR/OR angegeben, 
                wird <code>β/SD = ln(HR)</code> bzw. <code>ln(OR)</code> berechnet. Auswahl: Beta → HR → OR, 
                priorisiert nach größerer Stichprobe.
              </li>
              <li>
                <h5 className="text-lg font-bold mt-4 mb-2">Ancestry-Filter:</h5>
                Nur Evaluations-Sets mit Ancestry, die „Europe“ enthält (konfigurierbar über <code>ANCESTRY_FILTER</code>).
              </li>
              <li>
                <h5 className="text-lg font-bold mt-4 mb-2">Aggregation:</h5>
                Pro Trait wird ein PGS mit größtem |z| gewählt. Z-Scores werden bei ±3 SD gekappt. 
                Gesamtlog-HR: <code>Σ(β/SD × z)</code>, relatives Risiko <code>RR = exp(logHR)</code>.
              </li>
              <li>
                <h5 className="text-lg font-bold mt-4 mb-2">Interpretation:</h5>
                RR &lt; 1 protektiv, RR &gt; 1 erhöhtes Risiko. 
                <span className="text-red-600">
                  Ergebnisse sind explorativ und dienen ausschließlich zu Forschungs- und Informationszwecken. 
                  Sie sind nicht für medizinische Diagnosen geeignet und dürfen nicht als Ersatz für ärztliche Beratung oder Behandlung verwendet werden.
                </span>
              </li>
            </ul>

            <h5 className="text-lg font-bold mt-4 mb-2">Primärreferenzen</h5>
            <ul>
              <li>
                PGS Catalog – <a href="https://www.pgscatalog.org/downloads/" target="_blank" rel="noreferrer">Downloads</a>:
                Dokumentation zu Scoring Files & Performance Metrics.
              </li>
            </ul>

            <h5 className="text-lg font-bold mt-4 mb-2">Limitierungen</h5>
            <ul>
              <li>Effektgrößen sind studien-/kohortenspezifisch.</li>
              <li>Z-Score-Standardisierung setzt μ=0/σ=1 in der Referenzpopulation voraus.</li>
              <li>Explorativ; keine medizinische Beratung.</li>
            </ul>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200"
              onClick={() => setShowMethods(false)}
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    )}


      {showMethodsBiomarker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowMethodsBiomarker(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6">
            <div className="flex items-start justify-between mb-4">
              <h4 className="text-xl font-semibold">Biomarker – Methoden & Referenzen</h4>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setShowMethodsBiomarker(false)}
              >
                ✕
              </button>
            </div>
            <div className="prose prose-sm max-w-none text-gray-700">
              <ul>
                <li><h5 className="text-lg font-bold mt-4 mb-2">Datenquellen:</h5> Blutdruck, BMI, Lipidprofil (HDL, LDL, Triglyceride), Nüchternglukose, HbA1c – gemäß AHA „Life’s Essential 8“ und Kriterien des metabolischen Syndroms.</li>
                <li><h5 className="text-lg font-bold mt-4 mb-2">Skalierung:</h5> Jeder Marker wird auf 0–100 skaliert anhand evidenzbasierter Zielwerte (Leitlinien). 100 = optimaler Zielwert, 0 = stark abweichend. Zwischenwerte linear interpoliert.</li>
                <li><h5 className="text-lg font-bold mt-4 mb-2">Aggregation:</h5> Der Biomarker-Index ist der ungewichtete Mittelwert aller verfügbaren Einzel-Scores. Fehlende Werte werden ignoriert, sodass der Index nur aus vorhandenen Daten gebildet wird.</li>
                <li><h5 className="text-lg font-bold mt-4 mb-2">Interpretation:</h5> Höherer Score = besserer kardiometabolischer Status. 
                  <span className="text-red-600">
                    Ergebnisse sind explorativ und dienen ausschließlich zu Forschungs- und Informationszwecken. 
                    Sie sind nicht für medizinische Diagnosen geeignet und dürfen nicht als Ersatz für ärztliche Beratung oder Behandlung verwendet werden.
                  </span></li>
              </ul>

              <h5 className="text-lg font-bold mt-4 mb-2">Primärreferenzen</h5>
              <ul>
                <li>Lloyd-Jones, D. M. et al. & American Heart Association. (2022). Life’s essential 8: updating and enhancing the American Heart Association’s construct of cardiovascular health: a presidential advisory from the American Heart Association. <em>Circulation</em>, 146(5), e18-e43.</li>
                <li>Alberti, K. G. et al. (2009). Harmonizing the metabolic syndrome: a joint interim statement of the international diabetes federation task force on epidemiology and prevention; national heart, lung, and blood institute; American heart association; world heart federation; international atherosclerosis society; and international association for the study of obesity. Circulation, 120(16), 1640-1645.</li>
              </ul>

              <h5 className="text-lg font-bold mt-4 mb-2">Limitierungen</h5>
              <ul>
                <li>Referenzwerte können populationsspezifisch variieren.</li>
                <li>Einzelmessungen können Tages- und Messschwankungen unterliegen.</li>
                <li>Explorativ; keine medizinische Beratung.</li>
              </ul>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200"
                onClick={() => setShowMethodsBiomarker(false)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}


      {/* What-if row (clinical only for now) */}
      {/* <div className="bg-white p-5 rounded-lg shadow mb-6">
        <h3 className="text-lg font-semibold mb-3">Zusätzliche Vitalparameter</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-700 mb-1">Blutdruck (Syst./Diast.)</div>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="numeric" className="w-24 border rounded px-2 py-1" placeholder="Syst" value={whatIf.systolic ?? ''} onChange={(e) => setWhatIf((w) => ({ ...w, systolic: e.target.value === '' ? null : +e.target.value }))} />
              <span>/</span>
              <input type="number" inputMode="numeric" className="w-24 border rounded px-2 py-1" placeholder="Diast" value={whatIf.diastolic ?? ''} onChange={(e) => setWhatIf((w) => ({ ...w, diastolic: e.target.value === '' ? null : +e.target.value }))} />
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-700 mb-1">BMI</div>
            <input type="number" inputMode="decimal" className="w-28 border rounded px-2 py-1" placeholder="z.B. 24.5" value={whatIf.bmi ?? ''} onChange={(e) => setWhatIf((w) => ({ ...w, bmi: e.target.value === '' ? null : +e.target.value }))} />
          </div>
          <div>
            <div className="text-sm text-gray-700 mb-1">HbA1c (%)</div>
            <input type="number" step="0.1" inputMode="decimal" className="w-28 border rounded px-2 py-1" placeholder="z.B. 5.4" value={whatIf.hba1c ?? ''} onChange={(e) => setWhatIf((w) => ({ ...w, hba1c: e.target.value === '' ? null : +e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-600">Der Index und die Subscores oben aktualisieren sich live basierend auf den Eingaben. <button className="ml-3 text-blue-600 hover:underline" onClick={() => setWhatIf({})}>Zurücksetzen</button></div>
      </div> */}

      {/* ROI suggestions (clinical heuristics retained) */}
      <div className="bg-white p-5 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-3">Top-Hebel (geschätzt)</h3>
        <ul className="space-y-2 text-sm">
          {(() => {
            const all = [...biomarkerSummary.components].sort((a, b) => a.score - b.score);
            const picks = all.slice(0, 3);
            if (!picks.length) return <li className="text-gray-500">Keine offensichtlichen Hebel gefunden.</li>;
            return picks.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-medium">{c.key} verbessern</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-600">Würde den Biomarker-Beitrag in Richtung {toPct(Math.max(c.score, 0.85))} verschieben (Heuristik).</span>
              </li>
            ));
          })()}
        </ul>
        <div className="text-xs text-gray-500 mt-3">Hinweis: Heuristische Schätzung, keine medizinische Beratung.</div>
      </div>
    </DashboardLayout>
  );
}
