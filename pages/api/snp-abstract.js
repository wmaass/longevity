// pages/api/snp-abstract.js
import { fetchLatestAbstractForSNP } from '../../scripts/fetch_snp_latest_abstract.js';
import fetch from 'node-fetch';
import cheerio from 'cheerio';

// Scrape HTML page for first PubMed link if JSON API has no citations
async function fetchPMIDFromDbSNPHTML(rsid) {
  const cheerio = await import('cheerio');  // <-- dynamic import

  const url = `https://www.ncbi.nlm.nih.gov/snp/${rsid}#publications`;
  console.log(`==> Scraping dbSNP HTML für ${rsid}... ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`⚠ HTML scrape fehlgeschlagen (${rsid}): ${res.statusText}`);
    return null;
  }

  const html = await res.text();
  const $ = cheerio.load(html);  // works now

  const pubLink = $('a[href*="pubmed"]').first().attr('href');
  if (!pubLink) {
    console.warn(`⚠ Keine PubMed-Links im HTML für ${rsid}`);
    return null;
  }

  const pmid = pubLink.match(/pubmed\/(\d+)/)?.[1];
  if (pmid) console.log(`→ PMID ${pmid} über dbSNP HTML gefunden`);
  return pmid ? { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}` } : null;
}

export default async function handler(req, res) {
  const { rsid } = req.query;
  if (!rsid) {
    return res.status(400).json({ text: 'Kein rsID angegeben.', url: null });
  }

  try {
    // Try the usual JSON/dbSNP+PubMed fetcher first
    let data = await fetchLatestAbstractForSNP(rsid);

    // If no data found (no PMID, no text), scrape HTML for a PubMed link
    if (!data?.pmid) {
      const htmlPMID = await fetchPMIDFromDbSNPHTML(rsid);
      if (htmlPMID) {
        // Re-fetch abstract now that we found a PMID
        const refreshed = await fetchLatestAbstractForSNP(rsid);
        data = { ...data, ...htmlPMID, ...refreshed };
      }
    }

    if (!data || (!data.text && !data.url)) {
      return res.status(200).json({ text: 'Kein Abstract verfügbar.', url: null });
    }

    return res.status(200).json({
      text: data.text || 'Kein Abstract verfügbar.',
      url: data.url || null,
      pmid: data.pmid || null,
    });
  } catch (err) {
    console.error(`Fehler beim Laden des Abstracts für ${rsid}:`, err);
    return res.status(200).json({ text: 'Fehler beim Laden des Abstracts.', url: null });
  }
}
