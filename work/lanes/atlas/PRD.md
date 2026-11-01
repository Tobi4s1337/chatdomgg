# Lane atlas

Spec: `work/specs/01-atlas.md` · Branch: `lane/atlas` · Worker: Codex Sol, high; Terra high for visual subwork.
Status: **A01–A02 accepted; A03 has open edge cases; A04–A05 retain their recorded implementation and review evidence.** Spec and first-consumer interchange frozen; later producer seams require main’s freeze when reached.

Scope: `apps/web/src/atlas/**`, `apps/surveyor/**`, this PRD, `progress.txt`, the Atlas spec and
`work/references/atlas-cartography.md`. Everything else is read-only. You are not alone in the codebase: preserve
other people's changes, coordinate integration, and never edit `packages/shared`, root scripts/manifests/config,
web routing/global CSS or the existing Surveyor/prototypes. Main owns worktree setup and integration; the lane
worker commits each green task on its lane branch, and sub-agents never run git. Use `$ralph-lane`,
`$chatdom-vision`, `$look` and the referenced research note.

Every task is done when `pnpm verify` is green; its meaningful tests and real-data evidence pass; all changed
visible states have screenshots taken by the repo shot script or matching Atlas-local Playwright suite and opened
with `view_image`; the box is ticked; one evidence/needs line is appended to `progress.txt`; and the lane worker
records one coherent lane commit. Do not claim the task done if a required real integration is only simulated.
First visible result is A02. Work in order, one task at a time; if blocked by a main-owned contract, write `needs:`
and take an unblocked part/task. Never pick from Backlog without main instruction. No placeholder or fake success.

## Current handoff — 2026-10-31

This handoff supersedes earlier task order, parking and per-task verification instructions in this PRD; scope and safety boundaries still apply.

A01–A02 accepted; A03 has open edge cases, and A04–A05 retain their recorded implementation and review evidence without blanket acceptance. A16–A19 are the current handoff. Stream view is the stage; chat is the controller and events are the physics. One worker per lane by default. Work one current task at a time; lanes can proceed in parallel where their owned scopes and dependencies are independent. Each lane implements feature-local durable adapters and runtime behavior against existing ports; main owns shared contracts and cross-surface authority and integration bindings. Record a precise `needs:` and continue independent work when a seam is unavailable. Targeted checks for each step: typecheck, affected tests and one viewed stream-first 1920×1080 capture per visual change; main runs wider milestone checks. Existing accepted work and historical evidence remain intact.

## Tasks

- **A01–A05 — Existing survey map and motion** · A01–A02 accepted; A03 has open edge cases and A04–A05 retain their recorded implementation/review evidence. This historical grouping does not assert acceptance of A03–A05.
- [ ] **A16 — An observed raid leaves a truthful road** · Consume the existing observed raid feed, draw a fresh caravan and durable road without replaying aggregate history as live. Test duplicates, gaps and restart; inspect a stream-first 1920×1080 capture. Missing durable observation seam is `needs:`.
- [ ] **A17 — Enter and return along the journey** · Integrate destination entry and return with main’s world coordinator and the Gate host, preserving auth resume, readiness and source retention. Test cancellation, disconnect and return; inspect a stream-first 1920×1080 capture. Do not join a room while browsing or invent a stamp.
- [ ] **A18 — Carry the journey onto the stream** · Present the same observed road and entry on the stream director surface; test interruption and inspect a stream-first 1920×1080 capture. Real integration requires main’s bindings; a labelled simulated rehearsal is evidence only of presentation.

- [ ] **A19 — Enter the channel’s own seeded kingdom** · Consume the frozen spec 39 Genesis recipe and entry resolver when available, at biome size, without inventing founded history. Record `needs:` for that contract if missing; A16 raid roads remain independently actionable. Test actual resolution and inspect one stream-first 1920×1080 capture.

## Previous task breakdown (history; not the current queue)

These are implementation steps in one full-scope lane, not reduced releases. Each step owns one reviewable result;
only its applicable acceptance checks must pass to tick it. All Spec 01 rules remain required to finish the lane.
If a step expands beyond one coherent worker iteration, ask main to split it rather than hiding unfinished work.
The first visible result is A02. A task blocked by a future shared seam records `needs:`; it never invents authority.

- accepted: **A01 — Read a real Surveyor snapshot without changing its source** · evidence: test + import log.
  Add the new `@chatdom/surveyor` manifest and read-only HTTP/SQLite snapshot adapter. Validate status/raid inputs
  with shared schemas; export actual channel/category/raid observations to its own `ATLAS_DATA_DIR` with source
  dates and coverage. Implement `atlas:import`, `atlas:check`, and `atlas:serve` on 5193 as specified, initially for
  this snapshot. Missing inventories fail clearly; never manufacture channels or write source SQL. Prove a real
  import, consistent transaction, bounded errors and atomic preservation of the last good snapshot. R1, R11, R16.

- accepted: **A02 — Show the first real survey map on laptop and phone** · evidence: shot + real-data flow.
  Export the Solid Atlas component with exactly one `[data-chatdom-atlas]` root and meaningful ready signal.
  Draw a composed Pixi map from A01's actual channels: immutable labelled survey-preview land, language regions,
  ink coasts, watercolour, licensed town stamps/shields, actual channel selection and an observed-date legend.
  Include basic pan/zoom, a working Watch link and designed loading/error states. This is the visible beginning
  of the complete map, not a claim that later interactions are implemented. No official founding or synthetic
  community names. Run `pnpm shots --area atlas` and inspect both sizes. R2, R4, R6–R9, R17.

- accepted: **A03 — Make geography and settlement survive new observations** · evidence: invariant tests + log.
  Add versioned taxonomy/name proposals, deterministic language/family geography, holding tiers and hamlet slots,
  immutable edition artifacts and append-only holding/tombstone ledger. Extend import/check with same-input/hash
  reproducibility, duplicate-owner/slot-exhaustion/hide/growth checks, and preservation of previous addresses.
  Official Edition 0/Edition I commands reject insufficient duration, unreviewed taxonomy and absent founder
  authorization. Never found an edition as a test side effect. R2–R5.

- accepted: **A04 — Publish coherent live paint, pennants and small-channel dabs** · evidence: codec flow + shots.
  Produce and consume the shared live-v2/dabs-v1/start-time artifacts behind one atomically swapped manifest.
  Apply a canonical content/visibility gate to every output before publishing, with privacy/safety cases.
  Draw all live classes with the specified wash/pennants, starts and founded spectacle priority. Partial sweeps,
  wrong alignment, stale/future observations, corrupt assets and old snapshots retain the last complete frame
  and its original observation time; they never manufacture offline or freshly live channels. R8, R11, R14, R16.

- accepted: **A05 — Make map motion and tile loading hold together** · evidence: interaction tests + motion review.
  Finish anchored wheel/pinch/pan/inertia, bounded interruptible flights, focus/back restoration and phone-sheet
  padding. Add four zoom distances, stable tiered label/shield collision, culling and bounded texture cache;
  implement ancestor tile fallback and seam-free sharpening. Test cancel/blur/resize, delayed/failed tiles,
  context loss and the WebGL-free still/search fallback. Inspect both standard sizes in motion. R7, R9–R10.

- [x] **A06 — Find a real channel and read its public card** · evidence: Unicode/search/card flow + shots (register-shots.mjs, Spec 01 A06 decision).
  Implement bounded Unicode search and mapped/waiting cards using real observation metadata, strongest roads,
  availability-aware actions and source dates. Complete route parsing/restoration for channel and selected road.
  Apply hidden/unknown/mature/excluded and raw-content-expiry rules consistently across search and cards; unknown
  never becomes general. Define any missing shared consumer seam with main before using it. R13, R16–R17, R22.

- deferred: **A07 — A real raid rides once and leaves an honest road** · evidence: ingest/restart tests + shots.
  Add a durable observation/checkpoint ledger around ephemeral SSE and historical pair aggregates, without
  claiming unavailable upstream event IDs/cursors. Draw live caravans and sea lanes only for fresh events;
  recovered history thickens/fades roads without replaying as live spectacle. Test duplicate/reordered input,
  reconnect/restart gaps, aggregate reconciliation and old-road retention. Never mistake an aggregate for a new
  individual raid or infer that missing coverage means no raids. R11–R12.

- deferred: **A08 — Connected roads become factual lines and bridges** · evidence: derivation tests + shots.
  Derive raid trains with sequential timing/forks/dedupe and persistent line records, adding only observed stops.
  Through main-approved public facts add shared-chat bridges, embassy/signpost, footpath and trade-route views;
  people-derived marks obey ≥20 thresholds/bands and opt-out. Missing producers are explicit `needs:` rather
  than invented marks. Add line/road stories and deep links; no paid prominence. R12–R14, R22.

- deferred: **A09 — Replay an actually recorded night** · evidence: decoder/seek/gap tests + dated replay shot.
  Decode real version-1 recorder frames and their historical indices through the read-only adapter. Add a dated
  scrubber, speed changes and backwards seeks with deterministic rebuilding. Keep live and replay transports
  isolated; missing segments remain visible gaps. Historical metadata follows retention rules, not an indefinite
  cache of raw content. Demonstrate one actual recorded interval and a controlled corrupt/gapped case. R21.

- deferred: **A10 — Present founded stories, discovery and seasons** · evidence: producer integration + card/share shots.
  Consume approved founded drawings/hero descriptors with the valid stamp fallback; add founded card history,
  crowns/citations, embassies and eligible aggregate bands. Build Follow a Road, the real notice board, common
  bracket season views and share/still assets. Main supplies quality/season/founding authority and wires root
  metadata/endpoints. No fake winners, ratings, founded channels, or monetary discovery advantage. R13–R17, R22.

- deferred: **A11 — Keep each viewer's own map private** · evidence: authorized overlay/revocation tests + shots.
  After main freezes auth/consent seams, add current-viewer home/realm/tent ribbon, castle exception and mutual
  friend pins. My Twitch asks for follows at point of use, retains them only for that view and clears them on
  close/sign-out/revocation. Test three homes versus castle, foreign royal authority rejection and absence of
  personal overlays/follows from all public caches/exports. Unavailable identity never becomes a fake login. R18.

- deferred: **A12 — Enter and return through the real world coordinator** · evidence: actual entry flow + shots.
  With main's entry/drawing-ready contract, implement wax-seal response, auth-resume preservation, true progress
  and overrun state, matching hero-angle two-canvas reveal, role-correct arrival and reversible M/Back return.
  Test denial/cancellation/disconnect and the 60-second world retention coordination. No room joins during
  ordinary map browsing, false arrivals, fake ready timers or premature passport awards. R19.

- deferred: **A13 — March with a confirmed raid or travel to a friend** · evidence: authority/cancel tests + shots.
  Integrate Atlas-side roads, finder, authorized preview and raid-arrival links with the kingdom-side travel
  coordinator in Spec 23 / `lane/raid-gate`, which owns reservation/rollback and Gate consent. Keep A07 roads,
  A12 world entry and A14 map direction in Atlas; do not duplicate the Gate coordinator or its action writer. Route through main's
  action service, with live write tests only on tobi4s_. Simulated integration fixtures are labelled and cannot
  complete real integration acceptance. No direct Twitch writer or client-granted royal power. R20.

- deferred: **A14 — Make the same Atlas work on stream, with sound** · evidence: director shots + audio/motion review.
  Complete director hooks for raid in/out, tonight's roads and crowning; preload map presentation and remove
  private overlays/tiny counts. Add crafted paper/wood/brass/wax motion and varied CC0/permissive or procedural
  sound to every meaningful action, respecting autoplay/mute. Main credits exact sources in THIRD_PARTY.md.
  Inspect 1920×1080 and 1280×720 plus desktop/phone. R9, R22 and the spec's quality bar.

- deferred: **A15 — Demonstrate the complete Atlas under failure and scale** · evidence: acceptance + cost report.
  Run all spec acceptance against real imports and completed integrations. Exercise the remaining designed UI
  states, 5/50,000-viewer cases, hostile text, slow tiles, bad feeds and reconnect; verify request/bundle isolation,
  culling/cache/transfer/memory budgets and no Twitch/realm calls from browsing. Confirm full-level Edition I
  tooling and long-tail land-by-raid without founding/publishing an edition. Resolve producer `needs:` or leave
  the lane incomplete. Record real-device/phone/OBS measurements still owed; never substitute SwiftShader fps.


## Backlog

Worker discoveries go here with the rule/problem and evidence. These are not authorization to widen scope or skip
any task above. There are no invented future features to implement from this list.

- **2026-10-30 (A03) — Founder key and authorization ceremony.** `atlas:found` verifies an Ed25519 authorization
  against `ATLAS_FOUNDER_PUBLIC_KEY`. Nobody holds a founder key yet, so main/Tobias must create one, keep the
  private half off the server, and provision the public half before Edition 0 (eligible 2026-10-31 15:44 UTC).
- **2026-10-30 (A03) — `families-1` awaits founder review.** It has 14 families and 91 games left unassigned with
  reasons. Near-gambling categories (crypto, casino simulators) are deliberately unassigned, not mapped. Edition I
  refuses it until it is marked reviewed (reviewer and date). The realm-name proposals are not shown until then.
- **2026-10-30 (A03) — needs: founded-record producer.** A founded kingdom's own holding (`reason: founded`) and
  raids into founded kingdoms need main's founded-record seam. Until then `check` reports any `founded` line as an
  error and settlement grants none.
- **2026-10-30 (A03) — Empty Outer Isles chunks.** The browser fetches the six empty Outer Isles `region-<n>.json`
  chunks (a few hundred bytes each). Harmless, but the chunk loader could skip regions with no holdings.
- **2026-10-30 (A05) — No watchdog for a hung bake worker.** Closed in A05: a 20 s ready / 8 s bake watchdog treats
  a silent worker as crashed (tests in `map/tiles.test.ts`).
- **2026-10-30 (A05) — The still copies the overlay and wash rules.** `still/compose.ts` restates the placement,
  shield and wash rules of `map/overlay.ts` and `map/wash.ts` so the still needs no Pixi; `still/parity.test.ts`
  guards drift. Moving those rules (and the tile farm) into Pixi-free modules both import would remove the copy.
- **2026-10-30 (A05) — Still notice and ribbon.** Closed in A05: the notice hangs from the ribbon's banner at every
  width. Search joins the still's DOM path in A06 (done: the search sits in the cartouche on both paths).
- **2026-10-30 (A05) — Real-device motion check.** SwiftShader proves positions, states and holes, not frame time.
  Wheel/trackpad glide, pinch, flick coast and the 0.42–2.6 s flights want a look on a real GPU laptop and phone.

## Decisions

- **2026-10-30 — Completion audit decomposes work.** The original six tasks bundled importer, cartography,
  rendering and integration into large steps. Main split them into fifteen bounded outcomes without dropping
  any spec rule; the first visible map remains task 2. The previous six-task identifiers had no completed work
  or worker commits. The shared interchange freeze is unchanged. Future producer seams freeze at their consumer.

- **2026-10-30 — Main resolves integration ownership.** Tobias explicitly authorized main to commit the completed
  A01/A02 together on this lane, with main supplying the Surveyor lockfile importer. This supersedes the review
  loop's separate-commit objection for these already interwoven tasks. Frozen offline install, typecheck, lint,
  363 tests and build now pass. Main inspected the real-data desktop/phone shots and added the asset credits.
  A01/A02 are complete within their specified scope; A03–A15 remain. Lane workers still do not own the root lockfile:
  report a new manifest need once, then main supplies its importer instead of repeating an unchanged review loop.
