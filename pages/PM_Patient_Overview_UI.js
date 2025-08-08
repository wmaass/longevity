import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Papa from 'papaparse';
import DashboardLayout from '../components/DashboardLayout';
import ProgressBar from '../components/ProgressBar';

// ---------------- Bodymap helpers ----------------
function getColorForScore(score) {
  if (!Number.isFinite(score)) return 'gray';
  if (score >= 95) return '#ef4444'; // red-500
  if (score >= 80) return '#fca5a5'; // red-300
  if (score >= 50) return '#fde68a'; // amber-200
  if (score >= 20) return '#dcfce7'; // green-100
  return '#e5e7eb'; // gray-200
}

// Adjust keys/positions to your organ labels
const ORGAN_POS = {
  Gehirn: [20, 50],
  Herz: [40, 50],
  Lunge: [32, 50],
  Leber: [50, 54],
  Nieren: [60, 46],
  Magen: [50, 45],
  Darm: [63, 50],
  Blase: [75, 52],
  Blutgefäße: [57, 52],
};

function OrganView({
  organScores = {},
  organMap = {},
  results = [],
  traitNames = {},
  selectedOrgan,
  onSelectOrgan = () => {},
  genomeName = '',
}) {
  // --- Color: green -> yellow -> red based on percentile ---
  function hex(c) { return c.toString(16).padStart(2, '0'); }
  function rgb(r, g, b) { return `#${hex(r)}${hex(g)}${hex(b)}`; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function blend(a, b, t) { return rgb(
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ); }
  function getColorForPercentile(p) {
    if (!Number.isFinite(p)) return '#cccccc';
    const t = Math.max(0, Math.min(1, p / 100));
    // 0..0.5: green (#16a34a) -> yellow (#facc15), 0.5..1: yellow -> red (#dc2626)
    const green = [22, 163, 74];
    const yellow = [250, 204, 21];
    const red = [220, 38, 38];
    if (t <= 0.5) return blend(green, yellow, t / 0.5);
    return blend(yellow, red, (t - 0.5) / 0.5);
  }

  const efoList = selectedOrgan && Array.isArray(organMap[selectedOrgan]) ? organMap[selectedOrgan] : [];
  const rows = React.useMemo(() => {
    const byEfo = new Map();
    // seed entries so we always show all mapped EFOs
    efoList.forEach((id) => byEfo.set(id, {
      efoId: id,
      trait: traitNames[id] || 'Unknown trait',
      pgsCount: 0,
      percentiles: [],
      models: [],
    }));
    // fold-in results
    results.forEach((r) => {
      if (!byEfo.has(r.efoId)) return;
      const v = byEfo.get(r.efoId);
      v.trait = r.trait || v.trait;
      v.pgsCount += 1;
      if (Number.isFinite(r.percentile)) v.percentiles.push(r.percentile);
      const label = [r.id, (r.name || r.label || r.shortName || '')].filter(Boolean).join(' — ');
      if (label && !v.models.includes(label)) v.models.push(label);
    });
    return Array.from(byEfo.values()).map((v) => ({
      ...v,
      percentile: v.percentiles.length ? Math.max(...v.percentiles) : null,
    }));
  }, [efoList, results, traitNames]);

  return (
    <div className="relative w-full max-w-sm mx-auto">
      <img src="/images/bodymap.png" alt="Body Map" className="w-full" />
      {Object.entries(organScores).map(([organ, score]) => {
        const [top, left] = ORGAN_POS[organ] || [50, 50];
        return (
          <button
            key={organ}
            type="button"
            onClick={() => onSelectOrgan(organ)}
            className={`absolute rounded-full border-2 border-white shadow ${selectedOrgan === organ ? 'ring-4 ring-blue-400' : ''}`}
            style={{ top: `${top}%`, left: `${left}%`, width: 22, height: 22, backgroundColor: getColorForPercentile(score), transform: 'translate(-50%, -50%)' }}
            title={`${organ}: ${Number.isFinite(score) ? score.toFixed(1) : '–'}%`}
          />
        );
      })}

      {selectedOrgan && rows.length > 0 && (
        <div className="absolute left-2 bottom-2 bg-white shadow-xl rounded-lg border p-3 text-sm max-w-[92%] overflow-auto">
          <div className="font-semibold mb-2">{selectedOrgan}</div>
          <table className="min-w-full text-xs border">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-2 py-1">EFO-ID</th>
                <th className="border px-2 py-1">Trait</th>
                <th className="border px-2 py-1 text-right">Percentile (max)</th>
                <th className="border px-2 py-1">PGS Models</th>
                <th className="border px-2 py-1 text-right">PGS Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const href = `/details/${it.efoId}?genome=${encodeURIComponent(genomeName || '')}`;
                return (
                  <tr key={it.efoId} className="hover:bg-gray-50 cursor-pointer" onClick={() => (window.location.href = href)}>
                    <td className="border px-2 py-1 font-mono text-blue-700 underline"><a href={href}>{it.efoId}</a></td>
                    <td className="border px-2 py-1"><a className="hover:underline" href={href}>{it.trait}</a></td>
                    <td className="border px-2 py-1 text-right">{it.percentile != null ? `${it.percentile.toFixed(1)}%` : '–'}</td>
                    <td className="border px-2 py-1 align-top">
                      {it.models && it.models.length ? (
                        <ul className="list-disc list-inside space-y-0.5">
                          {it.models.map((m) => (<li key={m}>{m}</li>))}
                        </ul>
                      ) : '—'}
                    </td>
                    <td className="border px-2 py-1 text-right">{it.pgsCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ---------------- Agent plumbing ----------------
const DEFAULT_EFO_TO_PGS = {
  EFO_0004541: ['PGS000127', 'PGS000128', 'PGS000129', 'PGS000130', 'PGS000131', 'PGS000132', 'PGS000304'],
//   EFO_0004611: ['PGS000061', 'PGS000065', 'PGS000115', 'PGS000310', 'PGS000340', 'PGS000661'],
//   EFO_0004612: ['PGS000060', 'PGS000064', 'PGS000309', 'PGS000660'],
//   EFO_0004530: ['PGS000063', 'PGS000066', 'PGS000312', 'PGS000659'],
//   EFO_0001645: ['PGS000010', 'PGS000011', 'PGS000012', 'PGS000019', 'PGS000057', 'PGS000058', 'PGS000059', 'PGS000116', 'PGS000200', 'PGS000337', 'PGS000349'],
//   EFO_0006335: ['PGS000301', 'PGS002009'],
//   EFO_0004574: ['PGS000062', 'PGS000311', 'PGS000658', 'PGS000677'],
//   EFO_0004458: ['PGS000314', 'PGS000675'],
//   EFO_0006336: ['PGS000302', 'PGS001900'],
};
const CARDIO_EFOS = [
  'EFO_0004541',
//   'EFO_0004611',
//   'EFO_0004612',
//   'EFO_0004530',
//   'EFO_0001645',
//   'EFO_0006335',
//   'EFO_0004574',
//   'EFO_0004458',
//   'EFO_0006336',
];
const initialAgentState = {
  mode: 'auto',
  status: 'idle',
  stepIndex: 0,
  plan: [],
  scratch: {},
  logs: [],
  progress: { current: '', percent: 0 },
  error: null,
};
function agentReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return { ...initialAgentState, mode: state.mode };
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'STATUS':
      return { ...state, status: action.status };
    case 'LOG':
      return { ...state, logs: [...state.logs, action.message] };
    case 'SET_PLAN':
      return { ...state, plan: action.plan, stepIndex: 0 };
    case 'NEXT_STEP':
      return { ...state, stepIndex: state.stepIndex + 1 };
    case 'SET_PROGRESS':
      return { ...state, progress: action.progress };
    case 'SCRATCH_SET':
      return { ...state, scratch: { ...state.scratch, [action.key]: action.value } };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}
async function withRetries(fn, { retries = 2, baseDelayMs = 500, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = baseDelayMs * Math.pow(2, attempt);
        onRetry && onRetry(attempt + 1, wait, err);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}
function makeToolbox({ setAgent }) {
  return {
    validateInput: async (ctx) => {
      const { genomeText } = ctx;
      if (!genomeText || genomeText.trim().length < 10) throw new Error('Keine gültige 23andMe-Datei geladen.');
      setAgent({ type: 'LOG', message: '✅ Eingabe validiert.' });
      return true;
    },
    proposeEFOs: async (ctx) => {
      const efos = Array.from(new Set(ctx.efoIds?.length ? ctx.efoIds : CARDIO_EFOS));
      setAgent({ type: 'LOG', message: `🧭 Gewählte EFOs: ${efos.join(', ')}` });
      return efos;
    },
    computeAllPRS: async (ctx) => {
      const { genomeText, genomeName } = ctx;
      const efos = ctx.efos || CARDIO_EFOS;
      const efoToPgsMap = ctx.efoToPgsMap || DEFAULT_EFO_TO_PGS;
      return await new Promise((resolve, reject) => {
        const worker = new Worker('/workers/prs.worker.js');
        worker.onmessage = (event) => {
          const { results, logs, currentPGS, progress, efoId, aggregated, efoDetailsMap, detailRows } = event.data || {};
          if (Array.isArray(logs) && logs.length) logs.forEach((l) => setAgent({ type: 'LOG', message: l }));
          if (currentPGS && typeof progress === 'number') setAgent({ type: 'SET_PROGRESS', progress: { current: `${efoId || ''} – ${currentPGS}`, percent: progress } });
          if (aggregated && genomeName) {
            const csv = Papa.unparse(aggregated);
            withRetries(() => fetch('/api/saveResults', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genomeName, csvContent: csv }) }).then((r) => r.json()), { onRetry: (n, wait) => setAgent({ type: 'LOG', message: `⏳ Wiederhole saveResults (Versuch ${n}) in ${wait}ms…` }) })
              .then((data) => setAgent({ type: 'LOG', message: data.path ? `✅ CSV gespeichert: ${data.path}` : '⚠️ CSV konnte nicht gespeichert werden.' }))
              .catch((err) => setAgent({ type: 'LOG', message: `❌ saveResults fehlgeschlagen: ${err.message}` }));
          }
          if (detailRows && genomeName) {
            const detailCsv = Papa.unparse(detailRows);
            withRetries(() => fetch('/api/saveResultsCardioDetails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genomeName, csvContent: detailCsv }) }).then((r) => r.json()), { onRetry: (n, wait) => setAgent({ type: 'LOG', message: `⏳ Wiederhole saveResultsCardioDetails (Versuch ${n}) in ${wait}ms…` }) })
              .then((data) => setAgent({ type: 'LOG', message: data.path ? `✅ Detail-CSV gespeichert: ${data.path}` : '⚠️ Detail-CSV konnte nicht gespeichert werden.' }))
              .catch((err) => setAgent({ type: 'LOG', message: `❌ saveResultsCardioDetails fehlgeschlagen: ${err.message}` }));
          }
          if (efoDetailsMap && genomeName) {
            for (const [efoIdKey, detail] of Object.entries(efoDetailsMap)) {
              withRetries(() => fetch('/api/saveEfoDetail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genomeName, efoId: efoIdKey, detail }) }).then((r) => r.json()), { onRetry: (n, wait) => setAgent({ type: 'LOG', message: `⏳ Wiederhole saveEfoDetail(${efoIdKey}) (Versuch ${n}) in ${wait}ms…` }) })
                .then((data) => setAgent({ type: 'LOG', message: data.path ? `✅ Detail-JSON gespeichert für ${efoIdKey}: ${data.path}` : `⚠️ Detail-JSON für ${efoIdKey} konnte nicht gespeichert werden.` }))
                .catch((err) => setAgent({ type: 'LOG', message: `❌ saveEfoDetail(${efoIdKey}) fehlgeschlagen: ${err.message}` }));
            }
          }
          if (results) {
            setAgent({ type: 'SCRATCH_SET', key: 'results', value: results });
            setAgent({ type: 'STATUS', status: 'done' });
            worker.terminate();
            resolve(results);
          }
        };
        worker.onerror = (err) => { worker.terminate(); reject(err); };
        worker.postMessage({ genomeTxt: genomeText, efoIds: Array.from(new Set(efos)), config: { useLocalFiles: true, genomeFileName: genomeName }, efoToPgsMap });
      });
    },
    summarize: async (ctx) => {
      const rows = ctx.results || [];
      if (!rows.length) return { text: 'Keine Ergebnisse.' };
      const worst = [...rows].sort((a, b) => (b.percentile ?? -1) - (a.percentile ?? -1))[0];
      const best = [...rows].sort((a, b) => (a.percentile ?? 101) - (b.percentile ?? 101))[0];
      const text = `Top-Risiko: ${worst?.trait} (${(worst?.percentile ?? NaN).toFixed(1)}%). Niedrigstes Risiko: ${best?.trait} (${(best?.percentile ?? NaN).toFixed(1)}%).`;
      return { text };
    },
  };
}
function makePlan({ goal, efoIds }) {
  return [
    { id: 'validate', name: 'Eingabe prüfen', description: 'Validiert die 23andMe-Datei', tool: 'validateInput', args: {} },
    { id: 'select-efos', name: 'EFOs wählen', description: 'Wählt relevante EFO Traits', tool: 'proposeEFOs', args: { efoIds } },
    { id: 'compute', name: 'PRS berechnen', description: 'Berechnet alle PGS & aggregiert', tool: 'computeAllPRS', args: {} },
    { id: 'summarize', name: 'Zusammenfassen', description: 'Erstellt kurze Risiko-Zusammenfassung', tool: 'summarize', args: {} },
  ];
}

// ---------------- Page ----------------
export default function AgenticPersonalUICardio() {
  const [genomeText, setGenomeText] = useState('');
  const [genomeName, setGenomeName] = useState('');
  const [userGoal, setUserGoal] = useState('Analysiere kardiometabolische Risiken, speichere CSV & Details.');
  const [results, setResults] = useState([]);
  const [organMap, setOrganMap] = useState({});
  const [traitNames, setTraitNames] = useState({});
  const [selectedOrgan, setSelectedOrgan] = useState(null);
  const [showRefs, setShowRefs] = useState(false);

  const [agent, dispatch] = useReducer(agentReducer, initialAgentState);
  const controllerRef = useRef({ cancelled: false });
  const setAgent = (a) => dispatch(a);

  // auto-scroll logs
  useEffect(() => {
    const el = document.getElementById('agent-log');
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.logs]);

  // Load organ mapping & trait labels once
  useEffect(() => {
    fetch('/efo_to_organ.json')
      .then((r) => r.json())
      .then((data) => {
        const cleaned = {};
        for (const organ in data) cleaned[organ] = (data[organ] || []).map((e) => e.trim());
        setOrganMap(cleaned);
      })
      .catch(() => {});
    fetch('/traits.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const map = {};
        (list || []).forEach((t) => { if (t.id && t.label) map[t.id] = t.label; });
        setTraitNames(map);
      })
      .catch(() => {});
  }, []);

  // Organ score aggregation
  const organScores = useMemo(() => {
    if (!results?.length || !Object.keys(organMap).length) return {};
    const byOrgan = {};
    for (const organ of Object.keys(organMap)) {
      const efoIds = new Set(organMap[organ] || []);
      const vals = results
        .filter((r) => efoIds.has(r.efoId))
        .map((r) => (typeof r.percentile === 'number' ? r.percentile : null))
        .filter((v) => v != null);
      byOrgan[organ] = vals.length ? Math.max(...vals) : null;
    }
    return byOrgan;
  }, [results, organMap]);

  // Filtered table by organ (clean)
  const filteredResults = useMemo(() => {
    if (!selectedOrgan || !organMap[selectedOrgan]) return results;
    const ids = new Set(organMap[selectedOrgan]);
    return results.filter((r) => ids.has(r.efoId));
  }, [results, selectedOrgan, organMap]);

  // Top 10 EFOs across all results (by max percentile per EFO)
  const topEfoRows = useMemo(() => {
    if (!results?.length) return [];
    const byEfo = new Map();
    for (const r of results) {
      const entry = byEfo.get(r.efoId) || { efoId: r.efoId, trait: traitNames[r.efoId] || r.trait || 'Unknown trait', maxPercentile: null };
      if (typeof r.percentile === 'number') {
        entry.maxPercentile = entry.maxPercentile == null ? r.percentile : Math.max(entry.maxPercentile, r.percentile);
      }
      if ((!entry.trait || entry.trait === 'Unknown trait') && r.trait) entry.trait = r.trait;
      byEfo.set(r.efoId, entry);
    }
    return Array.from(byEfo.values())
      .sort((a, b) => (b.maxPercentile ?? -Infinity) - (a.maxPercentile ?? -Infinity))
      .slice(0, 10);
  }, [results, traitNames]);

  // Planner & toolbox
  const plan = useMemo(() => makePlan({ goal: userGoal, efoIds: CARDIO_EFOS }), [userGoal]);
  const TOOLBOX = useMemo(() => makeToolbox({ setAgent }), []);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setGenomeText(text.replace(/\0/g, '').trim());
    setGenomeName(file.name.replace(/\.txt$/i, ''));
    setResults([]);
    dispatch({ type: 'RESET' });
    dispatch({ type: 'LOG', message: `📄 Geladen: ${file.name}` });
  };

  const runAgent = async () => {
    if (!genomeText) {
      dispatch({ type: 'ERROR', error: 'Bitte lade eine 23andMe-Datei hoch.' });
      return;
    }
    controllerRef.current.cancelled = false;
    dispatch({ type: 'STATUS', status: 'planning' });
    dispatch({ type: 'SET_PLAN', plan });
    dispatch({ type: 'LOG', message: `🧠 Plan erstellt: ${plan.map((s) => s.name).join(' → ')}` });

    const ctx = { goal: userGoal, genomeText, genomeName, efoToPgsMap: DEFAULT_EFO_TO_PGS, efos: CARDIO_EFOS, results: [] };
    dispatch({ type: 'STATUS', status: 'running' });
    for (let i = 0; i < plan.length; i++) {
      if (controllerRef.current.cancelled) { dispatch({ type: 'LOG', message: '⏹️ Abgebrochen.' }); dispatch({ type: 'STATUS', status: 'idle' }); return; }
      const step = plan[i];
      dispatch({ type: 'LOG', message: `▶️ Schritt ${i + 1}/${plan.length}: ${step.name}` });
      try {
        const tool = TOOLBOX[step.tool];
        if (!tool) throw new Error(`Tool nicht gefunden: ${step.tool}`);
        const output = await withRetries(() => tool({ ...ctx, ...step.args }), { retries: 2, baseDelayMs: 600, onRetry: (n, wait, err) => dispatch({ type: 'LOG', message: `🔁 Retry ${n} für ${step.name} in ${wait}ms – ${err.message}` }) });
        if (step.id === 'select-efos') ctx.efos = output;
        if (step.id === 'compute') ctx.results = output;
        if (step.id === 'summarize') ctx.summary = output;
        dispatch({ type: 'NEXT_STEP' });
      } catch (err) {
        dispatch({ type: 'ERROR', error: `${step.name} fehlgeschlagen: ${err.message}` });
        dispatch({ type: 'LOG', message: `❌ ${step.name} fehlgeschlagen: ${err.message}` });
        return;
      }
    }
    setResults(ctx.results || []);
    if (ctx.summary?.text) dispatch({ type: 'LOG', message: `🧾 Zusammenfassung: ${ctx.summary.text}` });
    dispatch({ type: 'STATUS', status: 'done' });
  };

  const stopAgent = () => { controllerRef.current.cancelled = true; };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-800">Agentic Cardio PGS</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Controls */}
          <div className="col-span-1 space-y-3">
            <label className="block text-sm font-medium text-gray-700">Ziel</label>
            <input className="w-full border rounded p-2" value={userGoal} onChange={(e) => setUserGoal(e.target.value)} placeholder="Beschreibe dein Ziel…" />
            <label className="block text-sm font-medium text-gray-700 mt-2">23andMe-Datei</label>
            <div className="flex items-center gap-2">
              <input type="file" onChange={handleFileChange} accept=".txt" />
              {genomeName && (<span className="text-xs text-gray-600">{genomeName}</span>)}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button onClick={runAgent} disabled={agent.status === 'running' || !genomeText} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded">{agent.status === 'running' ? 'Läuft…' : 'Agent starten'}</button>
              <button onClick={stopAgent} disabled={agent.status !== 'running'} className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-3 py-2 rounded">Stop</button>
              <button onClick={() => dispatch({ type: 'RESET' })} className="bg-white border hover:bg-gray-50 text-gray-900 px-3 py-2 rounded">Zurücksetzen</button>
            </div>
            {agent.status === 'running' && (<div className="mt-2"><ProgressBar currentPGS={agent.progress.current} percent={agent.progress.percent} /></div>)}
          </div>

          {/* Middle: Plan */}
          <div className="col-span-1">
            <h2 className="font-semibold mb-2">Plan</h2>
            <ol className="space-y-2 list-decimal list-inside">
              {plan.map((s, idx) => (
                <li key={s.id} className={`p-2 rounded border ${idx < agent.stepIndex ? 'bg-green-50 border-green-200' : idx === agent.stepIndex && agent.status === 'running' ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-gray-600">{s.description}</div>
                </li>
              ))}
            </ol>
          </div>

          {/* Right: Logs */}
          <div className="col-span-1">
            <h2 className="font-semibold mb-2">Agent-Log</h2>
            <div id="agent-log" className="max-h-72 overflow-y-auto bg-white border border-gray-300 rounded p-3 text-sm font-mono text-gray-800 shadow-inner">
              {agent.logs.map((l, i) => (<div key={i}>{l}</div>))}
              {agent.error && <div className="text-red-600">Fehler: {agent.error}</div>}
            </div>
          </div>
        </div>

        {/* Organ + Interpretation grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
          <div>
            <h2 className="text-lg font-semibold mb-2">Organbasierte Übersicht</h2>
            <OrganView
              organScores={organScores}
              organMap={organMap}
              results={results}
              traitNames={traitNames}
              selectedOrgan={selectedOrgan}
              onSelectOrgan={(name) => setSelectedOrgan((prev) => (prev === name ? null : name))}
              genomeName={genomeName}
            />
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-2">Interpretation der Ergebnisse</h2>
            <div className="border rounded-lg bg-white shadow p-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="py-1">Perzentilbereich</th>
                    <th className="py-1">Risikoeinstufung</th>
                    <th className="py-1">Quelle</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>{'< 20 %'}</td><td>Unterdurchschnittliches Risiko</td><td>Lewis & Vassos (2020)</td></tr>
                  <tr><td>20–80 %</td><td>Durchschnittliches Risiko</td><td>Torkamani et al. (2018)</td></tr>
                  <tr><td>{'> 80 %'}</td><td>Erhöhtes Risiko</td><td>Inouye et al. (2018)</td></tr>
                  <tr><td>{'> 95 %'}</td><td>Stark erhöhtes Risiko</td><td>Khera et al. (2018)</td></tr>
                </tbody>
              </table>
              <button className="mt-2 text-blue-700 hover:underline text-sm" onClick={() => setShowRefs((v) => !v)}>{showRefs ? 'Wissenschaftliche Referenzen ausblenden' : 'Wissenschaftliche Referenzen anzeigen'}</button>
              {showRefs && (
                <ul className="mt-2 text-sm list-disc list-inside text-gray-700">
                  <li>Khera AV et al., NEJM 2018</li>
                  <li>Inouye M et al., Nat Genet 2018</li>
                  <li>Torkamani A et al., Nat Rev Genet 2018</li>
                  <li>Lewis CM & Vassos E, Mol Psychiatry 2020</li>
                </ul>
              )}
            </div>
            <div className="mt-3 text-sm text-gray-700">
              {selectedOrgan ? (<>
                Gefiltert nach: <span className="font-medium">{selectedOrgan}</span> (<button className="underline" onClick={() => setSelectedOrgan(null)}>Filter entfernen</button>)
              </>) : 'Kein Organfilter aktiv'}
            </div>
          </div>
        </div>

        {/* Top 10 EFOs (overall) */}
        {topEfoRows.length > 0 && (
          <div className="mt-6">
            <h3 className="font-semibold mb-2">Top 10 EFOs</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm table-auto border">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-2 py-1">EFO ID</th>
                    <th className="border px-2 py-1">Trait</th>
                    <th className="border px-2 py-1 text-right">Percentile (max)</th>
                  </tr>
                </thead>
                <tbody>
                  {topEfoRows.map((row) => {
                    const href = `/details/${row.efoId}?genome=${encodeURIComponent(genomeName)}`;
                    return (
                      <tr key={row.efoId} className="hover:bg-gray-50 cursor-pointer" onClick={() => (window.location.href = href)}>
                        <td className="border px-2 py-1 font-mono text-blue-700 underline"><a href={href}>{row.efoId}</a></td>
                        <td className="border px-2 py-1"><a className="hover:underline" href={href}>{row.trait}</a></td>
                        <td className="border px-2 py-1 text-right">{row.maxPercentile != null ? `${row.maxPercentile.toFixed(1)}%` : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Results table (filtered) */}
        {filteredResults?.length > 0 && (
          <div className="mt-6">
            <h3 className="font-semibold mb-2">Ergebnisse</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto border text-sm">
                <thead>
                  <tr>
                    <th className="border px-2 py-1">EFO ID</th>
                    <th className="border px-2 py-1">Trait</th>
                    <th className="border px-2 py-1">Percentile</th>
                    <th className="border px-2 py-1">PGS Model</th>
                    <th className="border px-2 py-1">PGS Count</th>
                  </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.efoId}>
                        <td className="border px-2 py-1 font-mono text-blue-700 underline">
                            <a href={`/details/${r.efoId}?genome=${encodeURIComponent(genomeName || '')}`}>
                            {r.efoId}
                            </a>
                        </td>
                        <td className="border px-2 py-1">{traitNames[r.efoId] ?? r.trait}</td>
                        <td className="border px-2 py-1">{typeof r.percentile === 'number' ? r.percentile.toFixed(1) : '—'}</td>
                        <td className="border px-2 py-1">
                            {[r.id, (r.name || r.label || r.shortName || '')]
                            .filter(Boolean)
                            .join(' — ') || '—'}
                        </td>
                        <td className="border px-2 py-1">
                            {r.pgsCount ?? (Array.isArray(r.ids) ? r.ids.length : (r.count ?? 1))}
                        </td>
                        </tr>
                    ))}
                    </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
