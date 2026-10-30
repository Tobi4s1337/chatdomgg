# Spec 12: Citizens and their own homes
Status: frozen consumed core, 2026-10-30
Vision: chatdom/Moments.md §14; chatdom/ChatDom.md; work/PLAN.md.

## What and why
Presence becomes a little person walking the kingdom's real streets. Their own window lights on arrival.
The citizen authors their home's large shapes in a private plot; the kingdom adds the small detail.

## Contracts
- `packages/shared/src/citizen-chat.ts`: short-lived public speech, bound to kingdom, presence epoch,
  origin and visual slot. Text/emote parts are validated; this is not a chat archive or identity authority.
- `packages/world/src/citizens`: deterministic presentation from frozen presence frames and settlement
  routes. Sampling is seekable. Home arrival exposes an exact light timestamp. Goals select approved graph
  nodes; callers cannot send arbitrary coordinates. Absence and lost authority remove the person.
- `packages/shared/src/build.ts`: externally supplied plot policy, style palette, tier allowance and
  reserved lattice; inclusive/exclusive edit boxes, fill, mirrors, source snapshots and tools controller.
  Build cells remain 0.125 m. Brush sizes do not change the lattice.
- `packages/world/src/build`: atomic draft operations, gesture history, validated run-length saves,
  source-preserving procedural shaping and blueprint insertion. Compiled detail never becomes authored
  source or consumes undo entries. Imported source never supplies ownership or a larger budget.
- Publication distinguishes a labelled local SIMULATED street preview from authoritative submission.
  LIVE publication requires the real review service; no client-side approval is fabricated.

## Scope and consumers
Main owns shared/world core, actual street rendering, plot sessions and housewarming integration.
Specs 13–16 hand off tool polish, editable templates, VOX import and ambient crowd policy on these APIs.
The wardrobe lane owns body and clothing content; the renderer consumes its frozen attachments and pivots.

## Acceptance and references
One CPU journey each in `packages/world/src/citizens/motion.test.ts` and `packages/world/src/build/build.test.ts`
covers the meaningful boundary. Browser acceptance belongs to the actual moments: walk, bubble, arrival light;
edit, undo, publish and reload. Inspect desktop/phone frames and short motion captures, then run verify.
See `work/references/citizen-motion.md`, `build-shaping.md`, and `vox-import.md`.

## Decisions
2026-10-30: Public presence stays authoritative and unchanged. Arrival-delayed light is a render-side projection.
SIMULATED actors are labelled; LIVE speech requires an actual cue. Local draft/publication persistence is
explicitly a simulation until sign-in, deed authority and the moderation service are connected.

2026-10-30: A supported thin rectangular roof cap is a roof footprint: derived Hearth/Tide gables or a Grove
hip add the silhouette, eaves and framing. A narrow stone/timber chimney may pierce it. Hand-shaped slopes,
roof holes, irregular connected wings and broad rooftop structures retain their authored shapes. The raw
source, undo and tier allowance are unchanged. The browser dresses a detected doorway with a lantern,
threshold and planted side strips; all authored windows warm together for the same owner.
