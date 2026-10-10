#!/usr/bin/env bash
# Downloads OpenArena 0.8.8 (once) and builds the trimmed browser content into build/content.
set -euo pipefail
cd "$(dirname "$0")/.."
DL=content/download
mkdir -p "$DL"
if [ ! -d "$DL/extracted/openarena-0.8.8/baseoa" ]; then
  curl -L -o "$DL/openarena-0.8.8.zip" https://download.tuxfamily.org/openarena/rel/088/openarena-0.8.8.zip
  unzip -q -o "$DL/openarena-0.8.8.zip" -d "$DL/extracted"
fi
rm -rf build/content
python3 -I content/build_content.py "$DL/extracted/openarena-0.8.8/baseoa" build/content
# Browsers can't show TGA; convert levelshots to JPG.
for f in build/content/levelshots/*; do
  case "$f" in
    *.jpg) ;;
    *) out="${f%.*}.jpg"
       if command -v sips >/dev/null; then sips -s format jpeg "$f" --out "$out" >/dev/null
       else convert "$f" "$out"; fi
       rm "$f" ;;
  esac
done
ls -la build/content/baseoa build/content/levelshots
