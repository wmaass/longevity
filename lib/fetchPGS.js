import fetch from 'node-fetch';
import fs from 'fs';
import zlib from 'zlib';

export async function fetchPGSStrokeScore() {
  const localFile = './pgs-stroke.txt';
  if (fs.existsSync(localFile)) {
    console.log(`==> Verwende gecachte PGS-Datei (${localFile})`);
    return localFile;
  }

  const pgsId = 'PGS000004';  // Schlaganfall (kompakt)
  const baseUrl = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/`;

  console.log(`==> Suche Scoring-Datei für ${pgsId} unter: ${baseUrl}`);

  const indexRes = await fetch(baseUrl);
  if (!indexRes.ok) throw new Error(`PGS Index nicht erreichbar: ${indexRes.statusText}`);
  const indexHtml = await indexRes.text();

  const match = indexHtml.match(/href="([^"]+\.txt\.gz)"/);
  if (!match) throw new Error('Keine Scoring-Datei im Index gefunden');

  const fileUrl = baseUrl + match[1];
  console.log('==> Lade Score-Datei:', fileUrl);

  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Score-Download fehlgeschlagen: ${res.statusText}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const decompressed = zlib.gunzipSync(buffer);
  fs.writeFileSync(localFile, decompressed);

  console.log(`==> PGS-Datei gespeichert: ${localFile}`);
  return localFile;
}
