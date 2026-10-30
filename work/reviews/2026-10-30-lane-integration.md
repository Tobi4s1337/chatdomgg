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

## Verification in progress

Typecheck, lint, build and all 415 unit tests passed on the combined main working tree. Standard capture and
integration images follow, serially with CPU affinity and low scheduling priority; no software fps claim.
