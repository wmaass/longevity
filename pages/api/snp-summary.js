import fs from 'fs';
import path from 'path';
//import fetch from 'node-fetch';
import { pipeline } from '@xenova/transformers';

// (optional) ONNXRuntime-Logs dämpfen
process.env.ORT_LOG_SEVERITY_LEVEL = process.env.ORT_LOG_SEVERITY_LEVEL ?? '3';

// ==== Konfiguration ====
const OLLAMA_URL        = process.env.OLLAMA_URL        || 'http://127.0.0.1:11434';
const OLLAMA_MODEL      = process.env.OLLAMA_MODEL      || 'llama3';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 20000); // erhöht
const SPEECH_MODE       = (process.env.SPEECH_MODE || 'deutsch').toLowerCase();

// Sprachmodus festlegen: "fachlich", "einfach", "deutsch", "englisch"
// Sprachmodus: "fachlich", "einfach", "deutsch", "englisch"
// rsid ist optional; ohne rsid fällt es auf "the SNP of interest" zurück.
function buildPrompt(text, rsid) {
  const snp = rsid ? String(rsid) : 'the SNP of interest';

  switch (SPEECH_MODE) {
    case 'fachlich':
      return [
        `You are a careful scientific summarizer. Based ONLY on the provided title/abstract (do not invent data), extract findings specifically about ${snp}.`,
        `Answer in concise bullet points. Include, if present:`,
        `• Is ${snp} explicitly mentioned (yes/no)? Gene/context`,
        `• Associated trait/phenotype`,
        `• Risk/protective allele and genotype effects (e.g., AA vs AG vs GG)`,
        `• Effect size (OR/HR/β), 95% CI, p-value`,
        `• Population/cohort (n, ancestry)`,
        `• Study design`,
        `• Limitations / caveats`,
        `If ${snp} is not mentioned, say so explicitly and do NOT infer beyond the text.`,
        ``,
        text
      ].join('\n');

    case 'einfach':
      return [
        `Erkläre **nur auf Basis des Textes** und ohne etwas dazuzuerfinden, was diese Studie speziell über ${snp} aussagt.`,
        `Nutze 4–6 einfache Stichpunkte:`,
        `• Wurde ${snp} genannt?`,
        `• Worum geht es (Merkmal/Krankheit)?`,
        `• Welche Variante/Allele ist betroffen (falls erwähnt)?`,
        `• Richtung/Größe des Effekts (falls erwähnt)`,
        `• Für wen gilt das (Population) und was sind Grenzen der Studie?`,
        `Wenn ${snp} nicht erwähnt wird, schreibe: „Im Text wird ${snp} nicht explizit erwähnt.“`,
        ``,
        text
      ].join('\n');

    case 'deutsch':
      return [
        `Fasse **ausschließlich** anhand des bereitgestellten Titels/Abstracts prägnant zusammen, was diese Publikation speziell zu ${snp} berichtet.`,
        `Stichpunkte (fachlich):`,
        `• Erwähnung von ${snp} (ja/nein), Gen/Kontext`,
        `• Assoziiertes Merkmal/Phänotyp`,
        `• Risiko-/Schutzallel und Genotyp-Effekte`,
        `• Effektgröße (OR/HR/β), 95%-KI, p-Wert`,
        `• Population/Kohorte (n, Abstammung) und Studiendesign`,
        `• Limitationen`,
        `Falls ${snp} nicht erwähnt wird, schreibe dies explizit und erfinde keine Werte.`,
        ``,
        text
      ].join('\n');

    case 'englisch':
      return [
        `Summarize ONLY from the provided text what this paper reports specifically about ${snp}.`,
        `Use concise bullets and include (if available): mention of ${snp}, trait, allele/genotype effects, effect size (OR/HR/β + CI + p), population, design, limitations.`,
        `If ${snp} is not mentioned, say so explicitly and do not infer beyond the text.`,
        ``,
        text
      ].join('\n');

    default:
      return [
        `Summarize what this paper finds specifically about ${snp}, based only on the provided text. If it is not mentioned, say so.`,
        ``,
        text
      ].join('\n');
  }
}



// ==== Helfer ====
async function fetchWithTimeout(url, opts = {}, ms = OLLAMA_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function isOllamaUp() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/version`);
    return r.ok;
  } catch {
    return false;
  }
}

async function modelExists(name) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) return false;
    const j = await r.json();
    return Array.isArray(j.models) && j.models.some(m =>
      m.name === name || m.name?.startsWith(`${name}:`)
    );
  } catch {
    return false;
  }
}

// === HMR-sichere Singletons ===
function nextOllamaSeq() {
  globalThis.__ollamaSeq = (globalThis.__ollamaSeq ?? 0) + 1;
  return globalThis.__ollamaSeq;
}
async function getSummarizerBackup(log) {
  if (!globalThis.__summarizerBackup) {
    log('⚠️ Fallback: Lade DistilBART-Modell…');
    globalThis.__summarizerBackup = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
    log('✅ DistilBART-Modell geladen');
  }
  return globalThis.__summarizerBackup;
}

// --- Stream-Reader für Ollama NDJSON (Web Streams + Node Readable) ---
function isWebReadable(body) {
  return body && typeof body.getReader === 'function';
}

async function readOllamaStream(res) {
  if (!res || !res.body) return '';

  // 1) Web Streams (Node >=18 native fetch / Next.js API Route)
  if (isWebReadable(res.body)) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);         // NDJSON
          if (obj.response) acc += obj.response;
          if (obj.done) return acc.trim();
        } catch {
          // unvollständige Zeile -> weiterlesen
        }
      }
    }
    return acc.trim();
  }

  // 2) Node.js Readable (Fallback)
  let acc = '';
  for await (const buf of res.body) {
    const chunk = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    const lines = chunk.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) acc += obj.response;
        if (obj.done) return acc.trim();
      } catch {
        // ignore
      }
    }
  }
  return acc.trim();
}


function trimForCtx(text, maxChars = 8000) {
  if (!text || text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n…\n${tail}`;
}

async function ensureOllamaWarmedUp(log) {
  if (globalThis.__ollamaWarmedUp) return true;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: 'OK',
        stream: false,
        options: { num_predict: 1, temperature: 0, keep_alive: '5m' },
      }),
    });
    if (res.ok) {
      globalThis.__ollamaWarmedUp = true;
      log('🔥 Ollama warm-up erfolgreich (Modell im Speicher).');
      return true;
    }
  } catch (e) {
    log(`⚠️ Warm-up fehlgeschlagen: ${e.message}`);
  }
  return false;
}

// 📡 API-Handler
export default async function handler(req, res) {
  const requestLogs = [];
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}`;
    requestLogs.push(entry);
    console.log(entry);
  };

  log(`🧪 OLLAMA_URL=${OLLAMA_URL} OLLAMA_MODEL=${OLLAMA_MODEL} SPEECH_MODE=${SPEECH_MODE}`);
  log(`⏱️ OLLAMA_TIMEOUT_MS=${OLLAMA_TIMEOUT_MS}`);

  async function fetchEuropePMCPapers(rsid) {
    log(`🔍 Suche Paper zu ${rsid} auf EuropePMC…`);

    // präzisere Query: Suche in Titel ODER Abstract, resultType=core liefert eher abstractText
    const query =
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
      `?query=(TITLE:${encodeURIComponent(rsid)}%20OR%20ABSTRACT:${encodeURIComponent(rsid)})` +
      `&format=json&pageSize=20&resultType=core`;

    try {
      const r = await fetch(query);
      const json = await r.json();
      const papers = json.resultList?.result || [];

      if (papers.length === 0) {
        log(`⚠️ Kein Paper gefunden zu ${rsid}`);
        return { combinedText: '', url: null };
      }

      const scored = papers.map(p => {
        const title = p.title || '';
        const abstractText = (p.abstractText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const year = Number(p.pubYear) || 0;
        const hasAbstract = abstractText.length > 0;

        return {
          p,
          abstractText,
          score:
            (p.doi ? 4 : 0) +
            (p.pmid ? 3 : 0) +
            (p.pmcid ? 2 : 0) +
            (title.toLowerCase().includes(rsid.toLowerCase()) ? 2 : 0) +
            (abstractText.toLowerCase().includes(rsid.toLowerCase()) ? 3 : 0) +
            (hasAbstract ? 2 : -2) +
            (year / 10000),
        };
      }).sort((a, b) => b.score - a.score);

      const best = scored[0];
      const paper = best.p;
      const title = paper.title || 'Untitled';
      const abstract = best.abstractText;

      let url = null;
      if (paper.doi)       url = `https://doi.org/${paper.doi}`;
      else if (paper.pmid) url = `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`;
      else if (paper.pmcid) url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/`;
      else if (paper.id && paper.source) url = `https://europepmc.org/article/${paper.source}/${paper.id}`;
      else if (paper.fullTextUrlList?.fullTextUrl?.[0]?.url) url = paper.fullTextUrlList.fullTextUrl[0].url;
      else url = `https://europepmc.org/search?query=${encodeURIComponent(rsid)}`;

      log(`📄 Gefunden: ${title}`);
      log(`🔗 URL: ${url}`);
      log(`📏 Abstract-Länge: ${abstract.length} Zeichen`);

      const combinedText = abstract && abstract.length > 0
        ? `Title: ${title}\nAbstract: ${abstract}`
        : `Title: ${title}`; // Titel-only Fallback

      return { combinedText, url };
    } catch (err) {
      log(`❌ Fehler beim Europe PMC Fetch: ${err.message}`);
      return { combinedText: '', url: null };
    }
  }

  // eine Request-Funktion (mit Optionen) + 1 Retry
  async function ollamaGenerateOnce(model, prompt) {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: { num_predict: 128, num_ctx: 2048, temperature: 0.3, keep_alive: '5m' },
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      log(`❌ HTTP ${res.status} bei LLM-Request: ${raw}`);
      return null;
    }
    const summary = await readOllamaStream(res);
    if (!summary) { log(`⚠️ Leere oder fehlende Antwort von ${model}`); return null; }
    return summary;
  }

  // async function ollamaGenerateWithRetry(model, prompt) {
  //   try {
  //     return await ollamaGenerateOnce(model, prompt);
  //   } catch (e1) {
  //     log(`⚠️ Ollama-Request fehlgeschlagen (${e1.message}). Retry in 500ms…`);
  //     await new Promise(r => setTimeout(r, 500));
  //     try {
  //       return await ollamaGenerateOnce(model, prompt);
  //     } catch (e2) {
  //       log(`❌ Retry fehlgeschlagen: ${e2.message}`);
  //       return null;
  //     }
  //   }
  // }

async function generateWithOllama(rsid, text) {
  const model = OLLAMA_MODEL;

  const up = await isOllamaUp();
  log(`🔍 isOllamaUp=${up}`);
  if (!up) { log('⏭️  Ollama nicht erreichbar – Fallback wird genutzt.'); return null; }

  const hasModel = await modelExists(model);
  log(`🔍 modelExists(${model})=${hasModel}`);
  if (!hasModel) { log(`⏭️  Modell ${model} nicht vorhanden – Fallback wird genutzt.`); return null; }

  await ensureOllamaWarmedUp(log);

  const label = `🧠 Ollama ${rsid} [${nextOllamaSeq()}]`;
  log(`🛠️ Using OLLAMA_MODEL=${model} at ${OLLAMA_URL}`);
  log(`🚀 Sende LLM-Request an ${model} für ${rsid} (${label})`);

  // Text trimmen und SNP-spezifischen Prompt bauen
  const trimmed = trimForCtx(String(text || ''), 8000);
  log(`🧩 Prompt-Länge (chars): raw=${(text || '').length}, trimmed=${trimmed.length}`);
  const prompt = buildPrompt(trimmed, rsid);

  console.time(label);
  try {
    // Timeout gilt nur für den Request-Aufbau; danach streamen wir ohne Gesamttimeout.
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,          // STREAMING aktiviert
        options: {
          num_predict: 128,    // kürzer = schneller/stabiler
          num_ctx: 2048,
          temperature: 0.3,
          keep_alive: '5m',
          // optional: stop: ["\n\n###", "\n\nReferences"]
        },
      }),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      log(`❌ HTTP ${res.status} bei LLM-Request: ${raw}`);
      return null;
    }

    const summary = await readOllamaStream(res);
    if (!summary) {
      log(`⚠️ Leere oder fehlende Antwort von ${model}`);
      return null;
    }

    log(`✅ LLM-Zusammenfassung erfolgreich (${summary.length} Zeichen)`);
    return summary;
  } catch (err) {
    log(`❌ Fehler bei LLM-Zusammenfassung: ${err.name === 'AbortError' ? 'Timeout (connect)' : err.message}`);
    return null;
  } finally {
    console.timeEnd(label);
  }
}




  async function generateWithDistilBART(text) {
    const summarizer = await getSummarizerBackup(log);
    log(`⚙️ Generiere Fallback-Zusammenfassung…`);
    const result = await summarizer(buildPrompt(text));
    const summary = result?.[0]?.summary_text?.trim() || '';
    log(`✅ Fallback-Zusammenfassung erfolgreich (${summary.length} Zeichen)`);
    return summary;
  }

  function loadCachedSummary(rsid) {
    const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
    return fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;
  }

  async function generateSummary(rsid) {
    const fetched = await fetchEuropePMCPapers(rsid);

    if (!fetched.combinedText.trim()) {
      log(`⚠️ Keine Paper gefunden für ${rsid}`);
      return { text: `No Europe PMC papers available for SNP ${rsid}.`, url: fetched.url, local: false };
    }

    // Wenn kein Abstract vorhanden war, nutze Titel + evtl. URL, damit das LLM Kontext hat
    const textForLLM = fetched.combinedText.includes('Abstract:')
      ? fetched.combinedText
      : `${fetched.combinedText}\n\n(Only title available for ${rsid})\n${fetched.url ?? ''}`;

    const summary =
      (await generateWithOllama(rsid, textForLLM)) ||
      (await generateWithDistilBART(textForLLM));

    if (!summary) log(`⚠️ Keine Zusammenfassung erzeugt`);
    return { text: summary, url: fetched.url, local: false };
  }

  // === Request ===
  const { rsid } = req.query;
  if (!rsid) {
    return res.status(400).json({ error: 'Missing rsid parameter', logs: requestLogs });
  }

  const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
  let summaryText = null;
  let url = null;
  let isLocal = false;

  try {
    if (fs.existsSync(cachePath)) {
      log(`📦 Cache-Hit: Lade gespeicherte Zusammenfassung für ${rsid}`);
      summaryText = fs.readFileSync(cachePath, 'utf8');
      const { url: cachedUrl } = await fetchEuropePMCPapers(rsid);
      url = cachedUrl;
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

    res.status(200).json({ text: summaryText, url, local: isLocal, logs: requestLogs });

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
