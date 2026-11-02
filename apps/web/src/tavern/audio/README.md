# Tavern sound

`createTavernSound(host, places)` takes the existing kingdom audio host getter. The getter must return `null`
while locked, muted, hidden or suspended. The layer never constructs, resumes, suspends or closes a context,
changes a host setting, connects to the hardware output, or installs another limiter. Its output connects only
to the supplied shared destination. The shared master and limiter remain authoritative.

Call `update` with **raw witnessed `client.tables`**, the host's monotonic `performance.now()` in milliseconds,
the actual connected walker count, feet and camera forward, and the local seated table ID. Never pass a
predicted/interpolated game view. Call `quiet()` immediately on visibility loss, disconnect or destination
replacement, then `dispose()` on leaving. `affordance(table)` sounds only a real button press. None of these
methods queues sounds. A new host, unmute or return establishes a silent observation baseline.

Pong paddle/rail sounds require the optional authority's swept-contact records, deduplicated per match and
sequence, no older than 500 ms. An optional `pongContactDelay(table, contactEpoch, monotonicNow)` callback
maps actual contact epochs to the existing board presentation clock, returning seconds. Without it, contacts
sound immediately. The observer does not guess a presentation offset from public-frame arrival time.
Delayed starts count against the same budget and quiet cancels them too. Missing contact fields produce no guessed impacts. Stones requires exactly
one revision and one legal new cell at `last`. Dice requires one revision and an explicit public roll/bust or
hold; timeout never rattles the cup. Snapshot gaps, reconnections and first observations suppress history.
Backward deliveries do not replace the accepted frame or renew its 1500 ms freshness deadline, so a later
fresh frame cannot replay contacts already heard before that out-of-order delivery.
Same-millisecond revisions and Pong ticks are distinguished by their authoritative counters. A witnessed
Pong concession sounds its finish even when no physics tick advances.
The public freshness window allows the authority's one-second idle heartbeat plus jitter; a local render
gap over 1500 ms establishes a new silent baseline. The live surface observes each public delivery as well as
scene frames, so slow rendering cannot coalesce accepted moves into missing sounds. Contact age remains
limited to 500 ms on Pong's fixed-step clock, independently of the room heartbeat epoch.
Murmur is abstract filtered room air, proportional only to other actual walkers: zero with zero or one walker.
There are no speech samples, voices, pretend patrons, music or invented game events.

The feature owns at most six voices and six sources (under the twelve-source ceiling). Each cue has one
finite buffer source. The two ambience sources have a continuously renewed 750 ms stop watchdog and an
earlier gain fade; a stalled host goes silent without timers. Game cues duck the bed. Overload drops new
voices instead of accumulating a queue. Quiet/dispose synchronously stop and disconnect every owned source,
including the room reflections baked into each cue. No long reverb, delay or detached tails survive.

## Authoring and provenance

All sounds are original procedural PCM authored in `materials.ts`. There are no external samples or asset
licenses. Wood uses short, inharmonic damped body modes and filtered grain; rail is a tighter, brighter wood
touch. Stone uses hard modal transients and a small second settling clack. The cup uses low wood and scrape
under a scattered ceramic rattle. Hold banks with two small hard touches; milestones add brief restrained
brass modes. Sit/stand uses grain and a chair-body knock. Four deterministic pitch/noise/timing variants
rotate per material, per context, including across mute cycles. This is authored material sound, not speech.

`createTavernSoundGraph({context, destination}, places, true)` is the same authoring graph for a host-owned
`OfflineAudioContext`. It exposes `play(cue, position, listener)`, `update(listener, walkers)`, `quiet`, `dispose`
and public `inspect`. The offline host owns rendering, scheduling suspensions and WAV encoding; no live
observer is required for material auditions. Render through the normal shared mixer to judge final levels.
The graph's fixed output trim is 0.25; the common destination retains all mix controls. Diagnostics expose
counts, limits and occupancy intensity, never identities, inputs or game secrets.

Automated checks exercise factual transitions, duplicate/gap/reconnect suppression, mute and suspension,
actual source overlap, no fake occupancy, finite watchdogs and teardown on a fake Web Audio graph.
Listening and real output-device review are owned by the integrating surface; numeric bounds alone cannot
prove timbre, balance or comfort on headphones.
