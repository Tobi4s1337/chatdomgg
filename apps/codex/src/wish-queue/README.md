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
- Only a confirmed terminal result permits `finish`. It atomically replaces the private record with a
  word-free receipt and drops all checkpoint data. A lost filesystem acknowledgement poisons this owner and
  revokes its workers; reopening discovers the actual durable state before further work.
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

An update writes a uniquely created private temporary, syncs it, renames it over the record, and syncs the
directory. Acknowledgement comes afterwards. On restart, the new exclusive owner removes unacknowledged
private temporaries, validates every accepted record and changes interrupted running entries back to queued.
The record replacement erases accessible queued copies of terminal words; it is not forensic media erasure
and does not claim to purge filesystem snapshots or backups. The configured directory must live on a local
filesystem with working advisory locks and durable sync semantics, not a shared network volume.

## Worker contract

`enqueue(command)` returns queued or existing metadata. `claimNext()` chooses the oldest eligible wish,
bounded by `maxConcurrent`, and excludes a maker who already has work running in that kingdom. Another maker
may proceed while an older second wish from that citizen waits. Claim generation, object identity and an
abort signal fence old workers after retry, expiry or close. A caller must carry `claim.current` through
every authority await and transaction check; a queue cannot prevent an adapter from ignoring its lease.

`beginModelCall(claim, stage)` persists a debit before the provider is called. `checkpoint` persists the
returned result under a new checkpoint ID. Claim snapshots are detached values, not live views; `get` reads
current finite accounting. `retry` releases the worker while keeping the same attempt and every private
checkpoint. `finish` records only a finite actual outcome. Neither method releases a realm reservation,
spends coal, sends a message or plays a ceremony.

`list` and `get` are private operational projections. They omit words and checkpoint data but include source
IDs, person IDs and terminal outcomes; they must not be exposed as public queue routes. A public anvil view
needs its own count/position projection, and a named broadcaster view needs authenticated authorization.

## Budgets and ordering

The defaults are two active claims and 128 pending wishes. Configuration allows 1–64 workers and at most
4096 pending entries. Claims last at most ten minutes. Each wish retains at most sixteen checkpoints, each
at most 64 KiB, with depth and node-count limits; its signed record cannot exceed 1.1 MB. Image pixels should
remain in their separately owned private artifact store, referenced by exact content digest in a checkpoint.
No request body, exception object, executable value, getter or nonfinite number belongs in recovery data.

Disk writes serialize through one asynchronous queue and run no rendering or synchronous filesystem work on
the web frame path. Each durable transition costs a file sync and directory sync. These are correctness
costs to measure with the actual service, not claimed latency results. Terminal receipts currently load at
startup, so lifetime tombstone memory and startup time grow with total wishes; that limitation is explicit.

Arrival sequence establishes admission order. It does not yet serialize stream rituals or order commits.
Those need a separate durable presentation cursor, driven by actual authority outcomes, so several wishes
can forge concurrently while only one ritual airs and reconnect never repeats it.

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
