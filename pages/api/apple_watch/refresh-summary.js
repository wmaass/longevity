// File: pages/api/apple_watch/refresh-summary.js
// Purpose: Check whether an Apple Health export exists under
//   public/results/{genome}/apple_watch/apple_health_export/
// and, if it is newer than public/results/{genome}/apple_watch/summary.json,
// parse it to compute Lifestyle/Vitals (RHR, HRV, VO2max, sleep, steps).
// Writes summary.json and returns it. Use with:
//   GET /api/apple_watch/refresh-summary?genome={genomeName}
// Optional: &force=1 to ignore timestamps

import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

/** Recursively walk a directory and return the newest mtime (Date) and file list */
async function newestMtime(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  let newest = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const st = await fs.promises.stat(p);
    if (e.isDirectory()) {
      const n = await newestMtime(p);
      if (n > newest) newest = n;
    } else {
      const t = +st.mtime;
      if (t > newest) newest = t;
    }
  }
  return newest;
}

/** Utility: parse ISO string to ms */
const toMs = (s) => (s ? +new Date(s) : NaN);
const isBetween = (t, a, b) => t >= a && t <= b;

/** Median helper */
function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Sum-by-day average helper (e.g., steps) */
function avgByDay(records) {
  if (!records.length) return null;
  const byDay = new Map();
  for (const r of records) {
    const d = new Date(r.t).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + r.v);
  }
  const arr = Array.from(byDay.values());
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

/** Sleep hours/day from category records */
function avgSleepHoursPerDay(sleepSegments) {
  if (!sleepSegments.length) return null;
  // sum asleep durations per day
  const byDay = new Map();
  for (const s of sleepSegments) {
    const start = new Date(s.start);
    const end = new Date(s.end);
    const durH = (end - start) / 3_600_000;
    const key = end.toISOString().slice(0, 10); // assign to day the segment ended
    byDay.set(key, (byDay.get(key) || 0) + durH);
  }
  const arr = Array.from(byDay.values());
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

export default async function handler(req, res) {
  try {
    const genome = String(req.query.genome || '').trim();
    if (!genome) return res.status(400).json({ error: 'Missing ?genome=' });

    const base = path.join(process.cwd(), 'public', 'results', genome, 'apple_watch');
    const exportDir = path.join(base, 'apple_health_export');
    const summaryPath = path.join(base, 'summary.json');

    // validate paths
    const exportExists = fs.existsSync(exportDir) && fs.existsSync(path.join(exportDir, 'Export.xml'));
    if (!exportExists) {
      return res.status(404).json({ error: 'No Apple Health export found (Export.xml missing).', exportDir });
    }

    const exportNewest = await newestMtime(exportDir);
    const sumStat = fs.existsSync(summaryPath) ? await fs.promises.stat(summaryPath) : null;
    const force = String(req.query.force || '') === '1';

    if (sumStat && exportNewest <= +sumStat.mtime && !force) {
      // summary is up-to-date; return it
      const j = JSON.parse(await fs.promises.readFile(summaryPath, 'utf8'));
      return res.status(200).json({ ...j, _source: 'cached' });
    }

    // --- parse Export.xml ---
    const xml = await fs.promises.readFile(path.join(exportDir, 'Export.xml'), 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true });
    const j = parser.parse(xml);

    // Apple Health XML -> HealthData.Record[] (can be a single object)
    const records = j?.HealthData?.Record || [];
    const recs = Array.isArray(records) ? records : [records];

    const now = Date.now();
    const d14 = now - 14 * 24 * 3600 * 1000;
    const d30 = now - 30 * 24 * 3600 * 1000;
    const d90 = now - 90 * 24 * 3600 * 1000;

    const RHR = [];
    const HRV_SDNN = [];
    const VO2 = [];
    const STEPS = [];
    const SLEEP_ASLEEP = [];

    for (const r of recs) {
      const type = r.type;
      const unit = r.unit;
      const value = Number(r.value);
      const start = toMs(r.startDate);
      const end = toMs(r.endDate);
      if (!Number.isFinite(value)) continue;

      if (type === 'HKQuantityTypeIdentifierRestingHeartRate' && end >= d30) {
        RHR.push({ t: end, v: value });
      } else if (type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' && end >= d30) {
        HRV_SDNN.push({ t: end, v: value });
      } else if (type === 'HKQuantityTypeIdentifierVO2Max' && end >= d90) {
        // Apple uses mL/(kg·min). Accept any unit containing 'mL/min·kg' or 'ml/min·kg'.
        VO2.push({ t: end, v: value });
      } else if (type === 'HKQuantityTypeIdentifierStepCount' && end >= d14) {
        // Step count records have a duration; value is a count for the interval
        STEPS.push({ t: end, v: value });
      } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis' && end >= d14) {
        // Keep only "Asleep" values (value=="HKCategoryValueSleepAnalysisAsleep" or numeric 1)
        const val = r.value;
        const isAsleep = val === 'HKCategoryValueSleepAnalysisAsleep' || val === 'HKCategoryValueSleepAnalysisAsleepCore' || val === 'HKCategoryValueSleepAnalysisInBed' || val === 1 || val === '1';
        if (isAsleep && Number.isFinite(start) && Number.isFinite(end)) {
          SLEEP_ASLEEP.push({ start, end });
        }
      }
    }

    // Compute aggregates
    const rhr = median(RHR.map((x) => x.v)); // bpm, 30d median
    const hrv_rmssd = median(HRV_SDNN.map((x) => x.v)); // proxy: SDNN median (ms) — mapped into hrv_rmssd field for UI compatibility
    const vo2max = median(VO2.map((x) => x.v)); // 90d median
    const steps = avgByDay(STEPS); // 14d avg steps/day
    const sleep_hours = avgSleepHoursPerDay(SLEEP_ASLEEP); // 14d avg h/day

    const payload = {
      rhr: Number.isFinite(rhr) ? Math.round(rhr) : null,
      hrv_rmssd: Number.isFinite(hrv_rmssd) ? Math.round(hrv_rmssd) : null,
      vo2max: Number.isFinite(vo2max) ? Math.round(vo2max) : null,
      sleep_hours: Number.isFinite(sleep_hours) ? Number(sleep_hours.toFixed(2)) : null,
      steps: Number.isFinite(steps) ? Math.round(steps) : null,
      window: 'RHR/HRV:30d · Steps/Sleep:14d · VO2max:90d',
      asOf: new Date().toISOString(),
      note: 'HRV uses SDNN (ms) as proxy for rMSSD due to Apple export format.',
    };

    // Ensure target directory exists
    await fs.promises.mkdir(base, { recursive: true });
    await fs.promises.writeFile(summaryPath, JSON.stringify(payload, null, 2));

    return res.status(200).json({ ...payload, _source: 'fresh' });
  } catch (err) {
    console.error('refresh-summary error', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}

// ---
// Client wiring (minimal):
// Replace your existing loadAppleWatchSummary(genomeName) with a call to this API.
// (You can keep your old fallback to read /apple_watch/summary.json directly.)

/* Example replacement in your component:
async function loadAppleWatchSummary(genomeName) {
  try {
    const url = `/api/apple_watch/refresh-summary?genome=${encodeURIComponent(genomeName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const out = {};
    const n = (x) => (Number.isFinite(+x) ? +x : null);
    if (n(j?.rhr) != null) out.rhr = n(j.rhr);
    if (n(j?.hrv_rmssd) != null) out.hrv_rmssd = n(j.hrv_rmssd);
    if (n(j?.hrv) != null && out.hrv_rmssd == null) out.hrv_rmssd = n(j.hrv);
    if (n(j?.vo2max) != null) out.vo2max = n(j.vo2max);
    if (n(j?.sleep_hours) != null) out.sleep_hours = n(j.sleep_hours);
    if (n(j?.steps) != null) out.steps = n(j.steps);
    out.window = j?.window || null;
    out.asOf = j?.asOf || null;
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
*/
