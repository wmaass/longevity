// components/SnpSummary.tsx
import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';

export default function SnpSummary({ rsid }: { rsid: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/snp-summary?rsid=${encodeURIComponent(rsid)}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, [rsid]);

  if (!data) return null;

  return (
    <div>
      <h2>Zusammenfassung für {rsid}</h2>
      {data.url && (
        <p>
          <a href={data.url} target="_blank" rel="noreferrer">Zur Publikation</a>
        </p>
      )}
      <div
        className="prose" // (optional) Tailwind Typography for nice styles
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(data.html || data.text) }}
      />
    </div>
  );
}
