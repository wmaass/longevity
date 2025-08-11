// lib/prsWorker.js
importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

async function fetchAndDecompress(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new TextDecoder().decode(pako.ungzip(new Uint8Array(buf)));
}

function parse23andMe(txt) {
  return txt
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [rsid, chr, pos, genotype] = l.split('\t');
      return { rsid, chr, pos: parseInt(pos), genotype: genotype.toUpperCase() };
    });
}

function hasValidBetas(scores) {
  if (!scores.length) return false;
  let minScore = scores[0];
  let maxScore = scores[0];
  for (let s of scores) {
    if (s < minScore) minScore = s;
    if (s > maxScore) maxScore = s;
  }
  return !(minScore === 0 || maxScore > 1);
}


self.onmessage = async (e) => {
  const { genomeTxt, config } = e.data;

  const snps = parse23andMe(genomeTxt);
  const genomeByChrPos = {};
  snps.forEach(s => {
    genomeByChrPos[`${s.chr}:${s.pos}`] = s.genotype;
  });

  const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;
  self.postMessage({ type: 'status', msg: `Lade ${pgsId}…` });
  const txt = await fetchAndDecompress(url);

  const lines = txt.split('\n').filter(l => l && !l.startsWith('#'));
  const header = lines.shift().split('\t');
  const indChr = header.indexOf('hm_chr');
  const indPos = header.indexOf('hm_pos');
  const indEA = header.indexOf('effect_allele');
  const indOA = header.indexOf('other_allele') !== -1 ? header.indexOf('other_allele') : header.indexOf('hm_inferOtherAllele');
  const indWeight = header.indexOf('effect_weight');
  const indRSID = header.indexOf('rsID') !== -1 ? header.indexOf('rsID') : null;

  const matches = [];
  const calcRiskScore = [];
  const total = lines.length;

  lines.forEach((line, idx) => {
    const row = line.split('\t');
    const chr = row[indChr];
    const pos = row[indPos];
    const ea = row[indEA]?.toUpperCase();
    const beta = parseFloat(row[indWeight]) || 0;
    const genotype = genomeByChrPos[`${chr}:${pos}`];
    if (!genotype || !/^[ACGT]{2}$/.test(genotype)) return;

    const count = (genotype.match(new RegExp(ea, 'g')) || []).length;
    const score = count * beta;
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
  });

  self.postMessage({ type: 'progress', pgsId, pct: 100 });

  if (!matches.length || !hasValidBetas(calcRiskScore)) {
    self.postMessage({ type: 'done', pgsId, result: null });
    return;
  }

  const rawScore = calcRiskScore.reduce((a, b) => a + b, 0);
  const PRS = Math.exp(rawScore);

  matches.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  self.postMessage({
    type: 'done',
    pgsId,
    result: {
      pgsId,
      rawScore,
      prs: PRS,
      matches: matches.length,
      totalVariants: total,
      topVariants: matches.slice(0, 20)
    }
  });
};
