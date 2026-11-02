# The Forge's wish line

Every wish the realm hears is written to a private durable line before Herald gets its 202, and it survives a
restart of the realm (or of its model process) at any stage. Several wishes are forged at once; the stream sees
one ritual at a time, in the order the wishes arrived. The anvil shows the line to everyone.

## Pieces

- **The line** is the existing private queue (`apps/codex/src/wish-queue`), one directory under the realm's founded
  directory (`forge-queue/`, mode 0700, files 0600). It keeps a wish's words only until the wish ends; then the
  record holds a finite reply for the maker and nothing else. Finished records the maker has heard are pruned
  after a week at start-up.
- **The worker** (`apps/codex/src/wish-worker`) claims up to three wishes at once (one per maker), each through the
  durable coordinator (`apps/codex/src/kingdom-forge/recovery.ts`). Each kingdom is still bounded by its anvils.
- **The bridge** (`apps/realm/src/evening/bridge.ts`, when `forgeQueue` is set) admits, withdraws and executes:
  - `accept` (Herald's private route) and the in-process `sink` admit the exact command and answer only once it
    is synced. A duplicate is the same wish. Message deletion and clears are durable withdrawals.
  - The intake runs once per wish and is saved: the wish's own chat message heard live, the stream online. After
    that the wish belongs to the coordinator, which saves each stage, debits every model call before it starts,
    and recovers an unknown commit from the authority rather than forging again.
  - A kingdom that closes, a realm that stops and a model process that dies all **pause** a wish. A stream that
    goes offline, a deleted message and a moderator's clear **stop** it, releasing any reservation; the maker is
    told which. The coal is spent only by the commit, so it is spent once.
  - The maker hears the outcome privately in the room and in the wish box's record. Only when that record has
    it is the reply acknowledged in the line; otherwise it is offered again later.
- **The presenter** (`presenter.ts`) keeps each kingdom's line in order. Only the head's stages reach the room;
  later wishes keep their latest stage and show it when their turn comes. The head may land only after its turn
  has been on view for three seconds, and never before an earlier wish has ended. The reveal itself comes only from
  the durable outbox, so a restart never replays one; the client plays committed rituals one after another.
- **The queue route** (`http.ts`, `GET /api/realm/forge/queue?kingdomId=`) answers `ForgeQueueView`
  (`packages/shared/src/forge-queue.ts`): the count for everyone, the signed-in maker's own place, and the makers'
  approved names only for the broadcaster (the person whose Twitch ID is the kingdom's). Never words or reasons.

## The model process

The bridge owns one warm Codex app-server (`apps/codex/src/providers/warm`) with its own private state folder and
the existing login linked in. Calls fall back to cold runs on their own while it is down; a call lost when it dies
mid-turn stays spent and the wish resumes from its saved stage. `FORGE_WARM=0` keeps every call cold.

## Proof

- `bridge-queue.test.ts`: delivery and acknowledgement, a realm stopped during words, drafting and result, a commit
  that landed before the realm heard so, three wishes in order with one ritual at a time, an offline stop, and a
  model process lost mid-draft.
- `presenter.test.ts`: order, the minimum turn, the optional reveal pause and the line's privacy.
- `work/lanes/forge-wish/restart-proof.mjs`: the served realm on a lane port, SIGKILLed (or its model process
  killed) in each stage, with real wishes through the warm worker. See `work/evidence/forge-wish/fw11-wishes.md`.
  `PROOF_PHASES=fifty` runs FW11's fixed fifty (`apps/codex/src/fixtures/fw11-wishes.ts`), two in flight.
- `work/lanes/forge-wish/walk-proof/run.mjs --controlled --queue --gpu`: a citizen at the anvil sees "Yours is next." in a
  real three-wish line, then all three land in order.
