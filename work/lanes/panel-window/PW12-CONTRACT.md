# PW12 implementation contract

Decisions: fixed 20-gift catalogue in `apps/panel/src/gifts/catalogue.ts`; 60 stable band SKUs, same effect per band.
Amounts visible to viewers come only from Helper getProducts. Bard verse is written, never music on request.
`packages/shared/src/panel.ts` is additive and imported directly; existing shared exports/schemas stay untouched.
A panel gift is its own typed `panel.gift` fact, never a counterfeit Twitch cheer or redemption.

Viewer POST bodies and paths, all under `/api/panel/v1/`, identity only from verified JWT:

- `gifts {}` -> `{version:1,status:'gifts',stream:'live'|'resting',offers:PanelGiftOffer[],friends:PanelGiftFriend[]}`.
- `gift-intent {requestId,sku,targetPlotId:null|string}` -> `{version:1,status:'intent',intentId,sku}`. Request ID is a
  UUID idempotency key; one unresolved checkout per person/channel/SKU; target is immutable, chosen before useBits.
- `gift-receipt {intentId,receipt}` -> PanelGiftResult. API verifies HS256 topic, expiry, domain, purchaser, product;
  canonical Helix Get Extension Transactions establishes broadcaster/SKU/amount/mode/time. Receipt alone lacks channel.
- `gift-status {intentId}` -> PanelGiftResult; only its verified purchaser/channel may read it.
- `gift-cancel {intentId}` -> `{version:1,status:'cancelled'}` unless verified payment already won. UI cancellation is
  evidence about the dialog, never proof a payment cannot later arrive. Keep paid work and immutable selection.

Internal POSTs `/internal/realm/panel/` use the existing panel bearer, strict bounded JSON:
`gifts {kingdomId,personId}`, `gift-intent {kingdomId,personId,requestId,sku,targetPlotId}`,
`gift-status {kingdomId,personId,intentId}`, `gift-cancel {kingdomId,personId,intentId}`,
`gift-evidence {extensionId,transactionId,kingdomId,personId,sku,bits,inDevelopment,occurredAt,name,intentId?:string}`.
Name is approved provider evidence; user-selected IDs, names, costs and receipt data never come from client bodies.
Both verified receipt and verified webhook/history call gift-evidence. Exact canonical duplicate is idempotent;
conflicting transaction evidence is refused. Unknown/retired SKUs refused before checkout. Paid known issued gifts
stay durable pending if stream/effect availability changes. Ambiguous/unmatched payment remains durable pending.
No latest-intent guessing. Webhook/history requires canonical transaction lookup, not an invented client success.

Realm service owns new `0012c_realm_panel_gifts.sql`, uses DurableKingdom.writeMoments serial queue and writer lease,
SQL transaction + realm row lock/fence, atomic transaction-ID claim, immutable intent binding, sequence/fact/outbox.
Lost commit responses must resolve by the same transaction/intent ID. Paid gift rows are never discarded.
Optional PanelGiftEffectAuthority advertises actual mounted gift IDs/versions and appends durable dispatch in that
same SQL transaction. No authority -> no offers. It must not be enabled by a boolean env flag. Test authorities are
isolated test ports, never production success. Main/grand-world receive exact hook patches; no scene edits here.

`RealmPanelService.kingdom` can expose latest own committed public gift fact as giftMoment; API picks newer actual
committed gift line vs existing public event. Private transaction IDs/person IDs never enter facts or panel state.
The additive viewer snapshot property `gifts?:PanelGiftShelf` powers a new GiftShelf component. Existing fixture shelf
is not a production source. Requests: requestProduct(sku), chooseGiftTarget(plotId), cancelGiftChoice(), resetGift().
HelperBridge gains getProducts/useBits/onTransactionComplete/onTransactionCancelled callback wrapper, never grants.
States: idle, choosing, confirming (Twitch dialog), pending (server verification), delivered (authoritative fact),
cancelled, unavailable. Gates: visible, shared, live, Helper Bits enabled, SKU from Helper + realm ready offers.
No automatic retries of useBits; retry only evidence/status with same keys. Disposal cancels timers and HTTP work.
A hidden/closed page cannot revoke a verified payment. Never put receipt/JWT in snapshot, URL, storage or logs.

Webhook endpoint `/api/panel/v1/bits-webhook` authenticates raw EventSub HMAC + time/type/version/extension condition,
not a viewer JWT. GET Extension Transactions reconciliation uses extension-specific OAuth credentials and durable
cursor/overlap only after these exist. Missing credentials keep gifts closed, with named health needs in PW13.
PW12 purchase bar stays open until real Hosted Test gift; first HOSTED-TEST.md item must require it.

## Review corrections

- Cancellation is an observation about the dialog, not proof of no payment. Authoritative cancelled/unpaid status
  unblocks the checkout, even after a lost cancellation response. A recovered unverified intent offers Close checkout
  only with `canCancel:true`; a paid race remains tracked. No automatic repeated useBits.
- Receipt intentId is only a hint, never a way around ambiguous retained selections. `gift-resolve
  {paymentRef,intentId}` is a distinct authenticated post-payment gesture. `gift-choices {paymentRef,cursor?}` pages
  compatible immutable selections, eight at a time. Cursor is bounded and validated. Resolving an older selection
  switches subsequent client tracking to that intent; a stale newer-intent status cannot overwrite it.
- `awaiting-target` includes an opaque private payment reference, choices and optional nextCursor. All-cancelled
  checkouts with an unresolved payment still resume. Previously completed intents are excluded from that fallback.
- Own shared contract is additive and uses direct imports, preserving existing package exports. Provider IDs/receipts
  never enter public gift facts. Current name privacy is applied on each public read; public line is fixed catalogue.
- A bounded internal `gift-drain {extensionId}` retries already-verified, bound paid gifts from stored evidence under
  the realm writer, without a viewer page or another provider lookup. Retry metadata rotates over the owned inbox so
  an offline kingdom cannot permanently starve newer work. API's worker invokes it before provider reconciliation.
