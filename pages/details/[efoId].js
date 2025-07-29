'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

// Helper to fetch abstract + link via API route
async function getLatestAbstract(rsid) {
  try {
    const res = await fetch(`/api/snp-abstract?rsid=${rsid}`);
    if (!res.ok) throw new Error(`Keine Abstracts für ${rsid}`);
    const json = await res.json();

    // Expect API to return { text, url, pmid }
    return json;
  } catch (err) {
    console.error(`Fehler beim Laden des Abstracts für ${rsid}:`, err);
    return { text: 'Fehler beim Laden des Abstracts', url: null };
  }
}

export default function EFODetailPage() {
  const router = useRouter();
  const { efoId } = router.query;

  const [results, setResults] = useState([]);
  const [abstracts, setAbstracts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!efoId) return;

    fetch(`/details/${efoId}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`Keine Detaildaten für ${efoId}`);
        return res.json();
      })
      .then(async (json) => {
        setResults(json);

        // Collect SNPs (only those with |β × z| > 0.2) to fetch abstracts
        const snpList = [];
        json.forEach(res =>
          (res.topVariants || []).forEach(v => {
            if (Math.abs(v.score) > 0.2 && v.rsid) snpList.push(v.rsid);
          })
        );

        // Fetch abstracts sequentially
        const abstractsFetched = {};
        for (const rsid of snpList) {
          abstractsFetched[rsid] = await getLatestAbstract(rsid);
        }
        setAbstracts(abstractsFetched);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [efoId]);

  if (loading) return <p>Lade Detailergebnisse für {efoId}…</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!results.length) return <p>Keine PGS-Daten für {efoId} vorhanden.</p>;

  return (
    <div style={{ padding: '20px' }}>
      <h1>PGS-Details für {efoId}</h1>
      {results.map((res, idx) => (
        <div key={idx} style={{
          border: `2px solid ${res.percentile >= 90 ? 'red' : res.percentile >= 75 ? 'orange' : 'green'}`,
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '18px',
          backgroundColor: '#f9f9f9'
        }}>
          <h3>{res.trait} (PGS {res.id})</h3>
          <p><strong>PRS:</strong> {res.prs.toFixed(3)} (Raw Score: {res.rawScore.toFixed(3)})</p>
          <p><strong>Z‑Score:</strong> {res.zScore.toFixed(2)} | <strong>Perzentil:</strong> {res.percentile}</p>
          <p><strong>Matches:</strong> {res.matches} von {res.totalVariants} Varianten</p>
          {res.doi && <p><strong>Studie:</strong> <a href={res.doi} target="_blank">{res.doi}</a></p>}

          {res.topVariants?.length > 0 && (
            <table border="1" cellPadding="4" style={{ width: '100%', marginTop: '10px', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>#</th><th>Variante</th><th>SNP</th><th>Genotyp</th><th>β × z</th>
                </tr>
              </thead>
              <tbody>
                {res.topVariants.slice(0, 10).map((v, i) => {
                  const scoreAbs = Math.abs(v.score);
                  const color = scoreAbs > 0.2 ? 'red' : scoreAbs > 0.1 ? 'orange' : 'green';
                  const absData = abstracts[v.rsid] || {};
                  const abstractText = absData.text || '';
                  const paperUrl = absData.url || (absData.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${absData.pmid}` : null);

                  return (
                    <tr key={i} style={{ color }}>
                      <td>{i + 1}</td>
                      <td>{v.variant}</td>
                      <td>
                        {v.rsid ? (
                          <>
                            <a
                              href={`https://www.ncbi.nlm.nih.gov/snp/${v.rsid}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {v.rsid}
                            </a>
                            {scoreAbs > 0.2 && abstractText && (
                              <> | <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  const newWindow = window.open('', '_blank', 'width=700,height=500');
                                  newWindow.document.write(`
                                    <html>
                                      <head><title>Abstract für ${v.rsid}</title></head>
                                      <body style="font-family: Arial, sans-serif; padding: 15px;">
                                        <h2>Abstract für ${v.rsid}</h2>
                                        ${paperUrl ? `<p><a href="${paperUrl}" target="_blank" style="color:blue;">Zur Publikation</a></p>` : ''}
                                        <p>${abstractText}</p>
                                      </body>
                                    </html>
                                  `);
                                }}
                              >
                                Abstract
                              </a></>
                            )}
                          </>
                        ) : '-'}
                      </td>
                      <td>{v.alleles}</td>
                      <td>{v.score.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <a href="/batch">← Zurück zur Übersicht</a>
    </div>
  );
}
