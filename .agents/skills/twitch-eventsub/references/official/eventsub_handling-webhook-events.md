<!-- source: https://dev.twitch.tv/docs/eventsub/handling-webhook-events/ -->

Contents

# Getting Events Using Webhook Callbacks  {#getting-events-using-webhook-callbacks}

Before [subscribing to events](/docs/eventsub/manage-subscriptions/), you must create a callback that listens for events. Your callback must use SSL and listen on port 443.

The following table lists the types of notifications your handler must process. The Twitch-Eventsub-Message-Type request header contains the notification’s type.

| Notification Type | Description |
|---|---|
| notification | Contains the event’s data. See Processing an event. |
| webhook_callback_verification | Contains the challenge used to prove that you own the event handler. This is the first event you’ll receive after subscribing to an event. See Responding to a challenge request. |
| revocation | Contains the reason why Twitch revoked your subscription. See Revoking your subscription. |

**IMPORTANT** Before handling any message, you must make sure that Twitch sent it. For information, see Verifying the event message.

You must respond to notification requests within a few seconds. If your server takes too long to respond, the request will time out. If you fail to respond quickly enough too many times, the subscription’s status changes to `notification_failures_exceeded` and Twitch revokes the subscription. If your server can’t process a notification request quickly enough, consider writing the event to temporary storage and processing the notification after responding with 2XX.

For information about testing your event handler, see Using the CLI to test your handler.

**NOTE** All timestamps are in RFC3339 format and use nanoseconds instead of milliseconds.

## List of request headers  {#list-of-request-headers}

The following is the list of headers that Twitch sends in the request to your server. Use the values in these headers to process the different notifications.

**NOTE** Request header names are case-insensitive but some languages, like JavaScript, convert header names to lowercase regardless of how they were sent. If your language converts the header names to lowercase, use `.toLowerCase()` before checking the headers.

| Header | Description |
|---|---|
| Twitch-Eventsub-Message-Id | An ID that uniquely identifies this message. This is an opaque ID, and is not required to be in any particular format. |
| Twitch-Eventsub-Message-Retry | Twitch sends you a notification at least once. If Twitch is unsure of whether you received a notification, it’ll resend the event, which means you may receive a notification twice. If this is an issue for your implementation, see [Handling duplicates](/docs/eventsub#handling-duplicate-events) for options. |
| Twitch-Eventsub-Message-Type | The type of notification. Possible values are:   - notification — Contains the event's data. See Processing an event. - webhook_callback_verification — Contains the challenge used to verify that you own the event handler. See Responding to a challenge request. - revocation — Contains the reason why Twitch revoked your subscription. See Revoking your subscription. |
| Twitch-Eventsub-Message-Signature | The HMAC signature that you use to verify that Twitch sent the message. See Verifying the event message. |
| Twitch-Eventsub-Message-Timestamp | The UTC date and time (in RFC3339 format) that Twitch sent the notification. |
| Twitch-Eventsub-Subscription-Type | The subscription type you subscribed to. For example, **channel.follow**. |
| Twitch-Eventsub-Subscription-Version | The version number that identifies the definition of the subscription request. This version matches the version number that you specified in your subscription request. |

## Verifying the event message  {#verifying-the-event-message}

Before doing anything with a message that is sent to your handler, you should verify that it came from Twitch. When you subscribe to an event, you pass it a secret. Twitch uses the secret as the key when creating an HMAC-SHA256 (hash-based message authentication code) signature. Twitch passes the HMAC signature to your handler in the Twitch-Eventsub-Message-Signature request header.

**NOTE** The secret must be an ASCII string that’s a minimum of 10 characters long and a maximum of 100 characters long. You can use a simple string like, “this is my secret”; however, you should consider using a random byte generator meant for cryptography. The secret used in this topic was generated using `crypto.randomBytes(32)` to create 32 random bytes. The 32 random bytes were converted to HEX to create an ASCII string, 64 characters long.

To verify the signature:

- Create an HMAC signature using your secret and a message that is the concatenation of the values in the Twitch-Eventsub-Message-Id header, Twitch-Eventsub-Message-Timestamp header, and the raw request body (the order is important.)
- Compare your HMAC to the HMAC that Twitch sent in the Twitch-Eventsub-Message-Signature header. Be sure to use a time safe comparison function.
- If the signatures don’t match, return a 4XX status code.

The following snippet shows a simple JavaScript implementation (see full example).

```
const crypto = require('crypto')

// Notification request headers
const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase();
const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase();

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = 'sha256=';

app.use(express.raw({          // Need the raw message body for signature verification
    type: 'application/json'
}))

. . .

    let secret = getSecret();
    let message = getHmacMessage(req);
    let hmac = HMAC_PREFIX + getHmac(secret, message);  // Signature to compare to Twitch's

    if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
        console.log("signatures match");

        // Get JSON object from body, so you can process the message.
        let notification = JSON.parse(req.body);

        // Handle notification...
    }
    else {
        console.log('403');
        res.sendStatus(403);
    }

. . .

function getSecret() {
    // TODO: Get your secret from secure storage. This is the secret you passed
    // when you subscribed to the event.
    return '<your secret goes here>';
}

// Build the message used to get the HMAC.
function getHmacMessage(request) {
    return (request.headers[TWITCH_MESSAGE_ID] +
        request.headers[TWITCH_MESSAGE_TIMESTAMP] +
        request.body);
}

// Get the HMAC.
function getHmac(secret, message) {
    return crypto.createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

// Verify whether your signature matches Twitch's signature.
function verifyMessage(hmac, verifySignature) {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
}

```

## Processing an event  {#processing-an-event}

When an event that you subscribe to occurs, Twitch sends your event handler a notification message that contains the event’s data. Notification messages set the Twitch-Eventsub-Message-Type header to **notification**. For example:

```
Twitch-Eventsub-Message-Type: notification

```

The `type` field in the body of the request identifies the type of event, and the `event` field contains the event’s data.

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
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  },
  "event": {
    "user_id": "1337",
    "user_login": "awesome_user",
    "user_name": "Awesome_User",
    "broadcaster_user_id":     "12826",
    "broadcaster_user_login":  "twitch",
    "broadcaster_user_name":   "Twitch",
    "followed_at": "2020-07-15T18:16:11.17106713Z"
  }
}

```

Your response should return a 2XX status code.

The following snippet shows a simple JavaScript implementation that responds to an event notification request (see full example).

```
// Notification request headers
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Notification message types
const MESSAGE_TYPE_NOTIFICATION = 'notification';

        // Get JSON object from body, so you can process the message.
        let notification = JSON.parse(req.body);

        if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {
            // TODO: Do something with event's data.
            console.log(`Event type: ${notification.subscription.type}`);
            console.log(JSON.stringify(notification.event, null, 4));

            res.sendStatus(204);
        }

```

Remember, if processing the event takes longer than a second or two, consider writing the event to temporary storage and processing the notification after responding with 2XX. If you fail to respond quickly enough too many times, the subscription’s status changes to `notification_failures_exceeded` and Twitch revokes your subscription.

## Responding to a challenge request  {#responding-to-a-challenge-request}

When you [subscribe to an event](/docs/eventsub/manage-subscriptions/), Twitch sends you a verification challenge to make sure that you own the event handler specified in the request. Challenge messages set the Twitch-Eventsub-Message-Type header to **webhook_callback_verification**. For example:

```
Twitch-Eventsub-Message-Type: webhook_callback_verification

```

The `challenge` field in the body of the request contains the challenge value that you must respond with.

```
{
  "challenge": "pogchamp-kappa-360noscope-vohiyo",
  "subscription": {
    "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
    "status": "webhook_callback_verification_pending",
    "type": "channel.follow",
    "version": "1",
    "cost": 1,
    "condition": {
      "broadcaster_user_id": "12826"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  }
}

```

Your response must return a 200 status code, the response body must contain the raw challenge value, and you must set the Content-Length response header to the length of the challenge value. If successful, your subscription is enabled.

The following snippet shows a simple JavaScript implementation that responds to a challenge request (see full example).

```
// Notification request headers
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Notification message types
const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';

        // Get JSON object from body, so you can process the message.
        let notification = JSON.parse(req.body);

        else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
            res.set('Content-Type', 'text/plain').status(200).send(notification.challenge);
        }

```

The response body must contain the raw challenge string only. If your server is using a web framework, be careful that your web framework isn’t modifying the response in an incompatible way. For example, some web frameworks default to converting responses into JSON objects.

## Revoking your subscription  {#revoking-your-subscription}

Subscriptions do not expire, but Twitch may revoke them. Twitch revokes your subscription in the following cases:

- The user mentioned in the subscription no longer exists. The notification’s status is set to **user_removed**.
- The user revoked the authorization token or simply changed their password. The notification’s status is set to **authorization_revoked**.
- The callback failed to respond in a timely manner too many times. The notification’s status is set to **notification_failures_exceeded**.
- The subscribed to subscription type and version is no longer supported. The notification’s status is set to **version_removed**.

Twitch reserves the right to revoke a subscription at any time. Revocation messages set the Twitch-Eventsub-Message-Type header to **revocation**. For example:

```
Twitch-Eventsub-Message-Type: revocation

```

The `status` field in the body of the request contains the reason why Twitch revoked the subscription.

```
{
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
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2019-11-16T10:11:12.634234626Z"
  }
}

```

Your response must return a 2XX status code.

The following snippet shows a simple JavaScript implementation that responds to a revocation request (see full example).

```
// Notification request headers
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Notification message types
const MESSAGE_TYPE_REVOCATION = 'revocation';

        // Get JSON object from body, so you can process the message.
        let notification = JSON.parse(req.body);

        else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
            res.sendStatus(204);

            console.log(`${notification.subscription.type} notifications revoked!`);
            console.log(`reason: ${notification.subscription.status}`);
            console.log(`condition: ${JSON.stringify(notification.subscription.condition, null, 4)}`);
        }

```

## Using the CLI to test your handler  {#using-the-cli-to-test-your-handler}

Twitch’s [command line interface](/docs/cli/) (CLI) provides the `event` command that you can use to test your event handler, and it doesn’t require SSL.

You can test:

- Challenge events (see Testing challenge events)
- Notification events (see Testing notification events)

### Testing challenge events  {#testing-challenge-events}

When you subscribe to an event, Twitch verifies that you own the event handler specified in the request by sending your handler a **webhook_callback_verification** notification event. For more information, see Responding to a challenge request.

The following CLI example shows how to test your response to a challenge event. Before running it, change the -F flag’s value to point to your handler and the -s flag’s value to your secret. Although the –secret flag is optional, you should always specify it, so the part of your handler that verifies that the message comes from Twitch works. For information about secrets, see the note under Verifying the event message.

Then, open a terminal window and run the command.

```
twitch event verify-subscription subscribe -F http://localhost:8080/eventsub/ -s 5f1a6e7cd2e7137ccf9e15b2f43fe63949eb84b1db83c1d5a867dc93429de4e4

```

If you’ve done everything right, the output will look like:

```
✔ Valid response. Received challenge 5e784545-5a59-a05a-6ae6-cfaf260532f1 in body
✔ Valid status code. Received status 200

```

For more information about using the `verify-subscription` sub-command, see [Verifying your event handler’s challenge response](/docs/cli/event-command/#verifying-your-event-handlers-challenge-response).

### Testing notification events  {#testing-notification-events}

Use the `trigger` sub-command to send mock events to your event handler. The command’s argument identifies the event to trigger. Before running it, change the -F flag’s value to point to your handler and the -s flag’s value to your secret. Although the –secret flag is optional, you should always specify it, so the part of your handler that verifies that the message comes from Twitch works. For information about secrets, see the note under Verifying the event message.

Then, open a terminal window and run the command.

```
twitch event trigger subscribe -F http://localhost:8080/eventsub/ -s 5f1a6e7cd2e7137ccf9e15b2f43fe63949eb84b1db83c1d5a867dc93429de4e4

```

For a list of events that you can trigger, see [Triggering webhook events](/docs/cli/event-command/#triggering-webhook-events).

### If you don’t use the CLI to test  {#if-you-dont-use-the-cli-to-test}

If you don’t use the CLI to test, you’ll need to create an SSL server on port 443, and then:

- [Create a subscription](/docs/eventsub/manage-subscriptions) that sends event notifications when the Twitch channel (ID 12826) gets a new follower.
- Log in to Twitch and follow the [Twitch](https://twitch.tv/twitch) channel.
- Check that your event handler received a follow `notification` request for the Twitch channel (ID 12826).

## Simple Node.js example  {#simple-nodejs-example}

The following is a simple event handler that uses Node.js and [Express](https://expressjs.com/).

To run the example, you must have Node.js [installed](https://nodejs.org/en/download/).

- Open a terminal window
- Create a folder for the example and `cd` to it
- Run `npm init`
- Run `npm install express --save`
- Create a file and name it app.js
- Copy the example to app.js
- Update the `getSecret()` function to get the secret key that you use when you subscribe to events
- Run `node app.js`
- Use the CLI’s `event` command to generate a mock event (see Testing notification events)

```
const crypto = require('crypto')
const express = require('express');
const app = express();
const port = 8080;

// Notification request headers
const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase();
const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase();
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Notification message types
const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
const MESSAGE_TYPE_NOTIFICATION = 'notification';
const MESSAGE_TYPE_REVOCATION = 'revocation';

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = 'sha256=';

app.use(express.raw({          // Need raw message body for signature verification
    type: 'application/json'
}))

app.post('/eventsub', (req, res) => {
    let secret = getSecret();
    let message = getHmacMessage(req);
    let hmac = HMAC_PREFIX + getHmac(secret, message);  // Signature to compare

    if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
        console.log("signatures match");

        // Get JSON object from body, so you can process the message.
        let notification = JSON.parse(req.body);

        if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {
            // TODO: Do something with the event's data.

            console.log(`Event type: ${notification.subscription.type}`);
            console.log(JSON.stringify(notification.event, null, 4));

            res.sendStatus(204);
        }
        else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
            res.set('Content-Type', 'text/plain').status(200).send(notification.challenge);
        }
        else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
            res.sendStatus(204);

            console.log(`${notification.subscription.type} notifications revoked!`);
            console.log(`reason: ${notification.subscription.status}`);
            console.log(`condition: ${JSON.stringify(notification.subscription.condition, null, 4)}`);
        }
        else {
            res.sendStatus(204);
            console.log(`Unknown message type: ${req.headers[MESSAGE_TYPE]}`);
        }
    }
    else {
        console.log('403');    // Signatures didn't match.
        res.sendStatus(403);
    }
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
})

function getSecret() {
    // TODO: Get secret from secure storage. This is the secret you pass
    // when you subscribed to the event.
    return 'your secret goes here';
}

// Build the message used to get the HMAC.
function getHmacMessage(request) {
    return (request.headers[TWITCH_MESSAGE_ID] +
        request.headers[TWITCH_MESSAGE_TIMESTAMP] +
        request.body);
}

// Get the HMAC.
function getHmac(secret, message) {
    return crypto.createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

// Verify whether our hash matches the hash that Twitch passed in the header.
function verifyMessage(hmac, verifySignature) {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
