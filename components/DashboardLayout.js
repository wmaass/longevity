import { useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function DashboardLayout({ children }) {
  const [dark, setDark] = useState(false);

  return (
    <div
      className={`min-h-screen flex font-sans ${
        dark ? "bg-gray-900 text-gray-100" : "bg-gray-100 text-gray-900"
      }`}
    >
      {/* Sidebar */}
      <aside
        className={`w-64 p-6 flex flex-col shadow-md ${
          dark
            ? "bg-gradient-to-b from-gray-800 to-gray-700"
            : "bg-gradient-to-b from-white to-gray-50"
        } rounded-r-3xl`}
      >
        <h1 className="text-2xl font-extrabold text-blue-600 mb-12 tracking-tight">
          PGS Dashboard
        </h1>

        <nav className="flex-1 space-y-3">
          <a
            href="/batch"
            className="block px-3 py-2 rounded-lg text-gray-700 hover:bg-blue-100 hover:text-blue-700 transition-colors"
          >
            Alle Traits
          </a>
          <a
            href="/batch_ui_cardio"
            className="block px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition-colors"
          >
            Kardiovaskulär
          </a>
        </nav>

        {/* Dark Mode Toggle */}
        <button
          onClick={() => setDark(!dark)}
          className="mt-10 flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          <span>{dark ? "Light Mode" : "Dark Mode"}</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-10 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-8">{children}</div>
      </main>
    </div>
  );
}
