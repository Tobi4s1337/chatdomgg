# Forest species hero review

SIMULATED isolated art-bench studies, not the grand renderer or a test of world placement, streaming, LOD transitions, shadows in motion, physical terrain or presence. Six species are requested as single trees and groves at 1440×900 and 390×844, one still per shared lease. Captures are in progress; only entries recorded below have been visually reviewed.

- Gold, individual, 1440×900: stepped irregular crown masses and a readable open bough; flared roots meet the ground. The crown remains blocky in close view, though its broad silhouette is legible. `shots/grand-artisans/tree-tobi4s_-gold-hero-lod0@1440x900.png`.
- Pine, individual, 1440×900: the tapered tiered silhouette reads immediately as a conifer, with cool green foliage distinct from the gold. An exposed dark-brown band interrupts the leader near the tip; the shelves also look very regular and squared off at this distance. `shots/grand-artisans/tree-tobi4s_-pine-hero-lod0@1440x900.png`.
- Cherry, individual, 1440×900: soft pink, broad low canopy reads differently from pine. The crown fuses into a single thick rectangular mushroom with almost no bough gaps or blossom character; its regular broad top is weaker than the gold. `shots/grand-artisans/tree-tobi4s_-cherry-hero-lod0@1440x900.png`.
- Teal, individual, 1440×900: calm blue-green ramp and dark bark are attractive, but the round-capped single canopy and straight trunk read too close to cherry and the rejected earlier gold; species distinction is predominantly colour. `shots/grand-artisans/tree-tobi4s_-teal-hero-lod0@1440x900.png`.
- Birch, individual, 1440×900: white bark with dark knots and the narrow upright crown make it identifiable. Large sharp stepped bark blocks and chunky separated crown cubes read more like stacked toy blocks than the fine, airy birch boughs expected at this angle. `shots/grand-artisans/tree-tobi4s_-birch-hero-lod0@1440x900.png`.
- Willow, individual, 1440×900: the hanging foliage differentiates the profile from other broadleaf trees. Its hanging pieces merge into bulky squared curtains and stop well above the ground; finer varied lengths and a real bank context are needed to judge it as a willow by water. `shots/grand-artisans/tree-tobi4s_-willow-hero-lod0@1440x900.png`.
- Gold, individual, 390×844: crown groups and trunk remain distinct at phone width, with no clipping; the large empty field belongs to the isolated review bench. `shots/grand-artisans/tree-tobi4s_-gold-hero-lod0@390x844.png`.
- Pine, individual, 390×844: upright taper remains readable and entirely in frame; the same brown tip band and regular layered construction are even more conspicuous. `shots/grand-artisans/tree-tobi4s_-pine-hero-lod0@390x844.png`.
- Cherry, individual, 390×844: the wide pink profile remains visible without clipping, but the cap still reads as a single hard-edged slab rather than blossom-laden boughs. `shots/grand-artisans/tree-tobi4s_-cherry-hero-lod0@390x844.png`.
- Teal, individual, 390×844: calm teal is clear at phone size but its level circular canopy still resembles a coloured mushroom. No model clipping. `shots/grand-artisans/tree-tobi4s_-teal-hero-lod0@390x844.png`.

## Candidate prepared separately

While the baseline capture remained queued, a candidate was prepared in `/tmp/grand-forest-mirror/artisans/forest/index.ts`. It shortens pine's exposed leader and varies whorls, opens low cherry boughs, gives teal two staggered wing crowns, narrows birch into separated leaf sprays, and spaces willow curtains with one lower reach. It has **not been rendered or applied**. Ten isolated tests passed, including exact gold geometry for three seeds, colour-subset preservation, conservative envelopes across 32 seeds per species, deterministic variation over five seeds per species, and face-connected voxels for all species over three seeds. Mirror ESLint passed. These tests do not establish beauty or grand-renderer integration.

Capture handoff: exec session **90177** is still running the 24-still baseline, queued on the shared compatibility lease after 10/24 frames. Keep the live session; do not cancel it for an observation timeout. Captured and personally reviewed: six desktop individual trees, plus gold/pine/cherry/teal mobile individual trees. Birch/willow mobile and all twelve forest images remain. Production forest source remains at baseline. After the runner exits, apply `/tmp/grand-forest-next.patch` or review `/tmp/grand-forest-mirror/artisans/forest/index.ts`; the isolated mirror's ten tests pass. Re-capture and visually judge the changed species after applying.

Session handoff audit: on resumption, polling session 90177 from the original child returned `Unknown process id 90177`, as it did from the parent. This is not evidence that the runner or guard stopped. The capture log still ends the tree batch at teal mobile (10/24); no terminal result is available. Do not restart or alter the production forest pending authoritative state.

## Parent resumption correction

The old child exec handle is missing from both its original owner and the parent.
It is no longer a live job to wait on. The parent resumed remaining work through
a versioned queue after main supplied the UUID/inode capture scheduler. Parent
compatibility waits 2214 and 45026 were deliberately stopped (exit130) solely to
migrate to that repaired protocol. No foreign process, registry or lock was touched.
Fresh source revisions and the 13 looked desktop stills are judged in REVIEW-02.md;
the older “not yet captured” statements above describe earlier observations.
