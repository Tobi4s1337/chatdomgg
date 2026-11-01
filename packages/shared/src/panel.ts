/** Panel gift wire contract. Provider receipts, person IDs and credentials never enter public facts. */
export interface PanelGiftOffer {
  readonly sku: string;
  readonly giftId: string;
  readonly title: string;
  readonly what: string;
  readonly target: 'none' | 'friend' | 'self';
  readonly durationMs: number;
}
export interface PanelGiftFriend { readonly plotId: string; readonly name: string }
export interface PanelGiftFact {
  readonly version: 1;
  readonly type: 'panel.gift';
  /** Stable public fact ID, separate from the private provider transaction ID. */
  readonly id: string;
  readonly kingdomId: string;
  readonly giftId: string;
  readonly sequence: number;
  readonly effectVersion: number;
  readonly committedAt: number;
  readonly endsAt: number;
  readonly credit: { readonly name: string; readonly slot: number | null } | null;
  readonly target: { readonly plotId: string; readonly slot: number } | null;
  readonly line: string;
}
export interface PanelGiftChoice { readonly intentId: string; readonly title: string; readonly targetName: string | null; readonly createdAt: number }
export type PanelGiftRequest =
  | { readonly kind: 'idle' }
  | { readonly kind: 'choosing'; readonly sku: string }
  | { readonly kind: 'choosing-paid'; readonly sku: string; readonly paymentRef: string; readonly choices: readonly PanelGiftChoice[]; readonly nextCursor?: string | null }
  | { readonly kind: 'confirming' | 'pending' | 'cancelled' | 'unavailable'; readonly sku: string; readonly canCancel?: boolean }
  | { readonly kind: 'delivered'; readonly sku: string; readonly line: string };
export type PanelGiftShelf =
  | { readonly kind: 'closed'; readonly reason: string }
  | { readonly kind: 'open'; readonly offers: readonly (PanelGiftOffer & { readonly bits: number })[];
      readonly friends: readonly PanelGiftFriend[]; readonly request: PanelGiftRequest };
/** Private receipt status is visible only to its verified subject. Accepted is never delivered. */
export type PanelGiftResult =
  | { readonly version: 1; readonly status: 'delivered'; readonly fact: PanelGiftFact }
  | { readonly version: 1; readonly status: 'cancelled' }
  | { readonly version: 1; readonly status: 'pending'; readonly canCancel?: boolean }
  | { readonly version: 1; readonly status: 'awaiting-target'; readonly paymentRef: string; readonly choices: readonly PanelGiftChoice[]; readonly nextCursor?: string | null }
  | { readonly version: 1; readonly status: 'refused' | 'unavailable'; readonly message: string };
