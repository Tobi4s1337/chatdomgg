<!-- source: https://dev.twitch.tv/docs/authentication/revoke-tokens/ -->

Contents

# Revoking Access Tokens  {#revoking-access-tokens}

If your app no longer needs an access token, you can revoke it by sending an HTTP POST request to `https://id.twitch.tv/oauth2/revoke`. The following table lists the x-www-form-urlencoded parameters that you pass in the body of the request.

| Parameter | Required? | Type | Description |
|---|---|---|---|
| client_id | Yes | String | Your app’s client ID. See [Registering your app](/docs/authentication/register-app). |
| token | Yes | String | The access token to revoke. |

The following cURL example shows how to revoke a user or app access token:

```
curl -X POST 'https://id.twitch.tv/oauth2/revoke' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-d 'client_id=<client id goes here>&token=<access token goes here>'

```

If the revocation succeeds, the request returns HTTP status code 200 OK (with no body).

If the revocation fails, the request returns one of the following HTTP status codes:

- 400 Bad Request if the client ID is valid but the access token is not.

```
{
  "status": 400,
  "message": "Invalid token"
}

```
- 404 Not Found if the client ID is not valid.

```
{
  "status": 404,
  "message": "client does not exist"
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
