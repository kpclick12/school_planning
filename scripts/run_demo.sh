#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="$ROOT/.venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

if [ ! -f "$ROOT/data/data.db" ]; then
  echo "No data/data.db found. Building now..."
  "$PYTHON_BIN" "$ROOT/scripts/build_db.py"
fi

exec "$PYTHON_BIN" "$ROOT/app/server.py"
