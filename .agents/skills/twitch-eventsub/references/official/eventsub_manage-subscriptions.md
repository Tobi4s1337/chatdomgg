<!-- source: https://dev.twitch.tv/docs/eventsub/manage-subscriptions/ -->

Contents

# Managing Event Subscriptions  {#managing-event-subscriptions}

Twitch provides a number of events that you can subscribe to to get near real time notifications. For a list of events, see [EventSub Subscription Types](/docs/eventsub/eventsub-subscription-types/).

Before subscribing to events, make sure your event handler is ready to receive notifications; otherwise, your subscription request will fail. For information about writing a webhook event handler, see [Getting Events Using Webhooks](/docs/eventsub/handling-webhook-events/) and for information about writing a WebSocket event handler, see [Getting Events Using WebSockets](/docs/eventsub/handling-websocket-events/).

## Subscribing to events  {#subscribing-to-events}

To subscribe to events, use the [Create EventSub Subscription](/docs/api/reference#create-eventsub-subscription) endpoint. The object in the request’s body must include:

- The `type` field, which identifies the event you’re subscribing to. For example, to get notifications when a broadcaster gets a new follower, you’d set the `type` field to **channel.follow**. For information about handling subscription types that specify scopes, see Authorization.
- The `version` field, which identifies the definition of the subscription type to use. For example, to use the first definition that Twitch defined for **channel.follow**, you’d set the `version` field to **1**.
- The `condition` field, which identifies the parameters under which the event fires. For example, if you’re requesting notifications when a broadcaster gets a new follower, you’d set the condition object’s `broadcaster_user_id` field to the broadcaster’s ID.
- The `transport` field, which tells Twitch the transport method you’re using to receive notifications. Set the transport object’s `method` field to **webhook** or **websocket**.

If you’re using webhooks, use the `callback` field to specify your event handler’s URI and use the `secret` field to specify the hash used to verify the event’s data. The URI must use SSL on port 443. For information about the secret, see [Verifying the event message](/docs/eventsub/handling-webhook-events/#verifying-the-event-message).

If you’re using WebSockets, set the `session_id` field to the ID that the [Welcome message](/docs/eventsub/handling-websocket-events#welcome-message) returns.

The following example shows how to create a subscription using the webhooks transport.

```
curl -X POST 'https://api.twitch.tv/helix/eventsub/subscriptions' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz' \
-H 'Content-Type: application/json' \
-d '{"type":"channel.follow","version":"2","condition":{"broadcaster_user_id":"1234", "moderator_user_id": "1234"},"transport":{"method":"webhook","callback":"https://example.com/callback","secret":"s3cre77890ab"}}'

```

If the request succeeds, it returns HTTP status code 202 and the response’s body contains a JSON object that echoes your request. For webhooks, the `status` field indicates the state of your subscription. The status is set to **webhook_callback_verification_pending** while Twitch attempts to verify that you own the event handler specified in the `callback` field; Twitch won’t send you events until it verifies the callback. After Twitch verifies your callback, the subscription’s status changes to **enabled**, which indicates that your subscription is active and able to receive events. For WebSockets, the `status` field is set to **enabled**.

The following example shows the response for the above webhooks request.

```
{
  "data": [
    {
      "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
      "status": "webhook_callback_verification_pending",
      "type": "channel.follow",
      "version": "2",
      "cost": 1,
      "condition": {
        "broadcaster_user_id": "1234",
        "moderator_user_id": "1234"
      },
      "transport": {
        "method": "webhook",
        "callback": "https://example.com/webhooks/callback"
      },
      "created_at": "2019-11-16T10:11:12.634234626Z"
    }
  ],
  "total": 1,
  "total_cost": 1,
  "max_total_cost": 10000
}

```

The request may fail in some cases, including:

- Incorrect or missing fields
- Access tokens were used that are invalid, expired, of the incorrect type, or are lacking the required scopes
- A subscription already exists for the specified event type and `condition` combination

The HTTP response code will have more information about the exact reason for your failure. For more information, see [Create EventSub Subscription](/docs/api/reference/#create-eventsub-subscription).

### Authorization  {#authorization}

When subscribing to events using WebSockets, you must use a user access token only. The request fails if you use an app access token. The [Subscription Types](/docs/eventsub/eventsub-subscription-types) topic lists the scope requirement for each event. If the event doesn’t specify a scope requirement, you must create a user access token with no scope.

When subscribing to events using webhooks, you must use an app access token. The request fails if you use a user access token. For subscription types that require user authorization, the user must grant your app (client ID) permissions to the required scopes prior to subscribing to the event.

For example, to subscribe to [channel.subscribe](/docs/eventsub/eventsub-subscription-types/#channelsubscribe) events, the broadcaster must grant your app permission to get users that subscribe to them. This adds the **channel:read:subscriptions** scope to your app’s client ID. This means that prior to sending a subscription request, your app must get a user access token with the required scope, and then get an app access token using the same client ID, which you use to subscribe to the events. If your client ID doesn’t include the scope, the subscription request fails.

## Getting the list of events you subscribe to  {#getting-the-list-of-events-you-subscribe-to}

To get the list of events that you subscribe to, use the [Get EventSub Subscriptions](https://dev.twitch.tv/docs/api/reference#get-eventsub-subscriptions) endpoint.

If you specified the webhook transport when you subscribed to events, use an app access token, but if you used the WebSocket transport, use a user acccess token (no scope requirements).

The following request shows how to get the first page of events that you subscribe to.

```
curl -X GET 'https://api.twitch.tv/helix/eventsub/subscriptions' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz'

```

The response contains a JSON object for each event you subscribe to. The list is [paginated](/docs/api/guide#pagination) and is in ascending order by creation date (oldest subscription first).

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
      "created_at": "2020-11-10T20:08:634234626Z",
      "transport": {
        "method": "webhook",
        "callback": "https://this-is-a-callback.com"
      }
    },
    {
      "id": "35016908-41ff-33ce-7879-61b8dfc2ee16",
      "status": "webhook_callback_verification_pending",
      "type": "users.update",
      "version": "1",
      "cost": 1,
      "condition": {
        "user_id": "1234"
      },
      "created_at": "2020-11-10T20:31:634234626Z",
      "transport": {
        "method": "webhook",
        "callback": "https://this-is-a-callback.com"
      }
    }
  ],
  "total": 2,
  "total_cost": 2,
  "max_total_cost": 10000,
  "pagination": {}
}

```

Because it can take a few seconds for the `total` field to update after subscriptions are added or deleted, you should consider the value an approximation.

For information about the `cost`, `total_cost`, and `max_total_cost` fields, see Subscription limits.

If you’re using WebSockets and the WebSocket is disconnected, the **Subscription** object includes the `disconnected_at` field, which lets you know when the connection was lost.

**NOTE** The GET API returns disabled WebSocket subscriptions for a minimum of 1 minute as compared to webhooks which returns disabled subscriptions for a minimum of 10 days.

### Filtering the list by type  {#filtering-the-list-by-type}

You can filter the list of subscriptions by the event’s type and status. The filters are mutually exclusive (you cannot specify both type and status in the same request).

To filter the list by type, set the type query parameter to a subscription type. The following example filters the list for all **channel.follow** subscriptions.

```
curl -X GET 'https://api.twitch.tv/helix/eventsub/subscriptions?type=channel.follow' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz'

```

### Filtering the list by status  {#filtering-the-list-by-status}

To filter the list by the subscription’s status, set the status query parameter to one of the following values:

- **enabled** — Twitch has verified your callback and is able to send you notifications.
- **webhook_callback_verification_pending** — Twitch is verifying that you own the callback specified in the create subscription request. For information about how it does this, see [Verifying your callback](/docs/eventsub/handling-webhook-events/#responding-to-a-challenge-request). Used only for webhook subscriptions.
- **webhook_callback_verification_failed** — Twitch failed to verify that you own the callback specified in the create subscription request. Fix your event handler to correctly respond to the challenge, and then try subscribing again. Used only for webhook subscriptions.
- **notification_failures_exceeded** — Twitch revoked your subscription because the notification delivery failure rate was too high. Used only for webhook subscriptions.
- **authorization_revoked** — Twitch revoked your subscription because the users in the `condition` object revoked their authorization letting you get events on their behalf, or changed their password.
- **moderator_removed** — The moderator that authorized the subscription is no longer one of the broadcaster’s moderators.
- **user_removed** — Twitch revoked your subscription because the users in the `condition` object are no longer Twitch users.
- **version_removed** — Twitch revoked your subscription because the subscription to subscription type and version is no longer supported.
- **beta_maintenance** — Twitch revoked your subscription because the beta subscription type was undergoing maintenance.
- **websocket_disconnected** — The client closed the connection.
- **websocket_failed_ping_pong** — The client failed to respond to a ping message.
- **websocket_received_inbound_traffic** — The client sent a non-pong message. Clients may only send pong messages (and only in response to a ping message).
- **websocket_connection_unused** — The client failed to subscribe to events within the required time.
- **websocket_internal_error** — The Twitch WebSocket server experienced an unexpected error.
- **websocket_network_timeout** — The Twitch WebSocket server timed out writing the message to the client.
- **websocket_network_error** — The Twitch WebSocket server experienced a network error writing the message to the client.

The following example filters the list for all enabled subscriptions.

```
curl -X GET 'https://api.twitch.tv/helix/eventsub/subscriptions?status=enabled' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz'

```

## Deleting a subscription  {#deleting-a-subscription}

To delete a subscription, use the [Delete EventSub Subscription](/docs/api/reference#delete-eventsub-subscription) endpoint. Set the id query parameter to the subscription to delete.

**NOTE** It’s important to first delete all subscriptions before deleting an application. Otherwise, subscriptions will still be sent to the registered callbacks from when the subscriptions were created.

If you specified the webhook transport when you subscribed to events, use an app access token, but if you used the WebSocket transport, use a user acccess token (no scope requirements).

```
curl -X DELETE 'https://api.twitch.tv/helix/eventsub/subscriptions?id=f1c2a387-161a-49f9-a165-0f21d7a4e1c4' \
-H 'Authorization: Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx' \
-H 'Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz'

```

## Subscription limits  {#subscription-limits}

EventSub uses a cost-based system for subscription limits. Subscription responses include the following fields to help you keep track of your subscription limits:

- `cost` — How much the subscription counts against your application’s limit.
- `total_cost` — The current sum of all your subscription costs.
- `max_total_cost` — Your application’s subscription limit.

The maximum number of subscriptions you can create grows as users authorize your application. Here’s how it works:

- There is a limit of 3 subscriptions with the same `type` and `condition` values.
- There is no cost for subscriptions that require a user to authorize your application (e.g., `channel.subscribe`).
- There is a cost for subscriptions that require you to specify a user but does not require that user to authorize your application (e.g., `stream.online`, `channel.update`). However, there is no cost if that user has authorized your application (i.e., you have an OAuth scope for that user).

### Example  {#example}

Suppose you want to create three subscriptions:

- `stream.online` (no auth requirements, cost 1)
- `channel.update` (no auth requirements, cost 1)
- `channel.cheer` (`bits:read` OAuth scope required, cost 0)

User A has granted `bits:read` authorization to your application. Because the user has authorized your application, the total cost of these three subscriptions is 0.

User B has granted `channel:moderate` authorization to your application. The cost of subscribing to `stream.online` and `channel.update` subscriptions is 0. Your application cannot create a `channel.cheer` subscription because User B has not authorized your application with the required OAuth scope.

User C has not granted authorization to your application. The cost of subscribing to `stream.online` and `channel.update` subscriptions is 2. Your application cannot create a `channel.cheer` subscription because User C has not authorized your application with the required OAuth scope.

### WebSocket limits  {#websocket-limits}

The following limits apply per user token (client ID and user ID tuple).

- You may create a maximum of 3 WebSockets connections with enabled subscriptions. Reconnecting using a reconnection URL (see [Reconnect message](/docs/eventsub/handling-websocket-events#reconnect-message)) doesn’t add to your WebSocket count.
- Each WebSocket connection may create a maximum of 300 enabled subscriptions (disabled subscriptions don’t count against the limit).
- The `max_total_cost` is 10 across all subscriptions.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
