import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Papa from 'papaparse';
import * as d3 from 'd3';
import DashboardLayout from '../components/DashboardLayout';
import { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

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


/* ---------- helpers ---------- */

function percentileRiskRowClass(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) return 'bg-white';
  if (v < 20)   return 'bg-emerald-50 border-l-4 border-emerald-400';
  if (v <= 80)  return 'bg-gray-50 border-l-4 border-gray-300';
  if (v <= 95)  return 'bg-amber-50 border-l-4 border-amber-400';
  return 'bg-rose-50 border-l-4 border-rose-400';
}

function erf(x){ const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1; const t = 1/(1+p*Math.abs(x));
  const y = 1-((((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x); return sign*y; }
const cdf  = (z)=> 0.5*(1+erf(z/Math.SQRT2));
const clampPct = (p)=> Math.max(0.1, Math.min(99.9, p));
const num = (v)=> { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function pick(obj, keys){
  for (const k of keys){ if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k]; }
  return null;
}

/* ---------- page ---------- */

export default function CardioDashboard() {
  const [data, setData] = useState([]);
  const [organMap, setOrganMap] = useState({});
  const [traitNames, setTraitNames] = useState({});
  const [showReferences, setShowReferences] = useState(false);
  const [logEntries, setLogEntries] = useState([]);
  const [genomeName, setGenomeName] = useState('');
  const [biomarkers, setBiomarkers] = useState(null);
  const [biomarkersError, setBiomarkersError] = useState(null);
  const router = useRouter();

  const log = (msg) => setLogEntries((prev) => [...prev.slice(-200), msg]);

  useEffect(() => {
    if (!genomeName) { console.warn('⛔ genomeName leer – Effekt wird abgebrochen'); return; }

    const aggPath = `/results/${genomeName}/batch_results_cardio.csv`;
    const detPath = `/results/${genomeName}/batch_details_cardio.csv`;

    (async () => {
      try {
        /* 1) load aggregated */
        log(`📥 Lade ${aggPath} ...`);
        const aggCsv = await fetch(aggPath).then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
        const aggRows = Papa.parse(aggCsv, { header: true, skipEmptyLines: true }).data.map(row => {
          const efo = (row['EFO-ID'] ?? row['EFO ID'] ?? row['EFO'] ?? '').trim();
          const avgPrs = num(row['Avg PRS']); const cnt = num(row['PGS Count']); const avgPct = num(row['Avg Percentile']);
          const logPRS = Number.isFinite(avgPrs) && avgPrs > 0 ? Math.log10(avgPrs) : NaN;
          return {
            ...row,
            'EFO-ID': efo,
            'Avg PRS': Number.isFinite(avgPrs) ? avgPrs : NaN,
            'PGS Count': Number.isFinite(cnt) ? cnt : 0,
            'Avg Percentile': Number.isFinite(avgPct) ? avgPct : NaN,
            logPRS
          };
        });
        log(`✅ Aggregiert: ${aggRows.length} Zeilen`);

        /* 2) load reference stats from public/ */
        let refScores = {};
        try {
          const res = await fetch('/reference_stats.json', { cache: 'no-store' });
          if (res.ok) {
            const json = await res.json();
            refScores = json?.scores || {};
            log(`✅ /reference_stats.json gefunden (Keys: ${Object.keys(refScores).length})`);
          } else {
            log(`⚠️ /reference_stats.json nicht gefunden (HTTP ${res.status})`);
          }
        } catch (e) {
          log(`⚠️ Fehler beim Laden von /reference_stats.json: ${e.message}`);
        }

        /* 3) load details */
        log(`📥 Lade ${detPath} ...`);
        const detCsv = await fetch(detPath).then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
        const details = Papa.parse(detCsv, { header: true, skipEmptyLines: true }).data;

        /* 4) compute per-EFO average percentile using reference stats */
        const efoPercentiles = {};
        let usedRows = 0, totalRows = 0, missedPGS = 0, badStats = 0;

        for (const r of details){
          totalRows++;

          const efo = String(pick(r, ['EFO','EFO-ID','EFO ID'] ) || '').trim();
          const pgs = String(pick(r, ['PGS','PGS ID','id']) || '').trim();
          if (!efo || !pgs) continue;

          const raw = num(pick(r, ['raw','prs','rawScore','PRS','z','zScore']));
          if (raw == null) continue;

          const st = refScores[pgs];
          if (!st) { missedPGS++; continue; }

          const mu = num(st.mu), sd = num(st.sd);
          if (!Number.isFinite(mu) || !Number.isFinite(sd) || sd <= 0) { badStats++; continue; }

          const z = (raw - mu) / sd;
          const pct = clampPct(cdf(z) * 100);
          if (!efoPercentiles[efo]) efoPercentiles[efo] = [];
          efoPercentiles[efo].push(pct);
          usedRows++;
        }
        log(`✅ Perzentile berechnet: ${Object.keys(efoPercentiles).length} EFOs · verwendet ${usedRows}/${totalRows} Zeilen · fehlende PGS=${missedPGS} · ungültige Stats=${badStats}`);

        const avgPctByEfo = {};
        for (const [efo, arr] of Object.entries(efoPercentiles)) {
          if (arr.length) avgPctByEfo[efo] = arr.reduce((a,b)=>a+b,0) / arr.length;
        }

        /* 5) override aggregated Avg Percentile where we have one */
        const merged = aggRows.map(r => {
          const override = avgPctByEfo[r['EFO-ID']];
          const out = { ...r };
          if (Number.isFinite(override)) out['Avg Percentile'] = override;
          if (!Number.isFinite(out.logPRS)) {
            out.logPRS = Number.isFinite(out['Avg PRS']) && out['Avg PRS'] > 0 ? Math.log10(out['Avg PRS']) : NaN;
          }
          return out;
        });

        setData(merged);
      } catch (err) {
        log(`❌ Lade-/Verarbeitungsfehler: ${err.message}`);
      }

      /* Ancillary loads */
      try{
        log('📥 Lade efo_to_organ.json ...');
        const org = await fetch('/efo_to_organ.json').then(r=>r.json());
        const cleaned = {}; for (const organ in org) cleaned[organ] = org[organ].map(e=>String(e).trim());
        setOrganMap(cleaned); log('✅ efo_to_organ.json geladen');
      } catch(e){ log(`❌ Fehler efo_to_organ.json: ${e.message}`); }

      try{
        log('📥 Lade traits.json ...');
        const tj = await fetch('/traits.json').then(r=>r.json());
        const tmap = {}; for (const t of tj) if (t.id && t.label) tmap[String(t.id).trim()] = String(t.label).trim();
        setTraitNames(tmap); log('✅ traits.json geladen');
      } catch(e){ log(`❌ Fehler traits.json: ${e.message}`); }

      try{
        const path = `/results/${genomeName}/biomarkers.json`;
        log(`📥 Lade Biomarker: ${path} ...`);
        const bj = await fetch(path);
        if (bj.ok) { setBiomarkers(await bj.json()); setBiomarkersError(null); log('✅ Biomarker geladen'); }
        else { setBiomarkers(null); setBiomarkersError(`HTTP ${bj.status}`); log(`⚠️ Biomarker nicht gefunden (${bj.status})`); }
      } catch(e){ setBiomarkers(null); setBiomarkersError(e.message); log(`⚠️ Biomarker Fehler: ${e.message}`); }

    })();
  }, [genomeName]);

  useEffect(() => {
    if (!genomeName) return;
    if (Object.keys(organMap).length > 0 && data.length > 0 && Object.keys(traitNames).length > 0) {
      renderBodyMap(data, organMap, traitNames, router, genomeName);
    }
  }, [data, organMap, traitNames, genomeName, router]);

  const enrichedData = data
    .map(d => ({
      ...d,
      TraitLabel: d.Trait && d.Trait !== '(unbekannt)' ? d.Trait : (traitNames[d['EFO-ID']] || '(unbekannt)')
    }))
    .sort((a, b) => {
      const av = Number.isFinite(a['Avg Percentile']) ? a['Avg Percentile'] : -Infinity;
      const bv = Number.isFinite(b['Avg Percentile']) ? b['Avg Percentile'] : -Infinity;
      return bv - av;
    });

  const barData = {
    labels: enrichedData.map(d => d.TraitLabel),
    datasets: [{
      label: 'log10(Avg PRS)',
      data: enrichedData.map(d => (Number.isFinite(d.logPRS) ? d.logPRS : 0)),
      backgroundColor: 'rgba(34,197,94,0.6)',
      borderRadius: 8,
      borderSkipped: false,
      hoverBackgroundColor: 'rgba(34,197,94,0.8)',
      hoverBorderColor: 'rgba(34,197,94,1)',
      borderWidth: 1,
    }],
  };

  const barOptions = {
    indexAxis: 'y',
    responsive: true,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const d   = enrichedData[ctx.dataIndex];
            const pct = Number.isFinite(d['Avg Percentile']) ? d['Avg Percentile'].toFixed(1) : '–';
            const rm  = riskMeta(d['Avg Percentile']);
            const lp  = Number.isFinite(d.logPRS) ? d.logPRS.toFixed(2) : '–';
            return `${d.TraitLabel}: logPRS=${lp}, ${pct}% · ${rm.label}`;
          },
        },
      },
    },
    onClick: (_, elements) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        const efo = enrichedData[idx]['EFO-ID'];
        router.push(`/details/${efo}?trait=${encodeURIComponent(enrichedData[idx].TraitLabel)}&genome=${encodeURIComponent(genomeName)}`);
      }
    },
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setGenomeName(file.name.replace(/\.txt(\.gz)?$/, ''));
      log(`📂 Genom-Datei ausgewählt: ${file.name}`);
    }
  };

  return (
    <DashboardLayout>
      <h2 className="text-4xl font-extrabold mb-6 text-gray-800">Kardiovaskuläre PGS-Ergebnisse</h2>

      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 mr-2">Genom-Datei wählen:</label>
        <input type="file" accept=".txt,.gz" onChange={handleFileSelect} />
      </div>

      <div className="flex flex-row gap-8">
        {/* LEFT */}
        <div className="flex flex-col w-1/2">
          <div id="bodymap" className="relative mb-8 overflow-visible" style={{ width: '700px', height: '800px' }}>
            <img src="/images/bodymap.png" alt="Körperkarte" className="absolute" style={{ width: '700px', height: '800px', objectFit: 'contain', zIndex: 0 }} />
            <svg className="absolute" id="organsvg" viewBox="0 0 700 800" preserveAspectRatio="xMidYMid meet" style={{ width: '700px', height: '800px', zIndex: 10 }} />
            <div id="tooltip" className="absolute bg-white text-sm text-gray-800 border border-gray-300 px-3 py-2 rounded-lg shadow-md pointer-events-auto opacity-0 transition-opacity duration-200 z-50" />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg mb-6 p-4 max-h-48 overflow-auto text-sm text-gray-700">
            <strong>🔍 Log-Ausgaben:</strong>
            <ul className="list-disc ml-6 mt-2">
              {logEntries.map((msg, idx) => <li key={idx}>{msg}</li>)}
            </ul>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col w-1/2">
          <BiomarkerPanel biomarkers={biomarkers} error={biomarkersError} genomeName={genomeName} />

          <div className="trait-interpretation text-sm mt-6">
            <h2 className="text-lg font-semibold mb-4">Interpretation der Ergebnisse</h2>
            <table className="mb-4 text-sm border border-gray-300 w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Perzentilbereich</th>
                  <th className="px-3 py-2 text-left">Risikoeinstufung</th>
                  <th className="px-3 py-2 text-left">Quelle</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="px-3 py-2">&lt; 20 %</td><td>Unterdurchschnittliches Risiko</td><td>Lewis & Vassos (2020)</td></tr>
                <tr><td className="px-3 py-2">20–80 %</td><td>Durchschnittliches Risiko</td><td>Torkamani et al. (2018)</td></tr>
                <tr><td className="px-3 py-2">&gt; 80 %</td><td>Erhöhtes Risiko</td><td>Inouye et al. (2018)</td></tr>
                <tr><td className="px-3 py-2">&gt; 95 %</td><td>Stark erhöhtes Risiko</td><td>Khera et al. (2018); Inouye (2018)</td></tr>
              </tbody>
            </table>
          </div>

          <table className="mb-12 w-full text-sm text-left border border-gray-200">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="py-2 px-4">EFO ID</th>
                <th className="py-2 px-4">Trait</th>
                <th className="py-2 px-4">Percentile</th>
                <th className="py-2 px-4">PGS Count</th>
              </tr>
            </thead>
            <tbody>
              {enrichedData.map((row, idx) => {
                const rowCls = percentileRiskRowClass(row['Avg Percentile']);
                return (
                  <tr key={idx} className={`border-t hover:bg-white/60 transition-colors ${rowCls}`}>
                    <td className="py-2 px-4 font-mono text-xs text-gray-700">
                      <a href={`/details/${row['EFO-ID']}?genome=${encodeURIComponent(genomeName)}`} className="text-blue-600 hover:underline">
                        {row['EFO-ID']}
                      </a>
                    </td>
                    <td className="py-2 px-4">
                      <a href={`/details/${row['EFO-ID']}?genome=${encodeURIComponent(genomeName)}`} className="text-blue-700 hover:underline">
                        {row.TraitLabel}
                      </a>
                    </td>
                    <td className="py-2 px-4">
                      {Number.isFinite(row['Avg Percentile']) ? (
                        <span className={`px-2 py-0.5 rounded border text-xs ${riskMeta(row['Avg Percentile']).cls}`}>
                          {row['Avg Percentile'].toFixed(1)}%
                        </span>
                      ) : '–'}
                    </td>
                    <td className="py-2 px-4">
                      {Number.isFinite(row['PGS Count']) ? row['PGS Count'] : '–'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-6">
            <Bar data={barData} options={barOptions} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ---------- Biomarker panel ---------- */
function BiomarkerPanel({ biomarkers, error, genomeName }) {
  const cardCls = "bg-white border border-gray-200 rounded-lg p-4";
  if (error) return (
    <div className={`${cardCls} text-sm`}>
      <h3 className="text-lg font-semibold mb-2">Patienten-Biomarker</h3>
      <p className="text-gray-600">
        Keine Biomarker-Datei gefunden unter <code className="font-mono">/results/{genomeName}/biomarkers.json</code>.
      </p>
    </div>
  );
  if (!biomarkers) return (
    <div className={`${cardCls} text-sm`}>
      <h3 className="text-lg font-semibold mb-2">Patienten-Biomarker</h3>
      <p className="text-gray-600">Lade Biomarker…</p>
    </div>
  );

  const v = biomarkers?.biomarkers?.vitals || {};
  const b = biomarkers?.biomarkers?.bloodTests || {};
  const o = biomarkers?.biomarkers?.other || {};

  const fmt = (obj, key, subkey = 'value', unitKey = 'unit') => {
    const it = obj?.[key];
    if (!it) return '–';
    if (typeof it === 'object' && 'systolic' in it && 'diastolic' in it) {
      return `${it.systolic}/${it.diastolic} ${it.unit || 'mmHg'}`;
    }
    const val = it?.[subkey];
    const unit = it?.[unitKey];
    return (val ?? val === 0) ? `${val}${unit ? ' ' + unit : ''}` : '–';
  };

  return (
    <div className={`${cardCls} text-sm`}>
      <h3 className="text-lg font-semibold mb-3">Patienten-Biomarker</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-gray-500 mb-1">Vitalparameter</div>
          <ul className="space-y-1">
            <li><span className="text-gray-600">Blutdruck:</span> {fmt(v, 'bloodPressure')}</li>
            <li><span className="text-gray-600">Herzfrequenz:</span> {fmt(v, 'heartRate')}</li>
            <li><span className="text-gray-600">Atemfrequenz:</span> {fmt(v, 'respiratoryRate')}</li>
            <li><span className="text-gray-600">Körpertemperatur:</span> {fmt(v, 'bodyTemperature')}</li>
            <li><span className="text-gray-600">Sauerstoffsättigung:</span> {fmt(o, 'oxygenSaturation')}</li>
            <li><span className="text-gray-600">BMI:</span> {fmt(o, 'bmi')}</li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500 mb-1">Bluttests</div>
          <ul className="space-y-1">
            <li><span className="text-gray-600">Gesamtcholesterin:</span> {fmt(b, 'totalCholesterol')}</li>
            <li><span className="text-gray-600">HDL:</span> {fmt(b, 'hdlCholesterol')}</li>
            <li><span className="text-gray-600">LDL:</span> {fmt(b, 'ldlCholesterol')}</li>
            <li><span className="text-gray-600">Triglyceride:</span> {fmt(b, 'triglycerides')}</li>
            <li><span className="text-gray-600">Nüchternglukose:</span> {fmt(b, 'fastingGlucose')}</li>
            <li><span className="text-gray-600">HbA1c:</span> {fmt(b, 'hba1c')}</li>
          </ul>
        </div>
      </div>
      {(biomarkers?.dateRecorded || biomarkers?.name) && (
        <div className="text-xs text-gray-500 mt-3">
          {biomarkers?.name ? `Patient: ${biomarkers.name}` : ''}{biomarkers?.name && biomarkers?.dateRecorded ? ' · ' : ''}
          {biomarkers?.dateRecorded ? `Stand: ${biomarkers.dateRecorded}` : ''}
        </div>
      )}
    </div>
  );
}

/* ---------- body map ---------- */
function renderBodyMap(results, organMap, traitNames, router, genomeName) {
  const svg = d3.select('#organsvg');
  svg.selectAll('*').remove();

  const tooltip = d3.select('#tooltip');
  let hideTimeout;
  tooltip.on('mouseenter', () => clearTimeout(hideTimeout))
         .on('mouseleave', () => { hideTimeout = setTimeout(() => tooltip.style('opacity', 0), 200); });

  const organs = [
    { name: 'Gehirn', x: 580, y: 80, x1: 360, y1: 70 },
    { name: 'Herz', x: 580, y: 180, x1: 340, y1: 220 },
    { name: 'Magen', x: 580, y: 280, x1: 370, y1: 280 },
    { name: 'Darm', x: 580, y: 380, x1: 360, y1: 360 },
    { name: 'Blase', x: 580, y: 460, x1: 350, y1: 420 },
    { name: 'Lunge', x: 120, y: 100, x1: 320, y1: 170 },
    { name: 'Leber', x: 120, y: 200, x1: 310, y1: 280 },
    { name: 'Niere', x: 120, y: 300, x1: 320, y1: 310 },
    { name: 'Blutgefäße', x: 120, y: 400, x1: 140, y1: 400 },
  ];

  organs.forEach(({ name, x, y, x1, y1 }) => {
    const efoList = (organMap[name] || []).map(efo => efo.trim());
    const efoIdsInResults = new Set(results.map(r => (r['EFO-ID'] || '').trim()));
    const matches = efoList
      .filter(efo => efoIdsInResults.has(efo))
      .map(efo => results.find(r => (r['EFO-ID'] || '').trim() === efo))
      .filter(Boolean);

    const validPercentiles = matches
      .map(m => parseFloat(m['Avg Percentile']))
      .filter(p => Number.isFinite(p));

    const avgPercentile = validPercentiles.length ? d3.mean(validPercentiles) : 0;
    const color = efoList.length === 0 ? '#ccc' : (matches.length > 0 ? d3.interpolateReds(avgPercentile / 100) : '#fff');

    svg.append('circle')
      .attr('cx', x).attr('cy', y).attr('r', 22)
      .attr('fill', color).attr('stroke', '#333').attr('stroke-width', 1)
      .style('cursor', efoList.length > 0 ? 'pointer' : 'default')
      .on('click', function(event) {
        event.preventDefault(); event.stopPropagation();
        if (efoList.length === 1) {
          router.push({ pathname: `/details/${efoList[0]}`, query: { genome: genomeName } });
        } else if (efoList.length > 1) {
          const content = matches.map((match) => {
            const efo = (match['EFO-ID'] || '').trim();
            const label = match?.Trait || traitNames[efo] || `Unbekannter Trait (${efo})`;
            return `<div class='hover:bg-gray-100 p-1 cursor-pointer' data-efo='${efo}'>${label} (${efo})</div>`;
          }).join('');
          tooltip.style('opacity', 1).style('pointer-events', 'auto')
                 .style('left', `${x + 30}px`).style('top', `${y - 20}px`)
                 .html(`<div class='font-semibold mb-1'>${name}</div>${content}`);
          tooltip.selectAll('[data-efo]').on('click', function(event) {
            event.preventDefault(); event.stopPropagation();
            const efo = d3.select(this).attr('data-efo');
            router.push({ pathname: `/details/${efo}`, query: { genome: genomeName } });
          });
        }
      });

    svg.append('line')
      .attr('x1', x1).attr('y1', y1)
      .attr('x2', x + (x < 150 ? 22 : -22)).attr('y2', y)
      .attr('stroke', '#333').attr('stroke-width', 1);

    svg.append('text')
      .attr('x', x + (x < 150 ? -26 : 26)).attr('y', y + 5)
      .attr('font-size', '13px').attr('fill', '#111')
      .attr('text-anchor', x < 150 ? 'end' : 'start')
      .text(name);
  });
}
