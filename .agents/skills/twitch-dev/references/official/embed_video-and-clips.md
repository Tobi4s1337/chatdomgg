<!-- source: https://dev.twitch.tv/docs/embed/video-and-clips/ -->

Contents

# Embedding Video and Clips  {#embedding-video-and-clips}

You can embed live streams, video on demand (VOD), and clips in a website. Embedded video windows must be at least 400x300 pixels.

There are three types of VODs:

- Past broadcasts are created automatically from a live stream.
- Highlights can be created by broadcasters from past broadcasts.
- Uploads are external videos that are added to Twitch using the Video Uploads API or the Video Manager.

This guide discusses three techniques for embedding video and clips

- Embedding live streams and VODs in a non-interactive frame.
- Embedding live streams and VODs in an interactive iframe.
- Embedding clips in a non-interactive frame.

For more information, see [Video on Demand](https://help.twitch.tv/s/article/video-on-demand) and [How to Use Clips](https://help.twitch.tv/s/article/how-to-use-clips).

## Non-Interactive Inline Frames for Live Streams and VODs  {#non-interactive-inline-frames-for-live-streams-and-vods}

```
<iframe
    src="https://player.twitch.tv/?<channel, video, or collection>&parent=streamernews.example.com"
    height="<height>"
    width="<width>"
    allowfullscreen>
</iframe>

```

### Iframe Attributes  {#iframe-attributes}

These attributes are defined in the IFrame element. The Twitch player can not set or modify them.

| Name | Type | Description |
|---|---|---|
| `allowfullscreen` | boolean | A boolean attribute set by inclusion. In other words, including the attribute enables fullscreen viewing while excluding the attribute ensures fullscreen viewing is not allowed. |
| `height` | number or string | Height of the embedded window, in pixels. This can be expressed as a percentage as well, by passing a string like `100%`. Minimum: 300 |
| `parent` | string | **Required.** Domain(s) that will be embedding Twitch. You must have one parent key for each domain your site uses. |
| `src` | string | The iframe `src` URL string should be https://player.twitch.tv/ with one of these required query string parameters:  `channel` – (string) Name of the channel, for a live stream.  `video` – (string) Video ID (for past broadcasts, highlights, and video uploads). In this context (the video player), the video ID must have a “v” prefix.  `collection` - (string) Collection ID, for a collection of videos.  If both `video` and `collection` are specified, the specified collection starts playing from the specified video. If the video is not in the collection, `collection` is ignored and the specified video is played.  If `channel` is specified along with `video` and/or `collection`, only `channel` is used. |
| `width` | number or string | Width of the embedded window, in pixels. This can be expressed as a percentage as well, by passing a string like `50%`. Minimum: 400 |

### Optional Query String Parameters on Iframe src  {#optional-query-string-parameters-on-iframe-src}

| Name | Type | Description |
|---|---|---|
| `autoplay` | boolean | If `true`, the video starts playing automatically, without the viewer clicking play. Minimum size requirements and visibility are necessary for autoplay to begin. The exception is mobile devices, on which video cannot be played without user interaction. Default: `true`. |
| `muted` | boolean | Specifies whether the initial state of the video is muted. Default: `false`. |
| `time` | 1h2m3s | Time in the video where playback starts. Specifies hours, minutes, and seconds. Default: `0h0m0s` (the start of the video). |

### Video Metadata  {#video-metadata}

Video information such as duration, view count, and associated Twitch channel is available via the [Get Videos](/docs/api/reference#get-videos) API endpoint.

### Examples  {#examples}

Using a channel name:

```
<iframe
    src="https://player.twitch.tv/?channel=dallas&parent=streamernews.example.com&muted=true"
    height="720"
    width="1280"
    allowfullscreen>
</iframe>

```

Using a video ID:

```
<iframe
    src="https://player.twitch.tv/?video=v40464143&parent=streamernews.example.com&autoplay=false"
    height="720"
    width="1280"
    allowfullscreen>
</iframe>

```

Using a collection ID:

```
<iframe
    src="https://player.twitch.tv/?collection=abcDeF1ghIJ2kL&parent=streamernews.example.com"
    height="720"
    width="1280"
    allowfullscreen>
</iframe>

```

## Interactive Frames for Live Streams and VODs  {#interactive-frames-for-live-streams-and-vods}

```
<script src= "https://player.twitch.tv/js/embed/v1.js"></script>
<div id="<player div ID>"></div>
<script type="text/javascript">
  var options = {
    width: <width>,
    height: <height>,
    channel: "<channel ID>",
    video: "<video ID>",
    collection: "<collection ID>",
    // only needed if your site is also embedded on embed.example.com and othersite.example.com
    parent: ["embed.example.com", "othersite.example.com"]
  };
  var player = new Twitch.Player("<player div ID>", options);
  player.setVolume(0.5);
</script>

```

### Required Parameters  {#required-parameters}

| Name | Type | Description |
|---|---|---|
| `channel` – OR – `video` – OR – `collection` | string | Channel name (for a live stream), video ID, or collection ID. (To change the channel or video later, use `setChannel`, `setVideo`, or `setCollection`; see Synchronous Playback Controls.)  If both `video` and `collection` are specified, the specified collection starts playing from the specified video. If the video is not in the collection, `collection` is ignored and the specified video is played.  If `channel` is specified along with `video` and/or `collection`, only `channel` is used. |
| `height` | number or string | Height of the embedded window, in pixels. Can be expressed as a percentage as well, by passing a string like `100%`. Minimum: 300. |
| `parent` | string[] | Only required if your site is embedded on any domain(s) other than the one that instantiates the Twitch embed. Example `parent` parameter: `["streamernews.example.com", "embed.example.com"]` |
| `player div ID` | string | Any value you like, as long as it is the same in both locations within the example. |
| `width` | number or string | Width of the embedded window, in pixels. Can be expressed as a percentage as well, by passing a string like `50%`. Minimum: 400. |

### Optional Parameters  {#optional-parameters}

| Name | Type | Description |
|---|---|---|
| `autoplay` | boolean | If `true`, the video starts playing automatically, without the viewer clicking play. Minimum size requirements and visibility are necessary for autoplay to begin. The exception is mobile devices, on which video cannot be played without user interaction. Default: `true`. |
| `muted` | boolean | Specifies whether the initial state of the video is muted. Default: `false`. |
| `time` | string | Only valid for Video on Demand content. Time in the video where playback starts. Specifies hours, minutes, and seconds. Default: `0h0m0s` (the start of the video). |

### Synchronous JavaScript Playback API  {#synchronous-javascript-playback-api}

| Call | Description |
|---|---|
| `disableCaptions():void` | Disables display of Closed Captions. |
| `enableCaptions():void` | Enables display of Closed Captions. Note captions will only display if they are included in the video content being played. See the CAPTIONS JavaScript Event for more info. |
| `pause():void` | Pauses the player. |
| `play():void` | Begins playing the specified video. |
| `seek(timestamp:Float):void` | Seeks to the specified `timestamp` (in seconds) in the video. Does not work for live streams. |
| `setChannel(channel:String):void` | Sets the channel to be played. |
| `setCollection(collection ID:String, video ID:String):void` | Sets the collection to be played.  Optionally also specifies the video within the collection, from which to start playback. If a video ID is not provided here or the specified video is not part of the collection, playback starts with the first video in the collection. |
| `setQuality(quality:String):void` | Sets the quality of the video. `quality` should be a string value returned by `getQualities`. |
| `setVideo(video ID:String, timestamp:Number):void` | Sets the video to be played to be played and starts playback at `timestamp` (in seconds). |

### Synchronous JavaScript Volume API  {#synchronous-javascript-volume-api}

| Call | Description |
|---|---|
| `getMuted():Boolean` | Returns `true` if the player is muted; otherwise, `false`. |
| `setMuted(muted:Boolean):void` | If `true`, mutes the player; otherwise, unmutes it. This is independent of the volume setting. |
| `getVolume():Float` | Returns the volume level, a value between 0.0 and 1.0. |
| `setVolume(volumelevel:Float):void` | Sets the volume to the specified volume level, a value between 0.0 and 1.0. |

### Synchronous JavaScript Status API  {#synchronous-javascript-status-api}

| Call | Description |
|---|---|
| `getPlaybackStats():PlaybackStats` | Returns an object with statistics on the embedded video player and the current live stream or VOD. See below for more info. |
| `getChannel():String` | Returns the channel’s name. Works only for live streams, not VODs. |
| `getCurrentTime():Float` | Returns the current video’s timestamp, in seconds. Works only for VODs, not live streams. |
| `getDuration():Float` | Returns the duration of the video, in seconds. Works only for VODs,not live streams. |
| `getEnded():Boolean` | Returns true if the live stream or VOD has ended; otherwise, false. |
| `getQualities():String[]` | Returns the available video qualities. For example, `chunked` (pass-through of the original source). |
| `getQuality():String` | Returns the current quality of video playback. |
| `getVideo():String` | Returns the video ID. Works only for VODs, not live streams. |
| `isPaused():Boolean` | Returns true if the video is paused; otherwise, false. Buffering or seeking is considered playing. |

#### PlaybackStats Object attributes  {#playbackstats-object-attributes}

| Name | Type | Description |
|---|---|---|
| `backendVersion` | string | The version of the Twitch video player backend. |
| `bufferSize` | number | The size of the video buffer in seconds. |
| `codecs` | string | Codecs currently in use, comma-separated (video,audio). |
| `displayResolution` | string | The current size of the video player element (eg. 850x480). |
| `fps` | number | The video playback rate in frames per second. Not available on all browsers. |
| `hlsLatencyBroadcaster` | number | Current latency to the broadcaster in seconds. Only available for live content. |
| `playbackRate` | number | The playback bitrate in Kbps. |
| `skippedFrames` | number | The number of dropped frames. |
| `videoResolution` | string | The native resolution of the current video (eg. 640x480). |

### JavaScript Events  {#javascript-events}

To listen to events, call `addEventListener(event:String, callback:Function)`.

| Event | Emitted when … |
|---|---|
| `Twitch.Player.CAPTIONS` | Closed captions are found in the video content being played. This event will be emitted once for each new batch of captions, in sync with the corresponding video content. The event payload is a string containing the caption content. |
| `Twitch.Player.ENDED` | Video or stream ends. |
| `Twitch.Player.PAUSE` | Player is paused. Buffering and seeking is not considered paused. |
| `Twitch.Player.PLAY` | Player just unpaused, will either start video playback or start buffering. |
| `Twitch.Player.PLAYBACK_BLOCKED` | Player playback was blocked. Usually fired after an unmuted autoplay or unmuted programmatic call on `play()`. |
| `Twitch.Player.PLAYING` | Player started video playback. |
| `Twitch.Player.OFFLINE` | Loaded channel goes offline. |
| `Twitch.Player.ONLINE` | Loaded channel goes online. |
| `Twitch.Player.READY` | Player is ready to accept function calls. |
| `Twitch.Player.SEEK` | User has used the player controls to seek a VOD, the seek() method has been called, or live playback has seeked to sync up after being paused. |

### Example  {#example}

```
<script src= "https://player.twitch.tv/js/embed/v1.js"></script>
<div id="SamplePlayerDivID"></div>
<script type="text/javascript">
  var options = {
    width: 854,
    height: 480,
    channel: "twitchdev",
    // Only needed if this page is going to be embedded on other websites
    parent: ["embed.example.com", "othersite.example.com"]
  };
  var player = new Twitch.Player("SamplePlayerDivID", options);
  player.setVolume(0.5);
</script>

```

## Non-Interactive IFrames for Clips  {#non-interactive-iframes-for-clips}

Embedding a Clip is different than embedding a live stream or VOD. The embedded Clips player uses a different set of query parameters and does not support the JavaScript interactive embed.

IFrame Prototype

```
<iframe
    src="https://clips.twitch.tv/embed?clip=<slug>&parent=streamernews.example.com"
    height="<height>"
    width="<width>"
    allowfullscreen>
</iframe>

```

### Iframe Attributes  {#iframe-attributes-1}

| Name | Type | Description |
|---|---|---|
| `allowfullscreen` | boolean | A boolean attribute set by inclusion. In other words, including the attribute enables fullscreen viewing while excluding the attribute ensures fullscreen viewing is not allowed. |
| `clip` | string | A globally unique string called a slug, by which clips are referenced. |
| `height` | number or string | Height of the embedded window, in pixels. This can be expressed as a percentage as well, by passing a string like `50%`. Minimum: 300. |
| `parent` | string | **Required.** Domain(s) that will be embedding Twitch. You must have one parent key for each domain your site uses. |
| `preload` | enum | A hint to the browser about what the developer thinks will lead to the best user experience. Valid values:  `none` - The video should not be preloaded.  `metadata` - Only video metadata (e.g., length) is fetched. This is the recommended value.  `auto` - The whole video file could be downloaded, even if the user is not expected to use it.  `""` (empty string) - Same as `auto`.  Default: browser-defined.  The HTML specification does not force the browser to follow the value of this attribute; it is merely a hint. |
| `width` | number or string | Width of the embedded window, in pixels. This can be expressed as a percentage as well, by passing a string like `50%`. Minimum: 400. |

### Optional IFrame Query Parameters  {#optional-iframe-query-parameters}

| Name | Type | Description |
|---|---|---|
| `autoplay` | boolean | If `true`, the video starts playing automatically, without the viewer clicking play. Minimum size requirements and visibility are necessary for autoplay to begin. The exception is mobile devices, on which video cannot be played without user interaction. Default: `false`. |
| `muted` | boolean | Specifies whether the initial state of the video is muted. Default: `false`. |

### Example  {#example-1}

```
<iframe
   src="https://clips.twitch.tv/embed?clip=IncredulousAbstemiousFennelImGlitch&parent=streamernews.example.com&parent=embed.example.com"
   height="360"
   width="640"
   allowfullscreen>
</iframe>

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
