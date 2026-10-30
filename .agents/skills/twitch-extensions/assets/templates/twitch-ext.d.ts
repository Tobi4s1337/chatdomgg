/**
 * Ambient TypeScript declarations for the Twitch Extension Helper (`window.Twitch.ext`).
 *
 * Hand-written from https://dev.twitch.tv/docs/extensions/reference/ (snapshot 2026-10-26),
 * cross-checked against observed runtime behaviour where the docs are known to be wrong
 * (marked "DOCS DISCREPANCY").
 *
 * Usage: copy into your frontend `src/` (any file included by tsconfig). It is a global script
 * file (no imports/exports), so `Twitch.ext` and `window.Twitch.ext` are typed everywhere.
 * The helper itself MUST be loaded from Twitch's CDN as the first <script> of every HTML page:
 *   <script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"></script>
 *
 * Alternative: the community package `@types/twitch-ext` (DefinitelyTyped) — similar shape.
 */

declare namespace Twitch.ext {
  // ───────────────────────────── Core strings ─────────────────────────────

  /** Helper version, semver string such as "1.1.1". */
  const version: string;
  /** Always "production" for external developers. */
  const environment: 'production' | (string & {});

  // ───────────────────────────── Shared types ─────────────────────────────

  /** JWT role values (see JWT schema). `external` is only used by EBS-signed tokens. */
  type Role = 'broadcaster' | 'moderator' | 'viewer' | 'external';

  /** Object passed to `onAuthorized` callbacks. Fired on load and every time the JWT is refreshed. */
  interface Authorized {
    /** Channel ID (numeric string) of the page where the extension iframe is embedded. */
    channelId: string;
    /** Client ID of the extension. */
    clientId: string;
    /** Twitch-signed JWT (HS256, extension secret). Send it to your EBS: `Authorization: Bearer <token>`. */
    token: string;
    /** "Helix JWT": call Twitch API from the frontend with `Authorization: Extension <helixToken>` + `Client-Id`. */
    helixToken: string;
    /**
     * OPAQUE user ID ("U…" logged-in & stable, "A…" anonymous & transient). NOT the Twitch user ID.
     * The real ID is only in `Twitch.ext.viewer.id` / JWT `user_id` after identity linking.
     */
    userId: string;
  }

  type ContextMode = 'viewer' | 'dashboard' | 'config';
  type PlaybackMode = 'video' | 'audio' | 'remote' | 'chat-only';
  type Theme = 'light' | 'dark';

  /**
   * Object passed to `onContext`. Every field is typed optional: the first call usually carries most
   * fields, later calls carry updates, and some fields are never sent on mobile
   * (`arePlayerControlsVisible`, `isFullScreen`, `isTheatreMode`).
   */
  interface Context {
    /** Player controls visible (e.g., mouseover). Not sent on mobile. */
    arePlayerControlsVisible?: boolean;
    /** Bitrate of the broadcast. */
    bitrate?: number;
    /** Buffer size of the broadcast. */
    bufferSize?: number;
    /** Display size of the player, e.g. "1280x720". */
    displayResolution?: string;
    /** Game (category) being broadcast. */
    game?: string;
    /** Seconds of latency between broadcaster and viewer. */
    hlsLatencyBroadcaster?: number;
    /** Hosting info, or undefined if the channel is not hosting (host mode is legacy). */
    hostingInfo?: {
      /** Numeric ID of the channel being hosted by the currently visible channel. */
      hostedChannelId: string;
      /** Numeric ID of the host channel. */
      hostingChannelId: string;
    };
    /** Fullscreen. Not sent on mobile. */
    isFullScreen?: boolean;
    /** Viewer muted the stream. */
    isMuted?: boolean;
    /** Viewer paused the stream. */
    isPaused?: boolean;
    /** Theatre mode. Not sent on mobile. */
    isTheatreMode?: boolean;
    /** Language of the broadcast, e.g. "en". */
    language?: string;
    /** viewer = channel page, dashboard = live dashboard (live_config), config = extension config page. */
    mode?: ContextMode;
    /** video | audio (mobile only) | remote (Chromecast etc.) | chat-only (mobile only). */
    playbackMode?: PlaybackMode;
    /** The user's Twitch theme. Use it to switch your CSS between light and dark. */
    theme?: Theme;
    /** Resolution of the broadcast. */
    videoResolution?: string;
    /** Player volume, 0..1. */
    volume?: number;
  }

  /** PubSub targets you can listen to. Any other string = non-Extensions PubSub topic (docs: "also supported"). */
  type ListenTarget = 'broadcast' | 'global' | `whisper-${string}` | (string & {});
  /** Targets the frontend may `send` to (broadcaster JWT only). Broadcasters cannot send to "global". */
  type SendTarget = 'broadcast' | `whisper-${string}`;
  /** PubSub listener. `message` is ALWAYS a string (JSON.parse it yourself). */
  type PubSubCallback = (target: string, contentType: string, message: string) => void;

  // ───────────────────────────── Helper: Extensions ─────────────────────────────

  /** Register a callback fired with auth data on load and on every JWT refresh. Always use the latest token. */
  function onAuthorized(authCallback: (auth: Authorized) => void): void;

  /** Register a callback fired with the context and the list of changed property names. */
  function onContext(contextCallback: (context: Context, changed: ReadonlyArray<keyof Context>) => void): void;

  /** Register a callback fired with any error generated by the helper. */
  function onError(errorCallback: (error: unknown) => void): void;

  /** video_overlay / component only: viewer hovers the extension's menu icon or open menu. */
  function onHighlightChanged(callback: (isHighlighted: boolean) => void): void;

  /**
   * Extension hidden / re-shown (viewer action, paused video, ad running…). While hidden you get no
   * onContext updates — do minimal work. `context` is present only when `isVisible` is true.
   */
  function onVisibilityChanged(callback: (isVisible: boolean, context?: Context) => void): void;

  /**
   * @deprecated Removed from the official reference on 2026-06-08 as "unused". Do not rely on it.
   * Historically: component extensions received `{x, y}` position (percent) changes.
   */
  function onPositionChanged(callback: (position: { x: number; y: number }) => void): void;

  /**
   * Send an Extension PubSub message from the frontend. Only works with a BROADCASTER token
   * (e.g., from config / live_config views). Viewers must go through your EBS instead.
   * `message` objects are JSON-serialized automatically.
   */
  function send(target: SendTarget, contentType: string, message: object | string): void;

  /**
   * Listen to an Extension PubSub topic: "broadcast" (this extension + channel), "global" (all channels),
   * or `whisper-${auth.userId}` (only your own opaque ID; others are blocked).
   */
  function listen(target: ListenTarget, callback: PubSubCallback): void;

  /** Remove a listener. Must be the SAME function object passed to `listen`. */
  function unlisten(target: ListenTarget, callback: PubSubCallback): void;

  // ───────────────────────────── Helper: Actions ─────────────────────────────

  namespace actions {
    /** Show Twitch's follow dialog for `channelName` (login). Result arrives via `onFollow`. */
    function followChannel(channelName: string): void;
    /** Minimize a video_component or video_overlay extension. */
    function minimize(): void;
    /** Result of a `followChannel` prompt. */
    function onFollow(callback: (didFollow: boolean, channelName: string) => void): void;
    /**
     * Prompt the viewer to share their Twitch identity. On success `onAuthorized` fires again with a JWT
     * containing `user_id`. No effect if identity linking is not enabled (Capabilities tab) or if called
     * on the user's own channel.
     */
    function requestIdShare(): void;
  }

  // ───────────────────────────── Helper: Configuration ─────────────────────────────

  namespace configuration {
    /** A configuration segment record. `content` is a string (often JSON you serialized yourself). */
    interface Segment {
      version: string;
      content: string;
    }
    /** Broadcaster segment for this channel, or undefined. Valid after the first `onChanged` call. */
    const broadcaster: Segment | undefined;
    /** Developer segment for this channel, or undefined. */
    const developer: Segment | undefined;
    /** Global segment (all channels), or undefined. */
    const global: Segment | undefined;
    /** Called (no args) when configuration is received — read the segments inside it, not before. */
    function onChanged(callback: () => void): void;
    /**
     * Write the broadcaster segment from the frontend (needs a broadcaster JWT, i.e. config/live_config
     * views). Only "broadcaster" is valid here; developer/global are EBS-only (Helix). Max 5 KB.
     */
    function set(segment: 'broadcaster', version: string, content: string): void;
  }

  // ───────────────────────────── Helper: Feature Flags ─────────────────────────────

  namespace features {
    type FeatureFlag = 'isBitsEnabled' | 'isChatEnabled' | 'isSubscriptionStatusAvailable';
    /** Bits in Extensions will work on this channel. MUST be checked by monetized extensions. */
    const isBitsEnabled: boolean;
    /** Send Extension Chat Message is allowed on this channel. */
    const isChatEnabled: boolean;
    /** Subscription status of identity-linked viewers is available (helper + Twitch API). */
    const isSubscriptionStatusAvailable: boolean;
    /** Flags arrive async after the first onAuthorized; called with the names of changed flags. */
    function onChanged(callback: (changed: ReadonlyArray<FeatureFlag | (string & {})>) => void): void;
  }

  // ───────────────────────────── Helper: Bits ─────────────────────────────

  namespace bits {
    interface Cost {
      /** Number of Bits, as a STRING (e.g. "500"). */
      amount: string;
      /** Always "bits". */
      type: 'bits';
    }
    interface Product {
      /** Unique product ID (SKU) from your catalog. */
      sku: string;
      /** Registered display name. */
      displayName: string;
      cost: Cost;
      /** Only present for extension versions that are NOT Released. */
      inDevelopment?: boolean;
    }
    /**
     * Payload of `onTransactionComplete`.
     * DOCS DISCREPANCY: the reference table lists `product` as a string and mixes in receipt-JWT fields;
     * at runtime `product` is the Product object. In loopback/test mode the object is reduced
     * (`transactionId` instead of `transactionID`, no `transactionReceipt`), hence the optionals.
     */
    interface Transaction {
      /** Display name of the user who used Bits. */
      displayName: string;
      /** "current_user" on the initiating viewer's machine, "other" everywhere else (broadcast products). */
      initiator: 'current_user' | 'other';
      product: Product;
      /** "twitch.ext." + extension ID. */
      domainID?: string;
      transactionID?: string;
      /** Seen in loopback mode instead of transactionID. */
      transactionId?: string;
      /** Twitch user ID of the user who used Bits. */
      userId: string;
      /**
       * JWT receipt signed with your extension secret (HS256). Send it to your EBS and VERIFY it before
       * granting anything. Absent in loopback/test transactions.
       */
      transactionReceipt?: string;
    }
    /** Products for this extension (released versions: only non-inDevelopment). Rejects where Bits unsupported. */
    function getProducts(): Promise<Product[]>;
    /** Start the Twitch Bits confirmation dialog for `sku`. */
    function useBits(sku: string): void;
    /** Fired when a transaction completes (for the initiator, or all viewers if the product broadcasts). */
    function onTransactionComplete(callback: (transaction: Transaction) => void): void;
    /** Fired when the user cancels / dismisses the dialog or useBits fails. */
    function onTransactionCancelled(callback: () => void): void;
    /** true = do not call live services; loop back to onTransactionComplete after a fixed delay (testing). */
    function setUseLoopback(useLoopback: boolean): void;
    /** Show the viewer's Bits balance for 1.5 s (call on product hover). Ignored on mobile. */
    function showBitsBalance(): void;
  }

  // ───────────────────────────── Helper: Viewer ─────────────────────────────

  interface SubscriptionStatus {
    /** "1000" | "2000" | "3000" (tier 1/2/3). */
    tier: '1000' | '2000' | '3000' | (string & {}) | null;
  }

  /**
   * Convenience info about the current viewer. NOT validated — use it for UI only; send `sessionToken`
   * to your EBS for anything privileged.
   */
  interface Viewer {
    /** Opaque ID ("U…" logged in, "A…" anonymous). */
    readonly opaqueId: string;
    /** Real Twitch user ID, or null if the viewer has not shared identity. */
    readonly id: string | null;
    /** Role, see JWT schema. */
    readonly role: Role | (string & {});
    /** Has the viewer shared their identity with this extension? */
    readonly isLinked: boolean;
    /** Encoded JWT — same as `Authorized.token`. */
    readonly sessionToken: string;
    /** Helix JWT — same as `Authorized.helixToken`. */
    readonly helixToken: string;
    /** Subscription to this channel; null if not subbed, not linked, or capability disabled. */
    readonly subscriptionStatus: SubscriptionStatus | null;
    /** Called when viewer status changes (e.g., subscribes, links identity). */
    onChanged(callback: () => void): void;
  }

  const viewer: Viewer;

  /**
   * @deprecated Developer Rig is decommissioned (end of support Jan 2023). Kept only for old code.
   */
  const rig: { log(message: string): void } | undefined;
}

/** Client query parameters appended to every extension iframe URL (all strings in the URL). */
interface TwitchExtQueryParams {
  /** Only when platform=web. */
  anchor?: 'component' | 'panel' | 'video_overlay';
  language?: string;
  locale?: string;
  mode?: 'config' | 'dashboard' | 'viewer';
  platform?: 'mobile' | 'web';
  popout?: 'true' | 'false';
  state?:
    | 'testing'
    | 'hosted_test'
    | 'approved'
    | 'released'
    | 'ready_for_review'
    | 'in_review'
    | 'pending_action'
    | 'uploading';
}

interface Window {
  Twitch: typeof Twitch;
}
