# Capture-slot PID namespace audit — 2026-11-01

The new main-owned FIFO scheduler checks `/proc/<pid>/stat` to decide whether another ticket is
live. Separate exec commands have separate PID namespaces here: both audit callers reported PID 2.
A live foreign ticket was removed as stale and the supposed single main slot admitted both callers.
The audit used only `/tmp/grand-artisans-slot-audit-20261101.lock`; no browser or actual host capture
slot was taken. No foreign process was signalled and no shared queue file was manually changed.

Confirmed live handles and outputs:
- First caller 79746 acquired at 1793548752806 ms, released at 1793548797975 ms.
- Second caller 94950 acquired at 1793548765970 ms, released at 1793548811065 ms.
- Both held the same single-main-slot audit lock for about 32 seconds simultaneously.

`work/lanes/grand-artisans/capture-slots.needs.patch` replaces PID liveness with a unique ticket's
kernel-held owner-inode lease. This is a proposed main-owned change, not applied by this lane.
Its isolated two-namespace reproduction keeps the second caller queued while the first is live;
final serialized timestamps are recorded below after both audit handles finish.

Migration requires existing FIFO guards to finish/cancel their own waits before switching versions:
old PID-based guards must not delete new lease-based records. The patch alone does not coordinate
that migration. Main owns the scheduler, its tests and that coordination.

For this lane's actual captures, `ARTISAN_CAPTURE_COMPAT=1` uses the module's documented exclusive
compatibility path on the *same* host lock inode, held by a pipe-bound guard through one still/clip.
It never bypasses or deletes that lock: every old/new capture holder excludes this lane until it
releases. The compatibility guard changes no registry or other checkout and releases between shots.
This avoids relying on broken namespace liveness while main reviews the exact fix.

Proposed inode-lease proof (same audit, separate exec namespaces, both PID 2):
- First caller 70734 acquired 1793548969865 ms, released 1793549014934 ms.
- Second caller 33536 stayed queued while the first handle was live, then acquired
  1793549014978 ms and released 1793549060105 ms (44 ms after the first released).
- This validates the namespace-specific liveness repair on an isolated path. It does not replace
  main's full scheduler/migration checks or authorize changes to that owner’s source.

## Main repair adopted at d175db5

Main now owns a UUID/inode-lease scheduler in a new queue-v2 directory; default lane
leases no longer depend on cross-namespace PIDs. The two parent compatibility waits
were intentionally migrated (both terminal exit130), and new captures use the shared
scheduler normally. One initial attempt found no allowed port; after5182 became free
the next queue captured13 stills with individual leases. No foreign service was stopped.
Resumable parent capture records use immutable artifact names and atomic per-PNG
manifests with source/image digests; the JSONL journal is not a resume authority.
