#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4173}"
HOST="${HOST:-127.0.0.1}"

echo "Serving Before/After at http://${HOST}:${PORT}/"
echo "Press Ctrl-C to stop."

python3 -m http.server "$PORT" --bind "$HOST"
