// pages/api/listResults.js
import fs from "fs";
import path from "path";

export default function handler(req, res) {
  try {
    const base = path.join(process.cwd(), "public", "results");
    const entries = fs.readdirSync(base, { withFileTypes: true });

    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => {
        const dir = path.join(base, name);
        return (
          fs.existsSync(path.join(dir, "batch_details_cardio.csv")) &&
          fs.existsSync(path.join(dir, "batch_results_cardio.csv"))
        );
      });

    res.status(200).json({ folders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
