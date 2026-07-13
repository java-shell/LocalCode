#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=./llm-ide/src/backend/turbovec_memory
BRIDGE=./llm-ide/src/backend/turbovec_bridge.py
NAMESPACE=stackoverflow
INPUT_DIR=/home/dan/extra/stackexchange/stackexchange/stackoverflow

for FILE in "$INPUT_DIR"/qa_pairs_full-000*.jsonl; do
  echo "=== Ingesting $FILE ==="
  node namespace_creator/ingest.js \
    --input "$FILE" \
    --namespace "$NAMESPACE" \
    --rootDir "$ROOT_DIR" \
    --bridgeScriptPath "$BRIDGE"
done

echo ""
echo "=== Ingestion complete ==="
