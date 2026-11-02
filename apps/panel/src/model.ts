import type { PanelGiftShelf, PanelSettings } from '../../../packages/shared/src/panel';
import type { PassportDisclosureView, PassportTransport } from '@chatdom/ui/passport';

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
  /** Twitch authorized the view; no kingdom service answered for the panel to read. */
  | { readonly kind: 'kingdom-unavailable' }
  /** The kingdom's Extension backend answered with this channel's kingdom and the viewer's own reading. */
  | { readonly kind: 'connected' }
  /** The kingdom stopped answering. What is shown is as it was at `asOf`, and says so. */
  | { readonly kind: 'lost'; readonly asOf: string };

export interface Kingdom {
  readonly name: string;
  readonly tier: 'hamlet' | 'town';
  /** Short words under the name, e.g. "A town at dusk". */
  readonly motto: string;
}

export interface PictureProvenance {
  readonly origin: 'simulated' | 'realm' | 'sketch';
  /** Human words for the caption. */
  readonly caption: string;
  readonly render?: { readonly route: string; readonly seed: string; readonly hour: number; readonly camera: string };
  readonly capturedOn: string;
}

export type Picture =
  | {
    readonly kind: 'still'; readonly url: string; readonly alt: string; readonly width: number; readonly height: number;
    /** The same moment framed for a phone held upright, when the source made one. */
    readonly portrait: { readonly url: string; readonly width: number; readonly height: number } | null;
    readonly provenance: PictureProvenance;
    /** Where the viewer's own window glows in this painting, 0..1 across and down; only while it is lit in it. */
    readonly mark?: { readonly x: number; readonly y: number };
  }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type LightChoice = 'named' | 'unnamed';

/** How far a light request has come: Twitch shares who you are, then the kingdom answers. */
export type LightStep = 'sharing' | 'confirming';

/**
 * The viewer's window. Only an authority may produce `lit`: the SIMULATED fixture
 * (which says so) or the kingdom's own server. Twitch identity, opaque
 * IDs, decoded tokens, URLs and storage never do.
 */
export type Light =
  | { readonly kind: 'ready' }
  | { readonly kind: 'outside-twitch' }
  | { readonly kind: 'logged-out' }
  | { readonly kind: 'unshared' }
  /** The viewer kept their identity private when Twitch asked. They may ask again. */
  | { readonly kind: 'refused' }
  | { readonly kind: 'pending'; readonly choice: LightChoice; readonly step: LightStep }
  /** Confirmed present. `as: 'guest'` when the person already keeps three homes elsewhere. */
  | { readonly kind: 'lit'; readonly choice: LightChoice; readonly as: 'citizen' | 'guest' | 'castle'; readonly by: 'simulation' | 'realm' }
  /** A private moderation hold; no public accusation is shown. */
  | { readonly kind: 'held' }
  /** Waiting land, with a private pledge outside the three-home cap. */
  | { readonly kind: 'unfounded'; readonly pledged: boolean; readonly band: string | null }
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

/** The building the whole kingdom is raising together. Nobody's share is ever shown. */
export interface Raising {
  readonly building: string;
  /** 0..1, communal: it belongs to the whole kingdom. */
  readonly progress: number;
  /** The level's stages, carved as notches on the meter: storeys of a scaffold. */
  readonly steps: number;
  /** What the finished level brings to everyone. */
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

/**
 * The citizen's own portrait as an authority supplied it: always a finished picture, painted by the citizen portrait
 * renderer from their saved look. The panel never paints one, and never stands in a face for a missing one.
 */
export interface CardPortrait {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly origin: 'simulated' | 'live';
}

/** A home's size, from a first hut to a hall: tenure as architecture. */
export type HomeTier = 'hut' | 'cottage' | 'house' | 'manor' | 'hall';

/** One earned piece the citizen chose to wear, as their verified records name it. Never bought, only shown. */
export type WornPiece =
  | { readonly id: string; readonly family: 'ribbons'; readonly name: string; readonly story: string | null; readonly months: number }
  | { readonly id: string; readonly family: 'hood' | 'scarf' | 'cape'; readonly name: string; readonly story: string | null; readonly colours: readonly [string, string] }
  | { readonly id: string; readonly family: 'pin'; readonly name: string; readonly story: string | null; readonly shape: 'heater' | 'round' | 'swallowtail' | 'founder' | 'forged'; readonly colours: readonly [string, string] }
  | { readonly id: string; readonly family: 'forgedHat'; readonly name: string; readonly story: string | null; readonly colours: readonly [string, string] };

/**
 * The viewer's own citizen card, as the kingdom's card authority projects it for them (spec 19). Words arrive formatted;
 * null is "not known yet", never zero or a guessed date. It is the viewer's own panel, so their name shows here even
 * while they keep their window unnamed to the town.
 */
export interface CitizenCard {
  readonly name: string;
  /** Their chat colour, set on a readable backing when it would not read on parchment. */
  readonly colour: string | null;
  /** Office and number in words: "Citizen No. 212", "Knight of the Watch, Citizen No. 31". */
  readonly standing: string;
  readonly portrait: CardPortrait | null;
  /** "30 Aug 2024". */
  readonly following: string | null;
  /** "14 months, Tier 1"; a lapsed sub keeps its months and claims no tier. */
  readonly subscribed: string | null;
  /** Their home here and its tier; null for a guest. */
  readonly home: { readonly name: string; readonly tier: HomeTier | null } | null;
  /** Their other disclosed homes, by kingdom and street. Never more than the card publishes. */
  readonly elsewhere: readonly { readonly kingdom: string; readonly home: string }[];
  readonly worn: readonly WornPiece[];
}

/**
 * Where the viewer's passport is read from. A passport is only ever read through its checked transport, whose
 * reading follows the card's disclosure; the panel decides nothing about whose book it is.
 */
export type PassportSource =
  | {
    readonly kind: 'readable';
    readonly transport: PassportTransport;
    /** Kingdom names the card already shows publicly (its disclosed homes), so a road can say where it began. */
    readonly places: ReadonlyMap<string, string>;
    readonly disclosure: PassportDisclosureView | null;
  }
  | { readonly kind: 'unavailable'; readonly reason: string };

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
    /** Their citizen card, when the card authority supplied it. */
    readonly card: CitizenCard | null;
    readonly passport: PassportSource;
  }
  /** Three homes are already kept elsewhere: here the light burns as a guest's. */
  | {
    readonly kind: 'guest'; readonly displayName: string | null; readonly history: readonly Earned[];
    readonly card: CitizenCard | null; readonly passport: PassportSource;
  }
  /** Their card, with no home here to show beside it (no home yet, or the monarch whose home is the castle). */
  | { readonly kind: 'known'; readonly card: CitizenCard; readonly passport: PassportSource; readonly note: string }
  /** `ask: 'share'` when the only thing between the viewer and their card is telling Chatdom who they are. */
  | { readonly kind: 'unknown'; readonly reason: string; readonly ask?: 'share' };

/** A table in the tavern. Seats are taken inside the kingdom, never from the panel. */
export interface TavernTable {
  readonly id: string;
  readonly name: string;
  /** The game being played, or null when the table is free. */
  readonly game: string | null;
  /** What is happening there now, in words. */
  readonly now: string;
  readonly seats: number;
  /** Display names of the people seated, as the tavern shows them to everyone. */
  readonly seated: readonly string[];
}

export type Tavern =
  | {
    readonly kind: 'supplied'; readonly place: string; readonly where: string;
    readonly tables: readonly TavernTable[];
    /** What a panel viewer can do here: follow, not sit. */
    readonly watching: string;
  }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The viewer's coals, only as the kingdom states them. A Twitch identity, a slot or a
 * guess never fills the scuttle. `damp` is private: only the viewer is told.
 */
export type Coals =
  | { readonly kind: 'known'; readonly held: number; readonly cap: 3; readonly damp: boolean }
  | { readonly kind: 'unknown'; readonly reason: string };

/** The Forge, as a signpost. Nothing is forged, prompted or submitted from the panel. */
export type Forge =
  | {
    readonly kind: 'supplied';
    /** The forge burns only while the stream is live; between streams it is banked. */
    readonly fire: 'burning' | 'banked';
    readonly anvils: { readonly total: number; readonly working: number };
    readonly coals: Coals;
    /** Finished pieces with their makers' names. Refusals are private and never listed. */
    readonly made: readonly { readonly id: string; readonly text: string }[];
  }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** One tap is one command, with chat's own limits: one person, one vote, no paid weight. */
export type ActKind = 'vote' | 'errand' | 'dragon';
export interface ActOption { readonly id: string; readonly label: string }

export type ActStatus =
  | { readonly kind: 'open' }
  /** Sent, and waiting for the kingdom's answer. Not yet counted. */
  | { readonly kind: 'pending'; readonly option: string }
  /**
   * Counted by the kingdom. `restMs` is chat's own pause before the same command
   * counts again; null for a vote, which counts once.
   */
  | { readonly kind: 'accepted'; readonly option: string; readonly restMs: number | null }
  /** The kingdom said not yet: the same limit as chat, wherever the last one came from. */
  | { readonly kind: 'limited'; readonly words: string; readonly restMs: number }
  | { readonly kind: 'ended'; readonly outcome: string }
  /** This viewer cannot act here; `way` is the step that would let them. */
  | { readonly kind: 'unavailable'; readonly reason: string; readonly way: 'light' | null };

export interface CrowdAct {
  readonly id: string;
  readonly kind: ActKind;
  /** Short heading, e.g. "A world vote". */
  readonly title: string;
  readonly prompt: string;
  /** The chat command the tap stands for, e.g. "!haul". */
  readonly command: string;
  readonly options: readonly ActOption[];
  /** The limit in words, the same as chat's. */
  readonly limit: string;
  /** Local time words, when the act closes on its own. */
  readonly closes: string | null;
  readonly status: ActStatus;
  /** Errands raise the communal building; the slip shows it rising. */
  readonly raising: Raising | null;
}

/**
 * A fixed product on the Bits shelf. Moments, or things that last one day; never light,
 * rank, a place, coals, tenure or anything permanent.
 */
export interface ShelfProduct {
  readonly sku: string;
  readonly title: string;
  readonly bits: number;
  readonly what: string;
  readonly stays: { readonly kind: 'moment' } | { readonly kind: 'day'; readonly until: string; readonly what: string };
}

/** Twitch's own window confirms Bits. Cancelled is an outcome; nothing here can grant a product. */
export type ShelfRequest =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirming'; readonly sku: string }
  | { readonly kind: 'cancelled'; readonly sku: string };

export type Shelf =
  /** Shown only with Twitch's Bits signal and a delivery service that can verify a receipt. */
  | { readonly kind: 'offered'; readonly products: readonly ShelfProduct[]; readonly request: ShelfRequest; readonly by: 'simulation' }
  | { readonly kind: 'hidden' };

/**
 * What the streamer chose to show in viewers' panels (`Twitch.md` §16). The window itself is
 * not a section: lighting it is the panel's heart and free forever, so it always shows. `home`
 * is the home card; `night` the picture's companion slip and Tonight; `acts` the crowd acts.
 */
export interface Sections {
  readonly night: boolean;
  readonly home: boolean;
  readonly acts: boolean;
  readonly shelf: boolean;
}
export const ALL_SECTIONS: Sections = { night: true, home: true, acts: true, shelf: true };

/** Where "Walk in" leads: the kingdom's own entry gate, on chatdom.gg, in a new tab. */
export type Entry = { readonly kind: 'gate'; readonly path: string } | { readonly kind: 'none' };

export type Privacy =
  | { readonly kind: 'loading' | 'unavailable' }
  | { readonly kind: 'ready' | 'pending'; readonly quiet: boolean; readonly projection?: 'pending' | 'applied'; readonly forgetAvailable?: boolean }
  | { readonly kind: 'forgotten'; readonly erased: readonly string[] };

export interface PanelSnapshot {
  readonly gifts?: PanelGiftShelf;
  readonly privacy?: Privacy;
  readonly source: SourceMark;
  readonly connection: Connection;
  /** Null when no service has told us which kingdom this channel holds. */
  readonly kingdom: Kingdom | null;
  /** The streamer's Twitch display name, told only while their channel has no kingdom yet. */
  readonly streamer?: string | null;
  readonly stream: 'live' | 'resting' | 'unknown';
  readonly kingdomLights?: number | null;
  readonly moment?: string | null;
  readonly picture: Picture;
  readonly light: Light;
  readonly tonight: Tonight;
  readonly home: Home;
  readonly tavern: Tavern;
  readonly forge: Forge;
  /** The shared moment the crowd can join right now, if any. */
  readonly act: CrowdAct | null;
  readonly shelf: Shelf;
  readonly entry: Entry;
  /** The streamer's choice of sections, as the kingdom carries it to every panel. */
  readonly sections: Sections;
  readonly settings?: PanelSettings;
}

/** One adapter per mounted panel. Actions report back only through the snapshot. */
export interface PanelAdapter {
  get(): PanelSnapshot;
  subscribe(listener: (snapshot: PanelSnapshot) => void): () => void;
  /** Ask to light the viewer's window. Must be called from a user gesture. */
  requestLight(choice: LightChoice): void;
  /** Ask Twitch to share who the viewer is with Chatdom, so their own card can open. Gesture only. */
  requestIdentity?(): void;
  /** One tap on the crowd act: one command, under chat's limits. Gesture only. */
  requestPrivacy?(): void;
  requestQuiet?(quiet: boolean): void;
  requestForget?(): void;
  requestAct(option: string): void;
  /** Ask Twitch to confirm Bits for a shelf product. Gesture only; nothing is granted here. */
  requestProduct(sku: string): void;
  chooseGiftTarget?(plotId: string): void;
  resolveGiftIntent?(intentId: string): void;
  moreGiftChoices?(): void;
  cancelGiftChoice?(): void;
  resetGift?(): void;
  dispose(): void;
}
