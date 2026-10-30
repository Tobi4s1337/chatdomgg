<!-- source: https://dev.twitch.tv/docs/embed/ -->

Contents

# Embedding Twitch in Your Website  {#embedding-twitch-in-your-website}

## Introduction  {#introduction}

You can embed Twitch functionality in your website in three ways:

- [Embedding Everything](/docs/embed/everything/) explains how to embed both the video player and Twitch Chat for live content or video on demand in one iframe. This includes the functionality for follow, subscribe, and login.
- [Embedding Chat](/docs/embed/chat/) explains how to embed just Twitch Chat.
- [Embedding Video and Clips](/docs/embed/video-and-clips/) explains how to embed just the video player, including Clips.

## Embedded Experiences Requirements  {#embedded-experiences-requirements}

The use of any Twitch embeddable experience must comply with the requirements below and the Twitch Developer Services Agreement. Twitch may revoke embed usage for domains that are not in compliance. Twitch reserves the right to revoke your ability to use our embeddable experiences, for any reason, at any time.

1.1 Domains that use Twitch embeds must use SSL certificates.

1.2 Twitch requires our embed users to verify where they use our products on the web using a special parameter: `parent`. Depending on your integration method, you may provide this as a query parameter in an iframe `src` attribute, or as a property on the JavaScript object you use to construct a new Twitch embed. For more information, see the embed API documentation above and our initial announcement of the requirement. Embed domains that don’t specify this parameter will trigger a playback error message that will direct end users to click through to Twitch if they wish to watch that content.

1.3 Embeds must utilize only Twitch-approved player elements and should not be obscured in any way by other page elements in whatever domain context they may appear. Certain features, such as the ability to send chat messages, may be disabled if the iframe is obscured or not visible.

1.4 Embeds must adhere to the minimum height and width requirements outlined in their respective attribute tables.

## Providing Feedback  {#providing-feedback}

We’re constantly trying to improve the developer experience, so if you encounter any difficulty using Twitch embed, please provide feedback via [Embed Feedback](https://link.twitch.tv/embed-feedbackform).

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
