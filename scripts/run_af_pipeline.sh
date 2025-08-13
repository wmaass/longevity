#!/usr/bin/env bash
set -euo pipefail

SAMPLE_FILE="/Users/woma01-admin/Documents/Github/longevity/eur_samples.txt"
VCF_DIR="/Users/woma01-admin/Documents/Github/longevity/af_tmp"
OUT_DIR="$HOME/af_results_out"

mkdir -p "$OUT_DIR"

have_pv() { command -v pv >/dev/null 2>&1; }

process_vcf () {
  local vcf="$1"
  local chr
  chr=$(basename "$vcf" | grep -oE 'chr([0-9]{1,2}|X|Y|M)\b' | sed 's/^chr//') || true
  [[ -n "${chr:-}" ]] || { echo "❌ Could not parse chromosome from: $vcf" >&2; return 1; }
  local out="$OUT_DIR/eur_af_chr${chr}.tsv"

  echo "▶ chr${chr}: $(date '+%H:%M:%S')  [$vcf]"

  # Input stream (prefer pv if present)
  if have_pv; then
    (stat -c%z "$vcf" 2>/dev/null || stat -f%z "$vcf") >/dev/null 2>&1 && \
      pv -pte -N "chr${chr} read" "$vcf" || cat "$vcf"
  else
    cat "$vcf"
  fi \
  | bcftools view -Ou ${SAMPLE_FILE:+-S "$SAMPLE_FILE"} -m2 -M2 -v snps - \
  | bcftools +fill-tags -Ou -- -t AF \
  | { have_pv && pv -pte -N "chr${chr} query" || cat; } \
  | bcftools query -f '%ID\t%REF\t%ALT\t%AF\n' \
  | awk 'BEGIN{
           OFS="\t"; print "rsid","A","C","G","T"; n=0
         }
         $1!="." && length($2)==1 && length($3)==1 {
           ref=$2; alt=$3; af=$4+0;
           pA=pC=pG=pT=0;
           if(ref=="A") pA=1-af; else if(ref=="C") pC=1-af; else if(ref=="G") pG=1-af; else if(ref=="T") pT=1-af;
           if(alt=="A") pA+=af;  else if(alt=="C") pC+=af;  else if(alt=="G") pG+=af;  else if(alt=="T") pT+=af;
           print $1,pA,pC,pG,pT;
           n++; if(n%1000000==0) printf("chr'"$chr"' processed %d variants\n", n) > "/dev/stderr"
         }
         END{ printf("chr'"$chr"' done, %d variants\n", n) > "/dev/stderr" }' \
  > "$out"

  # Minimal validation
  [[ -s "$out" ]] || { echo "❌ $out missing/empty" >&2; return 1; }
  head -n1 "$out" | grep -qx $'rsid\tA\tC\tG\tT' || echo "⚠️ Unexpected header in $out" >&2
  echo "✅ $out -> $(($(wc -l < "$out")-1)) rows"
}

# Warn if sample list is missing, and continue without -S
if [[ ! -r "$SAMPLE_FILE" ]]; then
  echo "⚠️  SAMPLE_FILE not readable: $SAMPLE_FILE — proceeding with ALL samples." >&2
  unset SAMPLE_FILE
fi

shopt -s nullglob
vcfs=("$VCF_DIR"/ALL.chr*.vcf.gz)
(( ${#vcfs[@]} > 0 )) || { echo "❌ No ALL.chr*.vcf.gz in $VCF_DIR" >&2; exit 1; }

for v in "${vcfs[@]}"; do
  process_vcf "$v"
done

echo "🎉 Completed. Outputs in $OUT_DIR"
