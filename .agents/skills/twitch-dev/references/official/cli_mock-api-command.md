<!-- source: https://dev.twitch.tv/docs/cli/mock-api-command/ -->

Contents

# Generating mock data and starting the server  {#generating-mock-data-and-starting-the-server}

**NOTE: The `mock-api` command is in open beta. Please file all issues and bugs using [GitHub Issues](https://github.com/twitchdev/twitch-cli/issues).**

Use the `mock-api` command to create mock data and a mock server that you can use to develop and test your application.

## Generating the data  {#generating-the-data}

To generate mock data, use the `generate` sub-command. This command generates the specified number of users and related resources, such as subscriptions, streams, and teams, locally.

By default, `generate` creates mock data for 10 users.

```
% twitch mock-api generate

```

If the default number of users is sufficient, you don’t need to run `generate` because running `start` will automatically generate the mock data for you, if it hasn’t already been generated.

To specify a different number of users, use the –count (-c) flag. Remember, when specifying a larger number of users, the data is stored locally .

```
% twitch mock-api generate -c 6

```

The following terminal output shows what `generate` returns. The output identifies the user with partner privileges that it created, and the client ID it registered for you. Don’t worry about capturing this information because you can get it later.

```
2021/10/15 08:38:40 Creating categories...
2021/10/15 08:38:40 Creating users...
2021/10/15 08:38:40 Creating team...
2021/10/15 08:38:40 Creating channel points rewards and redemptions, follows, blocks, mods, bans, editors, and team members...
2021/10/15 08:38:40 Creating streams...
2021/10/15 08:38:40 Creating tags...
2021/10/15 08:38:40 Creating stream tags, videos, clips, and stream markers...
2021/10/15 08:38:40 User ID 29405430 has all applicable units (streams, subs, and the like) and is a partner for use with the API
2021/10/15 08:38:40 Created Client. Details:
Client-ID: cb7b5eba670c41fa757410b811601b
Secret: f40fbf26d4e2c20de5772e4408589c
Name: Mock API Client
2021/10/15 08:38:40 Created authorization with token 2056dbbed991d96
2021/10/15 08:38:40 Finished generation.

```

Note that if you run `generate` multiple times, it appends the data instead of overwriting it.

### Removing mock data  {#removing-mock-data}

To remove the mock data:

- Stop the server if it’s running
- On macOS, navigate to `$HOME/.twitch-cli`
- Delete eventCache.db

### Discovering the mock data  {#discovering-the-mock-data}

To discover the mock data that `generate` creates for you, send the following GET requests:

- /categories
- /clients
- /streams
- /subscriptions
- /tags
- /teams
- /users
- /videos

The base URI for these requests is: `http://localhost:8080/units`. The requests do not require an access token or client ID, and they return all mock data for the resource. For an example, see Getting your client ID and secret.

## Starting the server  {#starting-the-server}

To start the mock data server, use the `start` sub-command. If you haven’t already used the `generate` sub-command to create the mock data, `start` generates the mock data with 10 users.

The following example shows how to start the server.

```
% twitch mock-api start

```

The server writes each request that you send:

```
2021/10/15 09:06:03 Starting mock API server on http://localhost:8080
2021/10/15 09:06:03 Mock server started
2021/10/15 09:32:22 GET /units/clients
2021/10/15 10:01:54 POST /auth/authorize
2021/10/15 10:03:39 POST /auth/token
2021/10/15 10:30:15 GET /mock/users

```

### Changing the port  {#changing-the-port}

The default port that the server uses is 8080. To change the port number, include the -p flag.

```
% twitch mock-api start -p 8000

```

### Stopping the server  {#stopping-the-server}

To stop the server, enter `<ctrl+c>`.

### Calling Twitch API endpoints  {#calling-twitch-api-endpoints}

The mock server replicates a majority of the [Twitch API](/docs/api/reference) endpoints except for endpoints related to:

- Extensions
- Code entitlements
- EventSub

It is possible that the mock server may get out of sync with the Twitch production API. If you notice an issue, please raise it in [GitHub Issues](https://github.com/twitchdev/twitch-cli/issues).

To call the mock APIs, replace the Twitch API’s base URI, `https://api.twitch.tv/helix` with `http://localhost:8080/mock`.

Just like with the Twitch APIs, the mock APIs require an access token. For information about getting an access token, see Getting an access token.

The following example shows how to get information about a user.

```
curl -i -X GET 'http://localhost:8080/mock/users?id=29405430' \
-H 'Client-Id: cb7b5eba670c41fa757410b811601b' \
-H 'Authorization: Bearer ebf5a366721754b'

```

And this example shows how update a user. Remember to URL-encode the query parameters.

```
curl -i -X PUT 'http://localhost:8080/mock/users?description=my%20really%20cool%20channel%202' \
-H 'Client-Id: cb7b5eba670c41fa757410b811601b' \
-H 'Authorization: Bearer 03040b246f7f6bc'

```

## Getting an access token  {#getting-an-access-token}

The mock API supports getting an OAuth app access token and a user access token, but does not support getting a JWT (OIDC) token. All tokens expire after 24 hours.

### Getting your client ID and secret  {#getting-your-client-id-and-secret}

To get an access token, you need a client ID and secret. The mock data includes a client ID and secret that you use to get an access token. The following example shows how to get the client ID and secret.

```
curl -X GET 'http://localhost:8080/units/clients'

```

The `ID` field contains your client ID, and the `Secret` field contains your secret.

```
{
  "cursor": "",
  "total": 1,
  "data": [
    {
      "ID": "cb7b5eba670c41fa757410b811601b",
      "Secret": "f40fbf26d4e2c20de5772e4408589c",
      "Name": "Mock API Client",
      "IsExtension": false
    }
  ]
}

```

### Getting a user access token  {#getting-a-user-access-token}

To get a user access token, send a POST request to `http://localhost:8080/auth/authorize`.

The following table provides the list of query parameters that you must specify in the request.

| Query Parameter | Description |
|---|---|
| client_id | The client ID that the generate sub-command created for you. To get the ID programmatically, see Getting your client ID and secret. |
| client_secret | The client secret that the `generate` sub-command created for you. To get the secret programmatically, see Getting your client ID and secret. |
| grant_type | Must be set to `user_token`. |
| user_id | The user to get the token for. |
| scope | A space-delimited list of scopes to request for the given user. For the required scopes, see the documentation for the endpoints you plan to call. Remember to URL-encode the list. |

The following example shows how to get a user access token.

```
curl -X POST 'http://localhost:8080/auth/authorize?client_id=cb7b5eba670c41fa757410b811601b&client_secret=f40fbf26d4e2c20de5772e4408589c&grant_type=user_token&user_id=29405430&scope=user:read:email%20user:edit'

```

The response does not include a refresh token.

```
{
  "access_token": "ebf5a366721754b",
  "refresh_token": "",
  "expires_in": 86399,
  "scope": [
    "user:read:email",
    "user:edit"
  ],
  "token_type": "bearer"
}

```

### Getting an app access token  {#getting-an-app-access-token}

To get an app access token, send a POST request to `http://localhost:8080/auth/token`.

The following table provides the list of query parameters that you must specify in the request.

| Query Parameter | Description |
|---|---|
| client_id | The client ID that the generate sub-command created for you. To get the ID programmatically, see Getting your client ID and secret. |
| client_secret | The client secret that the `generate` sub-command created for you. To get the secret programmatically, see Getting your client ID and secret. |
| grant_type | Must be set to `client_credentials`. |

The following example shows how to get an app access token.

```
curl -X POST 'http://localhost:8080/auth/token?client_id=cb7b5eba670c41fa757410b811601b&client_secret=f40fbf26d4e2c20de5772e4408589c&grant_type=client_credentials'

```

The response does not include a refresh token.

```
{
  "access_token": "58e21972d01ab5b",
  "refresh_token": "",
  "expires_in": 86399,
  "scope": [],
  "token_type": "bearer"
}

```

## Next steps  {#next-steps}

To learn how to trigger mock events for local webhook testing, see the [event](/docs/cli/event-command) command.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
