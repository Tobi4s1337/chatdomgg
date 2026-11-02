#!/bin/bash
# GW15 stills on Tobias's RTX 5080. Run only inside chatdom-pc-lease from the worktree root, after a niced
# `vite build` of apps/web. Serves this build on 5192 (live realm GETs through the preview's proxy, never writes)
# and this lane's land read server on 5191 over the grader 3 store; every still is the director's own lens or an
# eye-level evidence pose, 6 s after ready.
#   bash work/lanes/grand-world/gw15-gpu.sh <label> <hour...>
# GW15_VIEWS=air takes only the island and vista lenses (a short check of the sea and air); GW15_VIEWS=eye takes
# only the eye-level stills between the houses, toward the ranges and toward the sea.
set -u
label=$1; shift
out=work/evidence/grand-world
node work/lanes/grand-world/serve-land-logged.mjs shots/grand-world/land-bake-g3 5191 "/tmp/gw15-land-$label.jsonl" &
(cd apps/web && CHATDOM_REALM_TARGET=http://127.0.0.1:5197 CHATDOM_LAND_TARGET=http://127.0.0.1:5191 npx vite preview --host 127.0.0.1 --port 5192 --strictPort) &
until curl -sf http://127.0.0.1:5192/ >/dev/null; do sleep 1; done
stream="http://127.0.0.1:5192/stream?source=realm&kingdom=129634568"
shot() { node work/lanes/grand-world/pc-cold-load.mjs "$1" "/tmp/gw15-$2.json" --seconds 1 --settle "${4:-6}" --shot "$out/gw15-gpu-$2@1920x1080.png" --size "${3:-1920x1080}" --timeout 120 "${@:5}" || echo "failed $2"; }
if [ "${GW15_VIEWS:-all}" = eye ]; then
  for hour in "$@"; do
    name=$([ "$hour" = 22 ] && echo night || echo golden)
    shot "$stream&hour=$hour&opening=0" "$label-eye-ranges-$name" 1920x1080 6 --pose 0,11.2,24,-80,34,-70,60
    shot "$stream&hour=$hour&opening=0" "$label-eye-sea-$name" 1920x1080 6 --pose -58,10.6,24.5,200,12,40,60
  done
  exit 0
fi
for hour in "$@"; do
  name=$([ "$hour" = 22 ] && echo night || echo golden)
  cameras="island hero"; [ "$name" = golden ] && cameras="island hero vista"; [ "${GW15_VIEWS:-all}" = air ] && cameras="island vista"
  for camera in $cameras; do shot "$stream&hour=$hour&camera=$camera&opening=0" "$label-$camera-$name"; done
  [ "${GW15_VIEWS:-all}" = air ] && continue
  shot "$stream&hour=$hour&opening=0" "$label-street-$name" 1920x1080 6 --pose -58,10.6,24.5,-46,10.2,21.5,52
  shot "$stream&hour=$hour&opening=0" "$label-forge-$name" 1920x1080 6 --pose 0,11.2,24,0,11.5,-8,52
done
# The opening as it plays: held on the island, then mid-descent.
[ "${GW15_VIEWS:-all}" = air ] || shot "$stream&hour=17.5" "$label-opening-descent-golden" 1920x1080 13
