<!-- source: https://dev.twitch.tv/docs/extensions/reference/ -->

Contents

# Extensions Reference  {#extensions-reference}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

This reference covers the JavaScript helper, client query parameters, and the JWT schema. For Twitch API endpoints related to Extensions, refer to the [Twitch API reference](/docs/api/reference).

## JavaScript Helper  {#javascript-helper}

| Namespace | See … |
|---|---|
| `window.Twitch.ext` | Helper: Extensions |
| `window.Twitch.ext.actions` | Helper: Actions |
| `window.Twitch.ext.configuration` | Helper: Configuration |
| `window.Twitch.ext.features` | Helper: Feature Flags |
| `window.Twitch.ext.bits` | Helper: Bits |

## Helper: Extensions  {#helper-extensions}

The Extensions JavaScript helper uses these strings:

- `version` — This encodes the Helper version in 1.1.1 ([semantic versioning](https://semver.org/)) format.
- `environment` — This encodes the environment. For external users, this is always `production`.

### onAuthorized  {#onauthorized}

`window.Twitch.ext.onAuthorized: function(authCallback: Function)`

This callback is fired each time the JWT is refreshed.

`authCallback` is a function with one argument, an object with these properties:

| Property | Type | Description |
|---|---|---|
| `channelId` | string | Channel ID of the page where the extension is iframe embedded. |
| `clientId` | string | Client ID of the extension. |
| `token` | JWT | JWT that should be passed to any EBS call for authentication. |
| `helixToken` | JWT | JWT that can be used for front end API requests. See [Using the Twitch API in an Extension Front End](/docs/extensions/frontend-api-usage/). |
| `userId` | string | Opaque user ID. |

For example:

```
window.Twitch.ext.onAuthorized(function(auth) {
  console.log('The JWT that will be passed to the EBS is', auth.token);
  console.log('The channel ID is', auth.channelId);
});

```

Usually, the JWT obtained from this call is passed as a header during AJAX calls to the EBS. For example:

```
window.Twitch.ext.onAuthorized(function(auth) {
  fetch('/<some backend path>', {
      method: 'GET',
      headers:{
        'x-extension-jwt': auth.token,
      },
  })
    .then(...);
});

```

### onContext  {#oncontext}

`window.Twitch.ext.onContext: function(contextCallback: Function)`

This callback is fired when the context of an extension is fired.

`contextCallback` is a function with two arguments, a `context` object and an array of strings naming the `context` properties that were changed. The `context` object has these properties:

| Property | Type | Description |
|---|---|---|
| `arePlayerControlsVisible` | boolean | If `true`, player controls are visible (e.g., due to mouseover). Do not use this for mobile extensions; it is not sent for mobile. |
| `bitrate` | number | Bitrate of the broadcast. |
| `bufferSize` | number | Buffer size of the broadcast. |
| `displayResolution` | string | Display size of the player. |
| `game` | string | Game being broadcast. |
| `hlsLatencyBroadcaster` | number | Number of seconds of latency between the broadcaster and viewer. |
| `hostingInfo` | object | Information about the current channel's hosting status, or `undefined` if the channel is not currently hosting. Host mode enables broadcasters to stream another channel's live broadcast (audio, video, and Extensions), while the host broadcaster is offline or interacting only with chat.This object contains two strings:  - hostedChannelId — Numeric ID of the channel being hosted by the currently visible channel - hostingChannelId — Numeric ID of the host channel |
| `isFullScreen` | boolean | If `true`, the viewer is watching in fullscreen mode. Do not use this for mobile extensions; it is not sent for mobile. |
| `isMuted` | boolean | If `true`, the viewer has muted the stream. |
| `isPaused` | boolean | If `true`, the viewer has paused the stream. |
| `isTheatreMode` | boolean | If `true`, the viewer is watching in theater mode. Do not use this for mobile extensions; it is not sent for mobile. |
| `language` | string | Language of the broadcast (e.g., `"en"`). |
| `mode` | string | Valid values:  - viewer — The helper was loaded in a viewer context, such as the Twitch channel page. - dashboard — The helper was loaded into a broadcaster control context, like the live dashboard. Use this mode to present controls that allow the broadcaster to update the extension's behavior during broadcast. - config — The helper was loaded into the extension dashboard for configuration, including initial configuration. All setup needed to run the extension should be in this mode. |
| `playbackMode` | string | Indicates how the stream is being played. Valid values:  - video — Normal video playback. - audio — Audio-only mode. Applies only to mobile apps. - remote — Using a remote display device (e.g., Chromecast). Video statistics may be incorrect or unavailable. - chat-only — No video or audio, chat only. Applies only to mobile apps. Video statistics may be incorrect or unavailable. |
| `theme` | string | The user's theme setting on the Twitch website. Valid values: `"light"` or `"dark"`. |
| `videoResolution` | string | Resolution of the broadcast. |
| `volume` | number | Currently selected player volume. Valid values: between 0 and 1. |

### onError  {#onerror}

`window.Twitch.ext.onError: function(errorCallback: Function)`

This callback is fired if any errors are generated by the extension helper.

`errorCallback` is a function with one argument, the error value, when any errors occur within the helper.

### onHighlightChanged  {#onhighlightchanged}

`window.Twitch.ext.onHighlightChanged: void function(callback: Function)`

This function allows an extension to adjust its visibility when the viewer highlights the extension by hovering over the extension’s menu icon or open menu, in the video player. The function applies only to video-overlay and component Extensions.

| Argument | Type | Description |
|---|---|---|
| `callback` | function | A callback that is called with one argument:  - isHighlighted — A boolean indicating whether the extension is highlighted by the user. |

### onVisibilityChanged  {#onvisibilitychanged}

`window.Twitch.ext.onVisibilityChanged: void function(callback: Function)`

This function registers a callback that gets called whenever an extension is hidden/re-shown, either due to the viewer’s action or due to extensions hiding due to the video player changing to a state where extensions are not shown (such as when the video pauses or an ad is running). When an extension is not visible, it does not receive `onContext` updates and must perform only minimal work in the background.

| Argument | Type | Description |
|---|---|---|
| `callback` | function | A callback that is called with one or two arguments:  - isVisible — A boolean indicating whether the extension is visible. - context — A fresh context object like the one passed by onContext. context is present only when isVisible is true. |

### send  {#send}

`window.Twitch.ext.send: function(target: String, contentType: String, message: Object)` `window.Twitch.ext.send: function(target: String, contentType: String, message: String)`

This function can be called by the front end to send directly to PubSub. It uses the Twitch-provided JWT for broadcasters, to allow broadcasters to send a broadcast (channel) or whisper message. Broadcasters cannot send to global.

| Argument | Type | Description |
|---|---|---|
| `target` | string | Target topic. Usually this is `"broadcast"` (but it could be `"whisper-<userId>"`). |
| `contentType` | string | Content type of the serialized message; for example, `"application/json"`. |
| `message` | object or string | Either an object that will be automatically serialized as JSON or a string. |

### listen  {#listen}

`window.Twitch.ext.listen: void function(target: String, callback: Function)`

This function binds the `callback` to listen to the `target` topic.

| Argument | Type | Description |
|---|---|---|
| `target` | string | Target topic. Usually this is `"broadcast"` or `"global"` (but it could be `"whisper-<userId>"`).  If an extension front end listens to `"broadcast"` on a channel, it will receive messages sent to the channel, for that extension/channel combination. If it listens to `"global"`, it will see messages sent to global, for all channels with that extension installed.  Non-Extensions PubSub topics also are supported. |
| `callback` | function | Function with three arguments: `target`, `contentType`, and `message`. These fields correspond to the values in the send message, except the message is always a string. |

Whispers are a set of optional PubSub channels that extensions can use. Each copy of an extension can register for `"whisper-<userId>"` where `userId` comes from the onAuthorized message. Attempts to listen to another userId will be blocked. Once the extension is listening, the EBS or broadcaster can send an individualized message to the channel.

### unlisten  {#unlisten}

`window.Twitch.ext.unlisten: void function(target: String, callback: Function)`

This function unbinds the listen `callback` from the `target`.

| Argument | Type | Description |
|---|---|---|
| `target` | string | Target topic. Often this is `"broadcast"` but it might be `"whisper-<userId>"`.  Non-Extensions PubSub topics also are supported. |
| `callback` | function | Function with three arguments: `target`, `contentType`, and `message`. These fields correspond to the values in the send message, except the message is always a string.  This must be the original function object: passing in a new function or a copy of the original has no effect. |

## Helper: Actions  {#helper-actions}

### followChannel  {#followchannel}

`window.Twitch.ext.actions.followChannel: void function(channelName: String)`

This function prompts users to follow the specified channel, with a dialog controlled by Twitch. When users confirm (through the dialog) that they want to follow the channel, the callback registered with `Twitch.ext.actions.onFollow` is invoked.

| Argument | Type | Description |
|---|---|---|
| `channelName` | string | Channel to be followed. |

### minimize  {#minimize}

`window.Twitch.ext.actions.minimize: function()`

This function causes your video-component or video-overlay extension to be minimized.

### onFollow  {#onfollow}

`window.Twitch.ext.actions.onFollow: void function(callback: Function)`

This function registers a callback that is invoked whenever a user completes an interaction prompted by the `followChannel` action.

| Argument | Type | Description |
|---|---|---|
| `callback` | function | Function with two arguments:  - didFollow - A boolean that indicates whether users confirm that they want to follow the channel. - channelName - The channel that was followed. |

### requestIdShare  {#requestidshare}

`window.Twitch.ext.actions.requestIdShare: function()`

This function opens a prompt for users to share their identity. After a successful identity link, the `Twitch.ext.onAuthorized` callback is invoked with the user’s ID. This function has no effect if:

- Your extension does not have identity linking enabled.
- It is called when the extension is installed on the user’s own channel.

## Helper: Configuration  {#helper-configuration}

### broadcaster  {#broadcaster}

`window.Twitch.ext.configuration.broadcaster: {version: string, content: string}|undefined`

This property returns the record for the broadcaster segment if one is found; otherwise, undefined.

### developer  {#developer}

`window.Twitch.ext.configuration.developer: {version: string, content: string}|undefined`

This property returns the record for the developer segment if one is found; otherwise, undefined.

### global  {#global}

`window.Twitch.ext.configuration.global: {version: string, content: string}|undefined`

This property returns the record for the global segment if one is found; otherwise, undefined.

### onChanged  {#onchanged}

`window.Twitch.ext.configuration.onChanged: void function (callback: Function)`

This function registers a callback that is called whenever an extension configuration is received. The callback function takes no input and returns nothing. After this is called for the first time, the records for the global, developer and broadcaster segments will be set if the data is available.

### set  {#set}

`window.Twitch.ext.configuration.set: void function (segment: String, version: String, content: String)`

This function can be called by the front end to set an extension configuration. It uses the Twitch-provided JWT for broadcasters, to allow broadcasters to set a broadcaster configuration segment.

| Property | Type | Description |
|---|---|---|
| `segment` | string | The configuration segment to set. Valid value: `"broadcaster"`. |
| `version` | string | The version of configuration with which the segment is stored. |
| `content` | string | The string-encoded configuration. |

## Helper: Feature Flags  {#helper-feature-flags}

### isBitsEnabled  {#isbitsenabled}

`window.Twitch.ext.features.isBitsEnabled: Boolean`

If this flag is `true`, Bits-in-Extensions features will work in your extension on the current channel.

If this flag is `false`, disable or hide the Bits in Extensions features in your extension.

This flag will be false if:

- You did not enable Bits support in the **Monetization** tab in the Extensions manager.
- The broadcaster is not eligible to receive Bits.
- The broadcaster disabled Bits in Extensions features for your extension.

### isChatEnabled  {#ischatenabled}

`window.Twitch.ext.features.isChatEnabled: boolean`

If this flag is `true`, you can send a chat message to the current channel using [Send Extension Chat Message](/docs/api/reference#send-extension-chat-message) (subject to the authentication requirements documented for that endpoint). This flag may be false if:

- You did not enable the “Chat Capabilities” option for your extension on the Twitch developer site.
- The broadcaster disabled chat for your extension.

### isSubscriptionStatusAvailable  {#issubscriptionstatusavailable}

`window.Twitch.ext.features.isSubscriptionStatusAvailable: boolean`

If this flag is `true`, your extension has the ability to get the subscription status of identity-linked viewers from both the helper in the `window.Twitch.ext.viewer.subscriptionStatus` object and via the Twitch API.

This flag may be false if:

- You did not enable the “Subscription Status” option for your extension on the Twitch developer site.
- The broadcaster did not grant your extension the permission to view their viewer’s subscriber status when they activated the extension, or they revoked that permission from the Manage Permissions page.

### onChanged [features]  {#onchanged-features}

`twitch.ext.features.onChanged: void function(callback: Function(changes: []string))`

This function enables you to receive real-time updates to changes of the `features` object. If this callback is invoked, you should re-check the `window.Twitch.ext.features` object for a change to any feature flag your extension cares about. The callback is called with an array of feature flags which were updated.

`callback` is a function with one argument:

| Argument | Type | Description |
|---|---|---|
| `changed` | string[] | The callback which will be called when feature flags are updated. Feature flags are received in your extension from Twitch asynchronously, after the first call to `onAuthorized`. If you care about only the initial state, you can get that in your `onAuthorized` callback. If you need to know about updates, use `window.Twitch.ext.features.onChanged`. |

## Helper: Bits  {#helper-bits}

Some functions use the `Product` object. Here is an example (fields are described under `getProducts`):

```
{
    "sku": "carrot",
    "displayName": "Carrot",
    "cost": {
        "amount": "500",
        "type": "bits"
    }
    "inDevelopment": true
}

```

### getProducts()  {#getproducts}

`window.Twitch.ext.bits.getProducts: {Promise: Product[]}`

This function returns a promise which resolves to an array of products available for Bits, for the extension, if the context supports Bits in Extensions actions. Otherwise, the promise rejects with an error; this can occur, for instance, if the extension is running in the legacy developer rig or an older version of the mobile app (earlier than V6.4), which does not support Bits in Extensions actions.

Products are returned only if the extension is configured for Bits (see the [Extensions Monetization Guide](/docs/extensions/monetization/)). The products that are returned depend on the state of both the extension version (whether it is released) and the product (whether the kit is in development):

| Is the extension version released? | Which products are returned? | Is the inDevelopment field included in the returned products? |
|---|---|---|
| Yes | Products whose catalog entries specify `inDevelopment` = `false` or `undefined` | No |
| No | All products for that extension | Yes |

Products have the following fields:

| Product Field | Type | Description |
|---|---|---|
| `cost` | Cost | Cost object. |
| `amount` | string | Number of Bits required for the product. |
| `type` | string | Always the string `"bits"`. Reserved for future use. |
| `displayName` | string | Registered display name for the SKU. |
| `inDevelopment` | boolean or undefined | This field is returned only for extension versions that are not in the `Released` state. Valid values:  - true - Indicates that the product's catalog entry specifies it is in development. If the developer tests the use of Bits, the Bits are not deducted from the user's balance. - false - Indicates that the product's catalog entry specifies it is not in development. If the developer tests the use of Bits, the Bits are deducted from the user's balance. - undefined - Indicates that the product's catalog entry does not specify anything about whether it is in development. If the developer tests the use of Bits, the Bits are deducted from the user's balance. |
| `sku` | string | Unique ID for the product. |

### onTransactionCancelled  {#ontransactioncancelled}

`twitch.ext.bits.onTransactionCancelled: void function(callback:Function)`

This function takes a callback that is fired whenever a transaction is cancelled. A transaction can be cancelled in several ways:

- The user clicks the **Cancel** button.
- The user closes the confirmation dialog by clicking outside it.
- The `useBits` function fails and the user dismisses the error dialog that is displayed.

### onTransactionComplete  {#ontransactioncomplete}

`window.Twitch.ext.bits.onTransactionComplete: void function(callback: TransactionObject)`

This function registers a callback that is fired whenever a Bits in Extensions transaction is completed. The callback receives a `TransactionObject` with these fields:

| TransactionObject Field | Type | Description |
|---|---|---|
| `displayName` | string | Display name of the user who executed the Bits in Extensions transaction (i.e., exchanged Bits to "purchase" a Bits in Extensions "product"). |
| `initiator` | enum | Valid values:  - `current_user` - the user who executed, or initiated, the transaction. - `other` - a user other than `current_user`. The `other` value indicates when this message is being sent to a user other than the one who executed the transaction. For example, suppose user A exchanges 10 Bits to set off a firework on a channel. Twitch processes the transaction, then sends a message to all instances of the extension:  - On user A's machine, the extension gets an initiator value of `current_user`. - On the machines of all other users who have the extension, the initiator value is `other`. In this way, the extension can easily display the firework in the browsers of all users who have the extension. |
| `product` | string | If set to `true`, will contain "`inDevelopment`". Otherwise it return blank. |
| `domainID` | string | Will be `twitch.ext` + your extension ID. |
| `transactionID` | string | ID of the transaction. |
| `transactionReceipt` | string | JWT containing the following transaction information in the payload. The JWT is a large, base64-encoded string. It can be verified using your developer secret. (See [https://jwt.io/](https://jwt.io/) for details on JWTs and verification.) |
| `topic` | enum | Indicates the type of receipt. Valid value: `bits_transaction_receipt`. |
| `exp` | string | Unix timestamp when this receipt expires. |
| `data` | JSON | Container for receipt payload data. |
| `product` | string | If set to `true`, will contain "`inDevelopment`". Otherwise it return blank. |
| `domainID` | string | Will be `twitch.ext` + your extension ID. |
| `time` | string | UTC timestamp when this transaction occurred. |
| `transactionId` | string | ID of the transaction. |
| `userId` | string | Twitch ID of the user who executed the transaction. |
| `userId` | string | Twitch ID of the user who executed the transaction. |

### setUseLoopBack  {#setuseloopback}

`window.Twitch.ext.bits.setUseLoopback: boolean`

This function sets the state of the extension helper, so it does not call live services for usage of Bits. Instead, it does a local loopback to the completion handler, after a fixed delay to simulate user approval and process latency.

### showBitsBalance  {#showbitsbalance}

`window.Twitch.ext.bits.showBitsBalance: void`

Call this function when the viewer hovers over a product in your extension UI, to cause the Twitch UI to display a dialog showing the viewer’s Bits balance. The dialog displays for 1.5 seconds, unless your extension calls `showBitsBalance` again, in which case the 1.5-second timer resets.

This is a “fire-and-forget” function: the extension developer does not need to tell Twitch when the viewer stops hovering over the product.

On mobile, this function is ignored.

### useBits  {#usebits}

`window.Twitch.ext.bits.useBits: void function(sku: String)`

This function redeems a product with the specified SKU for the number of Bits specified in the catalog entry of that product. For more information, see [Exchanging Bits for a Product](/docs/extensions/monetization/#exchanging-bits-for-a-product).

## Helper: Viewer  {#helper-viewer}

The Twitch.ext.viewer object is a collection of info about the Twitch viewer that is watching the channel page where your Extension is activated.

Much of the information stored here is also present in the Extension JWT, and is presented as part of this object for convenience. It is passed to the Extension iframe from the client without validation, so it is recommended that you use this info for rendering conditional UI elements, and that you pass the JWT to your EBS for validation if you are using any of this information to grant users permission to take privileged actions within your Extension.

### opaqueId  {#opaqueid}

`window.Twitch.ext.viewer.opaqueId: string`

The opaque id of the viewer.

### id  {#id}

`window.Twitch.ext.viewer.id: string | null`

The Twitch ID of a linked viewer. null if the viewer has not opted to share their identity with the extension.

### role  {#role}

`window.Twitch.ext.viewer.role: string`

The role of the user. See the JWT schema for possible values.

### isLinked  {#islinked}

`window.Twitch.ext.viewer.isLinked: boolean`

Provided as a convenience to check whether or not a user has shared their identity with their extension

### sessionToken  {#sessiontoken}

`window.Twitch.ext.viewer.sessionToken: string`

The encoded JWT. This is the same as the token property of the authData parameter that currently gets passed to the onAuthorized callback.

### helixToken  {#helixtoken}

`window.Twitch.ext.viewer.helixToken: string`

The JWT that can be used for front end API requests. For more information, see [Using the Twitch API in an Extension Front End](/docs/extensions/frontend-api-usage).

### subscriptionStatus  {#subscriptionstatus}

`window.Twitch.ext.viewer.subscriptionStatus: SubscriptionStatus | null`

Subscription status will be an object containing information about the viewer’s subscription. The `SubscriptionStatus` object will have the following properties:

| Property | Type | Description |  |  |  |
|---|---|---|---|---|---|
| `tier` | String | null | The tier of the subscription. Possible values are `1000` | `2000` | `3000` for tier one, two, and three subscriptions respectively. |

The value of `subscriptionStatus` will be `null` if the user is either not a subscriber, or opting not to share their identity. The value will also be `null` if the extension otherwise doesn’t have subscription capabilities.

### onChanged  {#onchanged-1}

`window.Twitch.ext.viewer.onChanged: void function(callback: Function())`

This function binds a callback will be invoked when the viewer’s status changes (e.g. if a viewer subscribes and changes their subscription status).

## Client Query Parameters  {#client-query-parameters}

In addition to the context provided by the Javascript helper’s callbacks, the extension window receives the following query parameters, which indicate information about the extension environment that isn’t subject to change over the frame’s life cycle.

| Name | Type | Description |
|---|---|---|
| `anchor` | string | The type of the anchor in which the extension is activated. Valid only when `platform` is `"web"`. Valid values: `"component"`, `"panel"`, `"video_overlay"`. |
| `language` | string | The user’s language setting (e.g., `"en"`). |
| `locale` | string | The user’s language locale (e.g. `"en-US"`) |
| `mode` | string | The extension’s mode. Valid values: `"config"`, `"dashboard"`, `"viewer"`. |
| `platform` | string | The platform on which the Twitch client is running. Valid values: `"mobile"`, `"web"`. |
| `popout` | boolean | Indicates whether the extension is popped out. If `true`, the extension is running in its own window; otherwise, `false`. |
| `state` | string | The release state of the extension. Valid values: `"testing"`, `"hosted_test"`, `"approved"`, `"released"`, `"ready_for_review"`, `"in_review"`, `"pending_action"`, `"uploading"`. |

## JWT Schema  {#jwt-schema}

| Schema Item | Type | Description |
|---|---|---|
| `channel_id` | string | Numeric ID of the channel from which your front-end is being served. |
| `exp` | NumericDate | Expiration time for the JWT, expressed as seconds since Jan 1, 1970. (For a definition of NumericDate, see [Terminology](https://tools.ietf.org/html/rfc7519#section-2) in the JWT RFC.) |
| `is_unlinked` | boolean | `true` when the token is for a user that previously shared identity; otherwise, `false`. |
| `opaque_user_id` | string | Identifies the session using this JWT. Any token generated by your EBS should leave this field blank. When present, the value is interpreted as follows:  - Values beginning with "U" are stable references to a Twitch account across sessions and channels. You can use them to provide persistent services to users. - Values beginning with "A" are transient references to an anonymous Twitch session; the user has not logged into the Twitch website. These values are not stable and should never be associated with persistent data. It is possible for them to represent different users over time. If your extension requires a stable user identity, your front-end interface should display an appropriate login request when this field does not begin with "U." Broadcasters' tokens are set with "U" + their Twitch user IDs, to avoid confusing opaque IDs with user IDs when the broadcaster is a viewer. |
| `pubsub_perms` | object | Defines the ability of the token holder to send and listen to messages for your extension. `pubsub_perms` contains two arrays: `listen` and `send`, which contain the topics the associated user is allowed to listen to and publish to, respectively.  A wildcard/asterisk means the associated user can listen/publish to all topics associated with that extension/channel combination. A list of specific values means only the specified targets are allowed. If a permission is absent, it is equivalent to the empty listing: there are no default allowed targets. When sending messages from the EBS, specify an asterisk as the `send` permission, to allow the message to pass through the system.  For an example, see Example JWT Payload. |
| `role` | string | Type of user for whom this JWT has been signed. This is required. Valid values:  - broadcaster — The owner of the channel, who should have configuration rights. - moderator — A viewer who has moderation rights on the channel. This is provided only for users who allow your extension to identify them. - viewer — A user watching the channel. - external — The token is not from a Twitch token generator. Your EBS should use this value to generate tokens when it broadcasts messages. Multiple endpoints require this role. |
| `user_id` | string | The user's Twitch user ID. This is provided only for users who allow your extension to identify them. There are no guarantees this will be available, as users can revoke an extension's ability to identify them at any time. Users who revoke an extension's ability to identify them are issued a new opaque identifier. |

### Example JWT Payload  {#example-jwt-payload}

```
{
  "exp": 1484242525,
  "opaque_user_id": "UG12X345T6J78",
  "channel_id": "test_channel",
  "role": "broadcaster",
  "is_unlinked": "false",
  "pubsub_perms": {
    "listen": [ "broadcast", "whisper-UG12X345T6J78" ],
    "send": ["broadcast","whisper-*"]
  }
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
