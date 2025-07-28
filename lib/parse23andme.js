// Parser für 23andMe-Textdateien – lauffähig im Browser (kein fs)
export function parse23andMe(fileContent) {
  const lines = fileContent.split(/\r?\n/).filter(l => l && !l.startsWith('#'));

  return lines.map((line, idx) => {
    const [rsid, chrom, pos, genotype] = line.split(/\t/);
    return {
      rsid: rsid || `var_${idx}`,
      chrom: chrom.replace(/^chr/i, ''), // "chr1" -> "1"
      pos: parseInt(pos, 10),
      genotype: genotype?.toUpperCase() || '--'
    };
  });
}
