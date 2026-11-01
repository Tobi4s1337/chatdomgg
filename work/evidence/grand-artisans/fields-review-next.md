# Fields and windmill: follow-up review

The requested fixed-view capture batch is queued for the shared compatibility lease. Its
current process has not been cancelled. The eight desktop/mobile views per kit and the
judgements below will be recorded from the actual output as it arrives.

Review bench only: these are isolated simulated art studies, not production land,
terrain placement, collision, light transport or LOD proof.

## Fields

- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-hero-lod0@1440x900.png`: crop masses and lane junction are legible; furrows are straight and diagrammatic in the isolated scene.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-hero-lod0@390x844.png`: whole layout fits, but is small in a mostly empty portrait frame; gate and crop details are hard to judge at this scale.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-street-lod0@1440x900.png`: strong lane and hedge openings, but lavender and wheat are unbroken rectangular bars at street height, and cabbages read as regularly spaced cubes. This fails the close-view crafted bar; no source change made during review.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-street-lod0@390x844.png`: central lane remains visible, but most of the frame is blank sky/ground and the rows are too small for a close crop assessment.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-coast-lod0@1440x900.png`: side angle keeps the patchwork readable, but repeats the beam-like crop silhouette; this isolated bench contains no coast, so it cannot assess a real coastal placement.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-coast-lod0@390x844.png`: whole patchwork fits but occupies a small fraction of the portrait frame; no coast or terrain context is present.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-dusk-lod0@1440x900.png`: the warm/cool colour contrast stays readable; this is the bench's dusk preset, not production dusk or a populated landscape.
- `work/evidence/grand-artisans/fields-review-next-baseline/fields-tobi4s_-dusk-lod0@390x844.png`: dusk colours remain distinct, although the small field and empty frame prevent assessment of crop detail.

## Windmill
- `shots/grand-artisans/windmill-tobi4s_-hero-lod0@1440x900.png`: narrower framed cloth sails read as a windmill; warm eave matches its roof and the entrance appears open. It remains an isolated, unanimated study.

- `shots/grand-artisans/windmill-tobi4s_-hero-lod0@390x844.png`: the full mill fits and the sail silhouette remains legible on the phone; the model is surrounded by empty bench ground.

The crop source pass described below was made after the eight field baselines completed;
visual review of the revised crops is pending.

## Field-only source pass

After the eight field baseline stills completed, the requested planting pass replaced the
solid crop bars with seeded clusters. Lavender has green foliage and violet caps, and
cabbages have a broad leaf cross with a smaller head. The revised field source has **not
yet been visually reviewed**. Seven focused tests pass, including plot bounds and clear
lanes/gates. Ordered body/sail box and anchor SHA-256 values match pre-change baselines
for `tobi4s_`, `129634568`, `63920635`, `4363967` and `154972160`; the immutable hash
assertions live in `fields/mill-hash.test.ts`. Scoped ESLint passes. The original mill
capture batch remains live and the remaining views are queued.
The full repository typecheck was stopped as redundant before completion; it is not a pass.

On resumption, polling the prior capture session `48816` returned `Unknown process id`.
This does not establish that its process completed or stopped. The capture log still shows
only the two windmill hero stills; no remaining windmill angles have been observed. No
restart or cancellation was attempted.

## Parent resumption correction

The old child exec handle is missing from both its original owner and the parent.
It is no longer a live job to wait on. The parent resumed remaining work through
a versioned queue after main supplied the UUID/inode capture scheduler. Parent
compatibility waits 2214 and 45026 were deliberately stopped (exit130) solely to
migrate to that repaired protocol. No foreign process, registry or lock was touched.
Fresh source revisions and the 13 looked desktop stills are judged in REVIEW-02.md;
the older “not yet captured” statements above describe earlier observations.
