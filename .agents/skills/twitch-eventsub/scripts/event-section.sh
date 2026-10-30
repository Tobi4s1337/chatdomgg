#!/usr/bin/env bash
# Print everything the official docs say about ONE EventSub subscription type:
#   1) its full section from references/official/eventsub_eventsub-subscription-types.md
#      (description, authorization, request body, webhook example, notification example)
#   2) its event payload field table from references/event-objects.md (generated from the EventSub Reference)
#
# Usage: scripts/event-section.sh <type> [version] [--fields-only|--section-only]
#   scripts/event-section.sh channel.follow
#   scripts/event-section.sh channel.moderate 2
#   scripts/event-section.sh channel.chat.message --fields-only
# Version defaults to the highest version listed. `scripts/event-section.sh --list` lists all type+versions.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REFS="$HERE/../references"
JSON="$REFS/subscription-types.json"
MD="$REFS/official/eventsub_eventsub-subscription-types.md"
OBJ="$REFS/event-objects.md"

if [ "${1:-}" = "--list" ]; then
  node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))) console.log(`${s.type}\tv${s.version}\t${s.status}`)' "$JSON"
  exit 0
fi
[ $# -ge 1 ] || { sed -n '2,12p' "$0"; exit 1; }
TYPE="$1"; shift
VERSION=""; MODE="all"
for a in "$@"; do
  case "$a" in
    --fields-only) MODE=fields ;;
    --section-only) MODE=section ;;
    *) VERSION="${a#v}" ;;
  esac
done

# Resolve anchor + event ref from the generated JSON (highest numeric version unless one was given).
read -r ANCHOR EVREF VER < <(node -e '
  const [file, type, ver] = process.argv.slice(1);
  const all = JSON.parse(require("fs").readFileSync(file, "utf8")).filter((s) => s.type === type);
  if (!all.length) { console.error(`unknown type: ${type} (try --list)`); process.exit(2); }
  const pick = ver ? all.find((s) => s.version === ver) : all.sort((a, b) => (parseInt(b.version) || 0) - (parseInt(a.version) || 0))[0];
  if (!pick) { console.error(`no version ${ver} of ${type}; have: ${all.map((s) => s.version).join(", ")}`); process.exit(2); }
  console.log(pick.anchor, pick.eventRef ?? "-", pick.version);
' "$JSON" "$TYPE" "$VERSION")

if [ "$MODE" != fields ]; then
  echo "=============== $TYPE v$VER — official section (#$ANCHOR) ==============="
  awk -v a="{#$ANCHOR}" '
    index($0, a) && /^### / { p = 1; print; next }
    p && (/^## / || /^### [a-z_]+(\.[a-z_]+)+( [vV][0-9]+)?  \{#/) { exit }
    p { print }
  ' "$MD"
fi
if [ "$MODE" != section ] && [ "$EVREF" != "-" ]; then
  echo
  echo "=============== event payload fields (event-objects.md #$EVREF) ==============="
  awk -v a="{#$EVREF}" '
    index($0, a) && /^##/ { p = 1; print; next }
    p && /^##/ { exit }
    p { print }
  ' "$OBJ"
fi
