<!-- source: https://dev.twitch.tv/docs/embed/chat/ -->

Contents

# Embedding Chat  {#embedding-chat}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

## Usage  {#usage}

Use the following HTML template to embed a Twitch chat window on your website. The parameters to configure the chat window are described below.

```
<iframe src="https://www.twitch.tv/embed/<channel>/chat?parent=<parent>"
        height="<height>"
        width="<width>">
</iframe>

```

## Parameters  {#parameters}

| Name | Required | Description |
|---|---|---|
| `src` | Yes | Chat embed URL. This defines which channel’s chat should be shown and the domain(s) where the embed is being placed.  `channel`: The channel name. `parent`: Domain(s) that will be embedding Twitch. Multiple parent parameters can be defined in the URL. A parent parameter is needed for each domain your site is hosted or embedded on. |
| `height` | No | Height of the chat window. This can be defined in pixels or as a percentage (e.g. `500` or `50%`). |
| `width` | No | Width of the chat window. This can be defined in pixels or as a percentage (e.g. `500` or `50%`). |
| `sandbox` | No | If specified, the following keywords must be included to ensure all Twitch features will function as expected: `allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals` |

## Example  {#example}

This example demonstrates how the chat for the TwitchDev channel can be embedded on this particular site.

### Source Code  {#source-code}

```
<iframe id="twitch-chat-embed"
        src="https://www.twitch.tv/embed/twitchdev/chat?parent=dev.twitch.tv"
        height="500"
        width="350">
</iframe>

```

### Result  {#result}

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
