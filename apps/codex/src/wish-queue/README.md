# Private wish recovery

## Decisions

- One local process owns one spool through an advisory lock on a permanent inode. Its open file descriptor
  keeps the lock; process death releases it. Another process cannot guess that an owner is dead from a PID,
  a stale timestamp or an unresponsive model. Multiple independent workers live within that owner.
- A wish is durably admitted before acknowledgement. Its kingdom and source message identify one entry; a
  private keyed digest binds the full canonical command, including maker, words, slot hint and observation
  time. The same source with changed content conflicts, including after terminal privacy cleanup.
- Each entry receives a persistent arrival sequence and attempt ID. Reopening keeps both. Only worker
  ownership changes; neither a process restart nor a claim retry resets spent model calls or judge evidence.
- Every actual model call must debit the queue before execution. An unanswered call still consumes its
  ordinal after a crash. Five calls is the normal limit; a trusted fit or vocabulary adaptation can explicitly
  extend it to seven. The queue does not decide whether that adaptation was justified.
- Checkpoints are immutable, bounded private JSON snapshots. Reusing an ID with different data conflicts.
  They confer no authority. The resuming application must validate current policy, exact candidate, home,
  registered kit, safety evidence and actual call accounting before it can ask the realm to commit.
- Only a confirmed terminal result permits `complete`. It atomically replaces the private record with a
  word-free receipt AND its finite owner message, dropping all checkpoint data in the same write. Legacy
  `finish` remains available without an owner message. A lost filesystem acknowledgement poisons this owner
  and revokes its workers; reopening discovers the actual durable state before further work.
- A witnessed withdrawal is durable historical evidence. Exact message tombstones are permanent; person
  and kingdom watermarks cover wishes observed at or before the original cleanup timestamp. They survive
  before-arrival delivery and restart, never expire and never turn into a ban on future wishes. Current
  eligibility, bans, temporary restrictions, stream status and moderation coverage remain realm decisions.
- One logical owner outcome can be transported repeatedly. `toOwner` is not a recipient acknowledgement.
  Only an explicit exact owner acknowledgement changes its `acknowledged` flag. Neither reading a result,
  notifying an observer nor handing it to a socket consumes it.
- Terminal receipts remain durable idempotency tombstones. They are never silently evicted to make a test
  pass. Long-running metadata indexing and archive strategy remain integration work before launch.

## Storage and ownership

`FileForgeWishQueue.open` uses a dedicated local directory with mode 0700 and regular files with mode 0600.
It refuses symlink ancestors, symlink files, hardlinks, foreign ownership and unsafe existing permissions.
Every child operation is anchored to an open directory descriptor. FIFO reads use nonblocking open before
checking the file type, so corrupt input cannot hang startup. Unknown files or corrupt authenticated records
fail closed; startup never interprets arbitrary filesystem contents as a successful wish.

`queue.key` is a randomly generated local HMAC key. It protects the input binding and each complete record.
`queue.json` fixes the format and realm origin. `owner.lock` is a permanent inode and must never be removed
while the spool exists. `wish-<digest>.json` is the private recovery snapshot and contains words until the
wish ends. Metadata-only receipts omit those words and all checkpoint data. Operational logs retain neither
words nor model prose nor exception bodies.

`withdrawal-<digest>.json` holds one signed, bounded scope predicate beneath the SAME filesystem owner.
The filename binds the kingdom, target kind and target identity. These files use the queue key, private
permissions, atomic replacement and directory sync; there is no second lock or unsynchronized sidecar owner.
Startup validates origin, MAC and target filename before it allows any work. A broken withdrawal fails
closed instead of reopening the wishes it protected.

An update writes a uniquely created private temporary, syncs it, renames it over the record, and syncs the
directory. Acknowledgement comes afterwards. On restart, the new exclusive owner removes unacknowledged
private temporaries, validates every accepted record and changes interrupted running entries back to queued.
The record replacement erases accessible queued copies of terminal words; it is not forensic media erasure
and does not claim to purge filesystem snapshots or backups. The configured directory must live on a local
filesystem with working advisory locks and durable sync semantics, not a shared network volume.

## Worker contract

`enqueue(command)` returns queued or existing metadata. `claimNext({ excludeKeys })` chooses the oldest
eligible wish, bounded by `maxConcurrent`, while allowing a scheduler to park a slow dependency or saved
commit. Only a maker's earliest unfinished wish in that kingdom can be claimed, including when it is parked.
Another maker may proceed while an older second wish from that citizen waits. Claim generation, object identity and an
abort signal fence old workers after retry, expiry or close. A caller must carry `claim.current` through
every authority await and transaction check; a queue cannot prevent an adapter from ignoring its lease.

`withdraw({ kingdomId, reason, scope })` installs its in-memory barrier and aborts matching
`claim.withdrawal` signals before returning its persistence promise. Await that promise before acknowledging
cleanup. It does not abort `claim.signal` or invalidate ownership: a worker still needs to reconcile a
possibly committed transaction, checkpoint terminal intent and clean up. A matched delayed arrival gets an
already-aborted withdrawal signal when claimed. New model debits are refused for withdrawn work. Storage
failure poisons the owner; it cannot quietly forget an accepted fence. `close` suspends claims without
creating any withdrawal or releasing an authority reservation.

Through timestamps must come from immutable source evidence. Presence observations already carry them.
The legacy Herald `forge.clear` envelope does not: assigning a new cutoff on each retry would cancel newer
wishes, while deduplicating its identical body forever would miss a new clear. A stable cleanup source seam
is required before production admission can claim complete restart-safe pre-arrival room-clear coverage.

`beginModelCall(claim, stage)` persists a debit before the provider is called. `checkpoint` persists the
returned result under a new checkpoint ID. Claim snapshots are detached values, not live views; `get` reads
current finite accounting. `retry` releases the worker while keeping the same attempt and every private
checkpoint. `complete(claim, { terminal, message })` retains the finite actual owner outcome in the terminal
record. The queue derives its stable reply ID from the original source message; no caller chooses another
identity. Neither method releases a realm reservation, spends coal, sends a message or plays a ceremony.

`ownerOutcomes(kingdomId, personId, { afterSequence, limit })` returns private sequence-ordered pages of at
most 32 finished receipts with their `delivery`. It includes acknowledged results so pagination does not
imply receipt. Reads never mutate them. An owner adapter replays unacknowledged results on join/reconnect;
the transport and UI deduplicate the stable reply ID. `acknowledgeOwner(kingdomId, personId,
{ key, attemptId, replyId })` checks every identity against the saved outcome and durably marks the exact
receipt. Calling it requires an authenticated owner acknowledgement, not a successful transport callback.
No public acknowledgement route is supplied here. Finite messages remain stored after acknowledgement;
there is no TTL that silently loses an absent citizen's outcome.

`list` and `get` are private operational projections. They omit words and checkpoint data but include source
IDs, person IDs and terminal outcomes; they must not be exposed as public queue routes. A public anvil view
needs its own count/position projection, and a named broadcaster view needs authenticated authorization.

## Budgets and ordering

The defaults are two active claims and 128 pending wishes. Configuration allows 1–64 workers and at most
4096 pending entries. Claims last at most ten minutes. Each wish retains at most sixteen checkpoints, each
at most 64 KiB, with depth and node-count limits; its signed record cannot exceed 1.1 MB. Image pixels should
remain in their separately owned private artifact store, referenced by exact content digest in a checkpoint.
No request body, exception object, executable value, getter or nonfinite number belongs in recovery data.

Each owner message is at most 240 characters, and each signed withdrawal file is at most 2048 bytes. Scope
checks use three indexed lookups. Tombstones are never evicted; terminal receipts and withdrawal predicates
currently load at startup, so lifetime metadata memory and startup time grow with total source identities.
Disk indexing/archival needs an explicit retention contract before that can be called bounded at launch scale.

Disk writes serialize through one asynchronous queue and run no rendering or synchronous filesystem work on
the web frame path. Each durable transition costs a file sync and directory sync. These are correctness
costs to measure with the actual service, not claimed latency results. Terminal receipts currently load at
startup, so lifetime tombstone memory and startup time grow with total wishes; that limitation is explicit.

`canCommit(claim)` grants first-commit eligibility only to the earliest unfinished accepted wish in its
kingdom, with a current claim and no matching withdrawal. Other kingdoms are independent. Completion changes
that durable order only after its atomic terminal write. The service must carry this synchronous predicate
through the FIRST authority commit's actual transaction lease; exact recovery of an already committed
command bypasses the ordering gate because it creates no piece or outbox row. Workers can draft concurrently
and park later exact saved commits through claim exclusions. Queuing alone does not enforce commit order.

This cursor records commit eligibility, never that a viewer saw a ceremony. The realm outbox remains the only
durable committed-piece producer, and its at-least-once deliveries keep their event IDs. The existing Forge
scene serializes committed pieces and restores standing snapshots without replaying history. A separate
played/consumed ceremony acknowledgement cannot be invented from worker completion or a transport callback.

## Remaining production integration

This module is a recovery core, not the completed FW11 service. The existing evening bridge and development
route do not use it yet. The private `kingdom-forge/recovery` and `run-recovery` modules now implement the
validated attempt/stage/budget/exact-commit execution boundary. Before activating durable admission, complete
the owning service lifecycle around that boundary:

1. Acknowledges authenticated arrival only after `enqueue` completes and resolves source duplicates privately.
2. Persists and reuses the same realm attempt, reservation, trusted home/kit and exact commit command.
3. Separates service interruption from moderation/offline revocation; interruption must not call the existing
   terminal `release` path and then pretend the same attempt can reserve again.
4. Debits every provider call durably, persists independent judge results and candidate selection, and resumes
   from validated checkpoints without reusing an unchecked draft or resetting the five/seven-call budget.
5. Recovers uncertain realm commits through the actual authority before producing one terminal receipt.
6. Retains one private outcome delivery and one ordered ritual presentation per wish across restarts.
7. Deletes any separate private artifacts at terminal completion and keeps words only with a committed piece.

The existing authority remains the only writer of attachments, coal and public outbox entries. A queue
checkpoint, a local terminal receipt or a model approval must never stand in for its durable transaction.

## Prior art

The implementation is original. The [write-file-atomic implementation](https://github.com/npm/write-file-atomic/blob/main/lib/index.js)
was studied for serialized writes and the temporary-file/sync/rename sequence. We additionally sync the parent
directory, refuse links and unsafe modes, authenticate records, fence the whole owner, and poison ambiguous
writes. No source code was copied. Linux's [flock contract](https://man7.org/linux/man-pages/man2/flock.2.html)
establishes ownership by the inherited open-file description, and its [fsync contract](https://man7.org/linux/man-pages/man2/fsync.2.html)
requires the separate directory sync for directory-entry durability. These techniques complement the existing
private approval store; approvals remain immutable and separate from resumable queue snapshots.

RabbitMQ's [acknowledgement guide](https://www.rabbitmq.com/docs/confirms) distinguishes producer acceptance
from consumer processing. We retain that boundary: saving a terminal outcome, projecting it to Forge chat,
transport handoff and an authenticated owner's acknowledgement are separate facts. No broker or reference
implementation was copied or added as a dependency.

## Bounded service worker

`wish-worker/ForgeWishWorker` is the private scheduling owner around this spool and the queued coordinator.
It admits only after the queue's durable enqueue, runs at most two executions by default and never starts
another execution for a key whose previous execution is still settling, even after claim expiry. A parked
claim keeps its attempt and expenditures; its maker's later wish cannot overtake it. Temporary capacity and
authority dependency failures retry with backoff. Shutdown aborts a lifetime lease and suspends unfinished
work; explicit withdrawals use the separate durable predicate and signal.

`canReserve(claim)` prevents later wishes occupying the anvils before earlier work has acquired its own.
An earlier unfinished wish must have its coordinator's saved `application-binding` or terminal intent before
later preparation proceeds. That checkpoint follows a confirmed actual reservation. It grants no authority,
coal or approval; the realm still checks its current state. Once bound, interrupted work resumes that same
reservation or confirms its expiry/release, rather than acquiring a fresh one. Combined with `canCommit`,
this allows concurrent drafts without stranding an unreserved head behind parked later commits.

`complete` precedes the optional `completed(receipt, lifetimeLease)` projection callback. Callback concurrency
is bounded separately, failures back off, and a hanging callback neither blocks model work nor starts a second
callback for the same reply. A successful callback does not acknowledge delivery. Unacknowledged replies replay
on a new worker; an actual authenticated owner adapter must deduplicate the stable ID. Callbacks receive the
worker's lifetime lease and must fence/cancel their own transport operations when it falls. They never own
queue writes; `stop` settles executions and the pump, rather than waiting forever for an external projection.
The service adapter must separately settle its actual transport resources before closing them.

The real authority uses a private non-enumerable scheduling hint for temporary capacity or unavailable
storage/writers. Ordinary owner outcomes stay unchanged. The durable adapter suspends on that hint at reserve,
revalidate and commit, including its recovered binding check. A rejected reserve proposal has a full-command
digest in its repository command ID, so a later expiry/native snapshot is not a conflicting reuse of an old
payload ID. The reducer still enforces one actual reservation per source attempt; commit/release IDs remain
stable. This worker is not a warm model process, a connected production admission path or a ceremony consumer.
