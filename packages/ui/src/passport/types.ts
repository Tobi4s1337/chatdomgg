/**
 * The parts of the frozen `@chatdom/shared/passport` read projection that the book's craft reads. The craft never
 * validates or widens a book: adapters validate with `PassportBookSchema` at their boundary, and
 * `apps/web/src/passport/contract.ts` proves at compile time that the frozen visible book still fits these views.
 * Everything is readonly: the book only presents witnessed records, it never edits them.
 */
export type CrestShape = 'heater' | 'round' | 'swallowtail';
export type CrestCharge = 'oak' | 'star' | 'wave' | 'mountain';

export interface CrestView {
  readonly key: string;
  readonly shape: CrestShape;
  readonly charge: CrestCharge;
  /** Two to four `#rrggbb` tinctures, in the order the kingdom's arms supply them. */
  readonly colours: readonly string[];
  readonly assetHash: string | null;
}

export interface KingdomView { readonly kingdomId: string; readonly name: string; readonly crest: CrestView }
export interface PersonView { readonly personId: string; readonly name: string }
export interface RoadView { readonly id: string; readonly from: string; readonly to: string }
export interface GiftView { readonly id: string; readonly name: string; readonly direction: 'left' | 'brought-back'; readonly keepsakeId: string | null }

interface StampBase { readonly id: string; readonly at: number; readonly kingdom: KingdomView; readonly gifts: readonly GiftView[] }
export interface VisitStampView extends StampBase { readonly kind: 'visit' }
export interface RaidStampView extends StampBase {
  readonly kind: 'raid'; readonly raidId: string; readonly road: RoadView;
  /** Null is unknown: never drawn as a guessed leader. */
  readonly leader: PersonView | null;
}
export type StampView = VisitStampView | RaidStampView;

export interface VisitView { readonly kingdom: KingdomView; readonly firstAt: number; readonly lastAt: number }
export interface BondView {
  readonly id: string; readonly since: number; readonly name: string;
  readonly with: { readonly kind: 'kingdom'; readonly kingdom: KingdomView } | { readonly kind: 'citizen'; readonly person: PersonView };
}
export interface KeepsakeView { readonly id: string; readonly name: string; readonly earnedAt: number; readonly kingdom: KingdomView; readonly artHash: string | null }

export interface PageView<T> { readonly items: readonly T[]; readonly nextCursor: string | null }

export type PassportCollection = 'stamps' | 'kingdoms' | 'bonds' | 'keepsakes';

export interface VisiblePassportView {
  readonly version: 1;
  readonly origin: 'live' | 'simulated';
  readonly visibility: 'visible';
  readonly holder: PersonView;
  readonly revision: string;
  readonly asOf: number;
  readonly stamps: PageView<StampView>;
  readonly kingdoms: PageView<VisitView>;
  readonly bonds: PageView<BondView>;
  readonly keepsakes: PageView<KeepsakeView>;
}
export interface HiddenPassportView { readonly version: 1; readonly origin: 'live' | 'simulated'; readonly visibility: 'hidden' }
export type PassportView = VisiblePassportView | HiddenPassportView;
