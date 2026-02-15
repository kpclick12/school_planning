#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p /tmp/planing_schools

# Stop old listeners if any
for p in 8010 8080; do
  pids=$(lsof -ti tcp:$p || true)
  if [ -n "$pids" ]; then
    kill -9 $pids || true
  fi
done

# Start app
nohup env HOST=0.0.0.0 PORT=8010 "$ROOT/.venv/bin/python" "$ROOT/app/server.py" > /tmp/planing_schools/app.log 2>&1 &
echo $! > /tmp/planing_schools/app.pid

# Start tile proxy
nohup npm --prefix "$ROOT/tile-proxy" start > /tmp/planing_schools/proxy.log 2>&1 &
echo $! > /tmp/planing_schools/proxy.pid

sleep 1

echo "App URL: http://localhost:8010"
echo "Proxy URL: http://localhost:8080/tiles/{z}/{x}/{y}.png"
echo "App log: /tmp/planing_schools/app.log"
echo "Proxy log: /tmp/planing_schools/proxy.log"
