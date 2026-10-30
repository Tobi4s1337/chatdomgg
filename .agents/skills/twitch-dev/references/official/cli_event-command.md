<!-- source: https://dev.twitch.tv/docs/cli/event-command/ -->

Contents

# Testing webhook events  {#testing-webhook-events}

The `event` command lets you trigger mock events to test your webhook event handler locally. To use this command, you must have implemented an EventSub webhook event handler to process the event messages. For details, see [Handling event notifications](/docs/eventsub/handling-webhook-events).

## Triggering webhook events  {#triggering-webhook-events}

Use the `trigger` sub-command to send mock events. The command’s argument identifies the event to trigger. For example, the following command triggers a Subscribe event.

```
twitch event trigger subscribe -F https://localhost:8080/eventsub/

```

### List of events you can trigger  {#list-of-events-you-can-trigger}

The following is the list of events that you can trigger. Specify these events as arguments of the `trigger` sub-command.

| Argument | Description |
|---|---|
| add-moderator | Triggers a [channel moderator add](/docs/eventsub/eventsub-subscription-types#channelmoderatoradd) event. |
| add-redemption | Triggers a [channel points redemption](/docs/eventsub/eventsub-subscription-types#channelchannel_points_custom_reward_redemptionadd) event. |
| add-reward | Triggers a [channel points custom reward add](/docs/eventsub/eventsub-subscription-types#channelchannel_points_custom_rewardadd) event. |
| ban | Triggers a [channel ban](/docs/eventsub/eventsub-subscription-types#channelban) event. |
| channel-gift | Triggers a [channel subscription gift](/docs/eventsub/eventsub-subscription-types#channelsubscriptiongift) event. |
| charity-donate | Triggers a [charity donation](/docs/eventsub/eventsub-subscription-types#channelcharity_campaigndonate) event. These types of events are sent when a user makes a donation to the broadcaster’s charity campaign. |
| charity-start | Triggers a [charity campaign start](/docs/eventsub/eventsub-subscription-types#channelcharity_campaignstart) event. These types of events are sent when the broadcaster starts a charity campaign. |
| charity-progress | Triggers a [charity campaign progress](/docs/eventsub/eventsub-subscription-types#channelcharity_campaignprogress) event. These types of events are sent when progress is made towards the campaign’s goal or when the broadcaster changes the fundraising goal. |
| charity-end | Triggers a [charity campaign stop](/docs/eventsub/eventsub-subscription-types#channelcharity_campaignstop) event. These types of events are sent when the broadcaster stops a charity campaign. |
| cheer | Triggers a cheer event. Only usable with the `eventsub` transport. |
| drop | Triggers a [Drops entitlement grant](/docs/eventsub/eventsub-subscription-types#dropentitlementgrant) event. |
| gift | Triggers a [gifted subscription](/docs/eventsub/eventsub-subscription-types#channelsubscriptiongift) event for a basic tier 1 sub. |
| goal-begin | Triggers a [creator goal begin](/docs/eventsub/eventsub-subscription-types#channelgoalbegin) event. |
| goal-end | Triggers a [creator goal end](/docs/eventsub/eventsub-subscription-types#channelgoalend) event. |
| goal-progress | Triggers a [creator goal progress](/docs/eventsub/eventsub-subscription-types#channelgoalprogress) event. |
| grant | Triggers a [user authorization grant](/docs/eventsub/eventsub-subscription-types#userauthorizationgrant) event. |
| hype-train-begin | Triggers a channel [hype train begin](/docs/eventsub/eventsub-subscription-types#channelhype_trainbegin) event. |
| hype-train-end | Triggers a channel [hype train end](/docs/eventsub/eventsub-subscription-types#channelhype_trainend) event. |
| hype-train-progress | Triggers a channel [hype train progress](/docs/eventsub/eventsub-subscription-types#channelhype_trainprogress) event. |
| poll-begin | Triggers a channel [poll begin](/docs/eventsub/eventsub-subscription-types#channelpollbegin) event. |
| poll-end | Triggers a channel [poll end](/docs/eventsub/eventsub-subscription-types#channelpollend) event. |
| poll-progress | Triggers a channel [poll progress](/docs/eventsub/eventsub-subscription-types#channelpollprogress) event. |
| prediction-begin | Triggers a channel [prediction begin](/docs/eventsub/eventsub-subscription-types#channelpredictionbegin) event. |
| prediction-end | Triggers a channel [prediction end](/docs/eventsub/eventsub-subscription-types#channelpredictionend) event. |
| prediction-lock | Triggers a channel [prediction lock](/docs/eventsub/eventsub-subscription-types#channelpredictionlock) event. |
| prediction-progress | Triggers a channel [prediction progress](/docs/eventsub/eventsub-subscription-types#channelpredictionprogress) event. |
| raid | Triggers a channel [raid](/docs/eventsub/eventsub-subscription-types#channelraid) event with a random viewer count. |
| remove-moderator | Triggers a channel [remove moderator](/docs/eventsub/eventsub-subscription-types#channelmoderatorremove) event. |
| remove-reward | Triggers a channel points [remove custom reward](/docs/eventsub/eventsub-subscription-types#channelchannel_points_custom_rewardremove) event. |
| revoke | Triggers a [user authorization revoke](/docs/eventsub/eventsub-subscription-types#userauthorizationrevoke) event. Uses the local client specified in `twitch configure` or generates one randomly. |
| stream-change | Triggers a stream changed event. |
| streamdown | Triggers a [stream offline](/docs/eventsub/eventsub-subscription-types#streamoffline) event. |
| streamup | Triggers a [stream online](/docs/eventsub/eventsub-subscription-types#streamonline) event. |
| subscribe-message | Triggers a [subscription message](/docs/eventsub/eventsub-subscription-types#channelsubscriptionmessage) event. |
| subscribe | Triggers a standard [subscription](/docs/eventsub/eventsub-subscription-types#channelsubscribe) event for a basic tier 1 sub. |
| transaction | Triggers a [Bits transactions](/docs/eventsub/eventsub-subscription-types#extensionbits_transactioncreate) events. |
| unban | Triggers a [channel unban](/docs/eventsub/eventsub-subscription-types#channelunban) event. |
| unsubscribe | Triggers a standard [unsubscribe](/docs/eventsub/eventsub-subscription-types#channelsubscriptionend) event for a basic tier 1 sub. |
| update-redemption | Trigger a Channel Points [redemption update](/docs/eventsub/eventsub-subscription-types#channelchannel_points_custom_reward_redemptionupdate) event. |
| update-reward | Triggers a Channel Points [custom reward update](/docs/eventsub/eventsub-subscription-types#channelchannel_points_custom_rewardupdate) event. |
| user-update | Triggers a [user update](/docs/eventsub/eventsub-subscription-types#userupdate) event. |

### Flags to use when triggering events  {#flags-to-use-when-triggering-events}

Use these flags to describe the event’s behavior or to specify its data.

| Flag | Shorthand | Description | Example |
|---|---|---|---|
| --anonymous | -a | Indicates that the event is anonymous. Only applies to `gift` and `cheer` events. | `-a` |
| --charity-current-value | N/A | Use to specify the amount of money that’s donated for charity donation events or the current amount raised for the charity campaign events. | `--charity-current-value 10000` |
| --charity-target-value | N/A | Use to specify the fundraising target amount for the charity campaign events. | `--charity-target-value 10000` |
| --cost | -C | The amount of bits or channel points redeemed/used in the event. | `-C 250` |
| --count | -c | The number of events to trigger. Used to simulate an influx of events. | `-c 100` |
| --description | -d | The title to update or start the stream with. | `-d Awesome new title!` |
| --forward-address | -F | The web server address to send the mock events to. | `-F https://localhost:8080` |
| --from-user | -f | The sender’s user ID. For example, the ID of the user that follows another user, or the user that subscribes to a broadcaster. | `-f 44635596` |
| --game-id | -G | The game ID to use for Drop or other relevant events. | `-G 1234` |
| --gift-user | -g | The user ID of the user that gifted the subscription. Used only for subscription-based events. | `-g 44635596` |
| --item-id | -i | The ID to use for the event payload item (for example, the reward ID in redemption events or the game ID in stream events). | `-i 032e4a6c-4aef-11eb-a9f5-1f703d1f0b92` |
| --item-name | -n | The name to use for the event payload item (for example, the reward ID in redemption events or the game name in stream events). | `-n "Science & Technology"` |
| --secret | -s | The webhook secret used to sign the HMAC (this is the same secret that you specified in the subscription request). The secret is an ASCII string that’s between 10 and 100 characters long, inclusive. | `-s testsecret` |
| --status | -S | The status of the event object. Only applies to channel points redemptions. | `-S fulfilled` |
| --transport | -T | The method used to send events. Default is `eventsub`. | `-T eventsub` |
| --to-user | -t | The receiver’s user ID. Typically, this is the broadcaster’s user ID. | `-t 44635596` |

### Examples  {#examples}

The following examples show how to use the flags.

```
// Triggers a Subscribe event and forwards it to the localhost:8080 server.

twitch event trigger subscribe -F https://localhost:8080/eventsub/

// Triggers a cheer event from user 1234 to user 4567.

twitch event trigger cheer -f 1234 -t 4567 -F https://localhost:8080/eventsub/

```

## Retrigger an event  {#retrigger-an-event}

The `retrigger` sub-command lets you resend previous events using the event’s ID. For example, if the previous event was:

```
{
  "subscription": {
    "id": "713f3254-0178-9757-7439-d779400c0999",
    "type": "channels.cheer",
    ...
  }
}

```

You’d retrigger the event using:

```
twitch event retrigger -i "713f3254-0178-9757-7439-d779400c0999" -F https://localhost:8080/eventsub/

```

### Flags to use when retriggering events  {#flags-to-use-when-retriggering-events}

Use these flags to identify the event and describe the event’s behavior.

| Flag | Shorthand | Description | Example |
|---|---|---|---|
| --forward-address | -F | The web server address to send mock events to. | `-F https://localhost:8080` |
| --id | -i | **Required**. The ID of the event to trigger. | `-i <id>` |
| --secret | -s | The webhook secret used to sign the HMAC (this is the same secret that you specified in the subscription request). The secret is an ASCII string that’s between 10 and 100 characters long, inclusive. | `-s testsecret` |

## Verifying your event handler’s challenge response  {#verifying-your-event-handlers-challenge-response}

The `verify-subscription` sub-command lets you test your event handler’s challenge response. When you subscribe to an event, Twitch verifies that you own the event handler specified in the request by sending your handler a **webhook_callback_verification** notification event. For more information, see [Responding to a challenge request](/docs/eventsub/handling-webhook-events/#responding-to-a-challenge-request).

The following example verifies whether your event handler responds correctly to a challenge event.

```
twitch event verify-subscription cheer -F https://localhost:8080/eventsub/

```

The command’s output indicates whether response and status code are valid. The following shows a valid response.

```
✔ Valid response. Received challenge 5e784545-5a59-a05a-6ae6-cfaf260532f1 in body
✔ Valid status code. Received status 200

```

And this is what the output looks like if the response is malformed.

```
✗ Invalid response. Received  as body, expected b320aef5-dc43-5c42-e93e-9be75882a38c
✔ Valid status code. Received status 204

```

### List of events you can subscribe to  {#list-of-events-you-can-subscribe-to}

The following is the list of events that you can subscribe to. Specify these as arguments of the `verify-subscription` sub-command.

| Argument | Description |
|---|---|
| add-moderator | Triggers a channel moderator add event. |
| add-redemption | Triggers a channel points redemption event. |
| add-reward | Triggers a channel points custom reward add event. |
| ban | Triggers a channel ban event. |
| channel-gift | Triggers a channel gifting event. |
| charity-donate | Triggers a charity donation event. |
| charity-start | Triggers a charity campaign start event. |
| charity-progress | Triggers a charity campaign progress event. |
| charity-end | Triggers a charity campaign stop event. |
| drop | Triggers a Drops entitlement event. |
| gift | Triggers a gifted subscription event for a basic tier 1 sub. |
| goal-begin | Triggers a creator goal begin event. |
| goal-end | Triggers a creator goal end event. |
| goal-progress | Triggers a creator goal progress event. |
| grant | Triggers an authorization grant event. |
| hype-train-begin | Triggers a channel hype train start event. |
| hype-train-end | Triggers a channel hype train end event. |
| hype-train-progress | Triggers a channel hype train progress event. |
| poll-begin | Triggers a channel poll begin event. |
| poll-end | Triggers a channel poll end event. |
| poll-progress | Triggers a channel poll progress event. |
| prediction-begin | Triggers a channel prediction begin event. |
| prediction-end | Triggers a channel prediction end event. |
| prediction-lock | Triggers a channel prediction lock event. |
| prediction-progress | Triggers a channel prediction progress event. |
| raid | Triggers a channel raid event with a random viewer count. |
| remove-moderator | Triggers a channel moderator remove event. |
| remove-reward | Triggers a channel points custom reward remove event. |
| revoke | Triggers a user authorization revoke event. Uses the local client specified in `twitch configure` or generates one randomly. |
| stream-change | Triggers a stream changed event. |
| streamdown | Triggers a stream offline event. |
| streamup | Triggers a stream online event. |
| subscribe-message | Triggers a subscription message event. |
| subscribe | Triggers a standard subscription event for a basic tier 1 sub. |
| transaction | Triggers a Bits in Extensions transactions events. |
| unban | Triggers a channel unban event. |
| unsubscribe | Triggers a standard unsubscribe event for a basic tier 1 sub. |
| update-redemption | Trigger a channel points redemption update event. |
| update-reward | Triggers a channel points custom reward update event. |
| user-update | Triggers a user update event. |

### Flags to use when verifying your web server  {#flags-to-use-when-verifying-your-web-server}

| Flag | Shorthand | Description | Example |
|---|---|---|---|
| --forward-address | -F | **Required**. Your event handler’s web server address. | `-F https://localhost:8080/eventsub` |
| --secret | -s | The webhook secret used to sign the HMAC (this is the same secret that you specified in the subscription request). The secret is an ASCII string that’s between 10 and 100 characters long, inclusive. | `-s testsecret` |
| --transport | -T | The method used to send events. The default is `eventsub`. | `-T eventsub` |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
