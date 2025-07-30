import fs from 'fs';
import path from 'path';
import ollama from 'ollama';
import fetch from 'node-fetch';
import { pipeline } from '@xenova/transformers';

let summarizerBackup;

// --- Fetch papers from Europe PMC (title, abstract, DOI) ---
async function fetchEuropePMCPapers(rsid) {
  const query = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${rsid}&format=json&pageSize=5`;
  try {
    const res = await fetch(query);
    const json = await res.json();

    if (!json.resultList?.result?.length) return { combinedText: '', doi: null };

    const papers = json.resultList.result;
    let combinedText = '';
    let doiLink = null;

    papers.forEach((paper, idx) => {
      const title = paper.title || 'Untitled';
      const abstractRaw = (paper.abstractText || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const doi = paper.doi ? `https://doi.org/${paper.doi}` : null;
      if (!doiLink && doi) doiLink = doi; // pick first DOI for link

      const firstLines = abstractRaw.split(/(?<=\. )/).slice(0, 5).join(' ');

      console.log(`\n=== Europe PMC Paper ${idx + 1} ===`);
      console.log(`Title: ${title}`);
      if (doi) console.log(`Link: ${doi}`);
      console.log(`First 5 lines: ${firstLines}`);
      console.log('-------------------------');

      combinedText += `Title: ${title}\n${doi ? `Link: ${doi}\n` : ''}Abstract: ${abstractRaw}\n\n`;
    });

    return { combinedText, doi: doiLink };
  } catch (err) {
    console.error(`Failed to fetch Europe PMC papers for ${rsid}:`, err.message);
    return { combinedText: '', doi: null };
  }
}

// --- Summarization helpers ---
async function generateWithOllama(rsid, text) {
  const prompt = `
Summarize the findings from the research papers below *specifically regarding SNP ${rsid}*.
Focus on associations, effect sizes, risk factors, or functional impacts.
Avoid irrelevant context. Limit to 200 words.

Text:
${text}
  `;
  try {
    const response = await ollama.generate({ model: 'llama3', prompt });
    return response.response.trim();
  } catch (err) {
    console.error(`Ollama failed for ${rsid}:`, err.message);
    return null;
  }
}

async function generateWithDistilBART(text) {
  if (!summarizerBackup) {
    summarizerBackup = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
    console.log('Using DistilBART as fallback summarizer.');
  }
  const result = await summarizerBackup(text);
  return result[0]?.summary_text?.trim() || '';
}

// --- Cache helpers ---
function loadCachedSummary(rsid) {
  const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
  return fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;
}

// --- Main logic ---
async function generateSummary(rsid) {
  const { combinedText, doi } = await fetchEuropePMCPapers(rsid);

  if (!combinedText.trim()) {
    console.warn(`No papers found for ${rsid}. Returning placeholder.`);
    return { text: `No Europe PMC papers available for SNP ${rsid}.`, url: null, local: false };
  }

  const summary =
    (await generateWithOllama(rsid, combinedText)) ||
    (await generateWithDistilBART(combinedText));

  return { text: summary, url: doi, local: false };
}

// --- API handler ---
export default async function handler(req, res) {
  const { rsid } = req.query;
  if (!rsid) return res.status(400).json({ error: 'Missing rsid parameter' });

  try {
    const cachePath = path.join(process.cwd(), 'public', 'summaries', `${rsid}.txt`);
    let summaryText = loadCachedSummary(rsid);
    let isLocal = false;

    let url = null;
    if (summaryText) {
      isLocal = true;
    } else {
      const generated = await generateSummary(rsid);
      summaryText = generated.text;
      url = generated.url;
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, summaryText, 'utf8');
    }

    res.status(200).json({
      text: summaryText || 'Keine Zusammenfassung verfügbar.',
      url: url,
      local: isLocal,
    });
  } catch (err) {
    console.error(`Error generating summary for ${rsid}:`, err);
    res.status(500).json({
      text: 'Fehler beim Generieren der Zusammenfassung.',
      url: null,
      local: false,
    });
  }
}
