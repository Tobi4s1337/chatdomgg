#!/usr/bin/env bash
# Run only through chatdom-pc-lease; that lease owns 5192 and cleans up its process group.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
mkdir -p work/evidence/gather
nice -n 10 pnpm --filter @chatdom/web exec vite preview --host 127.0.0.1 --port 5192 --strictPort > /tmp/chatdom-gather-gpu-preview.log 2>&1 &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true' EXIT
for attempt in {1..40}; do
  if curl --silent --fail http://127.0.0.1:5192/ > /dev/null; then break; fi
  sleep .25
done
chatdom-pc shot 'http://localhost:5192/-/tavern?view=room&still=1&hour=19' work/evidence/gather/ga10-room-gpu@1440x900.png --size 1440x900
chatdom-pc shot 'http://localhost:5192/-/tavern?view=room&still=1&hour=19' work/evidence/gather/ga10-room-gpu@390x844.png --size 390x844
chatdom-pc shot 'http://localhost:5192/-/tavern?view=table&still=1&hour=19' work/evidence/gather/ga10-table-gpu@1440x900.png --size 1440x900
chatdom-pc fps 'http://localhost:5192/-/tavern?view=room&hour=19' --seconds 5 --size 1440x900 > work/evidence/gather/ga10-empty-room-fps.json
