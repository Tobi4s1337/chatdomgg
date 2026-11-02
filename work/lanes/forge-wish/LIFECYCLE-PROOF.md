# Private withdrawal and reply restart proof

Run `nice -n 10 node work/lanes/forge-wish/lifecycle-proof.mjs` from this worktree. The driver builds into a new
mode-0700 directory under `/tmp/chatdom-forge-wish/lifecycle-*`; queue files and the private report are 0600.
It opens no listener, uses no database or credentials, and makes no provider or Twitch call.

The supervisor starts an actual child process for each of five cases, waits for its durable barrier, kills
that owned child with SIGKILL and waits for its terminal status before reopening the same queue:

1. An exact message withdrawal is synced before the wish has arrived.
2. A person's witnessed source cutoff is synced before arrival.
3. A kingdom's witnessed coverage cutoff is synced before arrival.
4. A terminal completion's replacement is file- and directory-synced, but its caller has not received a reply.
5. An explicit exact owner ACK is synced, but its caller has not received a reply.

The first three reopen tests enqueue old and later authored fixtures. Old work has a withdrawn signal but
retains its current claim for cleanup; model debit, preparation and first commit are fenced. Later work is
not banned by a historical cutoff. The last two reopen as finished with the original attempt, finite reply,
correct ACK bit, duplicate binding and no runnable claim. Every final queue is inspected for private modes and
the absence of queued fixture words/checkpoint data. This tests actual file replacement and process ownership,
not a promise-only imitation of a crash.

Only after all cases pass does the supervisor write the numeric/boolean report
`work/evidence/forge-wish/fw11-lifecycle-process.json`. Child assertion operands and dependency diagnostics
are discarded. Failure emits only a finite classification. The driver terminates only its own descendants.

The completion fixtures deliberately use a finite held outcome. They do not demonstrate the realm authority,
coal, public outbox, a recipient seeing a reply or ceremony consumption. The separate coordinator proof covers
actual SQL commits; independent served Forge/realm lifetimes, reliable production Herald handoff, the warm
model worker, real-wish acceptance and the queue UI remain FW11 acceptance work.
