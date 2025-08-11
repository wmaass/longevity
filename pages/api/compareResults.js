// pages/api/compareResults.js
import fs from "fs";
import path from "path";

const RESULTS_DIR = path.join(process.cwd(), "public", "results");

function parseCSV(text) {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((r) => {
    const vals = r.split(","); // ok for our simple CSVs
    const obj = {};
    cols.forEach((c, i) => (obj[c.trim()] = (vals[i] ?? "").trim()));
    return obj;
  });
}

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

function indexDetails(rows) {
  // keys: EFO + PGS
  return Object.fromEntries(
    rows.map((r) => [
      `${(r.efoId || r["EFO-ID"] || "").toLowerCase()}__${(r.id || r["PGS ID"] || r.PGS || "").toLowerCase()}`,
      r,
    ])
  );
}
function indexResults(rows) {
  return Object.fromEntries(rows.map((r) => [r["EFO-ID"] || r.efoId, r]));
}

export default function handler(req, res) {
  try {
    const { a, b } = req.method === "GET" ? req.query : JSON.parse(req.body || "{}");
    if (!a || !b) return res.status(400).json({ error: "Missing folders a/b" });

    const dirA = path.join(RESULTS_DIR, a);
    const dirB = path.join(RESULTS_DIR, b);

    const detA = parseCSV(fs.readFileSync(path.join(dirA, "batch_details_cardio.csv"), "utf8"));
    const detB = parseCSV(fs.readFileSync(path.join(dirB, "batch_details_cardio.csv"), "utf8"));
    const resA = parseCSV(fs.readFileSync(path.join(dirA, "batch_results_cardio.csv"), "utf8"));
    const resB = parseCSV(fs.readFileSync(path.join(dirB, "batch_results_cardio.csv"), "utf8"));

    // ---- details diffs (per PGS) ----
    const A = indexDetails(detA);
    const B = indexDetails(detB);
    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);

    const detailsDiff = [...keys].map((k) => {
      const rA = A[k] || {};
      const rB = B[k] || {};
      const rawA = num(rA.rawScore);
      const rawB = num(rB.rawScore);
      const pctA = num(rA.percentile);
      const pctB = num(rB.percentile);
      const mA = num(rA.matches);
      const mB = num(rB.matches);

      return {
        efo: rA.efoId || rB.efoId || "",
        pgsId: rA.id || rB.id || "",
        trait: rA.trait || rB.trait || "",
        rawA,
        rawB,
        dRaw: (rawA ?? 0) - (rawB ?? 0),
        matchesA: mA,
        matchesB: mB,
        dMatches: (mA ?? 0) - (mB ?? 0),
        pctA,
        pctB,
        dPct: (pctA ?? 0) - (pctB ?? 0),
      };
    });

    // ---- results diffs (aggregated per EFO) ----
    const AR = indexResults(resA);
    const BR = indexResults(resB);
    const rKeys = new Set([...Object.keys(AR), ...Object.keys(BR)]);
    const resultsDiff = [...rKeys].map((k) => {
      const rA = AR[k] || {};
      const rB = BR[k] || {};
      const avgPrsA = num(rA["Avg PRS"]);
      const avgPrsB = num(rB["Avg PRS"]);
      const avgPctA = num(rA["Avg Percentile"]);
      const avgPctB = num(rB["Avg Percentile"]);
      const tvA = num(rA["Total Variants"]);
      const tvB = num(rB["Total Variants"]);

      return {
        efo: k,
        trait: rA.Trait || rB.Trait || "",
        avgPrsA,
        avgPrsB,
        dAvgPrs: (avgPrsA ?? 0) - (avgPrsB ?? 0),
        avgPctA,
        avgPctB,
        dAvgPct: (avgPctA ?? 0) - (avgPctB ?? 0),
        totalVarA: tvA,
        totalVarB: tvB,
        dTotalVar: (tvA ?? 0) - (tvB ?? 0),
      };
    });

    res.status(200).json({ detailsDiff, resultsDiff });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
