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
  | { readonly kind: 'kingdom-unavailable' }
  /** The kingdom stopped answering. What is shown is as it was at `asOf`, and says so. */
  | { readonly kind: 'lost'; readonly asOf: string };

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

/** How far a light request has come: Twitch shares who you are, then the kingdom answers. */
export type LightStep = 'sharing' | 'confirming';

/**
 * The viewer's window. Only an authority may produce `lit`: the SIMULATED fixture
 * (which says so) or, one day, the kingdom's own server. Twitch identity, opaque
 * IDs, decoded tokens, URLs and storage never do.
 */
export type Light =
  | { readonly kind: 'outside-twitch' }
  | { readonly kind: 'logged-out' }
  | { readonly kind: 'unshared' }
  /** The viewer kept their identity private when Twitch asked. They may ask again. */
  | { readonly kind: 'refused' }
  | { readonly kind: 'pending'; readonly choice: LightChoice; readonly step: LightStep }
  /** Confirmed present. `as: 'guest'` when the person already keeps three homes elsewhere. */
  | { readonly kind: 'lit'; readonly choice: LightChoice; readonly as: 'citizen' | 'guest'; readonly by: 'simulation' }
  /** The stream is resting: no window is lit from the panel until it returns. */
  | { readonly kind: 'resting'; readonly choice: LightChoice | null }
  /** The kingdom stopped answering; the light's state is unknown, not assumed. */
  | { readonly kind: 'out-of-reach'; readonly asOf: string }
  /**
   * No kingdom service can confirm a light. `twitch` is what Twitch's Helper says about
   * identity sharing, as display evidence only: shared still is not lit.
   */
  | { readonly kind: 'unavailable'; readonly twitch: 'unknown' | 'unshared' | 'shared' };

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

/** The Voice of the Realm's verse for a night that has ended. Only ever supplied, never composed here. */
export interface Ballad {
  readonly title: string;
  readonly lines: readonly string[];
  /** When it was sung, e.g. "Sung at 11:04 pm, as the kingdom rested". */
  readonly sung: string;
}

export type Tonight =
  | {
    readonly kind: 'supplied';
    /** A live stream's night, or the last one while the kingdom rests. */
    readonly night: 'tonight' | 'last-night';
    /** The night's chapter title in the Chronicle, when it has one. */
    readonly chapter: string | null;
    readonly summary: string;
    readonly moments: readonly Moment[];
    readonly raising: Raising | null;
    readonly ballad: Ballad | null;
  }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** How long someone has lived here. Unknown stays unknown: a window slot proves nothing. */
export type Tenure = { readonly kind: 'known'; readonly since: string } | { readonly kind: 'unknown' };

/** One earned line of a home's history, e.g. "Helped raise the well-house". */
export interface Earned { readonly id: string; readonly text: string; readonly at: string | null }

export type Home =
  | {
    readonly kind: 'citizen';
    readonly street: string;
    /** Where on the street, in words: "Third house on the left, two doors from the lane". */
    readonly place: string;
    readonly description: string;
    /** Null while the viewer has chosen to stay unnamed to the town. */
    readonly displayName: string | null;
    readonly picture: Picture;
    readonly tenure: Tenure;
    readonly history: readonly Earned[];
  }
  /** Three homes are already kept elsewhere: here the light burns as a guest's. */
  | { readonly kind: 'guest'; readonly displayName: string | null; readonly history: readonly Earned[] }
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
