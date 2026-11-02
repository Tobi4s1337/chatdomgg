// PI11 chat fishing end to end: the shared contracts the mock Herald speaks, the plan adoption, and read-only checks
// on schema `pier`. Loaded by pi11-chat.mjs through vite's module runner; never imported by the app.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { AllocationService, TenureEvidenceVerifier } from '../../../../apps/realm/src/allocation/index.ts';
import { createRealmPool } from '../../../../apps/realm/src/persistence/database.ts';
import { assertRealmSchema } from '../../../../apps/realm/src/persistence/schema.ts';
import { canonicalJson } from '../../../../apps/realm/src/persistence/codec.ts';
import { INGRESS_ROUTE } from '../../../../apps/realm/src/ingress/http.ts';
import { CHAT_CAP, CHAT_COOLDOWN_MS } from '../../../../apps/realm/src/fishing/chat.ts';
import { PresenceInputSchema } from '../../../../packages/shared/src/presence.ts';
import { PIER_ALMANAC_ROUTE, PIER_CHAT_COMMAND, PIER_LIGHT_COLOURS, PIER_WATCH_ROUTE, pierLightColour } from '../../../../packages/shared/src/fishing.ts';
import { REALM_HERALD_ROUTE, RealmHeraldEnvelopeSchema } from '../../../../packages/shared/src/realm/herald.ts';
import { REALM_WATCH_ROUTE } from '../../../../packages/shared/src/realm/watch.ts';
import { fishMountId } from '../../../../packages/content/src/keepsakes/index.ts';
import type { SettlementPlan } from '../../../../packages/world/src/index.ts';

export const routes = {
  ingress: INGRESS_ROUTE, herald: REALM_HERALD_ROUTE,
  watch: (kingdomId: string) => REALM_WATCH_ROUTE.replace(':kingdomId', kingdomId),
  pierWatch: (kingdomId: string) => PIER_WATCH_ROUTE.replace(':kingdomId', kingdomId),
  almanac: (kingdomId: string) => PIER_ALMANAC_ROUTE.replace(':kingdomId', kingdomId),
};
export const pier = { command: PIER_CHAT_COMMAND, cap: CHAT_CAP, cooldownMs: CHAT_COOLDOWN_MS, colours: PIER_LIGHT_COLOURS, colour: pierLightColour, mountId: fishMountId };

/** Every body the mock Herald sends is checked against the realm's own contracts first, so a refusal is the realm's. */
export function checkPresence(input: unknown) {
  const parsed = PresenceInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(`The run built an invalid presence input: ${parsed.error.issues.map(i => i.message).join('; ')}`);
  return input;
}
export function checkHerald(envelope: unknown) {
  const parsed = RealmHeraldEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new Error(`The run built an invalid Herald envelope: ${parsed.error.issues.map(i => i.message).join('; ')}`);
  return envelope;
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * Adopts the copied scene's exact SettlementPlan for the kingdom through the realm's own AllocationService, as a
 * simulated-origin layout in this schema (the same step as the PI10 run). Idempotent: the same plan answers `unchanged`.
 */
export async function seedKingdom(options: { databaseUrl: string; schema: string; kingdomId: string; plan: SettlementPlan }) {
  if (options.schema !== 'pier') throw new Error('The PI11 run only ever writes the pier schema.');
  const pool = createRealmPool({ connectionString: options.databaseUrl, schema: options.schema });
  try {
    await assertRealmSchema(pool);
    const allocation = new AllocationService(pool, { origin: 'simulated', verifier: new TenureEvidenceVerifier('simulated', new Uint8Array(32).fill(7)),
      furnish: async () => { throw new Error('The adoption step allocates no homes.'); } });
    const adopted = await allocation.adoptLayout(options.kingdomId as never, options.plan);
    if (adopted.status === 'rejected') throw new Error(`The copied plan was not adopted: ${adopted.reason} (${adopted.detail})`);
    return { status: adopted.status, revision: adopted.revision, planDigest: sha256(canonicalJson(options.plan)) };
  } finally { await pool.end(); }
}

/** Read-only checks: every session of this pool is read-only and sees schema `pier` only. */
export function readOnlyDatabase(databaseUrl: string, schema: string) {
  if (schema !== 'pier') throw new Error('The PI11 run only ever reads the pier schema.');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 20_000, statement_timeout: 20_000,
    options: `-c search_path=${schema} -c default_transaction_read_only=on`, application_name: 'chatdom-pier-pi11-check' });
  pool.on('error', () => {});
  const query = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query<T>(text, values)).rows;
  return {
    query,
    /** The database clock, sampled against this process: positive means the database runs ahead. */
    async clockOffset() {
      const samples: { offset: number; rtt: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const sent = Date.now();
        const [row] = await query<{ ms: string }>(`SELECT (extract(epoch from clock_timestamp()) * 1000)::bigint AS ms`);
        const back = Date.now();
        samples.push({ offset: Number(row!.ms) - (sent + back) / 2, rtt: back - sent });
      }
      samples.sort((a, b) => a.rtt - b.rtt);
      return { offsetMs: Math.round(samples[0]!.offset), rttMs: samples[0]!.rtt };
    },
    async deeds(kingdomId: string, people: readonly string[]) {
      return query(`SELECT person_id, plot_id, slot, status, allocated_ms FROM realm_deeds WHERE kingdom_id=$1 AND person_id = ANY($2) AND status <> 'void' ORDER BY person_id`, [kingdomId, people]);
    },
    async hidden(kingdomId: string, people: readonly string[]) {
      return query(`SELECT person_id, origin, hidden_ms FROM realm_pier_hidden_names WHERE kingdom_id=$1 AND person_id = ANY($2) ORDER BY person_id`, [kingdomId, people]);
    },
    async catchCounts(kingdomId: string) {
      return query<{ species_id: string; n: number; chat: number }>(`SELECT species_id, count(*)::integer AS n, count(*) FILTER (WHERE record->>'via'='chat')::integer AS chat
        FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin='simulated' GROUP BY species_id ORDER BY species_id`, [kingdomId]);
    },
    async catchRow(kingdomId: string, castId: string) {
      const [row] = await query(`SELECT id, owner_id, species_id, item_id, grant_key, caught_ms, personal_first, kingdom_first,
          record->>'via' AS via, record->>'name' AS name, record->'fish' AS fish, record->'environment' AS environment
        FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin='simulated' AND id=$2`, [kingdomId, castId]);
      return row ?? null;
    },
    async item(itemId: string) {
      const [row] = await query(`SELECT id, kingdom_id, record->>'defId' AS def_id, record->>'ownerId' AS owner_id, record->>'place' AS place,
          (record->>'count')::integer AS count, record->>'storied' AS storied, record->'number' AS number, record->'story' AS story,
          record->'source' AS source, record->'detail' AS detail FROM realm_items WHERE id=$1`, [itemId]);
      return row ?? null;
    },
    async mountFor(castId: string) {
      return query(`SELECT id, record->>'defId' AS def_id, record->>'ownerId' AS owner_id, record->>'place' AS place, record->'number' AS number,
          record->'story' AS story, record->'detail' AS detail FROM realm_items
        WHERE record->'source'->>'kind'='fishing' AND record->'source'->>'ref'=$1 AND record->>'defId' LIKE 'keepsake:mount.%'`, [castId]);
    },
    async mountNumber(kingdomId: string, defId: string) {
      const [row] = await query<{ number: number }>(`SELECT number FROM realm_item_numbers WHERE kingdom_id=$1 AND def_id=$2`, [kingdomId, defId]);
      return row ? Number(row.number) : 0;
    },
    async catchesOf(kingdomId: string, personId: string) {
      return query(`SELECT id, species_id, item_id, caught_ms, kingdom_first, record->>'via' AS via FROM realm_fishing_catches
        WHERE kingdom_id=$1 AND origin='simulated' AND owner_id=$2 ORDER BY caught_ms`, [kingdomId, personId]);
    },
    end: () => pool.end(),
  };
}
