<!-- source: https://dev.twitch.tv/docs/eventsub/handling-websocket-events/ -->

Contents

# Getting Events Using WebSockets  {#getting-events-using-websockets}

To connect to the EventSub WebSocket server, grab your favorite WebSocket client library and connect to `wss://eventsub.wss.twitch.tv/ws`.

You can optionally specify the `keepalive_timeout_seconds` query parameter to adjust the keepalive timeout. Valid values are whole integers between 10 and 600: e.g. `wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30`. Specifying an invalid, but numeric value will return the nearest acceptable value.

The following diagram shows the normal flow of messages.

The first message you receive after connecting to the server is a welcome message that contains the socket’s ID. You must use the ID when subscribing to events. Read More

After the Welcome message, you will receive any of the following messages:

- Notification message — A message that contains the event’s data. Read More
- Keepalive message — A message that indicates that the connection is healthy. Read More
- Reconnect message — A message that indicates that the EventSub WebSocket server requires the client to reconnect. Read More
- Revocation message — A message that contains the reason why Twitch revoked your subscription. Read More

The final message that you’ll receive is a close message. Read More

**NOTE** You should create one WebSocket connection until you have a reason to create another one. For limits on the number of WebSocket connections you can make and the number of subscriptions you can request per connection, see Subscription limits.

**IMPORTANT** The EventSub WebSocket server supports only outgoing messages. If you send a message to the server, except for Pong messages, the server closes the connection.

**NOTE** If a WebSocket connection is lost, you’ll need to resubscribe to the events after connecting to the server. There is no replay of events that are lost during the time it takes to establish a new connection and resubscribe to the events. To figure out which events to resubscribe to, see Which events is my WebSocket subscribed to? Losing the connection is different from receiving a reconnect message.

**NOTE** All timestamps are in RFC3339 format and use nanoseconds instead of milliseconds.

## Welcome message  {#welcome-message}

When you connect to `wss://eventsub.wss.twitch.tv/ws`, Twitch replies with a welcome message. The `message_type` field is set to **session_welcome**. This message contains the WebSocket session’s ID that you use when [subscribing to events](/docs/eventsub/manage-subscriptions#subscribing-to-events).

**IMPORTANT** By default, you have 10 seconds from the time you receive the Welcome message to subscribe to an event, unless otherwise specified when connecting. If you don’t subscribe within this timeframe, the server closes the connection.

The following example shows the text [Data](https://datatracker.ietf.org/doc/html/rfc6455#section-5.6) frame for a welcome message. For a description of the fields, see [WebSocket Reference](/docs/eventsub/websocket-reference#welcome-message).

```
{
  "metadata": {
    "message_id": "96a3f3b5-5dec-4eed-908e-e11ee657416c",
    "message_type": "session_welcome",
    "message_timestamp": "2023-07-19T14:56:51.634234626Z"
  },
  "payload": {
    "session": {
      "id": "AQoQILE98gtqShGmLD7AM6yJThAB",
      "status": "connected",
      "connected_at": "2023-07-19T14:56:51.616329898Z",
      "keepalive_timeout_seconds": 10,
      "reconnect_url": null
    }
  }
}

```

## Keepalive message  {#keepalive-message}

The keepalive messages indicate that the WebSocket connection is healthy. The server sends this message if Twitch doesn’t deliver an event notification within the `keepalive_timeout_seconds` window specified in the Welcome message.

If your client doesn’t receive an event or keepalive message for longer than `keepalive_timeout_seconds`, you should assume the connection is lost and reconnect to the server and resubscribe to the events. The keepalive timer is reset with each notification or keepalive message.

The following example shows the contents of the text [Data](https://datatracker.ietf.org/doc/html/rfc6455#section-5.6) frame for a keepalive message. For a description of the fields, see [WebSocket Reference](/docs/eventsub/websocket-reference#keepalive-message).

```
{
    "metadata": {
        "message_id": "84c1e79a-2a4b-4c13-ba0b-4312293e9308",
        "message_type": "session_keepalive",
        "message_timestamp": "2023-07-19T10:11:12.634234626Z"
    },
    "payload": {}
}

```

## Ping message  {#ping-message}

Your client must respond to standard WebSocket [Ping](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.2) frames with a standard WebSocket [Pong](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.3) frame. If you fail to respond to Ping messages, the server will disconnect from the socket.

**NOTE** Most WebSocket client libraries and browsers automatically handle ping-pong messages for you.

The ping messages are independent of notification and keepalive messages and don’t reset the `keepalive_timeout_seconds` timer (see Keepalive message).

## Notification message  {#notification-message}

A notification message is sent when an event that you subscribe to occurs. The message contains the event’s details.

The following example shows the contents of the text [Data](https://datatracker.ietf.org/doc/html/rfc6455#section-5.6) frame for a notification message. For a description of the fields, see [WebSocket Reference](/docs/eventsub/websocket-reference#notification-message).

```
{
    "metadata": {
        "message_id": "befa7b53-d79d-478f-86b9-120f112b044e",
        "message_type": "notification",
        "message_timestamp": "2022-11-16T10:11:12.464757833Z",
        "subscription_type": "channel.follow",
        "subscription_version": "1"
    },
    "payload": {
        "subscription": {
            "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
            "status": "enabled",
            "type": "channel.follow",
            "version": "1",
            "cost": 1,
            "condition": {
                "broadcaster_user_id": "12826"
            },
            "transport": {
                "method": "websocket",
                "session_id": "AQoQexAWVYKSTIu4ec_2VAxyuhAB"
            },
            "created_at": "2022-11-16T10:11:12.464757833Z"
        },
        "event": {
            "user_id": "1337",
            "user_login": "awesome_user",
            "user_name": "Awesome_User",
            "broadcaster_user_id": "12826",
            "broadcaster_user_login": "twitch",
            "broadcaster_user_name": "Twitch",
            "followed_at": "2023-07-15T18:16:11.17106713Z"
        }
    }
}

```

## Reconnect message  {#reconnect-message}

A reconnect message is sent if the edge server that the client is connected to needs to be swapped. This message is sent 30 seconds prior to closing the connection, specifying a new URL for the client to connect to. Following the reconnect flow will ensure no messages are dropped in the process.

The message includes a URL in the `reconnect_url` field that you should immediately use to create a new connection. The connection will include the same subscriptions that the old connection had. You should not close the old connection until you receive a Welcome message on the new connection.

**NOTE** Use the reconnect URL as is; do not modify it.

The old connection receives events up until you connect to the new URL and receive the welcome message to ensure an uninterrupted flow of notifications.

**NOTE** Twitch sends the old connection a close frame with code 4004 if you connect to the new socket but never disconnect from the old socket or you don’t connect to the new socket within the specified timeframe.

The following example shows the contents of the text [Data](https://datatracker.ietf.org/doc/html/rfc6455#section-5.6) frame for a reconnect message. For a description of the fields, see [WebSocket Reference](/docs/eventsub/websocket-reference#reconnect-message).

```
{
    "metadata": {
        "message_id": "84c1e79a-2a4b-4c13-ba0b-4312293e9308",
        "message_type": "session_reconnect",
        "message_timestamp": "2022-11-18T09:10:11.634234626Z"
    },
    "payload": {
        "session": {
           "id": "AQoQexAWVYKSTIu4ec_2VAxyuhAB",
           "status": "reconnecting",
           "keepalive_timeout_seconds": null,
           "reconnect_url": "wss://eventsub.wss.twitch.tv?...",
           "connected_at": "2022-11-16T10:11:12.634234626Z"
        }
    }
}

```

**NOTE** To test your client’s reconnect code flow, use the Twitch CLI’s [start-websocket-server](/docs/cli/websocket-event-command) subcommand.

## Revocation message  {#revocation-message}

A revocation message is sent if Twitch revokes a subscription. The `subscription` object’s `type` field identifies the subscription that was revoked, and the `status` field identifies the reason why the subscription was revoked. Twitch revokes your subscription in the following cases:

- The user mentioned in the subscription no longer exists. The notification’s `status` field is set to **user_removed**.
- The user revoked the authorization token that the subscription relied on. The notification’s `status` field is set to **authorization_revoked**.
- The subscribed to subscription type and version is no longer supported. The notification’s `status` field is set to **version_removed**.

You’ll receive this message once and then no longer receive messages for the specified user and subscription type.

Twitch reserves the right to revoke a subscription at any time.

The following example shows the contents of the text [Data](https://datatracker.ietf.org/doc/html/rfc6455#section-5.6) frame for a revocation message. For a description of the fields, see [WebSocket Reference](/docs/eventsub/websocket-reference#revocation-message).

```
{

    "metadata": {
        "message_id": "84c1e79a-2a4b-4c13-ba0b-4312293e9308",
        "message_type": "revocation",
        "message_timestamp": "2022-11-16T10:11:12.464757833Z",
        "subscription_type": "channel.follow",
        "subscription_version": "1"
    },
    "payload": {
        "subscription": {
            "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
            "status": "authorization_revoked",
            "type": "channel.follow",
            "version": "1",
            "cost": 1,
            "condition": {
                "broadcaster_user_id": "12826"
            },
            "transport": {
                "method": "websocket",
                "session_id": "AQoQexAWVYKSTIu4ec_2VAxyuhAB"
            },
            "created_at": "2022-11-16T10:11:12.464757833Z"
        }
    }
}

```

## Close message  {#close-message}

Twitch sends a [Close](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.1) frame when it closes the connection. The following table lists the reasons for closing the connection.

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

## Which events is my WebSocket subscribed to?  {#which-events-is-my-websocket-subscribed-to}

If you disconnect from a WebSocket session, all subscriptions associated with that session are automatically disabled. If you create a new WebSocket session, you’ll need to recreate the subscriptions that were in the disconnected session (if you want the same subscriptions).

To discover the events that a WebSocket session subscribes to, use the [Get EventSub Subscriptions](https://dev.twitch.tv/docs/api/reference#get-eventsub-subscriptions) endpoint. For details, see [Getting the list of events you subscribe to](/docs/eventsub/manage-subscriptions#getting-the-list-of-events-you-subscribe-to).

Page through the results and compare your WebSocket session’s ID to the ID in the **Transport** object’s `session_id` field. If they match, the `type` field identifies the event’s subscription type.

```
{
  "data": [
    {
      "id": "26b1c993-bfcf-44d9-b876-379dacafe75a",
      "status": "enabled",
      "type": "streams.online",
      "version": "1",
      "cost": 1,
      "condition": {
        "broadcaster_user_id": "1234"
      },
      "created_at": "2020-11-10T20:08:464757833Z",
      "transport": {
        "method": "websocket",
        "session_id": "34dc753d-2173-4645-8d76-39636b9c6d32",
        "connected_at": "2022-10-20T18:16:634234626Z"
      }
    },
    . . .
  ],
  "total": 2,
  "total_cost": 2,
  "max_total_cost": 10000,
  "pagination": {}
}

```

You can also use the GET request to get a list of WebSocket sessions you’re connected to. Use the ID in the `session_id` field to construct a unique list of IDs.

If the WebSocket session is disconnected, the **Transport** object includes the `disconnected_at` field, which lets you know when the connection was lost. If a connection is lost, you must recreate the subscriptions in a new WebSocket session. There is no replay of events that are lost from the time the connection was dropped to the time you establish a new connection and resubscribe to the events.

## Subscription limits  {#subscription-limits}

The logic for determining a subscription’s cost is the same regardless of whether the transport is webhooks or WebSockets. [Read More](/docs/eventsub/manage-subscriptions#subscription-limits)

The following limits apply per user token (client ID and user ID tuple).

- You can create a maximum of 3 WebSockets connections with enabled subscriptions. Reconnecting using a reconnection URL (see [Reconnect message](/docs/eventsub/handling-websocket-events#reconnect-message)) doesn’t add to your WebSocket count.
- Each WebSocket connection may create a maximum of 300 enabled subscriptions (disabled subscriptions don’t count against the limit).
- The `max_total_cost` is 10 across all subscriptions.

You should create one WebSocket connection until you have a reason to create another one.

## Migrating from using webhooks to using WebSockets  {#migrating-from-using-webhooks-to-using-websockets}

### Authentication  {#authentication}

When [subscribing to events](/docs/api/reference#create-eventsub-subscription), webhooks uses app access tokens and WebSockets uses user access tokens. If you use app access tokens with WebSockets, the subscriptions will fail.

### Headers  {#headers}

While Webhooks uses headers to provide metadata information about the event, WebSockets uses fields in the `metadata` object of the text data frame. The following table lists the webhook header and the equivalent WebSocket field.

| Webhooks | WebSockets | Notes |
|---|---|---|
| Twitch-Eventsub-Message-Id | message_id |  |
| Twitch-Eventsub-Message-Retry | No equivalent |  |
| Twitch-Eventsub-Message-Type | message_type |  |
| Twitch-Eventsub-Message-Signature | No equivalent |  |
| Twitch-Eventsub-Message-Timestamp | message_timestamp |  |
| Twitch-Eventsub-Subscription-Type | subscription_type | Included only for notification and revocation message types. |
| Twitch-Eventsub-Subscription-Version | subscription_version | Included only for notification and revocation message types. |

### Payload  {#payload}

Every WebSocket data frame includes the `metadata` and `payload` fields. The `payload` field for notification and revocation messages contains the same subscription and event objects that webhooks uses.

```
{
    "metadata": {. . .},
    "payload": {
        "subscription": {
            "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
            "status": "enabled",
            "type": "channel.follow",
            "version": "1",
            "cost": 1,
            "condition": {
                "broadcaster_user_id": "12826"
            },
            "transport": {
                "method": "websocket",
                "session_id": "AQoQexAWVYKSTIu4ec_2VAxyuhAB"
            },
            "created_at": "2022-11-16T10:11:12.464757833Z"
        },
        "event": {
            "user_id": "1337",
            "user_login": "awesome_user",
            "user_name": "Awesome_User",
            "broadcaster_user_id": "12826",
            "broadcaster_user_login": "twitch",
            "broadcaster_user_name": "Twitch"
        }
    }
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
