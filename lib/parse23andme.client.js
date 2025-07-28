// parse23andme.client.js
export function parse23andMe(text) {
  const rows = text.split(/[\r\n]+/);
  const variants = [];

  for (const line of rows) {
    if (!line || line.startsWith('#')) continue;
    const [rsid, chrom, pos, genotype] = line.split('\t');
    if (rsid && chrom && pos && genotype) {
      variants.push({ rsid, chrom, pos: parseInt(pos, 10), genotype });
    }
  }

  return variants;
}
