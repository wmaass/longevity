import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Papa from 'papaparse';
import * as d3 from 'd3';
import DashboardLayout from '../components/DashboardLayout';
import { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function CardioDashboard() {
  const [data, setData] = useState([]);
  const [organMap, setOrganMap] = useState({});
  const [traitNames, setTraitNames] = useState({});
  const [showReferences, setShowReferences] = useState(false);
  const [logEntries, setLogEntries] = useState([]);
  const [genomeName, setGenomeName] = useState('genome_Dorothy_Wolf_v4_Full_20170525101345');
  const router = useRouter();

  console.log('📊 Parsed CSV Data:', genomeName);

  const log = (msg) => {
    setLogEntries((prev) => [...prev.slice(-20), msg]);
    console.log(msg);
  };


  useEffect(() => {
  console.log('🧪 useEffect triggered');
  console.log('🔎 genomeName ist:', genomeName);

  if (!genomeName) {
    console.warn('⛔ genomeName leer – Effekt wird abgebrochen');
    return;
  }

  const filePath = `/results/${genomeName}/batch_results_cardio.csv`;

  log(`📥 Lade ${filePath}...`);
  fetch(filePath)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then((csv) => {
      const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map((row) => ({
        ...row,
        'EFO-ID': (row['EFO-ID'] || '').trim(),
        'Avg PRS': parseFloat(row['Avg PRS'] || 0),
        'Avg Percentile': parseFloat(row['Avg Percentile'] || 0),
        logPRS: parseFloat(row['Avg PRS']) > 0 ? Math.log10(parseFloat(row['Avg PRS'])) : 0,
      }));

      console.log("📦 PARSED ROWS:", parsed.map(r => ({
        efo: r['EFO-ID'],
        prs: r['Avg PRS'],
        percentile: r['Avg Percentile'],
        trait: r.Trait
      })));

      log(`✅ ${parsed.length} Zeilen geladen aus ${filePath}`);
      setData(parsed);
    })
    .catch(err => {
      log(`❌ Fehler beim Laden von ${filePath}: ${err.message}`);
    });

    log('📥 Lade efo_to_organ.json...');
    fetch('/efo_to_organ.json')
      .then(res => res.json())
      .then(data => {
        const cleaned = {};
        for (const organ in data) {
          cleaned[organ] = data[organ].map(efo => efo.trim());
        }
        log('✅ efo_to_organ.json geladen');
        setOrganMap(cleaned);
      })
      .catch(err => {
        log(`❌ Fehler beim Laden von efo_to_organ.json: ${err}`);
      });

    log('📥 Lade efo_traitnames.json...');
    fetch('/traits.json')
      .then(res => res.json())
      .then(data => {
        const traitMap = {};
        for (const entry of data) {
          if (entry.id && entry.label) {
            traitMap[entry.id.trim()] = entry.label.trim();
          }
        }
        log('✅ traits.json geladen');
        setTraitNames(traitMap);
      })
      .catch(err => {
        log(`❌ Fehler beim Laden von traits.json: ${err}`);
      });
  }, [genomeName]);

  useEffect(() => {
    if (!genomeName) return; // Warten auf genomeName

    console.log('🚀 genomeName vor renderBodyMap:', genomeName);

    if (Object.keys(organMap).length > 0 && data.length > 0 && Object.keys(traitNames).length > 0) {
      renderBodyMap(data, organMap, traitNames, router, genomeName);
    }
  }, [data, organMap, traitNames, genomeName, router]);



  const enrichedData = data
    .map(d => ({
      ...d,
      TraitLabel: d.Trait && d.Trait !== '(unbekannt)' ? d.Trait : traitNames[d['EFO-ID']] || '(unbekannt)'
    }))
    .sort((a, b) => b['Avg Percentile'] - a['Avg Percentile']);

  const barData = {
    labels: enrichedData.map(d => d.TraitLabel),
    datasets: [
      {
        label: 'log10(Avg PRS)',
        data: enrichedData.map(d => d.logPRS),
        backgroundColor: 'rgba(34,197,94,0.6)',
        borderRadius: 8,
        borderSkipped: false,
        hoverBackgroundColor: 'rgba(34,197,94,0.8)',
        hoverBorderColor: 'rgba(34,197,94,1)',
        borderWidth: 1,
      },
    ],
  };

  const barOptions = {
    indexAxis: 'y',
    responsive: true,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const d = enrichedData[ctx.dataIndex];
            return `${d.TraitLabel}: logPRS=${d.logPRS.toFixed(2)}, Percentile=${d['Avg Percentile']}`;
          },
        },
      },
    },
    onClick: (_, elements) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        router.push(`/details/${enrichedData[idx]['EFO-ID']}?trait=${encodeURIComponent(enrichedData[idx].TraitLabel)}&genome=${encodeURIComponent(genomeName)}`);
      }
    },
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setGenomeName(file.name.replace(/\.txt(\.gz)?$/, ''));
      log(`📂 Genom-Datei ausgewählt: ${file.name}`);
    }
  };

  return (
    <DashboardLayout>
      <h2 className="text-4xl font-extrabold mb-6 text-gray-800">
        Kardiovaskuläre PGS-Ergebnisse
      </h2>

      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 mr-2">Genom-Datei wählen:</label>
        <input type="file" accept=".txt,.gz" onChange={handleFileSelect} />
      </div>



      <div className="flex flex-row gap-8">
        <div className="flex flex-col w-1/2">
          <div id="bodymap" className="relative mb-8 overflow-visible" style={{ width: '700px', height: '800px' }}>
            <img
              src="/images/bodymap.png"
              alt="Körperkarte"
              className="absolute"
              style={{ width: '700px', height: '800px', objectFit: 'contain', zIndex: 0 }}
            />
            <svg
              className="absolute"
              id="organsvg"
              viewBox="0 0 700 800"
              preserveAspectRatio="xMidYMid meet"
              style={{ width: '700px', height: '800px', zIndex: 10 }}
            ></svg>
            <div id="tooltip" className="absolute bg-white text-sm text-gray-800 border border-gray-300 px-3 py-2 rounded-lg shadow-md pointer-events-auto opacity-0 transition-opacity duration-200 z-50"></div>
          </div>



          <div className="bg-white border border-gray-200 rounded-lg mb-6 p-4 max-h-48 overflow-auto text-sm text-gray-700">
            <strong>🔍 Log-Ausgaben:</strong>
            <ul className="list-disc ml-6 mt-2">
              {logEntries.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col w-1/2">

        <div className="trait-interpretation text-sm">
            <h2 className="text-lg font-semibold mb-4">Interpretation der Ergebnisse</h2>

            <table className="mb-4 text-sm border border-gray-300 w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Perzentilbereich</th>
                  <th className="px-3 py-2 text-left">Risikoeinstufung</th>
                  <th className="px-3 py-2 text-left">Quelle</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="px-3 py-2">&lt; 20 %</td><td>Unterdurchschnittliches Risiko</td><td>Lewis & Vassos (2020)</td></tr>
                <tr><td className="px-3 py-2">20–80 %</td><td>Durchschnittliches Risiko</td><td>Torkamani et al. (2018)</td></tr>
                <tr><td className="px-3 py-2">&gt; 80 %</td><td>Erhöhtes Risiko</td><td>Inouye et al. (2018)</td></tr>
                <tr><td className="px-3 py-2">&gt; 95 %</td><td>Stark erhöhtes Risiko</td><td>Khera et al. (2018); Inouye (2018)</td></tr>
              </tbody>
            </table>

            <button
              className="text-blue-700 underline text-sm mb-2"
              onClick={() => setShowReferences(!showReferences)}
            >
              {showReferences ? "Referenzen ausblenden" : "Wissenschaftliche Referenzen anzeigen"}
            </button>

            {showReferences && (
              <p className="text-gray-700 mb-4 text-sm">
                <strong>Referenzen (APA):</strong><br />
                Torkamani, A., Wineinger, N. E., & Topol, E. J. (2018). <i>The personal and clinical utility of polygenic risk scores.</i> Nature Reviews Genetics, 19, 581–590. <a href="https://doi.org/10.1038/s41576-018-0018-x" className="text-blue-700 underline" target="_blank">https://doi.org/10.1038/s41576-018-0018-x</a><br />
                Lewis, C. M., & Vassos, E. (2020). <i>Polygenic risk scores: From research tools to clinical instruments.</i> Genome Medicine, 12, 44. <a href="https://doi.org/10.1186/s13073-020-00742-5" className="text-blue-700 underline" target="_blank">https://doi.org/10.1186/s13073-020-00742-5</a><br />
                Khera, A. V., et al. (2018). <i>Genome-wide polygenic scores for common diseases identify individuals with risk equivalent to monogenic mutations.</i> Nature Genetics, 50, 1219–1224. <a href="https://doi.org/10.1038/s41588-018-0183-z" className="text-blue-700 underline" target="_blank">https://doi.org/10.1038/s41588-018-0183-z</a><br />
                Inouye, M., et al. (2018). <i>Genomic risk prediction of coronary artery disease in 480,000 adults: implications for primary prevention.</i> JACC, 72(16), 1883–1893. <a href="https://doi.org/10.1016/j.jacc.2018.07.079" className="text-blue-700 underline" target="_blank">https://doi.org/10.1016/j.jacc.2018.07.079</a>
              </p>
            )}
          </div>
        
          <table className="mb-12 w-full text-sm text-left border border-gray-200">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="py-2 px-4">EFO ID</th>
                <th className="py-2 px-4">Trait</th>
                <th className="py-2 px-4">Percentile</th>
                <th className="py-2 px-4">PGS Count</th>
              </tr>
            </thead>
            <tbody>
              {enrichedData.map((row, idx) => (
                <tr key={idx} className="border-t">
                  <td className="py-2 px-4 font-mono text-xs text-gray-700">
                    <a href={`/details/${row['EFO-ID']}?genome=${encodeURIComponent(genomeName)}`} className="text-blue-600 hover:underline">{row['EFO-ID']}</a>
                  </td>
                  <td className="py-2 px-4">
                    <a href={`/details/${row['EFO-ID']}?genome=${encodeURIComponent(genomeName)}`} className="text-blue-700 hover:underline">{row.TraitLabel}</a>
                  </td>
                  <td className="py-2 px-4">{row['Avg Percentile'].toFixed(1)}</td>
                  <td className="py-2 px-4">{row['PGS Count']}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6">
            <Bar data={barData} options={barOptions} />
          </div>
        </div>

        
      </div>
    </DashboardLayout>
  );
}

function renderBodyMap(results, organMap, traitNames, router, genomeName) {
  const svg = d3.select('#organsvg');
  svg.selectAll('*').remove();

  const tooltip = d3.select('#tooltip');
  let hideTimeout;

  tooltip
    .on('mouseenter', () => clearTimeout(hideTimeout))
    .on('mouseleave', () => {
      hideTimeout = setTimeout(() => tooltip.style('opacity', 0), 200);
    });

  const organs = [
    { name: 'Gehirn', x: 580, y: 80, x1: 360, y1: 70 },
    { name: 'Herz', x: 580, y: 180, x1: 340, y1: 220 },
    { name: 'Magen', x: 580, y: 280, x1: 370, y1: 280 },
    { name: 'Darm', x: 580, y: 380, x1: 360, y1: 360 },
    { name: 'Blase', x: 580, y: 460, x1: 350, y1: 420 },
    { name: 'Lunge', x: 120, y: 100, x1: 320, y1: 170 },
    { name: 'Leber', x: 120, y: 200, x1: 310, y1: 280 },
    { name: 'Niere', x: 120, y: 300, x1: 320, y1: 310 },
    { name: 'Blutgefäße', x: 120, y: 400, x1: 140, y1: 400 },
  ];

  organs.forEach(({ name, x, y, x1, y1 }) => {
    const efoList = (organMap[name] || []).map(efo => efo.trim());
    const efoIdsInResults = new Set(results.map(r => (r['EFO-ID'] || '').trim()));

    const matches = efoList
      .filter(efo => efoIdsInResults.has(efo))
      .map(efo => results.find(r => (r['EFO-ID'] || '').trim() === efo))
      .filter(Boolean);

    const validPercentiles = matches
      .map(m => parseFloat(m['Avg Percentile']))
      .filter(p => !isNaN(p));

    const avgPercentile = validPercentiles.length > 0
      ? d3.mean(validPercentiles)
      : 0;

    const color = efoList.length === 0 ? '#ccc' : (matches.length > 0 ? d3.interpolateReds(avgPercentile / 100) : '#fff');

    svg.append('circle')
      .attr('cx', x)
      .attr('cy', y)
      .attr('r', 22)
      .attr('fill', color)
      .attr('stroke', '#333')
      .attr('stroke-width', 1)
      .style('cursor', efoList.length > 0 ? 'pointer' : 'default')
      .on('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        if (efoList.length === 1) {
          router.push({
            pathname: `/details/${efo}`,
            query: { genome: genomeName }
          });
        } else if (efoList.length > 1) {
          const content = matches.map((match) => {
            const efo = (match['EFO-ID'] || '').trim();
            const label = match?.Trait || traitNames[efo] || `Unbekannter Trait (${efo})`;
            return `<div class='hover:bg-gray-100 p-1 cursor-pointer' data-efo='${efo}'>${label} (${efo})</div>`;
          }).join('');

          tooltip
            .style('opacity', 1)
            .style('pointer-events', 'auto')
            .style('left', `${x + 30}px`)
            .style('top', `${y - 20}px`)
            .html(`<div class='font-semibold mb-1'>${name}</div>${content}`);

          // Event-Handler für die Klicks auf einzelne EFO-Einträge im Tooltip
          tooltip.selectAll('[data-efo]').on('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            const efo = d3.select(this).attr('data-efo');
            router.push({
              pathname: `/details/${efo}`,
              query: { genome: genomeName }
            });
          });
        }
      });

    svg.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x + (x < 150 ? 22 : -22))
      .attr('y2', y)
      .attr('stroke', '#333')
      .attr('stroke-width', 1);

    svg.append('text')
      .attr('x', x + (x < 150 ? -26 : 26))
      .attr('y', y + 5)
      .attr('font-size', '13px')
      .attr('fill', '#111')
      .attr('text-anchor', x < 150 ? 'end' : 'start')
      .text(name);
  });
}