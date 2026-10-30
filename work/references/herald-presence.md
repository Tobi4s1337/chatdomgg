# Herald presence: official protocol findings

Researched 2026-10-30 against current Twitch developer documentation. This is a narrow read-only ingest boundary,
not a freeze of Herald's future actions or every Twitch surface. No credentials were inspected and no requests
were made to a real channel. The app keys named in AGENTS.md are not evidence of user authorization.

## What we take

- [Conduits](https://dev.twitch.tv/docs/eventsub/handling-conduit-events/): an app-token conduit can use an
  outgoing WebSocket shard. Associate the session within ten seconds of welcome. A public callback is unnecessary
  for this transport. Conduit subscriptions survive replacement of a shard; repair the shard rather than creating
  a second set of subscriptions. A disabled shard can lose events; reconciliation is essential. Use one explicitly
  configured development conduit, never repurpose the Surveyor's infrastructure. This fits the thin typed client
  and app-token Herald direction in `chatdom/Tech.md` §7 while allowing a local test without server configuration.
- [Chat authorization](https://dev.twitch.tv/docs/chat/authenticating/): app-token chat consumption relies on prior
  reader grants, not on having the application's secret. Ask the designated reader only for `user:read:chat` and
  `user:bot`; ask the test broadcaster for `channel:bot`. We do not need `user:write:chat`, a bot badge, or a
  moderator appointment to read through this authorized path. User-token WebSocket bots are a different transport
  and are not a fallback that silently enlarges this lane.
- [Helix reference](https://dev.twitch.tv/docs/api/reference/#get-chatters): Chatters reports connected chat
  users with delay, not all stream viewers. Poll its cursor pages; deduplicate IDs; a changing total is not a
  completeness proof. An app token may use prior `moderator:read:chatters` authorization from the supplied
  broadcaster/moderator. Use the broadcaster as `moderator_id`, avoiding a mod appointment. The same reference's
  [Get Authorization By User](https://dev.twitch.tv/docs/api/reference/#get-authorization-by-user) verifies prior
  scopes with an app token. Its [Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams) supplies a
  startup/gap observation of stream state. An HTTP failure is unknown, not an empty list or offline result.
- [Subscription catalogue](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/): consume only v1
  `channel.chat.message`, `.message_delete`, `.clear`, `.clear_user_messages`, `stream.online`, `stream.offline`
  and `user.authorization.revoke`. Chat conditions identify the reader separately from the broadcaster; all chat
  cleanup types use the same chat grant family. Online/offline need no broadcaster scope. Authorization-revoke is
  webhook/conduit-only; a conduit with a WebSocket shard qualifies, a plain WebSocket subscription does not.
  Other notices and outbound actions need their own future contract review. No generic event catalogue is frozen.
- [WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/): respect welcome and
  keepalive clocks; follow Twitch's reconnect URL on a controlled handover and keep the old socket until the new
  welcome. Ordinary loss is a different recovery path. Never send application messages on the Twitch socket.
  Missed events are not replayed. For a conduit, use conduit repair rules rather than plain-WebSocket subscription
  recreation. Record a gap and reconcile only facts Helix can observe; do not stage recovered observations as new
  live chat. [Message reference](https://dev.twitch.tv/docs/eventsub/websocket-reference/) distinguishes transport
  message ID, chat message ID, event timestamp, and session identity; keep these separate for dedupe and removal.
- [Validation](https://dev.twitch.tv/docs/authentication/validate-tokens/): validate maintained OAuth sessions at
  startup and hourly, check the returned client/user/scope identity, and end affected sessions on invalidation.
  App tokens have no user identity. A valid app token does not establish prior user grants.
- [OAuth code grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow):
  consent is interactive, redirect URI must be registered, and the server exchanges a code for tokens. This lane's
  grant bootstrap validates identity/scopes then discards user tokens; it must not call revoke, which would remove
  the authorization it just established. [Refresh documentation](https://dev.twitch.tv/docs/authentication/refresh-tokens/)
  distinguishes user refresh from app tokens: app tokens are obtained anew, not refreshed. No user token store is
  needed for the chosen app-token-only runtime.
- [Get EventSub Subscriptions](https://dev.twitch.tv/docs/api/reference/#get-eventsub-subscriptions) accepts a
  `conduit_id` filter (added 2026-04-17; filters are mutually exclusive), so Herald lists only its own conduit's
  subscriptions and never the client's whole list. [Get Conduit Shards](https://dev.twitch.tv/docs/api/reference/#get-conduit-shards)
  answers 404 for a conduit that does not exist or belongs to another client, which is how the configured conduit is
  checked without Get Conduits. On Create Conduits and Create EventSub Subscription a 429 means a limit (five
  conduits; three subscriptions per type and condition), not request pacing. A 409 body names the existing
  subscription, but Herald never reads error bodies: it confirms by listing its conduit instead.
- [Rate limits](https://dev.twitch.tv/docs/api/guide/#twitch-rate-limits): honor returned remaining/reset headers
  and 429, bound concurrency/retries, and coordinate the shared app budget with the Surveyor. Never assume the
  sample bucket size is available exclusively to Herald.

## Design conclusions, not Twitch guarantees

Presence expiry, queue caps, reconnect backoff, poll completeness checks and public anonymity rules are Chatdom
policies in Spec 03. The API cannot prove a person is watching, idle, or absent. An unnamed light must never acquire
a name, raw Twitch ID, avatar or link from the Chatters list alone. Chat text stays transient, including crash/error
paths. Synthetic protocol fixtures are labelled SIMULATED; recording real chat bodies for tests conflicts with the
no-chat-logs rule. Integration evidence may store event counts, timestamps and redacted health only.

No third-party code is copied by this document. Official docs and the repo's Twitch skill templates are protocol
references; implementation is a small typed client tailored to the seven subscribed event types.
