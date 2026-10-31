import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import { createTwitchMomentIngest, type CitizenDisclosure, type IngestStatus } from '../../../herald/src/twitch-moments';
import { createLocalProviderTransport, eventSubFrame } from '../../../herald/src/twitch-moments/local-transport';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import type { TwitchMomentFeed } from '../twitch-moments';

/** A simulated channel ID: not a real Twitch account, labelled SIMULATED wherever it is shown. */
export const BENCH_KINGDOM = KingdomIdSchema.parse('424242');

export interface BenchCitizen { readonly id: PersonId; readonly name: string; readonly slot: number; readonly disclosure: 'named' | 'anonymous' }

export type BenchDelivery = 'subscribe' | 'repeat' | 'late' | 'wrong-channel' | 'gifted';

/**
 * The SIMULATED pipeline. Synthetic EventSub frames enter the real Herald ingest through a local transport,
 * are claimed and mapped through the in-memory record port and the citizen directory, and leave through the same
 * public feed adapter a production binding uses. Nothing here forges a browser-side success.
 */
export function createBenchSimulation(citizens: readonly BenchCitizen[], clock: { now(): number }) {
  const records = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
  const people = new Map<PersonId, CitizenDisclosure>(citizens.map(c => [c.id, c.disclosure === 'named'
    ? { disclosure: 'named', displayName: c.name, homeSlot: c.slot } : { disclosure: 'anonymous' }]));
  let generation = 0, messages = 0, lastFrame: string | null = null;
  const make = () => createTwitchMomentIngest({ kingdomId: BENCH_KINGDOM, origin: 'simulated', epochPrefix: `bench${generation}`, moderatorId: null, readerId: null,
    authorized: new Set(['moments.subscriptions']), transport: local.transport, records: records.port,
    directory: { resolve: async (kingdom, id) => (kingdom === BENCH_KINGDOM ? people.get(id) ?? null : null) }, clock });
  let ingest = make();
  const listeners = new Set<{ reset: Parameters<TwitchMomentFeed['subscribe']>[0]; receive: Parameters<TwitchMomentFeed['subscribe']>[1]; unavailable: () => void; stop: () => void }>();
  // A stable feed for the bench, re-subscribed to whichever ingest is current.
  const feed: TwitchMomentFeed = {
    origin: 'simulated',
    subscribe(reset, receive, unavailable) {
      const entry = { reset, receive, unavailable, stop: ingest.feed.subscribe(reset, receive, unavailable) };
      listeners.add(entry);
      return () => { entry.stop(); listeners.delete(entry); };
    },
  };
  const rewire = () => { for (const entry of listeners) { entry.stop(); entry.stop = ingest.feed.subscribe(entry.reset, entry.receive, entry.unavailable); } };

  function frame(citizen: BenchCitizen, at: number, options: { gift?: boolean; broadcaster?: string } = {}): string {
    return eventSubFrame({ messageId: `bench-${generation}-${++messages}`, at, type: 'channel.subscribe', version: '1',
      condition: { broadcaster_user_id: BENCH_KINGDOM },
      event: { user_id: citizen.id, user_login: `citizen${citizen.slot}`, user_name: citizen.name, broadcaster_user_id: options.broadcaster ?? BENCH_KINGDOM,
        broadcaster_user_login: 'willowmere', broadcaster_user_name: 'Willowmere', tier: '1000', is_gift: options.gift ?? false } });
  }

  return {
    feed,
    start(): IngestStatus { const status = ingest.start(); rewire(); return status; },
    deliver(kind: BenchDelivery, citizen: BenchCitizen): boolean {
      const now = clock.now();
      if (kind === 'repeat') return lastFrame !== null && local.deliver(lastFrame);
      const text = kind === 'late' ? frame(citizen, now - 240_000) : kind === 'wrong-channel' ? frame(citizen, now, { broadcaster: '777' })
        : frame(citizen, now, { gift: kind === 'gifted' });
      lastFrame = text;
      return local.deliver(text);
    },
    /** The source drops, as a lost conduit shard would; listeners become unavailable and keep known homes. */
    disconnect() { local.lose('disconnected'); },
    /** A new source session: a fresh epoch and a non-animating reset from the records. */
    restartSource(): IngestStatus { ingest.stop(); generation++; ingest = make(); const status = ingest.start(); rewire(); return status; },
    status: () => ingest.status(),
    settled: () => ingest.settled(),
    stop() { ingest.stop(); },
  };
}
export type BenchSimulation = ReturnType<typeof createBenchSimulation>;

export const benchPerson = (n: number) => PersonIdSchema.parse(String(90_000 + n));
