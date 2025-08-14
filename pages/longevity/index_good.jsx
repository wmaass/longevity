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
  const blood = get(bm, 'biomarkers.bloodTests', {});
  const other = get(bm, 'biomarkers.other', {});

  const systolic = get(vitals, 'bloodPressure.systolic', null);
  const diastolic = get(vitals, 'bloodPressure.diastolic', null);
  const bmi = get(other, 'bmi.value', get(other, 'bmi', null));
  const hdl = get(blood, 'hdlCholesterol.value', get(blood, 'hdlCholesterol', null));
  const ldl = get(blood, 'ldlCholesterol.value', get(blood, 'ldlCholesterol', null));
  const tg = get(blood, 'triglycerides.value', get(blood, 'triglycerides', null));
  const glu = get(blood, 'fastingGlucose.value', get(blood, 'fastingGlucose', null));
  const a1c = get(blood, 'hba1c.value', get(blood, 'hba1c', null));

  const comp = [];

  if (systolic != null && diastolic != null) {
    const s = clamp01((160 - systolic) / (160 - 110));
    const d = clamp01((100 - diastolic) / (100 - 70));
    comp.push({ key: 'Blutdruck', score: clamp01(0.6 * s + 0.4 * d) });
  }
  if (bmi != null) {
    let score;
    if (bmi >= 20 && bmi <= 25) score = 1;
    else if (bmi >= 18 && bmi < 20) score = clamp01((bmi - 18) / 2);
    else if (bmi > 25 && bmi <= 30) score = clamp01((30 - bmi) / 5);
    else score = 0;
    comp.push({ key: 'BMI', score });
  }
  if (hdl != null) {
    const score = clamp01((hdl - 40) / 30);
    comp.push({ key: 'HDL', score });
  }
  if (ldl != null) {
    const score = clamp01((160 - ldl) / 90);
    comp.push({ key: 'LDL', score });
  }
  if (tg != null) {
    const score = clamp01((300 - tg) / 220);
    comp.push({ key: 'Triglyceride', score });
  }
  if (glu != null) {
    let score;
    if (glu <= 99 && glu >= 70) score = 1;
    else if (glu > 99 && glu <= 125) score = clamp01((125 - glu) / 26);
    else score = 0;
    comp.push({ key: 'Nüchternglukose', score });
  }
  if (a1c != null) {
    let score;
    if (a1c < 5.7) score = 1;
    else if (a1c < 6.5) score = clamp01((6.5 - a1c) / 0.8);
    else score = 0;
    comp.push({ key: 'HbA1c', score });
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
    let z;
    if (m.direction === 'window-7-9') { z = Math.abs(raw - m.target) / (m.sd || 1); }
    else if (m.direction === 'lower-better') { z = (raw - m.target) / (m.sd || 1); }
    else { z = (m.target - raw) / (m.sd || 1); }
    let logHR = null, HR = null;
    if (Number.isFinite(m.hazardBetaPerUnit)) {
      const ref = m.target; logHR = m.hazardBetaPerUnit * (raw - ref); HR = Math.exp(logHR); sumLogHR += logHR; anyHR = true; }
    sumZ += z; nZ += 1;
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
const Bar = ({ value01 }) => (
  <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
    <div className="h-full bg-emerald-500" style={{ width: `${toPct(value01)}%` }} aria-hidden />
  </div>
);

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
  const [geneticRows, setGeneticRows] = useState([]); // NEW: per-PGS rows with z & beta
  const [ancestryByPgs, setAncestryByPgs] = useState({}); // { PGS000xxx: { ancestries: string[], pss: string[] } }
  const [whatIf, setWhatIf] = useState({});
  const [loading, setLoading] = useState(true);
  const [showMethods, setShowMethods] = useState(false);

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
  const lifestyleSummary = useMemo(() => computeLifestyleScores(biomarkers, 'z'), [biomarkers]);

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

  // Longevity index (ONLY genetics + clinical; genetics uses hazard→visual index)
  const longevityIndex01 = useMemo(() => {
    // Dynamically renormalize weights: if genetics unavailable, use biomarker only
    const hasGen = Number.isFinite(geneticHazard.index01) && (geneticHazard.components?.length > 0);
    const wG = hasGen ? Math.abs(OVERALL_WEIGHTS.genetic || 0.5) : 0;
    const wB = Math.abs(OVERALL_WEIGHTS.biomarker || 0.5);
    const Z = (wG + wB) || 1;
    const g = hasGen ? geneticHazard.index01 : 0; // contributes only if hasGen
    const b = biomarkerSummary.overall;
    return clamp01((wG * g + wB * b) / Z);
  }, [geneticHazard.index01, geneticHazard.components, biomarkerSummary.overall]);

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
            <AgeCompareBar chrono={chronoAge} bio={bioAge} />
            <div className="mt-3 text-xs text-gray-600">Heuristische Schätzung, nur zur Veranschaulichung. Validierte Kalibration ausstehend.</div>
          </>
        )}
      </div>

      {/* Top cards: Longevity Index · Genetic · Biomarker · Lifestyle (separate) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Longevity Index */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold">Longevity Index</h3>
            <div className="text-sm text-gray-500">Genetik {Number.isFinite(geneticHazard.index01) ? toPct(geneticHazard.index01) : '—'} · Biomarker {toPct(biomarkerSummary.overall)}</div>
          </div>
          <div className="text-5xl font-extrabold mb-2">{toPct(longevityIndex01)}</div>
          <Bar value01={longevityIndex01} />
          <div className="mt-3 text-xs text-gray-600">0–100 Skala (höher ist besser). Nicht-diagnostisch.</div>
        </div>

        {/* Genetic (hazard-based) */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Genetischer Beitrag</h3>
            <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setShowMethods(true)}>
              Methoden & Referenzen
            </button>
          </div>
          {selectedPgsRows.length === 0 ? (
            <p className="text-gray-500 text-sm">Keine PGS-Zeilen gefunden.</p>
          ) : geneticHazard.components.length ? (
            <>
              <div className="text-sm text-gray-600">Relatives Risiko (vs. Median):</div>
              <div className="text-3xl font-bold">{geneticHazard.RR_genetic.toFixed(2)}×</div>
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
              <div className="mt-3 text-xs text-amber-600">Hinweis: Aggregation beruht auf publizierten β pro SD; z-Scores werden bei ±3 gekappt, um Ausreißer zu begrenzen.</div>
            </>
          ) : (
            <>
              <div className="text-sm text-gray-600">Keine validierten β-Koeffizienten gefunden – genetischer Risikobeitrag wird nicht aggregiert. Bitte β/SD bereitstellen (CSV oder pgs_beta_map.json).</div>
              <ul className="mt-3 text-sm text-gray-700 list-disc ml-4">
                {selectedPgsRows.map((c) => (
                  <li key={c.pgsId}><span className="font-medium">{c.trait}</span> · PGS {c.pgsId} — z={Number.isFinite(c.zScore) ? c.zScore.toFixed(2) : '—'}</li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-gray-500">Um Hazard-Modelle zu aktivieren, ergänze in der CSV eine der Spalten: <code>betaPerSD</code>, <code>beta_per_sd</code>, <code>HR_per_SD</code>, <code>OR_per_SD</code> (oder lege <code>/pgs_beta_map.json</code> mit <code>{'{ pgsId: betaPerSD }'}</code> an).</div>
            </>
          )}
        </div>

        {/* Biomarker components */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <h3 className="text-lg font-semibold mb-3">Biomarker-Beitrag</h3>
          {biomarkerSummary.components.length ? (
            <ul className="space-y-2">
              {biomarkerSummary.components.map((c, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm">{c.key}</div>
                    <div className="text-sm font-mono">{toPct(c.score)}</div>
                  </div>
                  <Bar value01={c.score} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500 text-sm">Keine verwertbaren Biomarker gefunden.</div>
          )}
        </div>

        {/* Lifestyle/Vitals (separate, experimental) */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold">Lifestyle/Vitals (experimentell)</h3>
            {lifestyleSummary.overallZ != null && (
              <div className="text-xs text-gray-500">Gesamt-z (worse↑): {lifestyleSummary.overallZ.toFixed(2)}</div>
            )}
          </div>
          {lifestyleSummary.components.length ? (
            <>
              {lifestyleSummary.index01 != null && (
                <>
                  <div className="text-3xl font-extrabold mb-2">{toPct(lifestyleSummary.index01)}</div>
                  <Bar value01={lifestyleSummary.index01} />
                </>
              )}
              <ul className="mt-3 space-y-2">
                {lifestyleSummary.components.map((c) => (
                  <li key={c.key}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm">{c.label}</div>
                      <div className="text-xs text-gray-600">{c.value}{c.unit ? ` ${c.unit}` : ''} · z={c.z.toFixed(2)}</div>
                    </div>
                    <Bar value01={c.display01} />
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-gray-500">* Z-Score relativ zu Zielwerten (Demo). Für wissenschaftliche Nutzung durch kohortenspezifische Referenzwerte/Hazard-Modelle ersetzen.</div>
              <div className="mt-1 text-xs text-amber-600">Wearable-basierte Scores sind experimentell und nicht diagnostisch.</div>
            </>
          ) : (
            <div className="text-gray-500 text-sm">Keine Lifestyle-/Vitals-Metriken gefunden.</div>
          )}
        </div>
      </div>

      {/* Methoden & Referenzen Modal */}
      {showMethods && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMethods(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6">
            <div className="flex items-start justify-between mb-4">
              <h4 className="text-xl font-semibold">Genetischer Beitrag – Methoden & Referenzen</h4>
              <button className="text-gray-500 hover:text-gray-700" onClick={() => setShowMethods(false)}>✕</button>
            </div>
            <div className="prose prose-sm max-w-none text-gray-700">
              <h5>Kurzes Methoden-Statement</h5>
              <ul>
                <li><strong>Datenquellen:</strong> PGS Catalog <em>Performance Metrics</em> (<code>pgs_all_metadata_performance_metrics.csv</code>) und <em>Evaluation Sample Sets</em> (<code>pgs_all_metadata_evaluation_sample_sets.csv</code>), lokal unter <code>/public/pgs_scores/metadata/</code>.</li>
                <li><strong>Effektgrößen:</strong> Für jedes PGS wird die publizierte Effektgröße pro 1&nbsp;SD verwendet. Falls als Hazard-/Odds Ratio angegeben, wird <code>β/SD = ln(HR)</code> bzw. <code>ln(OR)</code> berechnet. Wenn mehrere Angaben existieren, wird <em>Beta &gt; HR &gt; OR</em> bevorzugt und ggf. nach größerer Stichprobe priorisiert.</li>
                <li><strong>Ancestry-Filter:</strong> Es werden nur Evaluations-Sets mit Ancestry, die <code>"Europe"</code> enthält, berücksichtigt (konfigurierbar über <code>ANCESTRY_FILTER</code>).</li>
                <li><strong>Aggregation:</strong> Pro Trait wird ein PGS mit größtem |z| gewählt. Z‑Scores werden zur Robustheit bei ±3&nbsp;SD gekappt. Der genetische Gesamteffekt wird auf der log‑Hazard‑Skala addiert: <code>log(HR)<sub>gesamt</sub> = Σ(β/SD × z)</code>, relatives Risiko <code>RR = exp(log(HR)<sub>gesamt</sub>)</code>.</li>
                <li><strong>Interpretation:</strong> RR &lt; 1 protektiv, RR &gt; 1 erhöhtes relatives Risiko gegenüber dem Median. Die Ausgabe ist populations- und modellabhängig und dient nicht der Diagnostik.</li>
              </ul>

              <h5>Primärreferenzen (PGS Catalog)</h5>
              <ul>
                <li>PGS Catalog – <a href="https://www.pgscatalog.org/downloads/" target="_blank" rel="noreferrer">Downloads</a>: Dokumentation zu Scoring Files & Performance Metrics. Hinweis: „Author‑reported effect sizes can be supplied… if no other effect_weight is given the weight is calculated using the log(OR) or log(HR).“</li>
                <li>Bulk Metadata: <code>pgs_all_metadata_performance_metrics.csv</code> (Effektgrößen wie HR/OR/Beta per SD) und <code>pgs_all_metadata_evaluation_sample_sets.csv</code> (Ancestry der Evaluationssets).</li>
                <li>PGS Scoring Files & Metadata (Variantenebene) – für Score-Berechnung, nicht für per‑SD‑Effektkalibrierung gedacht.</li>
              </ul>

              <h5>Limitierungen</h5>
              <ul>
                <li>Effektgrößen sind studien‑/kohortenspezifisch; Generalisierbarkeit kann eingeschränkt sein.</li>
                <li>Z‑Score‑Standardisierung setzt μ=0/σ=1 in der Referenzpopulation voraus.</li>
                <li>Keine medizinische Beratung; Ergebnisse sind explorativ.</li>
              </ul>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200" onClick={() => setShowMethods(false)}>Schließen</button>
            </div>
          </div>
        </div>
      )}

      {/* What-if row (clinical only for now) */}
      <div className="bg-white p-5 rounded-lg shadow mb-6">
        <h3 className="text-lg font-semibold mb-3">What-if (sofortige Vorschau)</h3>
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
      </div>

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
