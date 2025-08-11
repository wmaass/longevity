// lib/prsWorker.js
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

async function fetchAndDecompress(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder().decode(pako.ungzip(new Uint8Array(buf)));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

function parse23andMe(txt) {
  return txt
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [rsid, chr, pos, genotype] = l.split('\t');
      return {
        rsid,
        chr,
        pos: parseInt(pos),
        genotype: (genotype || '').toUpperCase()
      };
    });
}

function hasValidBetas(scores) {
  if (!scores || !scores.length) return false;
  // all finite & not all zeros
  let anyNonZero = false;
  for (const s of scores) {
    if (!Number.isFinite(s)) return false;
    if (s !== 0) anyNonZero = true;
  }
  return anyNonZero;
}

self.onmessage = async (e) => {
  const { genomeTxt, pgsId, config } = e.data || {};
  const useLocalFiles = !!config?.useLocalFiles;
  const genomeName = config?.genomeFileName || '(unknown)';

  try {
    // 🔍 Parse genome
    const snps = parse23andMe(genomeTxt || '');
    const genomeByChrPos = {};
    for (const s of snps) genomeByChrPos[`${s.chr}:${s.pos}`] = s.genotype;

    self.postMessage({ logs: [
      `🧬 Genome Name [worker]: ${genomeName}`,
      `🧬 Loaded genome SNPs: ${snps.length}`
    ]});

    // 📥 Load scoring file (local vs FTP)
    let txt, source;
    if (useLocalFiles) {
      source = `/pgs_scores/unpacked/${pgsId}_hmPOS_GRCh37.txt`;
      self.postMessage({ logs: [
        `📁 Lade PGS-Datei: ${pgsId}_hmPOS_GRCh37.txt`,
        `🌐 Von Pfad: ${source}`
      ]});
      txt = await fetchText(source);
    } else {
      source = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;
      self.postMessage({ logs: [ `📥 Lade ${pgsId} von FTP…` ]});
      txt = await fetchAndDecompress(source);
    }

    const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
    const header = lines.shift().split('\t');
    const indChr    = header.indexOf('hm_chr');
    const indPos    = header.indexOf('hm_pos');
    const indEA     = header.indexOf('effect_allele');
    const indOA     = header.indexOf('other_allele') !== -1
                        ? header.indexOf('other_allele')
                        : header.indexOf('hm_inferOtherAllele');
    const indWeight = header.indexOf('effect_weight');
    const indRSID   = header.indexOf('rsID') !== -1 ? header.indexOf('rsID') : null;

    const matches = [];
    const calcRiskScore = [];
    const total = lines.length;

    // for logging
    let minBeta = Infinity, maxBeta = -Infinity;
    let minScore = Infinity, maxScore = -Infinity;

    for (let idx = 0; idx < lines.length; idx++) {
      const row = lines[idx].split('\t');
      const chr = row[indChr];
      const pos = row[indPos];
      const ea  = row[indEA]?.toUpperCase();
      const beta = parseFloat(row[indWeight]);

      if (!Number.isFinite(beta)) continue;

      const genotype = genomeByChrPos[`${chr}:${pos}`];
      if (!genotype || !/^[ACGT]{2}$/.test(genotype)) continue;

      const count = (genotype.match(new RegExp(ea, 'g')) || []).length; // 0..2
      const score = count * beta;

      if (beta < minBeta) minBeta = beta;
      if (beta > maxBeta) maxBeta = beta;
      if (score < minScore) minScore = score;
      if (score > maxScore) maxScore = score;

      matches.push({
        variant: `Chr${chr}.${pos}:g.${row[indOA]}>${ea}`,
        rsid: indRSID ? row[indRSID] : '',
        beta,
        z: count,
        score,
        genotype
      });
      calcRiskScore.push(score);

      if (idx % 10000 === 0) {
        self.postMessage({ type: 'progress', pgsId, pct: (idx / total) * 100 });
      }
    }

    self.postMessage({ type: 'progress', pgsId, pct: 100 });

    if (!matches.length || !hasValidBetas(calcRiskScore)) {
      self.postMessage({ logs: [
        `⚠️ Keine gültigen SNP-Treffer für ${pgsId} (genome=${genomeName})`
      ]});
      self.postMessage({ type: 'done', pgsId, result: null });
      return;
    }

    const rawScore = calcRiskScore.reduce((a, b) => a + b, 0);
    const prs = Math.exp(rawScore);

    // Log the stats so you can verify PRS ≠ rawScore
    self.postMessage({ logs: [
      `📊 ${pgsId}: matches=${matches.length}/${total} | β∈[${minBeta.toExponential(3)}, ${maxBeta.toExponential(3)}] | score∈[${minScore.toExponential(3)}, ${maxScore.toExponential(3)}]`,
      `🧮 ${pgsId} rawScore (Σ β×Dosage): ${rawScore.toFixed(6)}`,
      `📈 ${pgsId} PRS = exp(rawScore): ${prs.toFixed(6)}`
    ]});

    matches.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    self.postMessage({
      type: 'done',
      pgsId,
      result: {
        pgsId,
        rawScore,
        prs,
        matches: matches.length,
        totalVariants: total,
        topVariants: matches.slice(0, 20),
        genomeName,
        source
      }
    });
  } catch (err) {
    self.postMessage({ logs: [ `❌ Worker-Fehler (${pgsId}): ${err.message}` ]});
    self.postMessage({ type: 'done', pgsId, result: null, error: err.message });
  }
};
