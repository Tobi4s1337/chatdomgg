# Durable Forge binding

`createForgeAuthority(binding, options)` implements the shared `KingdomForgeAuthority` for one kingdom. It takes
counted holds from the existing `createDurableRealmServices` registry. It never acquires its own lease, grants
rights or coal, accepts a slot as ownership, writes a home outside the reducer, or publishes outside the durable
outbox. `origin` must be the repository/room origin; every held kingdom is checked against it.

Main owns boot and coordinator composition:

```ts
const gate = new ForgeWriteGate();
const approvals = new FileForgeApprovals(config.privateForgeAuditDirectory);
const repository = new PostgresRealmRepository(pool, gate.install({ origin }));
// Preserve all existing repository options/guards inside gate.install(...).
const services = createDurableRealmServices({ repository, outbox, auth, kingdom, attach });
const authority = createForgeAuthority({
  kingdomId,
  origin,
  retain: () => services.retain(kingdomId),
}, { approvals, gate });
const forge = createKingdomForgeApplication({
  authority, providers,
  record: audit => approvals.record(audit),
  publish: publishEphemeralForgeActivity,
});
```

The activity callback belongs to the existing coordinator. Durable publication comes from the room's committed
outbox; route coordinator stages as ephemeral presentation without inventing another durable attachment ledger.
Keep the room/ingress's existing retained hold for its lifetime. The authority takes and releases an additional
hold for each operation. A closed or fenced writer answers cold; cleanup/status throws if it cannot establish
a durable answer. `status(attempt)` resolves a lost commit reply using its stable command receipt.

The `ForgeWriteGate` must be installed on the same repository. Its AsyncLocalStorage context preserves each
caller's cancellation through the actual writer queue and row-lock waits. No gate means no reservation or commit.
Reserve and commit also pass `RealmCommandMeta.current` through `DurableKingdom.execute`; the repository checks
the combined writer/caller predicate again after its final SQL fence, immediately before sending COMMIT. A fallen
caller rolls back the complete fact, receipt, coal ledger, design claim and outbox while the writer stays healthy.
Release and expiry carry no caller predicate, so they remain available after cancellation.
Expiry sweeps are bounded to four abandoned reservations per new reserve. The reducer enforces the live stream,
coal, one active work per person and anvil capacity inside the transaction; reserve/release do not spend coal.
Commit rechecks actual home/revision/digest and assembled socket/kit/fingerprint, then the reducer consumes one
coal, retains displaced work, stores private creation/provenance, and produces approved public fields atomically.
Release always enters that writer queue, including when a prior timed-out reserve has not refreshed local state.
Unknown writes remain errors requiring recovery; they never become inferred refunds or success.

`FileForgeApprovals` is a private audit sink/reader, not a world ledger. Supply a persistent host-configured path
shared with the trusted coordinator. It creates mode-0600 files under a mode-0700 newly created directory, syncs
the file, atomically links each immutable key/run file, and syncs the directory before returning. Matching retries
are idempotent; changed retries fail. Receipts hash the stored audit. No HTTP/browser audit writer is provided.
Approved records require the current Codex policy and two registered independent judges at each of the words and
rendered-result gates; malformed/incomplete/held/refused records yield no receipt. Refusal/hold/cold audits store
only bounded outcome metadata, stripping provider records. No words, names, people, original message IDs or home
geometry enter this store. Registered policy questions are imported from the pure Codex policy module to prevent
drift; this does not import or invoke providers.

Focused evidence: `pnpm exec vitest run apps/realm/src/wiring`, `pnpm exec eslint apps/realm/src/wiring`,
`pnpm typecheck`. The command-port tests use the actual `DurableKingdom` registry/queue and reducer with an
explicitly SIMULATED repository and home fixtures. They cover ownership/coal/rights/live checks, cancellation at
the repository guard, expiry, competing attempts, exact attachment validation, displaced-item retention and lost
replies. They do not claim a real Postgres coordinator run or a real model-approved live attachment. No screenshots
or servers are needed for this private adapter. Main owns full verification and host capture.
The focused Postgres regression `cancellation after the final fence` additionally exercises the real SQL rollback
after fact/ledger/design/outbox writes and finalFence await, then retries the same command successfully.
