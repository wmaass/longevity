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

function riskMeta(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) {
    return {
      tone: 'na',
      rowCls: '',
      badgeCls: 'bg-gray-100 text-gray-700 border border-gray-200',
      label: '—'
    };
  }
  if (v < 20) {
    return {
      tone: 'low',
      rowCls: 'bg-emerald-50 border-l-4 border-emerald-400',
      badgeCls: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      label: 'Unterdurchschnittlich (<20%)'
    };
  }
  if (v <= 80) {
    return {
      tone: 'avg',
      rowCls: 'bg-gray-50 border-l-4 border-gray-300',
      badgeCls: 'bg-gray-100 text-gray-800 border border-gray-200',
      label: 'Durchschnittlich (20–80%)'
    };
  }
  if (v <= 95) {
    return {
      tone: 'high',
      rowCls: 'bg-amber-50 border-l-4 border-amber-400',
      badgeCls: 'bg-amber-100 text-amber-800 border border-amber-200',
      label: 'Erhöht (80–95%)'
    };
  }
  return {
    tone: 'very-high',
    rowCls: 'bg-rose-50 border-l-4 border-rose-400',
    badgeCls: 'bg-rose-100 text-rose-800 border border-rose-200',
    label: 'Stark erhöht (>95%)'
  };
}



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
  oxygenSaturation: 'Sauerstoffsättigung'
};

const pgsLink = (id) =>
  id ? `https://www.pgscatalog.org/score/${encodeURIComponent(id)}/` : '#';

// ---------- small helpers ----------
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

// row styling by percentile
function percentileRiskRowClass(p) {
  const v = Number(p);
  if (isNaN(v)) return 'bg-white';
  if (v < 20)   return 'bg-emerald-50 border-l-4 border-emerald-400';
  if (v <= 80)  return 'bg-gray-50 border-l-4 border-gray-300';
  if (v <= 95)  return 'bg-amber-50 border-l-4 border-amber-400';
  return 'bg-rose-50 border-l-4 border-rose-400';
}

export default function CardioDetail() {
  const router = useRouter();
  const { efoId, genome: genomeQuery, trait: traitQuery } = router.query;

  const [rows, setRows] = useState([]);            // all PGS rows for this EFO
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  // SNP summaries (for anchor PGS)
  const [summaries, setSummaries] = useState({});
  const [activeSummary, setActiveSummary] = useState(null);

  // Biomarkers
  const [biomarkerMapping, setBiomarkerMapping] = useState({});
  const [patientBiomarkers, setPatientBiomarkers] = useState(null);
  const [relatedBiomarkers, setRelatedBiomarkers] = useState([]);

  // thresholds loaded once
  const [thresholds, setThresholds] = useState(null);

  // ---------- initial data loads ----------
  useEffect(() => {
    if (!router.isReady) return;
    if (!efoId || !genomeQuery) return;

    setLoading(true);
    setError(null);

    const detailPath = `/results/${genomeQuery}/details/${efoId}.json`;

    Promise.all([
      // 1) all PGS rows for the EFO
      fetch(detailPath).then(r => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      }),
      // 2) biomarker mapping
      fetch('/biomarker_efo_mapping.json').then(r => r.ok ? r.json() : {}),
      // 3) patient biomarkers
      fetch(`/results/${genomeQuery}/biomarkers.json`).then(r => r.ok ? r.json() : null),
      // 4) thresholds
      fetch('/biomarker_thresholds.json').then(r => r.ok ? r.json() : null)
    ])
    .then(([detailJson, mappingJson, biomarkersJson, thresholdsJson]) => {
      const arr = Array.isArray(detailJson) ? detailJson : (detailJson?.detail || []);
      // normalize numeric fields
      const normalized = arr.map(r => ({
        ...r,
        prs:        num(r.prs ?? r.rawScore),
        rawScore:   num(r.rawScore ?? r.prs),
        zScore:     num(r.zScore),
        percentile: num(r.percentile),
        matches:    num(r.matches),
        totalVariants: num(r.totalVariants),
      }));
      setRows(normalized);
      setBiomarkerMapping(mappingJson || {});
      setPatientBiomarkers(biomarkersJson || null);
      setThresholds(thresholdsJson || null);
    })
    .catch(err => setError(`❌ Fehler beim Laden: ${err.message}`))
    .finally(() => setLoading(false));
  }, [router.isReady, efoId, genomeQuery]);

  // ---------- compute EFO summary + anchor PGS ----------
  const efoSummary = useMemo(() => {
    if (!rows.length) return null;

    const trait = rows[0]?.trait || traitQuery || 'Unbekannter Trait';
    const pctVals = rows.map(r => r.percentile).filter(isNum);
    const prsVals = rows.map(r => r.prs).filter(isNum);

    // pick anchor: highest percentile available; if none, highest |PRS|
    let anchor = null;
    const withPct = rows.filter(r => isNum(r.percentile));
    if (withPct.length) {
      anchor = withPct.reduce((best, r) => (best == null || r.percentile > best.percentile ? r : best), null);
    } else if (rows.length) {
      anchor = rows.reduce((best, r) => (best == null || Math.abs(r.prs ?? 0) > Math.abs(best.prs ?? 0) ? r : best), null);
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
      anchor
    };
  }, [rows, traitQuery]);

  // ---------- fetch SNP summaries for anchor PGS ----------
  useEffect(() => {
    if (!efoSummary?.anchor) return;

    const top = (efoSummary.anchor.topVariants || [])
      .filter(v => Math.abs(v.score) > 0.2 && v.rsid)
      .slice(0, 10);

    let cancelled = false;

    (async () => {
      for (const v of top) {
        const rsid = v.rsid;
        if (!rsid || summaries[rsid]) continue;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000);
          const res = await fetch(`/api/snp-summary?rsid=${rsid}`, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!cancelled) {
            setSummaries(prev => ({
              ...prev,
              [rsid]: {
                text: data?.text || 'Keine Zusammenfassung verfügbar.',
                url: data?.url || null,
                logs: data?.logs || [],
              },
            }));
          }
        } catch (err) {
          if (!cancelled) {
            setSummaries(prev => ({
              ...prev,
              [rsid]: {
                text: 'Fehler beim Laden der Zusammenfassung.',
                url: null,
                logs: [`❌ Fehler: ${err.message}`],
              },
            }));
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [efoSummary?.anchor, summaries]);

  // ---------- related biomarkers ----------
  useEffect(() => {
    if (!efoId || !biomarkerMapping || !patientBiomarkers) return;

    const related = [];
    for (const [biomarkerKey, efoList] of Object.entries(biomarkerMapping)) {
      if (Array.isArray(efoList) && efoList.includes(efoId)) {
        const bmData = findBiomarkerValue(patientBiomarkers, biomarkerKey);
        if (bmData) {
          related.push({
            key: biomarkerKey,
            label: PRETTY_LABELS[biomarkerKey] || biomarkerKey,
            value: bmData.value,
            unit: bmData.unit || '',
          });
        }
      }
    }
    setRelatedBiomarkers(related);
  }, [efoId, biomarkerMapping, patientBiomarkers]);

  // classify related biomarkers with loaded thresholds
  const relatedWithClass = useMemo(() => {
    if (!thresholds) return relatedBiomarkers.map(b => ({ ...b, badge: mkBadge('yellow', '—') }));
    return relatedBiomarkers.map(b => ({
      ...b,
      badge: classifyBiomarkerLocal(b.key, b.value, b.unit, thresholds)
    }));
  }, [relatedBiomarkers, thresholds]);

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
    labels: top10.map(v => v.rsid || v.variant),
    datasets: [
      {
        label: 'β × z',
        data: top10.map(v => v.score),
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
      title: { display: true, text: `Top 10 Varianten (β × z) – ${anchor?.id || ''}`, font: { size: 18 } },
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
        <div className="flex flex-wrap gap-6">
          <div><span className="text-gray-500">PGS-Modelle:</span> <strong>{efoSummary.count}</strong></div>
          <div><span className="text-gray-500">Ø Perzentil:</span> <strong>{fmt(efoSummary.avgPct, 1)}%</strong></div>
          <div><span className="text-gray-500">Median:</span> <strong>{fmt(efoSummary.medPct, 1)}%</strong></div>
          <div><span className="text-gray-500">Min/Max %:</span> <strong>{fmt(efoSummary.minPct,1)}% / {fmt(efoSummary.maxPct,1)}%</strong></div>
          <div><span className="text-gray-500">Ø PRS:</span> <strong>{fmt(efoSummary.avgPRS, 3)}</strong></div>
          <div><span className="text-gray-500">PRS-Spanne:</span> <strong>{fmt(efoSummary.minPRS,3)} … {fmt(efoSummary.maxPRS,3)}</strong></div>
          {anchor && (
            <div><span className="text-gray-500">Anker-PGS:</span> <strong>{anchor.id}</strong>{isNum(anchor.percentile) ? ` · ${anchor.percentile.toFixed(1)}%` : ''}</div>
          )}
        </div>
      </div>

      {/* Related Biomarkers with badges */}
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
                {['PGS', 'PRS', 'Z-Score', 'Perzentil', 'Matches', 'Varianten'].map((col) => (
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
                  return pb - pa; // highest percentile first
                })
                .map((r, i) => {
                  const meta = riskMeta(r.percentile);
                  return (
                    <tr
                      key={r.id || i}
                      className={`odd:bg-gray-50 even:bg-gray-100 hover:bg-blue-50 transition-colors ${meta.rowCls}`}
                    >
                      <td className="px-4 py-2 font-mono">
                        {r.id ? (
                          <a
                            href={pgsLink(r.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                            title="PGS Catalog"
                          >
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
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Variant summary panel (anchor PGS) */}
        <div className="w-1/3 bg-white p-6 rounded-xl shadow-md sticky top-10 h-fit">
          {activeSummary ? (
            <>
              <h3 className="text-xl font-bold mb-4">Zusammenfassung für {activeSummary.rsid}</h3>
              {activeSummary.url && (
                <p className="mb-4">
                  <a href={activeSummary.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Zur Publikation</a>
                </p>
              )}
              <p className="whitespace-pre-line text-gray-800">{activeSummary.text}</p>
            </>
          ) : (
            <p className="text-gray-500">Wähle eine Variante aus, um die Zusammenfassung zu sehen.</p>
          )}
        </div>
      </div>

      {/* Top variants chart (anchor) */}
      <div className="bg-white p-6 rounded-xl shadow-md mt-10">
        <Bar data={chartData} options={chartOptions} />
        <div className="mt-4 text-sm text-gray-600">
          {anchor
            ? <>Anker: <span className="font-mono">{anchor.id}</span> · PRS {fmt(anchor.prs,4)} · {isNum(anchor.percentile) ? `${anchor.percentile.toFixed(1)}%` : '–'}</>
            : 'Kein Anker-PGS auswählbar.'}
        </div>

        {/* Clickable list under chart */}
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
                    </a>
                    {summaries[v.rsid]?.text && (
                      <> | <button
                        className="text-green-600 hover:underline"
                        onClick={() =>
                          setActiveSummary({ rsid: v.rsid, ...summaries[v.rsid] })
                        }
                      >
                        Zusammenfassung
                      </button></>
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

/** ------- Biomarker helpers ------- */
function findBiomarkerValue(patientData, key) {
  const bm = patientData?.biomarkers || {};

  // exact in vitals
  if (bm.vitals && bm.vitals[key]) {
    const val = bm.vitals[key];
    if (val && typeof val === 'object' && 'systolic' in val && 'diastolic' in val) {
      return { value: `${val.systolic}/${val.diastolic}`, unit: val.unit || 'mmHg' };
    }
    return norm(val);
  }
  // blood tests
  if (bm.bloodTests && bm.bloodTests[key]) return norm(bm.bloodTests[key]);
  // other
  if (bm.other && bm.other[key]) return norm(bm.other[key]);

  // backward-compat aggregate BP
  if ((key === 'bloodPressureSystolic' || key === 'bloodPressureDiastolic') && bm.vitals?.bloodPressure) {
    const agg = bm.vitals.bloodPressure;
    const unit = agg.unit || 'mmHg';
    if (key === 'bloodPressureSystolic' && 'systolic' in agg) return { value: agg.systolic, unit };
    if (key === 'bloodPressureDiastolic' && 'diastolic' in agg) return { value: agg.diastolic, unit };
  }
  return null;
}

function norm(val) {
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
}

function mkBadge(tone, text) {
  const cls = {
    green: 'bg-green-100 text-green-800 border-green-200',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    red: 'bg-red-100 text-red-800 border-red-200'
  }[tone] || 'bg-gray-100 text-gray-800 border-gray-200';
  return { tone, badgeClass: `inline-block px-2 py-0.5 rounded border text-xs ${cls}`, note: text };
}

function classifyBiomarkerLocal(key, rawValue, unit, thresholds) {
  const v = Number(rawValue);
  if (!thresholds || !thresholds[key] || !Number.isFinite(v)) return mkBadge('yellow', '—');
  for (const rule of thresholds[key]) {
    if (rule.max === null || v <= rule.max) {
      return mkBadge(rule.tone, rule.note);
    }
  }
  return mkBadge('yellow', '—');
}
