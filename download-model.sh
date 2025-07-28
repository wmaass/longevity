#!/bin/bash
set -e

MODEL_DIR="./models"
MODEL_FILE="mistral-7b-instruct-v0.2.Q4_K_M.gguf"

echo "==> Erstelle Verzeichnisse..."
mkdir -p "$MODEL_DIR"

if [ ! -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "==> Lade Mistral 7B (quantisiert, GGUF)..."
  curl -L -o "$MODEL_DIR/$MODEL_FILE" \
    "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/$MODEL_FILE"
else
  echo "==> Modell bereits vorhanden."
fi

echo "Setup abgeschlossen."
