// Node >=18, ESM
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// --- paths
const ROOT        = path.resolve(__dirname, "..");
const PUBLIC_DIR  = path.join(ROOT, "public");
const SCORES_DIR  = path.join(PUBLIC_DIR, "pgs_scores", "unpacked");
const AF_FILE     = path.join(PUBLIC_DIR, "eur_af_by_rsid.tsv");
const OUT_JSON    = path.join(PUBLIC_DIR, "reference_stats.json");

// --- restrict to the PGSs you care about (your list)
const EFO_TO_PGS = {
  "EFO_0004541": ["PGS000127","PGS000128","PGS000129","PGS000130","PGS000131","PGS000132","PGS000304"],
  "EFO_0004611": ["PGS000061","PGS000065","PGS000115","PGS000310","PGS000340","PGS000661"],
  "EFO_0004612": ["PGS000060","PGS000064","PGS000309","PGS000660"],
  "EFO_0004530": ["PGS000063","PGS000066","PGS000312","PGS000659"],
  "EFO_0001645": ["PGS000010","PGS000011","PGS000012","PGS000019","PGS000057","PGS000058","PGS000059","PGS000116","PGS000200","PGS000337","PGS000349"],
  "EFO_0006335": ["PGS000301","PGS002009"],
  "EFO_0004574": ["PGS000062","PGS000311","PGS000658","PGS000677"],
  "EFO_0004458": ["PGS000314","PGS000675"],
  "EFO_0006336": ["PGS000302","PGS001900"]
};

// --- header helpers
const norm = (s) =>
  String(s || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();

function findCols(headerParts) {
  const H = headerParts.map(norm);
  const find = (names) => {
    for (const n of names) {
      const i = H.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iRS   = find(["rsid","rs","snp","snpid","variantid"]);
  const iHMRS = find(["hm_rsid","hmrsid","hmvariantid"]);
  const iEA   = find(["effect_allele","hm_effect_allele","effectallele","ea","a1"]);
  const iBETA = find(["effect_weight","beta","weight"]);
  // need EA+beta, and either rsID or hm_rsID
  if (iEA === -1 || iBETA === -1 || (iRS === -1 && iHMRS === -1)) return null;
  return { iRS, iHMRS, iEA, iBETA };
}

// --- scan scoring files to collect needed RSIDs & variant info
async function readScoreFileVariants(pgsId) {
  const file = path.join(SCORES_DIR, `${pgsId}_hmPOS_GRCh37.txt`);
  if (!fs.existsSync(file)) return { variants: [], rsNeeded: new Set() };

  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let cols = null;
  let gotHeader = false;
  const variants = [];
  const rsNeeded = new Set();

  for await (const line of rl) {
    if (!line) continue;
    if (line.startsWith("#")) continue;
    const parts = line.split("\t");

    if (!gotHeader) {
      cols = findCols(parts);
      if (!cols) continue; // not a data header, keep scanning
      gotHeader = true;
      continue;
    }

    const rsRaw = parts[cols.iHMRS >= 0 ? cols.iHMRS : cols.iRS] || "";
    const rs    = String(rsRaw).trim();
    const ea    = String(parts[cols.iEA] || "").trim().toUpperCase();
    const beta  = parseFloat(parts[cols.iBETA]);
    if (!rs || !ea || !Number.isFinite(beta)) continue;
    if (!["A","C","G","T"].includes(ea)) continue;

    variants.push({ rs, ea, beta });
    rsNeeded.add(rs);
  }

  return { variants, rsNeeded };
}

async function buildNeededSets(pgsList) {
  const perPGS = {};
  const needed = new Set();

  for (const pgsId of pgsList) {
    const { variants, rsNeeded } = await readScoreFileVariants(pgsId);
    perPGS[pgsId] = variants;
    for (const rs of rsNeeded) needed.add(rs);
    console.log(`• ${pgsId}: ${variants.length} variants`);
  }
  console.log(`→ Unique rsIDs needed: ${needed.size}`);
  return { perPGS, needed };
}

// --- stream AF file once and keep only needed rsIDs
async function loadAFSubset(afPath, neededSet) {
  const rl = readline.createInterface({ input: fs.createReadStream(afPath) });
  const af = new Map();
  let lineNo = 0;

  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) continue; // header
    const [rs, A, C, G, T] = line.split("\t");
    if (!rs || !neededSet.has(rs)) continue;
    af.set(rs, {
      A: parseFloat(A), C: parseFloat(C), G: parseFloat(G), T: parseFloat(T)
    });
  }
  console.log(`→ Loaded AF rows for ${af.size} / ${neededSet.size} rsIDs`);
  return af;
}

// --- compute mu/sd per PGS
function computeStatsForPGS(variants, afMap) {
  let mu = 0, varSum = 0, used = 0;
  for (const { rs, ea, beta } of variants) {
    const row = afMap.get(rs);
    if (!row) continue;
    const p = row[ea];
    if (!Number.isFinite(p) || p <= 0 || p >= 1) continue;
    mu     += 2 * p * beta;
    varSum += 2 * p * (1 - p) * beta * beta;
    used++;
  }
  if (used === 0 || varSum <= 0) return { mu: null, sd: null, used: 0 };
  return { mu, sd: Math.sqrt(varSum), used };
}

// --- main
(async () => {
  if (!fs.existsSync(SCORES_DIR)) {
    console.error(`❌ Missing scores dir: ${SCORES_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(AF_FILE)) {
    console.error(`❌ Missing AF file: ${AF_FILE}`);
    process.exit(1);
  }

  const wantedPGS = [...new Set(Object.values(EFO_TO_PGS).flat())];
  console.log(`📂 Scores dir: ${SCORES_DIR}`);
  console.log(`🧪 PGS to compute: ${wantedPGS.length}`);
  console.log(`📄 AF map: ${AF_FILE}`);

  const { perPGS, needed } = await buildNeededSets(wantedPGS);
  const afSubset = await loadAFSubset(AF_FILE, needed);

  const scores = {};
  for (const pgsId of wantedPGS) {
    const s = computeStatsForPGS(perPGS[pgsId] || [], afSubset);
    scores[pgsId] = s;
    console.log(`✅ ${pgsId}: used=${s.used} mu=${s.mu ?? "null"} sd=${s.sd ?? "null"}`);
  }

  const out = {
    meta: {
      method: "AF by rsID (1000G EUR map)",
      generatedAt: new Date().toISOString(),
      pgsCount: wantedPGS.length
    },
    scores
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  console.log(`\n💾 Wrote ${OUT_JSON}`);
})();
