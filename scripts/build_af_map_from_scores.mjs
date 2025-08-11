// Node >=18, ESM
import fs from "fs";
import path from "path";
import readline from "readline";
import { once } from "events";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT       = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SCORES_DIR = path.join(PUBLIC_DIR, "pgs_scores", "unpacked");
const AF_FILE    = path.join(PUBLIC_DIR, "eur_af_by_rsid.tsv");

// -------- helpers

const normalize = (s) =>
  String(s || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const rsidNames = new Set(["hmrsid","hmrsidv2","rsid","rs","snp","snpid","variantid","hmvariantid"]);
const hmRsidNames = new Set(["hmrsid","hmrsidv2","hmvariantid"]);
const effectAlleleNames = new Set(["effectallele","hmeffectallele","ea","allele","a1","effect"]);

function findCols(headerParts) {
  const norm = headerParts.map(normalize);
  const findFirst = (cands) => norm.findIndex((n) => cands.has(n));
  const iRS     = findFirst(rsidNames);
  const iHMRSID = findFirst(hmRsidNames);
  const iEA     = findFirst(effectAlleleNames);
  if (iEA === -1 || (iRS === -1 && iHMRSID === -1)) return null;
  return { iRS, iHMRSID, iEA };
}

function approxAF(effectAllele) {
  const EA = String(effectAllele || "").toUpperCase().trim();
  if (!["A","C","G","T"].includes(EA)) return null;
  const pEA = 0.35; // simple prior for testing
  const rest = (1 - pEA) / 3;
  return {
    A: EA === "A" ? pEA : rest,
    C: EA === "C" ? pEA : rest,
    G: EA === "G" ? pEA : rest,
    T: EA === "T" ? pEA : rest,
  };
}

async function loadExistingRsids(file) {
  const set = new Set();
  if (!fs.existsSync(file)) return set;
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; } // skip header
    const rs = line.split("\t")[0];
    if (rs) set.add(rs);
  }
  return set;
}

async function createAppendStream(file) {
  const needHeader = !fs.existsSync(file) || fs.statSync(file).size === 0;
  const ws = fs.createWriteStream(file, { flags: "a" });
  const write = async (str) => {
    if (!ws.write(str)) await once(ws, "drain");
  };
  if (needHeader) {
    await write("rsid\tA\tC\tG\tT\n");
  }
  return { ws, write };
}

function listScoreFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("_hmPOS_GRCh37.txt"))
    .map((f) => path.join(dir, f));
}

// -------- main

(async () => {
  if (!fs.existsSync(SCORES_DIR)) {
    console.error(`❌ Scoring directory not found: ${SCORES_DIR}`);
    process.exit(1);
  }

  console.log(`📂 Scanning: ${SCORES_DIR}`);
  console.log(`📝 AF map:   ${AF_FILE}`);

  const files = listScoreFiles(SCORES_DIR);
  if (!files.length) {
    console.warn("⚠️  No *_hmPOS_GRCh37.txt files found.");
    process.exit(0);
  }

  // Load existing rsIDs via streaming (no giant string concat)
  const existing = await loadExistingRsids(AF_FILE);
  console.log(`📚 Existing rsIDs: ${existing.size}`);

  const { ws, write } = await createAppendStream(AF_FILE);

  let totalAdded = 0;
  let processed = 0;

  for (const file of files) {
    const base = path.basename(file);
    const rl = readline.createInterface({ input: fs.createReadStream(file) });

    let headerFound = false;
    let cols = null;
    let addedForFile = 0;

    for await (const line of rl) {
      if (!line) continue;
      if (!headerFound) {
        // skip comment/meta lines starting with '#'
        if (line.trim().startsWith("#")) continue;
        const parts = line.split("\t");
        const c = findCols(parts);
        if (!c) {
          // if this non-comment line isn't header, keep scanning until we find one
          continue;
        }
        cols = c;
        headerFound = true;
        continue;
      }

      if (line.trim().startsWith("#")) continue; // stray comments
      const f = line.split("\t");
      const rs = String(f[cols.iRS] || f[cols.iHMRSID] || "").trim();
      const ea = String(f[cols.iEA] || "").trim();
      if (!rs || !ea) continue;
      if (existing.has(rs)) continue;

      const af = approxAF(ea);
      if (!af) continue;

      await write(`${rs}\t${af.A}\t${af.C}\t${af.G}\t${af.T}\n`);
      existing.add(rs);
      addedForFile++;
      totalAdded++;
    }

    if (!headerFound) {
      console.warn(`⚠️  ${base}: no usable header (only comments or missing columns)`);
    } else {
      console.log(`✅ ${base}: +${addedForFile} rsIDs`);
    }
    processed++;
  }

  ws.end();
  console.log(`\n📄 Files processed: ${processed}/${files.length}`);
  console.log(`🎉 Appended ${totalAdded} unique rsIDs → ${AF_FILE}`);
})();
