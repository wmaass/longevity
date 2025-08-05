// pages/api/cachePGS.js
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { pgsId, content } = req.body;

  if (!pgsId || !content) {
    return res.status(400).json({ error: 'pgsId oder content fehlt' });
  }

  try {
    const unpackDir = path.join(process.cwd(), 'public', 'pgs_scores', 'unpacked');
    if (!fs.existsSync(unpackDir)) fs.mkdirSync(unpackDir, { recursive: true });

    const filePath = path.join(unpackDir, `${pgsId}_hmPOS_GRCh37.txt`);
    fs.writeFileSync(filePath, content, 'utf-8');

    res.status(200).json({ message: 'PGS gespeichert', path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
