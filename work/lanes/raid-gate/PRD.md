# Lane raid-gate

Spec: `work/specs/23-raid-gate.md` · Branch: `lane/raid-gate` · Worker: Codex Sol, xhigh for realtime/recovery;
Terra high for visual subwork, Astra high for authority review.
Scope: `apps/web/src/raid-gate/**`, `apps/api/src/raid-gate/**`, `apps/realm/src/raid-gate/**`, this PRD/progress
and spec 23. Everything else is read-only. The lane owns the real feature application handlers and UI, including
idempotency, reservation/rollback, passports/reward eligibility and gift transfer logic. Main approves the local
API/ports, commits the handoff and creates the branch/worktree; main binds authenticated principals, routers,
durable repository adapters, authorized Twitch/room/item transports, kingdom host and Atlas host. Start after
that approval and the first visible route binding. You are not alone: preserve others' edits, never edit
Atlas/Herald/Twitch-moments/shared files, and report exact missing infrastructure methods as `needs:`.
Use `$ralph-lane`, `$chatdom-vision`, `$look` and `$twitch-dev`.

Every task is done when `pnpm typecheck`, `pnpm lint`, focused tests under the three owned folders and
`pnpm build` are green; its meaningful flow works; changed visual states are captured at spec sizes and opened
with `view_image`; the box is ticked; one concise evidence/needs line is added to `progress.txt`; and the worker
records one coherent lane commit. Sub-agents never run git. Use the repo capture lock serially. Main runs
composed `pnpm verify` before merge. Work one task at a time in order; report blocked dependencies and continue
unblocked work. A bench cannot replace real integration. Do not pick from Backlog.

## Tasks

- [x] **RG01 — Gather at a real gate and preview a destination** · evidence: service-backed gate + desktop/phone shots.
  Define approved feature-local contracts/repository records, implement application eligibility/preview and
  party join/leave handlers, and mount the controller/gate pane through main's kingdom/Atlas route bindings.
  Show real service-returned source/target, opted-in count and clear no-authority state. Finish keyboard/touch
  foundations and capture this first visible result immediately. Controlled transport remains SIMULATED;
  do not add an empty start/arrival success handler to fill the interface.
- [ ] **RG02 — Request one raid and leave only when it is observed** · evidence: handler/restart transport flow + stream shot.
  Implement preview claim, outbox dispatch, authenticated start/cancel/reconcile, durable action/party lifecycle
  and revision-safe observation projections. Correlate verified raid events, recover lost responses without
  duplicate writes and turn back on confirmed cancel. Connect departure to Atlas's existing public caravan
  and road ingestion. Establish the first portion of the single meaningful application integration test in
  spec 23. No timer, client crown or HTTP 200 grants landed state or a stamp.
- [ ] **RG03 — Commit a journey once, or restore the source** · evidence: real coordinator + recovery flow.
  Build the realm-side reservation/prepare/commit/ack/reconcile/cancel/recover coordinator against durable
  record and room transport ports. Handle destination admission, leased tickets, ambiguous commit, source
  fencing and rollback. Connect actual ready-world/Atlas presentation, founded arrival, waiting land/edge and
  voluntary return after source retention expires. Extend the same integration test across a lost commit
  acknowledgment; prove one walking location and source release only after destination ack.
- [ ] **RG04 — Remember only journeys the kingdom witnessed** · evidence: history handler + privacy projection.
  Implement arrival/march/source-citizen chat proof checks, durable idempotent passport stamps, authoritative
  day/reward caps and privacy acknowledgment/invalidation. Export the card section and hide switch; connect
  them to these handlers. Cover distinct false/late evidence and fewer-than-3/capped reward guards without
  mirroring every implementation branch. No public Atlas/stream payload contains personal travels.
- [ ] **RG05 — Give a real visitor gift and carry its story home** · evidence: item-transfer handler + retry receipt.
  Build offer/expiry/accept/refuse/reconcile logic against the actual transactional item repository, including
  recipient/arrival/ownership/revision/transferability checks and lineage append. Finish service-backed guest
  gift UI. Prove accepted retry cannot clone or lose the item, and bound/paid items fail. Complete the single
  application integration test with gift retry and hidden-passport projection; do not create another inventory.
- [ ] **RG06 — Show the complete journey on phone and stream** · evidence: composed integration + inspected shots/checks.
  Demonstrate actual handlers, authorized infrastructure bindings, mounted kingdom and Atlas together; retain
  the road after reload. Finish host-mixed cues, stream-safe/reduced-motion views and five/50,000 contexts.
  Run the scoped capture script and inspect the required frames/state sheets. Document exact integration and
  real-GPU/listening limits. Resolve required `needs:` before completion; fixture-only adapters cannot finish
  the lane. Run composed `pnpm verify` with main before merge.

## Backlog

Evidence-backed discoveries only. Do not pick from this list without main instruction. Shared/network freezes,
Atlas producer changes or root/storage/transport composition requests go in `progress.txt` as `needs:`.
