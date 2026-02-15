#!/usr/bin/env bash
set -euo pipefail

for p in 8010 8080; do
  pids=$(lsof -ti tcp:$p || true)
  if [ -n "$pids" ]; then
    kill -9 $pids || true
  fi
done

rm -f /tmp/planing_schools/app.pid /tmp/planing_schools/proxy.pid

echo "Stopped services on ports 8010 and 8080"
