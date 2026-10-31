import { createHash, randomBytes } from 'node:crypto';
import { findForgeSockets, forgeStyleKit, homeFingerprint, createNativeForgeHost } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type KingdomId } from '@chatdom/shared';
import type { ForgeAttachment, RealmCapability, RealmDomainCommand, RealmOwnedHome, RealmPrivateState } from '@chatdom/shared/realm';
import { generateSettlementPlan, type KingdomConfig, type SettlementPlan } from '@chatdom/world';
import { decideRealm } from '@chatdom/world/realm';
import { AllocationService, TenureEvidenceVerifier, installCommandId, signTenureEvidence, type Deed, type HomeFurnisher } from '../allocation';
import { canonicalJson } from '../persistence/codec';
import type { RealmDatabase } from '../persistence/database';
import { PostgresRealmRepository } from '../persistence/postgres-repository';

/**
 * SIMULATED founded town for producer evidence and tests. Everything here is a fixture authority: a SIMULATED
 * kingdom, a SIMULATED adopted plan (the one place spec 38 allows native generation), a SIMULATED citizen with
 * SIMULATED signed tenure, SIMULATED names approval and SIMULATED judge receipts. It commits through the real
 * AllocationService and the real fenced PostgresRealmRepository, so the resulting private state is actually
 * committed, but none of it is live founding, naming, sign-in or Twitch evidence.
 */
export const SIMULATED_TOWN = {
  kingdomId: KingdomIdSchema.parse('900000001'),
  citizen: PersonIdSchema.parse('900000101'),
  config: { seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 } satisfies KingdomConfig,
  label: 'SIMULATED',
} as const;

export interface SimulatedTown {
  readonly kingdomId: KingdomId;
  readonly allocation: AllocationService;
  readonly repository: PostgresRealmRepository;
  readonly deed: Deed;
  /** Committed state read back through the fenced writer after the last command. */
  readonly state: RealmPrivateState;
  /** The id of a part that was displaced (retained, not attached) and the id of the one now attached. */
  readonly displacedPart: string;
  readonly attachedPart: string;
}

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** The SIMULATED furnisher: the plot's own native home, with SIMULATED approved names. Never composed for live. */
export const simulatedFurnisher: HomeFurnisher = async deed => {
  if (deed.origin !== 'simulated') throw new Error('The SIMULATED furnisher serves simulated deeds only.');
  const blueprint = createNativeForgeHost(deed.placement).blueprint;
  return { revision: `simulated-native:${deed.plotId}`, digest: digest(blueprint), family: deed.placement.style, blueprint,
    attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: `simulated-names:${deed.deedId}` } };
};

/**
 * Found the SIMULATED town in `db` (a migrated, throwaway realm schema) and commit one citizen's real history:
 * allocation and install, an approved rebuilt home, two qualified nights, and two forged parts on one socket so the
 * first is retained but displaced. Returns the committed state; the caller loads the plan through allocation.
 */
export async function foundSimulatedTown(db: RealmDatabase, options: { readonly config?: KingdomConfig } = {}): Promise<SimulatedTown> {
  const { kingdomId, citizen } = SIMULATED_TOWN, key = randomBytes(32);
  const allocation = new AllocationService(db, { origin: 'simulated', verifier: new TenureEvidenceVerifier('simulated', key), furnish: simulatedFurnisher });
  const plan: SettlementPlan = generateSettlementPlan(options.config ?? SIMULATED_TOWN.config);
  const adopted = await allocation.adoptLayout(kingdomId, plan);
  if (adopted.status !== 'founded') throw new Error(`The SIMULATED town was not founded: ${JSON.stringify(adopted)}`);

  const observedAt = Date.now() - 60_000;
  const evidence = [
    signTenureEvidence(key, { version: 1, kind: 'follow', source: 'helix.channel-followers', kingdomId, personId: citizen, origin: 'simulated', observedAt, followedAt: Date.UTC(2023, 2, 14) }),
    signTenureEvidence(key, { version: 1, kind: 'subscription', source: 'chat.badge-info', kingdomId, personId: citizen, origin: 'simulated', observedAt, months: 9 }),
  ];
  const allocated = await allocation.allocate({ kingdomId, personId: citizen, evidence });
  if (allocated.status !== 'deed') throw new Error(`The SIMULATED citizen was not allocated: ${allocated.status}`);
  const deed = allocated.deed;

  const repository = new PostgresRealmRepository(db, { origin: 'simulated' });
  const lease = await repository.acquire(kingdomId);
  try {
    let state = await repository.load(lease);
    const run = async (id: string, command: RealmDomainCommand, capability: RealmCapability) => {
      const outcome = await repository.execute(lease, id, command, (current, now) => decideRealm(current, command,
        { now, writerEpoch: lease.epoch, commandId: id, capability, current: true, anvilCapacity: 2, actor: null, cause: { kind: 'external', source: 'simulated-town', id } }), () => true);
      if (outcome.status !== 'committed') throw new Error(`SIMULATED command ${id} was ${outcome.status}${'reason' in outcome ? `: ${outcome.reason}` : ''}`);
      state = await repository.load(lease);
    };
    await run(installCommandId(deed), await allocation.prepare(deed), 'allocation');
    const installed = state.homes[deed.plotId]!;
    await run('simulated:rights', { type: 'citizen.rights', personId: citizen, rights: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'simulated-safety-900000101' } }, 'moderation');

    // An approved rebuild: the same street family in another reviewed form, with its own size and windows.
    const rebuilt = createNativeForgeHost({ ...deed.placement, variant: (deed.placement.variant + 1) % 3 }).blueprint;
    const home: RealmOwnedHome = { ...installed, revision: 'simulated-build:1', digest: digest(rebuilt), blueprint: rebuilt, attachments: {} };
    await run('simulated:build:1', { type: 'home.replaceApproved', homeId: installed.id, expectedRevision: installed.revision, home, approvalReceipt: 'simulated-build-judges:1', attachments: [] }, 'publication');

    const now = Date.now();
    for (const night of [1, 2]) {
      const sessionId = `simulated-night:${night}`, startedAt = now - (4 - night) * 3_600_000;
      await run(`simulated:stream:${night}`, { type: 'stream.observe', sessionId, startedAt, liveUntil: now + 6 * 3_600_000 }, 'presence');
      await run(`simulated:presence:${night}`, { type: 'presence.confirmInterval', personId: citizen, streamSessionId: sessionId, from: startedAt, through: startedAt + 600_000, evidenceReceipt: `simulated-interval:${night}` }, 'presence');
      await run(`simulated:coal:${night}`, { type: 'coal.creditQualifiedNight', personId: citizen, streamSessionId: sessionId, qualificationReceipt: `simulated-qualified:${night}` }, 'presence');
    }
    const forge = async (n: number, motif: 'crescent-moon' | 'shooting-star' | 'sleeping-dragon' | 'watchful-owl') => {
      const current = state.homes[deed.plotId]!, sockets = findForgeSockets(current.blueprint);
      const socket = sockets.find(s => s.id === 'front-lantern') ?? sockets[0];
      if (!socket) throw new Error('The SIMULATED rebuilt home has no Forge socket');
      const attempt = { key: `simulated-wish:${n}`, attemptId: `simulated-attempt:${n}` }, kit = forgeStyleKit(current.family);
      await run(`simulated:reserve:${n}`, { type: 'forge.reserve', record: { attempt, homeId: current.id, homeDigest: current.digest, streamSessionId: 'simulated-night:2', rightsRevision: 1,
        reservation: { reservationId: `simulated-reserve:${n}`, kingdomId, personId: citizen, slot: current.slot, revision: current.revision, family: current.family,
          home: current.blueprint, safetyIdentifier: 'simulated-safety-900000101', expiresAt: now + 3_600_000, attribution: current.attribution } } }, 'forge');
      const attachment: ForgeAttachment = { version: 1, id: `simulated-run-${n}`, runId: `simulated-run-${n}`, kingdomId, slot: current.slot, hostId: current.blueprint.id,
        hostFingerprint: homeFingerprint(current.blueprint), socketId: socket.id, origin: [...socket.origin], kitId: kit.id, kitRevision: kit.revision, family: current.family,
        draft: { plan: { version: 2, kind: socket.kind, motif, finish: n === 1 ? 'native' : 'copper', accent: n === 1 ? 'none' : 'stars' }, title: `SIMULATED piece ${n}`, plaque: 'SIMULATED evidence piece' },
        provenance: { source: 'simulated', makerName: current.attribution.makerName, kingdomName: current.attribution.kingdomName, designId: `simulated-design-${n}` } };
      await run(`simulated:forge:${n}`, { type: 'forge.commitApproved', attempt, reservationId: `simulated-reserve:${n}`, expectedRevision: current.revision,
        expectedHomeDigest: current.digest, attachment, creation: { words: `SIMULATED wish ${n}` }, approvalReceipt: `simulated-judges:${n}` }, 'forge');
      return attachment.id;
    };
    const displacedPart = await forge(1, 'crescent-moon');
    const attachedPart = await forge(2, 'shooting-star');
    return { kingdomId, allocation, repository, deed, state, displacedPart, attachedPart };
  } finally {
    await repository.release(lease);
  }
}
