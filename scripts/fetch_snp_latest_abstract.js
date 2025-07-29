import fs from 'fs';
import fetch from 'node-fetch';
import cheerio from 'cheerio';  // FIXED

const OUTPUT_DIR = './snp_abstracts';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

/**
 * Fallback: search PubMed directly by rsID if dbSNP gives no PMID.
 */
async function fetchFallbackPMIDFromPubMed(rsid) {
  const query = encodeURIComponent(rsid);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmode=json&retmax=1&sort=pub+date`;

  console.log(`==> PubMed ESearch fallback für ${rsid}...`);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`⚠ PubMed-Suche fehlgeschlagen (${rsid}): ${res.statusText}`);
    return null;
  }

  const json = await res.json();
  const pmid = json.esearchresult?.idlist?.[0] || null;
  if (pmid) {
    console.log(`→ PMID ${pmid} über ESearch gefunden`);
  }
  return pmid ? { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}` } : null;
}

/**
 * Scrape dbSNP HTML to find first PubMed link (for cases where API has no citations).
 */



/**
 * Fetch first PMID from dbSNP JSON API.
 */
async function fetchTopPMIDFromDbSNP(rsid) {
  const cleanId = rsid.replace(/^rs/i, '');
  const url = `https://api.ncbi.nlm.nih.gov/variation/v0/beta/refsnp/${cleanId}`;
  console.log(`==> Lade dbSNP JSON API für ${rsid}...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fehler beim Abrufen von dbSNP API: ${res.statusText}`);
  const json = await res.json();

  if (json?.citations?.length) {
    const pmid = json.citations[0].pmid;
    console.log(`→ PMID ${pmid} über dbSNP JSON gefunden`);
    return { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}` };
  }

  // Check nested study structures
  const evidenceRefs = (json?.primary_snapshot_data?.alleles || [])
    .flatMap(a => a?.frequency_informations || [])
    .flatMap(f => f?.study || [])
    .map(study => study?.pmid)
    .filter(Boolean);

  if (evidenceRefs.length) {
    const pmid = evidenceRefs[0];
    console.log(`→ PMID ${pmid} aus verschachtelten dbSNP-Daten`);
    return { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}` };
  }

  console.warn(`⚠ Keine PMIDs in dbSNP JSON für ${rsid}`);
  return null;
}

/**
 * Fetch abstract/title via PubMed EFetch.
 */
async function fetchAbstractFromPubMed(pmid) {
  if (!pmid) return { title: 'Kein Titel verfügbar', text: '' };

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
  console.log(`==> Lade Abstract via PubMed (PMID ${pmid})...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`⚠ Fehler bei EFetch (PMID ${pmid}): ${res.statusText}`);
    return { title: 'Kein Titel verfügbar', text: '' };
  }

  const xml = await res.text();
  const titleMatch = xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
  const title = titleMatch ? titleMatch[1] : 'Kein Titel gefunden';

  const abstractMatches = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
  const text = abstractMatches.length ? abstractMatches.map(m => m[1].trim()).join('\n\n') : '';

  if (!text) {
    console.warn(`⚠ Kein Abstract via EFetch (PMID ${pmid})`);
  }
  return { title, text };
}

/**
 * Fallback: Scrape PubMed HTML snippet if no XML abstract is available.
 */
async function fetchSnippetFromPubMedHTML(pmid) {
  const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  console.log(`==> Scraping PubMed HTML (PMID ${pmid})...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`⚠ PubMed HTML-Scrape fehlgeschlagen (${pmid}): ${res.statusText}`);
    return 'Kein Abstract verfügbar';
  }

  const html = await res.text();
  const $ = load(html);
  const snippet = $('div.abstract-content').first().text().trim()
    || $('meta[name="description"]').attr('content') || '';

  return snippet || 'Kein Abstract verfügbar';
}

/**
 * Master function: Attempts all strategies sequentially and caches results.
 */
export async function fetchLatestAbstractForSNP(rsid) {
  const cacheFile = `${OUTPUT_DIR}/${rsid}_latest.json`;
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  let pmidData = null;

  // 1) dbSNP JSON API
  try {
    pmidData = await fetchTopPMIDFromDbSNP(rsid);
  } catch (err) {
    console.warn(`⚠ dbSNP JSON fehlgeschlagen (${rsid}): ${err.message}`);
  }

  // 2) dbSNP HTML scrape
  if (!pmidData) {
    pmidData = await fetchPMIDFromDbSNPHTML(rsid);
  }

  // 3) PubMed ESearch fallback
  if (!pmidData) {
    pmidData = await fetchFallbackPMIDFromPubMed(rsid);
  }

  const pmid = pmidData?.pmid || null;
  const pubUrl = pmidData?.url || null;

  // 4) PubMed EFetch abstract
  let { title, text } = await fetchAbstractFromPubMed(pmid);

  // 5) HTML snippet fallback if still empty
  if (!text) {
    text = await fetchSnippetFromPubMedHTML(pmid);
  }

  const result = { rsid, pmid, url: pubUrl, title, text };
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

// CLI test
if (process.argv[1].includes('fetch_snp_latest_abstract.js')) {
  const target = process.argv[2] || 'rs4420638';
  fetchLatestAbstractForSNP(target)
    .then(res => {
      console.log(
        `✓ Artikel für ${target} (PMID ${res.pmid || 'n/a'}):\n---\n${res.title}\n\n${res.text}\n\nLink: ${res.url || 'Kein Link'}`
      );
    })
    .catch(err => console.error(`✗ Fehler für ${target}: ${err.message}`));
}
