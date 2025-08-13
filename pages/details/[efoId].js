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
      interp: 'Kein Perzentil vorhanden. Für eine Einordnung benötigen wir eine Referenzverteilung (μ/σ) und ausreichende Coverage.'
    };
  }
  if (v < 20) {
    return {
      tone: 'low',
      rowCls: 'bg-emerald-50 border-l-4 border-emerald-400',
      badgeCls: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      label: 'Unterdurchschnittlich (<20%)',
      interp: 'Genetische Last geringer als bei ~80% der Vergleichspersonen. Das spricht gegen ein stark erhöhtes genetisches Risiko.'
    };
  }
  if (v <= 80) {
    return {
      tone: 'avg',
      rowCls: 'bg-gray-50 border-l-4 border-gray-300',
      badgeCls: 'bg-gray-100 text-gray-800 border border-gray-200',
      label: 'Durchschnittlich (20–80%)',
      interp: 'Typische genetische Last. Allein daraus ergibt sich keine große Abweichung vom Bevölkerungsdurchschnitt.'
    };
  }
  if (v <= 95) {
    return {
      tone: 'high',
      rowCls: 'bg-amber-50 border-l-4 border-amber-400',
      badgeCls: 'bg-amber-100 text-amber-800 border border-amber-200',
      label: 'Erhöht (80–95%)',
      interp: 'Höhere genetische Last als bei den meisten Menschen. Das spricht für ein moderat erhöhtes genetisches Risiko.'
    };
  }
  return {
    tone: 'very-high',
    rowCls: 'bg-rose-50 border-l-4 border-rose-400',
    badgeCls: 'bg-rose-100 text-rose-800 border border-rose-200',
    label: 'Stark erhöht (>95%)',
    interp: 'Sehr hohe genetische Last: höher als bei ≥95% der Vergleichspersonen. Das kann auf ein deutlich erhöhtes genetisches Risiko hindeuten.'
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
  const [summaries, setSummaries] = useState({});
  const [activeSummary, setActiveSummary] = useState(null);
  const [loadingRsid, setLoadingRsid] = useState({});

  /* biomarkers */
  const [biomarkerMapping, setBiomarkerMapping] = useState({});
  const [patientBiomarkers, setPatientBiomarkers] = useState(null);
  const [thresholds, setThresholds] = useState(null);

  /* NEW: Percentile interpretation panel state */
  const [pctPanel, setPctPanel] = useState(null); // {pgsId, percentile, zScore, matches, totalVariants}

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

  /* prefetch summaries for anchor top SNPs */
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

  /* ---------- on-demand SNP summary ---------- */
  async function fetchAndStoreSummary(rsid) {
    if (!rsid) return;
    if (loadingRsid[rsid] || summaries[rsid]) return;

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

      const payload = {
        text: data?.text || 'Keine Zusammenfassung verfügbar.',
        url: data?.url || null,
        logs: data?.logs || [],
      };

      setSummaries(prev => ({
        ...prev,
        [rsid]: payload,
      }));

      setActiveSummary({ type: 'snp', rsid, ...payload });
    } catch (err) {
      clearTimeout(timeout);

      const payload = {
        text: 'Fehler beim Laden der Zusammenfassung.',
        url: null,
        logs: [`❌ Fehler beim Laden: ${err.message}`],
      };

      setSummaries(prev => ({
        ...prev,
        [rsid]: payload,
      }));

      setActiveSummary({ type: 'snp', rsid, ...payload });
    } finally {
      setLoadingRsid(prev => ({ ...prev, [rsid]: false }));
    }
  }

  /* ---------- biomarker helpers (unchanged) ---------- */
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

  /* ---------- small biomarker card ---------- */
  const BiomarkerPanel = ({ biomarkers, genomeName, compact = false }) => {
    const cardCls = compact
      ? 'bg-white border border-gray-200 rounded-lg p-4 h-full'
      : 'bg-white border border-gray-200 rounded-lg p-4 mb-6';

    if (!biomarkers) {
      return (
        <div className={`${cardCls} text-sm`}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold">Patienten-Biomarker</h3>
          </div>
          <p className="text-gray-600">
            {genomeName ? (
              <>Keine Biomarker-Datei gefunden unter <code className="font-mono">/results/{genomeName}/biomarkers.json</code>.</>
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
      <div className={`${cardCls} text-sm`}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-lg font-semibold">Patienten-Biomarker</h3>
          {(biomarkers?.dateRecorded || biomarkers?.name) && (
            <div className="text-xs text-gray-500">
              {biomarkers?.name ? `Patient: ${biomarkers.name}` : ''}
              {biomarkers?.name && biomarkers?.dateRecorded ? ' · ' : ''}
              {biomarkers?.dateRecorded ? `Stand: ${biomarkers.dateRecorded}` : ''}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Vitalparameter</div>
            <ul className="space-y-1">
              <li><span className="text-gray-600">Blutdruck:</span> {fmtBM(v, 'bloodPressure')}</li>
              <li><span className="text-gray-600">Herzfrequenz:</span> {fmtBM(v, 'heartRate')}</li>
              <li><span className="text-gray-600">Atemfrequenz:</span> {fmtBM(v, 'respiratoryRate')}</li>
              <li><span className="text-gray-600">Körpertemperatur:</span> {fmtBM(v, 'bodyTemperature')}</li>
              <li><span className="text-gray-600">Sauerstoffsättigung:</span> {fmtBM(o, 'oxygenSaturation')}</li>
              <li><span className="text-gray-600">BMI:</span> {fmtBM(o, 'bmi')}</li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Bluttests</div>
            <ul className="space-y-1">
              <li><span className="text-gray-600">Gesamtcholesterin:</span> {fmtBM(b, 'totalCholesterol')}</li>
              <li><span className="text-gray-600">HDL:</span> {fmtBM(b, 'hdlCholesterol')}</li>
              <li><span className="text-gray-600">LDL:</span> {fmtBM(b, 'ldlCholesterol')}</li>
              <li><span className="text-gray-600">Triglyceride:</span> {fmtBM(b, 'triglycerides')}</li>
              <li><span className="text-gray-600">Nüchternglukose:</span> {fmtBM(b, 'fastingGlucose')}</li>
              <li><span className="text-gray-600">HbA1c:</span> {fmtBM(b, 'hba1c')}</li>
            </ul>
          </div>

          <div className="hidden lg:block">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Kurzüberblick</div>
            <ul className="space-y-1">
              <li><span className="text-gray-600">Syst./Diast.:</span> {fmtBM(v, 'bloodPressure')}</li>
              <li><span className="text-gray-600">LDL/HDL:</span> {`${fmtBM(b, 'ldlCholesterol')} / ${fmtBM(b, 'hdlCholesterol')}`}</li>
              <li><span className="text-gray-600">Triglyceride:</span> {fmtBM(b, 'triglycerides')}</li>
              <li><span className="text-gray-600">Nüchternglukose:</span> {fmtBM(b, 'fastingGlucose')}</li>
              <li><span className="text-gray-600">HbA1c:</span> {fmtBM(b, 'hba1c')}</li>
            </ul>
          </div>
        </div>
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

  /* helper to render interpretation text */
  const renderPctInterpretation = (entry) => {
    if (!entry) return null;
    const meta = riskMeta(entry.percentile);
    const coveragePct = isNum(entry.matches) && isNum(entry.totalVariants) && entry.totalVariants > 0
      ? (100 * entry.matches / entry.totalVariants)
      : null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">Perzentil-Interpretation</h3>
          <button
            className="text-sm text-gray-500 hover:text-gray-700"
            onClick={() => setPctPanel(null)}
            aria-label="Schließen"
          >
            Schließen
          </button>
        </div>
        <div className="mt-2 text-sm text-gray-800">
          <p className="mb-2">
            <span className={`px-2 py-0.5 rounded text-xs mr-2 ${meta.badgeCls}`}>{entry.percentile.toFixed(1)}% · {meta.label}</span>
            {isNum(entry.zScore) && (
              <span className="text-gray-600">(z = {entry.zScore.toFixed(2)})</span>
            )}
          </p>
          <p className="mb-2">{meta.interp}</p>
          <ul className="list-disc ml-5 text-gray-700 space-y-1">
            <li>Perzentile sind <strong>bevölkerungsbezogene Ränge</strong> – sie sind keine Diagnose.</li>
            <li>Die Einordnung gilt für das jeweilige <strong>PGS-Modell</strong>; unterschiedliche Modelle können leicht abweichen.</li>
            {isNum(coveragePct) && (
              <li>Ungefähre Abdeckung: {coveragePct.toFixed(0)}% der Varianten dieses Modells waren in deinen Daten verfügbar.</li>
            )}
            <li>Klinische Faktoren (z. B. Alter, Lebensstil, Laborwerte) sollten immer mitberücksichtigt werden.</li>
          </ul>
        </div>
      </div>
    );
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

      {/* === Biomarker + Zugehörige (nebeneinander, gleiche Höhe) === */}
      <div className="flex gap-4 items-stretch mb-6">
        {/* Linkes Panel */}
        <div className="flex-1">
          <BiomarkerPanel
            compact
            biomarkers={patientBiomarkers}
            genomeName={genomeQuery}
          />
        </div>

        {/* Rechtes Panel */}
        <div className="flex-1">
          <div className="bg-white border border-gray-200 rounded-lg p-4 h-full">
            <h3 className="text-lg font-semibold mb-3">Zugehörige Biomarker</h3>

            {relatedWithClass.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {relatedWithClass.map((bm, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="font-medium">{bm.label}:</span>
                    <span>
                      {bm.value}
                      {bm.unit ? ` ${bm.unit}` : ''}
                    </span>
                    <span className={bm.badge.badgeClass}>{bm.badge.note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-600">
                Keine zugehörigen Biomarker gefunden.
              </p>
            )}
          </div>
        </div>
      </div>


      <div className="flex gap-6">
  {/* Per-PGS table */}
  <div className="flex-1 bg-white p-6 rounded-xl shadow-md overflow-x-auto">
    <table className="w-full text-sm border-separate border-spacing-y-1">
      {/* Spaltenbreiten steuern */}
      <colgroup>
        <col className="w-[120px]" />   {/* PGS */}
        <col className="w-[90px]" />    {/* PRS */}
        <col className="w-[90px]" />    {/* Z-Score */}
        <col className="w-[170px]" />   {/* Perzentil */}
        <col className="w-[150px]" />   {/* Match/Varianten */}
        <col className="w-[50%] md:w-[45%] lg:w-[40%]" /> {/* SNP+Abstract */}
      </colgroup>

      <thead className="bg-blue-50 text-gray-700 text-[13px] leading-5">
        <tr>
          {['PGS', 'PRS', 'Z-Score', 'Perzentil', 'Match/ Varianten', 'SNP+Abstract'].map((col) => (
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
            const topSnps = (r.topVariants || [])
              .map(v => ({ ...v, rsid: rsidFromVariant(v.variant, v.rsid) }))
              .filter(v => v.rsid)
              .sort((a,b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0))
              .slice(0, 3);

            return (
              <tr
                key={r.id || i}
                className={`align-top odd:bg-gray-50 even:bg-gray-100 hover:bg-blue-50 transition-colors ${meta.rowCls}`}
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

                <td className="px-4 py-2 whitespace-nowrap">
                  {isNum(r.percentile) ? (
                    <button
                      type="button"
                      className={`px-2 py-0.5 rounded text-xs ${meta.badgeCls} hover:opacity-90 hover:underline focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-300`}
                      title="Perzentil interpretieren"
                      onClick={() => setPctPanel({
                        pgsId: r.id,
                        percentile: r.percentile,
                        zScore: r.zScore,
                        matches: r.matches,
                        totalVariants: r.totalVariants,
                      })}
                    >
                      {r.percentile.toFixed(1)}% · {meta.label}
                    </button>
                  ) : '–'}
                </td>

                <td className="px-4 py-2 whitespace-nowrap">
                  {(isNum(r.matches) || isNum(r.totalVariants))
                    ? `${isNum(r.matches) ? r.matches : '–'} / ${isNum(r.totalVariants) ? r.totalVariants : '–'}`
                    : '–'}
                </td>

                {/* SNP + Abstract (luftig, gestapelt) */}
                <td className="px-4 py-2 align-top whitespace-normal break-words leading-relaxed
                               min-w-[300px] md:min-w-[420px] lg:min-w-[520px]">
                  {topSnps.length === 0 ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {topSnps.map((snp, idx) => {
                        const rsid = snp.rsid;
                        const loaded = !!summaries[rsid];
                        const isLoading = !!loadingRsid[rsid];

                        return (
                          <div key={rsid} className="rounded-md">
                            {/* Zeile 1: SNP-ID + Rang */}
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={`https://www.ncbi.nlm.nih.gov/snp/${rsid}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-blue-700 hover:underline"
                                title="NCBI dbSNP"
                              >
                                {rsid}
                              </a>
                              <span className="text-xs text-gray-500">Rank {idx + 1}</span>
                            </div>

                            {/* Zeile 2: Kennzahlen */}
                            <div className="mt-0.5 text-[13px] text-gray-700">
                              β {fmt(snp.beta, 3)} &middot; Dos {snp.dosage ?? '—'} &middot; Score {fmt(snp.score, 3)}
                            </div>

                            {/* Zeile 3: Aktionen */}
                            <div className="mt-1 text-sm">
                              {loaded ? (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <button
                                    className="text-green-700 hover:underline"
                                    onClick={() => setActiveSummary({ type: 'snp', rsid, ...summaries[rsid] })}
                                    title="Zusammenfassung lesen"
                                  >
                                    Lesen
                                  </button>
                                  {summaries[rsid]?.url && (
                                    <>
                                      <span className="text-gray-300">·</span>
                                      <a
                                        href={summaries[rsid].url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-700 hover:underline"
                                        title="Originalpublikation"
                                      >
                                        Quelle
                                      </a>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <button
                                  className="text-gray-800 hover:underline disabled:text-gray-400"
                                  disabled={isLoading}
                                  onClick={() => fetchAndStoreSummary(rsid)}
                                  title="Zusammenfassung holen"
                                >
                                  {isLoading ? 'Lade…' : 'Holen'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  </div>

  {/* Rechte Spalte: Zusammenfassung + Perzentil-Interpretation übereinander */}
  <div className="w-full lg:w-1/3 lg:sticky lg:top-10 self-start flex flex-col gap-4">
    {/* Publication summary panel */}
    <div className="bg-white p-6 rounded-xl shadow-md">
      {activeSummary ? (
        <>
          <h3 className="text-xl font-bold mb-4">Zusammenfassung für {activeSummary.rsid}</h3>

          {activeSummary.url && (
            <p className="mb-4">
              <a
                href={activeSummary.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Zur Publikation
              </a>
            </p>
          )}

          <p className="whitespace-pre-line text-gray-800">
            {activeSummary.text}
          </p>
        </>
      ) : (
        <p className="text-gray-500">Wähle eine Variante aus, um die Zusammenfassung zu sehen.</p>
      )}
    </div>

    {/* Percentile interpretation */}
    {renderPctInterpretation(pctPanel)}
  </div>
</div>


      {/* Top variants chart + clickable list */}
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
