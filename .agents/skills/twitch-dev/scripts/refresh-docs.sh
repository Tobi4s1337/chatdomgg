#!/usr/bin/env bash
# Re-download the official dev.twitch.tv docs and refresh the references/official/
# snapshots in every twitch-* skill, then regenerate derived tables (scopes).
# Needs: curl, python3 + bs4 (pip install beautifulsoup4); node >= 22.18 for the generators.
# Usage: bash refresh-docs.sh                    (run from anywhere)
#        TWITCH_SKILLS_DIR=/tmp/x bash refresh-docs.sh   (write into another suite root, e.g. to test)
# Afterwards: read the top of twitch-dev/references/official/change-log.md for what changed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILLS="${TWITCH_SKILLS_DIR:-$(cd "$HERE/../.." && pwd -P)}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/html"

PAGES=(
  authentication authentication/register-app authentication/getting-tokens-oauth
  authentication/getting-tokens-oidc authentication/refresh-tokens authentication/revoke-tokens
  authentication/scopes authentication/validate-tokens change-log product-lifecycle
  cli cli/configure-command cli/token-command cli/api-command cli/event-command
  cli/websocket-event-command cli/mock-api-command
  embed embed/everything embed/chat embed/video-and-clips insights
  api api/get-started api/guide api/reference api/clips api/goals api/markers api/moderation
  api/polls api/predictions api/raids api/schedule api/videos
  eventsub eventsub/eventsub-reference eventsub/eventsub-subscription-types eventsub/handling-conduit-events
  eventsub/handling-webhook-events eventsub/handling-websocket-events eventsub/manage-subscriptions
  eventsub/websocket-reference
  chat chat/authenticating chat/chatbot-guide chat/irc chat/irc-migration chat/moderation
  chat/send-receive-messages chat/whispers
  extensions extensions/a-b-testing-in-extensions extensions/building extensions/designing
  extensions/frontend-api-usage extensions/guidelines-and-policies extensions/increasing-feedback
  extensions/life-cycle extensions/load-testing-extensions extensions/monetization
  extensions/monetization-strategies extensions/reference extensions/required-technical-background
  extensions/submission-best-practices extensions/using-google-analytics-in-extensions
)
for t in introduction create-extension file-structure jwt config-service build-backend local-test; do
  PAGES+=("tutorials/extension-101-tutorial-series/$t")
done

fail=0
for p in "${PAGES[@]}"; do
  f="$WORK/html/$(echo "$p" | tr / _).html"
  code=$(curl -sSL --retry 2 -o "$f" -w '%{http_code}' "https://dev.twitch.tv/docs/$p/" || echo 000)
  if [ "$code" != 200 ] || grep -q AccessDenied "$f"; then echo "skip $p ($code)" >&2; rm -f "$f"; fail=$((fail+1)); fi
done
[ "$fail" -gt 10 ] && { echo "Too many failed downloads ($fail) - not touching the snapshots." >&2; exit 1; }

python3 -I "$HERE/h2md.py" "$WORK/html" "$WORK/md"
for f in "$WORK"/md/*.md; do sed -i 's/[ \t]*$//' "$f"; cat -s "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done

dest() { mkdir -p "$SKILLS/$1/references/official"; cp "$WORK"/md/$2 "$SKILLS/$1/references/official/" 2>/dev/null || true; }
dest twitch-dev 'authentication*.md'; dest twitch-dev change-log.md; dest twitch-dev product-lifecycle.md
dest twitch-dev 'cli*.md'; dest twitch-dev 'embed*.md'; dest twitch-dev insights.md;
dest twitch-api 'api*.md'
dest twitch-eventsub 'eventsub*.md'
dest twitch-chat 'chat*.md'
dest twitch-extensions 'extensions*.md'; dest twitch-extensions 'tutorials*.md'
date -u +%F > "$SKILLS/twitch-dev/references/official/FETCHED_ON"

# Regenerate derived tables from the fresh snapshot (missing generators are skipped).
# twitch-chat's gen-chat-eventsub-index.py prints to stdout for manual review, so it's not run here.
gen() { [ -e "$SKILLS/$2" ] || return 0; echo "regenerating: $2"; "$1" "$SKILLS/$2" "${@:3}" || echo "WARN: $2 failed - check whether the page format changed" >&2; }
gen node twitch-dev/scripts/gen-scopes.ts
gen node twitch-eventsub/scripts/gen-subscription-types.ts --html-dir "$WORK/html"
gen node twitch-extensions/scripts/gen-extension-endpoints.ts
gen python3 twitch-api/scripts/gen-endpoints.py
echo "Docs refreshed into $SKILLS/twitch-*/references/official ($fail page(s) skipped). Check change-log.md for what changed."
