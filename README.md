# Stroke-PRS-PGS23 Dashboard

This project is a **Next.js web application** for analyzing **polygenic risk scores (PRS)** for traits based on the **PGS Catalog** and individual **23andMe genomic data**.  
It includes tools to **download trait and PGS score data**, compute individual PRS values, and view results interactively via a dashboard.

---

## Features
- Fetch **EFO trait definitions** and **PGS scores** from the [PGS Catalog](https://www.pgscatalog.org/).
- Parse **23andMe raw genome files** and compute PRS for selected traits.
- Provide **batch processing** for cardio-relevant traits (`batch_ui_cardio`).
- Display **interactive dashboards** (tables and charts) for reviewing PRS results.
- On trait detail pages, show **top genetic variants** with:
  - Effect sizes (`β × z`),
  - Links to **NCBI SNP entries**,
  - AI-generated **summaries** from published research (via Europe PMC),
  - DOI links for the main publication (if available).

---

## Setup

### 1. Clone Repository
```bash
git clone https://github.com/<your-username>/stroke-prs-pgs23.git
cd stroke-prs-pgs23
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run the App
For development:
```bash
npm run dev
```

Then open:  
**[http://localhost:3000/batch_ui_cardio](http://localhost:3000/batch_ui_cardio)**

For production:
```bash
npm run build
npm start
```

---

## Data Preparation

### Download Trait Definitions
The PGS Catalog provides trait definitions via API. Run:
```bash
npm run fetch:traits
```
This stores `traits.json` in `public/`, which is used by the dashboard.

### Download PGS Scores
PGS scores must be manually downloaded from the [PGS Catalog FTP](https://ftp.ebi.ac.uk/pub/databases/spot/pgs/).  
Place all `.txt.gz` or unpacked `.txt` PGS files under:
```
public/pgs_scores/
```

If unpacked files exist (e.g., `PGS000001_hmPOS_GRCh37.txt`), they will be used directly.

---

## Compute PRS

The core calculation uses the script `scripts/run_batch_cardio.js`, which:
1. Loads the **user genome** (23andMe raw data).
2. Loads **trait definitions** and **PGS scores**.
3. Computes **PRS values per trait** (weighted sum across matched variants).
4. Outputs **CSV summaries** for:
   - `batch_results_cardio.csv`: per-trait summary (Avg PRS, Percentiles, Total Variants).
   - `batch_details_cardio.csv`: per-score details (PGS IDs, PRS, matches, DOI).

To run:
```bash
node scripts/run_batch_cardio.js
```

This generates the CSV files into `/public/` for the dashboard.

---

## Using the Dashboard

After running the computation and starting the app:
1. Go to **[http://localhost:3000/batch_ui_cardio](http://localhost:3000/batch_ui_cardio)**.
2. The dashboard shows:
   - **Summary Table** of cardio traits.
   - **Interactive bar chart** of PRS distributions.
   - Click on a **trait** to open its **details page**.

### Details Page
For each trait (`/details/[EFO-ID]?trait=[Trait Name]`):
- View **PRS, Z-Score, and Percentile** for the user.
- See **top 10 contributing variants**.
- Each variant shows:
  - **SNP ID** (link to NCBI),
  - **Genotype**,
  - **Effect size (`β × z`)**,
  - **Summary** link (if available):
    - Opens a popup with **AI-generated research summary**,
    - Includes **DOI link** to the primary publication (via Europe PMC).

---

## Development Notes
- The app is an **ESM project** (`"type": "module"` in `package.json`).
- `pages/api/snp-summary.js` handles:
  - Fetching papers from **Europe PMC**,
  - Summarizing findings (Ollama + DistilBART fallback),
  - Caching results in `public/summaries/` for faster loading.
- Trait and PRS computations are client-driven, no server backend beyond Next.js API routes.

---

## Requirements
- Node.js 18+
- [Ollama](https://ollama.com/) (for local Llama 3 summaries, optional but recommended).
- Internet access for Europe PMC lookups (summaries will still load from cache if offline).

---

## Typical Workflow

1. **Prepare data:**
   ```bash
   npm run fetch:traits
   # Place PGS scores into public/pgs_scores/
   ```

2. **Compute PRS:**
   ```bash
   node scripts/run_batch_cardio.js
   ```

3. **Run the dashboard:**
   ```bash
   npm run dev
   # Visit: http://localhost:3000/batch_ui_cardio
   ```

4. **Click on traits** to see **details and variant-level insights**.

---

## Licenses and Commercial Terms
This software is proprietary and commercial.
Usage is restricted to licensed customers and partners.
For licensing inquiries, contact:

Wolfgang Maaß
wmaass@mailfence.com
