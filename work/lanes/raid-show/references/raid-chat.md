# Disposable raid-chat presentation

Reviewed 2 November 2026. The existing Herald-presence/Colyseus separation remains the authority: a witnessed chat
can change durable history, but its words remain transient. The visitor projection has no home slot, body or
public account identifier. Only an accepted guest/source-citizen qualification may stage its light.

The open-source comparison was Socket.IO's MIT-licensed [broadcast operator](https://github.com/socketio/socket.io/blob/main/packages/socket.io/lib/broadcast-operator.ts#L120-L137).
Its volatile delivery option illustrates the distinction between disposable presentation and durable state.
We take that distinction, original expiry and safe loss; we keep the existing Herald/realm transports and do
not introduce Socket.IO, its identity model or a durable text queue. No upstream implementation was copied.

In this implementation, the committed guest-chat record owns provenance and passport history. A process-local
projection joins the exact current speech delivery, then disappears on expiry, moderation, writer retirement or
restart. A missing effect is not repaired by replaying old text. Continued source chat may renew its original
visit's light without earning new history. Limits apply to staged representatives, never to durable facts.

This is not performance evidence. Server read/heap and browser GPU timing need measurement on the deployed,
composed path. The current verification covers bounded collections, byte limits, clocks, transport boundaries
and a looked-at phone composition.
