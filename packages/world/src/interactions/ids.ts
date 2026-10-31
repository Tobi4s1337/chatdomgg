import { TokenSchema } from '@chatdom/shared';
import type { RealmInteractionAction, RealmInteractionTarget } from '@chatdom/shared/realm';

export type InteractionKind = RealmInteractionTarget['kind'];
/** The action E performs on each frozen target family. `stand` addresses one's own lease, not a kind. */
export type InteractionUse = Exclude<RealmInteractionAction, 'stand'>;

export const INTERACTION_KINDS: readonly InteractionKind[] = ['bench-seat', 'campfire-seat', 'anvil', 'tavern-seat', 'home-door', 'home-exit'];
export const ACTION_FOR_KIND: Readonly<Record<InteractionKind, InteractionUse>> = {
  'bench-seat': 'sit', 'campfire-seat': 'sit', anvil: 'forge', 'tavern-seat': 'tavern', 'home-door': 'enter-home', 'home-exit': 'exit-home',
};
/** Seat kinds hold a room lease; the others are one-shot transitions. */
export const SEAT_KINDS: ReadonlySet<InteractionKind> = new Set(['bench-seat', 'campfire-seat', 'tavern-seat']);
export const PLOT_KINDS: ReadonlySet<InteractionKind> = new Set(['home-door', 'home-exit']);

/** One namespace segment: no colon, so `fire:a:seat:b` can never be read two ways. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/;
const PATTERNS: Readonly<Record<InteractionKind, RegExp>> = {
  'bench-seat': /^bench:(.+):seat:([^:]+)$/,
  'campfire-seat': /^fire:([^:]+):seat:([^:]+)$/,
  anvil: /^anvil:([^:]+)$/,
  'tavern-seat': /^tavern:([^:]+):seat:([^:]+)$/,
  'home-door': /^home:(.+):door$/,
  'home-exit': /^home:(.+):exit$/,
};

function segment(value: string, label: string): string {
  if (!SEGMENT.test(value)) throw new Error(`Invalid interaction ${label} "${value}".`);
  return value;
}
function token(id: string): string {
  const parsed = TokenSchema.safeParse(id);
  if (!parsed.success) throw new Error(`Interaction id "${id}" is not a realm token.`);
  return id;
}

/**
 * Authored, namespaced target IDs. Occupancy, LOD, load order, labels and the camera never enter an ID.
 * `site`, `table` and `plot` are the producer's authored identities; `seat` is the authored seat name.
 */
export const interactionTargetId = {
  benchSeat: (site: string, seat: string) => token(`bench:${token(site)}:seat:${segment(seat, 'seat')}`),
  campfireSeat: (site: string, seat: string) => token(`fire:${segment(site, 'site')}:seat:${segment(seat, 'seat')}`),
  anvil: (site: string) => token(`anvil:${segment(site, 'site')}`),
  tavernSeat: (table: string, seat: string) => token(`tavern:${segment(table, 'table')}:seat:${segment(seat, 'seat')}`),
  // Real adopted plot IDs contain colons; the final suffix keeps the namespace unambiguous.
  homeDoor: (plot: string) => token(`home:${token(plot)}:door`),
  homeExit: (plot: string) => token(`home:${token(plot)}:exit`),
} as const;

/** The kind an ID's namespace promises, or null for anything outside the frozen families. */
export function kindOfTargetId(id: string): InteractionKind | null {
  if (!TokenSchema.safeParse(id).success) return null;
  for (const kind of INTERACTION_KINDS) {
    const match = PATTERNS[kind].exec(id);
    if (match && match.slice(1).every((part, i) => PLOT_KINDS.has(kind) || (kind === 'bench-seat' && i === 0)
      ? TokenSchema.safeParse(part).success : SEGMENT.test(part))) return kind;
  }
  return null;
}
/** The plot named by a home-door/home-exit ID. */
export function plotOfTargetId(id: string): string | null {
  const match = /^home:(.+):(?:door|exit)$/.exec(id);
  return match && TokenSchema.safeParse(match[1]).success ? match[1]! : null;
}
