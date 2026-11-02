# FW11 recovery contract

Status: private queue core and resumable coordinator under construction. This does not replace FW11's acceptance checks or certify the
current Herald handoff as durable. The accepted ritual and the two independent model gates stay intact.

## Decisions

- **2026-11-02 — Persist replies with cleanup and reserve the head's anvil first.** One atomic terminal
  replacement erases words/checkpoints and saves a finite owner reply. Transport success never consumes it;
  only the exact authenticated owner ACK does. Withdrawals persist monotonic witnessed source cutoffs under
  the same filesystem owner and fence active work synchronously. The bounded worker suspends on shutdown or
  temporary authority/storage loss. Later drafts wait until earlier work has confirmed its reservation or
  terminal intent, then first commits remain arrival-ordered at the actual transactional lease. A reserve
  proposal's full command digest gets its own repository identity, avoiding changed-expiry conflicts after
  a capacity race. No production admission or ceremony-consumed cursor is activated by this checkpoint.
- **2026-11-02 — Keep the arrival and its attempt together.** A durable arrival owns the exact canonical command,
  a keyed payload binding, one attempt ID and its queue sequence. A duplicate may observe this work; it may not
  change its words, maker, home selector or observation time. A restart preserves that identity. The authority's
  message key remains the final one-piece/one-coal barrier.
- **2026-11-02 — Process death is not a moderation decision.** Losing a worker returns unfinished work to the
  queue with its checkpoints and call expenditure. It must not call `release` merely because the service is
  stopping: the existing authority makes a release terminal for that message. A real withdrawal must revoke
  the worker before its transactional write and persist that decision before acknowledging cleanup.
- **2026-11-02 — A checkpoint is private input, never approval.** Stored stage data must be checked against the
  exact command, policy, home digest, kit revision and actual call records. Only the existing private approval
  reader plus the realm transaction can authorize a piece. The queue does not spend coal, mint attachments,
  publish a reveal or accept a browser-provided approval.
- **2026-11-02 — Do not activate an incomplete recovery adapter.** The ordinary nonqueued coordinator creates a new run
  ID and budget, emits transient stages, and releases on interrupted work. Reopening a durable command through
  that coordinator unchanged would discard its expenditure and could strand its reservation. The durable queue
  must not be connected to the accepted Herald route until the stage, budget, uncertain-commit and withdrawal
  paths below work together. An interrupted wish must not be turned into a terminal cold reply just to empty
  the queue.

## Implemented private execution boundary

`createQueuedKingdomForgeApplication` now provides trusted optional execution hooks to the existing coordinator.
It persists the original reservation and exact input binding before any model work, supplies an explicit
queue-backed run state machine, and saves the full original commit command before the authority transaction.
Completed gates and drafts resume under the same run identity, start time and spent-call budget. A gate killed
between its independent reads repeats only within retained expenditure; individual unfinished reads are not
cached. Restored evidence recomputes policy decisions and binds the exact assembled contact-sheet pixels.

Status outages and unknown commits suspend without terminal release. Confirmed committed recovery submits
the original saved payload to the actual authority; its repository command digest remains decisive even after
the prior reservation or service lease expires. An explicit withdrawal saves terminal intent before cleanup
and reconciles a possible committed race. Dependency failures stay finite private pending outcomes.

The adapter intentionally does not finish the queue or deliver a response. The private `wish-worker` now
owns bounded scheduling, durable completion and non-consuming projections. The queue persists withdrawals,
owner replies and exact owner ACKs; first reserve/commit predicates prevent priority inversion and out-of-order
new commits. Actual owner consumers, production admission/lifecycle and ceremony processing remain unconnected.
The existing production Herald route is still unchanged. Exact checks and isolated-process evidence are in
`work/evidence/forge-wish/fw11-coordinator-checkpoint.md`. No module-level restart test
certifies its admission, independent realm/service lifetime or ceremony behavior.

The worker's projection callbacks receive an abortable lifetime lease and are capped separately from model
executions. Failed callbacks back off, a hanging callback does not stall model work, and a completed callback
never ACKs the owner. The integrating service must settle its actual transport resources on shutdown and
reconcile lingering transient activity IDs. See `SEAMS.md` section 11 for the exact reliable Herald cleanup
metadata/handoff requirement and owner consumer gap. Queue lifetime metadata still needs indexing.

## Ownership and durable boundaries

The private spool belongs to one host process at a time, in an explicitly configured persistent directory.
An operating-system lock fences a second owner; no timestamp or process-ID guess steals it. A process death
releases the lock. The next owner recovers unfinished claims, keeping their attempt and call count. A retained
in-process claim must be revoked on retry, finish or shutdown and cannot overwrite a later generation.

Files containing words or stage artifacts are mode 0600 beneath a mode-0700 directory. A canonical keyed digest
binds duplicates without retaining guessable plaintext in terminal metadata. Successful terminal storage removes
the command and stage artifacts; successful creation words remain only in the realm's existing private made-piece
storage. Other terminal outcomes retain only finite outcome metadata. Atomic replacement must be synced before
acknowledgment, and crash residue must not preserve an earlier plaintext command after terminal cleanup. A broken
or ambiguous record fails closed; it is not silently treated as a new arrival.

## Required production adapter

1. **Admission.** After authenticated origin/schema checks, durably enqueue before returning 202. A capacity or
   storage failure is retryable and returns no accepted claim. Both the in-process sink and HTTP handoff must use
   the same admission path. Bind the complete payload before deduplicating; an active in-memory promise alone
   cannot detect changed duplicate words. No browser request may choose an attempt ID.
2. **Claim.** Bound the number of model workers. Claim in accepted sequence, keep one thing in the fire per maker,
   and leave busy-authority work queued rather than burning its terminal release receipt. Capture one trusted
   host snapshot and style kit, and persist the reservation and their full binding before using any saved result.
3. **Calls and stages.** Preserve a stable run ID, start time, candidate count, selected candidate, gate records,
   retry feedback and normal/softened call ceiling. Durably debit each actual model invocation before starting it;
   completed responses are bound and persisted before advancing. An invocation interrupted before its response is
   stored remains spent. Reusing a stored response from this exact run must not make another call or invent another
   read. Reconstruct the five/seven-call budget from actual retained expenditure; never reset it on restart.
4. **Recovery.** Query this attempt's authority status before new model work. A committed attempt recovers the
   actual stored piece and owner-only outcome; a receipt alone cannot authorize a changed payload. A reserved
   attempt resumes only with matching current rights, night and home/kit binding. An unknown commit stays pending
   until its original transaction can be resolved. An expired or genuinely revoked reservation gets an honest
   private outcome without another spend. An unavailable status lookup is not proof of rollback.
5. **Commit.** Persist the exact selected request before asking the existing authority to commit. Retry only that
   request after ambiguity. Keep current-policy approval, original-command digest checks, the write gate and the
   realm reducer. The outbox remains the only durable public committed-piece producer.
6. **Presentation and replies.** Persist the presentation cursor separately from worker completion, so concurrent
   drafts can finish out of order while one accepted ritual plays at a time in sequence. Restored or duplicate
   work must not replay an already-consumed ceremony. Keep owner-only terminal receipts durable and idempotent;
   a failed observer is not permission to run the wish again. Expose queue count publicly, a person's own position
   privately and maker names only to the authenticated broadcaster. Never expose words, private reasons or stages
   of a refused wish as a public queue record.
7. **Withdrawal and shutdown.** Persist message/person/kingdom withdrawals even before the wish arrives; fence
   active work synchronously before awaiting storage. Keep shutdown suspension distinct from deletion, stream
   offline, lost moderation coverage and a ban. Reconcile a possibly committed attempt before erasing words or
   claiming a refund. Stop workers, settle owned I/O and then release the process lock.

The Forge-owned evening bridge is the admission/lifecycle seam. Its speech and presence behavior are outside this
change. Small typed setup/start/stop hooks in realm boot are allowed by the round notes and must be listed in
`SEAMS.md` when implemented. The development `/forge-data/run` room is not the production authority path and does
not establish recovery of a citizen's wish.

## Current checkpoint evidence

The isolated real-SQL coordinator harness now passes five actual process-kill/reopen cases: words, drafting,
result, saved commit, and committed SQL with a lost reply. Each keeps the same attempt/run, three controlled
provider calls, one fact/outbox entry and one coal spend; one pending reconciliation is observed. The final
private directory is `/tmp/chatdom-forge-wish/coordinator-rFtGgk`. See the checkpoint report and machine evidence.
This is one combined owned process at a time, not independent production Forge and realm lifetimes or
durable owner delivery and ceremony consumption. Those acceptance checks remain below.

## Evidence required before FW11 can be checked

- Reopen actual durable files after process termination at arrival and each checkpoint; assert exact attempt,
  payload binding, order, call expenditure, revocation and erased terminal words. Exercise two live contenders,
  stale claim writes, torn records and path/symlink rejection.
- Controlled-provider restart tests at words, drafting, result and commit, including lost commit reply, unavailable
  status, offline/moderation races, and shutdown. Count actual facts, coal, outbox reveals and private responses.
- Repeat those stage terminations against separately owned served Forge/realm instances and the isolated
  `realm_forge_wish` schema. A standalone file-spool test does not satisfy this acceptance item.
- Demonstrate three near-simultaneous wishes with bounded model concurrency and ordered single rituals.
- Run the owned warm worker's frozen fifty only at the end, retaining real accounting and comparing with FW10.
  No warm-worker, latency, typical-call-count or ninety-percent delivery claim follows from queue tests.
- Capture and inspect the actual anvil queue on a real GPU. A headless queue test has no visual acceptance value.

FW10's failed result-judge calibration, actual walk intake seams, saved-kit integration and outstanding real-wish
proof remain open. They are not waived by starting FW11 under the recorded three-strike exception.
