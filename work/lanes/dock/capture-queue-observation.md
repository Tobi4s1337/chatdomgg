# Capture queue observation — resumed DK10

Main's `1bdc9de` queue implementation has been synced. The lane uses the shared helper,
lane priority, one still/short clip per acquisition, and no observation timeout. This note
does not authorize bypassing it or removing locks/registry entries.

The current queued capture handle is recorded in `work/evidence/dock/README.md`. Its latest
tool poll confirmed it remained live after reporting `queued for a lane slot`; it had not
started a socket or Chrome. A read-only directory inspection found the queue registry empty
while that handle was still live. This alone does not prove which process removed a ticket.

Two independent concurrent `exec_command` calls each ran this secret-free command:

```js
import { readFile } from 'node:fs/promises';
console.log({
  pid: process.pid,
  nspid: (await readFile('/proc/self/status', 'utf8'))
    .split('\n').find(line => line.startsWith('NSpid:')),
});
```

Both reported `pid: 2` and `NSpid: 2`. The execution sandboxes therefore have distinct PID
namespaces. The shared queue supervisor records namespace-local `process.pid` and starttime,
then other supervisors validate them against **their own** `/proc/<pid>/stat` view. A live
foreign ticket can consequently look absent or like a reused PID. If it is removed, the owner
keeps its nonempty `ticket` variable and never registers again, so `head?.name === ticket`
can never become true. This is a code-level failure path, not an attribution of a specific
registry deletion.

**needs: main-owned capture helper correction.** Please use cross-namespace liveness rather
than PID lookup, for example a random ticket identifier and a pipe-bound, kernel-held advisory
lock per ticket. Stale cleanup may remove an entry only when its liveness lock can actually
be acquired. Do not replace it with a TTL: a queued or running capture must not expire merely
because observation is quiet. Migration should ask workers to stop/restart only their own old
guard processes after the helper changes; never signal a foreign PID or unlink the shared
capture lock inode. Tests need separate PID namespaces (or an injected liveness mechanism
that covers collisions), not only children sharing the test runner's namespace.

The lane keeps its existing process tracked and continues independent dock work. No lock,
registry entry, foreign service or foreign process was changed during this investigation.
