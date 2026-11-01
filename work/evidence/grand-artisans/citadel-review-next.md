# Citadel and town walls: fixed review, in progress

The images are isolated SIMULATED art studies from the artisan bench. They do not show the installed castle, streets, real terrain or authoritative collision; they are not a production render or an LOD/shadow continuity proof.

Capture session queued: `ARTISAN_CAPTURE_COMPAT=1 ARTISAN_KITS=citadel,walls ARTISAN_VIEWS=hero,street,coast,dusk ARTISAN_SIZES=1440x900,390x844 node work/lanes/grand-artisans/capture.mjs`. Each still acquires and releases the shared lease individually. Reviews below will be completed as captures arrive.

- Citadel hero desktop and mobile: full roof/flag silhouette remains in frame and the indigo spires read clearly; the mobile frame spends much of its height on empty space. The base reads as regularly coursed, worked stone rather than natural outcrop.
- Citadel street desktop and mobile: the recessed entry reads as a shadowed opening, but the flat bench has no stairs or terrain approach up to its raised threshold. The upper spires are cut off by this camera; on mobile the outer walls are clipped too, and the broad face of the castle is visually bare.
- Citadel coast desktop and mobile: all spires fit but the mobile framing is small, with the same abrupt rock-to-bench contact and bare lower walls. This is a second camera angle on the isolated study, not a shoreline, so the image does not establish coast composition.
- Citadel dusk desktop and mobile: the roofs and flags remain legible, with no invented glowing windows. The bench lighting looks muted, with little of the signature warm/cool contrast; it cannot assess presence-derived light or the real dusk renderer.

Citadel baseline stills were preserved before the approach polish at
`citadel-review-next-baseline-{hero,street,coast,dusk}@{1440x900,390x844}.png` in this directory.

The follow-up adds a solid thirteen-riser approach from z = −62 to the entry landing at y = 13, with low side walls, and breaks the facade with engaged buttresses. This changes the visual study only. The route has no authoritative physical or walking status. The focused three-test suite checks each riser’s ground support and gate connection, original gate clearance and the new footprint. It also confirms that SHA-256 over the **full ordered** wall boxes and anchors stays identical to baseline for each proof seed: `8ad13a70960be930f19cba9482a17ae6d7d2f8c1f9b01c5f1a4d5957c22135c7` for tobi4s_, the_aggman and pinkkittyrose; `d0d015b48cee2e9e5327dc3628fac094f483f306f161c5d3e82291403ac2df71` for mashad4. Scoped ESLint passes. Repository typecheck was stopped as redundant to the root's central check and is not claimed as passed here.

The baseline wall hero desktop image has been viewed: the gate opening is visible, both gate towers meet the bench ground, and the full enclosure fits. The wall faces read as large flat uninterrupted planes and the rectangular circuit looks mechanically regular; the isolated empty centre is not evidence of an integrated town. The other seven requested wall stills remain queued behind the shared compatibility lease in the live capture session; they have not been inspected and are not claimed complete.

Handoff: capture exec session **29689** was last observed running and queued for the wall hero mobile still; a subsequent poll in the next agent turn returned `Unknown process id`, so its terminal status is unavailable. No cancellation was issued. The seven remaining wall captures and revised citadel pixels still need visual inspection. Root separately queued revised citadel hero and street shots. Do not treat this incomplete review as a finished task or as proof of production appearance.

## Parent resumption correction

The old child exec handle is missing from both its original owner and the parent.
It is no longer a live job to wait on. The parent resumed remaining work through
a versioned queue after main supplied the UUID/inode capture scheduler. Parent
compatibility waits 2214 and 45026 were deliberately stopped (exit130) solely to
migrate to that repaired protocol. No foreign process, registry or lock was touched.
Fresh source revisions and the 13 looked desktop stills are judged in REVIEW-02.md;
the older “not yet captured” statements above describe earlier observations.
