'use client';

import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
} from 'chart.js';
import { Bar, Scatter } from 'react-chartjs-2';

Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, PointElement);

export default function BatchUI() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch('/batch_results.csv')
      .then((res) => res.text())
      .then((csvText) => {
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;

        const cleaned = parsed.map((row) => {
          const prs = parseFloat(row['Avg PRS'] || '0') || 0;
          const percentile = parseFloat(row['Avg Percentile'] || '0') || 0;
          const logPRS = prs > 0 ? Math.log10(prs) : 0;

          return {
            ...row,
            'Avg PRS': prs,
            'Avg Percentile': percentile,
            logPRS,
          };
        });

        setData(cleaned);
      });
  }, []);

  if (data.length === 0) return <p>Lade Batch-Ergebnisse…</p>;

  const sorted = [...data].sort((a, b) => b.logPRS - a.logPRS);

  const getColor = (percentile) => {
    if (percentile >= 90) return 'rgba(255,0,0,0.7)';
    if (percentile >= 75) return 'rgba(255,165,0,0.7)';
    return 'rgba(0,128,0,0.7)';
  };

  const barData = {
    labels: sorted.map((d) => d.Trait),
    datasets: [
      {
        label: 'log10(Avg PRS)',
        data: sorted.map((d) => d.logPRS),
        backgroundColor: sorted.map((d) => getColor(d['Avg Percentile'])),
      },
    ],
  };

  const barOptions = {
    indexAxis: 'y',
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'Log10(Avg PRS) pro Trait (sortiert)' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const d = sorted[ctx.dataIndex];
            return `${d.Trait}: logPRS=${d.logPRS.toFixed(2)}, Avg Percentile=${d['Avg Percentile']}`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'log10(Avg PRS)' } },
    },
  };

  const scatterData = {
    datasets: [
      {
        label: 'PRS vs. Perzentil',
        data: sorted.map((d) => ({
          x: d.logPRS,
          y: d['Avg Percentile'],
          trait: d.Trait,
          efoId: d['EFO-ID'],
        })),
        backgroundColor: sorted.map((d) => getColor(d['Avg Percentile'])),
      },
    ],
  };

  const scatterOptions = {
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'PRS vs. Perzentil (log10)' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const { trait } = ctx.raw;
            return `${trait}: logPRS=${ctx.raw.x.toFixed(2)}, Perzentil=${ctx.raw.y}`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'log10(PRS)' } },
      y: { title: { display: true, text: 'Durchschnittliches Perzentil' } },
    },
    onClick: (e, elements) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        const efoId = sorted[idx]?.['EFO-ID'];
        if (efoId) {
          window.open(`/details/${efoId}`, '_blank');
        }
      }
    },
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Batch-Ergebnisse aller EFO-Traits</h1>
      <p>Klicke auf eine EFO-ID oder einen Trait, um die Detailansicht (alle PRS) zu öffnen.</p>

      {/* Tabelle */}
      <table
        border="1"
        cellPadding="6"
        style={{ width: '100%', marginBottom: '30px', borderCollapse: 'collapse' }}
      >
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th>EFO-ID</th>
            <th>Trait</th>
            <th>PGS Count</th>
            <th>Avg PRS</th>
            <th>Max PRS</th>
            <th>Min PRS</th>
            <th>Avg Percentile</th>
            <th>Total Variants</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fafafa' : '#fff' }}>
              <td>
                <a href={`/details/${d['EFO-ID']}`} target="_blank" rel="noopener noreferrer">
                  {d['EFO-ID']}
                </a>
              </td>
              <td>
                <a href={`/details/${d['EFO-ID']}`} target="_blank" rel="noopener noreferrer">
                  {d.Trait}
                </a>
              </td>
              <td>{d['PGS Count']}</td>
              <td>{!isNaN(d['Avg PRS']) ? d['Avg PRS'].toExponential(3) : '0'}</td>
              <td>{d['Max PRS']}</td>
              <td>{d['Min PRS']}</td>
              <td>{d['Avg Percentile']}</td>
              <td>{d['Total Variants']}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Visualisierungen</h2>
      <div style={{ marginBottom: '50px' }}>
        <Bar data={barData} options={barOptions} />
      </div>
      <div>
        <Scatter data={scatterData} options={scatterOptions} />
      </div>
    </div>
  );
}
