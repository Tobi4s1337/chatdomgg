# Warm Forge runner

`createWarmCodexRunner()` is a drop-in `CodexDraftRunner` (see `../codex-cli.ts`). It keeps one owned
`codex app-server --listen stdio://` child alive for the Forge, so word-gate reads, drafts and result-gate reads
stop paying full CLI start-up on every call. Each call is still fully independent: a fresh **ephemeral** thread,
exactly one turn with the caller's strict `outputSchema`, then `thread/unsubscribe`. No history, instructions or
answers carry over between calls.

Built and verified against **codex-cli 0.166.0**. Protocol field names come from `codex app-server generate-ts` for
that version (`protocol.ts` lists the types used). The runner does not check the version at start-up. Re-check the
generated protocol and rerun the probe after any CLI upgrade. A refused or broken request still falls back, but a
silently changed field might not be noticed.

```ts
const runCodex = createWarmCodexRunner();          // starts warming immediately
createForgeProviders({ runCodex });                 // same seam as runCodexDraft
await runCodex.close();                             // on shutdown: kills the process group, removes state
runCodex.state;                                     // 'starting' | 'warm' | 'cold' | 'closed'
```

Options: `fallback` (default `runCodexDraft`), `stateDirectory` (parent folder, default the system temp folder),
`maxConcurrent` (default 4), `idleRestartMs` (default 20 min, 0 = never), `retryDelayMs`/`maxRetryDelayMs`
(default 5 s doubling to 2 min) and `spawn` (tests).

## Hardening (mirrors `runCodexDraft`)

- `codex --no-daemon app-server`: always our own child, started detached in its own process group. It never
  attaches to, starts or manages the shared development daemon. The group is SIGKILLed on `close()`, on any
  protocol fault and when the owning process exits.
- Private state: a `mkdtemp` folder (0700) per server with `home/` as `CODEX_HOME`. The folder contains only a
  symlink to the existing `auth.json`, made exactly as the cold provider makes it; credentials are never copied
  or read. There is no user config, rules, skills or memories. `scratch/` holds a fresh 0700 folder per call: the
  thread's empty `cwd` and, when evidence is given, `evidence.png` (0600, `wx`), deleted after the turn.
- Minimal environment: only `PATH HOME LANG LC_ALL TMPDIR SSL_CERT_FILE SSL_CERT_DIR` plus `CODEX_HOME`.
- Process flags: the same 16 `--disable` features, `approval_policy="never"`, `sandbox_mode="read-only"`,
  `web_search="disabled"`, `tools.view_image=false`, `mcp_servers={}`, `project_doc_max_bytes=0`.
- Thread: `ephemeral: true`, `sandbox: 'read-only'`, `approvalPolicy: 'never'`, model, private `cwd`,
  `config.model_reasoning_effort`. Turn: `sandboxPolicy: { type: 'readOnly', networkAccess: false }`,
  `approvalPolicy: 'never'`, `effort`, `outputSchema`. The prompt is sent as the user input, unchanged; base and
  developer instructions are left at the CLI defaults, as in `codex exec`.
- Every request the server makes is refused. Command and file approvals get `decline`, legacy approvals get
  `denied`, permission requests get an empty grant, elicitations get `decline` and dynamic tool calls get
  `success: false`. User-input, credential-refresh, attestation and anything unknown get a JSON-RPC error.
- Bounded: 256 KiB of agent text per call (`output-budget`), 8 MiB per protocol line (beyond that the server
  is treated as broken). stderr is drained and discarded; diagnostics are never kept or returned.
- Same failure semantics: it throws on failure, and `ForgeUsageLimitError` on `usageLimitExceeded`,
  `rateLimitExceeded`, HTTP 429 or usage-limit text (the turn is interrupted at once). `onComplete` is called
  exactly once with outcome, elapsed ms, failure category and reported `total/input/output` tokens; it never
  receives content. Cancellation through the caller's signal sends `turn/interrupt`. If the server does not
  confirm within 10 s, it is replaced.

## Fallback rule

- **Before a turn starts**, a call runs silently through `fallback`. This covers a server that is still
  starting and then fails, one that is `cold`, one that crashes or breaks protocol, a `thread/start` that hangs,
  and an explicit JSON-RPC refusal of `thread/start` or `turn/start`. The fallback reports its own `onComplete`,
  with the time already spent added to `elapsedMs`.
- Crashes, protocol faults and failed starts make the runner `cold`. It then retries a warm start in the
  background (5 s doubling to 2 min, reset after a success). A plain RPC refusal keeps the healthy server.
- **After `turn/start` is on the wire**, the call is spent. If the server dies, the call throws
  `The Forge drafting connection was lost.` with failure `transport`, and it is **not** rerun. The caller's
  budget and retry logic see exactly one call. We treat "on the wire" conservatively: a request written just
  before a crash counts as spent even if the server never read it.
- Fallback use is not logged anywhere. The only signal is `state`.

## Measured (2026-11-02, this host, gpt-6-luna, effort low, schema `{answer: string}`)

Probe: `FORGE_WARM_PROBE=1 pnpm exec vitest run apps/codex/src/providers/warm/probe.test.ts`. It makes five
real calls, one after another, and stops at any usage limit. No limit was reported.

| Path | Call | Elapsed ms | Tokens reported |
|---|---|---|---|
| warm server start-up (no model call) | – | 873 | – |
| warm | 1 | 1965 | total 12411 (input 12396, output 15) |
| warm | 2 | 3221 | total 12409 (input 12394, output 15) |
| warm | 3 | 1987 | total 12409 (input 12394, output 15) |
| cold `runCodexDraft` | 1 | 4532 | total 4578 |
| cold `runCodexDraft` | 2 | 5853 | total 12387 |

All five returned schema-valid JSON, and the fallback was never used. Warm calls took about 2–3 s; cold calls
took about 4.5–6 s. A JSON-RPC handshake on a fresh process took about 1.2–1.4 s in earlier no-credential
checks, which is most of what each cold call repeats. Cold token totals come from the CLI's `tokens used`
summary line. The two cold runs differ a lot (4578 and 12387), and that line is not defined the same way as the
app-server breakdown, so the token columns are not comparable between paths.

## Not claimed

- No prompt-cache or cached-instruction reuse. Every call is a new thread. The app-server reports
  `cachedInputTokens`, but the runner does not record it, and keeping a process warm is not evidence of caching.
- No general latency figure: five sequential calls on one shared server host, with no load and no concurrency.
  Real-model concurrency at `maxConcurrent > 1` was only exercised against the simulated server.
- No check of model behaviour under the sandbox. No tools are offered (features disabled), and refusals of
  server requests are only proven against the simulated server, because a real model never asked for a tool
  here.
- Thread unloading after `thread/unsubscribe` was not measured over a long run. `thread/delete` is refused for
  ephemeral threads ("not persisted"), so unsubscribe is the only cleanup this version offers.
- No compatibility with a CLI other than 0.166.0.

## Tests

`warm.test.ts` drives `fixtures/fake-app-server.mjs` (SIMULATED, no model or network). It covers the handshake
and private state, structured turns with usage, denial of every server request, cancellation with interrupt,
usage limit and failure classes, the output budget, PNG evidence, fallback before a turn with cold-then-warm
recovery, a failed start, a refused thread, a crash mid-turn that counts as spent, the concurrency bound, idle
replacement and close.
