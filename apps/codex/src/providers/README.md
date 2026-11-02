# Forge model providers

`createForgeProviders()` supplies the independent word gate, Codex draft, and result gate. The host orders
these, assembles the actual grammar plan, renders shaded isolated views and the actual home placement, and persists private records
before releasing an approval. A provider verdict never mints or publishes a part. The result gate sees the
original wish alongside the actual image, title and plaque.

**Policy v7: the image read is safety only.** Every read (word gate and result gate, primary and escalation)
answers the fixed floor questions and also returns `subject`: which catalogue motif and house slot the ORIGINAL
WISH's words ask for (`none` for anything else). The verdict carries the field-wise agreement of its reads
(`combineForgeWishSubject`; a disagreement is `unclear`). No read rates likeness, completeness or stray marks.

Quality is computed by the host, not read: `forgeResultMeasure` (`../quality.ts`) combines the word gate's reading,
the result gate's independent reading, the plan's motif and kind, the blind kit certificate (`../certificates`,
see `work/lanes/forge-wish/CERTIFICATION.md`) and whether the named slot exists on the home. `scoreForgeMeasure`
keeps the historical 60/25/15 weights; `forgeMeasureDetailMatch` gives met/adapted/unclear. Both readings must
agree on the plan's motif, and the motif must be certified readable, before a delivery is exact. A disputed reading
is never resolved by either read alone. The same evidence always gives the same score, so repeatability of quality is
structural; only the safety verdict comes from a model. Quality never causes a hold or refusal.

The current policy refuses only when the independent reads agree on the same safety-floor concern. A single
confident objection, different objections or uncertainty holds privately; neither read can refuse alone.
The private realm audit retains the measure, score and policy even when a wish is held or refused; no score enters
a public event. The receipt verifier recomputes the safety rule, the subject agreement and the score from its measure
before authorizing, and checks that the measure's word reading is the word gate's own.

FW10 providers expose optional `draftCandidate(input)` alongside the compatible `draft(input)` method.
Its strict result is `{draft, interpretation: 'as-wished' | 'closest', shared: 'subject' | 'family' | 'slot' | 'mood' | 'colour'}`.
The model chooses an authored catalogue motif and must mark an unsupported subject `closest`; the title and
plaque describe the actual motif, never pretend an absent subject exists. An `as-wished` result must share
`subject`. No freeform private cause is accepted: the host derives its warm private message from these enums.
Metadata is a model assertion: the gates' agreed reading of the words outranks it when the host selects the outcome.
When the word gate names a kit motif or an available slot the draft missed, the host redrafts once before any result
read. The drafter is offered the finishes that read clearly in the home's kingdom.

All three provider inputs accept an optional shared `budget: ForgeCallBudget`. `createForgeCallBudget()` starts
at five calls; `increaseLimit(7)` explicitly allows a softened wish up to seven. The host owns this decision;
providers never raise the ceiling. Every runner invocation spends one call after input validation and cancellation
checks, including failed or malformed model attempts. Exhaustion throws `ForgeCallBudgetError` with code
`FORGE_CALL_BUDGET` before another runner starts. The same ledger spans both gates, drafts and quiet retries.

All model work uses the authenticated local Codex CLI. No `OPENAI_API_KEY`, direct API call or paid-key
fallback is used. Each gate starts one fresh, ephemeral Luna run, independent of the drafting context. Complete probabilities
strictly below the pass threshold pass immediately. Otherwise it escalates to a fresh Terra run, without giving
Terra the primary answer. A malformed or unavailable primary cannot pass even if Terra passes. A refusal
requires the same floor concern from both reads. The deterministic `primaryForgeSafetyPass` and
`decideForgeSafety` exports let the receipt verifier replay policy v7. Records contain exactly the actual calls:
one Luna record on a confident pass or primary transport failure, otherwise Luna and Terra attempt records. Each retains backend, model,
policy and evidence hash; complete Luna records add thresholds, self-estimated answers and probability source;
Terra records add outcome and concerns. Every record adds `subjectStatus` and, when complete, `subject`.
No skipped model is recorded as if it ran. Luna answers the fixed versioned questions with explicit self-estimates, not calibrated
Decisions endpoint probabilities. Terra returns an independent verdict. A transport failure or timeout in
either required read throws `ForgeProviderColdError` with its actual attempt records. A failed primary read
stops immediately without spending a Terra call. Completed malformed
or uncertain safety outputs hold privately; neither authentication configuration nor a drafted plan is approval.
Records name the actual `codex-cli` backend and model; they never claim the moderation endpoint ran.

Drafting uses Terra at medium reasoning and the shared strict `ForgeDraftSchema`. Each run ignores user
configuration and project rules, disables tools/connectors, and uses read-only sandboxing. A private temporary
`CODEX_HOME` contains runtime state and a symlink to the existing auth file; credentials are not duplicated.
The existing authentication location remains read-only. Refresh/authentication failure leaves the forge cold.
Result images are bounded inline PNGs written privately and attached directly to that run, never exposed as
arbitrary filesystem paths or filesystem-tool access. Temporary evidence/state is removed after success,
failure or cancellation. Time and combined process-output sizes are bounded; cancellation kills the process
group. CLI diagnostics, account details and raw judge prose are never returned or persisted.
Executable lookup checks absolute PATH directories in order, then the directory beside the running Node
binary. That fallback prefixes only the child's PATH so the CLI's Node shebang can run; the parent's environment
is unchanged. Missing executables remain a sanitized cold failure, with no shell lookup or automatic retry.

`CodexDraftRun.onComplete` is an optional synchronous private accounting hook, called after scratch cleanup.
It receives only model, effort, finite elapsed milliseconds, a finite outcome and optional numeric token counts
explicitly reported by the CLI. Failed outcomes can include a finite failure category (configuration,
authentication, model availability, transport, spawn, output budget or unknown); diagnostic text never enters it.
Missing counts stay absent. Callback errors cannot change the model result.
Recognized usage/rate-limit diagnostics kill the process group immediately and produce the sanitized typed
`ForgeUsageLimitError` (`FORGE_USAGE_LIMIT`); raw diagnostic text is still discarded. Recognition covers the
known CLI text forms, not every possible future upstream wording. Test drivers must stop submitting wishes
when this outcome appears; the hook does not grant permission to retry an uncertain run.

`/forge-data/status` reports `judgeBackend: codex-cli` and whether the existing Codex auth file is available.
That configuration flag is not a successful authentication/health probe. The local-development endpoint still
labels its citizens simulated: room ownership, coals and durable attachment belong to the realm binding.
A real model run on that bench must not claim a real Twitch citizen or durable room placement.

This transport implements Tobias’s explicit no-local-API-key instruction, superseding the direct-HTTP
transport in the older Safety §4.2 prose. Independent safety contexts and all content/publication rules remain.
See `work/DECISIONS.md` and `policy.ts` for the current boundary and policy version.

Policy v7 identifies this safety-only image read, the subject readings and the computed score. Historical v5/v6
evidence keeps its original policy; it is never relabelled. Current approval verification rejects stale pending
audits. Committed request recovery uses the durable realm command binding rather than treating a stale audit as new approval.
