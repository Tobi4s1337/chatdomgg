/**
 * The Atlas's own routes below `/map` (Spec 01 R22). Main mounts the Atlas for `/map` and `/map/*`; this module reads
 * and writes the rest of the path. `/map/<login>` opens a channel's card, `/map/road/<login>/<login>` a road. Train
 * lines and seasons have their routes reserved here, but nothing to open yet. A segment that is not a Twitch login
 * is an unknown route, so `/map/atlas` is simply the channel called atlas and nothing is reserved by accident: `road`,
 * `line` and `season` are routes only with the segments that follow them, otherwise they are logins too.
 */
export type AtlasRoute =
  | { kind: 'map' }
  | { kind: 'channel'; login: string }
  | { kind: 'road'; a: string; b: string }
  | { kind: 'line'; id: string }
  | { kind: 'season'; n: number }
  | { kind: 'unknown' };

const LOGIN = /^[a-z0-9_]{1,25}$/;
const LINE = /^[a-z0-9-]{1,64}$/;

function segment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Reads a pathname. Logins are matched case-insensitively (Twitch's are lower case) and stored lower case. */
export function parseRoute(pathname: string): AtlasRoute {
  const match = /^\/map(?:\/(.*))?$/.exec(pathname);
  if (!match) return { kind: 'unknown' };
  const parts = (match[1] ?? '').split('/').filter((part) => part !== '').map(segment);
  if (parts.some((part) => part === null)) return { kind: 'unknown' };
  const [first, ...rest] = (parts as string[]).map((part) => part.toLowerCase());
  if (first === undefined) return { kind: 'map' };
  if (rest.length === 0) return LOGIN.test(first) ? { kind: 'channel', login: first } : { kind: 'unknown' };
  if (first === 'road' && rest.length === 2 && LOGIN.test(rest[0]!) && LOGIN.test(rest[1]!) && rest[0] !== rest[1]) return { kind: 'road', a: rest[0]!, b: rest[1]! };
  if (first === 'line' && rest.length === 1 && LINE.test(rest[0]!)) return { kind: 'line', id: rest[0]! };
  if (first === 'season' && rest.length === 1 && /^[1-9][0-9]{0,3}$/.test(rest[0]!)) return { kind: 'season', n: Number(rest[0]) };
  return { kind: 'unknown' };
}

export function formatRoute(route: AtlasRoute): string {
  switch (route.kind) {
    case 'channel': return `/map/${route.login}`;
    case 'road': return `/map/road/${route.a}/${route.b}`;
    case 'line': return `/map/line/${route.id}`;
    case 'season': return `/map/season/${route.n}`;
    default: return '/map';
  }
}
