#!/usr/bin/env bash
# DEV TOOL: copy a just-downloaded generated image (matched by exact byte size) into gen/raw.
#   apps/web/scripts/grab-download.sh <bytes> <name.png>
set -euo pipefail
size="$1"; name="$2"
dl="$HOME/Downloads"
raw="$(dirname "$0")/../art-src/raw"
for i in $(seq 1 20); do
  for f in "$dl"/*; do
    [ -f "$f" ] || continue
    if [ "$(stat -c %s "$f")" = "$size" ]; then cp "$f" "$raw/$name"; echo "copied $(basename "$f") -> $name"; exit 0; fi
  done
  sleep 1
done
echo "no download of $size bytes found" >&2; exit 1
