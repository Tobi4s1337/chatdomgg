import { KingdomIdSchema, type KingdomId, type RealmCitizenFacts, type RealmLookMineReply } from '@chatdom/shared';

/*
 * Dev only: a stand-in for `fetch` that answers `GET /api/realm/looks/me` the way the realm would, so the card's
 * bench can draw each of its states. Never imported by shipped code.
 */

export type CardFixtureState = 'ready' | 'loading' | 'unavailable' | 'anonymous' | 'nopicture';

export const FIXTURE_KINGDOM: KingdomId = KingdomIdSchema.parse('990300411');
const BRACKENFORD = KingdomIdSchema.parse('990300412');
/** Twitch's own default profile picture, as Helix gives it to someone who never uploaded one. */
export const FIXTURE_PICTURE = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/ce57700a-def9-11e9-842d-784f43822e80-profile_image-300x300.png';

export function fixtureFacts(picture: string | null = FIXTURE_PICTURE): RealmCitizenFacts {
  const granted = Date.UTC(2026, 10, 2, 11, 12), earlier = Date.UTC(2026, 6, 19, 12, 40);
  return { picture, since: granted, homes: [
    { kingdomId: FIXTURE_KINGDOM, kingdomName: 'Lanternmere', street: 'Tidewater Lane', plotId: 'plot:2026:court-2:4', since: granted, here: true },
    { kingdomId: BRACKENFORD, kingdomName: 'Brackenford', street: 'Copper Kettle Lane', plotId: 'plot:2025:court-1:7', since: earlier, here: false },
  ] };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function cardFixtureFetcher(state: CardFixtureState): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    await new Promise<void>((resolve, reject) => {
      if (state !== 'loading') { setTimeout(resolve, 120); return; }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    if (state === 'unavailable') return json(503, { version: 1, status: 'unavailable', message: 'Your look could not be kept just now.' });
    if (state === 'anonymous') return json(200, { version: 1, status: 'anonymous' } satisfies RealmLookMineReply);
    const reply: RealmLookMineReply = { version: 1, status: 'none', starter: 'tide', entitlements: null, granted: [],
      citizen: fixtureFacts(state === 'nopicture' ? null : FIXTURE_PICTURE) };
    return json(200, reply);
  }) as typeof fetch;
}
