# Spec 50: Growth that people can see

Status: frozen first consumer group 2026-11-01
Vision: `chatdom/World-Tree.md` §§8–9; `chatdom/ChatDom.md` principles 2–5.

## What and why

A return visit leaves a visible mark. A home gains a storey, the flame above its door remembers a streak,
and the community's meeting places grow with its nights together. Each change is witnessed in the room's
record, framed on stream, and remembered by the Chronicle. Nobody can buy time or lose their home by leaving.

## Current state

The Hearth and Tide home families already cover hut through hall. `HomeTier` and `HOME_DEPTH_METRES` in
`packages/shared/src/voxel.ts` remain unchanged. Generated plot tiers are scenery; they are not earned history.
The first domain core is `packages/world/src/growth/`, exported as `@chatdom/world/growth`.
The earlier requested `08-depth-progression` document is absent from this checkout; spec 08 here is wardrobe.
The requirements in conductor brief 0034 and World-Tree are carried into this spec rather than inventing that file.

## Rules and policy

1. Only the room's committed, trusted evidence may advance live growth. The pure reducer consumes ordered
   `stream-observed`, `presence-qualified` and accepted `home-bound` observations; it never accepts a browser
   claim, chat-message count, paid event or arbitrary presence sample as time.
2. Ten confirmed minutes qualifies a stream-day, including quiet Get Chatters presence. A stream-day is the
   UTC date on which its stream started. Same-date sessions count once; a marathon remains one day. Only
   witnessed stream-days affect streak continuity; offline dates do not. Best streak never falls.
3. Policy v1: tent → hut at 3 qualified days (brief 0034); cottage 7, house 30, manor 90, hall 180.
   The latter values are chosen balance, versioned in `GROWTH_POLICY_V1`, not founder-prescribed thresholds.
   No binge, payment or streak multiplier. An installed home tier is a permanent floor. Bootstrap does not
   fabricate years of attendance or an upgrade ceremony. Tent is an entitlement stage, not another voxel lattice.
4. Founded civic places begin at level 1. Their v1 level gates count distinct kingdom days with at least one
   qualified person, preserving a small community's pace. Exact 2/3/4 gates live in the policy; person-days are
   retained separately. Earned channel-point contributions need their own source-backed ledger seam; Bits and
   subscriptions must never enter it or bypass day gates.
5. A home entitlement does not replace an authored house, move its door/plot or discard a Forge attachment.
   Main owns durable plot/host revision application. The global three-home limit and monarch castle exception
   stay with ownership allocation, not a kingdom-local counter. Follow milestones award tenure pieces;
   sub months affect streets and their separate ribbons, never this calculation.
6. Ceremonies and the crier consume committed milestone evidence once, keyed by kingdom/source sequence,
   beat kind and target. Reconnecting to a recent-beat tail does not replay every celebration. Backwards
   Chronicle seeks are explicitly isolated replay state, never live regression or new credit.

## First frozen consumer contract

`packages/shared/src/growth.ts`: `GrowthHomeView`, `GrowthSceneBeat`, `GrowthSceneFrame`, `GrowthSceneFeed`
and their strict runtime schemas. Homes expose plot/stage, qualified days, current/best streak and next goal.
`qualifiedMinutes` is a proven ten-minute minimum per qualified day, not total watch time. The public frame
contains no private person IDs, roster, receipts, ordinary chat or authority commands. Its maximum 128 recent
beats are presentation, not a history log. Every frame has kingdom, origin, sequence and time; simulated
fixtures retain simulated provenance. `projectGrowthScene` allowlists the private core into this shape.

## Main and lane ownership

Main owns shared contracts, the pure model, room transaction/snapshot integration, asset revision and live
read bindings. No browser commits growth. Existing presence, coal qualification and Forge keep working.

- `growth`: home stages, scaffold/storey/chimney ceremony, neighbours and the growing-quarter sequence;
  owns `apps/web/src/growth/**`. Keep the original GR10 work; consume this feed rather than invent thresholds.
- Specs 51–55: civic craft, earned card shelf, crier lines, Chronicle presentation and simulated history,
  each with its own lane/scope. Public consumers can start independently with validated simulated frames.
  Production inventory, delivery and durable replay shapes freeze when their first real adapter starts;
  missing authority is an exact `needs:`, never fake live success.

## Acceptance and look

Focused contract/model tests, typecheck, scoped lint and builds for changed consumers. Capture one meaningful
same-view before/after per visual change, stream-first at 1920×1080. The home must visibly grow on its plot;
new civic levels must read at street and stream distance. Chronicle acceptance includes a watched 30-second
engine replay of seeded history and a backwards seek to a truthful earlier night, with SIMULATED visible.

## References and quality

`work/references/settlement-streets.md` for stable plots; `work/references/magic-lighting.md` for warm dusk;
`work/references/build-shaping.md` for readable construction. Reuse authored families and the accepted light.
The ceremony is scaffolding, a settling storey, a catching chimney and neighbours, not a stats notification.

## Decisions

- 2026-11-01: Freeze the first read consumer and small pure model now. Durable room integration remains main's
  next core slice; no live growth, keepsake issuance or Chronicle recording is claimed by this contract.
- 2026-11-01: Room facts now also reduce the private growth snapshot, with public growth rows in the same
  fenced transaction/outbox. `growth.bindHome` is allocation-only and checks the installed immutable deed's tier
  in the transaction; it grants no attendance and changes no geometry. Interrupted bindings recover separately
  without voiding a home. Legacy snapshots replay their original evidence once. Walking and stream connections
  expose `growthFeed`; `SceneOptions.growthFeed` carries it to the visual consumer. Bootstrap beats are quiet.
  Physical home upgrades, ceremonies, civic meshes and Chronicle playback still require their rendering/application
  work; the entitlement alone must never be presented as an already enlarged house.
