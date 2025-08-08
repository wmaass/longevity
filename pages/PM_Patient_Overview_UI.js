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

// Named export so your page stays the default export
export const OrganView = ({
  organScores = {},
  organMap = {},
  results = [],
  traitNames = {},
  selectedOrgan,
  onSelectOrgan = () => {},
  genomeName = '',
}) => {
  // color: green -> yellow -> red
  const hex = (c) => c.toString(16).padStart(2, '0');
  const rgb = (r, g, b) => `#${hex(r)}${hex(g)}${hex(b)}`;
  const lerp = (a, b, t) => a + (b - a) * t;
  const blend = (a, b, t) =>
    rgb(
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t))
    );
  const getColorForPercentile = (p) => {
    if (!Number.isFinite(p)) return '#cccccc';
    const t = Math.max(0, Math.min(1, p / 100));
    const green = [22, 163, 74];
    const yellow = [250, 204, 21];
    const red = [220, 38, 38];
    return t <= 0.5 ? blend(green, yellow, t / 0.5) : blend(yellow, red, (t - 0.5) / 0.5);
  };

  // circles on sides + organ targets
  const organs = [
    { name: 'Gehirn', x: 580, y: 80,  x1: 360, y1: 70  },
    { name: 'Herz',   x: 580, y: 180, x1: 340, y1: 220 },
    { name: 'Magen',  x: 580, y: 280, x1: 370, y1: 280 },
    { name: 'Darm',   x: 580, y: 380, x1: 360, y1: 360 },
    { name: 'Blase',  x: 580, y: 460, x1: 350, y1: 420 },
    { name: 'Lunge',  x: 120, y: 100, x1: 320, y1: 170 },
    { name: 'Leber',  x: 120, y: 200, x1: 310, y1: 280 },
    { name: 'Niere',  x: 120, y: 300, x1: 320, y1: 310 },
    { name: 'Blutgefäße', x: 120, y: 400, x1: 140, y1: 400 },
  ];

  // table rows for selected organ (grouped per EFO)
  const efoList =
    selectedOrgan && Array.isArray(organMap[selectedOrgan]) ? organMap[selectedOrgan] : [];
  const rows = React.useMemo(() => {
    const byEfo = new Map();
    efoList.forEach((id) =>
      byEfo.set(id, {
        efoId: id,
        trait: traitNames[id] || 'Unknown trait',
        pgsCount: 0,
        percentiles: [],
        models: [],
      })
    );
    (results || []).forEach((r) => {
      if (!byEfo.has(r.efoId)) return;
      const v = byEfo.get(r.efoId);
      v.trait = r.trait || v.trait;
      v.pgsCount += 1;
      if (Number.isFinite(r.percentile)) v.percentiles.push(r.percentile);
      const label = [r.id, (r.name || r.label || r.shortName || '')]
        .filter(Boolean)
        .join(' — ');
      if (label && !v.models.includes(label)) v.models.push(label);
    });
    return Array.from(byEfo.values()).map((v) => ({
      ...v,
      percentile: v.percentiles.length ? Math.max(...v.percentiles) : null,
    }));
  }, [efoList, results, traitNames]);

  // SVG canvas to match coordinates above
  const W = 700, H = 520;

  return (
    <div className="relative w-full max-w-5xl mx-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
        </defs>

        {/* Background body */}
        <image href="/images/bodymap.png" x="0" y="0" width={W} height={H} />

        {/* Side circles + connector arrows */}
        {organs.map((o) => {
          const fill = getColorForPercentile(organScores[o.name]);
          const stroke = selectedOrgan === o.name ? '#2563eb' : '#ffffff';
          const sw = selectedOrgan === o.name ? 4 : 2;
          return (
            <g
              key={o.name}
              className="cursor-pointer"
              onClick={() => onSelectOrgan(o.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? onSelectOrgan(o.name) : null)}
            >
              <line
                x1={o.x}
                y1={o.y}
                x2={o.x1}
                y2={o.y1}
                stroke="#9ca3af"
                strokeWidth="2"
                markerEnd="url(#arrow)"
              />
              <circle cx={o.x} cy={o.y} r="14" fill={fill} stroke={stroke} strokeWidth={sw} />
            </g>
          );
        })}
      </svg>

      {/* Details panel (wider) */}
      {selectedOrgan && rows.length > 0 && (
        <div className="absolute left-2 bottom-2 bg-white shadow-xl rounded-lg border p-3 text-sm max-w-[95vw] overflow-auto">
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
                  <tr key={it.efoId} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}>
                    <td className="border px-2 py-1 font-mono text-blue-700 underline">
                      <a href={href} target="_blank" rel="noopener noreferrer">{it.efoId}</a>
                    </td>
                    <td className="border px-2 py-1">
                      <a className="hover:underline" href={href} target="_blank" rel="noopener noreferrer">{it.trait}</a>
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {it.percentile != null ? `${it.percentile.toFixed(1)}%` : '–'}
                    </td>
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
};


//export { OrganView };



// ---------------- Agent plumbing ----------------
const DEFAULT_EFO_TO_PGS = {
  EFO_0004541: ['PGS000127', 'PGS000128', 'PGS000129', 'PGS000130', 'PGS000131', 'PGS000132', 'PGS000304'],
  EFO_0004611: ['PGS000061', 'PGS000065', 'PGS000115', 'PGS000310', 'PGS000340', 'PGS000661'],
  EFO_0004612: ['PGS000060', 'PGS000064', 'PGS000309', 'PGS000660'],
  EFO_0004530: ['PGS000063', 'PGS000066', 'PGS000312', 'PGS000659'],
  EFO_0001645: ['PGS000010', 'PGS000011', 'PGS000012', 'PGS000019', 'PGS000057', 'PGS000058', 'PGS000059', 'PGS000116', 'PGS000200', 'PGS000337', 'PGS000349'],
  EFO_0006335: ['PGS000301', 'PGS002009'],
  EFO_0004574: ['PGS000062', 'PGS000311', 'PGS000658', 'PGS000677'],
  EFO_0004458: ['PGS000314', 'PGS000675'],
  EFO_0006336: ['PGS000302', 'PGS001900'],
};
const CARDIO_EFOS = [
  'EFO_0004541',
  'EFO_0004611',
  'EFO_0004612',
  'EFO_0004530',
  'EFO_0001645',
  'EFO_0006335',
  'EFO_0004574',
  'EFO_0004458',
  'EFO_0006336',
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
                  {filteredResults.map((r, i) => (
                    <tr key={i}>
                      <td className="border px-2 py-1">
                        <a
                          className="text-blue-600 hover:underline"
                          href={`/details/${r.efoId}?genome=${encodeURIComponent(genomeName)}`}
                        >
                          {r.efoId}
                        </a>
                      </td>
                      <td className="border px-2 py-1">{traitNames[r.efoId] ?? r.trait}</td>
                      <td className="border px-2 py-1">
                        {typeof r.percentile === 'number' ? r.percentile.toFixed(1) : '—'}
                      </td>
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
