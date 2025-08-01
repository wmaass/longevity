'use client';

// pages/batch_ui_cardio.js
import { useEffect, useState } from 'react';
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
  const router = useRouter();

  useEffect(() => {
    fetch('/batch_results_cardio.csv')
      .then((res) => res.text())
      .then((csv) => {
        const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map((row) => ({
          ...row,
          'EFO-ID': (row['EFO-ID'] || '').trim(),
          'Avg PRS': parseFloat(row['Avg PRS'] || 0),
          'Avg Percentile': parseFloat(row['Avg Percentile'] || 0),
          logPRS: parseFloat(row['Avg PRS']) > 0 ? Math.log10(parseFloat(row['Avg PRS'])) : 0,
        }));
        setData(parsed);
      });

    fetch('/efo_to_organ.json')
      .then(res => res.json())
      .then(data => {
        const cleaned = {};
        for (const organ in data) {
          cleaned[organ] = data[organ].map(efo => efo.trim());
          console.log(`Organ: ${organ} -> EFOs:`, cleaned[organ]);
        }
        setOrganMap(cleaned);
      });

    fetch('/efo_traitnames.json')
      .then(res => res.json())
      .then(setTraitNames);
  }, []);

  useEffect(() => {
    if (Object.keys(organMap).length > 0 && data.length > 0 && Object.keys(traitNames).length > 0) {
      renderBodyMap(data, organMap, traitNames, router);
    }
  }, [data, organMap, traitNames, router]);

  const barData = {
    labels: data.map((d) => d.Trait),
    datasets: [
      {
        label: 'log10(Avg PRS)',
        data: data.map((d) => d.logPRS),
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
        backgroundColor: '#ffffff',
        titleColor: '#111827',
        bodyColor: '#374151',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: 12,
        titleFont: { size: 16, weight: 'bold' },
        bodyFont: { size: 14 },
        callbacks: {
          label: (ctx) => {
            const d = data[ctx.dataIndex];
            return `${d.Trait}: logPRS=${d.logPRS.toFixed(2)}, Percentile=${d['Avg Percentile']}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { font: { size: 14 }, color: '#374151' },
        grid: { color: '#f3f4f6', drawTicks: false },
      },
      y: {
        ticks: { font: { size: 16, weight: '500' }, color: '#111827' },
        grid: { drawTicks: false, color: '#ffffff' },
      },
    },
    layout: { padding: { top: 10, bottom: 10, left: 10, right: 10 } },
    onHover: (event, chartElement) => {
      event.native.target.style.cursor = chartElement.length ? 'pointer' : 'default';
    },
    onClick: (_, elements) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        router.push(`/details/${data[idx]['EFO-ID']}?trait=${encodeURIComponent(data[idx].Trait)}`);
      }
    },
  };

  return (
    <DashboardLayout>
      <h2 className="text-4xl font-extrabold mb-10 text-gray-800">
        Kardiovaskuläre PGS-Ergebnisse
      </h2>

      <div className="flex flex-row justify-center gap-8">
        <div id="bodymap" className="relative my-12 overflow-visible" style={{ width: '700px', height: '800px' }}>
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

        <div className="mt-12 w-[600px]">
          <Bar data={barData} options={barOptions} />
        </div>
      </div>

      <div className="flex justify-center gap-4 text-sm mt-4 text-gray-700">
        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-red-500 rounded-full"></div> hohes Risiko</div>
        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-red-200 rounded-full"></div> niedriges Risiko</div>
      </div>
    </DashboardLayout>
  );
}

function renderBodyMap(results, organMap, traitNames, router) {
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
    const matches = results.filter(r => efoList.includes((r['EFO-ID'] || '').trim()));

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
      .on('click', function () {
        if (efoList.length === 1) {
          router.push(`/details/${efoList[0]}`);
        } else if (efoList.length > 1) {
          const content = efoList.map((efo) => {
            const match = results.find(r => (r['EFO-ID'] || '').trim() === efo);
            const label = match?.Trait || traitNames[efo] || `Unbekannter Trait (${efo})`;
            return `<div class='hover:bg-gray-100 p-1 cursor-pointer' data-efo='${efo}'>${label} (${efo})</div>`;
          }).join('');

          tooltip
            .style('opacity', 1)
            .style('pointer-events', 'auto')
            .style('left', `${x + 30}px`)
            .style('top', `${y - 20}px`)
            .html(`<div class='font-semibold mb-1'>${name}</div>${content}`);

          tooltip.selectAll('[data-efo]').on('click', function () {
            const efo = d3.select(this).attr('data-efo');
            router.push(`/details/${efo}`);
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
