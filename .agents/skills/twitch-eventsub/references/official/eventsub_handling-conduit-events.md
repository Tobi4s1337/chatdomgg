<!-- source: https://dev.twitch.tv/docs/eventsub/handling-conduit-events/ -->

Contents

# Getting Events Using Conduits  {#getting-events-using-conduits}

The Conduits transport type is a wrapper that separates your subscriptions from the underlying transport and load balances notifications across shards.

A shard is a Webhook or WebSocket connection, while a conduit is a collection of shards. The conduit transport type is for backend server applications and requires [app access tokens](https://dev.twitch.tv/docs/authentication#app-access-tokens).

For more information on how to set up these types of connections, see [Handling Webhook Events](/docs/eventsub/handling-webhook-events/) and [Handling WebSocket Events](/docs/eventsub/handling-websocket-events/).

## Conduit setup and notification flow  {#conduit-setup-and-notification-flow}

Before you may subscribe to events using conduits, you must follow the recommended steps:

- Create a conduit.
- Assign transports to the conduit’s shards.
- Verify the conduit shards.
- Create subscriptions using the conduit’s ID.

## Creating a conduit  {#creating-a-conduit}

The first step is to create a conduit with [Create EventSub Conduit](/docs/api/reference/#create-eventsub-subscription), while specifying the number of shards you need.

For example, here’s how you could create a conduit with five shards:

**Example Request**​​​​​

```
curl -X POST 'https://api.twitch.tv/helix/eventsub/conduits' \
-H 'Authorization: Bearer cfabdegwdoklmawdzdo98xt2fo512y' \
-H 'Client-Id: uo6dggojyb8d6soh92zknwmi5ej1q2' \
-d '{"shard_count":5}'

```

After sending the request, you receive a data object that includes the:

- **id** - A unique identifier for the event.
- **shard_count** - A confirmation on the number of shards.

**Example Response**

```
{
  "data": [
    {
      "id": "bfcfc993-26b1-b876-44d9-afe75a379dac",
      "shard_count": 5
    }
  ]
}

```

Shard IDs are sequential and start at 0, so creating a conduit with a shard count of 5 will create shards with IDs 0 through 4.

## Assigning transports to conduits  {#assigning-transports-to-conduits}

After creating a conduit and receiving the conduit’s ID, the next step is to assign a transport to each shard. If you want the conduit to deliver over WebSockets, you would then create the desired number of WebSocket sessions.

Next, use [Update EventSub Conduit Shards](/docs/api/reference/#update-conduit-shards) to associate your WebSocket sessions or Webhook callbacks with the shards in the conduit.

**IMPORTANT** When setting up a WebSockets connection, you have 10 seconds from the time you receive the Welcome message to associate it with a shard. If you don’t assign a shard this connection within this timeframe, the server closes the connection.

**Example Request**

```
curl -X PATCH 'https://api.twitch.tv/helix/eventsub/conduits/shards' \
-H 'Authorization: Bearer cfabdegwdoklmawdzdo98xt2fo512y' \
-H 'Client-Id: uo6dggojyb8d6soh92zknwmi5ej1q2' \
-d '{
  "conduit_id":"bfcfc993-26b1-b876-44d9-afe75a379dac",
  "shards": [
    {
        "id":"0",
        "transport":{
            "method":"webhook",
            "callback":"https://this-is-a-callback.com",
            "secret":"s3cre7"
        },
    },
    {
        "id":"1",
        "transport":{
            "method":"webhook",
            "callback":"https://this-is-a-callback-2.com",
            "secret":"s3cre7"
        },
    },
    ...
  ]
}'

```

​​​​​​**Example Response**

```
{
  "data": [
    {
      "id": "0",
      "status": "enabled",
      "transport": {
        "method": "webhook",
        "callback": "https://this-is-a-callback.com"
      }
    },
    {
      "id": "1",
      "status": "webhook_callback_verification_pending",
      "transport": {
        "method": "webhook",
        "callback": "https://this-is-a-callback-2.com"
      }
    }
    ...
  ]
}

```

For a visual example, here’s how the setup flow looks for creating a conduit and associating WebSockets connections with it:

## Verifying a conduit  {#verifying-a-conduit}

When you associate a shard with a Webhook, Twitch sends you a verification challenge to make sure that you own the event handler specified in the request.

**Example Challenge**

```
{
  "challenge": "pogchamp-kappa-360noscope-vohiyo",
  "conduit_shard": {
    "conduit_id": "3f1c2a87-161a-49f9-a165-0f21d7a4e1c4",
    "shard": "42"
  }
}

```

The `challenge` field in the body of the request contains the challenge value that you must respond with.

To verify the conduit shard, your response must return a 200 status code, the response body must contain the raw challenge value, and you must set the Content-Length response header to the length of the challenge value.

If successful, your shard is enabled.

## Adding subscriptions to conduits  {#adding-subscriptions-to-conduits}

You can add subscriptions to a conduit by specifying the conduit ID when you create the subscription. EventSub will route notifications to your conduit shards, using a hashing mechanism to determine which shard notifications for a particular channel ID will be delivered on. Subscriptions will be disabled when a conduit is deleted.

## Event notifications  {#event-notifications}

A notification message is sent when an event that you subscribe to occurs. The message contains the event’s details. The `type` field in the body of the request identifies the type of event, and the `event` field contains the event’s data.

Regardless of if the shard receiving the notification is a WebSockets or Webhook event, the notification will look like the following example:

```
{
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
      "method": "conduit",
      "conduit_id": "3f1c2a87-161a-49f9-a165-0f21d7a4e1c4"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
    "user_id": "1337",
    "user_login": "awesome_user",
    "user_name": "Awesome_User",
    "broadcaster_user_id": "12826",
    "broadcaster_user_login": "twitch",
    "broadcaster_user_name": "Twitch",
    "followed_at": "2020-07-15T18:16:11.17106713Z"
  }
}

```

## Revoking your subscription  {#revoking-your-subscription}

A revocation message is sent if Twitch revokes a subscription. Twitch revokes your subscription in the following cases:

- The user mentioned in the subscription no longer exists. The notification’s `status` field is set to **user_removed**.
- The user revoked the authorization token that the subscription relied on. The notification’s `status` field is set to **authorization_revoked**.
- The subscribed to subscription type and version is no longer supported. The notification’s `status` field is set to **version_removed**.
- (For Webhook connections) The callback failed to respond in a timely manner too many times. The notification’s `status` field is set to **notification_failures_exceeded**.

You’ll receive this message once and then no longer receive messages for the specified user and subscription type:

```
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "status": "authorization_revoked",
    "type": "channel.follow",
    "cost": 1,
    "version": "1",
    "condition": {
      "broadcaster_user_id": "12826"
    },
    "transport": {
      "method": "conduit",
      "conduit_id": "3f1c2a87-161a-49f9-a165-0f21d7a4e1c4"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  }
}

```

The subscription object’s `type` field identifies the subscription that was revoked, and the `status` field identifies the reason why the subscription was revoked.

Twitch reserves the right to revoke a subscription at any time.

## Scaling conduits  {#scaling-conduits}

Developers can scale up and scale down their conduits as needed based on user behavior. Use the [Update EventSub Conduit](/docs/api/reference/#update-conduits) API to scale up or scale down by changing the number of shards available to the conduit.

For a visual example, here’s the flow for scaling up:

You can scale down by reducing the shard count on a conduit. For example, updating the shard count from 100 to 50 will disable shards with ids 50-99.

## Failure scenarios and cleanup  {#failure-scenarios-and-cleanup}

EventSub can disable individual shards within a Conduit (e.g., after a websocket session disconnects). When EventSub sends a notification to a disabled shard, it attempts to resend the notification to another shard. If that second shard is also disabled, EventSub will drop the notification, so it’s important to reactivate or clean up your shards when they are disabled.

**NOTE** A Webhook shard follows the same disabling logic as a normal Webhook, and is only disabled after an extended outage of consecutive failures. If a notification is sent to an active Webhook shard and the Webhook callback fails, the notification will not be resent to another shard.

### Handling disabled shards  {#handling-disabled-shards}

To help stay on top of disabled shards, we recommend subscribing to the EventSub subscription type [conduit.shard.disabled](/docs/eventsub/eventsub-subscription-types/#conduitsharddisabled), which will emit a notification when a shard becomes disabled.

If your shard is disabled, you can update the shard conduit via [Update EventSub Conduit Shards](/docs/api/reference/#update-conduit-shards) with a newly created WebSocket session or valid Webhook callback URL.

If you would rather just remove a shard altogether, you can swap the shard you wish to remove with the last shard on the conduit using [Update EventSub Conduit Shards](/docs/api/reference/#update-conduit-shards), and then reduce the shard count for that conduit by 1 via [Update EventSub Conduit](/docs/api/reference/#update-conduits).

If all the shards associated with a conduit are disabled, the conduit will remain enabled. However, if no shard is reactivated after 72 hours, EventSub will delete the conduit. This allows developers to recover from full outages without needing to recreate every subscription associated with their system.

## Authorizing conduits  {#authorizing-conduits}

Creating a conduit and associating subscriptions with it requires an [app access token](/docs/authentication#app-access-tokens).

## Limits  {#limits}

We will limit clients to five enabled conduits with a maximum of 20,000 shards per conduit (all numbers provided are subject to change). Subscriptions associated with conduits will use the same cost model EventSub has today.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
