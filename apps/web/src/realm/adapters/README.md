# Checked kingdom entry

`createLiveKingdomEntrySource(options)` is implemented in `../../kingdom-entry/live.ts` and returns the existing
`KingdomEntrySource`. Required options are `kingdomId` and the host's approved public `kingdomName`. A founded
manifest does not carry a public kingdom title: callers must resolve real approved metadata, never derive one
from a URL or supply a constant approval. Optional `origin: 'simulated'` is an authenticated rehearsal and requires
a visible `notice` containing `SIMULATED`. It uses the same session/ticket schemas as live entry.

Defaults:

- Same-origin GET `/api/realm/session`, lazy CSRF POST `/api/realm/ticket`, opaque session `resumeScope`.
- Same-origin GET `/api/realm/founded/:kingdomId`, then exact `/api/realm/founded/scenes/:sceneHash` bytes.
- Room transport `${location.origin}/realm-data`, with explicit trusted endpoint override for host configuration.
- Browser session storage for reconnect seats. Tickets are never stored.

The receipt, full public scene and every blueprint hash are checked by `@chatdom/world/founded-scene` before the
shared `@chatdom/world/founded-collision` compiler runs. Entry compares kingdom, origin, layout and collision
revision with the actual room state and its public checkpoint. Readiness requires a checked public presence
frame. Failures reject entry; no direct Herald connection or generated scene substitutes for it.

The returned immutable `collision` belongs to exactly one scene receipt. Existing `kingdom/walk-scene.ts` holds
prediction when the room revision changes and calls `walk.onSceneNeeded`; `KingdomEntry` unmounts/disposes the
old bundle and calls its source again to fetch the new receipt. No changed collision world is installed behind
old rendered geometry. The source owns room/observer/chat lifecycle, removes handlers on disposal and follows
its AbortSignal, including entry cancellation.

`observeRealm` installs bootstrap `throughCursor`, buffers racing public `world` rows and applies their sparse
monotonically increasing `cursor`; private fact sequences and presence frame sequences never order delivery.
Historical Forge messages in bootstrap do not play rituals. Writer changes resync public state. Transport loss
invalidates present-tense evidence until a new checkpoint arrives. `createRoomPresenceFeed` also expires silent
frames after the frozen presence lease.

The extra returned `chatFeed` exposes `RealmChatFeed.subscribe(receive)` over the frozen public transient chat,
chat.remove and chat.clear messages. It validates identity-free cues against the current presence epoch/origin,
active slot and expiry, deduplicates transient IDs and clears on disconnect/resync. It never archives speech or
replays bootstrap chat. Main owns the `KingdomEntryConnection`/Kingdom presentation port for this feed.

Focused checks: `pnpm exec vitest run apps/web/src/realm/adapters` and scoped eslint. The live-source test reads
the real checked SIMULATED founded scene artifact and runs the actual browser compiler, then checks receipt,
sparse public cursors, transient speech and drop/abort listener cleanup using an injected SDK room. It is not
live OAuth/Twitch evidence or a network/visual tour.
