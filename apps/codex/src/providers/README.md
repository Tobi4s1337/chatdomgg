# Forge model providers

`createForgeProviders()` supplies the server runtime's independent word gate, Codex draft, and result gate.
The runtime is responsible for ordering them, supplying the deterministic contact sheet, applying local
filters, and persisting private judge records. A provider verdict alone never mints or publishes a part.
The result gate also requires the original, word-gate-approved wish. Its versioned image questions compare
the visible subject with that wish; an unrelated authored motif cannot silently stand in for an unsupported subject.

The judges use `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` (default `https://api.openai.com/v1`).
Tests can inject `fetch` and `runCodex`; production defaults use native HTTP and the actual Codex CLI.
Missing credentials or an unavailable Luna judge throw `ForgeProviderColdError`. Missing moderation,
malformed answers, ambiguous words and failed image second opinions hold the result privately.
The initial probability thresholds are explicit in `policy.ts`; they require golden-set calibration.

Drafting uses `gpt-6.1-terra` at medium reasoning with the shared strict `ForgeDraftSchema`.
The CLI runs with user configuration and project rules ignored, read-only sandboxing, no daemon,
disabled tools, and no inherited service secrets. A private temporary `CODEX_HOME` contains runtime
state and a symlink to the existing auth file; no credentials are duplicated. The existing auth location
must remain read-only. The runtime must fail cold if authentication needs refresh. Temporary files are
removed after completion, failure or cancellation. Draft time, process output and HTTP response sizes
are bounded; cancellation kills the process group. CLI diagnostics are never returned or persisted.

The configured CLI account is a development diagnostic capability. Production viewer features require
the API-backed authentication described in `chatdom/Tech.md` §11.1. No fallback substitutes a direct
Responses call for the Codex spell. Judge calls are direct API requests outside the spell context.

Implementation references: [Decisions](https://developers.openai.com/api/docs/guides/decisions),
[moderation](https://developers.openai.com/api/docs/guides/moderation),
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[CLI reference](https://developers.openai.com/codex/cli/reference), and
[CLI configuration](https://developers.openai.com/codex/config-reference).
