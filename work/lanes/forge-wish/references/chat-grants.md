# Reference: Twurple's refreshing auth provider

[Twurple](https://github.com/twurple/twurple/tree/c487a28ae1e9e76c59dc085a52fbe6242e16d45b/packages/auth)
· MIT · studied at `c487a28`, 2026-11-02. For FW10's separate chat grant.

## What it is

A mature TypeScript Twitch auth library with per-user refresh coalescing, intent routing and refresh events.
The reference checkout is `/tmp/chatdom-refs/forge-wish-twurple`; no reference code was run or copied.

## What we take

- `packages/auth/src/TokenFetcher.ts:16–69` coalesces ordinary token retrieval around one in-flight promise.
  Forge needs the stronger equivalent across realm processes: the database grant lock includes an absent row,
  refresh, revocation and saving the rotated pair.
- `packages/auth/src/AccessToken.ts:68–97` refreshes within a 60-second expiry margin. Forge also treats a
  nearly expired token as needing renewal, before attempting an irreversible chat send.
- `packages/auth/src/providers/RefreshingAuthProvider.ts:363–375` replaces the whole token pair on refresh.
  Forge must preserve a rotated refresh token even if the subsequent validation read has a transient failure;
  unvalidated credentials remain unusable until identity and scopes have been checked.

## What we do differently

The provider's event emission does not await durable persistence. Forge saves encrypted credentials before
using them, serializes with revoke and callback generations, and binds encryption to the person, realm origin
and app client. A transient provider outage does not establish that consent was revoked.

`RefreshingAuthProvider.ts:350–375` explicitly forced refreshes bypass ordinary fetch coalescing. Forge does
not rely on that in-memory queue for its first-401 refresh. `:124–147` accepts caller-supplied user identity;
Forge independently checks the actual token's person, client and all requested scopes after exchange/refresh.

## Leave behind

The broad library API, intent routing, permanent caching of all refresh failures (`:570–577`) and token files.
The Forge's finite chat transport and existing realm session authority need none of those surfaces.

## License

MIT (`packages/auth/LICENSE`). Ideas only; no copied or adapted implementation, assets or dependency added.
