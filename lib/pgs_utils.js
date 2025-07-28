import pako from 'pako';

// PGS-Datei vom FTP laden und entpacken (GRCh37)
export async function fetchPGSFile(id) {
  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh37.txt.gz`;
  console.log(`==> Lade PGS-Datei: ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`PGS-Download fehlgeschlagen (${id}): ${res.statusText}`);

  const buffer = await res.arrayBuffer();
  const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
  if (typeof decompressed !== 'string') {
    throw new Error(`PGS-Datei (${id}) konnte nicht als Text entpackt werden`);
  }
  return decompressed;
}

// Prüft, ob Betas plausibel sind (um Hazard Ratios auszuschließen)
export function hasValidBetas(scores) {
  if (!scores || scores.length === 0) return false;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  return !(minScore === 0 && maxScore > 1);
}

// Berechnet grob Z-Score und Perzentil (ohne Referenzpopulation)
export function computeStats(rawScore) {
  const mean = 0;
  const stdDev = 1;
  const z = (rawScore - mean) / stdDev;

  const erf = (x) => {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const tau =
      t *
      Math.exp(
        -x * x -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t *
                            (0.27886807 +
                              t *
                                (-1.13520398 +
                                  t *
                                    (1.48851587 +
                                      t *
                                        (-0.82215223 + t * 0.17087277))))))))
      );
    return sign * (1 - tau);
  };

  const percentile = Math.round(((1 + erf(z / Math.sqrt(2))) / 2) * 100);
  return { z, percentile };
}
