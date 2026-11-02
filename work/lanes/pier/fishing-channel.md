# PI10 fishing room adapter

## Decisions

- One `fishing` feature channel rides the existing walking socket and controlling seat. It creates no writer,
  presence service, movement authority or second socket. The actual retained kingdom and exact adopted scene
  come from durable boot composition. No production registration until the visible water mood is mounted.
- The shared request wrapper adds sync, take, equip and keep to the unchanged five fishing controls. No browser
  request supplies time, pose, seed, species, rolled size, story, replay or success. Equipped selection is per seat;
  a held rod remains one item in its hotbar/hand place. A replacement seat must select its own tool.
- Public projections use walker ids, never person/entry ids, items, names or proof. They explicitly copy only cast
  pose, phase, visible fight pressure and presentation beats. An ended beat may carry an allowlisted visible
  outcome (snapped, escaped, missed, cancelled or unkept), never an arbitrary refusal string. Bite closing time and environment stay owner-only.
  Confirmed catches publish species/size and kingdom-first only; names use the existing walker presentation.
- Private sync includes bounded public casts/rods, the exact adopted site/rack, server hour and mood, and only the
  current person's selected rod, cast and pending receipt id. Private messages cap at 96 KiB; public at 48 KiB.
  This accommodates 48 casts, 300 held rods and one legal item record without hiding an unbounded collection.
- Ticks use integer server time every 50 ms while work is active. Public cast snapshots run at most five times a
  second. There is no resting timer or database work on each simulation tick. Async admission/tool refresh/keep
  work is bounded, with at most four jobs and one per person; no hidden promise queue.
- Owned equipped rod facts expire after two seconds and refresh for active casts every second. Item changes
  invalidate them before notifying the channel. Real session admission is rechecked on async work. Catch writes
  re-read the selected rod on their own transaction connection; a missing rod defeats a new domain candidate,
  while an existing committed receipt remains recoverable without it. No stale cached fact can grant a catch.
- The rack grants one enduring willow rod per person/kingdom/origin with a stable receipt. The first grant requires
  the exact grounded rack approach at the adopted collision revision, uses the first free hotbar slot, and keeps
  the current approved name. A repeated request returns the original current record, including put-away state;
  it never clones or silently moves a tool. A put-away rod is recovered through the bag.
- Rod grants use the same kingdom item advisory lock → actual writer row → person/session/entry locks as catches,
  and the same database-time lease fences and synchronous commit guard. A lost commit reply asks the person to
  retry the same rack receipt. No success is sent before confirmed commit.
- A landed domain candidate is automatically offered to the catch writer. Uncertain storage retains that cast id
  for explicit `pier.keep` recovery. Sync never performs a grant. A replacement seat cannot inherit an old seat's
  asynchronous keep; confirmed recovery is private and does not replay a public catch spectacle.
  Disconnected idle people are reclaimed even with a pending id; the client carries that id for explicit recovery,
  and the durable bag independently retains any committed item. Failed auth clears queued work before repumping.
- Exact installed pier modules, canonical blueprint hashes and transforms must match the current scene before it
  authorizes fishing. A planned lake, partial pier, stale revision or tampered asset refuses. Cache only the loader's
  immutable adopted scene identity; recipe biome remains explicit or null, never inferred.
- The item foundation gains bounded placement reads (one hand or 64 hotbar/shelf slots). Slot allocation uses those
  queries and avoids whole-bag reads. Existing server-only whole collection APIs and gathered stacking stay intact.

## Runtime seam

`createFishingRoomChannel({ bind(room, selected), schedule? })` in `channel.ts` owns the per-seat selection and finite
presentation/recovery state. `selected(personId, walkerId)` returns an item id only for that exact controlling seat.
`schedule(callback, delayMs)` schedules one callback and returns its cancellation function.

`bind` returns `FishingRoomRuntime`: `casts`, `now`, `installation`, `refreshRod(from,itemId)`, `takeRod(from)`,
`keep(from,castId)`, `onRodChange(listener)` and `dispose`. All asynchronous ports are trusted server implementations;
their returned item and catch evidence never become a public payload by spreading.

`createDurableFishingChannel(options)` in `durable.ts` supplies this runtime from the real item store, actual retained
authority and adopted scene. Its mandatory `visible(kingdomId)` composition gate closes new fishing until mood
presentation exists. It does not mount itself. Main's eventual composition uses `boot.services.kingdoms.get(id)` and
`boot.loader.current(id)?.scene`, the one item foundation and validated authored species. No new core hook is needed.

## Verification required

Exercise real deterministic casts through the adapter, current-seat transfers and async boundary loss, strict input
and projection privacy, timer/job/map bounds and disposal, post-commit-only catches and uncertain receipt recovery.
Check the rod rack and bounded placement queries on the real development Postgres in asserted schema `pier`, with
one connection, rollback/guard/session/epoch cases and a lost-commit response. Verify exact real assembled geometry,
not only planned coordinates. The full signed-in API/realm/founded-scene walk, observer, restart and real-GPU feel
checks remain the complete PI10 bar.
