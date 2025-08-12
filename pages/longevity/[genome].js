'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DashboardLayout from '../../components/DashboardLayout';
import Papa from 'papaparse';

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
const clampPct = (p)=> Math.max(0.1, Math.min(99.9, p));

/** pick a value by several candidate keys (case-insensitive) */
function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
    // case-insensitive fallback
    const found = Object.keys(row).find((kk) => kk.toLowerCase() === k.toLowerCase());
    if (found && String(row[found]).trim() !== '') return row[found];
  }
  return null;
}

// 1) --- add near your other tiny utils ---
function calcAge(dobISO: string, refISO?: string) {
  if (!dobISO) return null;
  const dob = new Date(dobISO);
  const ref = refISO ? new Date(refISO) : new Date();
  if (Number.isNaN(dob.getTime()) || Number.isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) age--;
  return age;
}

// state you’ll need
const [availableByEfo, setAvailableByEfo] = useState({});   // { EFO_...: avgPercentile }
const [pgsConfig, setPgsConfig] = useState([]);             // from /public/longevity_pgs.json
const router = useRouter();
const genomeName = router.query.genome || router.query.genomeName || ''; // passed in link

/**
 * -------- CONFIG --------
 * Add / remove EFOs you want to fold into the Genetic Longevity subscore.
 * If the file /results/{genome}/details/{efoId}.json is missing, we skip it.
 * direction: 'higher-better' (e.g., HDL PGS) or 'higher-worse' (e.g., CAD PGS)
 */
const GENETIC_COMPONENTS = [
  // { efoId: 'EFO_0001645', label: 'Koronare Herzkrankheit (CAD)', weight: 1.0, direction: 'higher-worse' },
  // { efoId: 'EFO_0001360', label: 'Typ-2-Diabetes',               weight: 0.8, direction: 'higher-worse' },
  // { efoId: 'EFO_0001647', label: 'LDL-Cholesterin (PGS)',        weight: 0.6, direction: 'higher-worse' },
  // { efoId: 'EFO_0004612', label: 'HDL-Cholesterin (PGS)',        weight: 0.6, direction: 'higher-better' },
];

/**
 * Weights for overall Longevity Index composition.
 * Tune to taste (they must sum to 1.0; we’ll normalize anyway).
 */
const OVERALL_WEIGHTS = { genetic: 0.6, biomarker: 0.4 };

/* ---------- tiny utils ---------- */
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const toPct = (x) => Math.round(100 * clamp01(x));
const safeNum = (v) => (Number.isFinite(+v) ? +v : null);

/** Map a percentile (0–100) to a 0–1 “goodness” given a direction. */
function percentileToGoodness01(percentile, direction = 'higher-worse') {
  const p = safeNum(percentile);
  if (p == null) return null;
  const frac = clamp01(p / 100);
  return direction === 'higher-better' ? frac : 1 - frac;
}

/** ---------- Biomarker helpers (read from /results/{genome}/biomarkers.json) ---------- */
const get = (obj, path, def = null) =>
  path.split('.').reduce((o, k) => (o && k in o ? o[k] : def), obj ?? {});

function computeBiomarkerGoodness01(bm) {
  // Expect structure like you already use:
  // bm.vitals.bloodPressure { systolic, diastolic }, bm.other.bmi, bm.bloodTests.{hdlCholesterol, ldlCholesterol, triglycerides, fastingGlucose, hba1c}
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

  // Simple, transparent scoring to 0..1 (normalize to clinically sensible ranges)
  const comp = [];

  if (systolic != null && diastolic != null) {
    // Good <=120/80 → 1, worse down to >=160/100 → 0
    const s = clamp01((160 - systolic) / (160 - 110));
    const d = clamp01((100 - diastolic) / (100 - 70));
    comp.push({ key: 'Blutdruck', score: clamp01(0.6 * s + 0.4 * d) });
  }

  if (bmi != null) {
    // 20–25 best, 18–30 okay, beyond → worse
    let score;
    if (bmi >= 20 && bmi <= 25) score = 1;
    else if (bmi >= 18 && bmi < 20) score = clamp01((bmi - 18) / 2); // 0→1
    else if (bmi > 25 && bmi <= 30) score = clamp01((30 - bmi) / 5); // 0→1
    else score = 0;
    comp.push({ key: 'BMI', score });
  }

  if (hdl != null) {
    // higher better, 40→70 maps 0→1 (clip)
    const score = clamp01((hdl - 40) / 30);
    comp.push({ key: 'HDL', score });
  }

  if (ldl != null) {
    // lower better, 160→70 maps 0→1
    const score = clamp01((160 - ldl) / 90);
    comp.push({ key: 'LDL', score });
  }

  if (tg != null) {
    // lower better, 300→80 maps 0→1
    const score = clamp01((300 - tg) / 220);
    comp.push({ key: 'Triglyceride', score });
  }

  if (glu != null) {
    // 70–99 best, 100–125 degrade, >=126 poor
    let score;
    if (glu <= 99 && glu >= 70) score = 1;
    else if (glu > 99 && glu <= 125) score = clamp01((125 - glu) / 26);
    else score = 0;
    comp.push({ key: 'Nüchternglukose', score });
  }

  if (a1c != null) {
    // <5.7 best; 5.7–6.4 degrade; >=6.5 poor
    let score;
    if (a1c < 5.7) score = 1;
    else if (a1c < 6.5) score = clamp01((6.5 - a1c) / 0.8);
    else score = 0;
    comp.push({ key: 'HbA1c', score });
  }

  const overall = comp.length ? mean(comp.map((c) => c.score)) : 0;
  return { overall, components: comp };
}

/** ---------- Genetic helpers (read small set of /details/{efoId}.json) ---------- */
async function fetchPGSForEfo(genome, efoId) {
  try {
    const url = `/results/${genome}/details/${efoId}.json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const rows = Array.isArray(data) ? data : data?.detail || [];
    // Choose the “anchor” PGS by highest percentile if available
    let best = null;
    for (const row of rows) {
      const pct = safeNum(row.percentile);
      if (pct == null) continue;
      if (!best || pct > best.percentile) best = { percentile: pct, id: row.id || null, trait: row.trait || null };
    }
    // Else fall back to mean percentile if none had pct
    if (!best && rows.length) {
      const ps = rows.map((r) => safeNum(r.percentile)).filter((x) => x != null);
      if (ps.length) {
        const mu = mean(ps);
        best = { percentile: mu, id: rows[0].id || null, trait: rows[0].trait || null };
      }
    }
    return best; // { percentile, id?, trait? } or null
  } catch {
    return null;
  }
}

function computeGeneticGoodness01(present) {
  // present: [{label, weight, direction, percentile?}]
  const parts = [];
  for (const p of present) {
    const g = percentileToGoodness01(p.percentile, p.direction);
    if (g != null) parts.push({ ...p, score: g });
  }
  const wsum = parts.reduce((a, b) => a + Math.abs(b.weight || 1), 0) || 1;
  const overall = parts.length
    ? parts.reduce((a, b) => a + (b.score * Math.abs(b.weight || 1)) / wsum, 0)
    : 0;
  return { overall, components: parts };
}

/** ---------- Pretty widgets ---------- */
const Bar = ({ value01 }) => (
  <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
    <div
      className="h-full bg-emerald-500"
      style={{ width: `${toPct(value01)}%` }}
      aria-hidden
    />
  </div>
);

// load longevity components (once)
useEffect(() => {
  fetch('/longevity_pgs.json')
    .then(r => (r.ok ? r.json() : []))
    .then(arr => setPgsConfig(Array.isArray(arr) ? arr : []))
    .catch(() => setPgsConfig([]));
}, []);

// load per-EFO percentiles from DETAILS CSV
useEffect(() => {
  if (!genomeName) return;
  const detPath = `/results/${encodeURIComponent(genomeName)}/batch_details_cardio.csv`;

  (async () => {
    try {
      const csv = await fetch(detPath).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });

      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });

      // group percentiles by EFO and average
      const bins = new Map(); // efo -> number[]
      for (const row of data) {
        const efo =
          String(pick(row, ['efoId','EFO-ID','EFO ID','EFO']) || '').trim();
        if (!efo) continue;

        let pct = num(pick(row, ['percentile','Percentile']));
        if (!Number.isFinite(pct)) {
          // fallback: from zScore -> percentile
          const z = num(pick(row, ['zScore','z','Z-Score']));
          if (Number.isFinite(z)) pct = clampPct(cdf(z) * 100);
        }
        if (!Number.isFinite(pct)) continue;

        if (!bins.has(efo)) bins.set(efo, []);
        bins.get(efo).push(pct);
      }

      const out = {};
      for (const [efo, arr] of bins.entries()) {
        out[efo] = arr.reduce((a,b)=>a+b,0)/arr.length;
      }
      setAvailableByEfo(out);
    } catch (e) {
      console.error('Longevity: details load failed', e);
      setAvailableByEfo({});
    }
  })();
}, [genomeName]);

// 2) --- FIX: use genomeName consistently in the loader that fetches biomarkers & detail JSONs ---
useEffect(() => {
  if (!router.isReady || !genomeName) return;

  (async () => {
    setLoading(true);
    try {
      // Biomarkers
      const bmUrl = `/results/${encodeURIComponent(genomeName)}/biomarkers.json`;
      const bmRes = await fetch(bmUrl);
      if (bmRes.ok) setBiomarkers(await bmRes.json());
      else setBiomarkers(null);

      // Genetic components (optional fine-grained read from details)
      const present = [];
      for (const cfg of GENETIC_COMPONENTS) {
        const best = await fetchPGSForEfo(genomeName, cfg.efoId);
        if (best) present.push({ ...cfg, percentile: best.percentile, anchorId: best.id || null });
      }
      setGeneticParts(present);
    } finally {
      setLoading(false);
    }
  })();
}, [router.isReady, genomeName]);


// match configured PGS components to available per-EFO percentiles
const matchedPgs = useMemo(
  () => pgsConfig.filter(c => availableByEfo[c.efo] != null),
  [pgsConfig, availableByEfo]
);

// compute a simple “Genetischer Beitrag” index (0..100; higher better)
const geneticScore = useMemo(() => {
  if (!matchedPgs.length) return null;
  let sumW = 0, sum = 0;
  for (const c of matchedPgs) {
    const pct = availableByEfo[c.efo]; // 0..100, higher = higher genetic risk
    const x = c.direction === 'lower-better' ? (100 - pct) : pct; // normalize to risk-up
    const w = Number.isFinite(c.weight) ? c.weight : 1;
    sum += w * x;
    sumW += Math.abs(w);
  }
  const raw = sumW ? sum / sumW : 0;  // 0..100, “risk”
  const idx = Math.max(0, 100 - raw); // invert so higher = better
  return Math.round(idx);
}, [matchedPgs, availableByEfo]);

// 3) --- compute ages based on biomarkers & your longevity index ---
const { chronoAge, bioAge, bioDelta } = useMemo(() => {
  if (!biomarkers) return { chronoAge: null, bioAge: null, bioDelta: null };

  const dob = biomarkers?.dateOfBirth || biomarkers?.person?.dateOfBirth;
  const refDate = biomarkers?.dateRecorded || biomarkers?.biomarkers?.dateRecorded;
  const cAge = calcAge(dob, refDate);

  // Heuristic mapping: longevityIndex01 (0..1, higher=better) → delta in years ∈ [-10,+10]
  // Feel free to tune the "20" spread (e.g., 16 for ±8y).
  const delta = Math.round((0.5 - (longevityIndex01 ?? 0.5)) * 20);
  const bAge = (cAge != null) ? cAge + delta : null;

  return { chronoAge: cAge, bioAge: bAge, bioDelta: delta };
}, [biomarkers, longevityIndex01]);

// 4) --- small helper to draw a simple horizontal comparison bar ---
const AgeCompareBar = ({ chrono, bio }) => {
  if (chrono == null || bio == null) return null;

  // scale around the min/max of the two values with a bit of padding
  const min = Math.min(chrono, bio) - 2;
  const max = Math.max(chrono, bio) + 2;
  const scale = (v) => `${((v - min) / (max - min)) * 100}%`;

  return (
    <div className="mt-3">
      <div className="text-xs text-gray-600 mb-1">Alter (Jahre)</div>
      <div className="relative w-full h-3 rounded bg-gray-200">
        {/* chrono marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gray-700"
          style={{ left: scale(chrono) }}
          title={`Chronologisch: ${chrono}`}
        />
        {/* bio marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-emerald-500"
          style={{ left: scale(bio) }}
          title={`Biologisch: ${bio}`}
        />
      </div>
      <div className="flex justify-between text-xs mt-1 text-gray-600">
        <span>{Math.floor(min)}</span>
        <span>{Math.ceil(max)}</span>
      </div>
    </div>
  );
};


export default function LongevityPage() {
  const router = useRouter();

  // read genome from path param (/longevity/[genome]) OR from ?genome=
  const genomeName = useMemo(() => {
    const g = router.query.genome ?? router.query.genomeName ?? '';
    return Array.isArray(g) ? g[0] : g;
  }, [router.query.genome, router.query.genomeName]);

  // ✅ hooks belong inside the component
  const [availableByEfo, setAvailableByEfo] = useState({});
  const [pgsConfig, setPgsConfig] = useState([]);
  const [biomarkers, setBiomarkers] = useState(null);
  const [geneticParts, setGeneticParts] = useState([]);
  const [whatIf, setWhatIf] = useState({});
  const [loading, setLoading] = useState(true);

  // load config once
  useEffect(() => {
    fetch('/longevity_pgs.json')
      .then(r => (r.ok ? r.json() : []))
      .then(arr => setPgsConfig(Array.isArray(arr) ? arr : []))
      .catch(() => setPgsConfig([]));
  }, []);

  // load details CSV for this genome
  useEffect(() => {
    if (!genomeName) return;
    const detPath = `/results/${encodeURIComponent(genomeName)}/batch_details_cardio.csv`;
    (async () => {
      try {
        const csv = await fetch(detPath).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        });
        const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
        const bins = new Map();
        for (const row of data) {
          const efo = String((row['efoId'] ?? row['EFO-ID'] ?? row['EFO ID'] ?? row['EFO'] ?? '')).trim();
          if (!efo) continue;
          let pct = parseFloat(row.percentile ?? row.Percentile);
          if (!Number.isFinite(pct)) {
            const z = parseFloat(row.zScore ?? row.z ?? row['Z-Score']);
            if (Number.isFinite(z)) pct = Math.max(0.1, Math.min(99.9, 0.5*(1+erf(z/Math.SQRT2))*100));
          }
          if (!Number.isFinite(pct)) continue;
          if (!bins.has(efo)) bins.set(efo, []);
          bins.get(efo).push(pct);
        }
        const out = {};
        for (const [efo, arr] of bins.entries()) out[efo] = arr.reduce((a,b)=>a+b,0)/arr.length;
        setAvailableByEfo(out);
      } catch {
        setAvailableByEfo({});
      }
    })();
  }, [genomeName]);

  // load biomarker file and the configured EFO detail files
  useEffect(() => {
    if (!router.isReady || !genome) return;

    (async () => {
      setLoading(true);
      try {
        // Biomarkers
        const bmUrl = `/results/${genome}/biomarkers.json`;
        const bmRes = await fetch(bmUrl);
        if (bmRes.ok) setBiomarkers(await bmRes.json());
        else setBiomarkers(null);

        // Genetic components
        const present = [];
        for (const cfg of GENETIC_COMPONENTS) {
          const best = await fetchPGSForEfo(genome, cfg.efoId);
          if (best) present.push({ ...cfg, percentile: best.percentile, anchorId: best.id || null });
        }
        setGeneticParts(present);
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, genome]);

  // compute subscores
  const biomarkerScore = useMemo(() => {
    if (!biomarkers) return { overall: 0, components: [] };
    // allow simple what-if overrides (SBP, HbA1c, BMI)
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

  const geneticScore = useMemo(() => computeGeneticGoodness01(geneticParts), [geneticParts]);

  const longevityIndex01 = useMemo(() => {
    const wG = Math.abs(OVERALL_WEIGHTS.genetic || 0.5);
    const wB = Math.abs(OVERALL_WEIGHTS.biomarker || 0.5);
    const Z = wG + wB || 1;
    return clamp01((wG * geneticScore.overall + wB * biomarkerScore.overall) / Z);
  }, [geneticScore.overall, biomarkerScore.overall]);

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
          <div className="text-gray-500 text-sm mt-2">
            Kein Geburtsdatum gefunden in <code>biomarkers.json</code>, oder Longevity-Index noch nicht berechnet.
          </div>
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
                <div className={`text-3xl font-extrabold ${bioDelta <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {bioDelta > 0 ? `+${bioDelta}` : bioDelta} Jahre
                </div>
              </div>
            </div>

            <AgeCompareBar chrono={chronoAge} bio={bioAge} />

            <div className="mt-3 text-xs text-gray-600">
              Heuristische Schätzung: ΔAlter = (0.5 − Longevity-Index) × 20. Höherer Index ⇒ tendenziell jüngeres biologisches Alter.
            </div>
          </>
        )}
      </div>

      {/* Top row: Longevity Index · Genetic · Biomarker */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Longevity Index */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold">Longevity Index</h3>
            <div className="text-sm text-gray-500">
              Genetik {toPct(geneticScore.overall)} · Biomarker {toPct(biomarkerScore.overall)}
            </div>
          </div>
          <div className="text-5xl font-extrabold mb-2">{toPct(longevityIndex01)}</div>
          <Bar value01={longevityIndex01} />
          <div className="mt-3 text-xs text-gray-600">
            *0–100 Skala (höher ist besser). Nicht-diagnostisch; zu Demonstrationszwecken.
          </div>
        </div>

        {/* Genetic components */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <h3 className="text-lg font-semibold mb-2">Genetischer Beitrag</h3>
            {matchedPgs.length === 0 ? (
              <p className="text-gray-500 text-sm">
                Keine PGS-Komponenten konfiguriert oder gefunden.
                <br />
                <span className="text-xs">
                  Prüfe <code>/public/longevity_pgs.json</code> und EFOs in
                  <code> /results/{genomeName}/batch_details_cardio.csv</code>.
                </span>
              </p>
            ) : (
              <>
                <div className="text-3xl font-bold">{geneticScore}</div>
                <ul className="mt-3 text-sm text-gray-700 list-disc ml-4">
                  {matchedPgs.map(c => (
                    <li key={c.efo}>
                      {c.label} ({c.efo}): {availableByEfo[c.efo].toFixed(1)}%
                    </li>
                  ))}
                </ul>
              </>
            )}
        </div>

        {/* Biomarker components */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <h3 className="text-lg font-semibold mb-3">Biomarker-Beitrag</h3>
          {biomarkerScore.components.length ? (
            <ul className="space-y-2">
              {biomarkerScore.components.map((c, i) => (
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
      </div>

      {/* What-if row */}
      <div className="bg-white p-5 rounded-lg shadow mb-6">
        <h3 className="text-lg font-semibold mb-3">What-if (sofortige Vorschau)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* SBP/DBP */}
          <div>
            <div className="text-sm text-gray-700 mb-1">Blutdruck (Syst./Diast.)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                className="w-24 border rounded px-2 py-1"
                placeholder="Syst"
                value={whatIf.systolic ?? ''}
                onChange={(e) => setWhatIf((w) => ({ ...w, systolic: e.target.value === '' ? null : +e.target.value }))}
              />
              <span>/</span>
              <input
                type="number"
                inputMode="numeric"
                className="w-24 border rounded px-2 py-1"
                placeholder="Diast"
                value={whatIf.diastolic ?? ''}
                onChange={(e) => setWhatIf((w) => ({ ...w, diastolic: e.target.value === '' ? null : +e.target.value }))}
              />
            </div>
          </div>

          {/* BMI */}
          <div>
            <div className="text-sm text-gray-700 mb-1">BMI</div>
            <input
              type="number"
              inputMode="decimal"
              className="w-28 border rounded px-2 py-1"
              placeholder="z.B. 24.5"
              value={whatIf.bmi ?? ''}
              onChange={(e) => setWhatIf((w) => ({ ...w, bmi: e.target.value === '' ? null : +e.target.value }))}
            />
          </div>

          {/* HbA1c */}
          <div>
            <div className="text-sm text-gray-700 mb-1">HbA1c (%)</div>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              className="w-28 border rounded px-2 py-1"
              placeholder="z.B. 5.4"
              value={whatIf.hba1c ?? ''}
              onChange={(e) => setWhatIf((w) => ({ ...w, hba1c: e.target.value === '' ? null : +e.target.value }))}
            />
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          Der Index und die Subscores oben aktualisieren sich live basierend auf den Eingaben.
          <button
            className="ml-3 text-blue-600 hover:underline"
            onClick={() => setWhatIf({})}
          >
            Zurücksetzen
          </button>
        </div>
      </div>

      {/* ROI suggestions */}
      <div className="bg-white p-5 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-3">Top-Hebel (geschätzt)</h3>
        <ul className="space-y-2 text-sm">
          {(() => {
            // Pick up to three components with lowest scores
            const all = [...biomarkerScore.components].sort((a, b) => a.score - b.score);
            const picks = all.slice(0, 3);
            if (!picks.length) return <li className="text-gray-500">Keine offensichtlichen Hebel gefunden.</li>;
            return picks.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-medium">{c.key} verbessern</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-600">
                  Würde den Biomarker-Beitrag in Richtung {toPct(Math.max(c.score, 0.85))} verschieben (Heuristik).
                </span>
              </li>
            ));
          })()}
        </ul>
        <div className="text-xs text-gray-500 mt-3">
          Hinweise: Heuristische Schätzung, keine medizinische Beratung.
        </div>
      </div>
    </DashboardLayout>
  );
}
