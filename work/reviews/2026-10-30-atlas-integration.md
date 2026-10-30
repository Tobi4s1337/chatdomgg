# A01/A02 integration

Tobias asked main to resolve the Atlas lockfile blocker, commit the reviewed work on its lane and merge it.
Main committed A01/A02 together as `0a3ba03`, an explicit exception to the task-per-commit convention for these
already interwoven completed tasks. The repeated unchanged lockfile review loop is closed; A03 is next.

## What landed

- Actual read-only Surveyor HTTP/SQLite import, strict dated inventories, atomic revisions and integrity checks.
- The first real survey-preview map, its own verified geometry artifacts, expiring names, visibility gate,
  authored heraldry, credited CC0 stamps/OFL fonts, basic selection/pan/zoom/Watch and designed failure states.
- The exact thirteen-line Surveyor workspace importer. Main retained the Herald/Twitch importers when resolving
  the lockfile merge and regenerated it with pnpm, rather than choosing one branch's lockfile wholesale.
- `THIRD_PARTY.md` now credits the shipped art and fonts with their exact inventory and bundled notices.
  Original upstream license-file whitespace is preserved.

No official edition was founded. Full geography, live paint, interactions, replay, identity and world travel
remain A03–A15. Missing moderation/content-label producers are recorded at their consumers and are not invented.

## Evidence

- Lane: `pnpm install --frozen-lockfile --offline`, typecheck, lint, **363 tests** and build passed after main's
  lockfile fix. Main opened its existing real-data laptop/phone screenshots.
- `atlas:check` passed on real revision `obs-20261030T042315Z-d5a9af3c1cf2`: 199,095 observed channels, 29,157
  candidates, 5,945 raid pairs, 11,427 recorded raids; 254 sweeps across 12.64 hours, zero rejected rows/gaps.
  Files, dates, hashes, retention and preview land were verified. Observation cut: 2026-10-30 04:23 UTC.
- Main: frozen offline install passes for all ten workspace projects. `pnpm verify --area atlas` passed typecheck,
  lint, **760 tests**, build and two real map captures. The shot harness now requires `data-state=ready` plus actual
  preview/revision attributes, so a designed failure page cannot count as the real survey proof.
- Main opened both new captures at 1440×900 and 390×844; copies are in `work/evidence/atlas/`. The kingdom's
  unchanged source already passed its full nineteen-shot verification in `b4e0049`; it was not captured again.
  Every capture was serial and pinned to two CPU cores at low priority.

The map has a crafted day-map identity and truthful observation legend. Phone edge-label clipping and resize/focus
polish remain the lane's A05 work. SwiftShader establishes rendering/behavior, not real-device frame timing.
