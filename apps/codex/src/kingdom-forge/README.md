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

The binding exposes its owning room's `origin`. The coordinator captures that value before reserving and uses it
for attachment provenance, including public completion. Missing/invalid origin is a cold forge before any model
or reservation call. A genuine Codex run in a SIMULATED room remains SIMULATED; the wish cannot select its source.

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
It records candidate attempts, actual model calls and the selected result index. Discarded results keep only
bounded outcome/quality summaries; the selected draft and schema-ordered full home digest bind the approval
to exactly what may land. A quiet retry cannot substitute an unchecked title, plaque or plan under the same run.
New private approvals also bind the registered kit ID and revision. One trusted kit is captured before the model
run and reused for socket selection, result-sheet assembly, audit binding and final attachment. Historical
digest-only records can authorize revision one only, subject to the existing owned-home/family/current-kit
checks; they cannot be upgraded into approval for a different revision.
Judgment `approved` is a model-gate result, not a durable placement. Stage events have only an opaque activity ID
and stage. Only a successful authority commit releases the approved draft, slot and safe provenance. Refusals,
holds and errors return privately. If the listener fails, or cancellation arrives after commit, the durable
outbox/snapshot must recover the attachment without replaying the ceremony or charging twice.

The returned function yields a private outcome. A Herald sink can `await application(command, lease)` and route
that outcome privately; it must not broadcast it. A duplicate kingdom/message key produces no second model run
or public ceremony. Shared protocol promotion and public snapshot/replay wiring belong to main.
After a durable commit, an optional private line describes the actual motif and any closest-shape adaptation.
It uses finite host-authored descriptions rather than raw model prose or original wish text. Service outages,
safety holds and authority prerequisite failures return their private causes without a quality refusal beat.

The focused test uses controlled providers/authority and real assembly/contact-sheet rendering. It establishes
ordering, idempotency, privacy projection and no commit for failed/stale runs. It does not establish durable realm
transactions, live Twitch/model operation or production publication. No service is started by this module.

Image verdict summaries include finite detail-match evidence privately. A missing or adapted detail prevents
exact delivery and may trigger the existing quiet retry; it never changes a safety verdict. Both the selected
raw evidence and discarded finite summaries retain this distinction. Quality-softened messages describe the
actual piece and approximation without repeating an unverified claim that the chosen subject survived.

## Durable execution adapter

`createQueuedKingdomForgeApplication` consumes one owned `FileForgeWishQueue` claim. It saves the exact
source, reservation, full home digest, attribution, safety identity, current policy and registered kit before
model work. Its trusted execution hooks supply the queue-backed run state and persist the complete original
commit request before the authority transaction. The ordinary nonqueued caller remains available.

Recovery queries actual authority status first. Unavailable status or an ambiguous transaction returns
`recovery-needed`, keeps private recovery data and does not release the attempt. A confirmed committed attempt
can replay only its saved exact command through the authority's existing repository-digest check; it can do so
after the old reservation or service lease expires, using the current queue claim. A status receipt alone
cannot recreate or approve a changed attachment.

A worker shutdown suspends work. An explicit witnessed withdrawal saves its terminal intent before the
idempotent release, then checks status again in case a commit won the race. Lost storage, commit or release
acknowledgments remain private recovery work. Neither an error body nor a filesystem path becomes a reply.
Finite stopped outcomes are retained privately for the worker's later delivery; successful private copy is
reconstructed from the actual selected draft and bounded delivery explanation.

This adapter suppresses its own committed observation: the realm's durable outbox owns that publication.
It does not call `queue.finish`, deliver an owner reply, schedule a ritual or activate the existing Herald
handoff. Its caller must persist the owner outcome and presentation decision before terminal privacy cleanup.
After a pending execution, release/reclaim the queue worker before executing again so its checkpoint snapshot
and expenditure are current. Public queue counts and authenticated broadcaster projections are separate work.
