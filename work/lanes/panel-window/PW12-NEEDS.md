# PW12: durable gifts and the remaining effect owner

The realm core is implemented in `apps/realm/src/ingress/panel/gifts.ts`. Its production composition has no
`PanelGiftEffectAuthority`, so it offers no purchasable gifts. A committed row in the private payment inbox is
not delivery. The world/stream mounts, capability acknowledgement, and a real Twitch Hosted Test purchase are
still required. The attached patch is unapplied transport plumbing, not those missing effects.

## Implemented authority and recovery

`RealmPanelGifts({db, services, origin, effectAuthority?})` uses the retained `DurableKingdom.writeMoments`
queue, a database transaction, the realm row lock, and checks the writer epoch, expiry, origin and domain
sequence both before work and immediately before COMMIT. No gift can found a kingdom. An unmatched verified
payment can be stored without an adopted kingdom; it cannot acquire a world effect there.

`0012c_realm_panel_gifts.sql` owns immutable checkout selections, canonical provider transaction claims, gift
sequence heads, public facts, an outbox, webhook inbox and reconciliation cursor. It is now applied in the
isolated development schema and must not be edited in place. An intent freezes the actual plot/slot, gift
version, duration and public line before Helper useBits. A self target uses null on the viewer wire and resolves
the actual owned home privately. Friends come only from currently present, named, unquiet, unheld real homes.

Each provider transaction has one private payment reference and at most one intent and public fact. Canonical
receipt/webhook evidence converges on extension, transaction, channel, purchaser, SKU, amount, development mode
and provider timestamp; the optional intent hint and public display name are not part of the payment digest.
Provider price changes do not invalidate paid gifts. A lost COMMIT reply is reconciled using the original keys.
The effect append, fact, outbox and delivered marker share one transaction. An append failure rolls back its
savepoint but keeps the verified payment and target binding pending. Paid work survives an offline stream,
removed shelf selection, unavailable effect, restart, or page close. Duration starts at actual commitment.
A worker can call `drain({extensionId})` without Twitch OAuth: it retries at most 32 already verified, bound
payments through the same fenced writer. Inbox attempt timestamps rotate before each try, including unavailable
writers, so the first offline kingdoms cannot starve later payments. Those inbox rows remain `done:true`; they
never re-enter provider verification. The API owner calls this every 30 seconds before provider reconciliation.

The receipt cannot cryptographically bind an intent. Automatic binding therefore examines **all** compatible
unconsumed prior checkouts, including cancelled and old ones. It binds only one unique candidate within that
candidate's checkout window. A receipt's explicit intent ID cannot break an ambiguity. A separate authenticated
post-payment resolve gesture chooses an immutable compatible target; it can choose an older retained checkout.
Choices use pages of eight, a bounded validated keyset cursor, and names redacted using current quiet/moderation.
The public shelf resumes an unresolved paid selection even if every compatible checkout had been cancelled.
Unpaid open status has `canCancel:true`; cancelled/unpaid status is authoritatively `cancelled`, including after
an uncertain cancel response. Cancellation never deletes a checkout or invalidates later payment evidence.

Internal methods, called only behind the existing panel bearer and verified subject binding:

- `gifts({kingdomId,personId})`, `intent({kingdomId,personId,extensionId,requestId,sku,targetPlotId})`.
- `status/cancel({kingdomId,personId,intentId})`.
- `resolve({kingdomId,personId,paymentRef,intentId})`.
- `choices({kingdomId,personId,paymentRef,cursor?})`: `awaiting-target` plus `nextCursor:string|null`.
- `evidence({extensionId,transactionId,kingdomId,personId,sku,bits,inDevelopment,occurredAt,name,intentId?})`.
- `inbox({extensionId,transactionId})` durably queues; `inbox({extensionId})` reads up to 50 pending IDs.
- `reconcile({extensionId,cursor?})`; API advances only after all page evidence is durable.
- `drain({extensionId})`: `drained` with bounded `attempted`, `committed` and `pending` counts.
- `latest(kingdomId)` and `feed(kingdomId,afterSequence)` disclose committed gift facts only. Feed pages max 64.

No provider receipt, transaction ID, payment reference or person ID enters a public gift fact. Latest/feed reads
recheck quiet and moderation without rewriting immutable fact bytes. Public lines contain fixed catalogue
wording, never a stored credit name. Previously sent names still require the public owner's revocation path.

## Exact effect-owner contract

`PanelGiftEffectAuthority.ready(giftId,kingdomId)` returns `{version}` only when that real effect version has its
world **and stream** consumers and restart recovery mounted; otherwise null. `append(tx,lease,fact)` must append
its durable dispatch using the supplied SQL transaction, reject unsupported versions, and never independently
COMMIT, publish to a socket, or send a network request before commit. Its dispatch must use `fact.id` uniquely.
Inject that object into the existing `new RealmPanelGifts` in `apps/realm/src/main.ts`. A flag or an append that
returns without durable work is not a production implementation. The integration tests use an explicitly
isolated SQL dispatch table as their test port.

The own `panel.gift` sequence is independent of both domain and Twitch moment sequences. The attached patch
extracts the shared realm instance, supplies its bounded `feed` to `bootstrap/watch.ts`, emits a separate
`panel-gifts` SSE event, and adds a strict client decoder plus an optional spectator callback. It intentionally
sends anonymous credits until the owner adds current-disclosure revocation updates. It does not install an
effect authority, renderer, capability flag, fake Twitch fact, or new realm outbox kind.

Owner insertion points after reviewing that transport skeleton:

1. `apps/web/src/kingdom-entry/spectator.ts`: feed a session-owned gift adapter before scene preparation. Preserve
   its witnessed cursor across scene revisions; make first/reconnect pages a quiet restoration of active
   decorations. Do not replay expired celebrations, sounds, camera moves or captions from historical pages.
2. `apps/web/src/kingdom/scene.ts`: a separate typed gift feed beside `SceneOptions.momentFeed` (currently line 87),
   mounted beside `createKingdomMoments` (currently line 725), with the same abort/dispose and activation rules.
   Route it through the real world entry connection as well as the spectator/stream path. The attached patch
   stops at the spectator callback; it does not claim the room/world path is integrated.
3. Reuse appropriate art primitives in `apps/web/src/twitch-moments/` behind a new gift renderer; never cast a
   `PanelGiftFact` into `TwitchMomentFact`. Targets resolve the committed plot/slot against the current scene.
4. Supply active-state recovery and a bounded durable dispatcher to the effect authority. The illustrative
   polling patch starts at gift cursor zero and reads 64 facts/second; long-history recovery needs an indexed
   current-decoration snapshot plus cursor before this transport is production-ready. It has no frame-loop work.
5. Add disclosure invalidation if named credit is enabled. This is separate from PW11's remaining global home
   label, moment credit, public-cache and replay privacy work; the anonymous patch does not complete PW11.

If main chooses the existing `realm_outbox` instead, it must first add a distinct gift message to
`packages/shared/src/realm/messages.ts`, a new migration after the kind CHECK last changed by
`0009_realm_growth.sql`, and gift recovery in `apps/realm/src/outbox/{projection,store}.ts` and
`apps/web/src/realm/adapters/observer.ts`. The store's current whitelist is home/castle/forge/moment/growth.
Appending an unknown kind or reusing `moment` with a different fact is invalid. None of those changes is
silently included in the transport patch.

## Full catalogue mount requirements

All three bands of each SKU produce the same effect; suggested catalogue amounts never choose scale or rank.
The initial shelf selects the first eight gifts and their `a` bands; selection/health controls belong to PW13.
Durations and immutable target kinds come from `apps/panel/src/gifts/catalogue.ts`.

| Gift | Required visible world and stream mount |
|---|---|
| friendfireworks | A bounded star burst above the selected real home |
| streetlanterns | Decorative street lanterns; never change attendance/window presence |
| kites | Kites travelling through the sky |
| bell | The plaza bell swings; sound follows current mute and replay policy |
| bunting | Bunting on the purchaser's committed home |
| parade | Pennants and ribbons crossing the plaza; no invented citizens |
| feast | A shared table feast in the plaza |
| bardverse | A short curated written kingdom verse; no song request |
| flowerpetals | Drifting petals around the plaza |
| paperboats | Boats on an actual usable water anchor |
| ribbonarch | A ribbon arch at the real gate |
| plazaflowers | Flower baskets around the gathering place |
| friendflowers | A basket at the selected real home |
| confetti | A bounded paper shower in the plaza |
| skybanners | Long banners above the kingdom |
| picnic | Blankets and baskets in the square |
| pinwheels | Turning decorative street pinwheels |
| starribbons | Paper stars over the plaza |
| gatewreath | A wreath on the real gate |
| friendpennant | A pennant at the selected real home |

Budget: one writer queue with at most 32 pending service calls; drain batches at most 32 payments; SQL pages
8 choices / 48 friends / 50 webhook
IDs / 64 public facts; one fact at most 4096 bytes; optional transport pages at most 256 KiB. The illustrative
transport shares the existing watch limit of 32 and never overlaps a connection's reads. Main should coalesce
polls per kingdom before high fan-out. The renderer owner must measure real GPU frame time/memory and place its
own active-decoration bounds; this lane supplies no fabricated rendering/performance evidence.

## Evidence and limits

Focused gift-core lint and TypeScript diagnostics passed. The test owner demonstrated **13/13 isolated-Postgres
cases**, covering capability absence, actual friends, immutable targets, duplicate receipt/webhook evidence,
conflicting evidence, cancellation with late payment, offline recovery, unique webhook matching, self targets,
explicit ambiguous payment resolution, paged old targets and resume after a historic completed gift plus two
cancelled checkouts. Closed-page drain also proves offline-to-live and failed-append recovery before any
viewer status call; repeated drain produces only one dispatch. The 172-line needs patch passed `patch --dry-run -p1`; it has not been applied or runtime
tested. Crash/lease-loss injection and real-world effect recovery are not covered by those thirteen tests.

No production effect is acknowledged, no real Bits were spent, no live DB was touched by this subagent, and no
git commands were run. Hosted Test purchase, all 20 mounted effects, current-decoration restore and production
world/stream credit revocation remain unchecked requirements, not successful deliveries.

## Erasure integration for these owned records

PW11's core erasure authority must include the new gift records: intent purchaser identity and immutable selection,
transaction purchaser/provider ID/name/evidence digest, linked public credit in fact/outbox history and active effect
state, inbox provider transaction IDs, and any downstream replay/still copies. Raw receipts and OAuth tokens are not
stored in these tables. Do not bypass `realm_panel_gift_selection_fixed` with ad-hoc panel SQL; the owner needs a
versioned redaction/retained-ownership contract consistent with duplicate-payment prevention and preserved Chatdom
content. Until that authority is real, forget remains unavailable. This data map is not an erasure implementation.
