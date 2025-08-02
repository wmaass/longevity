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
  const key = `${chr}:${pos}`;
  const genotype = map.get(key);
  if (!genotype || !/^[ACGT]{2}$/.test(genotype)) return { count: 0, genotype: null };

  let count = 0;
  if (genotype[0] === ea) count++;
  if (genotype[1] === ea) count++;
  return { count, genotype };
}

async function getBigPGSList(maxVariants) {
  const fileName = `bigPGS_${maxVariants}.json`;
  const cacheUrl = `/pgs_scores/${fileName}`;
  try {
    const res = await fetch(cacheUrl);
    if (res.ok) {
      const json = await res.json();
      return new Set(json);
    }
  } catch (_) {}

  // Build fresh
  const bigList = [];
  const filesRes = await fetch('/pgs_scores/list.json');
  const allFiles = await filesRes.json();

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const pct = ((i + 1) / allFiles.length) * 100;

    const i = allFiles.indexOf(file);
    const progress = ((i + 1) / allFiles.length) * 100;
    self.postMessage({
      currentPGS: file,
      progress,
      log: `🔎 Prüfe Größe von ${file} (${progress.toFixed(1)}%)`
    });


    const url = `/pgs_scores/unpacked/${file}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      const txt = await res.text();
      let count = 0;
      for (let j = 0; j < txt.length; j++) {
        if (txt.charCodeAt(j) === 10 /* \n */) {
          count++;
          if (count > maxVariants) {
            bigList.push(file.split('_')[0]);
            break;
          }
        }
      }
    } catch (_) {}
  }


  const listBlob = new Blob([JSON.stringify(allFiles)], { type: 'application/json' });
  const listA = document.createElement('a');
  listA.href = URL.createObjectURL(listBlob);
  listA.download = 'list.json';
  listA.click();

  const blob = new Blob([JSON.stringify(bigList)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  return new Set(bigList);
}

self.onmessage = async (event) => {
  try {
    const { genomeTxt, efoIds, config } = event.data;
    const snps = parse23andMe(genomeTxt);
    const genomeMap = new Map(snps.map(s => {
      const chr = s.chrom.replace(/^chr/i, '').trim();
      const pos = s.pos.trim();
      return [`${chr}:${pos}`, s.genotype.toUpperCase()];
    }));

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
    const alreadyLogged = new Set();
    const bigPGS = await getBigPGSList(config.MAX_VARIANTS_ALLOWED);

    EFO_LOOP: for (const efoId of efoIds) {
      self.postMessage({ log: `🔍 EFO ${efoId}: Starte Analyse` });

      const matchedPGS = records.filter(r => {
        const mapped = (r['Mapped Trait(s) (EFO ID)'] || '').split(';').map(s => s.trim());
        const original = (r['Trait EFO(s)'] || '').split(';').map(s => s.trim());
        return mapped.includes(efoId) || original.includes(efoId);
      });

      for (const pgs of matchedPGS) {
        const pgsId = pgs['Polygenic Score (PGS) ID'];

        if (bigPGS.has(pgsId)) {
          const msg = `⚠️ Überspringe ${pgsId} – bekannt als zu groß (> ${config.MAX_VARIANTS_ALLOWED})`;
          if (!alreadyLogged.has(msg)) {
            self.postMessage({ log: msg });
            alreadyLogged.add(msg);
          }
          continue;
        }

        try {
          let txt;

          if (config.useLocalFiles) {
            const localUrl = `/pgs_scores/unpacked/${pgsId}_hmPOS_GRCh37.txt`;
            try {
              const res = await fetch(localUrl);
              if (!res.ok) {
                self.postMessage({ log: `⚠️ Lokale Datei ${localUrl} nicht gefunden (Status ${res.status})` });
                continue;
              }
              txt = await res.text();
              self.postMessage({ log: `📁 Lokale Datei geladen: ${pgsId}` });
            } catch (err) {
              self.postMessage({ log: `⚠️ Fehler beim Laden von ${localUrl}: ${err.message}` });
              continue;
            }
          } else {
            const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            txt = pako.inflate(new Uint8Array(buf), { to: 'string' });
          }

          const allLines = txt.split('\n');
          let headerLine = null;
          let dataStart = 0;

          for (let i = 0; i < allLines.length; i++) {
            const line = allLines[i].trim();
            if (line.startsWith('#')) continue;

            const lower = line.toLowerCase();
            if (
              lower.includes('effect_allele') &&
              lower.includes('effect_weight') &&
              (lower.includes('chr') || lower.includes('pos'))
            ) {
              headerLine = line;
              dataStart = i + 1;
              break;
            }
          }

          if (!headerLine) {
            self.postMessage({ log: `⚠️ Header nicht gefunden in ${pgsId}` });
            continue;
          }

          const hdr = headerLine.split('\t');
          const idx = {
            chr: hdr.indexOf('hm_chr') >= 0 ? hdr.indexOf('hm_chr') : hdr.indexOf('chr_name'),
            pos: hdr.indexOf('hm_pos') >= 0 ? hdr.indexOf('hm_pos') : hdr.indexOf('pos'),
            ea: hdr.indexOf('effect_allele'),
            weight: hdr.indexOf('effect_weight'),
          };

          if (idx.chr < 0 || idx.pos < 0 || idx.ea < 0 || idx.weight < 0) {
            self.postMessage({ log: `⚠️ Ungültiger Header in ${pgsId} – fehlende Spalten` });
            continue;
          }

          let rawScore = 0;
          let matched = 0;

          for (let i = dataStart; i < allLines.length; i++) {
            const line = allLines[i].trim();
            if (!line || line.startsWith('#')) continue;
            const cols = line.split('\t');
            const chr = cols[idx.chr].replace(/^chr/i, '').trim();
            const pos = cols[idx.pos].trim();
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

          if (matched === 0) {
            self.postMessage({ log: `⚠️ Keine Übereinstimmung bei ${pgsId}` });
          }

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