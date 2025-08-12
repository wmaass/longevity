# Longevity – Polygenic Risk Score Berechnung & Analyse

Dieses Projekt besteht aus **zwei Hauptkomponenten**:

1. **Teil 1 – Berechnung der Polygenic Risk Scores (PRS)**  
   Lädt eine **23andMe-Rohdaten-Datei**, extrahiert relevante SNPs und berechnet **Polygenic Risk Scores (PRS)** für definierte EFO-Traits.

2. **Teil 2 – Analyse- und Visualisierungs-App**  
   Nutzt die in Teil 1 berechneten PRS-Daten, verknüpft sie mit wissenschaftlichen Referenzen, SNP-Details und optionalen Patienten-Biomarkern und stellt sie visuell dar.

Die Kombination beider Teile ermöglicht eine vollständige **End-to-End-Pipeline** – von der Rohdatenanalyse bis zur interaktiven Risikodarstellung.

---

## Teil 1 – Polygenic Risk Scores (PRS) aus 23andMe-Daten berechnen

Dieser Teil der Anwendung lädt eine **23andMe-Rohdaten-Datei** (`.txt`), extrahiert relevante SNPs und berechnet **Polygenic Risk Scores (PRS)** für ausgewählte **EFO-Traits**.  
Die Berechnung läuft im **Web Worker** (`/workers/prs.worker.js`), sodass die UI responsiv bleibt. Ergebnisse werden als **CSV** (aggregiert & Details) sowie als **JSON pro EFO** gespeichert.

### Features

- Upload einer 23andMe-Rohdaten-Datei (`.txt`)
- PRS-Berechnung im Browser (Web Worker)
- Fortschrittsanzeige (aktuelles PGS & %)
- Live-Log im UI (Debug/Status)
- Speicherung der Ergebnisse:
  - `batch_results_cardio.csv` (aggregiert)
  - `batch_details_cardio.csv` (Details je PGS/EFO)
  - `efoDetailsMap` → JSON pro EFO über `/api/saveEfoDetail`
- Vergleichskomponente `ComparePGSDiffs` (optional)

### Ziel-Traits (EFO) & zugehörige PGS

Die Berechnung ist aktuell auf kardiometabolische Traits fokussiert:

- **EFO_0004541** – HbA1c measurement → `PGS000127, PGS000128, PGS000129, PGS000130, PGS000131, PGS000132, PGS000304`
- **EFO_0004611** – LDL cholesterol → `PGS000061, PGS000065, PGS000115, PGS000310, PGS000340, PGS000661`
- **EFO_0004612** – HDL cholesterol → `PGS000060, PGS000064, PGS000309, PGS000660`
- **EFO_0004530** – Triglycerides → `PGS000063, PGS000066, PGS000312, PGS000659`
- **EFO_0001645** – Coronary artery disease → `PGS000010, PGS000011, PGS000012, PGS000019, PGS000057, PGS000058, PGS000059, PGS000116, PGS000200, PGS000337, PGS000349`
- **EFO_0006335** – Systolic blood pressure → `PGS000301, PGS002009`
- **EFO_0004574** – Total cholesterol → `PGS000062, PGS000311, PGS000658, PGS000677`
- **EFO_0004458** – C-reactive protein → `PGS000314, PGS000675`
- **EFO_0006336** – Diastolic blood pressure → `PGS000302, PGS001900`

> Die EFO→PGS-Zuordnung ist in der Komponente hart codiert und kann leicht erweitert werden.

---

## Teil 2 – Analyse-App für kardiovaskuläre PRS-Ergebnisse

Dieser Teil der Anwendung stellt die im ersten Schritt berechneten Polygenic Risk Scores (PRS) visuell dar und verknüpft sie mit EFO-Traits, SNP-Informationen sowie optionalen Patienten-Biomarkern.
Die App ermöglicht eine organbasierte Visualisierung, Detailansichten zu einzelnen EFOs und die Interpretation von Risikoperzentilen basierend auf wissenschaftlicher Literatur.

### Features
- **Datenimport** der im PRS-Teil erzeugten CSV-Dateien:
- - batch_results_cardio.csv – aggregierte PRS-Daten pro EFO
- - batch_details_cardio.csv – Details zu einzelnen PGS/EFO-Kombinationen
- Organ-Map (SVG/D3): Farbige Hervorhebung von Organen entsprechend dem durchschnittlichen PRS-Perzentil
- Interaktive Tooltips und Klick-Navigation zu EFO-Detailseiten
- Balkendiagramm (chart.js) für log10(Avg PRS) pro Trait
- Patienten-Biomarker-Panel (Vitalparameter & Bluttests aus biomarkers.json)

### Risikoklassifikation basierend auf Perzentilbereichen:
< 20 %: Unterdurchschnittlich
20–80 %: Durchschnittlich
80–95 %: Erhöht
95 %: Stark erhöht
Log-Bereich für Lade- und Verarbeitungsstatus
Integration von Referenzstatistiken (reference_stats.json) für z-Score- und Perzentil-Berechnungen

### Voraussetzungen
Die Analyse-App benötigt Ausgabedateien aus Teil 1 im Verzeichnis:
/results/<genomeName>/
batch_results_cardio.csv
batch_details_cardio.csv
optional: biomarkers.json
Statische Mapping-Dateien im public/-Verzeichnis:
efo_to_organ.json – Zuordnung von EFO-Traits zu Organen
traits.json – EFO-ID zu Traitnamen
optional: reference_stats.json – statistische Referenzwerte für PGS

### Voraussetzungen

- Node.js (empfohlen: v20+)
- Next.js-App (dieses Repo)
- Browser mit Web-Worker-Support
- 23andMe-Rohdaten-Datei (`.txt` mit Spalten: `rsid, chromosome, position, genotype`)

### Schnellstart

# Dependencies installieren
npm install

# Dev-Server starten
npm run dev
# -> http://localhost:3000
