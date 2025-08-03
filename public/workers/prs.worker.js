// workers/prs.worker.js
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

// 🧾 Logger-Modul zur strukturierten Ausgabe
const Logger = (() => {
  const counters = new Map();
  const allLogs = [];

  function log(message, level = 'info', tag = null, limit = null) {
    const key = tag || message;
    const count = counters.get(key) || 0;

    if (limit === null || count < limit) {
      const formatted = `[${level.toUpperCase()}] ${message}`;
      postMessage({ log: formatted });
      allLogs.push(formatted);
      counters.set(key, count + 1);
    }
  }

  return {
    info: (msg, tag = null, limit = null) => log(msg, 'info', tag, limit),
    warn: (msg, tag = null, limit = null) => log(msg, 'warn', tag, limit),
    error: (msg, tag = null, limit = null) => log(msg, 'error', tag, limit),
    debug: (msg, tag = null, limit = null) => log(msg, 'debug', tag, limit),
    reset: () => counters.clear(),
    getAll: () => allLogs
  };
})();

let TRAIT_LOOKUP = {};

async function loadTraitLabels() {
  try {
    const res = await fetch('/traits.json');
    if (!res.ok) return;
    const traitList = await res.json();
    for (const trait of traitList) {
      if (trait.id && trait.label) {
        TRAIT_LOOKUP[trait.id] = trait.label;
      }
    }
  } catch (err) {
    Logger.error(`Fehler beim Laden von traits.json: ${err.message}`);
  }
}

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

onmessage = async function (event) {
  try {
    const startTime = Date.now();
    const { genomeTxt, efoIds, config } = event.data;
    Logger.reset();
    await loadTraitLabels();

    const snps = parse23andMe(genomeTxt);
    const genomeMap = new Map(snps.map(s => {
      const chr = s.chrom.replace(/^chr/i, '').trim();
      const pos = s.pos.trim();
      return [`${chr}:${pos}`, s.genotype.toUpperCase()];
    }));

    Logger.info(`📋 Anzahl SNPs im Genom: ${snps.length}`);

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

    let bigPGS = [];
    const maxVar = config.MAX_VARIANTS_ALLOWED || 100000;
    try {
      const bigPGSRes = await fetch(`/pgs_scores/bigPGS_${maxVar}.json`);
      if (bigPGSRes.ok) {
        bigPGS = await bigPGSRes.json();
        Logger.info(`📂 ${bigPGS.length} große PGS-Dateien werden übersprungen (>${maxVar})`);
      } else {
        Logger.info(`⚙️ Serverseitige Erzeugung bigPGS_${maxVar}.json wird angestoßen…`);
        const trigger = await fetch(`/api/genBigPGS?max=${maxVar}`);
        if (trigger.ok) {
          const retry = await fetch(`/pgs_scores/bigPGS_${maxVar}.json`);
          if (retry.ok) {
            bigPGS = await retry.json();
            Logger.info(`📁 bigPGS_${maxVar}.json geladen: ${bigPGS.length} Dateien`);
          }
        }
      }
    } catch (err) {
      Logger.warn(`Fehler beim Laden oder Erzeugen von bigPGS_${maxVar}.json: ${err.message}`);
    }

    const results = [];

    for (const efoId of efoIds) {
      Logger.info(`🔍 EFO ${efoId}: Starte Analyse`);

      const matchedPGS = records.filter(r => {
        const mapped = (r['Mapped Trait(s) (EFO ID)'] || '').split(';').map(s => s.trim());
        const original = (r['Trait EFO(s)'] || '').split(';').map(s => s.trim());
        return mapped.includes(efoId) || original.includes(efoId);
      });

      Logger.info(`📑 ${matchedPGS.length} PGS-Einträge für ${efoId} gefunden.`);

      for (let i = 0; i < matchedPGS.length; i++) {
        const pgs = matchedPGS[i];
        const pgsId = pgs['Polygenic Score (PGS) ID'];

        if (bigPGS.includes(pgsId)) {
          Logger.debug(`${pgsId} übersprungen – zu groß`);
          continue;
        }

        const localUrl = `/pgs_scores/unpacked/${pgsId}_hmPOS_GRCh37.txt`;
        Logger.info(`📥 Prüfe lokale Datei für ${pgsId}`, `fetch:${pgsId}`);

        let txt;
        try {
          const res = await fetch(localUrl);
          if (!res.ok) {
            Logger.warn(`📂 ${pgsId} nicht lokal gefunden, versuche Download vom FTP`, `fetch:${pgsId}`);

            const ftpUrl = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;

            // Anfrage an eigene API zum Herunterladen und Entpacken
            const unpackRes = await fetch(`/api/fetchAndUnpackPGS?id=${pgsId}`);
            if (!unpackRes.ok) {
              Logger.warn(`❌ ${pgsId} konnte nicht vom FTP geladen werden (API-Rückgabe: ${unpackRes.status})`);
              continue;
            }

            // Danach erneut versuchen, lokal zu laden
            const retry = await fetch(localUrl);
            if (!retry.ok) {
              Logger.warn(`❌ ${pgsId} nach Download nicht auffindbar`);
              continue;
            }

            txt = await retry.text();
          } else {
            txt = await res.text();
          }
        } catch (err) {
          Logger.warn(`Fehler beim Zugriff auf ${pgsId}: ${err.message}`);
          continue;
        }

        const lines = txt.split('\n');
        Logger.info(`📊 ${pgsId}: Datei geladen mit ${lines.length} Zeilen`);

        let headerLine = null;
        let dataStart = 0;

        for (let j = 0; j < lines.length; j++) {
          const line = lines[j].trim();
          if (line.startsWith('#')) continue;
          const lower = line.toLowerCase();
          if (lower.includes('effect_allele') && lower.includes('effect_weight') && (lower.includes('chr') || lower.includes('pos'))) {
            headerLine = line;
            dataStart = j + 1;
            Logger.debug(`${pgsId}: Header erkannt in Zeile ${j}`);
            break;
          }
        }

        if (!headerLine) {
          Logger.warn(`Kein gültiger Header in ${pgsId}, breche ab`);
          continue;
        }

        const hdr = headerLine.split('\t');
        const idx = {
          chr: hdr.indexOf('hm_chr') >= 0 ? hdr.indexOf('hm_chr') : hdr.indexOf('chr_name'),
          pos: hdr.indexOf('hm_pos') >= 0 ? hdr.indexOf('hm_pos') : hdr.indexOf('pos'),
          ea: hdr.indexOf('effect_allele'),
          weight: hdr.indexOf('effect_weight')
        };

        if (idx.chr < 0 || idx.pos < 0 || idx.ea < 0 || idx.weight < 0) {
          Logger.warn(`Ungültiger Header in ${pgsId}`);
          continue;
        }

        let rawScore = 0;
        let matched = 0;
        let validRows = 0;

        for (let j = dataStart; j < lines.length; j++) {
          const line = lines[j].trim();
          if (!line || line.startsWith('#')) continue;
          validRows++;
          const cols = line.split('\t');
          const chr = cols[idx.chr]?.replace(/^chr/i, '').trim();
          const pos = cols[idx.pos]?.trim();
          const ea = cols[idx.ea]?.toUpperCase();
          const beta = parseFloat(cols[idx.weight]) || 0;
          const { count } = matchGenotype(genomeMap, chr, pos, ea);
          rawScore += count * beta;
          if (count > 0) {
            matched++;
            Logger.debug(
              `🔎 Match bei ${chr}:${pos} – EA: ${ea}, Count: ${count}, Beta: ${beta.toFixed(4)}, Beitrag: ${(count * beta).toFixed(4)}`,
              `match:${pgsId}`,
              10
            );
          }
        }

        Logger.info(`🔬 ${pgsId}: Verarbeitet: ${validRows} Datenzeilen, matched: ${matched}`);

        const prs = Math.exp(rawScore);
        const { z, percentile } = computeStats(rawScore);

        Logger.info(`📈 ${pgsId}: RawScore=${rawScore.toFixed(4)}, PRS=${prs.toFixed(4)}, z=${z.toFixed(2)}, Perzentil=${percentile}`);

        try {
          // Neue Top-Variantenerfassung
          const variants = [];

          for (let j = dataStart; j < lines.length; j++) {
            const line = lines[j].trim();
            if (!line || line.startsWith('#')) continue;

            const cols = line.split('\t');
            const chr = cols[idx.chr]?.replace(/^chr/i, '').trim();
            const pos = cols[idx.pos]?.trim();
            const ea = cols[idx.ea]?.toUpperCase();
            const beta = parseFloat(cols[idx.weight]) || 0;
            const { count, genotype } = matchGenotype(genomeMap, chr, pos, ea);
            if (count > 0) {
              variants.push({
                variant: `Chr${chr}.${pos}:g.${ea}`,
                rsid: cols.find(c => c?.startsWith('rs')) || null,
                beta,
                z: count,
                score: count * beta,
                alleles: genotype || null
              });
            }
          }

          // Top 3 Varianten nach Score
          const topVariants = variants
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);  // kannst du auch auf 5 oder 10 erweitern

          const detail = {
            id: pgsId,
            trait: `PGS für ${efoId}`,
            rawScore,
            prs,
            zScore: z,
            percentile,
            matches: matched,
            totalVariants: validRows,
            topVariants
          };

          await fetch('/api/saveEfoDetail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ efoId, detail })
          });
          Logger.info(`💾 Detaildatei für ${pgsId} gespeichert.`);
        } catch (saveErr) {
          Logger.warn(`❌ Fehler beim Speichern von ${pgsId}: ${saveErr.message}`);
        }


        if (matched === 0) {
          Logger.warn(`Keine Übereinstimmungen bei ${pgsId}`);
        }

        Logger.info(`✅ ${pgsId}: Analyse abgeschlossen (n=${matched})`);
      }

      Logger.info(`🎯 Analyse für ${efoId} abgeschlossen`);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    Logger.info(`✅ Gesamtanalyse abgeschlossen in ${duration}s`);
    postMessage({ results, logs: Logger.getAll() });

  } catch (err) {
    console.error('[Worker Fehler]', err);
    postMessage({ error: err.message });
  }
};
