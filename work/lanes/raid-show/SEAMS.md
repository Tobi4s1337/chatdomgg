# raid-show seams

These seams were frozen on 1 November 2026. To change one, write to both lanes' SEAMS.md. Until the other side lands, show the honest unavailable state and never a stand-in that pretends. Ask with a `needs:` line in `progress.txt` that has the exact patch written out.

## 1. The gate-mode picker (atlas-map provides, raid-show consumes)

atlas-map exports `mountAtlas(el, { mode: 'gate', ... })`, or its equivalent, from `apps/web/src/atlas`. raid-show adapts it to the existing browser port `AtlasGateHost` in `apps/web/src/raid-gate/ports.ts`, and never reaches into Atlas internals.

What raid-show needs from gate mode:
- `open(from)` and `close()`: the map opens at the source kingdom. Opening it has no side effects.
- A pick event, `{ kind: 'pick', kingdomId }`, and a close event, delivered through `subscribe`. The finder's order belongs to atlas-map: live road neighbours first, then live same-language or nearby realms, then search, with smaller live channels first in each group and never paid ordering.
- `resolve(kingdomId)` returns the channel and its land (`founded` or waiting land), under the Atlas's own visibility rules.
- `follow(raid)` attaches the viewer's map to the public caravan of one witnessed `AtlasRaid`, once per raid ID. It is presentation only.
- `travel(stage)` takes the stages `rise | road | drawing | arrived | back`, once per ticket, at the pace of the authority's answers: about 0.8 s rise and 1.5–3 s road (spec 23 R6). The map retains the source world for 60 s for a quick return.
- The wax seals and arms come from the Atlas's public `heraldry` module, so the gate, the caravan and the map show identical arms.

raid-show owns the preview, the Start press and everything after it. Until gate mode exists, the gate board runs with `atlas: null` and says the map is not available. It never shows a stand-in picker.

## 2. The roads feed (raid-show publishes, atlas-map stores and draws)

raid-show writes every witnessed raid, in both directions, into an append-only feed in the realm. Incoming raids into a kingdom and gate departures out of one are both included. The gate's `AtlasRoadIngress.observe` writes into it.

- Route: `GET /realm/raid-roads?after=<cursor>&limit=<n>` on the realm (registered with one line in `apps/realm/src/server.ts`, code in `apps/realm/src/raid-gate/roads-feed*`). `limit` is at most 200.
- Reply: `{ version: 1, items: AtlasRaid[], next: string | null }`. Every item passes `AtlasRaidSchema` (`packages/shared/src/atlas-raids.ts`) with `source: 'herald'` and `delivery: 'resumable'`. `id` is stable and derived from the EventSub message ID, `occurredAt` is Twitch's event time, and `observedAt` is the receipt time.
- Guarantees:
  - Items are ordered by a monotonic feed sequence, and a cursor resumes exactly after a restart.
  - A raid appears once, even when Twitch delivers it twice.
  - The feed holds no person data (no riders, no walkers, no stamps), only channel-level public facts.
  - A live realm never serves a simulated-origin record.
- atlas-map owns dedupe at its ledger, thickness, the fade to dotted after an unused season and never deleting a road (spec 23 R11). Following a road on the map takes you there. raid-show writes no second road store and renames no chain.

## 3. Scene mounts (grand-world owns `apps/web/src/kingdom/scene.ts` and the stream host)

raid-show mounts through existing hooks and its own new `apps/web/src/kingdom/moments/raid-*.ts` files. The incoming caravan already rides `SceneOptions.momentFeed`. raid-show asks for the following with `needs:` lines, and grand-world or the integrator adds a small typed mount.

- **Gate party:** a read-only mount fed with `{ phase: 'gather' | 'setout', leader: walker slot | 'standard', marchers: walker slots, progress }`. It draws the real walkers at `placeAnchor('gate')`, lit through the light field, and walks them out through the gate on set-out. This is the mount the raid-road lane asked for, and it replaces the paper figures.
- **Raid guests:** guests who arrive with a raid start at the gate. The realm spawn for a non-citizen arriving with a witnessed raid uses the gate anchor. This needs a patch to the spawn fallback in `apps/realm/src/founded/provider.ts` (realm core, the integrator's).
- **Pennant wall:** a mount for dated pennants beside the gate, fed from the realm (raider arms, date, raid ID), at most N shown with the newest first.
- **Camera:** the gate shot through the existing `CameraLease`, and the gate anchor's screen point so words and seals sit over it.
- **Shutter (stream host, `apps/web/src/stream/**`):** the stream view honours `{ shutter: 'on' | 'off' }` from the realm within one second. It cuts to a calm wide shot with no names, no made things and no voices until the shutter is lifted.
- **Grand land:** grand-world keeps a true gate anchor, a walkable gate route and the light field on the grand land, as on the old land.

## 4. The HUD slot (play provides the slot, raid-show provides the pieces)

play owns the in-world HUD, the Esc menu and the minimap, and gives them typed slots. raid-show mounts its own pieces into play's slot:
- `RaidCall`: "MashaD4's raid is at the gate" for people here, and the march call (join, leave, Twitch's countdown) when the monarch opens the gate.
- `RaidGuestWelcome`: the greeting by name for a guest who walked in, plus a Watch on Twitch link.
- `RaidJourney`: the journey stages and Return home.
- **Guest crest on walkers:** `guestCrest(slot) → { kingdomId, arms, colours } | null`, which play's walker label and outfit layer draw as a crest and pennant. raid-show never edits walker rendering.

Until the slot exists, raid-show renders these pieces in its own gate overlay and moves them into the slot when it lands.

## Other seams

- **Passport stamps (raid-show to front-door, panel-window and the integrator).** raid-show exports a reader from `apps/api/src/raid-gate` that implements the `stamps(person, cursor, signal)` port of `apps/api/src/passport/read.ts`, with the hide switch. The hard-coded empty travel lists (`apps/api/src/public/panel/reading.ts:188`, front-door; panel adapters, panel-window) switch to it.
- **Forged gifts (forge-wish).** A forged piece becomes giftable only through a typed port from forge-wish: owner, revision, transferable, and a conditional owner change in one transaction. Until then, the only giftable thing is the welcome offering, held in raid-show's own tables.
- **Migration (the integrator).** `apps/realm/src/persistence/migrations/0011_realm_raid_gate.sql` is a new file in its own commit. The live schema must be migrated before the live realm runs a build that carries it.
- **Live deploy (Tobias and the integrator).** The live Herald and realm pick up the outgoing subscription and the new scopes only after the merged build is deployed and tobi4s_ re-grants. raid-show never restarts them.
