# Forge model providers

`createForgeProviders()` supplies the independent word gate, Codex draft, and result gate. The host orders
these, assembles the actual grammar plan, renders the six-angle contact sheet, and persists private records
before releasing an approval. A provider verdict never mints or publishes a part. The result gate sees the
original wish alongside the actual image, title and plaque. Safety and quality are separate outputs.

The current policy refuses only when the independent reads agree on the same safety-floor concern. A single
confident objection, different objections or uncertainty holds privately; neither read can refuse alone.
Subject recognition, completeness and incidental stray marks produce bounded quality scores, never safety
holds or refusals. Both image reads record those dimensions. Their mean is combined as 60% recognition,
25% completeness and 15% clean marks, rounded deterministically to four decimal places. This is a versioned
selection score, not a calibrated safety probability or a visual acceptance claim. Missing/malformed quality
scores become zero without changing safety. Explicit harmful text, symbols and shapes still meet the floor.
The private realm audit retains scores and policy even when a wish is held or refused; no score enters a
public event. The receipt verifier recomputes the same safety rule and quality aggregate before authorizing.

FW10 remains open: quiet result retries, explicit softening, fairer lit contact sheets, call escalation, the
walk wish box and real-wish evidence have not landed in this checkpoint. A safe low-quality candidate currently
continues through the existing approval path. The fixed twenty lane-authored wishes are in `../fixtures/`.

All model work uses the authenticated local Codex CLI. No `OPENAI_API_KEY`, direct API call or paid-key
fallback is used. Each gate starts separate, ephemeral Luna and Terra runs, independent of each other and of
the drafting context. Luna answers the fixed versioned questions with explicit self-estimates, not calibrated
Decisions endpoint probabilities. Terra returns an independent verdict. Missing, invalid or unsure checks
hold privately or leave the forge cold; neither authentication configuration nor a drafted plan is approval.
Records name the actual `codex-cli` backend and model; they never claim the moderation endpoint ran.

Drafting uses Terra at medium reasoning and the shared strict `ForgeDraftSchema`. Each run ignores user
configuration and project rules, disables tools/connectors, and uses read-only sandboxing. A private temporary
`CODEX_HOME` contains runtime state and a symlink to the existing auth file; credentials are not duplicated.
The existing authentication location remains read-only. Refresh/authentication failure leaves the forge cold.
Result images are bounded inline PNGs written privately and attached directly to that run, never exposed as
arbitrary filesystem paths or filesystem-tool access. Temporary evidence/state is removed after success,
failure or cancellation. Time and combined process-output sizes are bounded; cancellation kills the process
group. CLI diagnostics, account details and raw judge prose are never returned or persisted.

`/forge-data/status` reports `judgeBackend: codex-cli` and whether the existing Codex auth file is available.
That configuration flag is not a successful authentication/health probe. The local-development endpoint still
labels its citizens simulated: room ownership, coals and durable attachment belong to the realm binding.
A real model run on that bench must not claim a real Twitch citizen or durable room placement.

This transport implements Tobias’s explicit no-local-API-key instruction, superseding the direct-HTTP
transport in the older Safety §4.2 prose. Independent safety contexts and all content/publication rules remain.
See `work/DECISIONS.md` and `policy.ts` for the current boundary and policy version.
