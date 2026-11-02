import type { OpeningState } from './journal';

export type OpeningBeat = 'unrolling' | 'street' | 'land' | 'rising' | 'lit';
export interface OpeningView {
  readonly beat: OpeningBeat;
  /** The beat's sentence. */
  readonly line: string;
  /** The real numbers behind the beat, or null when there is nothing counted yet. */
  readonly detail: string | null;
  /** Fraction of the counted work actually done (bytes read of the planned first view, or pieces meshed), or
   * null when nothing is counted yet. Never estimated, never advanced by time. */
  readonly ink: number | null;
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0);

/**
 * What the loader says and shows for one journal state. A pure function of the state: the time only animates
 * beats that have already happened, inside the painter.
 */
export function openingView(state: OpeningState): OpeningView {
  const name = state.name ?? 'the kingdom';
  const own = state.streets?.ownSlot !== null && state.streets?.ownSlot !== undefined;
  const beat: OpeningBeat = state.at.lit !== undefined ? 'lit'
    : state.regions.length || (state.local && (state.assets?.done ?? 0) > 0) ? 'rising'
      : state.land ? 'land'
        : state.streets ? 'street' : 'unrolling';
  const line = {
    unrolling: `Unrolling the map of ${name}`,
    street: own ? 'Inking your street' : `Inking the streets of ${name}`,
    land: 'Drawing the coast and the high ground',
    rising: state.local ? 'Raising the homes' : 'The ink rises into the land',
    lit: own ? 'Your window is lit' : 'The windows are lit',
  }[beat];
  let detail: string | null = null, ink: number | null = null;
  const bytes = state.bytes;
  if (!state.local && bytes && bytes.received > 0) {
    if (bytes.planned > 0) {
      const received = Math.min(bytes.received, bytes.planned);
      detail = `${megabytes(received)} of ${megabytes(bytes.planned)} MB · ${bytes.coveredRegions} of ${bytes.requiredRegions} regions`;
      ink = received / bytes.planned;
    } else detail = bytes.received < 1e6 ? `${Math.max(1, Math.round(bytes.received / 1000))} KB of land read` : `${megabytes(bytes.received)} MB of land read`;
    if (bytes.cacheHits > 0) detail += ' · kept from your last visit';
  } else if (state.assets && state.assets.total > 0) {
    detail = `${state.assets.done} of ${state.assets.total} pieces raised`;
    ink = state.assets.done / state.assets.total;
  }
  if (beat === 'lit') ink = 1;
  if (state.failed) return { beat, line: 'The road needs a moment', detail: state.failed, ink };
  return { beat, line, detail, ink };
}
