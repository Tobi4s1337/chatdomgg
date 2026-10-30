# Shared boundary — interchange v1

Status: **FROZEN 2026-10-30: narrow identity/event and Atlas interchange v1**, after Astra high architectural review and 22 passing contract tests. Main owns changes and version migration. This freeze lets the first Atlas producer/consumer start; it does not certify publication safety or an operating feed. No other contract group is frozen. `@chatdom/shared/fixtures` is explicitly simulated test data, not app fallback data.

## Authority and evidence

Read `chatdom/ChatDom.md`, `chatdom/Atlas.md` (especially §§2, 8, 9 and Decided), `chatdom/Tech.md` §5 and
`chatdom/Quality.md`. An Atlas signal is about channels. Person-level homes, passports, follows and locations do
not enter any public Atlas record. No schema grants a publishing permission or proves the truth of its input.

The read-only Surveyor status endpoint at `http://172.17.0.1:3541/atlas/api/status` was inspected on 2026-10-30.
`src/surveyor-status.fixture.json` stores the bounded aggregate response with capture time. `/atlas/api/raids/recent`
was inspected too. `/atlas/api/`, `/atlas/api/live.bin` and `/atlas/api/dabs.bin` returned 404. No services were
changed and no credentials were used. The readable SQLite store exists at `/srv/chatdom-atlas/data/surveyor.db`;
this package does not read or write it.

Read-only source evidence, rooted at `/root/chatdomgg/prototyping/kingdoms/g-atlas-live/surveyor/`:

- `src/server.ts:19` writes SSE `event: raid` and JSON data, **without** an SSE `id` field or replay support.
- `src/server.ts:125` projects `/raids/recent` from pair aggregates. `n` and `viewers` are cumulative and have no
  channel IDs. These rows cannot become individual caravans or identity keys.
- `src/raids.ts:129` assigns the SSE `at` with `Date.now()` after intake. It is receipt/observation time, not the
  EventSub timestamp. The normalized adapter keeps `occurredAt: null`, `delivery: ephemeral` and an observation time.
  Its deterministic content key is best effort deduplication, **not** an upstream event ID or a resumable cursor.
- `src/db.ts:15` and `src/sweep.ts` store channel facts, current `started_at`, source sweep timestamps and average
  audience statistics. Exporting a consistent index requires a separate read-only snapshot adapter.
- `src/recorder.ts:6` specifies a different format: deflate-raw, byte version 1, unsigned LEB128 stream count,
  ascending channel-index deltas, then viewer counts. It is not `live-v2` or `dabs-v1`; no decoder compatibility is
  claimed and recorder frame `started_at` is unavailable.

Prior art studied directly: [Zod strict runtime schemas](https://zod.dev/api) (the implementation is pinned to
4.6.7) and [WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html). Take explicit validation at
trust boundaries and deliberate replay identity; leave behind permissive object stripping and assuming EventSource
reconnect replays an unnumbered stream. Existing Surveyor source is evidence, not copied implementation. All team
slots were occupied during the initial study, so no reference-study subagent was spawned.

## Data model and decisions

- **Identity:** person and kingdom IDs are distinct branded decimal strings. Both originate in Twitch user IDs;
  a kingdom uses its broadcaster's ID. Login is mutable display data. A citizen key is the pair. No numeric coercion.
- **Intent:** strict `{id,type,args}`. A catalogue consumer supplies its actual args schema. The authenticated
  receiver supplies the actor; clients cannot send authority on the envelope.
- **Fact:** strict `version, kingdomId, seq, occurredAt, receivedAt, committedAt, origin, type, actor, body, cause`.
  `occurredAt` belongs to the source clock and may be skewed; receipt and commit belong to the authoritative clock,
  with `receivedAt <= committedAt`. `origin` is required: `live`, `recovered` or `simulated`. This expands Tech's
  ambiguous `at` deliberately. A system actor is null, never a fake person. A fact cause references an earlier seq
  in the same kingdom; external causes carry source identity. Catalogue bodies remain unfrozen.
- **Storage obligations:** seq is strictly increasing per kingdom; duplicate intent IDs have one result; schema
  parsing alone enforces neither property across messages. The event store must enforce both transactionally. The
  reducer owns deterministic context and provenance policy; this package does not claim to implement them.
- **Land:** an edition has a world hash and numbered realm table. Each settler has an immutable ordinal, channel
  ID, holding, holding tier, point, realm and settlement time. A channel rename or change in audience cannot move it.
  Mutable public channel facts are separate. `assertSettlerIndex` checks ownership and contiguous order;
  `assertSettlersAppendOnly` protects old records within the same edition.
- **Alignment:** live order is a global ordinal, not a shard-local offset or an assumed SQL row order. Hash canonical
  ASCII `chatdom:atlas-settler-order:v1\n` followed by each ordered decimal channel ID and LF with SHA-256. The client
  binds edition ID, world hash, order hash and count. Equal counts alone prove nothing. Continent/tier chunks must
  preserve global ordinals. The future index loader must verify shard provenance before trusting alignment.
- **Truth:** `observed`, dated `replay`, and `simulated` evidence are disjoint. Simulated evidence requires the literal
  label `SIMULATED`. Publication/receipt never refreshes old `asOf`. Single raids bind `evidence.asOf` to their
  original `observedAt`; stale events cannot launder their freshness on reconnect. Every fixture surface must render
  its mode/date. No simulated fixture is substituted on a production feed failure.

## Binary interchange v1

All three artifacts are published atomically behind one manifest. Asset paths should be content addressed in the
producer; the manifest carries SHA-256 and exact byte length. A loader retains the previous coherent snapshot until
all required files validate. A failure is an error state, never an empty world.

| Artifact | Layout | Version source |
|---|---|---|
| `live.bin` | No header. Two unsigned bytes per global ordinal: live class `0..5`, spectacle `0..6` | Manifest `live-v2`, matching Atlas §8.4 |
| `live-starts.json` | Strict version 1 object, alignment, `asOf`, sorted unique `{ordinal,startedAt}` for every live ordinal | Manifest `live-starts-v1`, proposed because two bytes cannot hold start time |
| `dabs.bin` | No header. Repeated 20 bytes: LE u32 realm index, 8 raw channel-hash bytes, LE u64 epoch milliseconds | Manifest `dabs-v1`, newly proposed, not an existing Surveyor format |

Spectacles: 0 none, 1 raid party, 2 festival, 3 Hype Train below level 3, 4 Hype Train level 3+, 5 dragon, 6 crowning.
These numbers are the v1 interchange dictionary. Spectacle is independent of live status: a witnessed festival or crowning
may persist offline. It never changes size, discovery or placement. A producer may emit it only from real founded
kingdom evidence. Class 5 includes founded hamlets under five viewers, which public sweeps cannot observe.

Start times come from real `started_at`; null explicitly means unknown and must not synthesize a bloom timestamp.
Each start record must correspond to a live ordinal in the same hashed snapshot. Dabs require a known real start;
their hashes are the first eight SHA-256 bytes of the decimal channel ID, rendered as 16 lowercase hex digits.
The producer must detect hash collisions before publishing and keep a private lookup for hover. Collisions are
rejected, never silently merged. Dabs sort by realm then hash; no channel names occur in their bytes.

Decode checks strict manifest version, alignment, allocation bounds, length, content hash, value codes and timestamp
ranges. A decoder copies the precise Uint8Array view before awaiting hashing, so callers cannot mutate checked bytes
and nonzero byte offsets work. Live output stays interleaved typed bytes. Dabs currently return bounded objects.

**Partial sweeps are rejected by the snapshot decoders.** The manifest may describe partial diagnostics, but there
is no unknown bit in `live-v2`; absent observations cannot mean offline. Keep the last complete frame and original
`asOf`, label late data and hold live animation still. A future incremental feed needs explicit per-key changes.
Observed data becomes stale after 270 seconds (180-second sweep cadence plus 90-second sweep/completion allowance).
This is a provisional consumer policy, not a claim that the Surveyor currently meets it. Future-clock observations
are a separate `clock-skew` state. `atlasFreshness` takes an injected clock and never calls Date.now.

## Publication gates and unfrozen seams

The Atlas schemas are **not a privacy, safety or moderation filter**. A producer must apply one canonical visibility
decision before emitting **every** view of a channel: labels/settlers, live/spectacle bytes, dabs, search/cards,
roads and both endpoints of raids. Hidden, deleted and excluded channels cannot leak through another feed. For a
hidden settler retain its ordinal in the private alignment, remove public label/metadata and zero its public live
bytes; do not compact the index. Dabs must be filtered before hashing. Unknown content labels remain `unknown`, never
`general`; no recommendations or early-zoom prominence can be inferred from missing labels. The kingdom-zoom policy
needs the Atlas producer's explicit decision and tests. Mature channels are kingdom-zoom only; excluded gambling
categories are absent everywhere. Per-zoom restricted live/dab overlays need classification-aware producer shards
or a verified visibility sidecar; the present two-byte live format cannot enforce that on its own.

**This visibility projection is a publication readiness gate for these Atlas artifacts.** Tests prove strict public
DTOs reject person fields and preserve unknown/excluded states; they do not claim to prove producer filtering,
because that producer is not built here. Also unresolved: label-hide/waiting-land recovery and deletion after 30 days
need a separate holding-availability/tombstone model that keeps old ordinal assignments immutable. Do not reuse a
holding or delete an old ordinal by bypassing append-only validation.

Other unconsumed seams remain unfrozen: canonical continent/realm/family tables and land geometry; partial index
chunks; public search/cards and visibility policy; authoritative IDs/cursors for resumable Atlas events; founded
pulses and ≥20-person public bands; bridges, trains and season projections; hero drawings/cameras and entry travel;
private per-user homes overlay and sign-in; recorder decoding. None require a room join or Twitch browser request.
The future public Atlas must not expose exact people-derived counts under the ≥20/banded rule. Channel viewers from
public Twitch streams and raid traveller counts have their separate channel-level meaning.

## Hot paths, budgets and what this proves

Decode once per 60-second client refresh (publication target 30 seconds), off the render loop. Pan/zoom reads only
visible ordinals; no Zod validation, hashing, network or room joins per frame. At 25,000 settlers, live payload is
exactly 50,000 bytes uncompressed. At 35,000 dabs, the proposed dab payload is 700,000 bytes; assess compression and
delta/shard publication before a broad release. Starts sidecar cost depends on the number live and needs measurement.
Hard bounds are 1,000,000 settlers, 250,000 dabs and 65,536 realms; these are allocation guards, not device targets.
Live verification uses owned typed buffers and temporary hash copies; maximum live payload 2 MB. Max dabs payload
5 MB plus current decoded JS objects; a worker/typed-array view will be needed if real-device memory requires it.
No GPU/frame-time claim is made. Atlas's target remains 60 fps laptop, ≥30 fps phone and 4 ms GPU in stream view.

Tests cover large string IDs, strict body authority, clock skew/origin/causality, real status compatibility, aggregate
versus individual raids, land invariants, stale/replay/simulation states, independent golden bytes, equal-count wrong
orders, corrupt/truncated/trailing payloads, invalid codes, offset views, concurrent caller mutation, sidecar mismatch,
unsafe u64 timestamps and duplicate/colliding dab hashes. This proves defensive interchange, not an operating map.

Next handoff: builders implement a consistent read-only Surveyor export and the visibility projection, then consume
these frozen interchange artifacts under contract tests before public publication. Artisans can work from a labelled simulated
fixture for washes/pennants while the real producer is built; those fixtures cannot become fake live activity.
Main should copy relevant decisions/reference evidence into `work/` when integrating; this author owns only this
package and has not edited outside it. No git commands or services were run. No screenshot is applicable to this
nonvisual package. Doubts are the unbuilt visibility gate, tombstones, real-device decode/memory cost and producer
atomicity; do not describe those as finished.
