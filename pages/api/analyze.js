// pages/api/analyze.js
import formidable from 'formidable';
import fs from 'fs';
import { computePRS } from '../../lib/computePRS';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST supported' });
  }

  const form = formidable({});
  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: 'Upload failed' });
    }

    try {
      const genomeFile = files.genome[0].filepath;

      // Fortschritt-Updates nur als Logs (kein DOM)
      const result = await computePRS(genomeFile, (pct, pgsId) => {
        console.log(`[Progress] ${pgsId}: ${pct.toFixed(1)}%`);
      });

      res.status(200).json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
}
