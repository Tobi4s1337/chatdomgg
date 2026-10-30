<!-- source: https://dev.twitch.tv/docs/product-lifecycle/ -->

Contents

# Product Lifecycle  {#product-lifecycle}

This page provides the current lifecycle status of our developer products and services.

## Important Dates  {#important-dates}

| Date | Upcoming Change |
|---|---|
| [2025‑02‑10](https://discuss.dev.twitch.com/t/legacy-pubsub-deprecation-and-shutdown-timeline/58043) | PubSub shutdown timeline begins. |
| [2025‑04‑14](https://discuss.dev.twitch.com/t/legacy-pubsub-deprecation-and-shutdown-timeline/58043) | Permanent shutdown of legacy PubSub. |
| [2025‑08‑15](https://discuss.dev.twitch.com/t/decommission-of-non-secure-websocket-connections-to-twitch-irc-servers/64142) | Non-secure WebSocket connections to Twitch IRC servers is decommissioned. |
| [2025‑12‑04](https://discuss.dev.twitch.com/t/legacy-get-hype-train-events-api-and-eventsub-hype-train-v1-subscription-types-deprecation-and-withdrawal-timeline/64299) | “Get Hype Train Events” API endpoint and V1 of the Hype Train EventSub subscription types are decommissioned. |

## API Endpoint and Subscription Classifications  {#api-endpoint-and-subscription-classifications}

| **Tag** | **Description** |
|---|---|
| NEW | Functionality that has been recently released. |
| DEPRECATED | Functionality that has been recently deprecated and is on a path to be decommissioned (i.e. shut down). Links to announcements regarding the deprecation plan are usually included to understand actions that may be necessary to limit disruption. |
| BETA | Functionality that is considered to be in public beta. This may be new functionality, or a new version of existing functionality. Developers may use these products in production environments with the understanding that all aspects of the functionality, including query parameters and response structures, are subject to change without notice. While changes are usually communicated, it is not always a guarantee based on the necessity of the change while in beta. If an unannounced breaking change would cause a significant impact to your users, consider waiting until the product is out of beta and generally available. While exploring this functionality, we encourage developers to provide feedback in the [UserVoice Developer Forum](https://twitch.uservoice.com/forums/310213-developers).   Unless otherwise noted, EventSub subscriptions that were released as a public beta will be available for 30 days after their generally available version is released. Subscriptions should be updated to the new version (v1, v2, etc.) during this timeframe. Any active beta subscriptions beyond 30 days will be automatically deleted. |

## Product Status Definitions  {#product-status-definitions}

Developer products and services can be in one of the three statuses. This table provides context for the availability of a product or service given its current status.

| **Status** | **Availability** | **Maintenance** | **Notification** |
|---|---|---|---|
| Active | Live in production. | Actively maintained with bug and security fixes. New features may be added. | An announcement is posted when a new product or product feature is available. [Changelog](/docs/change-log) is updated. |
| Deprecated | Live in production. | Only major bug and security fixes are made. New features are not added. | An announcement is posted when a product or product feature is deprecated. Direct emails may be sent to developers. [Changelog](/docs/change-log) is updated. Decommission and shutdown plan will be announced at time of deprecation or at a later date. |
| Decommissioned | No longer available in production. | Service is no longer maintained. | Previous announcements may be updated. Further announcements and emails are possible. |

## Current Product Status  {#current-product-status}

| Product | Status | Note |
|---|---|---|
| Authentication | Active | Includes OIDC, user access, and app access token |
| Chat (IRC) | Active | Non-secure websocket connections specifically have been decommissioned in August 2025 |
| Drops | Active |  |
| Embedding Twitch | Active | Includes embedding Chat, Video/Clips, and “Everything” |
| Extensions | Active |  |
| EventSub | Active |  |
| EventSub: Webhooks | Active |  |
| EventSub: WebSockets | Active |  |
| EventSub: Conduits | Active |  |
| Game Engine Plugins | Active |  |
| Insights & Analytics | Active |  |
| Mobile Deep Links | Active |  |
| Twitch API | Active |  |
| Twitch CLI | Active |  |
| PubSub | Deprecated | [Legacy PubSub deprecation and shutdown timeline](https://discuss.dev.twitch.com/t/legacy-pubsub-deprecation-and-shutdown-timeline/58043) |
| Twitch Developer Rig | Decommissioned | End of support in January 2023 |
| Enhanced Experiences | Decommissioned | Decommissioned in April 2022 |
| Twitch API: v5 | Decommissioned | Decommissioned in February 2022 |
| WebSub-based webhooks | Decommissioned | Decommissioned in September 2021 |
| Create and Delete Follows API Endpoints | Decommissioned | Decommissioned in July 2021 |
| Quarterly Insights Reports | Decommissioned | Decommissioned in April 2021 |
| Legacy Drops | Decommissioned | Decommissioned in March 2021 |
| Chat rooms | Decommissioned | Decommissioned in January 2020 |
| Twitch API: v3 | Decommissioned | Decommissioned in September 2019 |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
