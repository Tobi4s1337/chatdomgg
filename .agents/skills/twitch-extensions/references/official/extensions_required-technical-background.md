<!-- source: https://dev.twitch.tv/docs/extensions/required-technical-background/ -->

Contents

# Technical Background  {#technical-background}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Extension Parts  {#extension-parts}

An extension has up to four parts, two required and two optional.

The required parts are:

- An HTML/JavaScript front end for the broadcaster’s installation configuration. This is rendered as part of the normal extension installation flow, permitting one-time or infrequent setup.
- An HTML/JavaScript front end for the viewer’s experience. This is rendered in an iframe (inline frame) on the channel page.

The optional parts are:

- An HTML/JavaScript front end for the broadcaster’s live experience. This is rendered in an iframe on the broadcaster’s live dashboard page. It allows the broadcaster to perform privileged operations while live (e.g., creating a new poll).
- An Extension Backend Service (EBS), which stores data or state and communicates with the front ends, by receiving AJAX requests or using Twitch’s PubSub architecture to broadcast to all viewers.

## Architecture Overview  {#architecture-overview}

The following figure shows the overall architecture of an Extension. In the figure, the box labelled “Front-end JavaScript HTML” represents all three front-end parts mentioned above.

##

## Development and Testing  {#development-and-testing}

An extension’s iframe must import the Extension Helper JavaScript file, created and hosted by Twitch, which provides methods for dealing with authentication, receiving notifications of stream properties, and listening to PubSub events. Twitch PubSub is a system that allows backend services to broadcast real-time messages to clients.

While an extension is being tested, the iframe and all its assets are sourced from a URL provided by the extension developer, allowing rapid development iteration. Once the extension is ready for review by Twitch, and later in production, assets to be hosted by Twitch are copied to the Twitch CDN (Content Delivery Network) and served from there.

## Pop-Out Extensions  {#pop-out-extensions}

Panel Extensions have an icon button that viewers can click to pop out the extension into its own window. If an extension is popped out:

- The extension iframe resizes to take up almost the full size of the new window (all but a minimal, Twitch-controlled UI that wraps the extension).
- The channel page retains a placeholder where the popped-out extension was previously. The placeholder has an icon button for the viewer to return the extension back to its original position on the channel page.

To determine whether an extension is popped out, developers can refer to the query string in the Extension’s iframe URL. The `popout`parameter would be included and set to “true”. For more information about all the parameters, see [Client Query Parameters](/docs/extensions/reference/#client-query-parameters) in the Extensions Reference.

By default, pop-out control is enabled for panel Extensions and for extension “live configuration views” (see the **Live Config Path** setting on the [Asset Hosting](/docs/extensions/life-cycle/#asset-hosting) tab in the Extensions manager).

## Twitch PubSub  {#twitch-pubsub}

The Twitch PubSub system provides an additional channel for your EBS to communicate with your extension. Your extension front end can use AJAX to directly call your EBS to retrieve initial state or send viewer-initiated events (like voting). PubSub is a very efficient way for the EBS to directly broadcast real-time events or provide incremental state changes simultaneously to all instances of your extension.

In a typical use case, your EBS will use the Send Extension PubSub Message endpoint to broadcast messages to viewers. Your Extension front end will then use the Extension Helper to listen for incoming messages. For details, see [PubSub](https://dev.twitch.tv/docs/extensions/reference#send-extension-pubsub-message) in the [Extensions Reference](/docs/extensions/reference).

## JSON Web Tokens (JWTs)  {#json-web-tokens-jwts}

When developing Twitch extensions, it’s important to fully understand how JSON Web Tokens (JWTs) provide secure communication across Twitch, a viewer’s extension, and your EBS. If you are not familiar with JWTs, visit the [official site](https://jwt.io/) for an introduction.

Twitch Extensions uses JWTs in two contexts:

- When an extension is loaded in a broadcaster’s or viewer’s browser, a JWT is signed by Twitch and provided to the Extension Helper’s `onAuthorize`d callback. Whenever your extension communicates with your EBS, it is best practice to send the JWT and verify it using your extension’s shared secret. This allows your EBS to verify that the request was made on behalf of the viewer or broadcaster represented by the token, and it prevents malicious users from directly calling your EBS. For details about the callback, see the [Extensions Reference.](/docs/extensions/reference)
- When an EBS needs to call a Twitch API, it must generate, sign, and include a JWT in the header. This is known as “bearer token authentication.” By signing your own token with the shared secret, Twitch can authenticate that the API request is coming from your EBS.

**Note:** The secret provided to you in the Extensions console is a base64-encoded string. Depending on the JWT library you use, you probably will have to decode the string before using it as a parameter to sign or verify a JWT.

### Example: Verifying a JWT  {#example-verifying-a-jwt}

```
const secret = new Buffer('NOTAREALSECRET==', 'base64');
jwt.verify(token, secret);

```

### Example: Signing a JWT  {#example-signing-a-jwt}

```
const secret = new Buffer('NOTAREALSECRET==', 'base64');
const signedToken = jwt.sign(tokenPayload, secret);

```

## Keep Your Secret Private  {#keep-your-secret-private}

While this code contains the secret as an example, we strongly recommend that you do not store your secret in your code. It is always best practice to store sensitive information such as secrets, keys, and passwords separate from code, using a dedicated secret-management system.

### Authentication Tokens  {#authentication-tokens}

The Extension Helper provides the iframe with an authentication JWT. When the iframe wants to communicate with its EBS, it sends this token in an HTTP header to the EBS. The JWT is signed by Twitch, using a secret shared between Twitch and the extension developer. The EBS can then use this secret to verify the incoming JWT and ensure that received messages are from a legitimate source. Also, the JWT itself contains reliable information about the role of the sender; e.g., whether the incoming message is from a viewer or a broadcaster.

## Opaque IDs  {#opaque-ids}

Opaque IDs identify viewers without revealing the viewer’s Twitch identity. Using an opaque ID, developers can determine a viewer’s authenticated state. Logged-out users also have an opaque ID, but it is not guaranteed to be the same between channels or sessions.

Opaque IDs persist across all channels, and they do not change unless viewers explicitly request a change (rotation). We encourage developers to use their EBS to store per-viewer information, using opaque IDs as keys. If your extension needs to know the viewer’s numeric Twitch ID, use the Request Identity Link field on the Extensions Manager [Capabilities](/docs/extensions/life-cycle/#capabilities) tab.

Note: An opaque ID that begins with “A” is a logged-out user and should not be persisted. It will change every time the logged-out user loads your extension.

The Extension Helper provides opaque identifiers and callback functions that are invoked with context information about the channel being viewed (e.g., video resolution, latency to the broadcaster, and channel ID).

## Focus  {#focus}

When a viewer focuses an extension, Twitch sends focus back to the player, to ensure that keyboard shortcuts for the player continue to work. However, if an extension asks viewers to click on a form field element (for example, `field`, `select`, or `textarea`) and the viewer does so, the focus stays on the form element.

**Note:** The Firefox browser has a known issue that prevents these input types from capturing focus.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
