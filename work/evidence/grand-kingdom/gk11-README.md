# GK11 evidence: the kingdom on the grand land

All stills come from a staging copy of GK10's uncommitted `/-/grand` with the GK11 hook applied
(`work/lanes/grand-kingdom/gk11-gk10-hook.py`), served by Vite on 5182 under SwiftShader. Every kingdom shown is
SIMULATED or potential: tobi4s_'s Willowmere is the realm's founding re-run with no adopted bytes read; the Genesis
channels are potential holdings from their observed fixtures. The presence windows are the labelled SIMULATED light
study; no people are invented. `still=1` hides the page chrome, so the SIMULATED badge is not in these frames.

| Kingdom | Before | After |
|---|---|---|
| tobi4s_ (Willowmere) | `work/evidence/kingdom/dusk-composition/town@1440x900-review.png` | `gk11-after-tobi4s-hamlet-land@1440x900.png` |
| The_AGGman | `work/evidence/genesis-aggman/after-hero@1920x1080.png` | not captured yet: two tries this session missed the lock window (ready ~270 s+, one software frame >30 s) |
| PinkKittyRose | `work/evidence/genesis-pinkkitty/s4-hero@1920x1080.png` | needs the land sized to the town (below) |
| MashaD4 | `work/evidence/genesis-masha/after-hero@1920x1080.png` | needs the land sized to the town (below) |

What the tobi4s_ still shows: all 240 homes, the castle, market and court on their exact founded ground, the new
town wall circuit with drum towers and gatehouses at the street crossings, the lake on the grand sea level, and
the land's own trees cleared from the town. What is wrong with it: GK10 raises a hamlet-sized island (1280 columns)
for tobi4s_ while the settlement's exact region needs 2560 columns, so the island is no more than the region and
meets the sea along straight lines. `landColumnsFor` gives the size; the hook's `--size` step makes GK10 raise it.
Under SwiftShader on this host (load ~40) a 1280 land with the town takes ~245 s to ready; the sized lands would not
fit the capture lock's five minutes here, so they wait for GK10's land sizing and a quieter host or a GPU.

Real-GPU check wanted: `/-/grand?channel=tobi4s_&hour=17.6` at 1440×900 and 1920×1080 with the hook and `--size`:
time to ready, frame time over the walled town at dusk, and whether the window lights and fire glow read at range.
