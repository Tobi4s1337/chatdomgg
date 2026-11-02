# Forge chat transport

This module sends one citizen-owned `!forge` message. It does not invoke Forge creation, spend coal, or
invent Herald evidence. The existing evening bridge supplies the private `ForgeChatObserver`; exact
message IDs reconcile an early observer result with the successful Twitch send reply.

Composition exports are `installForgeChatSchema(pool)`, `forgeChatConfig(publicOrigin, env)`,
`PostgresForgeChatStore`, `createForgeChatService`, and `mountForgeChatRoutes`. The caller owns the pool,
actual founded/stream preflight, committed-outcome recovery, startup and shutdown. Mounting reuses the
existing sign-in session lookup and CSRF helpers read-only. `stop()` waits for owned operations.

The additive 0014 SQL uses its own checksum ledger, `forge_chat_schema_migrations`, so the realm's existing
global migration registry does not reject another lane's ID. Install it on the realm's configured schema
before mounting or starting the service. There is no memory fallback in production.

Configuration requires `FORGE_CHAT_ENABLED=1`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
`FORGE_CHAT_REDIRECT_URI`, and `FORGE_CHAT_TOKEN_KEY_FILE`. The redirect must exactly equal the validated
`REALM_PUBLIC_ORIGIN` plus `/api/realm/forge/chat/callback`, registered on the Twitch app. The key file must
exist outside the checkout, resolve outside it through symlinks, have mode 0600, and contain one base64
32-byte key. Missing or invalid configuration leaves the wish box unavailable with channel-chat guidance.
No credentials, keys, authorization URLs or wish words belong in logs or evidence.

Grants are AES-256-GCM encrypted and bound to origin, citizen, client and generation. Advisory transaction
locks serialize absent and existing grant rows. Rotated pairs commit before validation and use; a temporary
validation outage leaves the pair cold rather than resurrecting an old refresh token. Startup and recurring
validation mark grants unvalidated before checking. A session is rechecked with the same locked connection
immediately before a send. Explicit local revocation can clear even a damaged ciphertext.

The keyed body digest and durable request ID claim precede the irreversible send. Detail expires after
24 hours; a compact tombstone remains permanently. Network uncertainty, malformed successful responses,
server errors and interrupted claims never trigger a second send. Only a definitive first 401 permits one
refresh and retry, bound to the rejected token so concurrent senders reuse a completed rotation. A 200
`is_sent:false` remains not-sent. Provider text never becomes a private explanation.
Once Twitch supplies a valid message ID, it survives a failed grant transaction reply or receipt binding.
Only the idempotent database binding gets one recovery attempt; the Twitch POST is never repeated for this.
If the database remains unavailable, the durable claim still prevents another send; this does not close the
crash window between Twitch's reply and durable binding or replace the durable wish queue.

OAuth consent reads the actual same-client authorization and preserves its scopes while adding only
`user:write:chat`. State is hashed, expiring, single-use and bound to the exact app session and grant
generation. Callback return paths are fixed. A user token sends to active Shared Chat channels according to
Twitch's behavior; it cannot use `for_source_only`.

Unit tests use authored SIMULATED fixtures and mocked HTTP/storage. `postgres.test.ts` instead exercises the
actual migration, encrypted grants, request ledger, transactions and advisory locks against PostgreSQL, with
controlled HTTP responses. No test performs a real Twitch write. Opt in only with `DATABASE_URL` loaded without
printing it and `REALM_DATABASE_SCHEMA=realm_forge_wish`:

```sh
FORGE_CHAT_POSTGRES_TEST=1 REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 pnpm exec vitest run apps/realm/src/forge-chat --no-file-parallelism --testTimeout=30000
```

The integration harness refuses any other schema/search path, installs the additive realm and Forge migrations
there, and deletes only its random fixture rows. It never drops a schema. Two contention cases observe actual
waiting locks, and the slow callback spans the realm pool's ten-second idle-transaction ceiling. Startup tests
scope maintenance to their fixture; they do not exercise the global retention sweep. Receipt expiry is modeled
by tombstoning only the fixture row. Ordinary runs skip the PostgreSQL suite unless explicitly enabled.
