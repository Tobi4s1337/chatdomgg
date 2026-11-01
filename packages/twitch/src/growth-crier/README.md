# Growth crier consumer

`createGrowthBatcher` creates memory-only state for one stream/session. Supply a
monotonic millisecond clock to every ingest and flush, and preserve the returned
state. The quiet window is measured from the last accepted new fact; a chunk
left over because of the message length waits another window. Limits count
JavaScript string units, and pending capacity must hold at least one complete
128-beat frame. Each candidate retains its exact public beat evidence.

`watchGrowthFeed` validates frames and the feed label. Each subscription's first
snapshot is a baseline: its recent tail is never treated as fresh. Carry the
adapter's state into the next subscription; unannounced facts in a disconnected
interval may be omitted because the bounded snapshot does not prove live
receipt. A changed origin or kingdom, stale reconnect baseline, invalid clock or
invalid frame fails closed. `unavailable` is reported separately from an empty
snapshot. Stop subscriptions with `close()`.

If a frame encounters backpressure, the adapter stops the subscription and
retains that validated frame. Pull ready candidates with `flush()` and call
`retry()` until the retained frame is accepted before reconnecting with the
resulting state. The pure batcher also pins the refused frame's identity and
rejects attempts to skip it. Starting a different stream/session is an explicit
`resetGrowthBatcher` operation and discards pending work. Never reset to replay
the current session.

`createSimulatedGrowthFeed` is a caller-driven fixture for previews and accepts
only simulated frames. All of its candidates are labelled `SIMULATED`. Neither
an emitted candidate nor an adapter status means that a message was delivered.
Main owns package wiring, an authoritative feed, durable checkpoints, identity
consent, permissions, delivery and acknowledgement. This module cannot send to
Twitch and cannot guarantee recovery across process loss.
