# The look store

A person's look is saved to their Twitch identity in the realm database and travels as a content token in the walker's
existing `look` string. The contract is `packages/shared/src/look-store.ts`; nothing in the room protocol changes.

## Tokens and storage (migration `0013_realm_citizen_looks`)

- A token is `lk.` + the first 40 hex of the SHA-256 of the canonical recipe: `parseLook` output serialised with sorted
  keys at every level (`canonicalJson`). Equal looks give equal tokens, however they were written.
- `realm_look_recipes` holds one immutable row per token (an update is refused by trigger). A recipe names no person.
- `realm_citizen_looks` holds one current look per person (`person_id` references `realm_persons`).
- `realm_wardrobe_grants` holds pieces granted on the server. It names the Twitch user ID without requiring a person
  row, so a piece forged by someone who never signed in waits for them. First grant wins per person and piece.
- The six starter ids stay valid tokens and are served from `starterLookRecipe`.

## Routes (on the realm's uWS app; the gateway and the web dev proxy send `/api/realm/looks/…` here)

| Route | Who | Reply |
|---|---|---|
| `GET /api/realm/looks/:token` | anyone, any origin | `RealmLookRecipeReply`. Saved tokens: `public, max-age=31536000, immutable`, ETag, 304 on `If-None-Match`. Starter ids: `public, max-age=3600`, because a deploy may retune a starter while a saved token can never change meaning. 400 for a malformed token, 404 for one never saved. |
| `GET /api/realm/looks/me[?kingdom=<id>]` | the signed-in session | `RealmLookMineReply`, `no-store`. `entitlements` are exactly what a save in that kingdom is checked against (null without a kingdom, or when that kingdom's records cannot be read). |
| `PUT /api/realm/looks/me` | the signed-in session + `x-csrf-token` | `RealmLookSaveReply`, `no-store`. 16 KB body limit, 20 saves a minute per person. |

The session is the one the kingdom entry trusts: the `__Host-chatdom_session` cookie (or `chatdom_session` when
`REALM_PUBLIC_ORIGIN` is plain-HTTP loopback, the API's own rule), looked up as SHA-256 in `realm_sessions`,
unrevoked, unexpired by database time and of the realm's origin. The CSRF token is the API's `csrfFor(handle)`,
re-derived here and compared in constant time. A body never names a person.

Refusals: `unauthenticated` 401, `forbidden` 403 (CSRF), `malformed` 400 (413 when too large), `unearned` 403,
`unsuitable` 422, `busy` 429, `unavailable` 503. Every refusal changes nothing.

## What earned pieces are checked against (`entitlements.ts`, behind the `LookRecords` port)

- **Tenure**: the signed follow and subscription records on the person's deed in that kingdom (`realm_deeds.evidence`),
  verified again with `TenureEvidenceVerifier`. Following counts whole calendar months from `followedAt` to when the
  follow was observed, never extrapolated to today. A subscription record carries months but no tier, so it counts as
  tier 1 (prime and tier 1 earn the same pieces); a tier cloak needs a record that names the tier. A sub observed in
  the last 31 days shows as current, older ones dimmed. Records that no longer verify count as no record.
- **The kingdom**: its host-approved name (`this kingdom` when none is approved) and its two colours (field, charge)
  read from the royal standard that its founded scene actually flies at the castle gate (`arrival:standard:royal`),
  through the scene's own material registry. While no founded scene for that kingdom is prepared on this realm the
  records are `closed`: a save wearing a kingdom piece is refused as `unavailable` and `GET /me` gives null.
- **Founder badges, keepsakes, forged pieces and moments** have no realm record yet, so they stay empty; their pieces
  are refused until the owners of those records (passport, forge-wish, raid-show, the cheer moment) provide them.
- A save without `kingdomId` may wear no earned piece.

## Wearing it live (`presentation.ts`)

`attachLookPresentation(kingdom, store)` is attached by main through `createDurableRealmBoot({ attach })`. The
authenticator puts the saved token in `principal.look` at entry. After a save, `DurableKingdom` would still present
walkers from that entry-time principal (on reconnect and in `refreshPresentations`), so the hook wraps the kingdom's
`bindRoom`: the room's `presentWalker` effect always receives the person's newest saved token with the kingdom's own
home slot, and a save re-presents that person's walkers in every attached kingdom with the last home slot.

The cleaner hook the room owner could add later, which would let this module drop the wrap:

```ts
// apps/realm/src/ports.ts
export interface RealmLookSource { lookOf(personId: PersonId): string | undefined; onChanged(listener: (personId: PersonId) => void): () => void }
// apps/realm/src/persistence/kingdom.ts
bindLooks(source: RealmLookSource): () => void   // presentWalker uses source.lookOf(personId) ?? principal.look,
                                                 // and onChanged re-presents that person's walkers
```

## Server-side grants

`grantWardrobePiece({ personId, pieceId, slot, title, recipe, source: 'forge' })` from `apps/realm/src/look/index.ts`
uses the store main installs. It is idempotent per person and piece, and its grants come back in `GET /me` as `granted`.

## Tests

`store.test.ts` and `http.test.ts` (memory repository, a test session port, the real uWS app over HTTP),
`presentation.test.ts` (a real `DurableKingdom` and kingdom room with SDK clients), and `postgres.integration.test.ts`
(gated on `REALM_DATABASE_TESTS=1`, a random `realm_test_*` schema):

    REALM_DATABASE_TESTS=1 node --env-file=<env> node_modules/vitest/vitest.mjs run --no-fsModuleCache apps/realm/src/look

`--no-fsModuleCache` matters after adding a migration: the cached transform of `persistence/migrate.ts` keeps the
old `import.meta.glob` list.
