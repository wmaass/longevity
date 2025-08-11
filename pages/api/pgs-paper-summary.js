// pages/api/pgs-paper-summary.js
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { pipeline } from '@xenova/transformers';

let summarizerBackup = null;

export default async function handler(req, res) {
  const logs = [];
  const log = (m) => { const t = `[${new Date().toISOString()}] ${m}`; logs.push(t); console.log(t); };

  const { pgsId } = req.query;
  if (!pgsId || !/^PGS\d{6,}/.test(pgsId)) {
    return res.status(400).json({ error: 'Missing or invalid pgsId', logs });
  }

  const cachePath = path.join(process.cwd(), 'public', 'summaries', 'pgs', `${pgsId}.txt`);
  try {
    // 1) serve from cache if present
    if (fs.existsSync(cachePath)) {
      log(`📦 Cache-Hit: ${cachePath}`);
      const text = fs.readFileSync(cachePath, 'utf8');
      // Try to re-derive DOI link (cheap)
      const doi = await tryGetDoiFromPGS(pgsId, log);
      return res.status(200).json({ text, url: doi ? `https://doi.org/${doi}` : null, local: true, logs });
    }

    // 2) get DOI/PMID from PGS Catalog
    const { doi, pmid } = await getPublicationIdsForPGS(pgsId, log);

    // 3) fetch abstract (prefer DOI, else PMID, else search by free text)
    const epmc = await fetchFromEuropePMC({ doi, pmid, pgsId }, log);
    if (!epmc?.abstract) {
      log('⚠️ Keine Abstract-Daten gefunden');
      return res.status(404).json({ text: 'No Europe PMC record for this PGS publication.', url: null, local: false, logs });
    }

    // 4) summarize
    const combined = `Title: ${epmc.title}\n${epmc.url ? `Link: ${epmc.url}\n` : ''}Abstract: ${epmc.abstract}`;
    const summary =
      (await summarizeWithOllama(pgsId, combined, log)) ||
      (await summarizeWithDistilBART(combined, log));

    if (!summary) {
      return res.status(500).json({ text: 'Failed to generate summary.', url: epmc.url || null, local: false, logs });
    }

    // 5) cache
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, summary, 'utf8');
    log(`💾 Gespeichert: ${cachePath}`);

    res.status(200).json({ text: summary, url: epmc.url || null, local: false, logs });
  } catch (err) {
    log(`❌ Fehler: ${err.message}`);
    res.status(500).json({ text: 'Server error', url: null, local: false, logs });
  }
}

/* ---------- helpers ---------- */

async function getPublicationIdsForPGS(pgsId, log) {
  const url = `https://www.pgscatalog.org/rest/score/${encodeURIComponent(pgsId)}`;
  log(`📥 PGS REST: ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`PGS REST HTTP ${r.status}`);
  const j = await r.json();

  // Heuristics: different shapes have appeared over time
  const pub =
    j?.publication ||
    (Array.isArray(j?.publications) ? j.publications[0] : null) ||
    null;

  let pubId = pub?.id || j?.publication_id || null;
  let doi = pub?.doi || null;
  let pmid = pub?.pmid || pub?.PMID || null;

  if (!doi || !pmid) {
    if (!pubId && typeof j?.publication === 'string') pubId = j.publication;
    if (pubId) {
      const purl = `https://www.pgscatalog.org/rest/publication/${pubId}`;
      log(`📥 PGS Publication: ${purl}`);
      const pr = await fetch(purl);
      if (pr.ok) {
        const pj = await pr.json();
        doi = doi || pj?.doi || (Array.isArray(pj?.doi) ? pj.doi[0] : null);
        pmid = pmid || pj?.pmid || pj?.PMID || null;
      }
    }
  }

  log(`🔎 IDs → DOI: ${doi || '—'} | PMID: ${pmid || '—'}`);
  return { doi, pmid };
}

async function fetchFromEuropePMC({ doi, pmid, pgsId }, log) {
  const base = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=1&query=';
  let q = null;
  if (doi) q = `DOI:${encodeURIComponent(doi)}`;
  else if (pmid) q = `EXT_ID:${encodeURIComponent(pmid)}`;
  else q = encodeURIComponent(pgsId); // last resort

  const url = `${base}${q}`;
  log(`🔍 EuropePMC: ${url}`);
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const hit = j?.resultList?.result?.[0];
  if (!hit) return null;

  const title = (hit.title || '').trim();
  const abstract = (hit.abstractText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const link = hit?.doi ? `https://doi.org/${hit.doi}` : (hit?.pmid ? `https://europepmc.org/abstract/MED/${hit.pmid}` : null);
  return { title, abstract, url: link };
}

async function summarizeWithOllama(tag, text, log) {
  try {
    log(`🧠 Ollama summarization for ${tag}`);
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mediphi-lite', prompt: `Summarize for a medical professional:\n\n${text}`, stream: false }),
    });
    const raw = await r.text();
    if (!r.ok) { log(`❌ Ollama HTTP ${r.status}: ${raw}`); return null; }
    const parsed = JSON.parse(raw);
    const out = parsed?.response?.trim() || null;
    if (out) log(`✅ Ollama OK (${out.length} chars)`); else log('⚠️ Ollama empty');
    return out;
  } catch (e) {
    log(`❌ Ollama error: ${e.message}`);
    return null;
  }
}

async function summarizeWithDistilBART(text, log) {
  if (!summarizerBackup) {
    log('⚠️ Lade DistilBART Fallback…');
    summarizerBackup = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
  }
  log('⚙️ DistilBART summarizing…');
  const r = await summarizerBackup(text);
  const out = r?.[0]?.summary_text?.trim() || '';
  log(`✅ DistilBART OK (${out.length} chars)`);
  return out;
}

async function tryGetDoiFromPGS(pgsId, log) {
  try {
    const { doi } = await getPublicationIdsForPGS(pgsId, log);
    return doi || null;
  } catch { return null; }
}
