# FW11 owned warm worker

Status: protocol research only, 2026-11-02. No server or inference was started. The cold provider remains current.

The installed executable reports **0.166.0**. Its help supports `app-server --listen stdio://`, protocol generation
and explicit feature overrides. Protocol generation ran successfully with a fresh empty state directory and no
authentication symlink. Generated files remain under
`/tmp/chatdom-forge-wish/fw11-appserver-protocol-20261102-out`; these are public schemas, not session state.

The official documentation describes version-specific generated protocols, initialization, separate thread/turn
requests and structured turn output. It does not establish our latency or account access. See
[the app-server protocol](https://learn.chatgpt.com/docs/app-server).

Observed in the installed generated protocol:

- `v2/ThreadStartParams.ts` has `ephemeral`, `baseInstructions`, `developerInstructions`, `cwd`, `sandbox`,
  `approvalPolicy`, `config`, `dynamicTools` and `selectedCapabilityRoots`. `Thread.ephemeral` describes no disk
  materialization. Each independent judge must receive a new ephemeral thread; no drafting history or another
  judge's answer enters it.
- `v2/TurnStartParams.ts` has `input` and `outputSchema`. `UserInput` includes inline-image URLs and private local
  images. `SandboxPolicy` represents read-only access with network disabled. Starting a read-only thread alone
  does not express that network restriction; the turn policy must include it.
- Final message text appears in completed items; the terminal turn carries status and error. A started turn is
  not a successful result. Usage notifications distinguish reported input, output, cached-input and reasoning
  tokens. Never infer missing counts.
- `turn/interrupt`, `thread/unsubscribe` and `thread/delete` exist; `thread/close` does not. Verify ephemeral
  cleanup and process death experimentally before selecting the final lifecycle.
- No generated field promises that fixed instructions are cached once, and no generic field disables every
  built-in tool. Keeping a process warm is not evidence of prompt-cache reuse or disabled tools.

The production transport still needs an owned child process group, private state and scratch directories, the
existing read-only auth symlink, bounded RPC framing/output/time, fresh independent contexts, strict schemas,
finite accounting, tool-request rejection, cancellation and cold fallback. It must never connect to or manage a
development daemon. Review how much can safely fall back after a turn starts: a lost response is still a spent
call, not permission for an unaccounted repeat. Preserve the durable queue's five/seven-call ceiling.

No warm-worker completion, cache-hit, latency, entitlement, privacy or safety claim is made by schema generation.
