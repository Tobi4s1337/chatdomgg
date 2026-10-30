<!-- source: https://dev.twitch.tv/docs/extensions/building/ -->

Contents

# Building Extensions  {#building-extensions}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Creating An Extension Front End  {#creating-an-extension-front-end}

As previously defined, extensions are front-end iframes. Now that you have created your extension and defined its settings, you are ready to create the assets that will live within the iframe.

### Mobile Support  {#mobile-support}

If your extension is intended for mobile devices, you can provide a second front end for those devices. You can use an identical front end for mobile and web, if it is responsive enough to render and perform well on both platforms; otherwise, submit different front ends.

On the Twitch developer site, you are prompted to submit separate front ends for web and mobile. If you use the same viewer HTML for both web and mobile, we enable you to customize your behavior based on the native platform by providing your viewer with the query strings `?platform=mobile` and `?platform=web`.

Proper layout, rendering, performance, and interaction on mobile devices are not the same as they are on the web, so if you provide mobile support, test your extension thoroughly on the Twitch mobile app.

**Note:** As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the “iOS Allowlist Request” form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

### Extension Helper Library  {#extension-helper-library}

An extension’s iframe must import the Extension Helper JavaScript file, created and hosted by Twitch. It provides methods for dealing with authentication, receiving notifications of stream properties, and listening to PubSub events. All HTML files included in your Extension must load the Extension Helper. To do so, include this line:

```
<script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"></script>

```

For details on the Extension Helper, including the callbacks and functions it provides, see the [Extensions Reference](/docs/extensions/reference/).

## Creating Your Extension Backend Service (EBS)  {#creating-your-extension-backend-service-ebs}

The EBS is your optional backend service that supports the extension. Your EBS can be written in whatever language you prefer. Depending on the nature of your extension, it generally should be capable of the operations described below.

Note: An extension without an EBS usually acts as a display panel for 3rd party API calls (like a Twitch recent follower list). An EBS is unnecessary in such cases because an existing service can perform all the work necessary to generate content. Many popular utility extensions are “display only”.

### Verifying the JWT  {#verifying-the-jwt}

Your EBS needs to verify the communication it receives via any AJAX call from your extension. For example, it may need to enforce a policy that certain configuration tasks can be performed only by broadcasters. It also may want to ensure that a confirmed Twitch viewer, as opposed to an unidentified agent, is connecting to the EBS. As described above, the front-end iframe can obtain a signed JWT via the Extension Helper, using the `onAuthorized()` callback. The extension developer may then include this token as a header when making AJAX calls to the EBS.

JWT signing and validation libraries are available for many languages at [JWT](https://jwt.io). They usually follow a calling interface similar to this:

```
verify(<jwt>, <secret>)

```

Where:

- `<jwt>` is the token received from the Twitch backend via the Extension Helper and passed as a header to the EBS.
- `<secret>` is the previously established shared secret. For more information about secrets, see the next section (Signing the JWT).

The JWTs used by Twitch Extensions expire, and verification of them fails after the expiration date. The Extension Helper automatically refreshes the token and then re-calls the `onAuthorized()` callback. Always use the latest JWT supplied by the Extension Helper.

For the full JWT schema and detailed notes on each field, see the “[JWT Schema](/docs/extensions/reference/#jwt-schema)” section of the [Extensions Reference](/docs/extensions/reference).

### Signing the JWT  {#signing-the-jwt}

In addition to verifying tokens signed by the Extension Helper, your EBS needs to be able to sign new JWTs for calls to various Extensions endpoints that use JWT as the authentication mechanism. Use the following format for the payload object in a JWT signed by your EBS:

```
{
  "exp": 1502646259,
  "user_id": "27419011",
  "role": "external"
}

```

Where:

- `exp` is the Unix epoch timestamp when the payload will expire. Be sure to provide a buffer, to allow potential positive time drift.
- `user_id` is the Twitch user ID, as a string, that owns the extension.
- `role` is set to the string `external`.

For more information about these fields, see the [“JWT Schema”](/docs/extensions/reference/#jwt-schema) section of the the [Extensions Reference](/docs/extensions/reference).

Sign the payload using your [JWT library](https://jwt.io/) of choice, which usually has a calling interface similar to this:

```
sign(<payload>, <secret>)

```

Where:

- `<payload>` is the token object created in the previous step.
- `<secret>` is the previously established shared secret.

Note: If the call fails, consult the documentation for your software library for the details on formatting the call.

The shared secret is located in the **Key** field under **Extension Client Configuration** on your extension’s **Extension Settings** page. The secret is base64 encoded, but some JWT libraries might expect the secret to be a byte array instead. For example, to sign the JWT using the [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) Node.js package, you need to convert the base64 secret to a byte array.

```
const jwt = require('jsonwebtoken')

const sharedSecret = 's7sK6iKws1KS+ihSERL7fgoT8rx90iFkJ/hUdcAEGSs='
const broadcasterId = '12345678'
const tokenPayload = {
    user_id: broadcasterId,
    role: 'external'
}

const token = jwt.sign(tokenPayload, Buffer.from(sharedSecret, 'base64'), { expiresIn: '1d' })
console.log("token: " + token)

```

Finally, send your signed JWT in the request header, following this format:

```
Authorization: Bearer <signed JWT>

```

### Broadcasting via PubSub  {#broadcasting-via-pubsub}

When the EBS wants to transmit real-time messages or state via PubSub, it will use the [Send Extension PubSub Message](/docs/api/reference#send-extension-pubsub-message) endpoint. Using this endpoint, your EBS can broadcast to all viewers of a given channel or to specific users via a whisper.

Adhere to these limits for Twitch PubSub traffic:

- 1 message per second per channel
- 5 KB message size

These rules ensure the stability and scalability of our systems.

### Required Configurations  {#required-configurations}

If you specify configuration information in your EBS, you can optionally require that a broadcaster successfully configures your extension before activation is allowed. This can be useful if, for example, an active extension would show a confusing error message to all viewers if misconfigured. You enforce required broadcaster configuration with a string in the **Required Configurations** field. The contents of this string can be whatever you want. By using the string you provide in this field, you can easily require different configurations from version to version, so that if a new version requires reconfiguration, the broadcaster will need to complete configuration before activating the new version.

Once your EBS determines that the extension is correctly configured on a channel, call the [Set Extension Required Configuration](/docs/api/reference#set-extension-required-configuration) endpoint.

## Using the Configuration Service  {#using-the-configuration-service}

The configuration service enables you to store persistent per-channel and per-extension data and have it provided to your front end on extension startup. This is a common need for most extensions. With the configuration service, you can quickly support scenarios like:

- Enabling broadcasters to customize your extension.
- Storing user IDs to call third-party APIs from your EBS. Note that this information becomes public when it is stored. All data is sent to extension views by anonymous users, so no authentication is required to retrieve it.
- Saving extension-wide settings.

More importantly, with the configuration service, you do not need to expose your EBS to the extension front end on initial load, eliminating the need for your EBS to scale to support that scenario. In some cases, you can build an extension without an EBS, just by using the configuration service. (You can still build this functionality in your EBS, if you choose.)

You choose whether to use the configuration service in the capabilities section of extension management on the developer site. To make your choice, select one of the options (“No configuration”, “Custom/My Own Service”, or “Extension Configuration Service”) on the radio control on that page. Note that the page also controls whether the extension opts into other features such as identity linking and chat injection.

After making your choice, data that is set via either [Set Extension Configuration Segment](/docs/api/reference#set-extension-configuration-segment) or the set helper function (see [Helper: Configuration](/docs/extensions/reference/#helper-configuration)) will be provided to the extension during bootstrap.

**Note**: Extension configuration segments set are limited to 5 KB.

An extension configuration has three types of configuration segments:

| Segment Type | Is delivered to ... | Can be set by ... |
|---|---|---|
| Developer | Views of your extension on the associated channel. | Developers |
| Broadcaster | Views of your extension on the associated channel. | Developers and broadcasters |
| Global | Every view of your extension, regardless of the channel. | Developers |

For Extension examples that leverage the configuration service see the [Twitch API Reference](/docs/api/reference#set-extension-required-configuration). Also, see these repositories:

- [https://github.com/twitchdev/bot-commander](https://github.com/twitchdev/bot-commander)
- [https://github.com/twitchdev/animal-facts](https://github.com/twitchdev/animal-facts)

### Setting Required Configuration with the Configuration Service (Optional)  {#setting-required-configuration-with-the-configuration-service-optional}

Extensions can choose to use the configuration service and then make a second choice to display without configuration:

- If you don’t require configuration, the assumption is that your extension code assumes default values until it is configured. This case is useful if you want to use the configuration service to track broadcaster preferences instead of required settings.
- If you do require configuration, the extension won’t render until the broadcaster has configured it. In this case, you must specify versions of the broadcaster and developer configuration segments in two places. First, set the required versions on the Extensions manager [Capabilities](/docs/extensions/life-cycle/#capabilities) tab. Second, on the extension side, set versions when you set configuration (via the helper method or the API). Note that these two settings are compared when the channel is loaded. If they do not match, the extension will not load.

## Managing Extension Secrets  {#managing-extension-secrets}

Each extension maintains a shared secret that is used to sign and verify JSON Web Tokens (JWT) that provide the identity of users. Use this authentication method when making Extensions API calls from your EBS (for endpoints that support it).

Twitch extension technology relies on a secret shared between the Twitch API and the EBS, to validate JWTs. This secret has an extremely long life (100 years); however, we strongly recommend that extension developers rotate the shared secret often, to better ensure its security.

### JWT Roles  {#jwt-roles}

Both the EBS and Twitch create JWTs.

The EBS should create and sign JWTs with the `external` role to perform API actions. Twitch creates JWTs with other roles, so the EBS can perform user authentication. Both use cases (the `external` role and other roles) use the same secret. (For a discussion of roles, see the “[JWT Schema](/docs/extensions/reference/#jwt-schema)” section of the [Extensions Reference](/docs/extensions/reference).)

### Creating Secrets  {#creating-secrets}

To create a new secret:

- Go to the **Settings** page of your extension in the Extensions console.
- On the left panel, click **Secret Keys**.
- Click **Create New Secret** to generate a new secret key. You will see the following:

- **Key** — The secret, base64 encoded.
- **Active** — UTC timestamp when the secret becomes active. This allows the secret to propagate through both Twitch servers and the EBS, before you use it.
- **Expires** — Timestamp when the secret expires. This is the latest time to use this secret to verify a JWT; the JWT should be discarded after this time.

Optionally, you can create new secrets with the [Create Extension Secret](/docs/api/reference#create-extension-secret) endpoint.

Note: Each time a new secret is requested, the old one is updated to expire after one hour (enough time for Twitch clients to rotate over to the new secret smoothly).

### Rotating Secrets  {#rotating-secrets}

To keep your secrets from becoming useless, you must rotate them before they expire. To do so, create a new secret on the extension’s **Settings** page under **Secret Keys**. The table will update, showing when the previous key will expire and the new key will be active.

Because of the activation delay, you can have multiple secrets active for some (configurable) period of time. For signing, use the active secret with the latest expiration time.

For a higher level of security, you can rotate secrets programmatically on a scheduled basis. For more information, see the [Extensions Reference](/docs/extensions/reference/).

### Revoking Secrets  {#revoking-secrets}

**Note:** This option is for emergency situations where a secret has been compromised and breaking the extension is preferable to waiting for the secret to cycle.

At any time, if your secrets are compromised, you can use the **Revoke All Secrets** option on the extension’s **Settings** page under **Secret Keys**. View this as a kill switch: it immediately deletes all secrets associated with a specified extension.

Optionally, you can revoke all secrets by using the [Create Extension Secret](/docs/api/reference#create-extension-secret) endpoint, which rotates any current secrets out of service.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
