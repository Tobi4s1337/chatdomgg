#!/usr/bin/env bash
# PI10 end-to-end run on the lane's own stack. Loads DATABASE_URL from the operator environment file without
# echoing it, pins the lane's own schema, and runs the check niced. Usage: work/lanes/pier/e2e/run.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
env_file="${PIER_E2E_ENV_FILE:-/srv/chatdom/chatdomgg/.env}"
if [[ ! -r "$env_file" ]]; then echo "The environment file is not readable: set PIER_E2E_ENV_FILE." >&2; exit 2; fi
set -a; . "$env_file"; set +a
# That file names another schema; this lane only ever uses its own.
export REALM_DATABASE_SCHEMA=pier
cd "$root"
exec nice -n 10 node work/lanes/pier/e2e/pi10-e2e.mjs "$@"
