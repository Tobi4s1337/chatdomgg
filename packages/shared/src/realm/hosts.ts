import type { PersonId } from '../identity';
import type { ForgeHostProfile } from '../forge';
import type { RealmPrivateState, RealmOwnedForgeHost } from './domain';

/** Reserved for the monarch's adopted keep; never allocate it to a citizen street plot. */
export const REALM_CASTLE_SLOT = 65534 as const;
/** A walker without an owned home or adopted keep. Never a presence/window slot. */
export const REALM_NO_HOME_SLOT = 65535 as const;
export const castleHostId = (moduleId: string): string => `castle:${moduleId}`;

export function ownedForgeHost(state: RealmPrivateState, id: string): RealmOwnedForgeHost | undefined {
  if (state.castle?.id === id) return state.castle;
  return Object.hasOwn(state.homes, id) ? state.homes[id] : undefined;
}
export function forgeHostForPerson(state: RealmPrivateState, personId: PersonId): RealmOwnedForgeHost | undefined {
  return state.castle?.ownerId === personId ? state.castle : Object.values(state.homes).find(home => home.ownerId === personId);
}
export const ownedHostProfile = (host: RealmOwnedForgeHost): ForgeHostProfile => 'moduleId' in host ? 'castle-keep' : 'street-home';
