# Stroke PRS PGS23 – Commercial Polygenic Risk Score Application

This application is a **commercial tool** for analyzing **polygenic risk scores (PRS)** using 23andMe raw genetic data and datasets from the **Polygenic Score (PGS) Catalog**.  
It supports automated score downloads, batch PRS computation for cardiovascular traits, and interactive results visualization via a browser dashboard.

> **Note:** This software is for **licensed commercial use only**.  
> Redistribution, open-sourcing, or unlicensed deployment is prohibited.

---

## Features

- **Automated Download** of:
  - Trait definitions (`traits.json`),
  - All required PGS score files (via `download_all_pgs.js`).
- **Batch PRS Computation** for a preselected set of cardiovascular traits.
- **Interactive Dashboard** to explore results per trait and per SNP.
- **Scientific Context Summaries**:
  - Fetches Europe PMC abstracts for top SNPs.
  - Summarizes findings via **Ollama (Llama 3)** locally, with DistilBART fallback.
  - Displays DOI links to relevant research.

---

## Requirements

- Node.js **v18+** (ES Module support).  
- A 23andMe raw genome file (`.txt` format).  
- Internet connectivity for downloading traits, PGS scores, and research papers.

---

## Installation

```bash
git clone <PRIVATE_REPO_URL>
cd stroke-prs-pgs23
npm install
```

---

## Data Preparation

1. **Fetch Trait Metadata** (from the PGS Catalog):
   ```bash
   npm run fetch:traits
   ```

2. **Download All Required PGS Scores**:
   ```bash
   node scripts/download_all_pgs.js
   ```
   - Downloads `.txt.gz` PGS score files into:
     ```
     /public/pgs_scores
     ```
   - Automatically unpacks `.txt` files into:
     ```
     /public/pgs_scores/unpacked
     ```

3. **Provide Genome Data**:
   Place your 23andMe genome file in:
   ```
   /public/genome_YOUR_23andMe_data.txt
   ```

---

## Running the App

Start the development server:
```bash
npm run dev
```

The dashboard is available at:
```
http://localhost:3000/batch_ui_cardio
```

---

## How It Works

1. **Batch PRS Computation**  
   The app automatically calculates PRS for all **cardiovascular traits** listed in `CARDIO_EFO_IDS` (inside `scripts/run_batch_cardio.js`).

2. **Results Output**  
   Two CSVs are generated:
   - `batch_results_cardio.csv` (summary per trait),
   - `batch_details_cardio.csv` (detailed per PGS).

3. **Interactive Exploration**  
   - Navigate to `/batch_ui_cardio` to view **sortable results and charts**.
   - Click any trait to view its **detail page**:
     - Top 10 contributing SNPs, with effect sizes (`β × z`),
     - Links to **dbSNP** and, if available, an **AI-generated summary** with DOI link.

---

## Literature Summaries

- The app queries **Europe PMC** for each SNP.
- Summaries are generated using:
  - **Ollama (Llama 3)** (local inference),
  - DistilBART as fallback if Ollama is unavailable.
- Summaries and links are cached in `/public/summaries` for offline reuse.

---

## License & Commercial Use

This software is **proprietary and for licensed commercial use only**.  
Contact for licensing or enterprise integration:

```
Wolfgang Maaß
wmaass@mailfence.com
```

