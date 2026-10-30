<!-- source: https://dev.twitch.tv/docs/api/ -->

Contents

# Twitch API  {#twitch-api}

The Twitch API provides the tools and data used to develop Twitch integrations. The data models and systems are designed to provide relevant data in an easy, consistent, and reliable way. For the full list of endpoints that you can use in your integration, explore the [Twitch API Reference](/docs/api/reference/).

The Twitch API uses OAuth 2.0 for authentication. To learn about the different types of access tokens that the API supports, see [Authentication](/docs/authentication/). If you plan to use some of the extension-related endpoints, you’ll also need learn how to get JSON Web Tokens (JWT) (see [JSON Web Tokens](/docs/extensions/required-technical-background#json-web-tokens-jwts) and [Managing Extension Secrets](/docs/extensions/building#managing-extension-secrets)).

For information about using the APIs, see the following guides:

- [Starting a Poll](/docs/api/polls)
- [Starting a Prediction](/docs/api/predictions)
- [Starting a Raid](/docs/api/raids)
- [Creating Stream Clips](/docs/api/clips)
- [Creating Stream Markers](/docs/api/markers)
- [Getting Videos](/docs/api/videos)
- [Scheduling Broadcasts](/docs/api/schedule)
- [Moderating a Broadcaster’s Chat](/docs/api/moderation)
- [Getting a Creator’s Goals](/docs/api/goals)
- [Getting an Extension Analytics Report](/docs/insights#extension-developer-analytics)
- [Getting a Game Analytics Report](/docs/insights#game-developer-analytics)

You should also become familiar with the following features:

| Feature | Description |
|---|---|
| [EventSub](/docs/eventsub) | The Twitch API provides APIs that you can call to poll the status of a given resource. These APIs are fine if you need a snapshot of the resource but it’s recommended that you subscribe to receive resource updates instead. For information about subscribing to events, see [EventSub](/docs/eventsub) subscriptions. |
| [Command-line Interface](/docs/cli) | Twitch offers a command-line interface for managing Twitch resources. You can use it to call the Twitch endpoints, get an OAuth access token, and test EventSub events. |

## Next steps  {#next-steps}

Call your first Twitch API in minutes using [Getting started](/docs/api/get-started).

Thumb through Twitch API [Concepts](/docs/api/guide) to learn how Twitch [handles breaking changes](/docs/api/guide#breaking-changes), [pagination](/docs/api/guide#pagination), and [rate limits](/docs/api/guide#twitch-rate-limits).

Join our [community](https://link.twitch.tv/devchat) of Twitch developers! And for other ways to connect with the community, explore our [developer support](https://dev.twitch.tv/support) page.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
