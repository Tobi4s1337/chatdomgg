# Resume one admitted wish

## Decisions

- The actual Forge run is an explicit state machine. It saves returned word evidence, each returned draft,
  each completed result gate and the final selection before advancing. Recovery continues from that phase;
  it does not call completed providers again or replay earlier transient stages.
- One queue claim supplies `createQueuedForgeRunRecovery(queue, claim)` to `ForgeRunContext.recovery`.
  The adapter saves a stable run ID and start time before any model invocation. It binds the exact normalized
  wish, complete native home, host profile, trusted style kit, safety identifier, attempt and current policy.
  Changed inputs or stale policy cannot silently start a new run under existing evidence.
- Each real provider awaits a durable call debit before starting its runner. Debits survive even when a
  response was lost, and are never reset by process recovery. Five calls remains the normal ceiling; only
  explicit fit or vocabulary adaptation opens seven. An exact result still respects five after an earlier
  closest candidate opened seven.
- A gate interrupted between its first and second read has no complete saved verdict. Recovery makes a new
  independent gate attempt within the remaining budget; it never invents the missing read or refunds either
  earlier debit. This checkpoint does not cache individual reads inside an incomplete gate.
- Private snapshots retain only bounded draft data, finite judge records and execution state. Original
  provider reasons are replaced by fixed host copy. Prompt bodies, contact-sheet pixels and raw diagnostics
  are never checkpointed. The queue removes every snapshot when the actual wish ends.
- A recovery error propagates as `ForgeRunRecoveryError`. It does not become a quality fallback, safety
  refusal or terminal cold reply. The owning coordinator must suspend an interrupted/unavailable run and
  reconcile the actual realm attempt before release or terminal cleanup.

## Execution

The phases are words, drafting, assembling, selecting, approved and stopped. A draft snapshot precedes
assembly. Assembly and its sheet are deterministic and may be reconstructed; they consume no model call.
Completed candidate records retain their own attempt and verdict index, so a quiet retry cannot borrow the
first candidate's safety receipt or substitute a new title under it.

After a result returns, the run selects the best complete safe candidate using the existing quality rules,
then persists whether another candidate can start. A saved second result still reaches selection with zero
remaining calls. A resumed pending draft needs enough remaining budget for its independent result check.
An already approved state records the same immutable audit and emits the same approved run ID; it makes no
additional provider invocation. The coordinator, not this private approval event, owns world publication.

Snapshots use consecutive `run-state-<n>` IDs. Their envelope holds the policy, full-input digest, model-call
debit count and state. Other application checkpoints coexist in the same claim. A typical successful wish
uses five run snapshots; a two-candidate retry uses seven, leaving space for reservation and exact commit
checkpoints within the queue's sixteen-record limit. Every individual snapshot remains below 64 KiB.

On restore, every snapshot is checked for sequence, stable identity, source binding and monotonic call
expenditure. Word evidence is rebound to the original words. Completed pieces are assembled again from
the exact saved draft and kit; the resulting contact-sheet hash must match the actual saved judge records.
Safety, quality and detail decisions are recomputed from those bounded records, including the independent
reads that actually happened. There is no cross-wish response cache and no change to scores or thresholds.

## Ownership boundary

This adapter resumes model work; it does not reserve a home, spend coal, approve a new policy, commit a piece,
deliver a private response or schedule a public ritual. The owning application must persist its original
reservation before calling the run, and its full exact commit command before asking the realm to commit.
It must query authority status first on recovery, resolve ambiguous commits using the original command,
and distinguish shutdown suspension from a real withdrawal. The realm authority and reducer remain the
only path that can create an attachment and spend coal.

The default caller remains supported without durable recovery. Its in-memory budget still increments
synchronously. Providers support both budgets by awaiting `take`; custom providers used with durable runs
must do the same before any actual external invocation.

No warm-worker throughput, real service restart or ordered ceremony claim follows from this module's
controlled-provider tests. Those remain FW11 integration and acceptance work.
