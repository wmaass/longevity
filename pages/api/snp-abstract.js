// pages/api/snp-abstract.js
import { fetchLatestAbstractForSNP } from '../../scripts/fetch_snp_latest_abstract.js';

export default async function handler(req, res) {
  const { rsid } = req.query;
  if (!rsid) return res.status(400).json({ error: 'Missing rsid' });

  try {
    const data = await fetchLatestAbstractForSNP(rsid); // returns { text, url }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
