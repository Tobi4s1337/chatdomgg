#!/usr/bin/env bash
# Builds the Atlas web fonts (WOFF2 subsets) from the google/fonts repository at a pinned commit.
#
#   bash apps/surveyor/tools/build-atlas-fonts.sh [out-dir]
#
# Downloads go to /tmp/chatdom-refs/google-fonts-<sha>/ (never into the repo). Outputs and each family's OFL.txt go
# to out-dir (default: apps/web/src/atlas/assets/fonts). Needs curl and uv.
set -euo pipefail

SHA=6157dfaa640ca5738b4d1a7070fe389c3036d7fc   # google/fonts main, 2026-10-29
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="${1:-$REPO_ROOT/apps/web/src/atlas/assets/fonts}"
SRC="/tmp/chatdom-refs/google-fonts-$SHA"
RAW="https://raw.githubusercontent.com/google/fonts/$SHA/ofl"

# Unicode ranges as published by the Google Fonts CSS API for each subset.
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT="U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
CYRILLIC="U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"
CYRILLIC_EXT="U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F"
GREEK="U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF"

fetch() { # <ofl path> -> $SRC/<ofl path>
  local dest="$SRC/$1"
  [ -s "$dest" ] && return 0
  mkdir -p "$(dirname "$dest")"
  local enc; enc="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1")"
  curl -sfL --retry 2 -o "$dest" "$RAW/$enc"
}

for f in imfellenglish/IMFeENrm28P.ttf imfellenglish/IMFeENit28P.ttf imfellenglish/OFL.txt \
         imfellenglishsc/IMFeENsc28P.ttf imfellenglishsc/OFL.txt \
         "alegreya/Alegreya[wght].ttf" "alegreya/Alegreya-Italic[wght].ttf" alegreya/OFL.txt; do
  fetch "$f"
done

mkdir -p "$OUT"
subset() { # <src ttf> <out woff2> <unicodes> [extra args...]
  local src="$1" out="$2" uni="$3"; shift 3
  uv run -q --with fonttools --with brotli pyftsubset "$src" --output-file="$out" --flavor=woff2 \
    --unicodes="$uni" --layout-features+=kern,liga --no-hinting --desubroutinize --name-IDs='*' "$@"
}

# IM Fell English (display, labels): latin + latin-ext. Legacy 'kern' table is kept (the fonts have no GPOS).
IMFELL_UNI="$LATIN,$LATIN_EXT"
subset "$SRC/imfellenglish/IMFeENrm28P.ttf"   "$OUT/im-fell-english-regular.woff2" "$IMFELL_UNI" --layout-features+=dlig,hist
subset "$SRC/imfellenglish/IMFeENit28P.ttf"   "$OUT/im-fell-english-italic.woff2"  "$IMFELL_UNI" --layout-features+=dlig,hist
subset "$SRC/imfellenglishsc/IMFeENsc28P.ttf" "$OUT/im-fell-english-sc.woff2"      "$IMFELL_UNI"

# Alegreya (text): variable wght 400-900 kept. Split per script so a browser only fetches what a page renders
# (declare each file with its unicode-range in @font-face).
ALEG_FEATS="--layout-features+=smcp,c2sc,onum,lnum,tnum,pnum"
for style in roman italic; do
  if [ "$style" = roman ]; then src="$SRC/alegreya/Alegreya[wght].ttf"; else src="$SRC/alegreya/Alegreya-Italic[wght].ttf"; fi
  subset "$src" "$OUT/alegreya-$style-latin.woff2"    "$LATIN,$LATIN_EXT"        $ALEG_FEATS
  subset "$src" "$OUT/alegreya-$style-cyrillic.woff2" "$CYRILLIC,$CYRILLIC_EXT"  $ALEG_FEATS
  subset "$src" "$OUT/alegreya-$style-greek.woff2"    "$GREEK"                   $ALEG_FEATS
done

cp "$SRC/imfellenglish/OFL.txt"   "$OUT/OFL-IMFellEnglish.txt"
cp "$SRC/imfellenglishsc/OFL.txt" "$OUT/OFL-IMFellEnglishSC.txt"
cp "$SRC/alegreya/OFL.txt"        "$OUT/OFL-Alegreya.txt"

ls -l "$OUT"
