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
const OLLAMA_NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT || 768);



// Sprachmodus festlegen: "fachlich", "einfach", "deutsch", "englisch"
// Sprachmodus: "fachlich", "einfach", "deutsch", "englisch"
// rsid ist optional; ohne rsid fällt es auf "the SNP of interest" zurück.
// Unified GPT5-style, with sectioned output and source-location tags.
// Produces the same structure across all modes; wording varies by language.
// GPT-5 style structured prompt, compatible with all modes.
// Call as: buildPrompt(text, rsid)
function buildPrompt(text, rsid) {
  const snp  = rsid ? String(rsid) : 'the SNP of interest';
  const mode = (SPEECH_MODE || 'englisch').toLowerCase(); // ← use the constant

  const L = {
    deutsch: {
      header:        `Zusammenfassung der Erwähnungen von ${snp} im Paper`,
      mentionTitle:  `Erwähnung von ${snp}`,
      reportedInfo:  `Berichtete Informationen zu ${snp}`,
      trait:         `Untersuchter Phänotyp/Outcome`,
      allele:        `Allel-/Genotyp-Effekte`,
      effects:       `Effektgrößen (OR/β/HR, mit KI und p-Werten)`,
      population:    `Untersuchte Population`,
      design:        `Studiendesign`,
      limits:        `Limitationen (vom Paper genannt)`,
      recap:         `Stichpunktartige Kurzfassung`,
      sys: [
        `Du bist ein sorgfältiger wissenschaftlicher Zusammenfasser.`,
        `Nutze AUSSCHLIESSLICH den bereitgestellten Text (Titel/Abstract/Volltext).`,
        `Erfinde nichts; falls Informationen fehlen, schreibe „nicht berichtet“.`,
        `Kennzeichne jede Aussage mit genau einem Tag: [TITLE], [ABSTRACT], [INTRO], [METHODS], [RESULTS], [DISCUSSION], [FULLTEXT].`,
        `Keine externen Quellen nennen.`,
        `Falls ${snp} nicht vorkommt, schreibe das explizit und lasse abhängige Abschnitte aus.`,
        `Zahlen wörtlich übernehmen, wenn vorhanden.`,
      ].join('\n'),
      strict: [
        `Halte die Vorlage exakt ein. Keine Abschnitte hinzufügen oder entfernen.`,
        `Keine externen Quellen nennen.`,
        `Nur diese Herkunftstags verwenden: [TITLE], [ABSTRACT], [INTRO], [METHODS], [RESULTS], [DISCUSSION], [FULLTEXT].`,
      ].join('\n'),
      mentionHint: `- Antworte mit „Ja“ oder „Nein“ und gib die Fundstelle als Tag an (z. B. [ABSTRACT] oder [FULLTEXT]).`,
      recapBullets: [
        `- ${snp} erwähnt? <Ja/Nein> [TAG]`,
        `- Phänotyp: <…> [TAG]`,
        `- Genotyp/Allel: <…> [TAG]`,
        `- Wichtige Zahlen: <…> [TAG]`,
        `- Population/Design: <…> [TAG]`,
        `- Limitationen: <…> [TAG]`,
      ],
      // German phrasing for placeholders below:
      effectLine1: `- <Kennzahl + Wert + KI + p, wörtlich falls vorhanden> [TAG]`,
      effectLine2: `- <weitere Statistiken, falls vorhanden> [TAG]`,
      popLine:     `**Untersuchte Population:** <n, Abstammung, wichtige Ausschlüsse> [TAG]`,
      designLine:  `**Studiendesign:** <z. B. Querschnitt, RCT> [TAG]`,
      limitsLine:  `**Limitationen:** <vom Paper genannt; sonst „nicht berichtet“> [TAG]`,
      traitLine:   `**Untersuchter Phänotyp/Outcome:** <eine Aussage> [TAG]`,
      alleleLine:  `**Allel-/Genotyp-Effekte:** <rsID/Allel/Genotyp, falls vorhanden> [TAG]`,
    },

    englisch: {
      header:        `Summary of Mentions of ${snp} in the Paper`,
      mentionTitle:  `Mention of ${snp}`,
      reportedInfo:  `Reported Information Related to ${snp}`,
      trait:         `Trait studied`,
      allele:        `Allele/genotype effects`,
      effects:       `Effect sizes (OR/β/HR, with CI and p-values)`,
      population:    `Population studied`,
      design:        `Study design`,
      limits:        `Limitations (as acknowledged in the paper)`,
      recap:         `Bulleted Summary (Concise)`,
      sys: [
        `You are a careful scientific summarizer.`,
        `Base your answer ONLY on the provided content (title, abstract, and any available full text).`,
        `Do NOT fabricate facts; if something is missing, write "not reported".`,
        `Tag provenance for each claim with ONE of: [TITLE], [ABSTRACT], [INTRO], [METHODS], [RESULTS], [DISCUSSION], [FULLTEXT].`,
        `Do not reference external sources or websites.`,
        `If ${snp} does not appear, say so explicitly and omit dependent sections.`,
        `Quote statistics verbatim when available.`,
      ].join('\n'),
      strict: [
        `Follow the template exactly. Do not add or remove sections.`,
        `Do not reference external sources.`,
        `Only use provenance tags from: [TITLE], [ABSTRACT], [INTRO], [METHODS], [RESULTS], [DISCUSSION], [FULLTEXT].`,
      ].join('\n'),
      mentionHint: `- State "Yes" or "No", and cite where it appears using a tag (e.g., [ABSTRACT] or [FULLTEXT]).`,
      recapBullets: [
        `- ${snp} mentioned? <Yes/No> [TAG]`,
        `- Trait: <…> [TAG]`,
        `- Genotype/allele: <…> [TAG]`,
        `- Key stats: <…> [TAG]`,
        `- Population/design: <…> [TAG]`,
        `- Limitations: <…> [TAG]`,
      ],
      effectLine1: `- <metric + value + CI + p, verbatim if present> [TAG]`,
      effectLine2: `- <additional stats if present> [TAG]`,
      popLine:     `**Population studied:** <n, ancestry, key exclusions if reported> [TAG]`,
      designLine:  `**Study design:** <e.g., cross-sectional, RCT> [TAG]`,
      limitsLine:  `**Limitations (as acknowledged in the paper):** <…; if none, write "not reported"> [TAG]`,
      traitLine:   `**Trait studied:** <one sentence> [TAG]`,
      alleleLine:  `**Allele/genotype effects:** <one sentence (mention rsID, allele/genotype if available)> [TAG]`,
    },

    // Map the other modes to German defaults unless you want separate wording
    einfach: null,
    fachlich: null,
  };

  const P = L[mode] || L.deutsch; // deutsch default

  const body = [
    P.sys,
    '',
    '=== PROVIDED TEXT START ===',
    String(text || '').trim(),
    '=== PROVIDED TEXT END ===',
    '',
    `# ${P.header}`,
    '',
    `## ${P.mentionTitle}`,
    P.mentionHint,
    '',
    `## ${P.reportedInfo}`,
    P.traitLine,
    P.alleleLine,
    `**${P.effects}:**`,
    P.effectLine1,
    P.effectLine2,
    P.popLine,
    P.designLine,
    P.limitsLine,
    '',
    `## ${P.recap}`,
    ...P.recapBullets,
  ].join('\n');

  return [P.strict, body].join('\n\n');
}



// ==== Helfer ====

  function badgeProvenance(html) {
    if (!html) return '';
    return html.replace(
      /\[(TITLE|ABSTRACT|INTRO|METHODS|RESULTS|DISCUSSION|FULLTEXT)\]/g,
      '<span class="provenance-badge">$1</span>'
    );
  }

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

import { marked } from 'marked'; // npm install marked

function formatSummaryToHTML(markdownText) {
  // Convert markdown to HTML
  return marked.parse(markdownText, {
    mangle: false,
    headerIds: false,
  });
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

// define once near your helpers
const noopLog = () => {};

async function ensureOllamaWarmedUp(log = noopLog) {
  if (globalThis.__ollamaWarmedUp) return true;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: 'OK',
        stream: false,
        options: {
          num_predict: Number(process.env.OLLAMA_NUM_PREDICT || 1024),
          num_ctx: Number(process.env.OLLAMA_NUM_CTX || 4096),
          temperature: Number(process.env.OLLAMA_TEMPERATURE || 0.2),
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || '5m',
        },
      }),
    });

    if (res.ok) {
      globalThis.__ollamaWarmedUp = true;
      log('🔥 Ollama warm-up erfolgreich (Modell im Speicher).');
      return true;
    }
  } catch (e) {
    log(`⚠️ Warm-up fehlgeschlagen: ${e?.message || e}`);
  }

  return false;
}


// 📡 API-Handler
// 📡 Unified API handler (single export)
export default async function handler(req, res) {
  const requestLogs = [];
  const log = (msg) => {
    const ts = new Date().toISOString();
    const entry = `[${ts}] ${msg}`;
    requestLogs.push(entry);
    console.log(entry);
  };

  try {
    log(`🧪 OLLAMA_URL=${OLLAMA_URL} OLLAMA_MODEL=${OLLAMA_MODEL} SPEECH_MODE=${SPEECH_MODE}`);
    log(`⏱️ OLLAMA_TIMEOUT_MS=${OLLAMA_TIMEOUT_MS}`);

    const { rsid } = req.query || {};
    if (!rsid || typeof rsid !== 'string') {
      return res.status(400).json({ error: 'Missing rsid parameter', logs: requestLogs });
    }

    // Cache setup
    const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
    let rawSummary = null;
    let htmlSummary = null;
    let url = null;
    let isLocal = false;

    if (fs.existsSync(cachePath)) {
      // Cache hit
      log(`📦 Cache-Hit: Lade gespeicherte Zusammenfassung für ${rsid}`);
      rawSummary = fs.readFileSync(cachePath, 'utf8');
      // Refresh canonical URL (optional)
      const { url: cachedUrl } = await fetchEuropePMCPapers(rsid);
      url = cachedUrl ?? null;
      isLocal = true;
    } else {
      // No cache → fetch paper content
      log(`📤 Keine Zusammenfassung im Cache. Generiere neue für ${rsid}`);
      const fetched = await fetchEuropePMCPapers(rsid);
      const combinedText = String(fetched?.combinedText || '').trim();
      url = fetched?.url ?? null;

      if (!combinedText) {
        log(`⚠️ Keine Paper gefunden für ${rsid}`);
        const msg = `No Europe PMC papers available for SNP ${rsid}.`;
        return res.status(200).json({ text: msg, html: toHTMLSafe(msg, log), url: null, local: false, logs: requestLogs });
      }

      const textForLLM = combinedText.includes('Abstract:')
        ? combinedText
        : `${combinedText}\n\n(Only title available for ${rsid})\n${url ?? ''}`;

      rawSummary =
        (await generateWithOllama(rsid, textForLLM)) ||
        (await generateWithDistilBART(textForLLM, rsid));

      if (!rawSummary?.trim()) {
        log(`⚠️ Keine Zusammenfassung erzeugt`);
        const msg = `No summary could be generated for ${rsid}.`;
        return res.status(200).json({ text: msg, html: toHTMLSafe(msg, log), url, local: false, logs: requestLogs });
      }

      // Persist cache (raw markdown)
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, rawSummary, 'utf8');
      log(`💾 Zusammenfassung gespeichert unter: ${cachePath}`);
    }

    // Markdown → HTML, then badge provenance tags
    htmlSummary = badgeProvenance(toHTMLSafe(rawSummary, log));

    return res.status(200).json({
      text: String(rawSummary || '').trim(),
      html: htmlSummary,
      url,
      local: isLocal,
      logs: requestLogs,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      text: 'Fehler beim Generieren der Zusammenfassung.',
      html: 'Fehler beim Generieren der Zusammenfassung.',
      url: null,
      local: false,
      logs: requestLogs,
    });
  }
}


/* ============================ Europe PMC fetch ============================ */

async function fetchEuropePMCPapers(rsid) {
  const q =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
    `?query=(TITLE:${encodeURIComponent(rsid)}%20OR%20ABSTRACT:${encodeURIComponent(rsid)})` +
    `&format=json&pageSize=20&resultType=core`;

  try {
    const r = await fetch(q);
    const json = await r.json();
    const papers = json?.resultList?.result || [];
    if (papers.length === 0) return { combinedText: '', url: null };

    // Score best candidate
    const scored = papers.map((p) => {
      const title = p.title || '';
      const abstractText = String(p.abstractText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const hasAbstract = abstractText.length > 0;
      const hasPMCID = !!p.pmcid;
      const year = Number(p.pubYear) || 0;
      return {
        p,
        abstractText,
        score:
          (p.doi ? 4 : 0) +
          (p.pmid ? 3 : 0) +
          (hasPMCID ? 3 : 0) +
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

    // Canonical URL
    let url = null;
    if (paper.doi) url = `https://doi.org/${paper.doi}`;
    else if (paper.pmid) url = `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`;
    else if (paper.pmcid) url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/`;
    else if (paper.id && paper.source) url = `https://europepmc.org/article/${paper.source}/${paper.id}`;
    else if (paper.fullTextUrlList?.fullTextUrl?.[0]?.url) url = paper.fullTextUrlList.fullTextUrl[0].url;
    else url = `https://europepmc.org/search?query=${encodeURIComponent(rsid)}`;

    // Try full text: XML → PDF (placeholder) → HTML
    let fullText = '';
    let triedFulltext = false;

    // XML/JATS
    if (paper.source && paper.id) {
      const xmlUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${paper.source}/${paper.id}/fullTextXML`;
      triedFulltext = true;
      try {
        const xmlRes = await fetch(xmlUrl);
        if (xmlRes.ok) {
          const xml = await xmlRes.text();
          fullText = extractPlainTextFromJATS(xml);
        }
      } catch {}
    }

    // PDF (optional – needs PDF parser to convert to text)
    if (!fullText && paper.source && paper.id) {
      const pdfUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${paper.source}/${paper.id}/fullTextPDF`;
      try {
        const pdfRes = await fetch(pdfUrl);
        if (pdfRes.ok) {
          // const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          // const { text } = await pdfParse(pdfBuf); // if you add pdf-parse
          // fullText = sanitize(text);
        }
      } catch {}
    }

    // HTML
    if (!fullText && paper.fullTextUrlList?.fullTextUrl?.length) {
      const htmlEntry = paper.fullTextUrlList.fullTextUrl.find(
        (u) => /html/i.test(u.documentStyle || '') || /text\/html/i.test(u.availability || '')
      );
      if (htmlEntry?.url) {
        triedFulltext = true;
        try {
          const htmlRes = await fetch(htmlEntry.url);
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            fullText = extractPlainTextFromHTML(html);
          }
        } catch {}
      }
    }

    // Compose combined text
    let combinedText = `Title: ${title}`;
    if (abstract) combinedText += `\nAbstract: ${abstract}`;
    if (fullText) combinedText += `\nFullText:\n${trimForCtx(fullText, 30000)}`;
    if (!abstract && !fullText) combinedText = `Title: ${title}`; // minimal fallback

    if (!triedFulltext && !fullText) {
      // no fulltext endpoint usable → proceed with title/abstract only
    }

    return { combinedText, url };
  } catch (e) {
    return { combinedText: '', url: null };
  }
}

/* =============================== Helpers =============================== */

// Convert Markdown → HTML if converter exists; otherwise return original
// in /pages/api/snp-summary.js
// Convert loosely formatted LLM text into real Markdown
function normalizeSummaryMarkdown(md) {
  let s = String(md || '').replace(/\r\n/g, '\n').trim();

  // Headings (robust to extra text)
  s = s
    .replace(/(^|\n)\s*(Summary of Mentions[^\n]*)/i, '\n\n# $2')
    .replace(/(^|\n)\s*(Mention of [^\n]*)/i, '\n\n## $2')
    .replace(/(^|\n)\s*(Reported Information Related to [^\n]*)/i, '\n\n## $2')
    .replace(/(^|\n)\s*(Bulleted Summary[^\n]*)/i, '\n\n## $2');

  // Put each **Label:** on its own paragraph (double newline required)
  // e.g., **Trait studied:**, **Allele/genotype effects:**, **Study design:**, **Limitations ...:**
  s = s.replace(/(\*\*[^*\n]+?:\*\*)(?!\n)/g, '\n\n$1');

  // If a provenance tag is right before the next label, also break
  s = s.replace(/(\[[A-Z]+\])\s+(?=\*\*[^*\n]+?:\*\*)/g, '$1\n\n');

  // Fallback: if some labels are NOT bold, bold + split them
  s = s.replace(/\n(Study design:)/gi, '\n\n**$1**')
       .replace(/\n(Limitations[^:]*:)/gi, '\n\n**$1**');

  // Turn the "Bulleted Summary" section into a proper list
  s = s.replace(/(##\s*Bulleted Summary[^\n]*\n)([\s\S]*?)(?=\n##|\n#|$)/i, (m, head, body) => {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return head + '\n';
    const items = lines.map(l => (/^[-*]\s/.test(l) ? l : `- ${l}`));
    return `${head}\n${items.join('\n')}\n`;
  });

  // Tidy whitespace
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}


// then in your toHTMLSafe (server)
function toHTMLSafe(markdown, log) {
  try {
    if (typeof formatSummaryToHTML === 'function') {
      const normalized = normalizeSummaryMarkdown(markdown);
      return formatSummaryToHTML(normalized);
    }
  } catch (e) {
    log?.(`ℹ️ HTML conversion failed: ${e.message}`);
  }
  return markdown;
}


function extractPlainTextFromJATS(xml) {
  if (!xml) return '';
  let s = xml
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    .replace(/<fig[\s\S]*?<\/fig>/gi, '')
    .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, '')
    .replace(/<license[\s\S]*?<\/license>/gi, '')
    .replace(/<front[\s\S]*?<\/front>/gi, '')
    .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, '\n\n$1\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<\/?sec[^>]*>/gi, '\n')
    .replace(/<\/?abstract[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return s;
}

function extractPlainTextFromHTML(html) {
  if (!html) return '';
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const candidates = [
    /<article[\s\S]*?<\/article>/i,
    /<div[^>]+class="[^"]*(article[-_\s]?body|articleContent|content[-_\s]?body|main[-_\s]?content|article|post[-_\s]?content)[^"]*"[\s\S]*?<\/div>/i,
    /<main[\s\S]*?<\/main>/i,
  ];
  let picked = '';
  for (const rx of candidates) {
    const m = s.match(rx);
    if (m?.[0]) { picked = m[0]; break; }
  }
  if (!picked) {
    const body = s.match(/<body[\s\S]*?<\/body>/i);
    picked = body ? body[0] : s;
  }

  picked = picked
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<\/?(p|div|section|article|main|br|h[1-6]|li|ul|ol|blockquote|table|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (picked.length < 2000) {
    const parts = picked.split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
    if (parts.length > 1) {
      const best = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
      if (best.length > picked.length * 1.2) picked = best;
    }
  }
  return picked;
}


  // eine Request-Funktion (mit Optionen) + 1 Retry
  async function ollamaGenerateOnce(model, prompt, log = noopLog) {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          num_predict: OLLAMA_NUM_PREDICT,
          num_ctx: 4096,
          temperature: 0.2,
          keep_alive: '5m',
        },
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

  async function ollamaGenerateFull(model, prompt, log) {
  const MAX_SEGMENTS = 4; // Sicherheitsgrenze
  let ctx = null;
  let out = '';

  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: i === 0 ? prompt : '', // ab 2. Runde nur Kontext fortsetzen
        stream: false,
        options: {
          num_predict: OLLAMA_NUM_PREDICT, // z.B. 768–1024
          num_ctx: 4096,
          temperature: 0.2,
          keep_alive: '5m',
        },
        context: ctx || undefined,
      }),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      log(`❌ HTTP ${res.status} bei LLM-Request: ${raw}`);
      break;
    }

    const j = await res.json(); // { response, done, done_reason, context, ... }
    out += (j.response || '');
    ctx = j.context;

    log(`🧠 chunk ${i+1}: done_reason=${j.done_reason}`);

    if (j.done && j.done_reason !== 'length') break; // fertig oder Stoppzeichen
  }
  return out.trim();
}

// Revised: no clipping, auto-continue on done_reason === 'length'
// add default no-op logger so helpers work even without handler logger

async function generateWithOllama(rsid, text, log = noopLog) {
  const model = OLLAMA_MODEL;

  const NUM_PREDICT  = Number(process.env.OLLAMA_NUM_PREDICT   || 1024);
  const NUM_CTX      = Number(process.env.OLLAMA_NUM_CTX       || 4096);
  const TEMPERATURE  = Number(process.env.OLLAMA_TEMPERATURE   || 0.2);
  const MAX_SEGMENTS = Number(process.env.OLLAMA_MAX_SEGMENTS  || 4);
  const KEEP_ALIVE   = process.env.OLLAMA_KEEP_ALIVE || '5m';

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

  const trimmed = trimForCtx(String(text || ''), 8000);
  log(`🧩 Prompt-Länge (chars): raw=${(text || '').length}, trimmed=${trimmed.length}`);
  const prompt = buildPrompt(trimmed, rsid);

  console.time(label);
  try {
    let out = '';
    let ctx;

    for (let seg = 1; seg <= MAX_SEGMENTS; seg++) {
      const payload = {
        model,
        prompt: seg === 1 ? prompt : '',
        stream: false,
        options: { num_predict: NUM_PREDICT, num_ctx: NUM_CTX, temperature: TEMPERATURE, keep_alive: KEEP_ALIVE },
        ...(ctx ? { context: ctx } : {}),
      };

      const res = await fetchWithTimeout(`${OLLAMA_URL}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        log(`❌ HTTP ${res.status} bei LLM-Request (Segment ${seg}): ${raw}`);
        break;
      }

      const j = await res.json();
      const chunk = j?.response || '';
      out += chunk;
      ctx = j?.context;
      const reason = j?.done_reason || 'unknown';
      log(`🧠 Segment ${seg}: received ${chunk.length} chars, done_reason=${reason}`);
      if (j?.done && reason !== 'length') break;
    }

    if (!out.trim()) { log(`⚠️ Leere oder fehlende Antwort von ${model}`); return null; }
    log(`✅ LLM-Zusammenfassung erfolgreich (${out.length} Zeichen)`);
    return out.trim();
  } catch (err) {
    log(`❌ Fehler bei LLM-Zusammenfassung: ${err.name === 'AbortError' ? 'Timeout (connect)' : err.message}`);
    return null;
  } finally {
    console.timeEnd(label);
  }
}

async function generateWithDistilBART(text, rsid, log = noopLog) {
  const summarizer = await getSummarizerBackup(log);
  log(`⚙️ Generiere Fallback-Zusammenfassung…`);
  const result = await summarizer(buildPrompt(text, rsid), {
    max_new_tokens: 450, min_new_tokens: 200, no_repeat_ngram_size: 3,
  });
  const summary = result?.[0]?.summary_text?.trim() || '';
  log(`✅ Fallback-Zusammenfassung (${summary.length} Zeichen)`);
  return summary;
}


  function loadCachedSummary(rsid) {
    const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
    return fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;
  }


async function generateSummary(rsid, log = noopLog) {
  const fetched = await fetchEuropePMCPapers(rsid);
  const combinedText = String(fetched?.combinedText || '').trim();
  const url = fetched?.url ?? null;

  if (!combinedText) {
    log(`⚠️ Keine Paper gefunden für ${rsid}`);
    const msg = `No Europe PMC papers available for SNP ${rsid}.`;
    return { text: msg, html: toHTMLSafe(msg, log), url, local: false };
  }

  const textForLLM = combinedText.includes('Abstract:')
    ? combinedText
    : `${combinedText}\n\n(Only title available for ${rsid})\n${url ?? ''}`;

  const rawSummary =
    (await generateWithOllama(rsid, textForLLM, log)) ||
    (await generateWithDistilBART(textForLLM, rsid, log));

  if (!rawSummary || !rawSummary.trim()) {
    log(`⚠️ Keine Zusammenfassung erzeugt`);
    const msg = `No summary could be generated for ${rsid}.`;
    return { text: msg, html: toHTMLSafe(msg, log), url, local: false };
  }

  const htmlSummaryRaw = toHTMLSafe(rawSummary, log);
  const htmlSummary = badgeProvenance(htmlSummaryRaw);

  return { text: rawSummary.trim(), html: htmlSummary, url, local: false };
}
