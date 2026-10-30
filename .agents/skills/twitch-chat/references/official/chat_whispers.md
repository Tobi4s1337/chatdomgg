<!-- source: https://dev.twitch.tv/docs/chat/whispers/ -->

Contents

# Whispering  {#whispering}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

Whispering is a form of communication on Twitch that allows you to directly message another individual on the service as part of a private communication only the sender and recipient can see.

Twitch allows your chatbot to send Whispers to users using the API, and receive whispers through EventSub.

## Receiving Whispers  {#receiving-whispers}

To be notified when your account receives whispers, you must subscribe to the EventSub subscription [Whisper Received](/docs/eventsub/eventsub-subscription-types/#userwhispermessage) EventSub subscription type. This subscription type requires a User Access Token, and the scope **user:read:whispers** or **user:manage:whispers**.

Once subscribed, EventSub will send you a notification whenever you receive a whisper. An example of this payload:

```
{
  "subscription": {
    "id": "7297f7eb-3bf5-461f-8ae6-7cd7781ebce3",
    "status": "enabled",
    "type": "user.whisper.message",
    "version": "1",
    "condition": {
      "user_id": "423374343"
    },
    "transport": {
      "method": "webhook",
      "callback": "https://example.com/webhooks/callback"
    },
    "created_at": "2024-02-23T21:12:33.771005262Z"
  },
  "event": {
    "from_user_id": "12826",
    "from_user_login": "twitch",
    "from_user_name": "Twitch",
    "to_user_id": "141981764",
    "to_user_login": "twitchdev",
    "to_user_name": "TwitchDev",
    "whisper_id": "3c4719ba-fe16-4c75-8f00-78142a375cf1",
    "whisper": {
      "text": "I have a secret to tell you!"
    }
  }
}

```

## Sending Whispers  {#sending-whispers}

Sending a whisper is performed using the [Send Whisper](/docs/api/reference/#send-whisper) API endpoint.

The request to this API must include:

- A User Access Token that includes the **user:manage:whispers** scope
- The from_user_id query parameter that’s set to the User ID in the User Access Token.
- The to_user_id query parameter that’s set to the user you wish to send the whisper to.
- A body with the following field:

- The `message` field that’s set to the message you wish to send to the target user.

The request will be sent similar to the following:

```
curl -X POST 'https://api.twitch.tv/helix/whispers?from_user_id=12826&to_user_id=141981764' \
-H 'Authorization: Bearer ln6n5azzuliqq57gmncybxrno4fy' \
-H 'Client-Id: hof5gwx0su6onys0nyan9c87zr6t'
-d '{"message":"Hello, friend!"}'

```

If the request succeeds, the response is an HTTP 204 No Content status code.

If the whisper was received by Twitch’s server successfully, but was dropped silently for any reason, the request will still return HTTP 204 No Content status code.

## Whisper Limitations  {#whisper-limitations}

To help prevent abuse of the whisper system, Twitch imposes a number of limitations on whispering:

- The user sending the whisper must have a verified phone number (see the **Phone Number** setting in your [Security and Privacy](https://www.twitch.tv/settings/security) settings).
- Rate Limits: You may whisper to a maximum of 40 unique recipients per day. Within the per day limit, you may whisper a maximum of 3 whispers per second and a maximum of 100 whispers per minute.
- The API may silently drop whispers that it suspects of violating Twitch policies. The Send Whisper API does not indicate that it dropped the whisper; it will return a 204 status code as if it succeeded.
- Verified bots do not have higher whisper rate limits, and there is no way to get a higher whisper limit.
- Whisper messages can only be 500 characters in length if you’ve never whispered the target user before, or 10,000 characters long if you have whispered them before.
- Some users have disabled the ability to send them whispers (see the **Block Whispers from Strangers** setting in your [Security and Privacy](https://www.twitch.tv/settings/security) settings). The API will return a 400 error when attempting to send these users a whisper.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
