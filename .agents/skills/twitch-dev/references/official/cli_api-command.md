<!-- source: https://dev.twitch.tv/docs/cli/api-command/ -->

Contents

# Call API endpoints  {#call-api-endpoints}

The `api` command lets you send requests to the [Twitch API](/docs/api/reference) endpoints.

The command’s usage is, `api <method> <template> <flags>`, where:

- <method> is a standard HTTP verb.
- <template> is the template portion of the endpoint’s URI. You may specify the template with or without forward slashes. For example: `/users/follows`, `users/follows`, `users follows`.
- <flags> is used to specify the request’s data and other options.

Check the endpoint’s reference topic to determine what type of access token it requires. For information about getting an app or user access token, see the [token](/docs/cli/token-command) command.

## GET requests  {#get-requests}

To make GET requests, use `twitch api get`. The following table lists the flags that you may specify with GET requests.

| Flag | Shorthand | Description |
|---|---|---|
| --query-param | -q | Use to specify a query parameter. Specify the parameter as a `key=value` pair. Include this flag for each parameter that you specify. If the parameter lets you specify multiple values, include this flag for each value. For example, `-q id=123 -q id=456`. |
| --unformatted | -u | Use to return unformatted responses. The default is to return pretty-print JSON. |
| --autopaginate | -P | Use to return all the data that the response can return instead of just the first page. **Warning** This flag can cause extremely large payloads and may cause issues with some terminals. |

### Examples  {#examples}

```
// Shows specifying multiple values for a single query parameter.

twitch api get /users -q login=loginname1 -q login=loginname2

// Shows specifying multiple query parameters.

twitch api get /users/follows -q from_id=12345678 -q to_id=87654321

```

## POST requests  {#post-requests}

To make POST requests, use `twitch api post`. The following table lists the flags that you may specify with POST requests.

| Flag | Shorthand | Description |
|---|---|---|
| --query-param | -q | Use to specify a query parameter. Specify the parameter as a `key=value` pair. Include this flag for each parameter that you specify. If the parameter lets you specify multiple values, include this flag for each value. For example, `-q id=123 -q id=456`. |
| --body | -b | Use to specify the body of a POST request. The flag’s value is a string-encoded JSON object. Supports CURL-like references to files in the format, `-b @data.json`. You can specify only the file if the file exists in the same folder that the command is executed from; otherwise, you need to include the file’s path (i.e., @path/data.json). |
| --pretty-print | -p | Use to return unformatted responses. The default is to return pretty-print JSON. |

### Examples  {#examples-1}

```
// This POST uses all query parameters to specify the data.

twitch api post /users/follows -q from_id=12345678 -q to_id=87654321

// This POST uses both query parameters and a request body to specify the data.

twitch api post /moderation/enforcements/status -q broadcaster_id=12345678 -b '{"data":[{"msg_id":1,"msg_text":"hello","user_id":87654321}]}'

```

## PUT requests  {#put-requests}

To make PUT requests, use `twitch api put`. The following table lists the flags that you may specify with PUT requests.

| Flag | Shorthand | Description |
|---|---|---|
| --query-param | -q | Use to specify a query parameter. Specify the parameter as a `key=value` pair. Include this flag for each parameter that you specify. If the parameter lets you specify multiple values, include this flag for each value. For example, `-q id=123 -q id=456`. |
| --body | -b | Use to specify the body of a PUT request. The flag’s value is a string-encoded JSON object. Supports CURL-like references to files in the format, `-b @data.json`. You can specify only the file if the file exists in the same folder that the command is executed from; otherwise, you need to include the file’s path (i.e., @path/data.json). |
| --pretty-print | -p | Use to return unformatted responses. The default is to return pretty-print JSON. |

### Examples  {#examples-2}

```
twitch api put users -q description="this is my channel's description"

```

## PATCH requests  {#patch-requests}

To make PATCH requests, use `twitch api patch`. The following table lists the flags that you may specify with PATCH requests.

| Flag | Shorthand | Description |
|---|---|---|
| --query-param | -q | Use to specify a query parameter. Specify the parameter as a `key=value` pair. Include this flag for each parameter that you specify. If the parameter lets you specify multiple values, include this flag for each value. For example, `-q id=123 -q id=456`. |
| --body | -b | Use to specify the body of a PATCH request. The flag’s value is a string-encoded JSON object. Supports CURL-like references to files in the format, `-b @data.json`. You can specify only the file if the file exists in the same folder that the command is executed from; otherwise, you need to include the file’s path (i.e., @path/data.json). |
| --pretty-print | -p | Use to return unformatted responses. The default is to return pretty-print JSON. |

### Examples  {#examples-3}

```
// Updates the game that the broadcaster is playing.

twitch api patch channels -q broadcaster_id=12345678 -b '{"game_id":"394568"}'

```

## DELETE requests  {#delete-requests}

To make DELETE requests, use `twitch api delete`. The following table lists the flags that you may specify with DELETE requests.

| Flag | Shorthand | Description |
|---|---|---|
| –query-param | -q | Use to specify a query parameter. Specify the parameter as a `key=value` pair. Include this flag for each parameter that you specify. If the parameter lets you specify multiple values, include this flag for each value. For example, `-q id=123 -q id=456`. |

### Examples  {#examples-4}

```
// This example removes an EventSub subscription.

twitch api delete eventsub/subscriptions -q id=12345678

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
