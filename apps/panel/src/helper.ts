// A narrow bridge to Twitch's Extension Helper (`window.Twitch.ext`).
//
// What the Helper says is display evidence only: it can tell us the viewer is
// logged in or has shared their identity, never that they are a citizen or that
// their window is lit. Tokens stay inside this closure, in memory; they are never
// put in state, URLs, storage or logs.

export interface HelperAuthorized { channelId: string; clientId: string; token: string; helixToken: string; userId: string }
interface HelperViewer { readonly isLinked: boolean; readonly role: string; onChanged(callback: () => void): void }
interface HelperContext { theme?: 'light' | 'dark'; mode?: 'viewer' | 'dashboard' | 'config' }
/** The part of `window.Twitch.ext` the panel uses. */
export interface HelperExt {
  onAuthorized(callback: (auth: HelperAuthorized) => void): void;
  onContext(callback: (context: HelperContext, changed: readonly string[]) => void): void;
  onVisibilityChanged?(callback: (visible: boolean) => void): void;
  readonly viewer?: HelperViewer;
  readonly actions?: { requestIdShare(): void };
}

export type HelperStatus =
  | { readonly kind: 'absent' }
  | { readonly kind: 'waiting' }
  /** `loggedIn` comes from the opaque ID's prefix; `shared` from the Helper's viewer. Both are unverified. */
  | { readonly kind: 'authorized'; readonly loggedIn: boolean; readonly shared: boolean; readonly role: string };

export interface HelperBridge {
  status(): HelperStatus;
  subscribe(listener: (status: HelperStatus) => void): () => void;
  /** The latest token for a future kingdom request; never rendered or stored. */
  token(): string | null;
  /** Asks Twitch to share the viewer's identity. Only meaningful from a gesture. */
  requestIdShare(): boolean;
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
  let current: HelperStatus = ext ? { kind: 'waiting' } : { kind: 'absent' };
  let token: string | null = null;
  const emit = (next: HelperStatus) => { current = next; for (const listener of listeners) listener(next); };
  if (ext) {
    let last: HelperAuthorized | undefined;
    const read = () => {
      if (!last) return;
      // An `A…` opaque ID is a logged-out viewer and a `U…` one is logged in. Neither is a Chatdom person.
      emit({ kind: 'authorized', loggedIn: last.userId.startsWith('U'), shared: ext.viewer?.isLinked === true, role: ext.viewer?.role ?? 'viewer' });
    };
    ext.onAuthorized(auth => { last = auth; token = auth.token; read(); });
    ext.viewer?.onChanged(read);
  }
  return {
    status: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    token: () => token,
    requestIdShare() {
      if (!ext?.actions || current.kind !== 'authorized' || !current.loggedIn) return false;
      ext.actions.requestIdShare();
      return true;
    },
  };
}

let shared: HelperBridge | undefined;

/** One bridge per page: the Helper's callbacks cannot be unregistered. */
export function connectHelper(): HelperBridge {
  shared ??= bridgeHelper(findHelper());
  return shared;
}
