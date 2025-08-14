// Node 18+ script
// Usage: node tools/build_pgs_beta_map_from_perf_v3.mjs [input_csv] [output_json]
// Default input: public/pgs_scores/metadata/pgs_all_metadata_performance_metrics.csv
// Default output: public/pgs_beta_map.json

import fs from 'node:fs';
import path from 'node:path';

const inCsvPath = process.argv[2] || 'public/pgs_scores/metadata/pgs_all_metadata_performance_metrics.csv';
const outJsonPath = process.argv[3] || 'public/pgs_beta_map.json';

if (!fs.existsSync(inCsvPath)) {
  console.error(`Input CSV not found: ${inCsvPath}`);
  process.exit(1);
}

// --- CSV/TSV parser with delimiter auto-detect and quoted fields ---
function parseTable(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i++];
    if (inQuotes) {
      if (c === '"') {
        if (text[i] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignore */ }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(inCsvPath, 'utf8');
const table = parseTable(raw.trim());
if (!table.length) { console.error('Empty CSV/TSV'); process.exit(1); }
const header = table[0].map(h => h.trim());
const headerLC = header.map(h => h.toLowerCase());
const rows = table.slice(1);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const headerNorm = header.map(norm);

const findIdx = (cands, fuzzy=true) => {
  // exact (normalized) match first
  for (const name of cands) {
    const idx = headerNorm.indexOf(norm(name));
    if (idx >= 0) return idx;
  }
  if (fuzzy) {
    // contains-match on normalized strings
    for (let i=0;i<headerNorm.length;i++) {
      for (const name of cands) {
        if (headerNorm[i].includes(norm(name))) return i;
      }
    }
  }
  return -1;
};

// Column indices (robust set) — matches your example headers like "Hazard Ratio (HR)", "Odds Ratio (OR)", "Beta"
const iPGS  = findIdx(['pgs_id','score_id','pgs','evaluated score']);
const iType = findIdx(['effect_type','pgs_effect_type','effect_type_label']);
const iBeta = findIdx(['beta_per_sd','beta','beta sd','beta effect']);
const iHR   = findIdx(['hr_per_sd','hazard ratio per sd','hr','hazard ratio','hazard ratio (hr)']);
const iOR   = findIdx(['or_per_sd','odds ratio per sd','or','odds ratio','odds ratio (or)']);
const iEff  = findIdx(['effect_size','effect value']);
const iN    = findIdx(['n','n samples','sample size','sample number','samples training','samples evaluation']);

if (iPGS < 0) {
  console.error('Could not find a PGS id column. Columns found:\n', header.join(', '));
  process.exit(1);
}
if (iBeta < 0 && iHR < 0 && iOR < 0 && iEff < 0) {
  console.error('No effect-size columns found (Beta/HR/OR). Columns found:\n', header.join(', '));
  process.exit(1);
}

const TYPE_PRIORITY = ['beta','hr','or'];
// Extract the first numeric token from a cell, e.g., "1.55 [1.52,1.58]" -> 1.55
const leadingNumber = (s) => {
  const m = String(s||'').match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

function toBeta(effectType, value, sourceCol) {
  const t = (effectType || '').toLowerCase();
  if (sourceCol === 'beta') return value;
  if (sourceCol === 'hr')   return Math.log(value);
  if (sourceCol === 'or')   return Math.log(value);
  if (t.includes('beta')) return value;
  if (t.includes('hr'))   return Math.log(value);
  if (t.includes('or'))   return Math.log(value);
  return value; // assume already log-scale if ambiguous
}

const best = new Map(); // pgsId -> { beta, type, weight, pri }
for (const r of rows) {
  const id = (r[iPGS] || '').trim();
  if (!id) continue;

  let src = null, val = NaN;
  if (iBeta >= 0 && r[iBeta] !== undefined && r[iBeta] !== '') { src = 'beta'; val = leadingNumber(r[iBeta]); }
  else if (iHR >= 0 && r[iHR] !== undefined && r[iHR] !== '') { src = 'hr'; val = leadingNumber(r[iHR]); }
  else if (iOR >= 0 && r[iOR] !== undefined && r[iOR] !== '') { src = 'or'; val = leadingNumber(r[iOR]); }
  else if (iEff >= 0 && r[iEff] !== undefined && r[iEff] !== '') { src = 'effect'; val = leadingNumber(r[iEff]); }
  if (!Number.isFinite(val)) continue;

  const effType = iType >= 0 ? r[iType] : '';
  const beta = toBeta(effType, val, src);
  const pri = TYPE_PRIORITY.indexOf(src === 'effect'
    ? (effType?.toLowerCase().includes('beta') ? 'beta' : effType?.toLowerCase().includes('hr') ? 'hr' : effType?.toLowerCase().includes('or') ? 'or' : 'or')
    : src);
  const weight = iN >= 0 ? (parseInt(leadingNumber(r[iN]) || '0', 10) || 0) : 0;

  const prev = best.get(id);
  if (!prev) { best.set(id, { beta, type: src || effType || 'effect', weight, pri }); continue; }
  if ((pri >= 0 && (prev.pri == null || pri < prev.pri)) || (pri === prev.pri && weight > prev.weight)) {
    best.set(id, { beta, type: src || effType || 'effect', weight, pri });
  }
}

const out = {};
for (const [id, { beta }] of best.entries()) {
  if (Number.isFinite(beta)) out[id] = beta;
}

fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
fs.writeFileSync(outJsonPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${outJsonPath} with ${Object.keys(out).length} PGS betas`);
