# Birch bark correction

Viewed the baseline hero and street stills:
- `shots/grand-artisans/fixed-713a05b/tree-tobi4s_-birch-hero-lod0@1440x900-16310f9a2e-e84fac6f3747-8d5c8ca0.png`
- `shots/grand-artisans/fixed-713a05b/tree-tobi4s_-birch-street-lod0@1440x900-f93f6e70f1-e84fac6f3747-5dc2acc4.png`

The near-black cross-trunk strokes protrude and read as straps. The replacement only recolours existing pale wood when a cross-section has at least two wood cells; its single-cell, alternating-sided scars use the existing birch bark tint and never add protruding geometry. Seed controls the spacing offset. Removing the former stroke can uncover leaf cells it had erroneously overwritten. The narrow trunk means some seeds have few or no visible scars; this is preferable to a full-width collar.

Scoped ESLint and 11 forest tests pass, including existing geometry connectivity and a 32-seed extent sweep. A separate temporary four-seed parity test verified every non-birch kit is unchanged, no new birch occupied voxels appear, and the existing leaf voxels remain present. The corrected image has **not yet been captured or visually approved**; the prior images are baseline only.

Parent checkpoint update: see REVIEW-06.md for the later looked evidence, final validation, exact capture limits and paused state. Earlier verification statements above describe the child handoff time.
