# GK11 evidence: the kingdom on the grand land

All stills come from a production build of a staging copy: this lane's GK11 files, GK10's uncommitted grand land
from `../grand-kingdom` (as of 2026-11-01 19:20), the artisans' kits, and `work/lanes/grand-kingdom/gk11-gk10-hook.py
--size` applied (kingdom seated in the land worker, land sized to the town's envelope, the `town` view, the town
ground's `paved` cover). Main's `vite.config.ts` was given `worker: { format: 'es' }` in the copy (see the needs in
`work/lanes/grand-kingdom/gk11-design.md`). Served through Playwright routing on an https origin (no port; every
capture port on the host was taken), SwiftShader, `tier=software&capture=1&still=1`. Each land raised and meshed
without the capture lock (4–6 min of worker CPU); the lock was held for the still only (0.5–85 s). No fps claim.

Every kingdom shown is SIMULATED or potential. tobi4s_'s Willowmere is the realm's founding re-run with no adopted
bytes read; its citizens are the kingdom view's own labelled SIMULATED producer, 12 s into their walk home. The
Genesis channels are potential holdings from their observed fixtures: no citizens walk there, and their windows are
the Genesis SIMULATED light study. `still=1` hides the page chrome, so the SIMULATED badge is not in these frames.

| Kingdom | Before (today's view) | After (grand) |
|---|---|---|
| tobi4s_ (Willowmere) | `work/evidence/kingdom/dusk-composition/town@1440x900-review.png` | `gk11-after-tobi4s-castle@1440x900.png`, `gk11-after-tobi4s-town@1440x900.png` (street view, citizens) |
| The_AGGman | `work/evidence/genesis-aggman/after-hero@1920x1080.png` | `gk11-after-aggman-castle@1440x900.png` |
| PinkKittyRose | `work/evidence/genesis-pinkkitty/s4-hero@1920x1080.png` | `gk11-after-pinkkitty-castle@1440x900.png` |
| MashaD4 | `work/evidence/genesis-masha/after-hero@1920x1080.png` | `gk11-after-masha-castle@1440x900.png` |

The tobi4s_ stills were taken one build before the crag fix below; inside the region nothing differs. The previous
checkpoint's still (land not yet sized to the town, straight coasts) is `gk11-after-tobi4s-hamlet-land@1440x900.png`.

What they show: every home on its exact founded ground and its own street, the streets and squares paved in the
kingdom view's paving, the town wall circuit with drum towers and gatehouses at each street crossing, banners in
the channel's cloth, the castle on its mound with the steep ground dressed as rock, and the grand land (mountains,
rivers, orchards, fields, coast) rising around the town with no seam.

Fixed this session after looking: wild-flower confetti over the whole town (the grade wrote the land's grass; it now
writes the settlement's own lawn cover and a `paved` cover), streets missing (paved cells fell back to grass), a sheer
striated wall behind The_AGGman's town (the castle crag broke off even where the land rises; it now applies only to
a drop), tall water sheets on that slope (a mountain mere kept its level over ground the band cut down). MashaD4
first failed twice: its walls were refused (a gate on the mountainside needed a 33 m footing, past one blueprint's
32 m), and its reserved mountain roads asked for a 5120-column land that never finished raising. Footings now go down
in courses of their own, and growth room is capped at 3072 columns; its still was raised in 5.4 min (lock held 2 s).
MashaD4's still shows the castle on its ledge under the mountain, and gatehouses and towers stepping down the slopes to
the ground.

Doubts: the steep mountain flanks read as banded blue-grey rock under GK10's rock material; the paving is the kingdom's own material (#b3a28a) but reads salmon under GK10's warm golden grade; the
orbit and high views put the camera over GK10's cloud deck on a land sized up for its town (needs in the design
note); only a handful of Willowmere's citizens are out at 12 s, so the street still shows one walker by the well.

Real-GPU check wanted: `/-/grand?channel=tobi4s_&hour=17.6&view=town` and `&view=castle` at 1440×900 and
1920×1080 with the hook: time to ready, frame time over the walled town at dusk, citizens walking, and whether the
window lights and fire glow read at range.
