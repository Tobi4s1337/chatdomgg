<!-- source: https://dev.twitch.tv/docs/authentication/validate-tokens/ -->

Contents

# Validating Tokens  {#validating-tokens}

The Twitch authorization service provides the `https://id.twitch.tv/oauth2/validate` endpoint that you can use to validate your OAuth access token or discover information about the token, such as when it expires, its scopes, and the user that authorized the client to access their resources.

## Who must validate tokens?  {#who-must-validate-tokens}

Any third-party app that calls the Twitch APIs and maintains an OAuth session **must** call the `/validate` endpoint to verify that the access token is still valid. This includes web apps, mobile apps, desktop apps, extensions, and chatbots. Your app must validate the OAuth token when it starts and on an hourly basis thereafter.

If you’re wondering why you have to validate the token, it’s because of the expectation that if the token becomes invalid [for reasons other than the token expiring](/docs/authentication#tokens-dont-last-forever) (for example, the user disconnected the integration or the token was revoked), your app must end all sessions that use the token. If your app is actively calling the Twitch APIs, you’ll know the token is no longer valid because the APIs will return a 401 status code. But what if your app isn’t actively calling Twitch APIs? It’s for this reason that you must validate the token.

For example, if your app provides a Log in with Twitch feature, the user signs in to the app as a Twitch user, which creates an OAuth session for them. If the user disconnects the integration while still signed in, the expectation is that your app should sign out the user and terminate the OAuth session. To discover that the user has disconnected the integration, the app needs to call the `/validate` endpoint to determine that the token is no longer valid and to sign out the user.

**NOTE** Users disconnect the integration by going to their [connection settings](https://www.twitch.tv/settings/connections) page, finding your app under **Other Connections**, and clicking **Disconnect**. When a user disconnects the integration, Twitch invalidates the access tokens associated with it.

**WARNING** Twitch periodically conducts audits to discover applications that are not validating access tokens hourly as required. If your app shows up in an audit, Twitch will reach out to you to resolve the issue. If the issue is not resolved, Twitch reserves the right to take punitive action, such as revoking the developer’s API key or throttling the application’s performance.

## How to validate a token  {#how-to-validate-a-token}

To validate a token, send an HTTP GET request to `https://id.twitch.tv/oauth2/validate`.

The following cURL example shows the request.

```
curl -X GET 'https://id.twitch.tv/oauth2/validate' \
-H 'Authorization: OAuth <access token to validate goes here>'

```

**NOTE** You may also use the Bearer prefix in place of OAuth in the Authorization header.

If the token is valid, the request returns HTTP status code 200, and contains:

| Parameter | Type | Description |
|---|---|---|
| client_id | String | The Client ID associated with the access token. |
| scopes | String[] | A list of scopes granted to the access token. |
| expires_in | Int | The amount of seconds from now in which the token will expire. |
| login | String | The lowercase username for the user associated with the access token. If the access token is an App Access Token, this field will be **null**. |
| user_id | String | The user ID associated with the access token. If the access token is an App Access Token, this field will be **null**. |

An example response:

```
{
  "client_id": "wbmytr93xzw8zbg0p1izqyzzc5mbiz",
  "login": "twitchdev",
  "scopes": [
    "channel:read:subscriptions"
  ],
  "user_id": "141981764",
  "expires_in": 5520838
}

```

If the token is not valid, the request returns HTTP status code 401 and the response’s body contains the following JSON object:

```
{
  "status": 401,
  "message": "invalid access token"
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
