import type pg from 'pg';
import { KingdomIdSchema } from '@chatdom/shared';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { DurableRealmServices } from '../persistence';
import type { FoundedReadRequest, createFoundedReader } from '../bootstrap/founded';
import { FoundedReadError } from '../bootstrap/founded';
import { assembleFoundedScene } from '../founded/scene';
import { type FileFoundedStore } from '../founded';
import type { AllocationService } from '../allocation';
import { enrichNativePictureGroves } from '../founded/picture-groves';
import { enrichNativeMarket } from '../founded/market-furnishings';
import { enrichNativeMarketSeats } from '../founded/market-seats';
import { enrichNativeForgeHearth, enrichNativeForgeWorkshop } from '../founded/forge-hearth-furnishings';
import { reconstructHistory, type StoredHistoryFact } from './history';

/** Bounded full replay read: never pretend a truncated log is the kingdom's beginning. */
const FACT_LIMIT = 100_000, WORLD_LIMIT = 128, BYTE_LIMIT = 64 * 1024 * 1024;
export function createChronicleReader(input: {
  readonly pool: Pick<pg.Pool, 'query'>;
  readonly origin: 'live' | 'simulated';
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly founded: Pick<ReturnType<typeof createFoundedReader>, 'manifest'>;
  readonly allocation: Pick<AllocationService, 'layoutPlan'>;
  readonly store: Pick<FileFoundedStore, 'native'>;
}) {
  let active = 0;
  return {
    async read(raw: string, request: FoundedReadRequest) {
      const parsed = KingdomIdSchema.safeParse(raw);
      if (!parsed.success) throw new FoundedReadError(400, 'The kingdom identifier is invalid.');
      const kingdomId = parsed.data;
      const approved = await input.founded.manifest(raw, request);
      if (active >= 4) throw new FoundedReadError(503, 'The kingdom’s Chronicle is busy. Try again shortly.');
      active++;
      let hold: Awaited<ReturnType<typeof input.services.retain>> | undefined;
      try {
        hold = await input.services.retain(kingdomId);
        const checkpoint = hold.kingdom.publicCheckpoint(), through = checkpoint.throughSequence;
        const rows = await input.pool.query<StoredHistoryFact>(
          'SELECT seq, fact, digest FROM realm_facts WHERE kingdom_id = $1 AND seq <= $2 ORDER BY seq LIMIT $3', [kingdomId, through, FACT_LIMIT + 1]);
        if (rows.rows.length > FACT_LIMIT) throw new Error('Chronicle history exceeds this reader’s capacity.');
        const states = reconstructHistory(kingdomId, input.origin, through, rows.rows);
        const layouts = await input.pool.query<{ revision: string; adopted_ms: string }>(
          'SELECT revision, adopted_ms FROM realm_layouts WHERE kingdom_id = $1 ORDER BY adopted_ms, revision', [kingdomId]);
        const worlds = new Map<string, { revision: string; manifest: RealmFoundedManifest; scene: RealmFoundedScene }>();
        const snapshots = [];
        let cached: { homes: typeof states[number]['state']['homes']; castle: typeof states[number]['state']['castle']; attachments: typeof states[number]['state']['attachments']; civic: string; layout: string; build: Awaited<ReturnType<typeof assembleFoundedScene>> } | undefined;
        for (const item of states) {
          const layout = layouts.rows.filter(row => Number(row.adopted_ms) <= item.frame.asOf).at(-1);
          // A pre-founding stream is not a picture of a kingdom that did not exist yet.
          if (!layout) continue;
          const civic = JSON.stringify(item.frame.civic);
          if (!cached || cached.layout !== layout.revision || cached.homes !== item.state.homes || cached.castle !== item.state.castle || cached.attachments !== item.state.attachments || cached.civic !== civic) {
            const plan = await input.allocation.layoutPlan(kingdomId, layout.revision);
            const native = await input.store.native(kingdomId, plan, input.origin);
            const furnished = enrichNativePictureGroves(plan, enrichNativeForgeWorkshop(plan, enrichNativeForgeHearth(plan, enrichNativeMarketSeats(plan, enrichNativeMarket(plan, native)))));
            const build = await assembleFoundedScene({ kingdomId, plan, native: furnished, state: item.state, collisionRevision: 0 });
            cached = { homes: item.state.homes, castle: item.state.castle, attachments: item.state.attachments, civic, layout: layout.revision, build };
          }
          const build = cached.build, revision = build.manifest.sceneHash;
          worlds.set(revision, { revision, manifest: build.manifest, scene: build.scene });
          if (worlds.size > WORLD_LIMIT) throw new Error('Chronicle has too many distinct world revisions for this read.');
          snapshots.push({ frame: item.frame, homes: item.frame.homes.map(home => {
            const placement = build.scene.placements.find(piece => piece.id === `home:${home.plotId}`);
            if (!placement) throw new Error('Chronicle home has no historical geometry.');
            return { plotId: home.plotId, assetRevision: placement.assetHash };
          }), worldRevision: revision, caption: item.caption, nightAt: item.nightAt });
        }
        // The same disclosure gate rechecks withdrawal after potentially slow reconstruction.
        const latest = await input.founded.manifest(raw, request);
        if (!hold.kingdom.current || latest.origin !== input.origin || latest.sceneHash !== approved.sceneHash) throw new Error('The kingdom changed while its Chronicle was being opened.');
        const reply = { version: 1 as const, kingdomId, origin: input.origin, throughSequence: through,
          history: { label: input.origin === 'live' ? 'LIVE' as const : 'SIMULATED' as const, snapshots }, worlds: [...worlds.values()] };
        if (Buffer.byteLength(JSON.stringify(reply)) > BYTE_LIMIT) throw new Error('Chronicle is too large for this read.');
        return reply;
      } finally { active--; await hold?.release(); }
    },
  };
}
