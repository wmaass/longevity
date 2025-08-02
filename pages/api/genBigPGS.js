// pages/api/genBigPGS.js

import fs from 'fs';
import path from 'path';

const UNPACKED_DIR = path.resolve('./public/pgs_scores/unpacked');

export default async function handler(req, res) {
  const maxVariants = parseInt(req.query.max) || 100000;
  const bigPGS = [];

  try {
    const files = fs.readdirSync(UNPACKED_DIR).filter(f => f.endsWith('.txt'));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = fs.readFileSync(path.join(UNPACKED_DIR, file), 'utf-8');
      const count = content.split('\n').length;
      if (count > maxVariants) {
        bigPGS.push(file.split('_')[0]);
      }
    }

    const targetFile = path.resolve(`./public/pgs_scores/bigPGS_${maxVariants}.json`);
    fs.writeFileSync(targetFile, JSON.stringify(bigPGS, null, 2), 'utf-8');

    res.status(200).json({ status: 'ok', count: bigPGS.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
