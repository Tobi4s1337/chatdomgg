/**
 * The gate's labelled bench: the real Raid Gate application, run in the page against the transactional memory
 * repository, a controlled policy and a stand-in for the Atlas finder. Everything it produces is SIMULATED and the
 * pane says so. It exists to exercise the gate before main binds authenticated transports; it is never the default.
 */
import { AtlasChannelSchema, type AtlasChannel } from '@chatdom/shared';
import { createRaidGateApplication } from '../../../api/src/raid-gate/application';
import type { GateAuthority, GateContext, GatePrincipal, GateReply, KingdomId } from '../../../api/src/raid-gate/contracts';
import { createMemoryRaidGateRepository } from '../../../api/src/raid-gate/memory-repository';
import type { SourceStanding, TargetVerdict } from '../../../api/src/raid-gate/ports';
import type { AtlasGateEvent, AtlasGateHost, GateKingdom, GateLand, RaidGateApi } from './ports';

const SOURCE = { kingdomId: '41000001' as KingdomId, name: 'Willowmere', login: 'willowmere' } satisfies GateKingdom;

/** SIMULATED channels. None of these is a real Twitch channel's data. */
const DESTINATIONS: readonly (Readonly<{ channel: AtlasChannel; land: GateLand; live: boolean; group: 'road' | 'realm' }>)[] = [
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000002', login: 'fernhollow', displayName: 'Fernhollow', language: 'en', founded: true, kingdomName: 'Fernhollow', contentClassification: 'general' }), land: 'founded', live: true, group: 'road' },
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000003', login: 'oakenfold_plays', displayName: 'oakenfold_plays', language: 'en', founded: false, kingdomName: null, contentClassification: 'general' }), land: 'waiting', live: true, group: 'realm' },
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000005', login: 'saltmarsh', displayName: 'Saltmarsh', language: 'en', founded: true, kingdomName: 'Saltmarsh Reach', contentClassification: 'general' }), land: 'founded', live: true, group: 'realm' },
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000004', login: 'quietharbor', displayName: 'QuietHarbor', language: 'en', founded: true, kingdomName: 'Quiet Harbor', contentClassification: 'general' }), land: 'founded', live: false, group: 'realm' },
];

const STANDINGS: Readonly<Record<GateAuthority, Partial<SourceStanding>>> = {
  ready: {}, offline: { live: false }, 'not-connected': { raids: 'missing' }, revoked: { raids: 'revoked' }, disabled: { actions: 'disabled' }, unavailable: { raids: 'unknown' },
};

/** SIMULATED walkers of Willowmere, so the bench can show a real count growing through real join commands. */
const WALKERS = ['52000001', '52000002', '52000003', '52000004', '52000005', '52000006', '52000007'];

export type GateBenchOptions = Readonly<{ viewer: 'monarch' | 'walker'; authority: GateAuthority; clock: () => number }>;

export type GateBench = Readonly<{
  source: GateKingdom;
  api: RaidGateApi;
  atlas: AtlasGateHost;
  /** The stand-in finder's state, for the bench view to draw. */
  finder: Readonly<{ open: () => boolean; entries: typeof DESTINATIONS; pick: (kingdomId: KingdomId) => void; close: () => void; onChange: (listener: () => void) => void }>;
  /** Runs the monarch's own preview as the monarch, for a walker bench. */
  monarchPreview(target: KingdomId): Promise<GateReply>;
  /** SIMULATED: the monarch renews the raid grant, as the throne's Twitch connection would. */
  reconnect(): void;
  /** SIMULATED walkers send their own join commands. */
  walkersJoin(count: number, requestId: string): Promise<void>;
}>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createGateBench(options: GateBenchOptions): GateBench {
  const repository = createMemoryRaidGateRepository();
  let authority = options.authority;
  const subscribers = new Set<() => void>();
  const app = createRaidGateApplication({
    repository, origin: 'simulated',
    policy: {
      async readStanding(principal) {
        return { session: 'current', broadcaster: String(principal.personId) === String(SOURCE.kingdomId), live: true, raids: 'granted', actions: 'enabled', ...STANDINGS[authority] };
      },
      async readTarget(_from, kingdomId): Promise<TargetVerdict | null> {
        const entry = DESTINATIONS.find(each => each.channel.kingdomId === kingdomId);
        return entry ? { target: { kingdomId, founded: entry.channel.founded, live: entry.live, classification: entry.channel.contentClassification }, permitted: true } : null;
      },
    },
    tokens: {
      issue: () => [...crypto.getRandomValues(new Uint8Array(18))].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      hash: sha256Hex,
    },
    // Each subscriber re-reads with its own principal; the change itself carries nothing.
    notifier: { changed: () => queueMicrotask(() => { for (const subscriber of subscribers) subscriber(); }) },
  });
  const principal = (personId: string): GatePrincipal => ({
    personId: personId as GatePrincipal['personId'], sessionId: `bench-${personId}`, sourceKingdomId: SOURCE.kingdomId,
    sourceRole: personId === SOURCE.kingdomId ? 'monarch' : 'citizen',
  });
  const as = (personId: string, command: unknown) => {
    const context: GateContext = { principal: principal(personId), now: options.clock(), signal: new AbortController().signal };
    return app.handle(context, command);
  };
  const viewerId = options.viewer === 'monarch' ? SOURCE.kingdomId : WALKERS[0]!;

  const api: RaidGateApi = {
    origin: 'simulated',
    request: (command, signal) => { signal.throwIfAborted(); return as(viewerId, command); },
    subscribe(_requestId, onReply, signal) {
      const deliver = () => { if (!signal.aborted) void as(viewerId, { op: 'gate' }).then(onReply); };
      subscribers.add(deliver);
      signal.addEventListener('abort', () => subscribers.delete(deliver), { once: true });
    },
  };

  let open = false;
  const finderListeners = new Set<() => void>();
  const atlasListeners = new Set<(event: AtlasGateEvent) => void>();
  const changed = () => { for (const listener of finderListeners) listener(); };
  const emit = (event: AtlasGateEvent) => { for (const listener of atlasListeners) listener(event); };
  const atlas: AtlasGateHost = {
    origin: 'simulated',
    open() { open = true; changed(); },
    close() { if (open) { open = false; changed(); emit({ kind: 'closed' }); } },
    async resolve(kingdomId) {
      const entry = DESTINATIONS.find(each => each.channel.kingdomId === kingdomId);
      return entry ? { channel: entry.channel, land: entry.land } : null;
    },
    subscribe(listener, signal) {
      atlasListeners.add(listener);
      signal.addEventListener('abort', () => atlasListeners.delete(listener), { once: true });
    },
  };

  return {
    source: SOURCE, api, atlas,
    finder: {
      open: () => open, entries: DESTINATIONS,
      pick(kingdomId) {
        const entry = DESTINATIONS.find(each => each.channel.kingdomId === kingdomId);
        if (!entry) return;
        open = false; changed();
        emit({ kind: 'target', channel: entry.channel, land: entry.land });
      },
      close: () => atlas.close(),
      onChange: listener => { finderListeners.add(listener); },
    },
    reconnect() {
      if (authority !== 'not-connected' && authority !== 'revoked') return;
      authority = 'ready';
      for (const subscriber of subscribers) subscriber();
    },
    monarchPreview: target => as(SOURCE.kingdomId, { op: 'preview', requestId: crypto.randomUUID(), target }),
    async walkersJoin(count, requestId) {
      for (const personId of WALKERS.slice(options.viewer === 'walker' ? 1 : 0, (options.viewer === 'walker' ? 1 : 0) + count)) await as(personId, { op: 'join', requestId });
    },
  };
}
