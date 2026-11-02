#!/usr/bin/env bash
# The lane's realm behind a leased stream page: schema pier, fishing on, Willowmere's approved entry name, and the
# founded directory of the own-stack run (work/lanes/pier/e2e/run.sh makes it). Loads DATABASE_URL from the operator
# environment file without echoing it. Usage: work/lanes/pier/e2e/stream-realm.sh <port in 5170-5186>
# Stop it afterwards by the pid listening on that port.
set -euo pipefail
port="${1:?a free port in 5170-5186}"
if (( port < 5170 || port > 5186 )); then echo "Use a lane port in 5170-5186." >&2; exit 2; fi
if ss -ltn | grep -q ":$port "; then echo "Port $port is in use." >&2; exit 2; fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
env_file="${PIER_E2E_ENV_FILE:-/srv/chatdom/chatdomgg/.env}"
founded="${PIER_E2E_STACK:-/tmp/chatdom-pier-stack}/founded"
set -a; . "$env_file"; set +a
cd "$root"
REALM_DATABASE_SCHEMA=pier nice -n 10 node apps/realm/scripts/migrate.mjs --schema pier >/dev/null
cd apps/realm
exec env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 DATABASE_URL="$DATABASE_URL" REALM_DATABASE_SCHEMA=pier \
  REALM_SIMULATED=1 REALM_STORAGE=postgres REALM_PIER_FISHING=1 REALM_FOUNDED_DIRECTORY="$founded" \
  REALM_PORT="$port" REALM_HOST=127.0.0.1 REALM_ENTRY_KINGDOM_ID=129634568 REALM_ENTRY_KINGDOM_NAME=Willowmere \
  REALM_EVIDENCE_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  nice -n 10 node dist/realm.mjs
