'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function EFODetailPage() {
  const router = useRouter();
  const { efoId } = router.query;

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!efoId) return;

    fetch(`/details/${efoId}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`Keine Detaildaten für ${efoId}`);
        return res.json();
      })
      .then(json => {
        setResults(json);
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
                {res.topVariants.slice(0, 10).map((v, i) => (
                  <tr key={i} style={{ color: Math.abs(v.score) > 0.2 ? 'red' : Math.abs(v.score) > 0.1 ? 'orange' : 'green' }}>
                    <td>{i + 1}</td>
                    <td>{v.variant}</td>
                    <td>{v.rsid 
                      ? <a href={`https://www.ncbi.nlm.nih.gov/snp/${v.rsid}`} target="_blank">{v.rsid}</a> 
                      : '-'}</td>
                    <td>{v.alleles}</td>
                    <td>{v.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <a href="/batch">← Zurück zur Übersicht</a>
    </div>
  );
}
