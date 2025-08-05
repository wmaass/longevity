import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { pipeline } from '@xenova/transformers';

let summarizerBackup = null;

// 📡 API-Handler
export default async function handler(req, res) {
  const requestLogs = [];

  function log(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}`;
    requestLogs.push(entry);
    console.log(entry);
  }

  async function fetchEuropePMCPapers(rsid) {
    log(`🔍 Suche Paper zu ${rsid} auf EuropePMC…`);
    const query = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${rsid}&format=json&pageSize=5`;

    try {
      const res = await fetch(query);
      const json = await res.json();
      const papers = json.resultList?.result || [];

      if (papers.length === 0) {
        log(`⚠️ Kein Paper gefunden zu ${rsid}`);
        return { combinedText: '', doi: null };
      }

      const paper = papers[0];
      const title = paper.title || 'Untitled';
      const abstract = (paper.abstractText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const doiLink = paper.doi ? `https://doi.org/${paper.doi}` : null;

      log(`📄 Gefunden: ${title}`);
      if (doiLink) log(`🔗 DOI-Link: ${doiLink}`);
      log(`📏 Abstract-Länge: ${abstract.length} Zeichen`);

      const combinedText = `Title: ${title}\n${doiLink ? `Link: ${doiLink}\n` : ''}Abstract: ${abstract}`;
      return { combinedText, doi: doiLink };

    } catch (err) {
      log(`❌ Fehler beim Europe PMC Fetch: ${err.message}`);
      return { combinedText: '', doi: null };
    }
  }

  async function generateWithOllama(rsid, text) {
    const label = `🧠 Ollama Request ${rsid}`;
    log(`🚀 Sende LLM-Request an mediphi-lite für ${rsid}`);
    console.time(label);

    const prompt = `Summarize the following PubMed abstract for a medical professional:\n\n${text}`;

    try {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mediphi-lite', prompt, stream: false }),
      });

      const raw = await res.text();

      if (!res.ok) {
        log(`❌ HTTP ${res.status} bei LLM-Request: ${raw}`);
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (jsonErr) {
        log(`❌ JSON-Parsing-Fehler: ${jsonErr.message}`);
        return null;
      }

      const summary = parsed.response?.trim();
      if (!summary) {
        log(`⚠️ Leere oder fehlende Antwort von mediphi-lite`);
        return null;
      }

      log(`✅ LLM-Zusammenfassung erfolgreich (${summary.length} Zeichen)`);
      return summary;

    } catch (err) {
      log(`❌ Fehler bei LLM-Zusammenfassung: ${err.message}`);
      return null;
    } finally {
      console.timeEnd(label);
    }
  }

  async function generateWithDistilBART(text) {
    if (!summarizerBackup) {
      log(`⚠️ Fallback: Lade DistilBART-Modell…`);
      summarizerBackup = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
      log(`✅ DistilBART-Modell geladen`);
    }
    log(`⚙️ Generiere Fallback-Zusammenfassung…`);
    const result = await summarizerBackup(text);
    const summary = result[0]?.summary_text?.trim() || '';
    log(`✅ Fallback-Zusammenfassung erfolgreich (${summary.length} Zeichen)`);
    return summary;
  }

  function loadCachedSummary(rsid) {
    const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
    return fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;
  }

  async function generateSummary(rsid) {
    const { combinedText, doi } = await fetchEuropePMCPapers(rsid);
    if (!combinedText.trim()) {
      log(`⚠️ Keine Paper gefunden für ${rsid}`);
      return { text: `No Europe PMC papers available for SNP ${rsid}.`, url: doi, local: false };
    }

    const summary =
      (await generateWithOllama(rsid, combinedText)) ||
      (await generateWithDistilBART(combinedText));

    if (!summary) {
      log(`⚠️ Keine Zusammenfassung erzeugt`);
    }

    return { text: summary, url: doi, local: false };
  }

  // Haupt-Requestverarbeitung
  const { rsid } = req.query;
  if (!rsid) {
    return res.status(400).json({
      error: 'Missing rsid parameter',
      logs: requestLogs,
    });
  }

  const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
  let summaryText = null;
  let url = null;
  let isLocal = false;

  try {
    if (fs.existsSync(cachePath)) {
      log(`📦 Cache-Hit: Lade gespeicherte Zusammenfassung für ${rsid}`);
      summaryText = fs.readFileSync(cachePath, 'utf8');
      const { doi } = await fetchEuropePMCPapers(rsid);
      url = doi;
      isLocal = true;
    } else {
      log(`📤 Keine Zusammenfassung im Cache. Generiere neue für ${rsid}`);
      const result = await generateSummary(rsid);
      summaryText = result?.text?.trim();
      url = result?.url;

      if (summaryText) {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, summaryText, 'utf8');
        log(`💾 Zusammenfassung gespeichert unter: ${cachePath}`);
        isLocal = false;
      } else {
        log(`❌ Zusammenfassung fehlgeschlagen`);
        return res.status(404).json({
          text: 'Keine Zusammenfassung verfügbar.',
          url: null,
          local: false,
          logs: requestLogs,
        });
      }
    }

    res.status(200).json({
      text: summaryText,
      url,
      local: isLocal,
      logs: requestLogs,
    });

  } catch (err) {
    log(`❌ Unerwarteter Fehler: ${err.message}`);
    res.status(500).json({
      text: 'Fehler beim Generieren der Zusammenfassung.',
      url: null,
      local: false,
      logs: requestLogs,
    });
  }
}
