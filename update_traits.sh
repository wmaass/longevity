#!/bin/bash
OUTPUT="public/traits.json"
URL="https://www.pgscatalog.org/rest/trait_efo?limit=200"

echo "Lade Traits vom PGS Catalog..."
RESPONSE=$(curl -s "$URL")

# Prüfen, ob die Antwort JSON ist
if ! echo "$RESPONSE" | jq empty >/dev/null 2>&1; then
  echo "Fehler: Die API-Antwort ist kein gültiges JSON. Antwort war:"
  echo "$RESPONSE"
  exit 1
fi

echo "$RESPONSE" | jq '[.results[] 
      | select(.trait_category == "Disease" and .count_pgs > 0)
      | {id: .id, label: .label, count_pgs: .count_pgs}
     ] | sort_by(-.count_pgs) | .[0:20]' > "$OUTPUT"

echo "Fertige Traits-Datei erstellt: $OUTPUT"
