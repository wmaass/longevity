import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";

// ---------- helpers ----------
const exists = async (url) => {
  try {
    const h = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (h.ok) return true;
    const g = await fetch(url, { method: "GET", cache: "no-store" });
    return g.ok;
  } catch {
    return false;
  }
};

const hasBothCSVs = async (folder) => {
  const base = `/results/${folder}`;
  const [hasDetails, hasAgg] = await Promise.all([
    exists(`${base}/batch_details_cardio.csv`),
    exists(`${base}/batch_results_cardio.csv`),
  ]);
  return hasDetails && hasAgg;
};

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

const parseCSV = (text) =>
  new Promise((resolve) =>
    Papa.parse(text, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data) })
  );

// ---------- normalizers ----------
const efoKey = (r) => r["EFO-ID"] || r["EFO_ID"] || r["EFO"] || r.efoId || r.efo || "";

const normAggRow = (r) => ({
  efo: efoKey(r),
  trait: r.Trait || r.trait || "",
  pgsCount: num(r["PGS Count"]),
  avgPrs: num(r["Avg PRS"]),
  maxPrs: num(r["Max PRS"]),
  minPrs: num(r["Min PRS"]),
  avgPct: num(r["Avg Percentile"]),
  maxPct: num(r["Max Percentile"]),
  minPct: num(r["Min Percentile"]),
  totalVariants: num(r["Total Variants"]),
});

const normDetailRow = (r) => ({
  efo: r.efoId || r["EFO-ID"] || r.EFO || "",
  pgsId: r.id || r["PGS ID"] || r.PGS || "",
  trait: r.trait || r.Trait || "",
  rawScore: num(r.rawScore),
  prs: num(r.prs),
  zScore: num(r.zScore),
  percentile: num(r.percentile),
  matches: num(r.matches),
  totalVariants: num(r.totalVariants),
});

// ---------- diff builders ----------
const diffAgg = (mapA, mapB) => {
  const keys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
  const out = [];
  for (const k of keys) {
    const A = mapA[k] || {};
    const B = mapB[k] || {};
    out.push({
      type: "summary",
      EFO: k,
      Trait: A.trait || B.trait || "",
      "PGS Count A": A.pgsCount ?? "",
      "PGS Count B": B.pgsCount ?? "",
      "Δ PGS Count": (B.pgsCount ?? 0) - (A.pgsCount ?? 0),
      "Avg PRS A": A.avgPrs ?? "",
      "Avg PRS B": B.avgPrs ?? "",
      "Δ Avg PRS": (B.avgPrs ?? 0) - (A.avgPrs ?? 0),
      "Max PRS A": A.maxPrs ?? "",
      "Max PRS B": B.maxPrs ?? "",
      "Δ Max PRS": (B.maxPrs ?? 0) - (A.maxPrs ?? 0),
      "Min PRS A": A.minPrs ?? "",
      "Min PRS B": B.minPrs ?? "",
      "Δ Min PRS": (B.minPrs ?? 0) - (A.minPrs ?? 0),
      "Avg % A": A.avgPct ?? "",
      "Avg % B": B.avgPct ?? "",
      "Δ Avg %": (B.avgPct ?? 0) - (A.avgPct ?? 0),
      "Max % A": A.maxPct ?? "",
      "Max % B": B.maxPct ?? "",
      "Δ Max %": (B.maxPct ?? 0) - (A.maxPct ?? 0),
      "Min % A": A.minPct ?? "",
      "Min % B": B.minPct ?? "",
      "Δ Min %": (B.minPct ?? 0) - (A.minPct ?? 0),
      "Total Variants A": A.totalVariants ?? "",
      "Total Variants B": B.totalVariants ?? "",
      "Δ Total Variants": (B.totalVariants ?? 0) - (A.totalVariants ?? 0),
    });
  }
  // stable order by EFO
  return out.sort((x, y) => String(x.EFO).localeCompare(String(y.EFO)));
};

const diffDetails = (mapA, mapB) => {
  const keys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
  const out = [];
  for (const k of keys) {
    const A = mapA[k] || {};
    const B = mapB[k] || {};
    out.push({
      type: "detail",
      EFO: A.efo || B.efo || "",
      PGS: A.pgsId || B.pgsId || "",
      Trait: A.trait || B.trait || "",
      "raw A": A.rawScore ?? "",
      "raw B": B.rawScore ?? "",
      "Δ raw": (B.rawScore ?? 0) - (A.rawScore ?? 0),
      "prs A": A.prs ?? "",
      "prs B": B.prs ?? "",
      "Δ prs": (B.prs ?? 0) - (A.prs ?? 0),
      "z A": A.zScore ?? "",
      "z B": B.zScore ?? "",
      "Δ z": (B.zScore ?? 0) - (A.zScore ?? 0),
      "% A": A.percentile ?? "",
      "% B": B.percentile ?? "",
      "Δ %": (B.percentile ?? 0) - (A.percentile ?? 0),
      "matches A": A.matches ?? "",
      "matches B": B.matches ?? "",
      "Δ matches": (B.matches ?? 0) - (A.matches ?? 0),
      "variants A": A.totalVariants ?? "",
      "variants B": B.totalVariants ?? "",
      "Δ variants": (B.totalVariants ?? 0) - (A.totalVariants ?? 0),
    });
  }
  // order by EFO then PGS
  return out.sort((x, y) =>
    String(x.EFO).localeCompare(String(y.EFO)) ||
    String(x.PGS).localeCompare(String(y.PGS))
  );
};

// ---------- page ----------
export default function DiffPage() {
  const [folders, setFolders] = useState([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [detailRows, setDetailRows] = useState([]);
  const [aggRows, setAggRows] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/listResults", { cache: "no-store" });
        if (!r.ok) throw new Error(`listResults ${r.status}`);
        const data = await r.json();
        const valid = (
          await Promise.all(
            (data.folders || []).map(async (f) => ((await hasBothCSVs(f)) ? f : null))
          )
        ).filter(Boolean);

        setFolders(valid);
        if (valid.length >= 2) {
          setA(valid[valid.length - 2]);
          setB(valid[valid.length - 1]);
        }
      } catch (e) {
        setError(`Cannot load folders: ${e.message}`);
      }
    })();
  }, []);

  const canCompare = useMemo(() => !!a && !!b && a !== b, [a, b]);

  const runDiff = async () => {
    setError("");
    if (!canCompare) {
      setError("Pick two different folders that contain both CSV files.");
      return;
    }
    setBusy(true);
    try {
      // ---- details (per PGS) ----
      const [detA, detB] = await Promise.all(
        [a, b].map((f) =>
          fetch(`/results/${f}/batch_details_cardio.csv`, { cache: "no-store" }).then((r) =>
            r.text()
          )
        )
      );
      const [detRowsA, detRowsB] = await Promise.all([parseCSV(detA), parseCSV(detB)]);
      const mapDetA = Object.fromEntries(
        detRowsA
          .map(normDetailRow)
          .filter((r) => r.efo && r.pgsId)
          .map((r) => [`${r.efo}__${r.pgsId}`, r])
      );
      const mapDetB = Object.fromEntries(
        detRowsB
          .map(normDetailRow)
          .filter((r) => r.efo && r.pgsId)
          .map((r) => [`${r.efo}__${r.pgsId}`, r])
      );
      const detailDiff = diffDetails(mapDetA, mapDetB);

      // ---- aggregated (per EFO) ----
      const [aggA, aggB] = await Promise.all(
        [a, b].map((f) =>
          fetch(`/results/${f}/batch_results_cardio.csv`, { cache: "no-store" }).then((r) =>
            r.text()
          )
        )
      );
      const [aggRowsA, aggRowsB] = await Promise.all([parseCSV(aggA), parseCSV(aggB)]);
      const mapAggA = Object.fromEntries(
        aggRowsA
          .map(normAggRow)
          .filter((r) => r.efo)
          .map((r) => [r.efo, r])
      );
      const mapAggB = Object.fromEntries(
        aggRowsB
          .map(normAggRow)
          .filter((r) => r.efo)
          .map((r) => [r.efo, r])
      );
      const aggregatedDiff = diffAgg(mapAggA, mapAggB);

      setDetailRows(detailDiff);
      setAggRows(aggregatedDiff);
    } catch (e) {
      setError(`Compare failed: ${e.message}`);
      setDetailRows([]);
      setAggRows([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Compare PGS Results</h1>

      <div className="flex gap-3 items-end">
        <div>
          <label className="block text-xs font-medium">Folder A</label>
          <select
            value={a}
            onChange={(e) => setA(e.target.value)}
            className="border px-2 py-1 rounded"
          >
            <option value="">— choose —</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium">Folder B</label>
          <select
            value={b}
            onChange={(e) => setB(e.target.value)}
            className="border px-2 py-1 rounded"
          >
            <option value="">— choose —</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={runDiff}
          disabled={!canCompare || busy}
          className="bg-blue-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
        >
          {busy ? "Comparing…" : "Compare"}
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Details table */}
      {detailRows.length > 0 && (
        <div>
          <h2 className="font-medium mt-4 mb-2">Per-PGS differences (batch_details_cardio.csv)</h2>
          <div className="overflow-x-auto border rounded">
            <table className="min-w-[1200px] text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    "EFO",
                    "PGS",
                    "Trait",
                    "raw A",
                    "raw B",
                    "Δ raw",
                    "prs A",
                    "prs B",
                    "Δ prs",
                    "z A",
                    "z B",
                    "Δ z",
                    "% A",
                    "% B",
                    "Δ %",
                    "matches A",
                    "matches B",
                    "Δ matches",
                    "variants A",
                    "variants B",
                    "Δ variants",
                  ].map((h) => (
                    <th key={h} className="text-left px-2 py-1 border-b">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailRows.map((r, i) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50">
                    {[
                      r.EFO,
                      r.PGS,
                      r.Trait,
                      r["raw A"],
                      r["raw B"],
                      r["Δ raw"],
                      r["prs A"],
                      r["prs B"],
                      r["Δ prs"],
                      r["z A"],
                      r["z B"],
                      r["Δ z"],
                      r["% A"],
                      r["% B"],
                      r["Δ %"],
                      r["matches A"],
                      r["matches B"],
                      r["Δ matches"],
                      r["variants A"],
                      r["variants B"],
                      r["Δ variants"],
                    ].map((v, j) => (
                      <td key={j} className="px-2 py-1 border-b">
                        {typeof v === "number" ? v.toFixed(4).replace(/\.0000$/, "") : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Aggregated table */}
      {aggRows.length > 0 && (
        <div>
          <h2 className="font-medium mt-6 mb-2">
            Aggregated differences (batch_results_cardio.csv)
          </h2>
          <div className="overflow-x-auto border rounded">
            <table className="min-w-[1100px] text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    "EFO",
                    "Trait",
                    "PGS Count A",
                    "PGS Count B",
                    "Δ PGS Count",
                    "Avg PRS A",
                    "Avg PRS B",
                    "Δ Avg PRS",
                    "Max PRS A",
                    "Max PRS B",
                    "Δ Max PRS",
                    "Min PRS A",
                    "Min PRS B",
                    "Δ Min PRS",
                    "Avg % A",
                    "Avg % B",
                    "Δ Avg %",
                    "Max % A",
                    "Max % B",
                    "Δ Max %",
                    "Min % A",
                    "Min % B",
                    "Δ Min %",
                    "Total Variants A",
                    "Total Variants B",
                    "Δ Total Variants",
                  ].map((h) => (
                    <th key={h} className="text-left px-2 py-1 border-b">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aggRows.map((r, i) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50">
                    {[
                      r.EFO,
                      r.Trait,
                      r["PGS Count A"],
                      r["PGS Count B"],
                      r["Δ PGS Count"],
                      r["Avg PRS A"],
                      r["Avg PRS B"],
                      r["Δ Avg PRS"],
                      r["Max PRS A"],
                      r["Max PRS B"],
                      r["Δ Max PRS"],
                      r["Min PRS A"],
                      r["Min PRS B"],
                      r["Δ Min PRS"],
                      r["Avg % A"],
                      r["Avg % B"],
                      r["Δ Avg %"],
                      r["Max % A"],
                      r["Max % B"],
                      r["Δ Max %"],
                      r["Min % A"],
                      r["Min % B"],
                      r["Δ Min %"],
                      r["Total Variants A"],
                      r["Total Variants B"],
                      r["Δ Total Variants"],
                    ].map((v, j) => (
                      <td key={j} className="px-2 py-1 border-b">
                        {typeof v === "number" ? v.toFixed(4).replace(/\.0000$/, "") : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
