import type { FinderEntry } from '../data/roads';

/**
 * An entry the monarch may choose: live, and named (an unnamed channel cannot be raided by name). This only shapes
 * the board; the Raid Gate's authority alone decides whether a raid may go.
 */
export function selectable(entry: FinderEntry): boolean {
  return entry.live && entry.channel.login !== null && entry.channel.name !== null;
}
