# Private coordinator restart proof

This harness exercises the actual queued coordinator, run state machine, current gate, approval reader,
realm authority, PostgreSQL reducer transaction and outbox. Providers return controlled lane-authored
responses. It makes no external model calls or Twitch writes and cannot establish visual judgment or latency.

Use a team-reserved free port in 5170–5189, excluding 5187. Stop no existing service. Load the private ignored
environment without displaying its values, and set `REALM_DATABASE_SCHEMA=realm_forge_wish` and
`FORGE_WISH_PROOF_PORT` before running `node --env-file=… work/lanes/forge-wish/coordinator-proof.mjs` under
`nice -n 10`. Only the isolated schema is permitted; search-path guards run before migration and afterwards.

The driver holds its permitted loopback TCP endpoint for the entire matrix, including setup and child
restarts. It forwards raw bytes to each actual native realm listener through a private Unix socket. Only
that child authenticates and handles requests; the driver does not invent HTTP results or authority state.
This avoids losing the shared test port in the gap between two owned processes.

Each invocation builds into a new mode-0700 directory under `/tmp/chatdom-forge-wish/coordinator-*`, with a
module-resolution symlink to the realm's existing dependencies. Each scenario owns its private founded files,
spool and authored citizen. The real allocator installs the native home; authenticated loopback ingress
witnesses the stream, and confirmed presence earns the coal. There is no direct balance grant.

The supervisor waits for a durable words, draft, result or exact-commit checkpoint, kills that owned child
with SIGKILL, then starts a new process over the same files and database. A fifth scenario kills the owner
after SQL commit but before its reply reaches the coordinator. A finite pending response is reclaimed under the same attempt until confirmed, with a bounded deadline.
Restart must retain attempt/run identity,
call expenditure and completed responses. Assertions count one actual commit fact, outbox entry and coal
spend, and require exactly three controlled provider calls across both owners. Only after all five scenarios
pass does the operator write `work/evidence/forge-wish/fw11-coordinator-process.json`.

Framework IPC traffic is ignored unless its kind and scenario match this proof. The initial owner retains
its writer while fixture helpers acquire their own shares, avoiding a needless fixture-only close/reopen.
The supervisor drains only its own children, and all private failure messages omit dependency bodies and
wish text. The schema is never dropped or cleared; random fixture kingdoms remain isolated there.

This is a harness-only coordinator ingress and completion path. It does not activate production Herald
admission, persist owner response delivery, serialize ceremony consumption, expose a queue UI or test two
independently deployed service lifetimes. Those FW11 acceptance requirements remain open even if this matrix
passes. The full warm-worker fifty and real-GPU queue still are separate acceptance work.
