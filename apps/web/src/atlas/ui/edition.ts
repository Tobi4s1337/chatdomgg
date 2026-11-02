import type { EditionLabel, PreviewPointer, PreviewWorld } from '../data/preview';
import { formatDay, formatDayRange, formatMoment, formatTime } from './format';

/**
 * What the map says about the land it draws. A survey preview is draft land and says so; a founded edition is shown
 * with quiet pride: its name and founding date, and that the land no longer moves. A rehearsal of an edition never
 * claims a founding. Pure wording, so every surface (seal, card, still, notices) says the same and is tested in Node.
 */

export interface EditionFacts { label: EditionLabel; foundedAt: number; rehearsal: boolean }

/** The edition a world belongs to, or null for a survey preview. */
export function editionOf(world: PreviewWorld): EditionFacts | null {
  if (world.status !== 'edition') return null;
  return { label: world.founding.label, foundedAt: world.founding.foundedAt, rehearsal: world.founding.rehearsal };
}

/** The seal's three states; each has its own wax and glyph. */
export type SealKind = 'survey' | 'edition' | 'rehearsal';

export interface SealWords {
  kind: SealKind;
  /** First word(s) of the seal line: "Survey", "Still" or the edition's name. */
  lead: string;
  /** Beside the lead: a dated day (`at` set, written as a `<time>`), or the word "Rehearsal". */
  when: { text: string; at: number | null };
  /** The one-line hint the seal opens. */
  hint: string;
}

/**
 * The dated seal beside the title. A survey says when it was observed and that its land awaits founding; an edition
 * says when it was founded and that the land no longer moves, on the moving map and the still alike.
 */
export function sealWords(world: PreviewWorld, still: boolean): SealWords {
  const edition = editionOf(world);
  if (!edition) {
    return {
      kind: 'survey',
      lead: still ? 'Still' : 'Survey',
      when: { text: formatDay(world.asOf), at: world.asOf },
      hint: still ? 'Still of land awaiting founding.' : 'Survey of land awaiting founding.',
    };
  }
  if (edition.rehearsal) {
    return { kind: 'rehearsal', lead: edition.label, when: { text: 'Rehearsal', at: null }, hint: `A rehearsal of ${edition.label}. Nothing is founded.` };
  }
  const day = formatDay(edition.foundedAt);
  return { kind: 'edition', lead: edition.label, when: { text: day, at: edition.foundedAt }, hint: `Founded ${day}. The land no longer moves.` };
}

/** The live line under the seal: when the paint shown was observed, held when it is no longer the present. */
export function sealLive(observedAt: number | null | undefined, fresh: boolean, now = Date.now()): string {
  return observedAt != null ? `${fresh ? 'Live' : 'Held'} ${formatTime(observedAt, now)}` : 'Live unavailable';
}

/** What the reader is looking at, as a noun after "this": "survey" or "edition". */
export function mapNoun(world: PreviewWorld): 'survey' | 'edition' {
  return world.status === 'edition' ? 'edition' : 'survey';
}

/** The status line over a mapped holding's name. */
export function holdingStatus(world: PreviewWorld): string {
  const edition = editionOf(world);
  if (!edition) return 'Mapped holding · not yet founded';
  return edition.rehearsal ? `Mapped holding · ${edition.label} rehearsal` : `Mapped holding · ${edition.label}`;
}

/** The note at the foot of a holding's card: the observed window, and whether its land can still move. */
export function holdingNote(world: PreviewWorld): string {
  const window = formatDayRange(world.window.firstObservationAt, world.window.lastObservationAt);
  const edition = editionOf(world);
  if (!edition) return `Survey of ${window} (UTC). Draft land: this holding may still move before the first edition.`;
  if (edition.rehearsal) return `Observed ${window} (UTC). A rehearsal of ${edition.label}: nothing is founded, so this holding may still move.`;
  return `Observed ${window} (UTC). ${edition.label}, founded ${formatDay(edition.foundedAt)}: this holding never moves.`;
}

/** The title of the still's ribbon. */
export function stillTitle(edition: EditionFacts | null | undefined): string {
  if (!edition) return 'A still of the survey';
  return edition.rehearsal ? `A still of the ${edition.label} rehearsal` : `A still of ${edition.label}`;
}

/** The notice offered when the service publishes a newer map than the one this tab keeps drawing. */
export function newerNotice(world: PreviewWorld, newer: Pick<PreviewPointer, 'asOf' | 'edition'>): string {
  const observed = `observed to ${formatMoment(newer.asOf)}`;
  if (!newer.edition) return `A newer survey is ready (${observed}).`;
  const same = world.status === 'edition' && world.founding.label === newer.edition.label;
  return same ? `A newer night of ${newer.edition.label} is ready (${observed}).` : `${newer.edition.label} is ready (${observed}).`;
}
