<!-- source: https://dev.twitch.tv/docs/eventsub/websocket-reference/ -->

Contents

# WebSocket Messages  {#websocket-messages}

This section defines the messages that the EventSub WebSocket server sends your client.

**NOTE** All timestamps are in RFC3339 format and use nanoseconds instead of milliseconds.

## Welcome message  {#welcome-message}

Defines the first message that the EventSub WebSocket server sends after your client connects to the server. [Read More](/docs/eventsub/handling-websocket-events#welcome-message)

| Field | Type | Description |
|---|---|---|
| metadata | Object | An object that identifies the message. |
| message_id | String | An ID that uniquely identifies the message. Twitch sends messages at least once, but if Twitch is unsure of whether you received a notification, it’ll resend the message. This means you may receive a notification twice. If Twitch resends the message, the message ID will be the same. |
| message_type | String | The type of message, which is set to **session_welcome**. |
| message_timestamp | String | The UTC date and time that the message was sent. |
| payload | Object | An object that contains the message. |
| session | Object | An object that contains information about the connection. |
| id | String | An ID that uniquely identifies this WebSocket connection. Use this ID to set the `session_id` field in all [subscription requests](/docs/eventsub/manage-subscriptions#subscribing-to-events). |
| status | String | The connection’s status, which is set to **connected**. |
| keepalive_timeout_seconds | Integer | The maximum number of seconds that you should expect silence before receiving a keepalive message. For a welcome message, this is the number of seconds that you have to [subscribe to an event](/docs/eventsub/manage-subscriptions#subscribing-to-events) after receiving the welcome message. If you don’t subscribe to an event within this window, the socket is disconnected. |
| reconnect_url | String | The URL to reconnect to if you get a Reconnect message. Is set to **null**. |
| connected_at | String | The UTC date and time that the connection was created. |

## Keepalive message  {#keepalive-message}

Defines the message that the EventSub WebSocket server sends your client to indicate that the WebSocket connection is healthy. [Read More](/docs/eventsub/handling-websocket-events#keepalive-message)

| Field | Type | Description |
|---|---|---|
| metadata | Object | An object that identifies the message. |
| message_id | String | An ID that uniquely identifies the message. Twitch sends messages at least once, but if Twitch is unsure of whether you received a notification, it’ll resend the message. This means you may receive a notification twice. If Twitch resends the message, the message ID is the same. |
| message_type | String | The type of message, which is set to **session_keepalive**. |
| message_timestamp | String | The UTC date and time that the message was sent. |
| payload | Object | An empty object. |

## Ping message  {#ping-message}

A standard WebSocket [Ping](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.2) frame. [Read More](/docs/eventsub/handling-websocket-events#ping-message)

## Notification message  {#notification-message}

Defines a message that the EventSub WebSocket server sends your client when an event that you subscribe to occurs. [Read More](/docs/eventsub/handling-websocket-events#notification-message)

| Field | Type | Description |
|---|---|---|
| metadata | Object | An object that identifies the message. |
| message_id | String | An ID that uniquely identifies the message. Twitch sends messages at least once, but if Twitch is unsure of whether you received a notification, it’ll resend the message. This means you may receive a notification twice. If Twitch resends the message, the message ID will be the same. |
| message_type | String | The type of message, which is set to **notification**. |
| message_timestamp | String | The UTC date and time that the message was sent. |
| subscription_type | String | The type of event sent in the message. |
| subscription_version | String | The version number of the subscription type’s definition. This is the same value specified in the subscription request. |
| payload | Object | An object that contains the message. |
| subscription | Object | An object that contains information about your subscription. |
| id | String | An ID that uniquely identifies this subscription. |
| status | String | The subscription’s status, which is set to **enabled**. |
| type | String | The type of event sent in the message. See the `event` field. |
| version | String | The version number of the subscription type’s definition. |
| cost | Integer | The event’s cost. See [Subscription limits](/docs/eventsub/manage-subscriptions#subscription-limits). |
| condition | Object | The conditions under which the event fires. For example, if you requested notifications when a broadcaster gets a new follower, this object contains the broadcaster’s ID. For information about the condition’s data, see the subscription type’s description in [Subscription types](/docs/eventsub/eventsub-subscription-types). |
| transport | Object | An object that contains information about the transport used for notifications. |
| method | String | The transport method, which is set to **websocket**. |
| session_id | String | An ID that uniquely identifies the WebSocket connection. |
| created_at | String | The UTC date and time that the subscription was created. |
| event | Object | The event’s data. For information about the event’s data, see the subscription type’s description in [Subscription Types](/docs/eventsub/eventsub-subscription-types). |

## Reconnect message  {#reconnect-message}

Defines the message that the EventSub WebSocket server sends if the server must drop the connection. [Read More](/docs/eventsub/handling-websocket-events#reconnect-message)

| Field | Type | Description |
|---|---|---|
| metadata | Object | An object that identifies the message. |
| message_id | String | An ID that uniquely identifies the message. Twitch sends messages at least once, but if Twitch is unsure of whether you received a notification, it’ll resend the message. This means you may receive a notification twice. If Twitch resends the message, the message ID will be the same. |
| message_type | String | The type of message, which is set to **session_reconnect**. |
| message_timestamp | String | The UTC date and time that the message was sent. |
| payload | Object | An object that contains the message. |
| session | Object | An object that contains information about the connection. |
| id | String | An ID that uniquely identifies this WebSocket connection. |
| status | String | The connection’s status, which is set to **reconnecting**. |
| keepalive_timeout_seconds | Integer | Is set to **null**. |
| reconnect_url | String | The URL to reconnect to. Use this URL as is; do not modify it. The connection automatically includes the subscriptions from the old connection. |
| connected_at | String | The UTC date and time when the connection was created. |

## Revocation message  {#revocation-message}

Defines the message that the EventSub WebSocket server sends if the user no longer exists or they revoked the authorization token that the subscription relied on. [Read More](/docs/eventsub/handling-websocket-events#revocation-message)

| Field | Type | Description |
|---|---|---|
| metadata | Object | An object that identifies the message. |
| message_id | String | An ID that uniquely identifies the message. Twitch sends messages at least once, but if Twitch is unsure of whether you received a notification, it’ll resend the message. This means you may receive a notification twice. If Twitch resends the message, the message ID will be the same. |
| message_type | String | The type of message, which is set to **revocation**. |
| message_timestamp | String | The UTC date and time that the message was sent. |
| subscription_type | String | The type of event sent in the message. |
| subscription_version | String | The version number of the subscription type's definition. This is the same value specified in the subscription request. |
| payload | Object | An object that contains the message. |
| subscription | Object | An object that contains information about your subscription. |
| id | String | An ID that uniquely identifies this subscription. |
| status | String | The subscription's status. The following are the possible values:  - authorization_revoked — The user in the condition object revoked the authorization that let you get events on their behalf. - user_removed — The user in the condition object is no longer a Twitch user. - version_removed — The subscribed to subscription type and version is no longer supported. |
| type | String | The type of event sent in the message. |
| version | String | The version number of the subscription type's definition. |
| cost | Integer | The event's cost. See [Subscription limits](/docs/eventsub/manage-subscriptions#subscription-limits). |
| condition | Object | The conditions under which the event fires. For example, if you requested notifications when a broadcaster gets a new follower, this object contains the broadcaster’s ID. For information about the condition's data, see the subscription type's description in [Subscription Types](/docs/eventsub/eventsub-subscription-types). |
| transport | Object | An object that contains information about the transport used for notifications. |
| method | String | The transport method, which is set to **websocket**. |
| session_id | String | An ID that uniquely identifies the WebSocket connection. |
| created_at | String | The UTC date and time that the subscription was created. |

## Close message  {#close-message}

A standard WebSocket [Close](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.1) frame. [Read More](/docs/eventsub/handling-websocket-events#close-message)

The following table lists the reasons for closing the connection.

| Code | Reason | Notes |
|---|---|---|
| 4000 | Internal server error | Indicates a problem with the server (similar to an HTTP 500 status code). |
| 4001 | Client sent inbound traffic | Sending outgoing messages to the server is prohibited with the exception of pong messages. |
| 4002 | Client failed ping-pong | You must respond to ping messages with a pong message. See Ping message. |
| 4003 | Connection unused | When you connect to the server, you must create a subscription within 10 seconds or the connection is closed. The time limit is subject to change. |
| 4004 | Reconnect grace time expired | When you receive a **session_reconnect** message, you have 30 seconds to reconnect to the server and close the old connection. See Reconnect message. |
| 4005 | Network timeout | Transient network timeout. |
| 4006 | Network error | Transient network error. |
| 4007 | Invalid reconnect | The reconnect URL is invalid. |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
