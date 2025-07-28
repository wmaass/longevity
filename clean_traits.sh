#!/bin/bash
# clean_traits.sh
# Bereinigt traits.json: entfernt alle GO_* IDs und behält nur EFO_* Einträge

INPUT="traits.json"
OUTPUT="traits_clean.json"

if [ ! -f "$INPUT" ]; then
  echo "Fehler: $INPUT nicht gefunden!"
  exit 1
fi

# Mit jq nur Einträge behalten, deren id mit EFO_ beginnt
jq '[.[] | select(.id | startswith("EFO_"))]' "$INPUT" > "$OUTPUT"

echo "Bereinigt: $OUTPUT erstellt (nur EFO_ IDs)"
