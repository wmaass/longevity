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
  const router = useRouter();

  useEffect(() => {
    fetch('/batch_results_cardio.csv')
      .then((res) => res.text())
      .then((csv) => {
        const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map((row) => ({
          ...row,
          'Avg PRS': parseFloat(row['Avg PRS'] || 0),
          'Avg Percentile': parseFloat(row['Avg Percentile'] || 0),
          logPRS: parseFloat(row['Avg PRS']) > 0 ? Math.log10(parseFloat(row['Avg PRS'])) : 0,
        }));
        setData(parsed);
      });

    fetch('/efo_to_organ.json')
      .then(res => res.json())
      .then(data => setOrganMap(data));
  }, []);

  useEffect(() => {
    if (Object.keys(organMap).length > 0 && data.length > 0) {
      renderBodyMap(data, organMap);
    }
  }, [data, organMap]);

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

      <div id="bodymap" className="relative w-full flex justify-center my-12">
        <img src="/images/bodymap.png" alt="Körperkarte" className="absolute max-w-full h-auto" />
        <svg className="absolute w-full h-full" id="organsvg"></svg>
      </div>

      <div className="flex justify-center gap-4 text-sm mt-4 text-gray-700">
        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-red-500 rounded-full"></div> hohes Risiko</div>
        <div className="flex items-center gap-1"><div className="w-4 h-4 bg-red-200 rounded-full"></div> niedriges Risiko</div>
      </div>

      <div className="mt-12">
        <Bar data={barData} options={barOptions} />
      </div>
    </DashboardLayout>
  );
}

function renderBodyMap(results, organMap) {
  const svg = d3.select('#organsvg');
  svg.selectAll('*').remove();

  const organs = [
    { name: 'Gehirn', x: 250, y: 60 },
    { name: 'Lunge', x: 250, y: 180 },
    { name: 'Herz', x: 250, y: 250 },
    { name: 'Leber', x: 240, y: 300 },
    { name: 'Magen', x: 260, y: 330 },
    { name: 'Blutgefäße', x: 250, y: 270 },
    { name: 'Niere', x: 230, y: 370 },
    { name: 'Darm', x: 250, y: 430 },
    { name: 'Blase', x: 250, y: 520 }
  ];

  organs.forEach(({ name, x, y }) => {
    const matches = results.filter(r => organMap[r['EFO-ID']]?.organ === name);
    const maxPercentile = d3.max(matches, m => parseFloat(m['Avg Percentile'] || 0));
    const color = d3.interpolateReds((maxPercentile || 0) / 100);

    svg.append('circle')
      .attr('cx', x)
      .attr('cy', y)
      .attr('r', 25)
      .attr('fill', color)
      .attr('stroke', 'black')
      .on('click', () => {
        if (matches.length > 0) {
          const best = matches.reduce((a, b) => (a['Avg Percentile'] > b['Avg Percentile'] ? a : b));
          window.location.href = `/details/${best['EFO-ID']}?trait=${encodeURIComponent(best.Trait)}`;
        }
      });

    svg.append('text')
      .attr('x', x)
      .attr('y', y + 40)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', 'black')
      .text(name);
  });
}
