#!/bin/bash
# usage: [BASE=http://127.0.0.1:5173/] shot.sh <hash> <outfile> [budget_ms] [w] [h]
H="$1"; OUT="$2"; B="${3:-10000}"; W="${4:-1920}"; HH="${5:-1080}"
BASE="${BASE:-http://127.0.0.1:5173/}"
PROF=$(mktemp -d)
timeout 180 google-chrome --headless=new --no-sandbox --disable-dev-shm-usage \
  --user-data-dir="$PROF" --hide-scrollbars --ignore-certificate-errors \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --force-device-scale-factor=1 --window-size="$W,$HH" --screenshot="$OUT" \
  --virtual-time-budget="$B" "${BASE}${H}" >/dev/null 2>&1
rm -rf "$PROF"
ls -la "$OUT"
