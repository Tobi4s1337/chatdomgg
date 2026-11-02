# PW13 checkpoint — 2 November 2026

PW13 remains unticked. The previous checkpoint was progress; this turn closes its Configuration Service ordering gap without changing the remaining acceptance bars. Earlier goal boxes also remain unticked. No Twitch writes, console actions, deployment or push occurred.

## Current implementation

Config and Live Config now use a server-owned published copy. A broadcaster save commits preferences and its outbox obligation in the same realm transaction. Hide gates gifts immediately through the existing realm writer fence; pending paid obligations survive. The browser never calls Helper configuration set. It polls authenticated `configuration-sync` and shows Saved only for a verified publication matching the exact current revision, preferences and connection. Pending changes remain visible and can be checked again without another save. Unsaved edits cannot be confirmed by checking an older publication.

The new `0012e_realm_panel_mirror.sql` stores one coalesced obligation per channel and an origin binding/quota row. Startup activates the trusted Extension Client ID with a durable generation. Same-client replicas share it; changing Client IDs makes old channels eligible without reopening Config, and old workers remain fenced even if the deployment later returns to their former Client ID. The active deployment configuration is trusted authority: deliberately restarting obsolete configuration can activate its old ID again. One realm origin serves one active Extension.

At most two claims run across all replicas. Claims last 30 seconds; every permit and completion requires the current binding generation and fresh claim ID. Dirty preferences and deployment rebinding precede routine audits, oldest-first within each class. No writer or database row lock spans external HTTP. The shared SQL quota conservatively spaces all configuration GET/PUT requests by at least 3,100 ms. Failure backoff grows from 6.5 seconds to five minutes. Each HTTP fetch plus response stream has a hard five-second local deadline, even if an injected transport ignores abort. Public content is bounded to 3,072 UTF-8 bytes; provider JSON to 8,192 bytes.

The worker signs owner JWTs, GETs Twitch's segment, PUTs only when needed, then verifies by GET. Unknown versions, wrong channels, oversized responses and mismatched readback stay pending. A successful audit is scheduled again after 60 seconds; verification evidence also expires after 60 seconds if the worker stops. Audit and repair latency includes backlog and provider recovery. A database fence cannot prevent an already-dispatched old HTTP write: the demonstrated guarantee is eventual convergence after delayed requests settle, not cross-service atomicity or a fixed repair deadline.

Routine same-identity Twitch authorization refresh now retains unsaved edits and their original expected revision. Identity/role changes clear the form; stale requests cannot replace it. Product enumeration runs independently, so a hung Helper lookup cannot block settings or Live Hide. The strict settings parser also now rejects array-valued bands instead of coercing them to strings.

## Verified

- The backend's 33 focused checks passed across settings, mirror SQL, publication and authentication. After the final priority correction, all eight mirror SQL checks passed, including a newer actual CAS save ahead of an overdue verified audit.
- A broader five-file realm regression run passed 40/40: settings, mirror, gifts, service and internal HTTP. It uses disposable `panel_window_test_*` development schemas, real Postgres, existing allocation/writer/ingress and durable paid-gift paths. Its seven-test mirror suite preceded the additional priority case above; these counts are not additive.
- The client, Helper and production adapters passed 56 focused checks. Two parser regressions passed separately. The independent review also ran 45 focused checks and found no remaining P1/P2 after the corrections; the final priority test was then reviewed separately.
- The final HTTP suite passed 7/7. The real-stack browser suite passed 2/2 with signed Helper tokens, a real realm/API and an explicit fake Twitch provider. It proves join/light, selected bands, actual server-side Configuration Service PUT/GET, no premature Saved while verification GET is held, Hide/Resume, draft retention on refresh, clearing after identity change, and working Hide despite never-resolving product enumeration. The witness's polling clock is paused for the PubSub phase; relay-to-caption was 172 ms locally. The separate PW12 test retains real polling. This is not live Twitch latency or production effect proof.
- The held-old-PUT test does not merely replace a fixture value between ticks: it times out an unresolved PUT, publishes and verifies a newer revision, releases the old request so it overwrites the remote value, then demonstrates audit repair and a latest-revision acknowledgement.
- Final scoped TypeScript and changed-file ESLint checks passed. Panel, realm and public API SSR builds passed. The realm was rebuilt after the final SQL priority change. Existing content dynamic-import warnings are unchanged. No root suite or `pnpm verify` ran.
- The frozen additive migrations were applied only to the lane's `panel_window` development schema: `0012d` and `0012e`. No applied migration was rewritten. The final browser used realm 5170, API 5171 and panel 5172; all were stopped and its disposable schema removed. Parent Vite 5182 was also stopped.

Browser reproduction:

```sh
REALM_DATABASE_TESTS=1 PANEL_BROWSER_TESTS=1 node \
  --env-file=/tmp/panel-window-realm.env node_modules/vitest/vitest.mjs run --no-fsModuleCache \
  apps/api/src/panel/gifts/browser.integration.test.ts
```

## Visual and packaging evidence

The single permitted SwiftShader fallback this turn is `work/evidence/panel-window/PW13/config-pending@318x496.png`, inspected at native size. Its 41 visible words exclude decorative glyphs. The pending notice and Check Twitch again button are readable in the wood/parchment composition; targets meet 44 px and there is no horizontal overflow. Config intentionally scrolls as a document. This is a fixture layout, not proof of real Twitch storage. Lower controls, Live Config and the mobile matrix still require GPU review. The earlier `config@318x496.png` remains historical evidence, not a replacement for that matrix.

The full batch used `--wait 30 --max 10` and returned exit 3 immediately because GPU Chrome was disconnected. It created no live queued job or leased services. Shared lease contention is not a PW11 blocker. The batch includes PW11's street/painter/privacy sequence, PW12 gift states, and Config, pending Config, bands and Live Config at both sizes:

```sh
chatdom-pc-lease --wait 30 --max 10 -- node \
  --env-file=/root/.config/chatdom/atlas.env --env-file=/tmp/panel-window-realm.env \
  apps/panel/scripts/pw12-capture.mjs
```

These are static views, so no fps run or GPU performance claim is needed. Do not restart an already queued command. Capture services remain realm 5172, gateway 5191 and panel/harness 5192, with PW11 selecting additional free 5170–5186 ports.

`node scripts/public/extension.mjs` rebuilt assets but correctly failed its strict simulation-string guard in the shared Passport viewer/window chunks. No uploadable zip is accepted. The local asset graph, including referenced fonts and textures, is Panel 901,655 bytes; Mobile 901,640; Config 634,649; Live Config 634,654. Twitch's remote Helper and API payloads are outside those local-byte totals.

## Remaining acceptance

- The extension owner identity cannot be bootstrapped from the two specified credential values. Health names `TWITCH_EXTENSION_OWNER_ID`; the original two-value outcome is still unmet. A request for the actual registration owner is pending; no destination-channel identity was guessed.
- Main/Herald must supply the real founding entry with Tier 1 consent. The exact grants patch remains unapplied outside this lane. Front-door must supply the live-only Passport entry before packaging can pass. See `PW13-NEEDS.md`.
- Full GPU stills, real Twitch mobile evidence and the existing production effects seams remain open. New credentials, preferences and products never fabricate effect readiness.
- Hosted Test has not run and C04's real purchase bar remains open. `HOSTED-TEST.md` has 15 steps and ends with the first real test-mode gift; local receipts and a test-only atomic effect dispatch do not satisfy that purchase bar.

Next remains PW13. The ordered mirror request is resolved; continue the remaining owner, packaging and capture requirements without treating this checkpoint as lane completion. See `PW13-CONTRACT.md` and `references/configuration-outbox.md` for the design and its source study.
