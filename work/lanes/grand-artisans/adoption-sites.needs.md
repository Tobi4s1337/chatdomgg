# Builder needs: site reservations before vegetation

Tobi4s_ source diagnosis is in `work/evidence/grand-artisans/adoption-diagnostic.json`. All 28
terrain-fitting mill candidates intersect existing trees; 17 also intersect the town exclusion and
two overlap reserved cover. The only terrain-fitting lighthouse site intersects a tree. None of
169 quay positions has a dry 246-cell rear join; the closest has ten wet cells.

`adoption-sites.needs.patch` is a **proposed, not applied** GK10 producer patch. It chooses the
existing guarded, ground/water-fitted pieces before calling `placeTrees` and excludes trees whose
full canopy envelope intersects those piece bounds. Town, castle and reserved-cover checks are
unchanged; no ground or water is modified. Run builder checks and inspect fixed/orbit views before
adopting it. `GrandComposeInput` is provisional here: its empty tree list means composers run before
vegetation. Audit any other composer that expects a populated tree list before applying. This does
not establish collision or interactions. GK11 must first bind the selection and exclusions to the
actual installed scene, revisions, lot/frontage and street/Forge/growth masks, and must not use
provisional empty-tree data to replace existing identities or supports.

**Additional builder-owned quay need (not implemented by the patch):** during canonical macro
composition, select a sheltered coast and a 123-by-at-least-2-cell shore join compatible with the
quay's four cardinal orientations; fit its deck, soil transition, basin and future access together
with settlement reserve and drainage. For newly founded land solve the site before drainage/erosion
and vegetation, then run the existing water, slope, solid-bed and clearance checks on the final
field. For already installed worlds preserve every existing lot, street, castle and Forge support;
choose an already compatible site or leave the quay unplaced. Do not flatten sea after drainage,
invent a basin, conceal water with arbitrary fill, or treat art boxes as authority. Any terrain
revision must be shared by rendering and physical-page producers. Quay coverage for the other three
channels still needs measurement; do not assume the tobi4s_ shore is representative.
