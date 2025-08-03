// pages/api/fetchAndUnpackPGS.js
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import zlib from 'zlib';
import { promisify } from 'util';

const pipeline = promisify(require('stream').pipeline);
const MAX_UNZIPPED_SIZE_MB = 10; // <- Grenze für entpackte Datei
const LOCAL_DIR = './public/pgs_scores/unpacked';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || !/^PGS\d+$/.test(id)) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }

  const remoteUrl = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh37.txt.gz`;

  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      return res.status(404).json({ error: `Datei ${id} nicht gefunden` });
    }

    const tempPath = path.join('/tmp', `${id}.txt.gz`);
    const writeStream = fs.createWriteStream(tempPath);
    await pipeline(response.body, writeStream);

    // 🧠 Entpacken und Größe messen
    const gzBuffer = fs.readFileSync(tempPath);
    const unzippedBuffer = zlib.gunzipSync(gzBuffer);
    const sizeMB = unzippedBuffer.length / (1024 * 1024);

    if (sizeMB > MAX_UNZIPPED_SIZE_MB) {
      fs.unlinkSync(tempPath); // löschen
      return res.status(413).json({ error: `Entpackte Datei zu groß (${sizeMB.toFixed(2)} MB)` });
    }

    // ✅ speichern
    if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const outPath = path.join(LOCAL_DIR, `${id}_hmPOS_GRCh37.txt`);
    fs.writeFileSync(outPath, unzippedBuffer);

    res.status(200).json({ message: `✔️ ${id} entpackt (${sizeMB.toFixed(2)} MB)` });
  } catch (err) {
    console.error(`[fetchAndUnpackPGS] Fehler bei ${id}:`, err.message);
    res.status(500).json({ error: `Fehler bei ${id}: ${err.message}` });
  }
}
