# Bits in Extensions & monetization

Sources: `official/extensions_monetization.md`, `extensions_monetization-strategies.md`,
`extensions_reference.md` (Helper: Bits, features), `extensions_guidelines-and-policies.md` §5–6,
`extensions_submission-best-practices.md`, Helix (Get Extension Transactions, Get/Update Extension Bits
Products), EventSub `extension.bits_transaction.create`.

## Contents
- [Eligibility and setup](#eligibility-and-setup)
- [Products (SKUs)](#products-skus)
- [End-to-end flow](#end-to-end-flow)
- [Verifying the receipt on the EBS](#verifying-the-receipt-on-the-ebs)
- [Server-side sources of truth](#server-side-sources-of-truth)
- [Testing](#testing)
- [Policy and wording](#policy-and-wording)
- [Subscription status](#subscription-status)
- [Strategies](#strategies)

## Eligibility and setup

- **Developer**: Partners/Affiliates need no onboarding. Others: Monetization tab → *Continue to
  Onboarding* (developer agreement, two tax interviews, payout info; approval up to 2 business days).
  Organizations: billing managers handle it.
- **Extension**: Monetization tab → **Bits enabled** (+ optionally *Subscription support*). These two
  fields are required before moving to Hosted Test.
- **Channel**: Bits only work on **Partner/Affiliate channels that can receive Bits** and haven't
  disabled Bits for your extension. Any broadcaster can still install it.
- **Frontend gate (mandatory)**: `Twitch.ext.features.isBitsEnabled`; hide/disable Bits UI or offer a
  free variant when false. Flags arrive after the first `onAuthorized`; subscribe to
  `features.onChanged`. There is **no server-side API** for this flag.
- Revenue from Bits used in an extension is shared between broadcaster and developer.

## Products (SKUs)

Managed in the console (Monetization → Bits Products) or via Helix with an **app access token of the
extension's client ID**:

| Field (console / Helix) | Rules |
|---|---|
| Product Name / `display_name` | ≤ 255 chars |
| SKU / `sku` | unique, no whitespace, ≤ 255 chars; Helix: alphanumerics, `-`, `_`, `.`; **cannot be changed or deleted** once saved |
| Amount / `cost.amount` | 1 – 10000 Bits, `cost.type: "bits"` |
| In Development / `in_development` | console default **Yes**, Helix default false. In-dev products are not returned by `getProducts` for released versions |
| Broadcast / `is_broadcast` | true → `onTransactionComplete` fires in **every** instance on the channel (initiator gets `initiator:"current_user"`, others `"other"`); false → only the initiator |
| `expiration` (Helix) | RFC3339; set in the past to disable. Console: Deprecate/Restore |

Max 250 products per catalog. Price is a flat Bits amount worldwide.

```bash
# app token (client credentials) for the EXTENSION's client id — see twitch-dev skill
curl -X PUT https://api.twitch.tv/helix/bits/extensions -H "Authorization: Bearer $APP_TOKEN" \
  -H "Client-Id: $EXT_CLIENT_ID" -H 'Content-Type: application/json' \
  -d '{"sku":"boost_vote","cost":{"amount":100,"type":"bits"},"display_name":"Vote boost","in_development":true,"is_broadcast":true}'
curl 'https://api.twitch.tv/helix/bits/extensions?should_include_all=true' -H "Authorization: Bearer $APP_TOKEN" -H "Client-Id: $EXT_CLIENT_ID"
```

## End-to-end flow

```
frontend                         Twitch                               EBS
getProducts() ───────────────▶ catalog (show amounts from here, never hard-code)
useBits(sku) ────────────────▶ confirm dialog (balance, "Get Bits", identity-share notice)
                                 user confirms → amount locked in
onTransactionComplete(tx) ◀──── tx { product, userId, displayName, initiator, transactionID, transactionReceipt }
POST /api/bits/receipt {receipt} ─────────────────────────────────────▶ verify HS256 receipt (extension secret)
                                                                        dedupe transactionId, grant effect
                                                                        PubSub broadcast result ──▶ all viewers
                                 extension.bits_transaction.create ───▶ (EventSub webhook/conduit, backup path)
```

Frontend (template `src/panel.ts`):

```ts
if (Twitch.ext.features.isBitsEnabled) {
  const products = await Twitch.ext.bits.getProducts();      // rejects where unsupported
  button.onmouseenter = () => Twitch.ext.bits.showBitsBalance();
  button.onclick = () => Twitch.ext.bits.useBits('boost_vote');
}
Twitch.ext.bits.onTransactionComplete((tx) => {
  if (tx.initiator === 'current_user' && tx.transactionReceipt) {
    ebsFetch('/api/bits/receipt', { method: 'POST', body: { receipt: tx.transactionReceipt, option } });
  }
  // initiator === 'other' (broadcast products): just play the effect for everyone
});
Twitch.ext.bits.onTransactionCancelled(() => resetUi());
```

Dialog facts: if the viewer is not logged in, the UI asks for login; other errors (banned, SKU removed)
show a generic message for 3 s. While the dialog is open the extension can't be interacted with.
Confirming shares the viewer's identity with the extension (that's why `userId` is real).

## Verifying the receipt on the EBS

The receipt is a JWT signed (HS256) with the **same base64-decoded extension secret** as viewer tokens.
Payload (per the reference; the docs table is garbled, so code defensively and log one real receipt):

```json
{ "topic": "bits_transaction_receipt", "exp": 1700000000,
  "data": { "transactionId": "…", "time": "…", "userId": "424596340",
            "product": { "domainId": "twitch.ext.<client id>", "sku": "boost_vote", "displayName": "Vote boost",
                         "cost": { "amount": 100, "type": "bits" }, "inDevelopment": false, "broadcast": true } } }
```

```ts
const receipt = await verifyBitsReceipt(body.receipt, SECRETS);   // template ebs/jwt.ts
if (seen.has(receipt.data.transactionId)) return;                 // idempotent
grant(receipt.data.product.sku, receipt.data.userId, auth.channelId);
```

- Trust **only** SKU/user/transaction from the verified receipt; the client can lie about everything
  else. Extra choices (which option to boost) are not in the receipt — store the selection before
  `useBits` server-side if it matters, or accept the client's choice for low-stakes effects.
- Persist `transactionId`s (DB unique key) — the frontend could resend.
- Receipts expire (`exp`); process promptly.

## Server-side sources of truth

| Mechanism | Auth | Use |
|---|---|---|
| EventSub `extension.bits_transaction.create` v1 | App token of the extension's client ID; condition `{ extension_client_id }`; **webhook or conduit only (not WebSocket)** | Push notification per transaction: `event.{id, extension_client_id, broadcaster_user_id/login/name, user_id/login/name, product{name, sku, bits, in_development}}`. Covers viewers who closed the page before the receipt reached you. Details: twitch-eventsub skill |
| `GET /helix/extensions/transactions?extension_id=…[&id=…][&first=…]` | App token (extension client ID must match) | History/replay: `id, timestamp, broadcaster_*, user_*, product_type: BITS_IN_EXTENSION, product_data{sku, domain, cost{amount,type}, inDevelopment, displayName, expiration, broadcast}`; paginated (max 100) |

Note: EventSub `channel.bits.use` explicitly does **not** include Bits used in extensions (and `channel.cheer` is
chat cheers) — `extension.bits_transaction.create` is the only push source for extension Bits.

## Testing

- Bits-enabled versions in **Local/Hosted Test on your own channel** can be activated without
  Partner/Affiliate status, and Bits used there are **not deducted** (monetization guide).
  `inDevelopment: true` products also don't deduct when testing.
- `Twitch.ext.bits.setUseLoopback(true)` skips live services and calls `onTransactionComplete` after
  a delay — but the loopback object has **no `transactionReceipt`** (and uses `transactionId`). Test
  EBS verification with a self-signed receipt instead (`scripts/jwt-selftest.ts` / `ebs-smoke-test.ts`
  sign receipts with your secret; `scripts/make-jwt.ts` style).
- EventSub mock: `twitch event trigger extension.bits_transaction.create -F <url> -s <secret>
  --client-id <ext id> -C 250` (verified, see jwt-and-ebs.md).
- `getProducts()` rejects in contexts that don't support Bits (old mobile < 6.4, legacy rig) — catch it.

## Policy and wording

Will fail review if violated (guidelines §5–6, submission best practices):

- **Allowed uses**: activate an experience for broadcaster/community; unlock digital consumables;
  enhance free-to-play gameplay (lives, speed, avatars…); voting/polls with Bits.
- **Not allowed**: access to pay-to-play games; jukebox (play a specific track/AV work); gambling with
  monetary-value rewards; loot boxes with random contents for Bits; sweepstakes/contest entries;
  wagering/betting on outcomes; VOIP; items defined by broadcaster/viewer free text (use predefined
  options).
- **Words**: OK — get, win, use, exchange, amount, give, earn. **Never** — cost, spend, donate,
  support, insert, sell, price, buy, purchase, cheering, betting. Don't call it "cheering".
- No other payment flows (Stripe/PayPal/links to stores) inside extensions (§5).
- Mention in the description that Bits are used (recommended).

## Subscription status

- Enable *Subscription support* (Monetization tab); broadcaster grants permission on activation (can
  revoke under Manage Permissions). Check `Twitch.ext.features.isSubscriptionStatusAvailable`.
- Frontend: `Twitch.ext.viewer.subscriptionStatus` → `{ tier: "1000"|"2000"|"3000" }` or null (not
  subbed / not identity-linked / capability off). `viewer.onChanged` fires when it changes.
- Server-side: verify via **Get Broadcaster Subscriptions** (`GET /helix/subscriptions?broadcaster_id=…&user_id=…`)
  using the linked `user_id`; the helper value is unvalidated. Per the API reference, an extension may call
  it with an **app access token** if the broadcaster granted `channel:read:subscriptions` from within the
  Extensions manager (see the twitch-api skill).

## Strategies

From the official Monetization Strategies page: ship **default configurations** so Bits interactions
work right after activation; cosmetic **viewer recognition** (name colors, icons, animations); **limited
time** items; **streamer-triggered sales**; **community Bits goals** with a progress bar; tiered
subscriber perks that add to (not gate) the core experience. Pair with chat callouts (Send Extension
Chat Message) and an OBS browser-source animation so the action shows up on stream and in VODs
(Increase Feedback guide).
