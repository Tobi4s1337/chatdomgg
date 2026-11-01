// A narrow bridge to Twitch's Extension Helper (`window.Twitch.ext`).
//
// What the Helper says is display evidence only: it can tell us the viewer is
// logged in or has shared their identity, never that they are a citizen or that
// their window is lit. Tokens stay inside this closure, in memory; they are never
// put in state, URLs, storage or logs.

export interface HelperAuthorized { channelId: string; clientId: string; token: string; helixToken: string; userId: string }
interface HelperViewer { readonly isLinked: boolean; readonly role: string; onChanged(callback: () => void): void }
interface HelperContext { theme?: 'light' | 'dark'; mode?: 'viewer' | 'dashboard' | 'config'; isPaused?: boolean }
export interface HelperProduct { readonly sku: string; readonly cost: { readonly amount: number | string; readonly type?: string }; readonly expiration?: string | null; readonly isBroadcast?: boolean }
export interface HelperTransaction { readonly initiator?: string; readonly product?: { readonly sku?: string }; readonly transactionReceipt?: string }
/** The part of `window.Twitch.ext` the panel uses. */
export interface HelperExt {
  onAuthorized(callback: (auth: HelperAuthorized) => void): void;
  onContext(callback: (context: HelperContext, changed: readonly string[]) => void): void;
  onVisibilityChanged?(callback: (visible: boolean) => void): void;
  readonly bits?: {
    getProducts(): Promise<readonly HelperProduct[]>;
    useBits(sku: string): void;
    onTransactionComplete(callback: (transaction: HelperTransaction) => void): void;
    onTransactionCancelled(callback: () => void): void;
  };
  readonly viewer?: HelperViewer;
  readonly actions?: { requestIdShare(): void };
  readonly features?: { readonly isBitsEnabled?: boolean; onChanged?(callback: (changed: readonly string[]) => void): void };
}

export type HelperStatus =
  | { readonly kind: 'absent' }
  | { readonly kind: 'waiting' }
  /**
   * `loggedIn` comes from the opaque ID's prefix; `shared` from the Helper's viewer; `bits` from
   * Twitch's feature flags. All are unverified display evidence.
   */
  | { readonly kind: 'authorized'; readonly loggedIn: boolean; readonly shared: boolean; readonly role: string; readonly bits: boolean };

export interface HelperBridge {
  status(): HelperStatus;
  subscribe(listener: (status: HelperStatus) => void): () => void;
  /** The latest token for a future kingdom request; never rendered or stored. */
  token(): string | null;
  /** Helper visibility and playback are gates, never proof of presence. */
  visible?(): boolean;
  active?(): boolean;
  /** Increments only on onAuthorized, never on viewer.onChanged. */
  authorization?(): number;
  /** Asks Twitch to share the viewer's identity. Only meaningful from a gesture. */
  requestIdShare(): boolean;
  getProducts?(): Promise<readonly HelperProduct[]>;
  useBits?(sku: string): boolean;
  onGiftTransaction?(listener: (transaction: HelperTransaction) => void): () => void;
  onGiftCancelled?(listener: () => void): () => void;
}

function findHelper(): HelperExt | undefined {
  const twitch = (globalThis as { Twitch?: { ext?: HelperExt } }).Twitch;
  return twitch?.ext;
}

/**
 * Wraps one Helper. Twitch calls `onAuthorized` again whenever it refreshes the token
 * and after the viewer shares or revokes their identity; the latest call always wins,
 * and the previous token is dropped. Exported for the adapter test.
 */
export function bridgeHelper(ext: HelperExt | undefined): HelperBridge {
  const listeners = new Set<(status: HelperStatus) => void>();
  const transactions = new Set<(transaction: HelperTransaction) => void>();
  const cancellations = new Set<() => void>();
  let current: HelperStatus = ext ? { kind: 'waiting' } : { kind: 'absent' };
  let token: string | null = null;
  let visible = true, playing = false, authorization = 0;
  const emit = (next: HelperStatus) => { current = next; for (const listener of listeners) listener(next); };
  if (ext) {
    ext.bits?.onTransactionComplete(transaction => { for (const listener of transactions) listener(transaction); });
    ext.bits?.onTransactionCancelled(() => { for (const listener of cancellations) listener(); });
    let last: HelperAuthorized | undefined;
    const read = () => {
      if (!last) return;
      // An `A…` opaque ID is a logged-out viewer and a `U…` one is logged in. Neither is a Chatdom person.
      emit({ kind: 'authorized', loggedIn: last.userId.startsWith('U'), shared: ext.viewer?.isLinked === true, role: ext.viewer?.role ?? 'viewer', bits: ext.features?.isBitsEnabled === true });
    };
    ext.onAuthorized(auth => { last = auth; token = auth.token; authorization++; read(); });
    ext.onVisibilityChanged?.(value => { visible = value; emit(current); });
    ext.onContext(context => {
      if (typeof context.isPaused === 'boolean') { playing = !context.isPaused; emit(current); }
    });
    ext.viewer?.onChanged(read);
    // Twitch's feature flags arrive after the first authorization and may change during a stream.
    ext.features?.onChanged?.(read);
  }
  return {
    status: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    token: () => token,
    visible: () => visible,
    active: () => visible && playing,
    authorization: () => authorization,
    ...(ext?.bits ? {
      getProducts: () => ext.bits!.getProducts(),
      useBits: (sku: string) => { try { ext.bits!.useBits(sku); return true; } catch { return false; } },
    } : {}),
    onGiftTransaction(listener) { transactions.add(listener); return () => transactions.delete(listener); },
    onGiftCancelled(listener) { cancellations.add(listener); return () => cancellations.delete(listener); },
    requestIdShare() {
      if (!ext?.actions || current.kind !== 'authorized' || !current.loggedIn) return false;
      try { ext.actions.requestIdShare(); return true; } catch { return false; }
    },
  };
}

let shared: HelperBridge | undefined;

/** One bridge per page: the Helper's callbacks cannot be unregistered. */
export function connectHelper(): HelperBridge {
  shared ??= bridgeHelper(findHelper());
  return shared;
}
