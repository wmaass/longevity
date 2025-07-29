// scripts/fetch_snp_latest_abstract.js
import fs from 'fs';
import fetch from 'node-fetch';

const OUTPUT_DIR = './snp_abstracts';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

/**
 * Get first PMID from the dbSNP API (not the rendered HTML).
 */
async function fetchTopPMIDFromDbSNP(rsid) {
  const cleanId = rsid.replace(/^rs/i, '');
  const url = `https://api.ncbi.nlm.nih.gov/variation/v0/beta/refsnp/${cleanId}`;
  console.log(`==> Lade API-Daten für ${rsid}...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fehler beim Abrufen von dbSNP API: ${res.statusText}`);
  const json = await res.json();

  const citations = json?.citations || [];
  if (!citations.length) throw new Error(`Keine Publikationen für ${rsid} gefunden`);

  const top = citations[0]; // First is usually the latest
  return {
    pmid: top.pmid,
    url: `https://pubmed.ncbi.nlm.nih.gov/${top.pmid}`,
  };
}

/**
 * Fetch title and abstract from PubMed.
 */
async function fetchAbstractFromPubMed(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
  console.log(`==> Lade Abstract via PubMed für PMID ${pmid}...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fehler bei EFetch: ${res.statusText}`);
  const xml = await res.text();

  const titleMatch = xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
  const abstractMatch = xml.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/);

  return {
    title: titleMatch ? titleMatch[1] : 'Unbekannter Titel',
    text: abstractMatch ? abstractMatch[1] : 'Kein Abstract gefunden.',
  };
}

/**
 * Main: fetch and cache.
 */
export async function fetchLatestAbstractForSNP(rsid) {
  const cacheFile = `${OUTPUT_DIR}/${rsid}_latest.json`;
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  const { pmid, url } = await fetchTopPMIDFromDbSNP(rsid);
  const { title, text } = await fetchAbstractFromPubMed(pmid);

  const result = { rsid, pmid, url, title, text };
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf8');

  return result;
}

// CLI usage
if (process.argv[1].includes('fetch_snp_latest_abstract.js')) {
  const target = process.argv[2] || 'rs4977574';
  fetchLatestAbstractForSNP(target)
    .then((res) => {
      console.log(`✓ Neuester Artikel für ${target} (PMID ${res.pmid}):\n---\n${res.title}\n\n${res.text}\n\nLink: ${res.url}\n---`);
    })
    .catch((err) => console.error(`✗ Fehler für ${target}: ${err.message}`));
}
