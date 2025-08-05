// pages/api/fetchAndUnpackPGS.js
import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

export default async function handler(req, res) {
  const { id, maxSizeMB = 10 } = req.query;

  if (!id) {
    res.status(400).json({ error: 'No PGS id specified.' });
    return;
  }

  const fileName = `${id}_hmPOS_GRCh37.txt`;
  const destDir = path.join(process.cwd(), 'public', 'pgs_scores', 'unpacked');
  const destPath = path.join(destDir, fileName);

  try {
    await fs.mkdir(destDir, { recursive: true });

    const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${fileName}.gz`;

    // 1. 📏 HEAD request to check size
    const sizeOk = await checkRemoteSize(url, maxSizeMB);
    if (!sizeOk) {
      console.warn(`[Skip] ${id}: .gz Datei zu groß`);
      return res.status(413).json({ error: 'File too large (HEAD check).' });
    }

    // 2. ⬇️ Download and unzip
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

    const buffer = await response.arrayBuffer();
    const decompressed = zlib.gunzipSync(Buffer.from(buffer));

    // 3. 📏 Check uncompressed size
    const sizeMB = decompressed.length / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      console.warn(`[Skip] ${id}: Entpackt ${sizeMB.toFixed(1)} MB > ${maxSizeMB} MB`);
      return res.status(413).json({ error: 'Uncompressed file too large.' });
    }

    // 4. 💾 Save to disk
    await fs.writeFile(destPath, decompressed);
    res.status(200).json({ ok: true });

  } catch (err) {
    console.error(`[ERROR] ${id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

// HEAD check for remote .gz size
async function checkRemoteSize(url, maxSizeMB) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      const contentLength = res.headers['content-length'];
      if (!contentLength) return resolve(false);
      const sizeMB = parseInt(contentLength, 10) / (1024 * 1024);
      resolve(sizeMB <= maxSizeMB);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}
