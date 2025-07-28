import fetch from 'node-fetch';

export async function fetchPublicationsForStroke() {
  const url = `https://www.ebi.ac.uk/gwas/rest/api/search?q=stroke`;
  const res = await fetch(url);
  const data = await res.json();

  return (data._embedded?.associations || [])
    .slice(0, 3)
    .map(a => ({
      pubmedId: a.study.pubmedId,
      title: a.study.title
    }));
}
