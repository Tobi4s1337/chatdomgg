// A narrow bridge to Twitch's Extension Helper (`window.Twitch.ext`).
//
// What the Helper says is display evidence only: it can tell us the viewer is
// logged in or has shared their identity, never that they are a citizen or that
// their window is lit. Tokens stay inside this closure, in memory; they are never
// put in state, URLs, storage or logs.

interface HelperAuthorized { channelId: string; clientId: string; token: string; helixToken: string; userId: string }
interface HelperViewer { readonly isLinked: boolean; readonly role: string; onChanged(callback: () => void): void }
interface HelperContext { theme?: 'light' | 'dark'; mode?: 'viewer' | 'dashboard' | 'config' }
interface HelperExt {
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

let shared: HelperBridge | undefined;

/** One bridge per page: the Helper's callbacks cannot be unregistered. */
export function connectHelper(): HelperBridge {
  if (shared) return shared;
  const ext = findHelper();
  const listeners = new Set<(status: HelperStatus) => void>();
  let current: HelperStatus = ext ? { kind: 'waiting' } : { kind: 'absent' };
  let token: string | null = null;
  const emit = (next: HelperStatus) => { current = next; for (const listener of listeners) listener(next); };
  if (ext) {
    const read = (auth: HelperAuthorized) => {
      token = auth.token;
      emit({ kind: 'authorized', loggedIn: auth.userId.startsWith('U'), shared: ext.viewer?.isLinked === true, role: ext.viewer?.role ?? 'viewer' });
    };
    let last: HelperAuthorized | undefined;
    // Twitch refreshes the token by calling this again; the latest one always wins.
    ext.onAuthorized(auth => { last = auth; read(auth); });
    ext.viewer?.onChanged(() => { if (last) read(last); });
  }
  shared = {
    status: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    token: () => token,
    requestIdShare() {
      if (!ext?.actions || current.kind !== 'authorized' || !current.loggedIn) return false;
      ext.actions.requestIdShare();
      return true;
    },
  };
  return shared;
}
