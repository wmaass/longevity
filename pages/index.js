'use client';  // Client-Side Rendering

import { useEffect, useState } from 'react';
import { computePRS } from '../lib/computePRS.js';

// Klinische Handlungsempfehlungen nach Perzentil
function getClinicalAdvice(percentile) {
  if (percentile >= 90) {
    return 'Hoher genetischer Risikobereich – Screening (Blutdruck, Cholesterin, Ultraschall) und ärztliche Betreuung empfohlen.';
  } else if (percentile >= 75) {
    return 'Moderates genetisches Risiko – jährliche Vorsorge und gesunde Lebensweise empfohlen.';
  } else {
    return 'Kein auffälliges genetisches Risiko – Standardvorsorge ausreichend.';
  }
}

// Perzentil-Interpretation
function explainPercentile(percentile) {
  return `Dein Score liegt im ${percentile}. Perzentil. 
Du hast ein höheres genetisches Risiko als ${percentile}% der Vergleichspopulation.`;
}

export default function IndexPage() {
  const [traits, setTraits] = useState([]);

  useEffect(() => {
    // Lade alle Traits aus lokaler traits.json
    fetch('/traits.json')
      .then(res => res.json())
      .then(data => {
        const sorted = data.sort((a, b) =>
          a.label.localeCompare(b.label)
        );
        setTraits(sorted);
      })
      .catch(err => console.error('Fehler beim Laden der Traits:', err));

    const analyzeButton = document.getElementById('analyzeButton');
    const fileInput = document.getElementById('genomeFile');
    const resultDiv = document.getElementById('result');
    const diseaseSelect = document.getElementById('diseaseSelect');

    if (!analyzeButton || !fileInput || !diseaseSelect) return;

    analyzeButton.addEventListener('click', async () => {
      const file = fileInput.files[0];
      const disease = diseaseSelect.value;

      if (!file) {
        alert('Bitte eine 23andMe-Datei auswählen.');
        return;
      }

      resultDiv.innerHTML = `<p>Berechnung für <strong>${disease}</strong> läuft… bitte warten</p>`;

      try {
        const allResults = await computePRS(file, (pgsId, progress, matches) => {
          const bar = document.getElementById(`progress-${pgsId}`);
          const label = document.getElementById(`label-${pgsId}`);
          if (bar) bar.value = progress;
          if (label) label.textContent = `${pgsId}: ${progress.toFixed(1)}% (${matches} Matches)`;
        }, disease);

        renderSortedResults(allResults, resultDiv);
      } catch (err) {
        console.error(err);
        resultDiv.innerHTML = `<p style="color:red">Fehler: ${err.message}</p>`;
      }
    });
  }, []);

  function renderSortedResults(allResults, container) {
    allResults.sort((a, b) => (b.prs || 0) - (a.prs || 0));
    container.innerHTML = '<h2>Ergebnisse (nach Risiko sortiert)</h2>';

    allResults.forEach(res => {
      const prs = res.prs || 0;
      const percentile = res.percentile || 50;
      const zScore = res.zScore || 0;
      const doi = res.doi || null;
      const trait = res.trait || 'Unbekanntes Trait';
      const topVariants = (res.topVariants || []).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

      let color = 'green';
      let label = 'Unauffällig';
      if (percentile >= 90) {
        color = 'red';
        label = 'Auffällig – ärztliche Analyse empfohlen';
      } else if (percentile >= 75) {
        color = 'orange';
        label = 'Grenzwertig – Beobachtung empfohlen';
      }

      const variantTable = topVariants.length > 0 ? `
        <h4>Top 10 Varianten (größter Einfluss):</h4>
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">
          <tr>
            <th>#</th><th>Variante</th><th>SNP</th><th>Genotyp</th><th>β × z</th>
          </tr>
          ${topVariants.slice(0, 10).map((v, i) => {
            const absVal = Math.abs(v.score);
            let effectColor = absVal > 0.2 ? 'red' : absVal > 0.1 ? 'orange' : 'green';
            const snpLink = v.rsid 
              ? `<a href="https://www.ncbi.nlm.nih.gov/snp/${v.rsid}" target="_blank">${v.rsid}</a> 
                 (<a href="https://www.snpedia.com/index.php/${v.rsid}" target="_blank">SNPedia</a>)` 
              : '-';
            return `
              <tr style="color:${effectColor}">
                <td>${i + 1}</td>
                <td>${v.variant}</td>
                <td>${snpLink}</td>
                <td>${v.alleles}</td>
                <td>${v.score.toFixed(3)}</td>
              </tr>
            `;
          }).join('')}
        </table>
      ` : '';

      const entry = document.createElement('div');
      entry.style.border = `2px solid ${color}`;
      entry.style.borderRadius = '8px';
      entry.style.padding = '12px';
      entry.style.marginBottom = '18px';
      entry.style.backgroundColor = '#f9f9f9';

      entry.innerHTML = `
        <h3 style="color:${color}">${trait} (PGS ${res.id})</h3>
        <p><strong>PRS:</strong> ${prs.toFixed(3)} (Raw Score: ${res.rawScore?.toFixed(3) || 0})</p>
        <p><strong>Z‑Score:</strong> ${zScore.toFixed(2)} | <strong>Perzentil:</strong> ${percentile}</p>
        <p>${explainPercentile(percentile)}</p>
        <p><strong>Status:</strong> ${label}</p>
        <p><strong>Empfehlung:</strong> ${getClinicalAdvice(percentile)}</p>
        <p><strong>Matches:</strong> ${res.matches} von ${res.totalVariants || '?'} Varianten</p>
        ${doi ? `<p><strong>Studie:</strong> <a href="${doi}" target="_blank">${doi}</a></p>` : ''}
        ${variantTable}
      `;

      container.appendChild(entry);
    });
  }

  return (
    <div>
      <h1>Polygenic Risk Score</h1>
      <p>Lade deine <strong>23andMe Rohdaten (.txt)</strong> hoch und wähle eine Krankheit:</p>
      <label htmlFor="diseaseSelect"><strong>Krankheit:</strong></label>
      <select id="diseaseSelect">
        {traits.length === 0 ? (
          <option>Lade Traits…</option>
        ) : (
          traits.map((t) => (
            <option key={t.efo} value={t.efo}>
              {t.label} ({t.count_pgs} PGS)
            </option>
          ))
        )}
      </select>
      <br/><br/>
      <input type="file" id="genomeFile" />
      <button id="analyzeButton">Analyze</button>
      <div id="result"></div>
    </div>
  );
}
