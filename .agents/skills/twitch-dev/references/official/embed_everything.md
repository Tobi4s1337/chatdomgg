<!-- source: https://dev.twitch.tv/docs/embed/everything/ -->

Contents

# Embedding Everything  {#embedding-everything}

This guide explains how to embed video-on-demand content or live video with Twitch Chat on your website.

## Authentication  {#authentication}

Users of embedded Twitch are authenticated in the same way as the Twitch website and logging in is a seamless, lightweight experience. Logged-in users can chat, follow a channel, or subscribe to a channel. If a user attempts to perform one of these actions while not logged in, they will be prompted to log in or create a Twitch account.

## Overlays  {#overlays}

The Twitch embed contains buttons for Sign In, Follow, and Subscribe, in an overlay above the player.

In some cases, clicking a button opens a pop-up window that allows the user to complete the desired action (for example, navigate through the payment flow or create an account). In others, it automatically goes through with the action (such as Following).

The name of the channel being watched is an overlay that appears when you hover your mouse over the player. On embeds, these titles do not link back to Twitch.

## Usage  {#usage}

- Add a placeholder element with a unique ID to your page, where you want the Twitch embed to be displayed.
- Load the Twitch embed JavaScript file.
- Initialize a `Twitch.Embed` object, with the placeholder element ID and options. **If your site will be embedded on other domains, you must include them as a JavaScript array of strings under the `parent` key.**

```
<html>
  <body>
    <!-- Add a placeholder for the Twitch embed -->
    <div id="twitch-embed"></div>

    <!-- Load the Twitch embed JavaScript file -->
    <script src="https://embed.twitch.tv/embed/v1.js"></script>

    <!-- Create a Twitch.Embed object that will render within the "twitch-embed" element -->
    <script type="text/javascript">
      new Twitch.Embed("twitch-embed", {
        width: 854,
        height: 480,
        channel: "monstercat",
        // Only needed if this page is going to be embedded on other websites
        parent: ["embed.example.com", "othersite.example.com"]
      });
    </script>
  </body>
</html>

```

### Embed Parameters  {#embed-parameters}

| Option | Type | Description |
|---|---|---|
| `allowfullscreen` | boolean | If `true`, the player can go full screen. Default: `true`. |
| `autoplay` | boolean | If `true`, the video starts playing automatically, without the viewer clicking play. Minimum size requirements and visibility are necessary for autoplay to begin. The exception is mobile devices, on which video cannot be played without user interaction. Default: `true`. |
| `channel` | string | Name of the chat room and channel (live content only). |
| `collection` | string | The VOD collection to play. If used, an initial `video` from the VOD collection can be specified, otherwise playback will begin with the first video in the collection. All VODs are auto-played. Chat replay is not supported. Example parameters object: `{ video: "124085610", collection: "GMEgKwTQpRQwyA" }` |
| `height` | number or string | Height of the rendered element, in pixels. This can be expressed as a percentage as well, by passing a string like `50%`. Minimum: 300. Default: 480. |
| `layout` | string | Determines the screen layout. Valid values:<ul><li>`video-with-chat`: Default if `channel` is provided, and only supported for live content. Shows both video and chat side-by-side. At narrow sizes, chat renders under the video player.</li><li>`video`: Default if `channel` is not provided. Shows only the video player (omits chat).</li></ul> |
| `muted` | boolean | Specifies whether the initial state of the video is muted. Default: `false`. |
| `parent` | string[] | Required if your site is embedded on any domain(s) other than the one that instantiates the Twitch embed.Example `parent` parameter: `["streamernews.example.com", "embed.example.com"]`. |
| `theme` | string | The Twitch embed color theme to use. Valid values: `light` or `dark`. Default: `dark`. |
| `time` | string | Time in the video where playback starts. Specifies hours, minutes, and seconds. Default: `0h0m0s` (the start of the video). |
| `video` | string | ID of a VOD to play. Chat replay is not supported. |
| `width` | number or string | Width of the rendered element, in pixels. This can be expressed as a percentage as well, by passing a string like `100%`. Minimum: 400. Default: 940. |

### Working with Events  {#working-with-events}

To listen to events, create a `Twitch.Embed` object, then call the `addEventListener` method on that object:

```
var embed = new Twitch.Embed('twitch-embed', {
  channel: 'monstercat'
});

embed.addEventListener(Twitch.Embed.VIDEO_READY, function() {
  console.log('The video is ready');
});

```

### Available Events  {#available-events}

| Event | Description |
|---|---|
| `Twitch.Embed.VIDEO_PLAY` | The video started playing. This callback receives an object with a `sessionId` property. |
| `Twitch.Embed.VIDEO_READY` | The video player is ready for API commands. |

## Programmatic Access  {#programmatic-access}

To provide additional functionality to our API, access specific components with `getPlayer()`, which retrieves the current video player instance from the embed and provides full programmatic access to the [video player API](/docs/embed/video-and-clips#interactive-frames-for-live-streams-and-vods).

```
<html>
  <body>
    <!-- Add a placeholder for the Twitch embed -->
    <div id="twitch-embed"></div>

    <!-- Load the Twitch embed script -->
    <script src="https://embed.twitch.tv/embed/v1.js"></script>

    <!-- Create a Twitch.Embed object that will render within the "twitch-embed" element. -->
    <script type="text/javascript">
      var embed = new Twitch.Embed("twitch-embed", {
        width: 854,
        height: 480,
        channel: "monstercat",
        layout: "video",
        autoplay: false,
        // Only needed if this page is going to be embedded on other websites
        parent: ["embed.example.com", "othersite.example.com"]
      });

      embed.addEventListener(Twitch.Embed.VIDEO_READY, () => {
        var player = embed.getPlayer();
        player.play();
      });
    </script>
  </body>
</html>

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
