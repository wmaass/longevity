import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { Sun, Moon } from "lucide-react";
import Link from "next/link";

export default function DashboardLayout({ children, logText, genomeName: genomeNameProp }) {
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [genomeName, setGenomeName] = useState(genomeNameProp || "");

  // load prefs on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedDark = localStorage.getItem("pgs.darkMode");
    if (storedDark != null) setDark(storedDark === "1");

    if (!genomeNameProp && !genomeName) {
      const last = localStorage.getItem("genomeName") || "";
      if (last) setGenomeName(last);
    }
  }, []);

  // persist dark mode
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("pgs.darkMode", dark ? "1" : "0");
  }, [dark]);

  // resolve genomeName: prop → query
  useEffect(() => {
    const fromQuery = String(router.query?.genome || router.query?.genomeName || "");
    if (genomeNameProp && genomeNameProp !== genomeName) {
      setGenomeName(genomeNameProp);
    } else if (fromQuery && fromQuery !== genomeName) {
      setGenomeName(fromQuery);
    }
  }, [router.query, genomeNameProp]);

  // persist genomeName
  useEffect(() => {
    if (!genomeName) return;
    try { localStorage.setItem("genomeName", genomeName); } catch {}
  }, [genomeName]);

  const longevityHref = genomeName
    ? `/longevity?genome=${encodeURIComponent(genomeName)}`
    : `/longevity`;

  const isLongevity = router.pathname.startsWith("/longevity");
  const isHome = router.pathname === "/";

  const linkBase = "block px-3 py-2 rounded-lg transition-colors";
  const linkActive = "bg-blue-50 text-blue-700 font-semibold dark:bg-blue-900/20 dark:text-blue-300";
  const linkIdle = "text-gray-700 hover:bg-blue-100 hover:text-blue-700 dark:text-gray-200 dark:hover:bg-blue-900/20 dark:hover:text-blue-300";

  return (
    <div className={dark ? "dark" : ""}>
      <div className={`min-h-screen flex font-sans ${dark ? "bg-gray-900 text-gray-100" : "bg-gray-100 text-gray-900"}`}>

        {/* Sidebar */}
        <aside className={`w-64 p-6 flex flex-col items-center shadow-md rounded-r-3xl ${dark ? "bg-gradient-to-b from-gray-800 to-gray-700" : "bg-gradient-to-b from-white to-gray-50"}`}>
          <Link href="/" className={`${linkBase} ${isHome ? linkActive : linkIdle} w-full text-center`}>
            Home
          </Link>

          <Link href="/" className="my-6">
            <img src="/logo.png" alt="PGS Dashboard Logo" className="w-36 h-auto transition-transform duration-200 hover:scale-105" />
          </Link>

          <nav className="flex-1 space-y-3 w-full">
            <Link href={longevityHref} className={`${linkBase} ${isLongevity ? linkActive : linkIdle}`}>
              Longevity Analyse
            </Link>
          </nav>

          <button
            onClick={() => setDark(!dark)}
            className="mt-10 flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            <span>{dark ? "Light Mode" : "Dark Mode"}</span>
          </button>
        </aside>

        {/* Main */}
        <main className="flex-1 px-6 sm:px-8 py-10 overflow-y-auto">
          {/* WIDER CONTENT WRAPPER */}
          <div className="w-full max-w-[1400px] xl:max-w-[1600px] 2xl:max-w-[1760px] mx-auto space-y-8">
            {children}

            {logText && (
              <div className="mt-8 border-t pt-4 text-xs bg-white rounded-lg shadow-inner p-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-semibold mb-2">🔍 Systemmeldungen</h3>
                <pre>{logText}</pre>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
