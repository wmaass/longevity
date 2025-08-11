// scripts/patch_af_map_all.mjs
// Node >= 18
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..");        // repo root
const PUBLIC_DIR = path.join(ROOT, "public");
const SCORES_DIR = path.join(PUBLIC_DIR, "pgs_scores", "unpacked");
const AF_FILE    = path.join(PUBLIC_DIR, "eur_af_by_rsid.tsv");

// Your EFO -> PGS map
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

function ensureHeader(text) {
  const header = "rsid\tA\tC\tG\tT\n";
  if (!text.trim()) return header;
  const first = text.split(/\r?\n/)[0];
  return first.startsWith("rsid") ? text : header + text;
}
function findIdx(header, names) {
  const lower = header.map(h => (h || "").toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}
function approxAF(effectAllele) {
  const EA = (effectAllele || "").toUpperCase();
  if (!["A","C","G","T"].includes(EA)) return null; // skip indels, ambiguous, etc.
  const rest = (1 - 0.35) / 3;
  return {
    A: EA === "A" ? 0.35 : rest,
    C: EA === "C" ? 0.35 : rest,
    G: EA === "G" ? 0.35 : rest,
    T: EA === "T" ? 0.35 : rest,
  };
}

(async () => {
  if (!fs.existsSync(SCORES_DIR)) {
    console.error(`❌ Scoring directory not found: ${SCORES_DIR}`);
    process.exit(1);
  }
  console.log(`📂 Using scoring dir: ${SCORES_DIR}`);
  console.log(`📝 AF map path: ${AF_FILE}`);

  let afText = fs.existsSync(AF_FILE) ? fs.readFileSync(AF_FILE, "utf8") : "";
  afText = ensureHeader(afText);
  const existing = new Set(
    afText.split(/\r?\n/).slice(1).map(l => l.split("\t")[0]).filter(Boolean)
  );

  const uniqPGS = [...new Set(Object.values(EFO_TO_PGS).flat())];
  let appended = 0, seenVariants = 0, missingFiles = 0;

  for (const pgsId of uniqPGS) {
    const file = path.join(SCORES_DIR, `${pgsId}_hmPOS_GRCh37.txt`);
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  Missing: ${path.relative(ROOT, file)}`);
      missingFiles++;
      continue;
    }
    const lines  = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const header = lines[0].split("\t");
    const iRS    = findIdx(header, ["hm_rsid","hm_rsID","rsid","rsID"]);
    const iEA    = findIdx(header, ["effect_allele","hm_effect_allele"]);
    if (iRS === -1 || iEA === -1) {
      console.warn(`⚠️  ${pgsId}: need rsID/hm_rsID and effect_allele`);
      continue;
    }

    let addedForPGS = 0;
    for (let i = 1; i < lines.length; i++) {
      const f  = lines[i].split("\t");
      const rs = f[iRS]; const ea = f[iEA];
      if (!rs || !ea) continue;
      seenVariants++;

      if (existing.has(rs)) continue;
      const af = approxAF(ea);
      if (!af) continue;

      afText += `${rs}\t${af.A}\t${af.C}\t${af.G}\t${af.T}\n`;
      existing.add(rs);
      appended++; addedForPGS++;
    }
    console.log(`✅ ${pgsId}: +${addedForPGS} rsIDs`);
  }

  fs.writeFileSync(AF_FILE, afText);
  console.log(`\n📊 Seen variants: ${seenVariants}`);
  console.log(`📦 Missing files: ${missingFiles}`);
  console.log(`🎉 Appended ${appended} rsIDs → ${AF_FILE}`);
})();
