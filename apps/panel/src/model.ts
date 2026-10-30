// The panel's local view model. It describes only what the panel may show and why;
// it is not a shared contract and grants nothing. Every state that looks like an
// outcome says who decided it, so "pending" and "unavailable" can never pass for
// "accepted".

/** Where everything on screen came from. Fixtures are always labelled SIMULATED. */
export type SourceMark =
  | { readonly kind: 'simulated'; readonly label: 'SIMULATED'; readonly detail: string }
  | { readonly kind: 'production'; readonly label: null };

/** How the panel is reaching Twitch and the kingdom. */
export type Connection =
  /** Fixture data, no transport at all. */
  | { readonly kind: 'fixture' }
  /** A plain browser: the Twitch Extension Helper is not present. */
  | { readonly kind: 'outside-twitch' }
  /** The Helper is present and has not authorized this view yet. */
  | { readonly kind: 'knocking' }
  /** The Helper has not answered for a long while. */
  | { readonly kind: 'no-answer' }
  /** Twitch authorized the view; no kingdom service exists for the panel to read. */
  | { readonly kind: 'kingdom-unavailable' };

export interface Kingdom {
  readonly name: string;
  readonly tier: 'hamlet' | 'town';
  /** Short words under the name, e.g. "A town at dusk". */
  readonly motto: string;
}

export interface PictureProvenance {
  readonly origin: 'simulated';
  /** Human words for the caption. */
  readonly caption: string;
  readonly render: { readonly route: string; readonly seed: string; readonly hour: number; readonly camera: string };
  readonly capturedOn: string;
}

export type Picture =
  | {
    readonly kind: 'still'; readonly url: string; readonly alt: string; readonly width: number; readonly height: number;
    /** The same moment framed for a phone held upright, when the source made one. */
    readonly portrait: { readonly url: string; readonly width: number; readonly height: number } | null;
    readonly provenance: PictureProvenance;
  }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type LightChoice = 'named' | 'unnamed';

/**
 * The viewer's window. Only an authority may produce `lit`: the SIMULATED fixture
 * (which says so) or, one day, the kingdom's own server. Twitch identity, opaque
 * IDs, decoded tokens, URLs and storage never do.
 */
export type Light =
  | { readonly kind: 'outside-twitch' }
  | { readonly kind: 'logged-out' }
  | { readonly kind: 'unshared' }
  | { readonly kind: 'pending'; readonly choice: LightChoice }
  | { readonly kind: 'lit'; readonly choice: LightChoice; readonly by: 'simulation' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface Moment {
  readonly id: string;
  /** Local time words, e.g. "9:12 pm". */
  readonly at: string;
  readonly text: string;
}

export interface Raising {
  readonly building: string;
  /** 0..1, communal: it belongs to the whole kingdom. */
  readonly progress: number;
  readonly next: string;
}

export type Tonight =
  | { readonly kind: 'supplied'; readonly summary: string; readonly moments: readonly Moment[]; readonly raising: Raising | null }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type Home =
  | { readonly kind: 'supplied'; readonly street: string; readonly description: string; readonly displayName: string | null; readonly picture: Picture }
  | { readonly kind: 'unknown'; readonly reason: string };

export type Tavern =
  | { readonly kind: 'supplied'; readonly place: string; readonly table: string; readonly watching: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface PanelSnapshot {
  readonly source: SourceMark;
  readonly connection: Connection;
  /** Null when no service has told us which kingdom this channel holds. */
  readonly kingdom: Kingdom | null;
  readonly stream: 'live' | 'resting' | 'unknown';
  readonly picture: Picture;
  readonly light: Light;
  readonly tonight: Tonight;
  readonly home: Home;
  readonly tavern: Tavern;
}

/** One adapter per mounted panel. Actions report back only through the snapshot. */
export interface PanelAdapter {
  get(): PanelSnapshot;
  subscribe(listener: (snapshot: PanelSnapshot) => void): () => void;
  /** Ask to light the viewer's window. Must be called from a user gesture. */
  requestLight(choice: LightChoice): void;
  dispose(): void;
}
