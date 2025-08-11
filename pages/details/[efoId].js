'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import DashboardLayout from '../../components/DashboardLayout';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

/* ---------- Risk UI helpers ---------- */
function riskMeta(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) {
    return {
      tone: 'na',
      rowCls: '',
      badgeCls: 'bg-gray-100 text-gray-700 border border-gray-200',
      label: '—',
    };
  }
  if (v < 20) {
    return {
      tone: 'low',
      rowCls: 'bg-emerald-50 border-l-4 border-emerald-400',
      badgeCls: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      label: 'Unterdurchschnittlich (<20%)',
    };
  }
  if (v <= 80) {
    return {
      tone: 'avg',
      rowCls: 'bg-gray-50 border-l-4 border-gray-300',
      badgeCls: 'bg-gray-100 text-gray-800 border border-gray-200',
      label: 'Durchschnittlich (20–80%)',
    };
  }
  if (v <= 95) {
    return {
      tone: 'high',
      rowCls: 'bg-amber-50 border-l-4 border-amber-400',
      badgeCls: 'bg-amber-100 text-amber-800 border border-amber-200',
      label: 'Erhöht (80–95%)',
    };
  }
  return {
    tone: 'very-high',
    rowCls: 'bg-rose-50 border-l-4 border-rose-400',
    badgeCls: 'bg-rose-100 text-rose-800 border border-rose-200',
    label: 'Stark erhöht (>95%)',
  };
}

function rsidFromVariant(variant, rsid) {
  if (rsid) return rsid;
  const m = String(variant || '').match(/rs\d+/i);
  return m ? m[0] : null;
}


/* ---------- Labels & links ---------- */
const PRETTY_LABELS = {
  bloodPressureSystolic: 'Systolischer Blutdruck',
  bloodPressureDiastolic: 'Diastolischer Blutdruck',
  totalCholesterol: 'Gesamtcholesterin',
  hdlCholesterol: 'HDL-Cholesterin',
  ldlCholesterol: 'LDL-Cholesterin',
  triglycerides: 'Triglyceride',
  hba1c: 'HbA1c',
  cReactiveProtein: 'C-reaktives Protein (CRP)',
  coronaryArteryDisease: 'Koronare Herzkrankheit',
  fastingGlucose: 'Nüchternglukose',
  bmi: 'BMI',
  oxygenSaturation: 'Sauerstoffsättigung',
};

const pgsLink = (id) =>
  id ? `https://www.pgscatalog.org/score/${encodeURIComponent(id)}/` : '#';

/* ---------- tiny utils ---------- */
const isNum = (v) => Number.isFinite(v);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '–');

export default function CardioDetail() {
  const router = useRouter();
  const { efoId, genome: genomeQuery, trait: traitQuery } = router.query;

  /* data state */
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* summaries state */
  const [summaries, setSummaries] = useState({});      // SNP summaries by rsid
  const [activeSummary, setActiveSummary] = useState(null); // { type:'snp', rsid, text, url, logs? }
  const [loadingRsid, setLoadingRsid] = useState({});  // per-rsid spinner

  /* biomarkers */
  const [biomarkerMapping, setBiomarkerMapping] = useState({});
  const [patientBiomarkers, setPatientBiomarkers] = useState(null);
  const [thresholds, setThresholds] = useState(null);

  /* initial loads */
  useEffect(() => {
    if (!router.isReady) return;
    if (!efoId || !genomeQuery) return;

    setLoading(true);
    setError(null);

    const detailPath = `/results/${genomeQuery}/details/${efoId}.json`;
    const biomarkerPath = `/results/${genomeQuery}/biomarkers.json`;

    Promise.all([
      fetch(detailPath).then((r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      }),
      fetch('/biomarker_efo_mapping.json').then((r) => (r.ok ? r.json() : {})),
      fetch(biomarkerPath).then((r) => (r.ok ? r.json() : null)),
      fetch('/biomarker_thresholds.json').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([detailJson, mappingJson, biomarkersJson, thresholdsJson]) => {
        const arr = Array.isArray(detailJson) ? detailJson : detailJson?.detail || [];
        const normalized = arr.map((r) => ({
          ...r,
          prs: num(r.prs ?? r.rawScore),
          rawScore: num(r.rawScore ?? r.prs),
          zScore: num(r.zScore),
          percentile: num(r.percentile),
          matches: num(r.matches),
          totalVariants: num(r.totalVariants),
        }));
        setRows(normalized);
        setBiomarkerMapping(mappingJson || {});
        setPatientBiomarkers(biomarkersJson || null);
        setThresholds(thresholdsJson || null);
      })
      .catch((err) => setError(`❌ Fehler beim Laden: ${err.message}`))
      .finally(() => setLoading(false));
  }, [router.isReady, efoId, genomeQuery]);

  /* EFO summary + anchor PGS */
  const efoSummary = useMemo(() => {
    if (!rows.length) return null;
    const trait = rows[0]?.trait || traitQuery || 'Unbekannter Trait';

    const pctVals = rows.map((r) => r.percentile).filter(isNum);
    const prsVals = rows.map((r) => r.prs).filter(isNum);

    let anchor = null;
    const withPct = rows.filter((r) => isNum(r.percentile));
    if (withPct.length) {
      anchor = withPct.reduce(
        (best, r) => (best == null || r.percentile > best.percentile ? r : best),
        null
      );
    } else {
      anchor = rows.reduce(
        (best, r) =>
          best == null || Math.abs(r.prs ?? 0) > Math.abs(best.prs ?? 0) ? r : best,
        null
      );
    }

    return {
      trait,
      count: rows.length,
      avgPct: pctVals.length ? mean(pctVals) : null,
      medPct: pctVals.length ? median(pctVals) : null,
      maxPct: pctVals.length ? Math.max(...pctVals) : null,
      minPct: pctVals.length ? Math.min(...pctVals) : null,
      avgPRS: prsVals.length ? mean(prsVals) : null,
      minPRS: prsVals.length ? Math.min(...prsVals) : null,
      maxPRS: prsVals.length ? Math.max(...prsVals) : null,
      anchor,
    };
  }, [rows, traitQuery]);

  /* prefetch summaries for anchor top SNPs (like your earlier version) */
  useEffect(() => {
    if (!efoSummary?.anchor) return;

    const top = (efoSummary.anchor.topVariants || [])
      .map(v => ({ ...v, rsid: rsidFromVariant(v.variant, v.rsid) }))
      .filter(v => v.rsid)
      .slice(0, 10);

    let cancelled = false;

    (async () => {
      for (const v of top) {
        const rsid = v.rsid;
        if (!rsid || summaries[rsid]) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
          const res = await fetch(`/api/snp-summary?rsid=${encodeURIComponent(rsid)}`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!cancelled) {
            setSummaries((prev) => ({
              ...prev,
              [rsid]: {
                text: data?.text || 'Keine Zusammenfassung verfügbar.',
                url: data?.url || null,
                logs: data?.logs || [],
              },
            }));
          }
        } catch (err) {
          clearTimeout(timeout);
          if (!cancelled) {
            setSummaries((prev) => ({
              ...prev,
              [rsid]: {
                text: 'Fehler beim Laden der Zusammenfassung.',
                url: null,
                logs: [`❌ Fehler beim Laden: ${err.message}`],
              },
            }));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [efoSummary?.anchor, summaries]);

  /* ---------- on-demand SNP summary (used in table & variant list) ---------- */
  async function fetchAndStoreSummary(rsid) {
  if (!rsid) return;
  if (loadingRsid[rsid] || summaries[rsid]) return; // 👈 prevents overlap

    setLoadingRsid(prev => ({ ...prev, [rsid]: true }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(`/api/snp-summary?rsid=${encodeURIComponent(rsid)}`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      console.log(`✅ Antwort erhalten für ${rsid}`);

      const payload = {
        text: data?.text || 'Keine Zusammenfassung verfügbar.',
        url: data?.url || null,
        logs: data?.logs || [],
      };

      setSummaries(prev => ({
        ...prev,
        [rsid]: payload,
      }));

      // Optional: open immediately in the right panel
      setActiveSummary({ type: 'snp', rsid, ...payload });
    } catch (err) {
      clearTimeout(timeout);
      console.error(`❌ Fehler bei Summary-Fetch für ${rsid}:`, err);

      const payload = {
        text: 'Fehler beim Laden der Zusammenfassung.',
        url: null,
        logs: [`❌ Fehler beim Laden: ${err.message}`],
      };

      setSummaries(prev => ({
        ...prev,
        [rsid]: payload,
      }));

      // Also reflect the error in the sidebar if user clicked
      setActiveSummary({ type: 'snp', rsid, ...payload });
    } finally {
      setLoadingRsid(prev => ({ ...prev, [rsid]: false }));
    }
  }


  /* ---------- biomarker helpers ---------- */
  const mkBadge = (tone, text) => {
    const cls =
      {
        green: 'bg-green-100 text-green-800 border-green-200',
        yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        red: 'bg-red-100 text-red-800 border-red-200',
      }[tone] || 'bg-gray-100 text-gray-800 border-gray-200';
    return { tone, badgeClass: `inline-block px-2 py-0.5 rounded border text-xs ${cls}`, note: text };
  };
  const classifyBiomarkerLocal = (key, rawValue, unit, th) => {
    const v = Number(rawValue);
    if (!th || !th[key] || !Number.isFinite(v)) return mkBadge('yellow', '—');
    for (const rule of th[key]) {
      if (rule.max === null || v <= rule.max) return mkBadge(rule.tone, rule.note);
    }
    return mkBadge('yellow', '—');
  };
  const normalize = (val) => {
    if (val == null) return null;
    if (typeof val === 'object') {
      const v = 'value' in val ? val.value : undefined;
      const u = 'unit' in val ? val.unit : '';
      if (v == null && 'systolic' in val && 'diastolic' in val) {
        return { value: `${val.systolic}/${val.diastolic}`, unit: val.unit || '' };
      }
      return v == null ? null : { value: v, unit: u };
    }
    return { value: val, unit: '' };
  };
  const findBiomarkerValue = (patientData, key) => {
    const bm = patientData?.biomarkers || {};
    if (bm.vitals && bm.vitals[key]) {
      const val = bm.vitals[key];
      if (val && typeof val === 'object' && 'systolic' in val && 'diastolic' in val) {
        return { value: `${val.systolic}/${val.diastolic}`, unit: val.unit || 'mmHg' };
      }
      return normalize(val);
    }
    if (bm.bloodTests && bm.bloodTests[key]) return normalize(bm.bloodTests[key]);
    if (bm.other && bm.other[key]) return normalize(bm.other[key]);
    if (
      (key === 'bloodPressureSystolic' || key === 'bloodPressureDiastolic') &&
      bm.vitals?.bloodPressure
    ) {
      const agg = bm.vitals.bloodPressure;
      const unit = agg.unit || 'mmHg';
      if (key === 'bloodPressureSystolic' && 'systolic' in agg) return { value: agg.systolic, unit };
      if (key === 'bloodPressureDiastolic' && 'diastolic' in agg) return { value: agg.diastolic, unit };
    }
    return null;
  };

  const relatedWithClass = useMemo(() => {
    if (!efoId || !biomarkerMapping || !patientBiomarkers) return [];
    const related = [];
    for (const [key, efoList] of Object.entries(biomarkerMapping)) {
      if (Array.isArray(efoList) && efoList.includes(efoId)) {
        const bm = findBiomarkerValue(patientBiomarkers, key);
        if (bm) {
          related.push({
            key,
            label: PRETTY_LABELS[key] || key,
            value: bm.value,
            unit: bm.unit || '',
            badge: classifyBiomarkerLocal(key, bm.value, bm.unit, thresholds),
          });
        }
      }
    }
    return related;
  }, [efoId, biomarkerMapping, patientBiomarkers, thresholds]);

  /* ---------- small biomarker card (same style as batch_ui_cardio) ---------- */
  const BiomarkerPanel = ({ biomarkers, genomeName }) => {
    const cardCls = 'bg-white border border-gray-200 rounded-lg p-4';
    if (!biomarkers) {
      return (
        <div className={`${cardCls} text-sm`}>
          <h3 className="text-lg font-semibold mb-2">Patienten-Biomarker</h3>
          <p className="text-gray-600">
            {genomeName ? (
              <>
                Keine Biomarker-Datei gefunden unter{' '}
                <code className="font-mono">/results/{genomeName}/biomarkers.json</code>.
              </>
            ) : (
              'Keine Biomarker geladen.'
            )}
          </p>
        </div>
      );
    }
    const v = biomarkers?.biomarkers?.vitals || {};
    const b = biomarkers?.biomarkers?.bloodTests || {};
    const o = biomarkers?.biomarkers?.other || {};
    const fmtBM = (obj, key, subkey = 'value', unitKey = 'unit') => {
      const it = obj?.[key];
      if (!it) return '–';
      if (typeof it === 'object' && 'systolic' in it && 'diastolic' in it) {
        return `${it.systolic}/${it.diastolic} ${it.unit || 'mmHg'}`;
      }
      const val = it?.[subkey];
      const unit = it?.[unitKey];
      return val ?? val === 0 ? `${val}${unit ? ' ' + unit : ''}` : '–';
    };
    return (
      <div className={`${cardCls} text-sm mb-6`}>
        <h3 className="text-lg font-semibold mb-3">Patienten-Biomarker</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase text-gray-500 mb-1">Vitalparameter</div>
            <ul className="space-y-1">
              <li>
                <span className="text-gray-600">Blutdruck:</span> {fmtBM(v, 'bloodPressure')}
              </li>
              <li>
                <span className="text-gray-600">Herzfrequenz:</span> {fmtBM(v, 'heartRate')}
              </li>
              <li>
                <span className="text-gray-600">Atemfrequenz:</span> {fmtBM(v, 'respiratoryRate')}
              </li>
              <li>
                <span className="text-gray-600">Körpertemperatur:</span>{' '}
                {fmtBM(v, 'bodyTemperature')}
              </li>
              <li>
                <span className="text-gray-600">Sauerstoffsättigung:</span>{' '}
                {fmtBM(o, 'oxygenSaturation')}
              </li>
              <li>
                <span className="text-gray-600">BMI:</span> {fmtBM(o, 'bmi')}
              </li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500 mb-1">Bluttests</div>
            <ul className="space-y-1">
              <li>
                <span className="text-gray-600">Gesamtcholesterin:</span>{' '}
                {fmtBM(b, 'totalCholesterol')}
              </li>
              <li>
                <span className="text-gray-600">HDL:</span> {fmtBM(b, 'hdlCholesterol')}
              </li>
              <li>
                <span className="text-gray-600">LDL:</span> {fmtBM(b, 'ldlCholesterol')}
              </li>
              <li>
                <span className="text-gray-600">Triglyceride:</span> {fmtBM(b, 'triglycerides')}
              </li>
              <li>
                <span className="text-gray-600">Nüchternglukose:</span>{' '}
                {fmtBM(b, 'fastingGlucose')}
              </li>
              <li>
                <span className="text-gray-600">HbA1c:</span> {fmtBM(b, 'hba1c')}
              </li>
            </ul>
          </div>
        </div>
        {(biomarkers?.dateRecorded || biomarkers?.name) && (
          <div className="text-xs text-gray-500 mt-3">
            {biomarkers?.name ? `Patient: ${biomarkers.name}` : ''}
            {biomarkers?.name && biomarkers?.dateRecorded ? ' · ' : ''}
            {biomarkers?.dateRecorded ? `Stand: ${biomarkers.dateRecorded}` : ''}
          </div>
        )}
      </div>
    );
  };

  /* guard rails */
  if (error) {
    return (
      <DashboardLayout>
        <div className="text-red-600 p-6">{error}</div>
      </DashboardLayout>
    );
  }
  if (loading) {
    return (
      <DashboardLayout>
        <p className="p-8">Lade Details…</p>
      </DashboardLayout>
    );
  }
  if (!rows.length || !efoSummary) {
    return (
      <DashboardLayout>
        <p className="p-8 text-red-500">Keine Daten gefunden.</p>
      </DashboardLayout>
    );
  }

  const displayTrait = efoSummary.trait;
  const anchor = efoSummary.anchor;
  const top10 = (anchor?.topVariants || []).slice(0, 10);

  const chartData = {
    labels: top10.map((v) => v.rsid || v.variant),
    datasets: [
      {
        label: 'β × z',
        data: top10.map((v) => v.score),
        backgroundColor: 'rgba(96, 165, 250, 0.6)',
        hoverBackgroundColor: 'rgba(96, 165, 250, 0.8)',
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  };
  const chartOptions = {
    responsive: true,
    animation: { duration: 500, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: `Top 10 Varianten (β × z) – ${anchor?.id || ''}`,
        font: { size: 18 },
      },
    },
    indexAxis: 'y',
  };

  return (
  <DashboardLayout>
    <h2 className="text-3xl font-bold text-gray-800 mb-2">
      {displayTrait}
      <span className="block text-lg text-gray-500">(EFO-ID: {efoId})</span>
    </h2>

    {/* EFO-level summary */}
    <div className="bg-white p-4 rounded-lg shadow mb-4 text-sm">
      <div className="flex flex-wrap gap-6 items-center">
        <div><span className="text-gray-500">PGS-Modelle:</span> <strong>{efoSummary.count}</strong></div>
        <div><span className="text-gray-500">Ø Perzentil:</span> <strong>{fmt(efoSummary.avgPct, 1)}%</strong></div>
        <div><span className="text-gray-500">Median:</span> <strong>{fmt(efoSummary.medPct, 1)}%</strong></div>
        <div><span className="text-gray-500">Min/Max %:</span> <strong>{fmt(efoSummary.minPct,1)}% / {fmt(efoSummary.maxPct,1)}%</strong></div>
        <div><span className="text-gray-500">Ø PRS:</span> <strong>{fmt(efoSummary.avgPRS, 3)}</strong></div>
        <div><span className="text-gray-500">PRS-Spanne:</span> <strong>{fmt(efoSummary.minPRS,3)} … {fmt(efoSummary.maxPRS,3)}</strong></div>
        {anchor && (
          <div><span className="text-gray-500">Anker-PGS:</span> <strong>{anchor.id}</strong>{isNum(anchor.percentile) ? ` · ${anchor.percentile.toFixed(1)}%` : ''}</div>
        )}
        <div className="text-gray-500">Geladene SNP-Zusammenfassungen: <strong>{Object.keys(summaries).length}</strong></div>
      </div>
    </div>

    {/* Full biomarker card (like batch_ui_cardio) */}
    <BiomarkerPanel biomarkers={patientBiomarkers} genomeName={genomeQuery} />

    {/* Related biomarkers (EFO-specific) */}
    {relatedWithClass.length > 0 && (
      <div className="bg-white p-4 rounded-lg shadow-md mb-6">
        <h3 className="text-lg font-semibold mb-3">Zugehörige Biomarker</h3>
        <ul className="space-y-1 text-sm">
          {relatedWithClass.map((bm, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <span className="font-medium">{bm.label}:</span>
              <span>{bm.value}{bm.unit ? ` ${bm.unit}` : ''}</span>
              <span className={bm.badge.badgeClass}>{bm.badge.note}</span>
            </li>
          ))}
        </ul>
      </div>
    )}

    <div className="flex gap-6">
      {/* Per-PGS table */}
      <div className="flex-1 bg-white p-6 rounded-xl shadow-md overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-y-1">
          <thead className="bg-blue-50 text-gray-700">
            <tr>
              {['PGS', 'PRS', 'Z-Score', 'Perzentil', 'Matches', 'Varianten', 'SNP-Zusammenfassungen / Quellen'].map((col) => (
                <th key={col} className="px-4 py-2 text-left font-semibold">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => {
                const pa = Number.isFinite(a.percentile) ? a.percentile : -Infinity;
                const pb = Number.isFinite(b.percentile) ? b.percentile : -Infinity;
                return pb - pa;
              })
              .map((r, i) => {
                const meta = riskMeta(r.percentile);
                const topRsidList = (r.topVariants || [])
                  .map(v => ({ ...v, rsid: rsidFromVariant(v.variant, v.rsid) }))
                  .filter(v => v.rsid)                                   // keep any with a detectable rsID
                  .sort((a,b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0)) // prefer larger |score|
                  .slice(0, 3)
.map(v => v.rsid);

                return (
                  <tr key={r.id || i} className={`odd:bg-gray-50 even:bg-gray-100 hover:bg-blue-50 transition-colors ${meta.rowCls}`}>
                    <td className="px-4 py-2 font-mono">
                      {r.id ? (
                        <a href={pgsLink(r.id)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" title="PGS Catalog">
                          {r.id}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2">{fmt(r.prs, 4)}</td>
                    <td className="px-4 py-2">{fmt(r.zScore, 2)}</td>
                    <td className="px-4 py-2">
                      {isNum(r.percentile) ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${meta.badgeCls}`} title={meta.label}>
                          {r.percentile.toFixed(1)}% · {meta.label}
                        </span>
                      ) : '–'}
                    </td>
                    <td className="px-4 py-2">{isNum(r.matches) ? r.matches : '–'}</td>
                    <td className="px-4 py-2">{isNum(r.totalVariants) ? r.totalVariants : '–'}</td>

                    {/* inline summary links + Quelle */}
                    <td className="px-4 py-2">
                      {topRsidList.length === 0 ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          {topRsidList.map(rsid => {
                            const loaded = !!summaries[rsid];
                            const isLoading = !!loadingRsid[rsid];
                            return (
                              <span key={rsid} className="inline-flex items-center gap-1">
                                <a
                                  href={`https://www.ncbi.nlm.nih.gov/snp/${rsid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline"
                                  title="NCBI dbSNP"
                                >
                                  {rsid}
                                </a>
                                <span>·</span>
                                {loaded ? (
                                  <>
                                    <button
                                      className="text-green-600 hover:underline"
                                      onClick={() =>
                                        setActiveSummary({ type: 'snp', rsid, ...summaries[rsid] })
                                      }
                                      title="Zusammenfassung lesen"
                                    >
                                      Lesen
                                    </button>
                                    {summaries[rsid]?.url && (
                                      <>
                                        <span className="text-gray-400">·</span>
                                        <a
                                          href={summaries[rsid].url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline"
                                          title="Originalpublikation"
                                        >
                                          Quelle
                                        </a>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    className="text-gray-700 hover:underline disabled:text-gray-400"
                                    disabled={isLoading}
                                    onClick={() => fetchAndStoreSummary(rsid)}
                                    title="Zusammenfassung holen"
                                  >
                                    {isLoading ? 'Lade…' : 'Holen'}
                                  </button>
                                )}
                              </span>
                            );
                          })}
                          {(r.topVariants || []).filter(v => v.rsid).length > topRsidList.length && (
                            <button
                              className="text-blue-600 hover:underline"
                              onClick={() => fetchTopSummariesForRow(r, 6)}
                              title="Alle (ersten) holen"
                            >
                              Alle holen
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Publication summary panel (fed by /api/snp-summary) */}
      <div className="w-1/3 bg-white p-6 rounded-xl shadow-md sticky top-10 h-fit">
        {activeSummary ? (
          <>
            <h3 className="text-xl font-bold mb-4">Zusammenfassung für {activeSummary.rsid}</h3>
            {activeSummary.url && (
              <p className="mb-4">
                <a href={activeSummary.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  Zur Publikation
                </a>
              </p>
            )}
            <p className="whitespace-pre-line text-gray-800">{activeSummary.text}</p>
          </>
        ) : (
          <p className="text-gray-500">Wähle eine Variante aus, um die Zusammenfassung zu sehen.</p>
        )}
      </div>
    </div>

    {/* Top variants chart + clickable list that opens summaries */}
    <div className="bg-white p-6 rounded-xl shadow-md mt-10">
      <Bar data={chartData} options={chartOptions} />
      <div className="mt-4 text-sm text-gray-600">
        {anchor
          ? <>Anker: <span className="font-mono">{anchor.id}</span> · PRS {fmt(anchor.prs,4)} · {isNum(anchor.percentile) ? `${anchor.percentile.toFixed(1)}%` : '–'}</>
          : 'Kein Anker-PGS auswählbar.'}
      </div>

      {top10.length > 0 && (
        <ul className="mt-4 text-sm">
          {top10.map((v, i) => (
            <li key={i} className="py-1">
              <span className="text-gray-500 mr-2">{i + 1}.</span>
              <span className="mr-2">{v.variant}</span>
              {v.rsid ? (
                <>
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/snp/${v.rsid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {v.rsid}
                  </a>{' '}
                  {summaries[v.rsid]?.text ? (
                    <>
                      <button
                        className="text-green-600 hover:underline"
                        onClick={() => setActiveSummary({ rsid: v.rsid, ...summaries[v.rsid] })}
                      >
                        Zusammenfassung
                      </button>
                      {summaries[v.rsid]?.url && (
                        <>
                          {' '}·{' '}
                          <a
                            href={summaries[v.rsid].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            Quelle
                          </a>
                        </>
                      )}
                    </>
                  ) : (
                    <button
                      className="text-gray-700 hover:underline disabled:text-gray-400"
                      disabled={!!loadingRsid[v.rsid]}
                      onClick={() => fetchAndStoreSummary(v.rsid)}
                    >
                      {loadingRsid[v.rsid] ? 'Lade…' : 'Holen'}
                    </button>
                  )}
                </>
              ) : '–'}
              <span className="float-right font-semibold">{fmt(v.score, 3)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </DashboardLayout>
);
}
