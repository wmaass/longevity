importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

const MAX_VARIANTS_ALLOWED = 1000;
const MAX_FILE_SIZE_MB = 10;
const MAX_TOP_VARIANTS = 3;

function parse23andMe(text) {
  return text
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [rsid, chrom, pos, genotype] = line.trim().split('\t');
      return { rsid, chrom, pos, genotype };
    });
}

async function fetchPGSFile(pgsId, config, emitLog) {
  const fileName = `${pgsId}_hmPOS_GRCh37.txt`;
  const url = config.useLocalFiles
    ? `/pgs_scores/unpacked/${fileName}`
    : `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${fileName}.gz`;

  emitLog(`📁 Lade PGS-Datei: ${fileName}`);
  emitLog(`🌐 Von Pfad: ${url}`);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nicht vorhanden oder nicht lesbar: ${fileName}`);

    const blob = await res.blob();
    const sizeMB = blob.size / 1024 / 1024;
    if (sizeMB > MAX_FILE_SIZE_MB) throw new Error(`📦 Datei zu groß: ${sizeMB.toFixed(2)} MB`);

    const buffer = await blob.arrayBuffer();
    const text = url.endsWith('.gz')
      ? pako.inflate(new Uint8Array(buffer), { to: 'string' })
      : new TextDecoder().decode(buffer);

    emitLog(`✅ Datei erfolgreich geladen (${sizeMB.toFixed(2)} MB)`);
    return text;

  } catch (err) {
    emitLog(`❌ Fehler beim Laden der Datei ${fileName}: ${err.message}`);
    throw err;
  }
}

function matchPGS(variants, scoreLines) {
  const header = scoreLines[0].split('\t');
  const records = scoreLines.slice(1).map(l => l.split('\t'));

  const matches = [];

  const idx = {
    rsid: header.indexOf('rsID'),
    beta: header.indexOf('effect_weight'),
    chr: header.indexOf('chr_name'),
    pos: header.indexOf('chr_position'),
    hmRsid: header.indexOf('hm_rsID'),
    hmChr: header.indexOf('hm_chr'),
    hmPos: header.indexOf('hm_pos')
  };

  for (const fields of records) {
    const rsid = fields[idx.hmRsid] || fields[idx.rsid];  // fallback auf original falls kein hm_rsID
    const betaStr = fields[idx.beta];
    const chr = fields[idx.hmChr] || fields[idx.chr];
    const pos = fields[idx.hmPos] || fields[idx.pos];
    const beta = parseFloat(betaStr);

    if (!rsid || isNaN(beta)) continue;

    const variant = variants.find(v => v.rsid === rsid || `${v.chrom}:${v.pos}` === `${chr}:${pos}`);
    if (variant) {
      const dosage = variant.dosage ?? 1;
      matches.push({
        rsid,
        variant: `${chr}:${pos}`,
        genotype: variant.genotype,
        beta,
        dosage,
        score: beta * dosage
      });
    }
  }

  return matches;
}


function computePRS(matches) {
  self.postMessage({ log: `🧮 Start PRS Berechung` });
  let raw = 0;
  for (let i = 0; i < matches.length; i++) {
    raw += matches[i].beta * matches[i].dosage;
  }
  self.postMessage({ log: `🧮 PRS berechnet: ${raw.toFixed(4)} aus ${matches.length} Treffern` });
  return { rawScore: raw, matchedVariants: matches.length };
}

function extractTopVariants(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return [];
  return matches
    .map(m => ({
      rsid: m.rsid,
      variant: `${m.chrom}:${m.pos}`,
      alleles: m.alleles,
      score: m.beta * m.dosage
    }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, MAX_TOP_VARIANTS);
}

function aggregateResults(results) {
  const grouped = {};
  for (const r of results) {
    if (!grouped[r.efoId]) {
      grouped[r.efoId] = {
        efoId: r.efoId,
        trait: r.trait || '',
        prsValues: [],
        percentiles: [],
        totalVariants: 0
      };
    }
    grouped[r.efoId].prsValues.push(r.prs);
    grouped[r.efoId].percentiles.push(r.percentile);
    grouped[r.efoId].totalVariants += r.totalVariants;
  }

  return Object.values(grouped).map(g => {
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      "EFO-ID": g.efoId,
      "Trait": g.trait,
      "PGS Count": g.prsValues.length,
      "Avg PRS": avg(g.prsValues).toFixed(3),
      "Max PRS": Math.max(...g.prsValues).toFixed(3),
      "Min PRS": Math.min(...g.prsValues).toFixed(3),
      "Avg Percentile": avg(g.percentiles).toFixed(1),
      "Max Percentile": Math.max(...g.percentiles).toFixed(1),
      "Min Percentile": Math.min(...g.percentiles).toFixed(1),
      "Total Variants": g.totalVariants
    };
  });
}

self.onmessage = async function (e) {
  const { genomeTxt, efoIds, config, efoToPgsMap: providedMap = {} } = e.data;
  const emitLog = (msg) => self.postMessage({ log: msg });
  const variants = parse23andMe(genomeTxt);
  const results = [];
  const detailRows = [];

  emitLog(`🧬 Genom enthält ${variants.length} Varianten`);

  let traitsMap = {};
  emitLog(`📥 Lade traits.json...`);
  try {
    const traitsRes = await fetch('/traits.json');
    const traitsJson = await traitsRes.json();
    for (const trait of traitsJson) {
      traitsMap[trait.id.trim()] = trait.label.trim();
    }
    emitLog(`✅ traits.json geladen (${Object.keys(traitsMap).length} Traits)`);
  } catch (err) {
    emitLog(`❌ Fehler beim Laden von traits.json: ${err.message}`);
  }

  const effectiveMap = {};
  for (const efo of efoIds) {
    if (providedMap[efo]) {
      effectiveMap[efo] = providedMap[efo];
    } else {
      emitLog(`🔍 Suche PGS für ${efo} in EBI-Metadaten`);
      const metaRes = await fetch('https://ftp.ebi.ac.uk/pub/databases/spot/pgs/metadata/pgs_all_metadata_scores.csv');
      const csv = await metaRes.text();
      const metaLines = csv.split('\n');
      const matches = metaLines
        .filter((l) => {
          const cols = l.split(',');
          const efoCol = cols[5] || '';
          return efoCol.split('|').includes(efo) && l.includes('GRCh37');
        })
        .map((l) => l.split(',')[0]);
      effectiveMap[efo] = matches;
    }
  }

  const totalJobs = Object.values(effectiveMap).reduce((sum, arr) => sum + arr.length, 0);
  let completed = 0;

  for (const efo of efoIds) {
    const pgsIds = effectiveMap[efo];
    if (!pgsIds || pgsIds.length === 0) {
      emitLog(`⚠️ Keine PGS für ${efo}`);
      continue;
    }

    emitLog(`📌 Verwende PGS für ${efo}: ${pgsIds.join(', ')}`);
    const efoDetails = [];

    for (const pgsId of pgsIds) {
      self.postMessage({ log: `⬇️ Lade ${pgsId}`, currentPGS: pgsId, progress: 0, efoId: efo });

      try {
        const rawTxt = await fetchPGSFile(pgsId, config, emitLog);
        const scoreLines = rawTxt.split('\n').filter(l => l && !l.startsWith('#'));
        if (scoreLines.length > MAX_VARIANTS_ALLOWED) {
          emitLog(`⚠️ Überspringe ${pgsId}: zu viele Varianten (${scoreLines.length})`);
          completed++;
          continue;
        }

        emitLog(`🔍 Vergleiche Varianten für ${pgsId}`);
        const matches = matchPGS(variants, scoreLines);
        emitLog(`✅ ${matches.length} Treffer für ${pgsId} gefunden`);

        emitLog(`⚙️ Berechne PRS für ${pgsId}`);
        const { rawScore, matchedVariants } = computePRS(matches);
        emitLog(`✅ PRS für ${pgsId}: ${rawScore.toFixed(4)} (aus ${matchedVariants.length} Varianten)`);


        const traitName = traitsMap[efo] || '';
        const matchedList = Array.isArray(matchedVariants) ? matchedVariants : [];
        const topVariants = matchedList
          .filter(v => v && typeof v.score === 'number' && v.rsid)
          .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
          .slice(0, 10)
          .map(v => ({
            rsid: v.rsid,
            variant: v.variant,
            alleles: v.genotype,
            score: v.score
          }));

        const detail = {
          id: pgsId,
          efoId: efo,
          trait: traitName,
          prs: rawScore,
          rawScore,
          zScore: rawScore,
          percentile: Math.min(99.9, 100 * rawScore / 10),
          matches: matchedList.length,
          totalVariants: scoreLines.length,
          topVariants
        };

        emitLog(`🧬 Trait für ${efo}: ${traitName || '(leer)'}`);

        results.push(detail);
        efoDetails.push(detail);

        detailRows.push({
          efoId: efo,
          id: pgsId,
          trait: traitName,
          rawScore,
          prs: rawScore,
          zScore: rawScore,
          percentile: Math.min(99.9, 100 * rawScore / 10),
          matches: matchedList.length,
          totalVariants: scoreLines.length
        });

      } catch (err) {
        emitLog(`❌ Fehler bei ${pgsId}: ${err.message}`);
      }

      completed++;
      const progress = (completed / totalJobs) * 100;
      self.postMessage({ currentPGS: pgsId, progress, efoId: efo });
    }

    if (config.genomeName && efoDetails.length > 0) {
      try {
        const res = await fetch('/api/saveEfoDetail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            genomeName: config.genomeName,
            efoId: efo,
            detail: efoDetails
          })
        });

        if (!res.ok) {
          const err = await res.text();
          emitLog(`⚠️ Fehler beim Speichern der JSON für ${efo}: ${err}`);
        } else {
          emitLog(`✅ Detail-JSON gespeichert für ${efo}`);
        }
      } catch (e) {
        emitLog(`❌ Netzwerkfehler beim Speichern von ${efo}: ${e.message}`);
      }
    }
  }

  const aggregated = aggregateResults(results);

  const efoDetailsMap = {};
  for (const r of results) {
    if (!efoDetailsMap[r.efoId]) efoDetailsMap[r.efoId] = [];
    efoDetailsMap[r.efoId].push({
      id: r.id,
      trait: r.trait,
      rawScore: r.rawScore,
      prs: r.prs,
      zScore: r.zScore,
      percentile: r.percentile,
      matches: r.matches,
      totalVariants: r.totalVariants,
      topVariants: r.topVariants
    });
  }

  self.postMessage({
    results,
    aggregated,
    detailRows,
    efoDetailsMap,
    logs: [`✅ Analyse abgeschlossen (${results.length} Resultate)`],
    log: `✅ Analyse abgeschlossen (${results.length} Resultate)`
  });
};

function computePRS(matches) {
  self.postMessage({ log: `🧮 Start PRS Berechung` });
  let raw = 0;
  for (let i = 0; i < matches.length; i++) {
    raw += matches[i].beta * matches[i].dosage;
  }
  self.postMessage({ log: `🧮 PRS berechnet: ${raw.toFixed(4)} aus ${matches.length} Treffern` });
  return { rawScore: raw, matchedVariants: matches };
}

