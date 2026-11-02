import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import type { Pool } from 'pg';
import { checkHarmful, type Hex } from '@chatdom/content/avatar-style';
import type { KingdomId, RealmWardrobeGrant } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import type { TenureEvidenceVerifier } from '../allocation/evidence';
import { createPostgresCitizenFacts, createTwitchPictures, twitchCredentialsFromEnv } from './citizen';
import { createRealmLookRecords, royalStandardColours } from './entitlements';
import { mountLookRoutes } from './http';
import type { LookOrigin } from './ports';
import { PostgresLookRepository } from './postgres-repository';
import type { HomePlaces } from './place';
import { attachLookPresentation, type LookPresentationHost } from './presentation';
import { createPostgresLookSessions, lookSessionCookie } from './session';
import { LookStore, type LookStoreOptions, type WardrobeGrantInput } from './store';

export { MemoryLookRepository } from './memory-repository';
export {
  MemoryCitizenFacts, PICTURE_BUDGET_MS, UNNAMED_ELSEWHERE, citizenFactsFrom, createPostgresCitizenFacts, createTwitchPictures, twitchCredentialsFromEnv,
  type CitizenDeed, type CitizenFacts, type TwitchPictures,
} from './citizen';
export { PostgresLookRepository } from './postgres-repository';
export { LookStore, LOOK_REASONS, LOOK_STORE_LIMITS, refusal, type LookRefusal, type LookSaveOutcome, type WardrobeGrantInput } from './store';
export { mountLookRoutes } from './http';
export { HOME_PLACE_REASONS, createHomePlaces, homePlaceOf, placeRefusal, type HomePlaceOutcome, type HomePlaces } from './place';
export { attachLookPresentation, type LookPresentationHost, type LookPresentationSource } from './presentation';
export { createPostgresLookSessions, csrfFor, lookSessionCookie, readCookie } from './session';
export { createRealmLookRecords, entitlementsFrom, royalStandardColours, wholeMonths, ROYAL_STANDARD_PLACEMENT } from './entitlements';
export { LOOK_LIMITS, canonicalLook, lookTokenOf } from './token';
export type * from './ports';

export class LookStoreUnavailableError extends Error {
  readonly code = 'realm.look-store';
  constructor() { super('The realm look store is not running in this process.'); this.name = 'LookStoreUnavailableError'; }
}

let installed: LookStore | null = null;

/** Main installs the process's one store, so server-side callers (the Forge) can grant without holding it. */
export function installLookStore(store: LookStore): () => void {
  installed = store;
  return () => { if (installed === store) installed = null; };
}

/**
 * Grants a piece to a person on the server: the Forge's worn twin (decision 24). Idempotent per person and piece; a
 * repeated grant returns the first one. The person need not have signed in yet; the piece waits for them.
 */
export function grantWardrobePiece(grant: WardrobeGrantInput): Promise<RealmWardrobeGrant> {
  if (!installed) return Promise.reject(new LookStoreUnavailableError());
  return installed.grantWardrobePiece(grant);
}

type App = uWebSocketsTransport['app'];

/** The realm's look service, composed for main: Postgres storage, the realm's sessions, verified records, routes and the live hook. */
export function createRealmLooks(input: {
  readonly pool: Pool;
  readonly origin: LookOrigin;
  readonly verifier: Pick<TenureEvidenceVerifier, 'verify'>;
  /** Host-approved kingdom names, as the entry gate serves them. */
  readonly names: ReadonlyMap<KingdomId, string>;
  /** The kingdom's prepared founded scene on this realm, if any. */
  readonly scene: (kingdomId: KingdomId) => RealmFoundedScene | undefined;
  /** `REALM_PUBLIC_ORIGIN`: https means the `__Host-` session cookie, as the API sets it. */
  readonly publicOrigin: string | undefined;
  /** The harmful-combination check (Safety §3.1); the content package's own unless a test supplies one. */
  readonly harmful?: LookStoreOptions['harmful'];
  readonly log?: (line: string) => void;
}) {
  const colours = new WeakMap<RealmFoundedScene, readonly [Hex, Hex] | null>();
  const records = createRealmLookRecords({ pool: input.pool, origin: input.origin, verifier: input.verifier, name: id => input.names.get(id),
    colours: id => {
      const scene = input.scene(id);
      if (!scene) return null;
      if (!colours.has(scene)) colours.set(scene, royalStandardColours(scene));
      return colours.get(scene) ?? null;
    } });
  const store = new LookStore({ repository: new PostgresLookRepository(input.pool), records, origin: input.origin,
    harmful: input.harmful ?? checkHarmful, ...(input.log ? { log: input.log } : {}) });
  const sessions = createPostgresLookSessions({ pool: input.pool, origin: input.origin, cookie: lookSessionCookie(input.publicOrigin) });
  // The card's picture comes from Twitch only when the app's credentials are in the process; without them it is absent.
  const citizen = createPostgresCitizenFacts({ pool: input.pool, origin: input.origin, name: id => input.names.get(id),
    pictures: createTwitchPictures(twitchCredentialsFromEnv()) });
  const uninstall = installLookStore(store);
  return {
    store,
    citizen,
    /** `places` turns on "Take your place" (`POST /api/realm/looks/place`); without it that route answers unavailable. */
    mount: (app: App, extra: { readonly places?: HomePlaces } = {}) => mountLookRoutes(app, { store, sessions, citizen,
      ...(extra.places ? { places: extra.places } : {}), ...(input.log ? { log: input.log } : {}) }),
    attach: (kingdom: LookPresentationHost) => attachLookPresentation(kingdom, store, input.log),
    stop: uninstall,
  };
}
