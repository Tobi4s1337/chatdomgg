# PW11: hooks outside the lane

Superseded on 2026-11-02 by the finished PW11 (see `PW11-NOTES.md`). The earlier challenge-based proposal is gone. Its
realm side, the chat door and the stream projection, now lives in the lane's own panel door. Nothing outside the lane
is edited in the lane checkout. The hooks that remain are patches for their owners. Each dry-runs clean on this
checkout:

- `PW11-RENEW-NEEDS.patch`, main (`packages/shared/src/presence.ts`, `packages/world/src/presence.ts` and its
  test): `restore { consent: 'renewed' }` lifts only a forget hold. Until it lands, the panel and the realm say
  "Your window stays dark" after forget. Once it lands, Take your place relights, with no lane change.
- `PW11-HERALD-NEEDS.patch`, raid-show (`apps/herald/**`): the chat commands `!chatdom quiet`, `!chatdom quiet off`
  and `!chatdom forget`, sent to the realm's chat door.
- `PW11-WALKER-NEEDS.patch`, main (`packages/shared/src/realm/watch.ts`) and grand-world
  (`apps/web/src/kingdom/observed-walkers.ts`): a walker may have no name, and the stream draws no label for one.
  The lane's walker redaction switches on when the schema allows it.
