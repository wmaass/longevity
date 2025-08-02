// workers/prs.worker.js
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

function parse23andMe(text) {
  return text
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [rsid, chrom, pos, genotype] = line.trim().split('\t');
      return { rsid, chrom, pos, genotype };
    });
}

function computeStats(rawScore) {
  const z = rawScore;
  const erf = (x) => {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const tau = t * Math.exp(-x * x - 1.26551223 +
      t * (1.00002368 + t * (0.37409196 + t *
        (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t *
          (-1.13520398 + t * (1.48851587 + t *
            (-0.82215223 + t * 0.17087277)))))))));
    return sign * (1 - tau);
  };
  const percentile = Math.round(((1 + erf(z / Math.sqrt(2))) / 2) * 100);
  return { z, percentile };
}

function matchGenotype(map, chr, pos, ea) {
  const genotype = map.get(`${chr}:${pos}`);
  if (!genotype || !/^[ACGT]{2}$/.test(genotype)) return { count: 0, genotype: null };

  let count = 0;
  if (genotype[0] === ea) count++;
  if (genotype[1] === ea) count++;
  return { count, genotype };
}

self.onmessage = async (event) => {
  try {
    const { genomeTxt, efoIds, config } = event.data;
    const snps = parse23andMe(genomeTxt);
    const genomeMap = new Map(snps.map(s => [`${s.chrom}:${s.pos}`, s.genotype.toUpperCase()]));

    const metadataRes = await fetch(config.METADATA_URL);
    const csvText = await metadataRes.text();
    const metadataLines = csvText.split('\n');
    const header = metadataLines[0].split(',');
    const records = metadataLines.slice(1).map(l => {
      const cols = l.split(',');
      const record = {};
      header.forEach((key, i) => {
        record[key.trim()] = cols[i]?.trim();
      });
      return record;
    });

    const results = [];

    for (const efoId of efoIds) {
      self.postMessage({ log: `🔍 EFO ${efoId}: Starte Analyse` });

      const matchedPGS = records.filter(r => {
        const mapped = (r['Mapped Trait(s) (EFO ID)'] || '').split(';').map(s => s.trim());
        const original = (r['Trait EFO(s)'] || '').split(';').map(s => s.trim());
        return mapped.includes(efoId) || original.includes(efoId);
      });

      for (const pgs of matchedPGS) {
        const pgsId = pgs['Polygenic Score (PGS) ID'];
        const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;

        try {
          self.postMessage({ log: `⬇️ Lade ${pgsId}` });
          const res = await fetch(url);
          const buf = await res.arrayBuffer();
          const txt = pako.inflate(new Uint8Array(buf), { to: 'string' });

          const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
          if (lines.length > config.MAX_VARIANTS_ALLOWED) {
            self.postMessage({ log: `⚠️ Überspringe ${pgsId} – zu viele Varianten (${lines.length})` });
            continue;
          }

          const hdr = lines[0].split('\t');
          const idx = {
            chr: hdr.indexOf('hm_chr'),
            pos: hdr.indexOf('hm_pos'),
            ea: hdr.indexOf('effect_allele'),
            oa: hdr.indexOf('other_allele'),
            weight: hdr.indexOf('effect_weight'),
            rsid: hdr.indexOf('rsID'),
          };

          let rawScore = 0;
          let matched = 0;

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split('\t');
            const chr = cols[idx.chr];
            const pos = cols[idx.pos];
            const ea = cols[idx.ea]?.toUpperCase();
            const beta = parseFloat(cols[idx.weight]) || 0;
            const { count } = matchGenotype(genomeMap, chr, pos, ea);
            rawScore += count * beta;
            if (count > 0) matched++;
          }

          const prs = Math.exp(rawScore);
          const { z, percentile } = computeStats(rawScore);

          results.push({
            efoId,
            id: pgsId,
            rawScore,
            prs,
            percentile,
            totalVariants: matched
          });

          self.postMessage({ log: `✅ ${pgsId}: Score berechnet (n=${matched})` });
        } catch (err) {
          self.postMessage({ log: `❌ Fehler bei ${pgsId}: ${err.message}` });
        }
      }

      self.postMessage({ log: `🎯 Fertig mit ${efoId}` });
    }

    self.postMessage({ log: `✅ Gesamtanalyse abgeschlossen`, results });

  } catch (err) {
    console.error('[Worker Fehler]', err);
    self.postMessage({ error: err.message });
  }
};