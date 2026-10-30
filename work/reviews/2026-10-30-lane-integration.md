# Lane integration review

Main reviewed the committed street-props, Hearth homes and H01 Herald branches before push. Later worktree
edits are not integration evidence. Terra high reviewed the content code and existing dusk sheets; Astra high
reviewed H01 auth behavior. Main inspected their reports and the changes.

## Content

- Street head `66c522a` contains twenty models, SP01/SP02. Full-count validation and per-model rendering were
  reported by the lane. SP03 is unchecked, with later join edits uncommitted: do not call the lane accepted yet.
- Hearth head `9e316ff` includes HH02 as well as HH01: nine models, three families through house tier. Manor/hall
  deliberately throw until HH03. Strong gables, framing and porches replace the matching baseline plots.
- Main integrates factories explicitly without exporting colliding `BLUEPRINTS` names. Plot positions, slots,
  allowed depths and full reservations remain unchanged. Garden decoration has no fabricated interaction or
  owner identity. Tests check placement outside every reserved lot and clear of road centres.
- Remaining visual concerns from the lane sheets: backlit façades, some stepped stone/foliage silhouettes and
  bramblecross's tall rear house range. Final mixed-neighbourhood acceptance remains with the lane plus main.

## Herald H01

Found a blocker: invalidated tokens, failed hourly validation and renewed tokens could retain stale healthy
capabilities; an in-flight inspection could also publish a valid-token snapshot after a failed replacement.
The correction immediately blocks, validates before reading grants, ties inspections to a generation, bounds
replacement retries and prevents obsolete reads from republishing. Six new fake-only regression cases pass.

Two followups remain in the PRD for the first long-running consumer: RequestBudget must expire queued work by
deadline, and transport must bound streamed bytes before buffering. H01's narrow command reads are integrated;
this is not a claim that ingestion, durable bindings, live chat or the real-message demonstration are done.

## Browser presence seam

Herald replay carries `origin: simulated` through the existing public contract. The adapter now explicitly
selects expected origin (`live` by default), derives its label from that selection and rejects the opposite
origin. Tests preserve schema/realm/epoch/sequence/freshness checks. No schema is widened and no simulation can
appear under LIVE. H02's PRD records the exact function/route.

## Verification

- `taskset -c 0,1 nice -n 15 pnpm verify` passed typecheck, lint, **419 tests**, build and all **19 standard
  screenshots**. Captures were serial. Main opened the twelve kingdom views as four contact sheets, the stream
  matrices and panel bench; desktop/phone town dusk were also opened individually.
- The first run caught 822,532 phone triangles against the unchanged 800,000 limit. Astra xhigh added tested
  20 m distant horizon cells with the exact 1 m collar/contact sampler. This saves 37,484 town triangles and the
  original phone gate now passes. Both far-detail settings pass full topology/normal/contact tests.
- The strengthened all-quarter field test now uses the production-selected Hearth homes. It caught sub-cell
  props falsely sealing the distant field: local 0.5 m occupancy keeps them, while the 2 m approximation uses
  buildings. Every one of the 240 designated street sources now lights and removal clears the field.
- Full twenty-prop validation and partial nine-home Hearth validation pass on main; partial does not certify the
  unfinished manor/hall collection.
- `node packages/testing/kingdom-integration.mjs` passed with **one serial page and two close captures**. Synthetic
  public SSE frames at the replay URL light Juniper's actual Hearth window; opposite-origin ingress clears all
  fields, and correct-origin recovery works. Main opened both images. This is a browser adapter proof, not real
  Twitch/Herald ingest. The report and pictures are in `work/evidence/kingdom/integration/`.
- Fixed-time frames skip identical GPU redraws while continuing transport/watchdogs. Captures were pinned to
  two CPU cores at low priority. No real-GPU timing or final art acceptance is claimed.

The new homes and garden pieces read clearly in the close view. Main and Terra still reject the wide composition:
too many blank backs, too little street separation at night, and a terraced hamlet plinth. The phone close view
also crops much of the house. These remain active look work; the wave film waits for that composition.
