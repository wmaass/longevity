'use client';

import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

// Alle Module registrieren (Skalen + Controller + Elemente)
Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend
);

// Chart.js-Module registrieren
Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

import { useEffect, useState } from 'react';
import { computePRS } from '../lib/computePRS.js';

// Klinische Empfehlungen
function getClinicalAdvice(percentile) {
  if (percentile >= 90) {
    return 'Hoher genetischer Risikobereich – Screening (Blutdruck, Cholesterin, Ultraschall) und ärztliche Betreuung empfohlen.';
  } else if (percentile >= 75) {
    return 'Moderates genetisches Risiko – jährliche Vorsorge und gesunde Lebensweise empfohlen.';
  } else {
    return 'Kein auffälliges genetisches Risiko – Standardvorsorge ausreichend.';
  }
}

function explainPercentile(percentile) {
  return `Dein Score liegt im ${percentile}. Perzentil. 
Du hast ein höheres genetisches Risiko als ${percentile}% der Vergleichspopulation.`;
}

// Durchschnitts- und Top-Wert berechnen
function summarizePGSResults(results) {
  if (!results.length) return null;

  const zScores = results.map(r => r.zScore || 0);
  const avgZ = zScores.reduce((a,b)=>a+b,0) / zScores.length;

  const erf = (x) => {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const tau = t *
      Math.exp(
        -x * x -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t *
                            (0.27886807 +
                              t *
                                (-1.13520398 +
                                  t *
                                    (1.48851587 +
                                      t *
                                        (-0.82215223 + t * 0.17087277))))))))
      );
    return sign * (1 - tau);
  };
  const avgPercentile = Math.round(((1 + erf(avgZ / Math.sqrt(2))) / 2) * 100);

  const topPGS = results.reduce((best, r) =>
    r.percentile > (best?.percentile || 0) ? r : best, null
  );

  return { avgZ, avgPercentile, topPGS };
}

export default function IndexPage() {
  const [traits, setTraits] = useState([]);

  useEffect(() => {
    fetch('/traits.json')
      .then(res => res.json())
      .then(data => {
        const sorted = data.sort((a, b) => a.label.localeCompare(b.label));
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
      let disease = diseaseSelect.value.trim();

      if (!file) {
        alert('Bitte eine 23andMe-Datei auswählen.');
        return;
      }
      if (!disease) {
        alert('Bitte eine Krankheit auswählen.');
        return;
      }

      resultDiv.innerHTML = `
        <p>Berechnung für <strong>${disease}</strong> läuft… bitte warten</p>
        <progress id="overallProgress" max="100" value="0" style="width:100%; height:20px; margin-bottom:10px;"></progress>
        <div id="progressDetails" style="font-size:14px;"></div>
      `;

      try {
        const allResults = await computePRS(
          file,
          (pgsId, progress, matches, phase, completed, total) => {
            const overall = document.getElementById('overallProgress');
            const overallPct = ((completed + progress / 100) / total) * 100;
            if (overall) overall.value = overallPct;

            let bar = document.getElementById(`bar-${pgsId}`);
            if (!bar) {
              const container = document.getElementById('progressDetails');
              const wrapper = document.createElement('div');
              wrapper.innerHTML = `
                <p style="margin:5px 0;">
                  <strong>${pgsId}</strong> – <span id="label-${pgsId}">${phase}</span>
                </p>
                <progress id="bar-${pgsId}" max="100" value="${progress}" style="width:100%;"></progress>
              `;
              container.appendChild(wrapper);
              bar = document.getElementById(`bar-${pgsId}`);
            }
            bar.value = progress;
            const label = document.getElementById(`label-${pgsId}`);
            if (label) label.textContent = `${phase} – ${progress.toFixed(1)}% (${matches} Matches)`;
          },
          disease
        );

        renderSortedResults(allResults, resultDiv);
      } catch (err) {
        console.error(err);
        resultDiv.innerHTML = `<p style="color:red">Fehler: ${err.message}</p>`;
      }
    });
  }, []);

  function renderSortedResults(allResults, container) {
    // Sortieren
    allResults.sort((a, b) => (b.percentile || 0) - (a.percentile || 0));
    const summary = summarizePGSResults(allResults);

    // Zusammenfassung an den Anfang einfügen (ohne Details zu löschen)
    const summaryDiv = document.createElement('div');
    summaryDiv.innerHTML = `
      <h2>Zusammenfassung</h2>
      <p><strong>Durchschnittliches Risiko (über ${allResults.length} PGS):</strong> ${summary.avgPercentile}. Perzentil</p>
      <p><strong>Höchstes Risiko:</strong> ${summary.topPGS.id} (${summary.topPGS.percentile}. Perzentil, ${summary.topPGS.matches} Matches)</p>
      <canvas id="pgsChart" width="400" height="200" style="margin:20px 0;"></canvas>
      <h3>Alle PGS-Ergebnisse</h3>
      <table border="1" cellpadding="4" style="border-collapse:collapse;width:100%">
        <tr>
          <th>PGS ID</th><th>Perzentil</th><th>Z-Score</th><th>Matches</th><th>Studie</th>
        </tr>
        ${allResults.map(r => `
          <tr>
            <td>${r.id}</td>
            <td>${r.percentile}</td>
            <td>${r.zScore.toFixed(2)}</td>
            <td>${r.matches}</td>
            <td>${r.doi ? `<a href="${r.doi}" target="_blank">DOI</a>` : '-'}</td>
          </tr>
        `).join('')}
      </table>
    `;
    container.prepend(summaryDiv); // Ganz oben einfügen

    // Chart zeichnen
    const ctx = summaryDiv.querySelector('#pgsChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: allResults.map(r => r.id),
        datasets: [{
          label: 'Perzentil',
          data: allResults.map(r => r.percentile),
          backgroundColor: allResults.map(r =>
            r.percentile >= 90 ? 'red' : r.percentile >= 75 ? 'orange' : 'green'
          )
        }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
    });

    // Jetzt die Details pro PGS beibehalten und darunter anhängen:
    allResults.forEach(res => {
      const entry = document.createElement('div');
      entry.style.border = `2px solid ${res.percentile >= 90 ? 'red' : res.percentile >= 75 ? 'orange' : 'green'}`;
      entry.style.borderRadius = '8px';
      entry.style.padding = '12px';
      entry.style.marginBottom = '18px';
      entry.style.backgroundColor = '#f9f9f9';

      const prs = res.prs || 0;
      const percentile = res.percentile || 50;
      const zScore = res.zScore || 0;
      const doi = res.doi || null;
      const trait = res.trait || 'Unbekanntes Trait';
      const topVariants = (res.topVariants || []).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

      let label = 'Unauffällig';
      if (percentile >= 90) label = 'Auffällig – ärztliche Analyse empfohlen';
      else if (percentile >= 75) label = 'Grenzwertig – Beobachtung empfohlen';

      const variantTable = topVariants.length ? `
        <h4>Top 10 Varianten (größter Einfluss):</h4>
        <table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">
          <tr><th>#</th><th>Variante</th><th>SNP</th><th>Genotyp</th><th>β × z</th></tr>
          ${topVariants.slice(0, 10).map((v, i) => `
            <tr style="color:${Math.abs(v.score)>0.2?'red':Math.abs(v.score)>0.1?'orange':'green'}">
              <td>${i+1}</td>
              <td>${v.variant}</td>
              <td>${v.rsid ? `<a href="https://www.ncbi.nlm.nih.gov/snp/${v.rsid}" target="_blank">${v.rsid}</a>` : '-'}</td>
              <td>${v.alleles}</td>
              <td>${v.score.toFixed(3)}</td>
            </tr>
          `).join('')}
        </table>
      ` : '';

      entry.innerHTML = `
        <h3>${trait} (PGS ${res.id})</h3>
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
            <option key={t.id} value={t.id}>
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
