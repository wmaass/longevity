import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import Link from "next/link";

export default function DashboardLayout({ children, logText }) {
  const [dark, setDark] = useState(false);

  return (
    <div
      className={`min-h-screen flex font-sans ${
        dark ? "bg-gray-900 text-gray-100" : "bg-gray-100 text-gray-900"
      }`}
    >
      {/* Sidebar */}
      <aside
        className={`w-64 p-6 flex flex-col items-center shadow-md ${
          dark
            ? "bg-gradient-to-b from-gray-800 to-gray-700"
            : "bg-gradient-to-b from-white to-gray-50"
        } rounded-r-3xl`}
      >
         {/* Logo */}
        <Link href="/" className="mb-8">
          <img
            src="/logo.png"
            alt="PGS Dashboard Logo"
            className="w-36 h-auto transition-transform duration-200 hover:scale-105"
          />
        </Link>

        {/* Navigation */}
        <nav className="flex-1 space-y-3 w-full">
          <Link
            href="/batch"
            className="block px-3 py-2 rounded-lg text-gray-700 hover:bg-blue-100 hover:text-blue-700 transition-colors"
          >
            Alle Traits
          </Link>
          <Link
            href="/batch_ui_cardio"
            className="block px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition-colors"
          >
            Kardiovaskulär
          </Link>
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
        <div className="max-w-7xl mx-auto space-y-8">
          {children}

          {logText && (
            <div className="mt-8 border-t pt-4 text-xs text-gray-700 bg-white rounded-lg shadow-inner p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
              <h3 className="text-sm font-semibold mb-2">🔍 Systemmeldungen</h3>
              <pre>{logText}</pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
