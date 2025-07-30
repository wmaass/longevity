'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Papa from "papaparse";
import DashboardLayout from "../components/DashboardLayout";
import { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";
import { Bar } from "react-chartjs-2";

Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function CardioDashboard() {
  const [data, setData] = useState([]);
  const [sortKey, setSortKey] = useState("Avg PRS");
  const [sortOrder, setSortOrder] = useState("desc");
  const router = useRouter();

  useEffect(() => {
    fetch("/batch_results_cardio.csv")
      .then((res) => res.text())
      .then((csv) => {
        const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map((row) => ({
          ...row,
          "Avg PRS": parseFloat(row["Avg PRS"] || 0),
          "Avg Percentile": parseFloat(row["Avg Percentile"] || 0),
          logPRS: parseFloat(row["Avg PRS"]) > 0 ? Math.log10(parseFloat(row["Avg PRS"])) : 0,
        }));
        setData(parsed);
      });
  }, []);

  const sorted = [...data].sort((a, b) =>
    sortOrder === "asc" ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]
  );

  const barData = {
    labels: sorted.map((d) => d.Trait),
    datasets: [
      {
        label: "log10(Avg PRS)",
        data: sorted.map((d) => d.logPRS),
        backgroundColor: "rgba(34,197,94,0.6)",
        borderRadius: 8,
        borderSkipped: false,
        hoverBackgroundColor: "rgba(34,197,94,0.8)",
        hoverBorderColor: "rgba(34,197,94,1)",
        borderWidth: 1,
      },
    ],
  };

  const barOptions = {
    indexAxis: "y",
    responsive: true,
    animation: { duration: 400, easing: "easeOutQuart" },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#ffffff",
        titleColor: "#111827",
        bodyColor: "#374151",
        borderColor: "#e5e7eb",
        borderWidth: 1,
        padding: 12,
        titleFont: { size: 16, weight: "bold" },
        bodyFont: { size: 14 },
        callbacks: {
          label: (ctx) => {
            const d = sorted[ctx.dataIndex];
            return `${d.Trait}: logPRS=${d.logPRS.toFixed(2)}, Percentile=${d["Avg Percentile"]}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { font: { size: 14 }, color: "#374151" },
        grid: { color: "#f3f4f6", drawTicks: false },
      },
      y: {
        ticks: { font: { size: 16, weight: "500" }, color: "#111827" },
        grid: { drawTicks: false, color: "#ffffff" },
      },
    },
    layout: { padding: { top: 10, bottom: 10, left: 10, right: 10 } },
    onHover: (event, chartElement) => {
      event.native.target.style.cursor = chartElement.length ? "pointer" : "default";
    },
    onClick: (_, elements) => {
      if (elements.length > 0) {
        const idx = elements[0].index;
        router.push(`/details/${sorted[idx]["EFO-ID"]}?trait=${encodeURIComponent(sorted[idx].Trait)}`);
      }
    },
  };

  const toggleSort = (key) => {
    setSortKey(key);
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  };

  return (
    <DashboardLayout>
      <h2 className="text-4xl font-extrabold mb-10 text-gray-800">
        Kardiovaskuläre PGS-Ergebnisse
      </h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white rounded-2xl shadow-lg p-6 border-t-4 border-green-400 text-center">
          <h4 className="text-sm font-medium text-gray-500">Anzahl Traits</h4>
          <p className="text-5xl font-bold text-gray-900 mt-2">{data.length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 border-t-4 border-orange-400 text-center">
          <h4 className="text-sm font-medium text-gray-500">Höchste Avg Percentile</h4>
          <p className="text-5xl font-bold text-gray-900 mt-2">
            {Math.max(...data.map((d) => d["Avg Percentile"] || 0)).toFixed(1)}%
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 border-t-4 border-blue-400 text-center">
          <h4 className="text-sm font-medium text-gray-500">Durchschnittliches Percentile</h4>
          <p className="text-5xl font-bold text-gray-900 mt-2">
            {(data.reduce((a, b) => a + (b["Avg Percentile"] || 0), 0) / (data.length || 1)).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Table + Interpretation Panel */}
      <div className="flex gap-6">
        {/* Table (Top 5 visible, scroll for more) */}
        <div className="flex-1 overflow-x-auto bg-white shadow-md rounded-2xl p-4 max-h-96 overflow-y-auto">
          <table className="min-w-full border-separate border-spacing-y-1">
            <thead className="bg-blue-50 text-gray-700 sticky top-0">
              <tr>
                {["EFO-ID", "Trait", "PGS Count", "Avg PRS", "Avg Percentile", "Total Variants"].map((h) => (
                  <th
                    key={h}
                    onClick={() => toggleSort(h)}
                    className="px-6 py-3 text-left text-sm font-semibold tracking-wide cursor-pointer hover:text-blue-600"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr
                  key={i}
                  className="bg-gray-50 hover:bg-blue-50 cursor-pointer rounded-lg transition-colors"
                  onClick={() => router.push(`/details/${d["EFO-ID"]}?trait=${encodeURIComponent(d.Trait)}`)}
                >
                  <td className="px-6 py-3">{d["EFO-ID"]}</td>
                  <td className="px-6 py-3">{d.Trait}</td>
                  <td className="px-6 py-3">{d["PGS Count"]}</td>
                  <td className="px-6 py-3">{d["Avg PRS"].toExponential(2)}</td>
                  <td className="px-6 py-3">{d["Avg Percentile"].toFixed(1)}%</td>
                  <td className="px-6 py-3">{d["Total Variants"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Interpretation Panel */}
        <div className="w-1/3 bg-white shadow-md rounded-2xl p-6 text-gray-800 sticky top-10 h-fit">
          <h3 className="text-xl font-bold mb-4">Wie interpretiere ich diese Tabelle?</h3>
          <p className="text-sm leading-relaxed">
            Diese Tabelle zeigt die <strong>Top 10 polygenen Risiko-Scores (PGS)</strong> für die getestete Person.
            Der <strong>"Avg Percentile"</strong>-Wert zeigt an, wo die Person im Vergleich zu einer Referenzpopulation steht:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-700 mt-3">
            <li><strong>50%:</strong> Durchschnittliches genetisches Risiko.</li>
            <li><strong>Über 80%:</strong> Hohes genetisches Risiko – erhöhte Aufmerksamkeit empfohlen.</li>
            <li><strong>Unter 20%:</strong> Niedriges genetisches Risiko für diesen Trait.</li>
          </ul>
          <p className="mt-4 text-sm">
            Hohe Perzentile können auf ein erhöhtes Risiko hindeuten und sollten Anlass für <strong>präventive Maßnahmen</strong>
            wie Lebensstiländerungen oder engmaschigere medizinische Kontrollen geben.
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-12">
        <Bar data={barData} options={barOptions} />
      </div>
    </DashboardLayout>
  );
}
