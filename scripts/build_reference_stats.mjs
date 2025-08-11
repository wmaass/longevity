// scripts/build_reference_stats.mjs
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

const PGS_IDS = ["PGS000301", "PGS002009"]; // EFO_0006335 (systolic BP)

const AF_CANDIDATES = [
  "effect_allele_frequency",
  "hm_effect_allele_frequency",
  "hm_af",
  "eaf",
  "effect_allele_frequency_in_training",
  "ref_allele_frequency",
  "allele_frequency",
];

const W_CANDS = ["effect_weight", "beta", "weight"];

const findIdx = (header, names) => {
  const low = header.map((h) => (h || "").toLowerCase());
  for (const n of names) {
    const i = low.indexOf(n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
};

async function fetchTsv(pgsId) {
  const base = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${pgsId}/ScoringFiles/Harmonized/${pgsId}_hmPOS_GRCh37.txt.gz`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`${pgsId}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const unzipped = zlib.gunzipSync(buf).toString("utf8");
  return unzipped;
}

function computeStats(tsv) {
  const lines = tsv.split("\n").filter(Boolean).filter(l => !l.startsWith("#"));
  if (!lines.length) throw new Error("empty file");

  const header = lines[0].split("\t");
  const rows = lines.slice(1);

  const iW  = findIdx(header, W_CANDS);
  const iAF = findIdx(header, AF_CANDIDATES);
  if (iW === -1 || iAF === -1) {
    return { mu: null, sd: null, used: 0, note: "no AF column" };
  }

  let mu = 0, varSum = 0, used = 0;
  for (const line of rows) {
    const f = line.split("\t");
    const beta = parseFloat(f[iW]);
    const p    = parseFloat(f[iAF]);
    if (!Number.isFinite(beta) || !Number.isFinite(p)) continue;
    if (p <= 0 || p >= 1) continue;

    // HWE + independence approximation
    mu     += 2 * p * beta;
    varSum += 2 * p * (1 - p) * beta * beta;
    used++;
  }
  if (used === 0 || varSum <= 0) return { mu: null, sd: null, used: 0, note: "no valid AF rows" };

  const sd = Math.sqrt(varSum);
  return { mu, sd, used, note: "AF-theoretical" };
}

async function main() {
  const out = { meta: { method: "AF-theoretical (Σ2pβ, Σ2p(1-p)β²)", generatedAt: new Date().toISOString() }, scores: {} };

  for (const id of PGS_IDS) {
    try {
      const tsv = await fetchTsv(id);
      const stats = computeStats(tsv);
      out.scores[id] = stats;
      console.log(`${id} -> mu=${stats.mu?.toFixed(4) ?? "NA"}, sd=${stats.sd?.toFixed(4) ?? "NA"}, used=${stats.used}`);
    } catch (e) {
      console.error(`${id} failed:`, e.message);
      out.scores[id] = { mu: null, sd: null, used: 0, note: `error: ${e.message}` };
    }
  }

  // Save in public so the worker can read it
  await fs.writeFile("public/reference_stats.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote public/reference_stats.json");
}

main().catch(e => { console.error(e); process.exit(1); });
