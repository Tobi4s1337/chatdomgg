#!/usr/bin/env bash
# The Atlas service chatdom.io reads, run from a built checkout of this package (SEAMS.md "deploy:").
#
#   atlas-live.sh seed      copy the live data read-only into ATLAS_DATA_DIR, draw this build's preview, check it,
#                           publish the first live wash frame (safe to run again: copies only what is missing)
#   atlas-live.sh serve     the public service on ATLAS_HOST:ATLAS_PORT, restarted 10 s after it exits (a loop)
#   atlas-live.sh wash      the live producer: wash, live cards, the finder's live check (a loop)
#   atlas-live.sh refresh   the 6-hourly import from the collector, read-only (a loop)
#   atlas-live.sh health [base]   exits 0 only when the service answers, its register is warm and an unseen
#                           channel (ATLAS_HEALTH_LOGIN, default tobi4s_) is found and placed the same way by search
#                           and card; base defaults to http://ATLAS_HOST:ATLAS_PORT, give https://chatdom.io after the switch
#
# Every default below can be overridden from the environment. Nothing here writes to the collector or to Twitch, and
# nothing touches the old service, its worktree or its data (ATLAS_SEED_FROM is only read).
set -euo pipefail

PKG=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ATLAS_DATA_DIR=${ATLAS_DATA_DIR:-/srv/chatdom/data/atlas}
ATLAS_SEED_FROM=${ATLAS_SEED_FROM:-/srv/chatdom/atlas/apps/surveyor/shots/atlas-data}
ATLAS_HOST=${ATLAS_HOST:-127.0.0.1}
ATLAS_PORT=${ATLAS_PORT:-5200}
ATLAS_ENV_FILE=${ATLAS_ENV_FILE:-$HOME/.config/chatdom/atlas.env}
ATLAS_LOG_DIR=${ATLAS_LOG_DIR:-/srv/chatdom/ops/state}
ATLAS_LOOKUPS_PER_CLIENT_MINUTE=${ATLAS_LOOKUPS_PER_CLIENT_MINUTE:-60}
ATLAS_LIVE_INTERVAL_MS=${ATLAS_LIVE_INTERVAL_MS:-60000}
ATLAS_REFRESH_H=${ATLAS_REFRESH_H:-6}
SURVEYOR_BASE_URL=${SURVEYOR_BASE_URL:-http://172.17.0.1:3541/atlas/api/}
SURVEYOR_DB_PATH=${SURVEYOR_DB_PATH:-/srv/chatdom-atlas/data/surveyor.db}
export ATLAS_DATA_DIR SURVEYOR_BASE_URL SURVEYOR_DB_PATH

ATLAS="$PKG/dist/atlas.mjs"
CPU=(taskset -c 0-8 nice -n 10)
NODE=(node --disable-warning=ExperimentalWarning)

stamp() { date '+%F %T'; }
say() { echo "atlas-live: $*" >&2; }
die() { say "$*"; exit 1; }

# The Twitch app credentials, for the search fallback and the nightly settlement. Without the file the service still
# answers from the survey and says plainly that a name is not on the map yet.
twitch_env() {
  if [ -r "$ATLAS_ENV_FILE" ]; then
    printf '%s\n' "--env-file=$ATLAS_ENV_FILE"
  else
    say "no readable $ATLAS_ENV_FILE: search answers from the survey only"
  fi
}

need_build() {
  [ -f "$ATLAS" ] || die "no $ATLAS: run 'pnpm --filter @chatdom/surveyor build' in this checkout first"
}

seed() {
  need_build
  local from=$ATLAS_SEED_FROM to=$ATLAS_DATA_DIR
  [ -f "$from/current.json" ] || die "no $from/current.json to seed from"
  case "$(realpath -m "$to")/" in "$(realpath -m "$from")/"*) die "ATLAS_DATA_DIR must not be inside ATLAS_SEED_FROM" ;; esac
  case "$(realpath -m "$from")/" in "$(realpath -m "$to")/"*) die "ATLAS_SEED_FROM must not be inside ATLAS_DATA_DIR" ;; esac
  mkdir -p "$to/revisions" "$to/ledger"
  if [ -f "$to/current.json" ]; then
    say "already seeded ($(node -p "require('$to/current.json').revision")); copying nothing"
  else
    local rev
    rev=$(node -p "require('$from/current.json').revision")
    [ -d "$from/revisions/$rev" ] || die "the seed's current revision $rev is missing"
    # A revision directory only ever appears whole (copied under .partial, then renamed), so one that exists is
    # complete: a seed interrupted after the rename and before the pointer resumes here without copying it again.
    if [ -d "$to/revisions/$rev" ]; then
      say "revision $rev already copied"
    else
      say "copying revision $rev read-only"
      rm -rf "$to/revisions/$rev.partial"
      nice -n 10 ionice -c3 cp -a "$from/revisions/$rev" "$to/revisions/$rev.partial"
      mv -T "$to/revisions/$rev.partial" "$to/revisions/$rev"
    fi
    cp -a "$from/ledger/imports.ndjson" "$to/ledger/"
    if [ -d "$from/moderation" ]; then cp -a "$from/moderation" "$to/"; fi   # the operator's withheld list
    cp -a "$from/current.json" "$to/current.json.partial"
    mv "$to/current.json.partial" "$to/current.json"   # last, so the pointer never names a missing revision
  fi
  cd "$PKG"
  "${CPU[@]}" "${NODE[@]}" "$ATLAS" preview   # this build's own preview (language names, codes-only artifacts)
  "${CPU[@]}" "${NODE[@]}" "$ATLAS" check     # ends "verified: …", or fails the seed
  "${CPU[@]}" "${NODE[@]}" "$ATLAS" live --once || say "first live frame not published (the wash loop will retry)"
  say "seeded $to"
}

serve() {
  need_build
  [ -f "$ATLAS_DATA_DIR/current.json" ] || die "$ATLAS_DATA_DIR is not seeded: run '$0 seed' first"
  mkdir -p "$ATLAS_LOG_DIR"
  local log="$ATLAS_LOG_DIR/atlas-live.log" envfile
  cd "$PKG"
  while true; do
    envfile=$(twitch_env 2>>"$log")
    echo "$(stamp) serve $ATLAS_HOST:$ATLAS_PORT from $ATLAS_DATA_DIR" >>"$log"
    set +e
    ATLAS_HOST=$ATLAS_HOST ATLAS_PORT=$ATLAS_PORT ATLAS_TRUST_LOOPBACK_PROXY=1 \
      ATLAS_LOOKUPS_PER_CLIENT_MINUTE=$ATLAS_LOOKUPS_PER_CLIENT_MINUTE \
      "${CPU[@]}" node ${envfile:+"$envfile"} --disable-warning=ExperimentalWarning "$ATLAS" serve >>"$log" 2>&1
    echo "$(stamp) exit $?" >>"$log"
    set -e
    sleep 10
  done
}

wash() {
  need_build
  mkdir -p "$ATLAS_LOG_DIR"
  local log="$ATLAS_LOG_DIR/atlas-live-wash.log"
  cd "$PKG"
  while true; do
    set +e
    ATLAS_LIVE_INTERVAL_MS=$ATLAS_LIVE_INTERVAL_MS "${CPU[@]}" "${NODE[@]}" "$ATLAS" live >>"$log" 2>&1
    echo "$(stamp) exit $?" >>"$log"
    set -e
    sleep 30
  done
}

refresh() {
  need_build
  mkdir -p "$ATLAS_LOG_DIR"
  local log="$ATLAS_LOG_DIR/atlas-live-refresh.log" envfile
  cd "$PKG"
  while true; do
    sleep $((ATLAS_REFRESH_H * 3600))
    envfile=$(twitch_env 2>>"$log")
    echo "$(stamp) import" >>"$log"
    set +e
    SURVEYOR_HTTP_TIMEOUT_MS=60000 timeout 1800 "${CPU[@]}" node ${envfile:+"$envfile"} \
      --disable-warning=ExperimentalWarning "$ATLAS" import >>"$log" 2>&1
    echo "$(stamp) exit $?" >>"$log"
    set -e
  done
}

health() {
  exec node "$PKG/scripts/atlas-live-health.mjs" "${1:-http://$ATLAS_HOST:$ATLAS_PORT}"
}

case "${1:-}" in
  seed) seed ;;
  serve) serve ;;
  wash) wash ;;
  refresh) refresh ;;
  health) health "${2:-}" ;;
  *) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac
