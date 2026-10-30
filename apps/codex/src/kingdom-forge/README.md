# Kingdom Forge coordinator

`createKingdomForgeApplication` consumes a verified private Herald command and its cancellation lease. It calls
the existing `runForge` with the authority's native home, family and real opaque safety identifier. Both external
gates and the real assembler/contact-sheet checks run unchanged. There is no authorizing implementation here:
an absent authority returns `cold` without calling a provider.

Main must bind `KingdomForgeAuthority` to the realm's durable transaction owner. `reserve` checks actual rights
and reserves earned coal/capacity; `revalidate` reads the current home and eligibility; `commit` checks the lease,
revision and full SHA-256 home digest atomically with consuming one coal, saving attachment/provenance, keeping
displaced items and writing the public outbox/snapshot. `release` is durable and idempotent per attempt, including
unknown outcomes; it never refunds a committed item or releases a competing caller. Authority calls, audit writes
and cleanup each have a five-second deadline; the model run has three minutes and the reservation can last at most
ten minutes. A timeout aborts the attempt lease, including late authority work. Cleanup failure returns the private
`recovery-needed` outcome and attempt key rather than claiming release. Adapters must honour cancellation and
recover abandoned reservations by expiry. The chat command's presentation slot is only a hint; the authority
chooses the actual owned home's slot. Ownership, trust, actual live session, moderation and quotas remain real authority.

Successful commit receives the original approved wish separately as private `creation.words`, retained with the
made item as creation input (Safety §5), never in the public attachment/outbox or generic audit. Ordinary chat is
not retained. A refused outcome carries its private message for delivery only to its maker.

Attribution must arrive already judged (or as approved anonymous defaults), with its approval ID retained in the
authority reservation. Names are not inferred from Twitch IDs or public presence. The authority must not allow
an unchanged revision to describe changed ownership, style, attribution or home geometry. The short existing
`homeFingerprint` is for render compatibility; the transaction additionally binds the complete home digest.
Original lineage is unique to the kingdom and approved run, even when two makers choose identical finite parts.
The transaction stores both `committedAt` and provenance `firstForgedAt` as its identical authoritative timestamp.

Bind `record` to a private audit sink and `publish` to a public observation sink. The audit contains the existing
providers' bounded judge evidence, without the original wish, identity, whole house or raw provider errors.
Judgment `approved` is a model-gate result, not a durable placement. Stage events have only an opaque activity ID
and stage. Only a successful authority commit releases the approved draft, slot and safe provenance. Refusals,
holds and errors return privately. If the listener fails, or cancellation arrives after commit, the durable
outbox/snapshot must recover the attachment without replaying the ceremony or charging twice.

The returned function yields a private outcome. A Herald sink can `await application(command, lease)` and route
that outcome privately; it must not broadcast it. A duplicate kingdom/message key produces no second model run
or public ceremony. Shared protocol promotion and public snapshot/replay wiring belong to main.

The focused test uses controlled providers/authority and real assembly/contact-sheet rendering. It establishes
ordering, idempotency, privacy projection and no commit for failed/stale runs. It does not establish durable realm
transactions, live Twitch/model operation or production publication. No service is started by this module.
