<!-- source: https://dev.twitch.tv/docs/cli/token-command/ -->

Contents

# Get an access token  {#get-an-access-token}

Use the `token` command to get an access token. [Twitch API endpoints](/docs/api/reference) require an app access token or a user access token (see the endpoint’s reference content for token requirements).

## Prerequisites  {#prerequisites}

Before getting an access token, you must configure the CLI with your application’s client ID and secret. For information, see the [Configure](/docs/cli/configure-command) command.

If you don’t configure the CLI before running the `token` command, you’re prompted to provide your application’s client ID and secret.

## App access token  {#app-access-token}

The following example shows how to get an app access token.

```
% twitch token
2021/10/14 09:30:28 App Access Token: 44xwqk6...

```

## User access token  {#user-access-token}

User access tokens require that the user consent to the application accessing their resources. To get consent, you must set the redirect URL to `http://localhost:3000` when [registering your application](/docs/authentication/register-app).

The following are the flags you use to get a user access token.

| Flag | Shorthand | Description |
|---|---|---|
| --user-token | -u | Tells the `token` command that you want a user access token. |
| --scopes | -s | The space-delimited list of scopes, which identify the resources that the user is giving the app permission to access. To specify multiple scopes, wrap the list in single quotes. |

This example shows how to get a user access token with the **user:read:email** scope set. Note that the call opens a browser to request user consent.

```
% twitch token -u -s user:read:email
Opening browser. Press Ctrl+C to cancel...
2021/10/14 09:54:05 User Access Token: 8yl7k3evyn8...
Refresh Token: dt4z0rc33nz2s4z...
Expires At: 2021-10-14 21:16:33.332005 +0000 UTC
Scopes: [user:read:email]

```

This example shows how to specify multiple scopes.

```
% twitch token -u -s 'user:read:email user:edit'

```

If you’re logged in to Twitch when you request a token, it gets your user information from your log in. Otherwise, you’re prompted for your credentials.

## Revoking access tokens  {#revoking-access-tokens}

To revoke an access token, use the `--revoke` (`-r`) flag. The flag’s parameter identifies the token to revoke.

```
% twitch token -r ke1dlej9...
2021/10/14 10:26:19 Token ke1dlej9... has been successfully revoked.

```

To revoke a token that was created using a different client ID than the one that the CLI is configured with, use the `--client-id` flag.

```
twitch token -r nbrw0pvgp... --client-id t214nt8z1...
2021/10/14 10:53:46 Token nbrw0pvgp... has been successfully revoked.

```

## Next steps  {#next-steps}

Now that you have an access token, you can use the [api](/docs/cli/api-command) command to send requests to API endpoints.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
