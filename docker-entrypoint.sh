#!/bin/sh
set -e

export PORT="${PORT:-3000}"

export HR_API_BASE_URL="${HR_API_BASE_URL:-http://127.0.0.1:${PORT}/mock/v1}"

INDEX="${INDEX_PATH:-./eval/index-snapshot.json}"

if [ ! -f "$INDEX" ]; then
  echo "FATAL: vector index not found at $INDEX" >&2
  echo "" >&2
  echo "The service would start green and refuse every policy question," >&2
  echo "which looks like a working deployment and is not one." >&2
  echo "" >&2
  echo "Generate it with 'npm run ingest' and rebuild, or mount it at $INDEX." >&2
  exit 1
fi

echo "starting on port ${PORT} · hr api at ${HR_API_BASE_URL} · index ${INDEX}"

exec "$@"
