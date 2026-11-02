# Frozen result-gate checks

Run serially under `nice -n 10`:

```sh
node work/lanes/forge-wish/repeatability.mjs prepare
node work/lanes/forge-wish/repeatability.mjs check /tmp/chatdom-forge-wish/repeatability-<id>
```

`prepare` writes five authored constructions on actual native homes, with their exact draft, fixed wish ID,
kit ID/revision, wish hash and PNG hash, into a new private directory. It makes no model call. The wish texts
are the unchanged lane-authored fixtures; the manifest never copies them. Revision two is selected explicitly
for this content review and is not the current product kit. Its unshipped design may evolve between checkpoints;
the frozen input hashes identify each actual evaluation set.

`check` loads those PNG bytes once, validates every hash and fixed metadata field, and makes three rounds through
the actual result gate. It does not draft, assemble, render, normalize scores, cache a verdict, mint an approval
or contact the realm. The gate's normal independent safety escalation remains intact. Reads are sequential,
with at most thirty actual CLI invocations and an eight-minute deadline. Any recognized usage limit stops
further calls immediately and records `blocked: codex limit` with its time. Do not submit more wishes afterwards.

All fifteen reads must pass safety. Every actual model record must have complete, finite, bounded raw quality
dimensions under the current policy; their aggregate is recomputed and compared with the returned score.
Missing or malformed quality cannot pass as three stable zeros. Every fixture must have rounds 1, 2 and 3
exactly once, identical evidence hashes, and an aggregate score spread no greater than 0.15. Low but stable
quality is not proof of recognition. This test measures consistency, not the twenty-wish success rate.

Each run writes a separate mode-0700 result directory; numeric call accounting, raw bounded gate records and
summary files use mode 0600. Raw CLI diagnostics and original wish text are never written. Cancellation waits
for owned CLI cleanup before flushing accounting; abrupt process/kernel death cannot flush memory.

The copper/no-accent owl represents the plan described by the PRD on a chosen current native Hearth home.
It is **not** the exact October 31 raster or a recovered historical wish. The five constructions are authored
fixtures, not model-generated approvals. These checks do not establish live citizen identity, an authority
commit, a typed walk wish, production lighting, or GPU evidence.

Focused guard tests need the lane config because the root configuration includes only `apps` and `packages`:

```sh
pnpm exec vitest run --config work/lanes/forge-wish/vitest.checkpoint.config.ts
```
