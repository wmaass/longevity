// lib/fetchPGSFile.js
import pako from 'pako';

export async function fetchPGSFile(pgsId) {
  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${pgsId}`);

  const arrayBuffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const decompressed = pako.inflate(uint8, { to: 'string' });

  return decompressed;
}
