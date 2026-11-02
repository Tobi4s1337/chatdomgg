# Reference: pg-boss and Twitch configuration publication

https://github.com/timgit/pg-boss · MIT · studied at `71ea068b144c75b014a1eb90327aaa4a92da1cf2`

For: PW13's durable Configuration Service publisher. The local read-only clone is `/tmp/chatdom-refs/panel-window-pg-boss`. This note lives inside the lane's permitted scope.

## What it is

pg-boss is a Postgres job queue with atomic claims, retries and attempt fencing. Its SQL makes the ownership boundary explicit: a claim is durable before a handler starts, and settlement must prove that the same attempt still owns the work. This is a useful model for publishing a realm preference to a separate service whose writes cannot join our transaction.

## What we take

- Claim eligible work and update its ownership atomically. Default selection uses row locking with `SKIP LOCKED`, so competing workers skip work already held: `src/plans.ts:2655`, `:2694`, `:2805`.
- Fence success, failure and heartbeat with the active claim's identity, not the job ID alone: `src/plans.ts:2828`, `:2883`, `:3235`, `:3287`. A stale worker must not acknowledge or requeue a newer attempt.
- Never recycle an attempt identity. The source describes how restoring an in-flight job can defeat a reused generation: `src/plans.ts:2842`. Our fresh claim IDs avoid that ambiguity.
- Keep the claim transaction separate from the external handler: `src/manager.ts:655`, `:772`. No realm writer queue or database row lock waits on a Twitch request.
- A handler timeout does not undo an external effect: `src/manager.ts:890`; delivery is at least once in `docs/introduction.md:42`. For our mirror, this means a delayed old PUT can arrive after a lease expires. A fenced database acknowledgement cannot prevent that remote write; periodic GET reconciliation is necessary.

## What we do differently

The realm already owns preferences and gift authorization. The outbox publishes their current public reading; it grants no world authority. There is one current desired state per channel, so superseded intermediate states coalesce. Pending writes and verified publication are distinct API states.

Claims have a short durable lease and fresh IDs. Twitch GET readback must match the latest authoritative reading before acknowledgement. Restart, expired claims, failed requests and late drift all return to durable reconciliation. This provides eventual convergence after delayed requests settle; Twitch supplies no cross-service transaction or finite propagation guarantee.

[Twitch GET Configuration](https://dev.twitch.tv/docs/api/reference/#get-extension-configuration-segment) limits reads to 20 per segment per minute. [Twitch SET Configuration](https://dev.twitch.tv/docs/api/reference/#set-extension-configuration-segment) limits updates to 20 per minute and does not update already-open views. Our shared SQL quota conservatively spaces all configuration requests by at least 3,100 ms across channels and workers; authenticated API rereads plus existing PubSub/polling update open panels. The segment is public, bounded, versioned and contains no secrets.

The external JWT identifies the extension owner, separately from a destination channel. [Signing requirements](https://dev.twitch.tv/docs/extensions/building/#signing-the-jwt) cannot be satisfied by guessing from that channel.

## Leave behind

No general queue service, copied pg-boss SQL, new dependency, public unfenced settlement overload, or promise of exactly-once remote HTTP delivery. The existing realm writer remains the authority for Hide and gift commits.

## License

MIT (`LICENSE:1`). We studied techniques and wrote our own implementation. No upstream source was adapted, so no upstream code or license payload is shipped.
