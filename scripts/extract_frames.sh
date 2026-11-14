#!/bin/sh
# AI-assisted (Anthropic Claude). Extracts one frame per year from NASA SVS 5603
# (GISTEMP_2025_equirectangular_2048p.mp4) using GISTEMPtime.txt, which lists the year of every frame.
# Output: data/frames/<year>.png at 720x360, the middle frame of each year's run.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
awk '{y=$1; if(!(y in s)){s[y]=NR-1; o[++k]=y} e[y]=NR-1} END{for(i=1;i<=k;i++){y=o[i]; print y, int((s[y]+e[y])/2)}}' \
  data/raw/GISTEMPtime.txt > data/frames/year_frame.txt
ffmpeg -v error -i data/raw/GISTEMP_2025_equirectangular_2048p.mp4 -vf "scale=720:360:flags=area" -start_number 0 "$TMP/f_%04d.png"
while read y f; do cp "$TMP/$(printf 'f_%04d' "$f").png" "data/frames/$y.png"; done < data/frames/year_frame.txt
rm -rf "$TMP"

# Pure-color copies at 1440x720 (nearest neighbour, no blending of coastlines into colors),
# used by scripts/build-temperature.mjs to read values.
mkdir -p data/frames_px
TMP=$(mktemp -d)
ffmpeg -v error -i data/raw/GISTEMP_2025_equirectangular_2048p.mp4 -vf "scale=1440:720:flags=neighbor" -start_number 0 "$TMP/f_%04d.png"
while read y f; do cp "$TMP/$(printf 'f_%04d' "$f").png" "data/frames_px/$y.png"; done < data/frames/year_frame.txt
rm -rf "$TMP"
