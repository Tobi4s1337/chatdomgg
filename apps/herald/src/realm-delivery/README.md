# Herald → Realm delivery

`herald dev` installs this optional private sink when `HERALD_REALM_URL` is set. Without it, the existing
Herald source and port 5194 SSE endpoint work as before. No Twitch write is performed.

Configure the process with:

- `HERALD_REALM_URL`: Realm origin, for example `http://127.0.0.1:5191`; HTTPS is required beyond loopback.
- `REALM_INGRESS_HERALD_SECRET`: the same process-only bearer used by Realm, 32–512 printable ASCII characters.
- `HERALD_REALM_OUTBOX_DIR`: optional absolute directory outside the repository; defaults to
  `<HERALD_DATA_DIR>/realm-delivery`. This directory must belong to the running user and have mode 0700.

The URL and outbox directory may also be set in Herald's existing external settings file. The bearer is
read only from process environment. Never print it or add it to tracked configuration.

Accepted normalized `PresenceInput` observations enter synced 0600 files before the source publishes its
next presentation. The sender posts `{version:1, observation}` to `/internal/realm/ingress` with the service
bearer. A file is removed only after `202 accepted|duplicate`. Lost replies are safe to resend using the
original observation ID. Backoff grows from 500 ms to 30 seconds; each HTTP attempt has a five-second deadline.
The outbox is bounded to 4096 entries plus 128 reserved for stream state and cleanup, and 32 MiB with 1 MiB
reserved for those inputs. Deletions, source loss, and offline evidence overtake activity; reducer timestamps
fence older evidence delivered afterward. A capacity or storage refusal increments redacted health counters.

Person-bound speech, emote parts, explicit Forge words, and cleanup use `/internal/realm/herald`. They never
enter the outbox and never replay or retry. The bounded transient allowance reserves space for cleanup.
`!forge` words never become an ordinary speech bubble. Realm resolves actual home ownership and its presence
epoch; Herald's Forge slot zero is only a hint. There is no public slot-frame authority relay.

Deletes send chat removal and Forge cancel; author/room clears send matching chat/Forge clears. Source loss,
shutdown, and offline observations clear transient work immediately. Realm remains responsible for all
entitlement, moderation, ownership, coal, and publication decisions.

Inspect `GET /health` on Herald's existing port: `source.realm` reports queue size, byte count, transient
count, fault code and counters. It contains no IDs, names, words, URLs, response bodies, or secrets. The
focused `delivery.test.ts` drives verified normalized ingest through a failed transport and restart, proving
that only presence evidence survives on disk and that cleanup crosses the transient service boundary.
