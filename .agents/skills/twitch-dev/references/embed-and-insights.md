# Embedding Twitch on websites + Insights/analytics

Official: `references/official/embed.md`, `embed_everything.md`, `embed_chat.md`, `embed_video-and-clips.md`, `insights.md`.

## Embeds — rules that apply to all
- Your page must be served over **HTTPS** (localhost works for dev).
- **`parent` is mandatory** for iframe embeds: the domain(s) the embed is shown on, *hostname only*
  (no scheme/port/path): `parent=localhost`, `parent=myapp.example.com`. Repeat for every domain
  (`&parent=a.com&parent=b.com`). Missing/wrong parent → playback error asking users to watch on Twitch.
  For the JS embeds, pass `parent: ['a.com', 'b.com']` when your page is itself embedded elsewhere.
- Minimum size **400×300** (player/everything/clips); don't obscure the embed with other elements (some
  features, e.g. sending chat, get disabled if obscured). Autoplay needs the minimum size + visibility and never
  happens on mobile without user interaction. Embeds need no OAuth — users log in to Twitch inside the iframe.
- Embedding is for **websites/dashboards**, not for OBS overlays (the stream already *is* the video).

## Snippets
```html
<!-- Live player (non-interactive iframe). channel=… | video=v123456 | collection=… ; muted/autoplay/time optional -->
<iframe src="https://player.twitch.tv/?channel=twitchdev&parent=localhost&parent=myapp.example.com&muted=true"
        width="1280" height="720" allowfullscreen></iframe>

<!-- Chat only (read + write for logged-in users) -->
<iframe src="https://www.twitch.tv/embed/twitchdev/chat?parent=localhost" width="350" height="500"></iframe>

<!-- Clip -->
<iframe src="https://clips.twitch.tv/embed?clip=<slug>&parent=localhost" width="640" height="360" allowfullscreen></iframe>

<!-- Everything (video + chat) with the JS API -->
<div id="twitch-embed"></div>
<script src="https://embed.twitch.tv/embed/v1.js"></script>
<script>
  const embed = new Twitch.Embed('twitch-embed', { width: 854, height: 480, channel: 'twitchdev', layout: 'video-with-chat', parent: ['myapp.example.com'] });
  embed.addEventListener(Twitch.Embed.VIDEO_READY, () => embed.getPlayer().setVolume(0.5));
</script>

<!-- Interactive player only -->
<script src="https://player.twitch.tv/js/embed/v1.js"></script>
<div id="player"></div>
<script>
  const player = new Twitch.Player('player', { width: 854, height: 480, channel: 'twitchdev', autoplay: false, parent: ['myapp.example.com'] });
  player.addEventListener(Twitch.Player.READY, () => player.play());
</script>
```
"Everything" options: `allowfullscreen`, `autoplay` (default true), `channel`, `video`, `collection`, `height`
(min 300, default 480), `width` (min 400, default 940), `layout` (`video-with-chat` default for live channels |
`video`), `muted`, `parent`, `theme` (`light`|`dark`), `time` (`1h2m3s`). Events: `Twitch.Embed.VIDEO_READY`,
`VIDEO_PLAY`; `embed.getPlayer()` exposes the player API (play/pause/seek/setChannel/setVideo/setVolume/
setMuted/getCurrentTime/getPlaybackStats …, events `Twitch.Player.READY/PLAY/PLAYING/PAUSE/ENDED/ONLINE/OFFLINE/SEEK/CAPTIONS/PLAYBACK_BLOCKED`; `getCurrentTime` works for VODs only) —
see `references/official/embed_video-and-clips.md` for the full list.
Chat iframe with `sandbox`: must include `allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals`.

Vue/Nuxt tip: render embeds client-only (`<ClientOnly>`), compute `parent` from `location.hostname`, and
load the embed script once (e.g. `useHead({ script: [{ src: 'https://embed.twitch.tv/embed/v1.js' }] })`).
Use Helix Get Streams to show "LIVE/offline" state rather than waiting for the player.

## Insights & analytics (games and Extensions)
- **Extension analytics**: console → Extensions → *Download CSV* (one row per day since install; ~1-day
  delay, computed ~01:00 UTC), or Helix **Get Extension Analytics** (`analytics:read:extensions`) which
  returns a URL to the CSV. Fields include installs/uninstalls/activations, unique active channels, renders,
  views (≥75% visible), unique viewers, mouse-enters, clicks/interaction rate, minimizations, Bits revenue
  (developer share = Bits × 20% × $0.01) and Bits users. Unique counts are **device-ID** based (cookies ~14-day
  half-life) → 7/30-day uniques are inflated; clicks include false positives (clicking to reveal overlays).
  You may add Google Analytics to an Extension (twitch-extensions skill).
- **Game analytics**: Helix **Get Game Analytics** (`analytics:read:games`); requires being in the
  game's developer **organization**.
- New fields can be inserted anywhere in the CSV column order; parse by header name, not position.
- There is no general "channel analytics" API for streamers; derive metrics yourself from EventSub
  (followers/subs/cheers over time) and Helix (Get Streams `viewer_count`, Get Channel Followers `total`,
  Get Broadcaster Subscriptions `total`/`points`).
