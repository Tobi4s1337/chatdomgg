/**
 * The only people a map may show: you, and your friends. A friend is mutual (you both walked together, or you both
 * added each other) and only a registered friend authority can say so (`registerFriendSource` in `slots.ts`). Twitch
 * follows never make a friend. With no authority there are no friends, so the map shows you alone.
 *
 * This is the one door from the walkers in the street to the map: the painter, the minimap and the big map page take
 * only what `mapPeople` returns.
 */

export interface MapWalker { readonly id: string; readonly name: string; readonly position: readonly [number, number, number]; readonly yaw: number; readonly self: boolean }

export interface MapYou { readonly x: number; readonly z: number; readonly heading: number }
export interface MapFriend { readonly id: string; readonly name: string; readonly x: number; readonly z: number }
export interface MapPeople { readonly you: MapYou | null; readonly friends: readonly MapFriend[] }

/** Answers which of the walkers drawn now are your mutual friends, by walker id. Read only. */
export interface FriendAuthority { mutual(walkers: readonly { readonly id: string; readonly name: string }[]): ReadonlySet<string> }

const NOBODY: ReadonlySet<string> = new Set();

/**
 * You and your friends among the walkers. A walker is a friend only when the authority names its id; a stranger is
 * never returned, whatever their name, distance or the map's zoom. A broken authority shows no one.
 */
export function mapPeople(walkers: readonly MapWalker[], authority: FriendAuthority | null): MapPeople {
  const self = walkers.find(walker => walker.self);
  const others = walkers.filter(walker => !walker.self);
  let mutual = NOBODY;
  if (authority && others.length) {
    try {
      const answer = authority.mutual(others.map(walker => ({ id: walker.id, name: walker.name })));
      mutual = answer instanceof Set ? answer : NOBODY;
    } catch { mutual = NOBODY; }
  }
  const friends = others.filter(walker => mutual.has(walker.id) && walker.position.every(Number.isFinite))
    .map(walker => ({ id: walker.id, name: walker.name, x: walker.position[0], z: walker.position[2] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const you = self && self.position.every(Number.isFinite) ? { x: self.position[0], z: self.position[2], heading: self.yaw } : null;
  return { you, friends };
}
