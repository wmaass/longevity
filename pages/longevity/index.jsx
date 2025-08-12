'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DashboardLayout from '../../components/DashboardLayout';
import Papa from 'papaparse';

/* ---------- math & helpers ---------- */
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
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const toPct = (x) => Math.round(100 * clamp01(x));
const get = (obj, path, def = null) =>
  path.split('.').reduce((o, k) => (o && k in o ? o[k] : def), obj ?? {});

// -------- knobs --------
const PHENO_YEARS_MAX = 8;         // was 5 → ±8y phenotypic span
const prsCapByAge = (age) => age >= 60 ? 1.5 : age >= 50 ? 2.0 : 3.0; // age-based PRS cap

/** pick a value by several candidate keys (case-insensitive) */
function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
    const found = Object.keys(row).find((kk) => kk.toLowerCase() === k.toLowerCase());
    if (found && String(row[found]).trim() !== '') return row[found];
  }
  return null;
}
/** Map a percentile (0–100) to a 0–1 “goodness” given a direction. */
function percentileToGoodness01(percentile, direction) {
  const p = num(percentile);
  if (p == null) return null;
  const frac = clamp01(p / 100);
  const dir = (direction || '').toLowerCase();
  if (dir === 'higher-better') return frac;
  if (dir === 'lower-better') return 1 - frac;
  return 1 - frac; // default higher-worse
}

/* ---------- color helpers for bars ---------- */
const valueToBarColor = (v01) => {
  const x = clamp01(v01 ?? 0);
  if (x < 0.4) return '#ef4444';   // red-500 (schwach)
  if (x < 0.6) return '#3b82f6';   // blue-500 (neutral)
  return '#10b981';                // emerald-500 (gut)
};

// B) Phenotype delta in years (bad biomarkers -> older; good -> younger)
function phenoDeltaYears(biomarker, chronoAge) {
  if (!biomarker?.components?.length) return 0;

  // weights mirror evidence strength (same idea used in biomarker scoring)
  const W = { Blutdruck: 2.0, LDL: 1.8, 'Nüchternglukose': 1.5, HbA1c: 2.0, Triglyceride: 1.0, BMI: 1.2, HDL: 0.5 };

  // 0..1 shortfall (0 = perfect, 1 = terrible), weighted by importance
  let bad = 0, wsum = 0;
  for (const c of biomarker.components) {
    const w = W[c.key] ?? 1;
    bad  += (1 - Math.max(0, Math.min(1, c.score))) * w;
    wsum += w;
  }
  const shortfall = wsum ? bad / wsum : 0; // 0..1

  // Nonlinear transform: emphasize very poor control
  const gamma = 1.3;
  const imbalance = Math.pow(shortfall, gamma) - Math.pow(1 - shortfall, gamma); // [-1, +1]

  // Age-based cap (yrs): smaller swings at older ages
  const cap = chronoAge >= 60 ? 4 : chronoAge >= 50 ? 6 : 8;

  // Red-flag bumps for very low component scores
  let bump = 0;
  const byKey = Object.fromEntries(biomarker.components.map(c => [c.key, c.score]));
  if ((byKey['HbA1c'] ?? 1) < 0.30) bump += 1.5;
  if ((byKey['Blutdruck'] ?? 1) < 0.30) bump += 1.0;
  if ((byKey['LDL'] ?? 1) < 0.30) bump += 1.0;

  // Map imbalance [-1,1] -> years [-cap, +cap], add bumps, clamp, round for display
  const raw = cap * imbalance + bump;           // + = older, - = younger
  const delta = Math.max(Math.min(raw, cap), -cap);

  return Math.round(delta); // integer years
}

/* ---------- UI bits ---------- */
const Bar = ({ value01 }) => (
  <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
    <div
      className="h-full transition-all"
      style={{
        width: `${toPct(value01)}%`,
        backgroundColor: valueToBarColor(value01),
      }}
    />
  </div>
);

/* ---------- PRS risk-led weights & scaling ---------- */
// EFO -> weight, reflect independent contribution to cardiometabolic outcomes
const EFO_RISK_WEIGHTS = {
  "EFO_0001645": 1.5, // CAD
  "EFO_0006335": 1.2, // SBP
  "EFO_0006336": 1.0, // DBP
  "EFO_0004611": 1.0, // LDL
  "EFO_0004541": 0.8, // HbA1c/glucose
  "EFO_0004574": 0.7, // Total-C
  "EFO_0004530": 0.6, // Triglycerides
  "EFO_0004458": 0.5, // CRP
  "EFO_0004612": 0.4, // HDL (inverse risk, but z already encodes direction)
};

// Convert weighted z-score into years (uncapped here)
const PRS_TO_YEARS_SCALE = 0.2; // conservative; tune via cohort calibration
const PRS_YEARS_CAP = 3;        // legacy flat cap used only in text (we now cap by age)

/* ---------- biomarker scoring ---------- */
function computeBiomarkerGoodness01(bm) {
  // Accept either {biomarkers:{...}} or flat {...}
  const root = bm?.biomarkers ?? bm ?? {};
  const vitals = get(root, 'vitals', {});
  const blood  = get(root, 'bloodTests', {});
  const other  = get(root, 'other', {});

  // derive sex from either the top-level object or inside root/person
  const sexStr = ((bm?.gender || bm?.person?.gender || root?.gender || root?.person?.gender) || '').toLowerCase();

  // --- helpers ---
  const coerce = (x) => {
    const v = (x && typeof x === 'object' && 'value' in x) ? x.value : x;
    if (v == null) return null;
    const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const lerp = (x0, y0, x1, y1, x) => {
    if (x <= x0) return y0;
    if (x >= x1) return y1;
    const t = (x - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  };
  const pw = (x, points) => {
    if (x == null) return null;
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i], [x1, y1] = points[i + 1];
      if (x >= x0 && x <= x1) return clamp01(lerp(x0, y0, x1, y1, x));
    }
    const first = points[0], last = points[points.length - 1];
    return clamp01(x < first[0] ? first[1] : last[1]);
  };

  // --- extract & coerce ---
  const sbp = coerce(get(vitals, 'bloodPressure.systolic'));
  const dbp = coerce(get(vitals, 'bloodPressure.diastolic'));
  const bmi = coerce(get(other, 'bmi.value')) ?? coerce(get(other, 'bmi'));
  const hdl = coerce(get(blood, 'hdlCholesterol.value')) ?? coerce(get(blood, 'hdlCholesterol'));
  const ldl = coerce(get(blood, 'ldlCholesterol.value')) ?? coerce(get(blood, 'ldlCholesterol'));
  const tg  = coerce(get(blood, 'triglycerides.value')) ?? coerce(get(blood, 'triglycerides'));
  const glu = coerce(get(blood, 'fastingGlucose.value')) ?? coerce(get(blood, 'fastingGlucose'));
  const a1c = coerce(get(blood, 'hba1c.value')) ?? coerce(get(blood, 'hba1c'));

  const components = [];

  // Blood pressure
  if (sbp != null && dbp != null) {
    const sbpScore = pw(sbp, [
      [80, 0.25], [90, 0.5], [110, 1.0], [120, 0.9], [130, 0.7], [140, 0.4], [160, 0.15], [200, 0.05]
    ]);
    const dbpScore = pw(dbp, [
      [50, 0.25], [60, 0.6], [70, 1.0], [80, 0.7], [90, 0.4], [100, 0.15], [120, 0.05]
    ]);
    const bpScore = clamp01(0.6 * sbpScore + 0.4 * dbpScore);
    components.push({ key: 'Blutdruck', score: bpScore, weight: 2.0 });
  }

  // BMI
  if (bmi != null) {
    const bmiScore = pw(bmi, [
      [16, 0.2], [18, 0.6], [20, 0.9], [22, 1.0], [25, 1.0], [27, 0.85], [30, 0.6],
      [35, 0.25], [40, 0.1], [50, 0.05]
    ]);
    components.push({ key: 'BMI', score: bmiScore, weight: 1.2 });
  }

  // LDL
  if (ldl != null) {
    const ldlScore = pw(ldl, [
      [50, 1.0], [70, 1.0], [100, 0.9], [130, 0.7], [160, 0.4], [190, 0.15], [250, 0.05]
    ]);
    components.push({ key: 'LDL', score: ldlScore, weight: 1.8 });
  }

  // Triglycerides
  if (tg != null) {
    const tgScore = pw(tg, [
      [70, 1.0], [150, 0.7], [200, 0.4], [500, 0.05]
    ]);
    components.push({ key: 'Triglyceride', score: tgScore, weight: 1.0 });
  }

  // HDL (sex-aware thresholds)
  if (hdl != null) {
    const lowThr = sexStr === 'female' ? 50 : 40;
    const opt    = sexStr === 'female' ? 65 : 55;
    const hdlScore = hdl <= lowThr
      ? pw(hdl, [[20, 0.05], [lowThr, 0.7]])
      : pw(hdl, [[lowThr, 0.7], [opt, 1.0], [90, 1.0]]);
    components.push({ key: 'HDL', score: hdlScore, weight: 0.5 });
  }

  // Fasting glucose
  if (glu != null) {
    const gluScore = (glu >= 70 && glu <= 99)
      ? 1.0
      : pw(glu, [[100, 0.8], [110, 0.7], [125, 0.6], [140, 0.35], [200, 0.05]]);
    components.push({ key: 'Nüchternglukose', score: gluScore, weight: 1.5 });
  }

  // HbA1c
  if (a1c != null) {
    const a1cScore = a1c < 5.7
      ? 1.0
      : pw(a1c, [[5.7, 0.85], [6.0, 0.7], [6.4, 0.55], [7.0, 0.35], [8.0, 0.2], [9.0, 0.1], [10.5, 0.05]]);
    components.push({ key: 'HbA1c', score: a1cScore, weight: 2.0 });
  }

  // Weighted overall
  const present = components.filter(c => c.score != null);
  const wSum = present.reduce((a, c) => a + (c.weight || 1), 0) || 1;
  const overall = clamp01(present.reduce((a, c) => a + (c.score * (c.weight || 1)), 0) / wSum);

  return { overall, components: present };
}

/* ---------- Biological age helpers ---------- */
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

const AgeCompareBar = ({ chrono, bio }) => {
  if (chrono == null || bio == null) return null;

  const pad = 2;
  const lo = Math.min(chrono, bio) - pad;
  const hi = Math.max(chrono, bio) + pad;
  const range = Math.max(hi - lo, 1); // avoid divide-by-zero
  const pct = (v) => `${((v - lo) / range) * 100}%`;

  const bioColor = bio <= chrono ? '#10b981' : '#ef4444';

  return (
    <div className="mt-3">
      <div className="text-xs text-gray-600 mb-1">Alter (Jahre)</div>
      <div className="relative w-full h-3 rounded bg-gray-200">
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-gray-700"
          style={{ left: pct(chrono) }}
          title={`Chronologisch: ${chrono}`}
        />
        <div
          className="absolute top-0 bottom-0 w-[2px]"
          style={{ left: pct(bio), backgroundColor: bioColor }}
          title={`Biologisch: ${bio}`}
        />
      </div>
      <div className="flex justify-between text-xs mt-1 text-gray-600">
        <span>{Math.floor(lo)}</span>
        <span>{Math.ceil(hi)}</span>
      </div>
    </div>
  );
};

/* ---------- Vascular aging SVG plot ---------- */
const VascularAgingPlot = ({ bioAge, chronoAge }) => {
  if (bioAge == null || chronoAge == null) return null;

  const maxVal = Math.max(100, bioAge, chronoAge) + 5;

  // Layout: leave a fixed column on the right for the legend
  const size   = { w: 520, h: 360, pad: 40, legendW: 188, legendH: 104, legendGap: 12 };
  const plot   = {
    left:  size.pad,
    right: size.w - size.pad - size.legendW - size.legendGap,
    top:   size.pad,
    bottom:size.h - size.pad
  };

  const plotW = plot.right - plot.left;
  const plotH = plot.bottom - plot.top;

  const xScale = (v) => plot.left  + (v / maxVal) * plotW;
  const yScale = (v) => plot.bottom - (v / maxVal) * plotH;
  const linePath = (m) => `M ${xScale(0)} ${yScale(0)} L ${xScale(maxVal)} ${yScale(m * maxVal)}`;

  const delta = chronoAge - bioAge;
  let label = 'Normal aging';
  if (delta > 2) label = 'Delayed vascular aging';
  else if (delta < -2) label = 'Premature vascular aging';

  // Violin band params
  const BAND_HALFWIDTH_YEARS = 7;
  const SHAPE_EXP = 1.1;
  const widthAt = (t) => BAND_HALFWIDTH_YEARS * Math.pow(Math.sin(Math.PI * t), SHAPE_EXP);

  const N = 80;
  const upperPts = [], lowerPts = [];
  for (let i = 0; i <= N; i++) {
    const t  = i / N;
    const x  = t * maxVal;
    const w  = widthAt(t);
    upperPts.push([xScale(x), yScale(x + w)]);
    lowerPts.push([xScale(x), yScale(x - w)]);
  }
  const toPath = (pts) => pts.map(([X,Y],i)=> (i?`L ${X} ${Y}`:`M ${X} ${Y}`)).join(' ');
  const fillPath = [
    toPath(upperPts),
    ...lowerPts.slice().reverse().map(([X,Y])=>`L ${X} ${Y}`),
    'Z'
  ].join(' ');

  // Legend position (to the right of the plot)
  const legend = {
    x: plot.right + size.legendGap,
    y: size.pad,
    w: size.legendW,
    h: size.legendH,
    lh: 22, left: 14, right: 54
  };

    const xCenter = (plot.left + plot.right) / 2;
    const yCenter = (plot.top + plot.bottom) / 2;


  // Point + smart label placement
  const px = xScale(bioAge), py = yScale(chronoAge);
  const placeLeft = px > plot.left + plotW * 0.65;  // if near the right, place label to the left
  const pointText = `(${bioAge}, ${chronoAge})`;
  const textW = pointText.length * 6.6 + 8; // rough width
  const tx = px + (placeLeft ? -10 : 10);
  const ty = py - 10;

  // Build 5-year ticks (skip 0 to avoid doubling the axes)
    const GRID_STEP = 5;
    const ticks = [];
    for (let v = GRID_STEP; v < maxVal; v += GRID_STEP) ticks.push(v);


    // 10-year tick values, including 0
    const TICK_STEP = 10;
    const maxTick = Math.floor(maxVal / TICK_STEP) * TICK_STEP;
    const labelTicks = Array.from({ length: maxTick / TICK_STEP + 1 }, (_, i) => i * TICK_STEP);


  return (
    <svg viewBox={`0 0 ${size.w} ${size.h}`} className="w-full h-72">
      {/* Clip the drawing so it never goes under the legend */}
      <defs>
        <clipPath id="plotArea">
          <rect x={plot.left} y={plot.top} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {/* Axes */}
      <line x1={plot.left} y1={plot.bottom} x2={plot.left} y2={plot.top} stroke="currentColor" strokeWidth="1.5" />
      <line x1={plot.left} y1={plot.bottom} x2={plot.right} y2={plot.bottom} stroke="currentColor" strokeWidth="1.5" />

      {/* --- Dashed grid, clipped to plot area and behind everything else --- */}
        <g clipPath="url(#plotArea)">
        {/* Vertical grid lines */}
        {ticks.map((v) => (
            <line
            key={`gx-${v}`}
            x1={xScale(v)}
            y1={plot.top}
            x2={xScale(v)}
            y2={plot.bottom}
            stroke="#9ca3af"            // gray-400
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.35"
            />
        ))}
        {/* Horizontal grid lines */}
        {ticks.map((v) => (
            <line
            key={`gy-${v}`}
            x1={plot.left}
            y1={yScale(v)}
            x2={plot.right}
            y2={yScale(v)}
            stroke="#9ca3af"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.35"
            />
        ))}
        </g>

        {/* X-axis ticks + labels (every 10y) */}
        {labelTicks.map((v) => (
        <g key={`xt-${v}`}>
            <line
            x1={xScale(v)} y1={plot.bottom}
            x2={xScale(v)} y2={plot.bottom + 6}
            stroke="#111827" strokeWidth="1"
            />
            <text
            x={xScale(v)} y={plot.bottom + 18}
            fontSize="11" textAnchor="middle" fill="#374151"
            >
            {v}
            </text>
        </g>
        ))}

        {/* Y-axis ticks + labels (every 10y) */}
        {labelTicks.map((v) => (
        <g key={`yt-${v}`}>
            <line
            x1={plot.left} y1={yScale(v)}
            x2={plot.left - 6} y2={yScale(v)}
            stroke="#111827" strokeWidth="1"
            />
            <text
            x={plot.left - 10} y={yScale(v) + 4}
            fontSize="11" textAnchor="end" fill="#374151"
            >
            {v}
            </text>
        </g>
        ))}

      {/* Main plotting area */}
      <g clipPath="url(#plotArea)">
        {/* Violin fill and outlines */}
        <path d={fillPath} fill="#6366F1" opacity="0.08" />
        <path d={toPath(upperPts)} stroke="#6366F1" strokeWidth="1.5" fill="none" />
        <path d={toPath(lowerPts)} stroke="#6366F1" strokeWidth="1.5" fill="none" />

        {/* Reference lines */}
        <path d={linePath(1)}   stroke="currentColor" strokeWidth="1"   fill="none" />
        <path d={linePath(1.3)} stroke="currentColor" strokeWidth="1"   fill="none" strokeDasharray="6 6" opacity="0.45" />
        <path d={linePath(0.7)} stroke="currentColor" strokeWidth="1"   fill="none" strokeDasharray="6 6" opacity="0.45" />
      </g>

      {/* Patient point (red) + readable label with white halo */}
      <circle cx={px} cy={py} r="5" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />
      <rect x={placeLeft ? tx - textW : tx} y={ty - 12} width={textW} height={18} rx="4" fill="#ffffff" opacity="0.9" />
      <text x={tx} y={ty + 2} fontSize="12" textAnchor={placeLeft ? 'end' : 'start'} fill="#111827">
        {pointText}
      </text>

      {/* Axis labels (kept away from plot corners) */}
      <text
            x={xCenter}
            y={plot.bottom + 36}    // was +24
            textAnchor="middle"
            fontSize="12"
            fill="#111827"
            >
            Biological Age
        </text>

        <text
            x={plot.left - 44}      // room left of tick numbers
            y={yCenter}
            textAnchor="middle"
            fontSize="12"
            fill="#111827"
            transform={`rotate(-90 ${plot.left - 30} ${yCenter})`}
            >
            Chronological Age
        </text>

      {/* Legend box (outside plot) */}
      <g>
        <rect x={legend.x} y={legend.y} width={legend.w} height={legend.h} rx="8" fill="#ffffff" stroke="#e5e7eb" />
        {/* Normal */}
        <line x1={legend.x + legend.left} y1={legend.y + 24} x2={legend.x + legend.right} y2={legend.y + 24}
              stroke="#111827" strokeWidth="2" />
        <text x={legend.x + legend.right + 8} y={legend.y + 28} fontSize="12" fill="#111827">Normal (y = x)</text>
        {/* Delayed */}
        <line x1={legend.x + legend.left} y1={legend.y + 24 + legend.lh} x2={legend.x + legend.right} y2={legend.y + 24 + legend.lh}
              stroke="#111827" strokeWidth="2" strokeDasharray="6 6" />
        <text x={legend.x + legend.right + 8} y={legend.y + 28 + legend.lh} fontSize="12" fill="#111827">Delayed</text>
        {/* Premature */}
        <line x1={legend.x + legend.left} y1={legend.y + 24 + 2*legend.lh} x2={legend.x + legend.right} y2={legend.y + 24 + 2*legend.lh}
              stroke="#111827" strokeWidth="2" strokeDasharray="6 6" />
        <text x={legend.x + legend.right + 8} y={legend.y + 28 + 2*legend.lh} fontSize="12" fill="#111827">Premature</text>
        {/* Violin sample */}
        <path d={`M ${legend.x + legend.left} ${legend.y + 24 + 3*legend.lh}
                  C ${legend.x + 28} ${legend.y + 24 + 3*legend.lh - 6},
                    ${legend.x + 40} ${legend.y + 24 + 3*legend.lh - 6},
                    ${legend.x + legend.right} ${legend.y + 24 + 3*legend.lh}`}
              stroke="#6366F1" strokeWidth="1.5" fill="none" />
        <path d={`M ${legend.x + legend.left} ${legend.y + 24 + 3*legend.lh}
                  C ${legend.x + 28} ${legend.y + 24 + 3*legend.lh + 6},
                    ${legend.x + 40} ${legend.y + 24 + 3*legend.lh + 6},
                    ${legend.x + legend.right} ${legend.y + 24 + 3*legend.lh}`}
              stroke="#6366F1" strokeWidth="1.5" fill="none" />
        <text x={legend.x + legend.right + 8} y={legend.y + 28 + 3*legend.lh} fontSize="12" fill="#111827">
          Typical spread
        </text>
      </g>

      {/* Status label */}
      <text x={size.w - 12} y={size.h - 10} textAnchor="end" fontSize="12" className="fill-current">
        {label}
      </text>
    </svg>
  );
};



/* ---------- weights for overall index ---------- */
const OVERALL_WEIGHTS = { genetic: 0.6, biomarker: 0.4 };

export default function LongevityPage() {
  const router = useRouter();
  const genomeName = (router.query.genome || router.query.genomeName || '') + '';

  const [loading, setLoading] = useState(true);

  // data
  const [biomarkers, setBiomarkers] = useState(null);
  const [availableByEfo, setAvailableByEfo] = useState({}); // {EFO_...: avgPercentile}
  const [pgsConfig, setPgsConfig] = useState([]);           // from /longevity_pgs.json

  /* load configuration of longevity PGS (labels, efo, weight, direction) */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/longevity_pgs.json', { cache: 'no-store' });
        const j = r.ok ? await r.json() : [];
        setPgsConfig(Array.isArray(j) ? j : []);
      } catch {
        setPgsConfig([]);
      }
    })();
  }, []);

  const [meanZByEfo, setMeanZByEfo] = useState({}); // {EFO_...: mean zScore}

  /* load details CSV to compute per-EFO mean percentile + mean zScore */
  useEffect(() => {
    if (!router.isReady || !genomeName) return;
    const detPath = `/results/${encodeURIComponent(genomeName)}/batch_details_cardio.csv`;
    (async () => {
      try {
        const csv = await fetch(detPath, { cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        });
        const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });

        const binsPct = new Map(); // efo -> number[]
        const binsZ   = new Map(); // efo -> number[]

        for (const row of data) {
          const efo = String(pick(row, ['efoId','EFO-ID','EFO ID','EFO']) || '').trim();
          if (!efo) continue;

          let z = num(pick(row, ['zScore','z','Z-Score']));
          if (Number.isFinite(z)) {
            if (!binsZ.has(efo)) binsZ.set(efo, []);
            binsZ.get(efo).push(z);
          }

          let pct = num(pick(row, ['percentile','Percentile']));
          if (!Number.isFinite(pct) && Number.isFinite(z)) {
            pct = clampPct(cdf(z) * 100);
          }
          if (Number.isFinite(pct)) {
            if (!binsPct.has(efo)) binsPct.set(efo, []);
            binsPct.get(efo).push(pct);
          }
        }

        const outPct = {};
        for (const [efo, arr] of binsPct.entries()) outPct[efo] = arr.reduce((a,b)=>a+b,0)/arr.length;
        setAvailableByEfo(outPct);

        // Save mean z-score per EFO for PRS age adjustment
        const outZ = {};
        for (const [efo, arr] of binsZ.entries()) outZ[efo] = arr.reduce((a,b)=>a+b,0)/arr.length;
        setMeanZByEfo(outZ);
      } catch (e) {
        console.error('Longevity: details load failed', e);
        setAvailableByEfo({});
        setMeanZByEfo({});
      }
    })();
  }, [router.isReady, genomeName]);

  /* load biomarkers.json */
  useEffect(() => {
    if (!router.isReady || !genomeName) return;
    (async () => {
      setLoading(true);
      const bmUrl = `/results/${encodeURIComponent(genomeName)}/biomarkers.json`;
      try {
        const r = await fetch(bmUrl, { cache: 'no-store' });
        if (!r.ok) {
          console.error('biomarkers.json load failed', { bmUrl, status: r.status });
          setBiomarkers(null);
          return;
        }
        const txt = await r.text();
        let j = null;
        try {
          j = JSON.parse(txt);
        } catch (e) {
          console.error('biomarkers.json parse error', { bmUrl, snippet: txt.slice(0, 200), error: e });
          setBiomarkers(null);
          return;
        }
        setBiomarkers(j);
      } catch (err) {
        console.error('biomarkers.json fetch error', err);
        setBiomarkers(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, genomeName]);

  /* match configured EFOs to what we actually have */
  const matchedPgs = useMemo(
    () => pgsConfig.filter((c) => availableByEfo[c.efo] != null),
    [pgsConfig, availableByEfo]
  );

  /* compute genetic subscore (0..1) from availableByEfo + config */
  const genetic = useMemo(() => {
    if (!matchedPgs.length) return { overall: 0, components: [] };
    const parts = matchedPgs.map((c) => {
      const pct = availableByEfo[c.efo]; // 0..100 percentile
      const score = percentileToGoodness01(pct, c.direction); // 0..1 goodness
      const w = Number.isFinite(c.weight) ? Math.abs(c.weight) : 1;
      return { ...c, percentile: pct, score, weight: w };
    }).filter(p => p.score != null);

    const wsum = parts.reduce((a,b) => a + (b.weight || 1), 0) || 1;
    const overall = parts.reduce((a,b) => a + (b.score * (b.weight || 1)) / wsum, 0);
    return { overall, components: parts };
  }, [matchedPgs, availableByEfo]);

  /* genomic PRS adjustment in years from mean z by EFO (uncapped here) */
  const genomicAdj = useMemo(() => {
    const entries = Object.entries(meanZByEfo || {});
    if (!entries.length) return { rawYears: 0, totalWeightedZ: 0, components: [] };

    const components = entries.map(([efo, zMean]) => {
      const weight = Math.abs(EFO_RISK_WEIGHTS[efo] ?? 0);
      return {
        efo,
        zMean,
        weight,
        weightedZ: zMean * weight,
        contributionYears: zMean * weight * PRS_TO_YEARS_SCALE,
      };
    });

    const totalWeightedZ = components.reduce((a, b) => a + b.weightedZ, 0);
    const rawYears = totalWeightedZ * PRS_TO_YEARS_SCALE; // uncapped

    return { rawYears, totalWeightedZ, components };
  }, [meanZByEfo]);

  /* compute biomarker subscore (0..1) from biomarkers.json only */
  const biomarker = useMemo(() => {
    if (!biomarkers) return { overall: 0, components: [] };
    return computeBiomarkerGoodness01(biomarkers);
  }, [biomarkers]);

  /* guideline-ish ranges for labels (display only) */
  const sex = ((biomarkers?.gender || biomarkers?.person?.gender) || '').toLowerCase();
  const RANGE_HINTS = useMemo(() => ({
    'Blutdruck': '≈110–120/70–80 mmHg',
    'BMI': '20–25 kg/m²',
    'LDL': '<100 mg/dL (optimal <70)',
    'Triglyceride': '<150 mg/dL',
    'HDL': sex === 'female' ? '≥50 mg/dL' : '≥40 mg/dL',
    'Nüchternglukose': '70–99 mg/dL',
    'HbA1c': '<5.7%'
  }), [sex]);

  /* actual measured values (display only) */
  const ACTUALS = useMemo(() => {
    const root = biomarkers?.biomarkers ?? biomarkers ?? {};
    const v = root.vitals || {};
    const b = root.bloodTests || {};
    const o = root.other || {};

    const toNum = (x) =>
      x && typeof x === 'object' && 'value' in x ? Number(x.value) : Number(x);
    const pickValUnit = (x, defUnit = '') => {
      if (x && typeof x === 'object') return { val: toNum(x.value), unit: x.unit || defUnit };
      return { val: toNum(x), unit: defUnit };
    };
    const fmt = (val, unit, digits = 0) =>
      val == null || Number.isNaN(val)
        ? null
        : `${digits ? val.toFixed(digits) : Math.round(val)}${unit ? ` ${unit}` : ''}`;

    const out = {};

    // Blutdruck
    const sbp = toNum(v?.bloodPressure?.systolic);
    const dbp = toNum(v?.bloodPressure?.diastolic);
    const bpUnit = v?.bloodPressure?.unit || 'mmHg';
    if (Number.isFinite(sbp) && Number.isFinite(dbp)) {
      out['Blutdruck'] = `${Math.round(sbp)}/${Math.round(dbp)} ${bpUnit}`;
    }

    // BMI
    const { val: bmiVal, unit: bmiUnit } =
      o?.bmi && typeof o.bmi === 'object' && 'value' in o.bmi
        ? { val: toNum(o.bmi.value), unit: o.bmi.unit || 'kg/m²' }
        : pickValUnit(o?.bmi, 'kg/m²');
    if (Number.isFinite(bmiVal)) out['BMI'] = fmt(bmiVal, bmiUnit || 'kg/m²', 1);

    // Lipids
    const { val: ldlVal, unit: ldlUnit } = pickValUnit(b?.ldlCholesterol, 'mg/dL');
    if (Number.isFinite(ldlVal)) out['LDL'] = fmt(ldlVal, ldlUnit || 'mg/dL');

    const { val: tgVal, unit: tgUnit } = pickValUnit(b?.triglycerides, 'mg/dL');
    if (Number.isFinite(tgVal)) out['Triglyceride'] = fmt(tgVal, tgUnit || 'mg/dL');

    const { val: hdlVal, unit: hdlUnit } = pickValUnit(b?.hdlCholesterol, 'mg/dL');
    if (Number.isFinite(hdlVal)) out['HDL'] = fmt(hdlVal, hdlUnit || 'mg/dL');

    // Glycemia
    const { val: gluVal, unit: gluUnit } = pickValUnit(b?.fastingGlucose, 'mg/dL');
    if (Number.isFinite(gluVal)) out['Nüchternglukose'] = fmt(gluVal, gluUnit || 'mg/dL');

    const { val: a1cVal, unit: a1cUnit } = pickValUnit(b?.hba1c, '%');
    if (Number.isFinite(a1cVal)) out['HbA1c'] = fmt(a1cVal, a1cUnit || '%', 1);

    return out;
  }, [biomarkers]);

  /* overall index */
  const longevityIndex01 = useMemo(() => {
    const wG = Math.abs(OVERALL_WEIGHTS.genetic || 0.5);
    const wB = Math.abs(OVERALL_WEIGHTS.biomarker || 0.5);
    const Z = wG + wB || 1;
    return clamp01((wG * genetic.overall + wB * biomarker.overall) / Z);
  }, [genetic.overall, biomarker.overall]);

  /* biological vs chronological age */
  const { chronoAge, bioAge, bioDelta, prsDelta, parts } = useMemo(() => {
    if (!biomarkers) return { chronoAge: null, bioAge: null, bioDelta: null, prsDelta: 0, parts: null };

    const dob = biomarkers?.dateOfBirth || biomarkers?.person?.dateOfBirth;
    const refDate = biomarkers?.dateRecorded || biomarkers?.biomarkers?.dateRecorded;
    const cAge = calcAge(dob, refDate);
    if (cAge == null) return { chronoAge: null, bioAge: null, bioDelta: null, prsDelta: 0, parts: null };

    // phenotypic delta (nonlinear, age-capped)
    const phenoDelta = phenoDeltaYears(biomarker, cAge);

    // PRS with age-based cap
    const cap = prsCapByAge(cAge);              // 3 (<50), 2 (50–59), 1.5 (≥60)
    const prsRaw = genomicAdj?.rawYears ?? 0;   // from genomicAdj useMemo
    const prsDelta = Math.max(Math.min(prsRaw, cap), -cap);

    const bAge   = Math.round((cAge + phenoDelta + prsDelta) * 10) / 10;
    const bDelta = Math.round((phenoDelta + prsDelta) * 10) / 10;

    return {
      chronoAge: cAge,
      bioAge: bAge,
      bioDelta: bDelta,
      prsDelta,
      parts: { phenoDelta, prsDelta }
    };
  }, [biomarkers, biomarker.overall, genomicAdj?.rawYears]);

  // PRS display number (same cap logic; safe standalone memo)
  const prsDeltaDisplay = useMemo(() => {
    const dob = biomarkers?.dateOfBirth || biomarkers?.person?.dateOfBirth;
    const ref = biomarkers?.dateRecorded || biomarkers?.biomarkers?.dateRecorded;
    const age = calcAge(dob, ref) ?? 50;
    const cap = prsCapByAge(age);
    const raw = genomicAdj?.rawYears ?? 0;
    const capped = Math.max(Math.min(raw, cap), -cap);
    return Math.round(capped * 10) / 10;
  }, [biomarkers, genomicAdj?.rawYears]);

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

      {/* Age + Vascular panels in one row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 items-stretch">
        {/* Longevity Index */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold">Longevity Index</h3>
            <div className="text-sm text-gray-500">
              Genetik {toPct(genetic.overall)} · Biomarker {toPct(biomarker.overall)}
            </div>
          </div>
          <div className="text-5xl font-extrabold mb-2">{toPct(longevityIndex01)}</div>
          <Bar value01={longevityIndex01} />
          <div className="mt-3 text-xs text-gray-600">
            *0–100 Skala (höher ist besser). Nicht-diagnostisch; zu Demonstrationszwecken.
          </div>
        </div>

        {/* Biological vs Chronological Age */}
        <div className="bg-white p-5 rounded-lg shadow h-full flex flex-col">
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
              {parts && (
                <div className="mt-2 text-xs text-gray-600">
                  Aufteilung: Phenotyp {parts.phenoDelta >= 0 ? '+' : ''}{parts.phenoDelta}y · Genomik {parts.prsDelta >= 0 ? '+' : ''}{parts.prsDelta}y
                </div>
              )}
              <AgeCompareBar chrono={chronoAge} bio={bioAge} />
              <div className="mt-3 text-xs text-gray-600">
                Biologisches Alter = Chronologisches Alter + Phenotyp-Delta (altersabhängig, max ±{PHENO_YEARS_MAX}y) + PRS-Delta (altersabhängig, max ±{prsCapByAge(chronoAge ?? 50)}y).
              </div>
            </>
          )}
        </div>

        {/* Vascular Aging View */}
        <div className="bg-white p-5 rounded-lg shadow h-full flex flex-col">
          <h3 className="text-lg font-semibold mb-2">Vascular Aging View</h3>
          <VascularAgingPlot bioAge={bioAge} chronoAge={chronoAge} />
        </div>
      </div>

      {/* Top row: Longevity Index · Genetic · PRS Adj · Biomarker */}
      <div className="grid grid-cols-1 md-grid-cols-2 lg:grid-cols-3 gap-4 mb-6 items-stretch">

        {/* Genetic components */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <h3 className="text-lg font-semibold mb-2">Genetischer Beitrag</h3>
          {genetic.components.length === 0 ? (
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
              <div className="text-3xl font-bold mb-2">{toPct(genetic.overall)}</div>
              <ul className="space-y-2 text-sm">
                {genetic.components.map((c) => (
                  <li key={c.efo}>
                    <div className="flex items-center justify-between">
                      <div>
                        {c.label} <span className="text-gray-500">({c.efo})</span>
                        <span className="text-gray-500"> · {c.direction || 'higher-worse'}</span>
                        <span className="text-gray-500"> · {c.percentile.toFixed(1)}%</span>
                      </div>
                      <div className="font-mono">{toPct(c.score)}</div>
                    </div>
                    <Bar value01={c.score} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Genomic PRS Adjustment (years) */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <h3 className="text-lg font-semibold mb-2">Genomische PRS-Korrektur (Jahre)</h3>
          <div className="text-3xl font-bold mb-2">
            {prsDeltaDisplay > 0 ? `+${prsDeltaDisplay}` : prsDeltaDisplay} Jahre
          </div>
          {genomicAdj.components.length ? (
            <ul className="space-y-2 text-sm max-h-56 overflow-auto pr-1">
              {genomicAdj.components
                .filter(c => c.weight > 0)
                .sort((a,b)=>Math.abs(b.contributionYears)-Math.abs(a.contributionYears))
                .map((c) => (
                  <li key={c.efo}>
                    <div className="flex items-center justify-between">
                      <div className="text-gray-700">
                        {c.efo} <span className="text-gray-500">· z̄={c.zMean.toFixed(2)} · w={c.weight}</span>
                      </div>
                      <div className={`font-mono ${c.contributionYears<0?'text-emerald-600':'text-rose-600'}`}>
                        {c.contributionYears>=0?'+':''}{c.contributionYears.toFixed(2)}y
                      </div>
                    </div>
                    <Bar value01={clamp01(0.5 + Math.tanh(c.zMean)/2)} />
                  </li>
                ))}
            </ul>
          ) : (
            <div className="text-gray-500 text-sm">Keine PRS-Werte gefunden.</div>
          )}
          <div className="mt-3 text-xs text-gray-600">
            Methode: gewichteter Mittelwert der z-Scores pro EFO → Jahre (Skalierung {PRS_TO_YEARS_SCALE}, Kappung altersabhängig bis ±{prsCapByAge(chronoAge ?? 50)}y).
          </div>
        </div>

        {/* Biomarker components */}
        <div className="bg-white p-5 rounded-lg shadow h-full">
          <h3 className="text-lg font-semibold mb-3">Biomarker-Beitrag</h3>
          {biomarker.components.length ? (
            <ul className="space-y-2">
              {biomarker.components.map((c, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      {c.key}{' '}
                      <span className="text-gray-500">({RANGE_HINTS[c.key] || '—'})</span>
                      {ACTUALS[c.key] && (
                        <span className="ml-2 text-gray-400 font-mono">· {ACTUALS[c.key]}</span>
                      )}
                    </div>
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

      {/* ROI suggestions */}
      <div className="bg-white p-5 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-3">Top-Hebel (geschätzt)</h3>
        <ul className="space-y-2 text-sm">
          {(() => {
            const all = [...biomarker.components].sort((a, b) => a.score - b.score);
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
