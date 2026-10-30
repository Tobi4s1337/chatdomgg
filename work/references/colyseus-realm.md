# Reference: Colyseus realm transport and prediction

[Colyseus](https://github.com/colyseus/colyseus) · MIT · studied at `724b5449b51dcc07b7835afd7b3e4898fda2c7f7`.
[Prediction playground](https://github.com/colyseus/prediction-playground) · MIT · studied at `90d7dd247158d18a1d9b024ecc1087a7de5ddf2e`.

For: authoritative kingdom rooms, walking prediction, district visibility, reconnect, and the realm/client boundary. Studied 2026-10-30; source inspection only, no new benchmark, implementation, tests or captures.

## What it is

Colyseus 0.18 provides server-owned rooms, schema delta replication and matching client prediction primitives. The playground isolates prediction from rendering: the same room serves both unpredicted and reconciled clients, and one shared movement function runs on both sides. Its useful contribution is the exact input/ack/replay contract, rather than its arena UI.

The prior Chatdom prototype benchmark measures joins plus outgoing schema writes on this host. It demonstrates the cost of broadcasting moving entities to everyone. It does not measure a complete Chatdom simulation or thousands of walking clients.

## Versions and primary sources

Use exact pins rather than caret ranges: `@colyseus/core: 0.18.23`, `@colyseus/sdk: 0.18.8`, `@colyseus/schema: 5.0.42`, `@colyseus/uwebsockets-transport: 0.18.4` (and `@colyseus/ws-transport: 0.18.4` if needed). These are the versions resolved in the read-only prototype’s `bench-colyseus/package-lock.json`. The Colyseus bundle resolves to `colyseus: 0.18.10`. Versions differ between packages; do not assign every package the core version. Node 22 satisfies core and uWS transport engines.

Checked the actual published [core tarball](https://registry.npmjs.org/@colyseus/core/-/core-0.18.23.tgz), [SDK tarball](https://registry.npmjs.org/@colyseus/sdk/-/sdk-0.18.8.tgz), and [schema tarball](https://registry.npmjs.org/@colyseus/schema/-/schema-5.0.42.tgz), extracting source for inspection in temporary reference clones. Prediction and `smoothMs` are published APIs, not merely unreleased master features. The clone's core schema peer minimum is `^5.0.8`; the inspected, previously benchmarked schema release is 5.0.42. Local clone commit IDs were read from `.git/HEAD` and loose ref files; no git commands ran.

## What we take

### Schema 5: builders or legacy decorators, with explicit visibility

Prefer `schema({ field: t.float32(), players: t.map(Player).view() }, "State")`, with `type Player = SchemaType<typeof Player>` alongside its constructor. This is the playground's approach: `prediction-playground/src/server/schema/move.ts:1`. Builders avoid changing the compiler's decorator behavior.

Legacy `class Player extends Schema` with `@type("float32") x = 0`, `@type({ map: Player })`, and `@view()` remains supported. It needs `experimentalDecorators: true` and `useDefineForClassFields: false`; these are legacy decorators, not TC39 decorators. Sources: schema 5.0.42 `README.md:50`, `README.md:68`, `src/annotations.ts:233`, `src/annotations.ts:282`. Both declarations produce the same wire format. Every field that must be spatially filtered must opt into `.view()`/`@view()`; a `StateView` does not retroactively hide ordinary unfiltered fields.

Create one `StateView` object per district interest set and assign that same object to all clients entitled to precisely that set: `client.view = districtView`. Add district/entity schema instances only after attaching them to room state (`StateView.add` rejects detached instances: schema 5.0.42 `src/encoder/StateView.ts:326`). Use `view.add(entity)` / `view.remove(entity)` as district membership changes. Shared views must contain no per-citizen secrets or unique local-player additions; those require an independent channel or a separately designed visibility group.

The reuse matters because core `packages/core/src/serializer/SchemaSerializer.ts:300` caches an encoded patch by **StateView object identity**, not equivalent contents. Twenty shared views can encode twenty bodies; 2,000 equivalent but separately allocated views can encode 2,000 bodies. Caveat: the no-schema-change/manual-view-change path at `:210–230` encodes per affected client without this cache. Do not claim every visibility-only frame has the same group reuse.

Switching an individual client between shared views needs an explicit old-interest removal/full-resync policy. Merely replacing `client.view` must not be assumed to purge the previous district from that client's decoder; demonstrate district handoff before relying on it. Do not remove objects from the shared old view to switch one citizen, because that changes everyone sharing it.

### Input, fixed time and acknowledgements

Use `class RealmRoom extends Room<{ state: RealmState; input: MoveInput }>` and `inputs = this.defineInput(MoveInput, { bufferMaxSize: 64, sanitize: { moveX: [-1, 1], moveZ: [-1, 1] } })`. `defineInput` is protected, returns `InputAPI`, and is declared once in the room. Input frames contain flat primitives; no nested state or collections. Do not add an application sequence field or client-controlled `dt` to the basic reliable movement protocol. Core tracks received/consumed input sequencing and emits acknowledgements itself. Sources: core `Room.ts:706–784`; playground `MoveRoom.ts:14–21`.

`setFixedTimestep((ctx) => step(ctx), 30)` advertises 30 Hz to clients and supplies fixed `ctx.dt = 1/30` seconds. The accumulator catches up at most five steps before discarding excess backlog (`Room.ts:1020–1065`). `setTimestep` is not the fixed-time deterministic contract. `setFixedTimestep(step, hz, { subSteps: 2 })` can run physics twice per input with `ctx.subDt`; the client receives the same subdivision. The schema patch interval (`patchRate`, milliseconds) is independent of this simulation/input rate.

Choose input consumption deliberately. For independent entities, iterating `for (const command of inputs.get(sid))` consumes and integrates each command, as `MoveRoom.ts:75–81` does. For a shared solver, `.next()` consumes one command per client, then the world advances once. Never drain many commands, integrate only the latest, and acknowledge all of them. The ack must name inputs that actually ran.

For walking, prefer at most one authoritative movement integration per citizen per fixed tick, with an explicit empty-tick policy, so a client cannot buy extra movement by flooding a drain loop. Domain sanitization alone is not an input-rate budget. Declaring `idle` can synthesize defaults on missing input without advancing the consumed ack; hold-last-input must gate on connection state or a dropped client can keep walking through its reconnect grace window. This policy is a Chatdom decision, not a benchmark result.

### Client prediction remains an adapter

`import { Predict } from "@colyseus/sdk/predict"`; `Predict.get(room, options)` owns passive smoothing and reconcilers. `predict.attachAll("players", { mode: "lerp", fields: ["x", "z"], snap: threshold })` smooths remote positions. `room.input<MoveInput>({ mode: "reliable" })` returns the input handle. `predict.reconciler(self, { input, fields: ["x", "z", "vx", "vz"], smoothMs, step })` predicts local movement and replays unacknowledged inputs. Position **and velocity** must be included if velocity influences the next step. Sources: playground `src/client/labs/03-reconcile/net.ts:8–45`.

Frame order is fixed: `const n = predict.tick(rafTimestamp)`; stage/send exactly `n` inputs; then read `predict.value(entity, field)` for rendering. One input per render frame is wrong on variable-refresh displays. See playground `03-reconcile/index.ts:90–102`. A shared pure movement function consumes `(state, input, dt)` without clocks, RNG or hidden world reads (`src/shared/movement.ts:19`). Snapshot collision inputs needed by prediction must also match the server. With float32 wire fields, round shared simulation results consistently if branch-level exactness requires it.

**Documentation correction:** `PREDICTION.md` contains examples with `smoothing`; the actual release option is **`smoothMs`**, measured in milliseconds (`SDK src/predict/rollback.ts:300–306`, playground `net.ts:42`). `smoothMs = 0` snaps corrections; otherwise the correction decays about 63% per time constant. Select remote interpolation delay from the actual patch cadence, rather than copying 100 ms into a 2 Hz stream. No physics rewind is needed for ordinary walking; `allowRewindState`/`predict.sim` are additional primitives for interactions that truly require them.

### Reconnect survives a reload only with token storage

Server: `onDrop(client) { this.allowReconnection(client, seconds); }`, keep its citizen/entity through the grace period, then remove connection state in `onLeave`. Playground uses ten seconds (`MoveRoom.ts:64–72`); choose Chatdom's grace deliberately. Core retains auth, user data and the assigned view across a successful reconnect (`Room.ts:1997–2025`). A transport reconnect preserves a seat; it is not persistent world storage or process-restart recovery.

SDK auto-reconnect applies to a surviving `Room` instance; its default minimum connection uptime is **5 seconds** (`packages/sdk/src/Reconnection.ts:68–77`). A browser reload loses the instance. Persist the opaque `room.reconnectionToken` in tab/session-scoped storage after successful join, and call `client.reconnect(savedToken, RealmState)` before a fresh join; on expiry, discard it and do an authenticated join. Scope storage to account and kingdom, clear it on sign-out/consented leave, and never log tokens. Token format is `roomId:token`, not separate session/room arguments (`SDK Client.ts:276–305`).

The token rotates. In the inspected SDK `Room.ts:694–707`, `onReconnect` fires **before** `reconnectionToken` is assigned in `finally`; persist in a queued microtask or after the completed join/reconnect promise, rather than synchronously saving the callback's stale token. `Room.ts:845–851` resets input state, and current reconcilers follow its epoch automatically. The older playground explicitly calls `recon.reset()` after reconnect; do not also invent a second ack counter.

### Backpressure and abuse limits must be concrete

`new uWebSocketsTransport({ maxBackpressure: 1024 * 1024, closeOnBackpressureLimit: true, maxPayloadLength: 4096 })` uses supported transport options. Colyseus defaults are 1 MiB backpressure, compression disabled, 4 KiB inbound frame maximum, automatic pings (`uWebSocketsTransport.ts:29`, `:73–86`). The pass-through `WebSocketBehavior` supports `closeOnBackpressureLimit`; it must be explicit for reliable delta streams. The transport's `raw()` ignores `ws.send()`'s result (`uWebSocketClient.ts:71–83`), while uWS reports a dropped send at its limit. Continuing after a dropped delta can leave a connected decoder stale. Closing makes recovery explicit. [Primary uWS type documentation](https://github.com/uNetworking/uWebSockets.js/blob/master/docs/index.d.ts) documents this option and send status; transport 0.18.4 depends on uWS v20.52.0.

Set a finite `room.maxMessagesPerSecond`; its default is Infinity (`Room.ts:330`). The guard counts incoming protocol frames, including inputs, and forcibly closes excess senders (`Room.ts:2284–2295`). Budget above fixed input Hz with allowance for bursts, clock/control traffic and legitimate actions; e.g. 120 at 30 Hz is a starting policy to measure, not an upstream requirement. Enforce action-specific authorization, geometry and byte budgets as well. The transport frame cap is not a complete edit-operation budget.

## Prior join + write scaling evidence

Source: the read-only prototype’s `bench-colyseus/{README.md,server.mjs,clients.mjs,ramp.sh,run.sh,ramp-*.out}`. One room, 220 static plots, all 64 or 200 movers update at 10 Hz, quantized x/z, one lantern toggle per second. Patch frequency varies below. Clients connect in 500-client processes, ramp stages target 1k/2.5k/5k/10k with 30-second dwell. Server and clients share the host. No client sends gameplay inputs or chat traffic; `clients.mjs` only joins and decodes state. `maxClients = 100000` is a test ceiling, not achieved capacity.

| Transport / movers / patch Hz | Actual clients at target stage | Server event-loop utilization, two reported samples | Maximum lag in samples |
|---|---:|---:|---:|
| uWS / 200 / 10 | 2,500 | 0.287–0.315 | 30–73 ms |
| uWS / 200 / 10 | 4,929–4,967 | 0.919–0.923 | 101–135 ms |
| uWS / 200 / 10 | 6,007–6,137 at target 10k | 0.999–1.000 | 120–137 ms |
| ws / 200 / 10 | 2,500 | 0.397–0.408 | 43–52 ms |
| ws / 200 / 10 | 4,962–4,984 | 0.975–0.994 | 179–232 ms |
| ws / 200 / 10 | 5,475–5,544 at target 10k | 1.000 | 175–211 ms |
| uWS / 200 / 2 | 10,000 | 0.427–0.523 | 218–378 ms |
| uWS / 64 / 5 | 10,000 | 0.822–0.852 | 172–179 ms |

The low-frequency runs reached 10k, but the observed lag disqualifies reading these as latency targets. The final `joined 5000` lines in the saturated runs are completed-client-process summaries, not exact concurrent room population; use the server's `clients` field. The samples overlap joins and writes; they are not isolated steady-state CPU measurements. No sustained duration, slow-WAN-client or security claim follows from them.

**Prediction changes this cost:** `SchemaSerializer.ts:47–80` adds an 8-byte timed prefix and allocates/copies a separate frame per recipient whenever `defineInput` is enabled. Shared district views reuse the encoded schema body, not the complete timed network frame. Input rooms also send timing heartbeats during unchanged ticks (`:235–245`). The old benchmark has no `defineInput`, so it does not establish predicted-room capacity. A kingdom room with many passive spectators can still pay this per-client work if prediction is enabled in that room.

`enc.mjs` contains separate schema byte-count and shared-versus-per-client view experiments, including 20 district views. No captured output of those experiments was present in this benchmark folder; their numeric results must not be invented or inferred from the ramp logs.

## What we do differently

The smallest working boundary is one real kingdom room plus one browser realm adapter: the room authenticates identity, owns authoritative walking, projects persistent world facts into schema and assigns a district view; the adapter joins/reconnects, stages typed inputs, drives Predict and exposes plain render reads. Share deterministic movement and contract types, not room instances or renderer objects. Keep Twitch authority, economic actions and durable world events outside client movement input. One district view per identical district interest set preserves body reuse; kingdom-wide counters may remain unfiltered, but individual homes, citizens and edits obey the world's own privacy and authority rules.

Use these primitives directly before adding an abstraction that recreates their ack/replay machinery. Preserve a measured path to separate passive spectator delivery from active walking if timed-frame fan-out requires it; the old benchmark cannot decide that boundary. The kingdom's complete persistent population is not its high-frequency motion set. All visible avatars remain real people; the benchmark's synthetic `npc` entries are load generators, not a product content model.

## Leave behind

For an explicit server relocation, the pinned SDK's `reconciler.reset()` reseeds truth and clears replay/render
anchors without resetting reliable input sequence. Reattaching a peer's existing `Predict` fields clears their
old snapshot rings. Chatdom uses a separate authority placement context echoed on input, since server
`InputBuffer.clear()` cannot fence packets still in transit. Neither mechanism changes `stepPlayer` or adds an ack.

The playground's squares, force-impulse/debug UI, eight-player room limit, arena physics constants and ad hoc spawn ring. Do not copy its lack of per-input rate enforcement as a security model, its ten-second grace as a product decision, or its damped remote motion as an automatic choice for a kingdom. Do not execute the old scripts: they use port 2601 and broad process matching, outside this task's authorized server workflow.

## License

Colyseus core/SDK/uWS transport: MIT, copyright Endel Dreyer (root license 2015–2026). Playground: MIT, copyright 2026 Endel Dreyer. Schema 5.0.42: MIT, copyright 2018 Endel Dreyer. uWebSockets.js type source carries Apache-2.0. These permit code adaptation with preserved notices. This note adapts techniques only; no third-party code was added to shipped files. Any implementation that copies source must name the source/license in that file and record the adaptation in `THIRD_PARTY.md`.

## Chatdom compatibility patches

The executable reference exposed two colon-ID bugs in these releases. SDK `Client.reconnect` and Room automatic reconnect split the opaque `roomId:token` at the first colon; Chatdom patches them to split at the last. uWS `onConnection` excludes colons from its room-path regex; Chatdom permits colons in that segment. Versioned pnpm patches preserve the SDK/transport behavior otherwise. The actual three-client join/reload test exercises `k:999000001`, so this cannot regress silently. These are dependency fixes, not replacement netcode. Credits are in `THIRD_PARTY.md`.
