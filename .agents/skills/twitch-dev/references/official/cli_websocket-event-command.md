<!-- source: https://dev.twitch.tv/docs/cli/websocket-event-command/ -->

Contents

# Testing WebSocket Events  {#testing-websocket-events}

[BETA](/docs/product-lifecycle) The `event` command includes the `websocket start-server` subcommand that starts a mock WebSocket server that you can use to test your client.

To use this command, you must first implement a WebSocket client that handles the server’s messages. For details, see [Getting Events Using WebSockets](/docs/eventsub/handling-websocket-events).

## Starting the server  {#starting-the-server}

Use the `websocket start-server` subcommand to start a mock WebSocket server that you use to test your client. In a terminal window, enter:

```
twitch event websocket start-server

```

The mock EventSub WebSocket server should start with messages like this:

```
% twitch event websocket start-server
2023/03/19 11:45:17 `Ctrl + C` to exit mock WebSocket servers.
2023/03/19 11:45:17 Started WebSocket server on 127.0.0.1:8080

2023/03/19 11:45:17 Simulate subscribing to events at: http://127.0.0.1:8080/eventsub/subscriptions
2023/03/19 11:45:17 POST, GET, and DELETE are supported
2023/03/19 11:45:17 For more info: https://dev.twitch.tv/docs/cli/websocket-event-command/#simulate-subscribing-to-mock-eventsub

2023/03/19 11:45:17 Events can be forwarded to this server from another terminal with --transport=websocket
Example: "twitch event trigger channel.ban --transport=websocket"

2023/03/19 11:45:17 You can send to a specific client after its connected with --session
Example: "twitch event trigger channel.ban --transport=websocket --session=e09efae0_8775fbe4"

2023/03/19 11:45:17 For further usage information, please see our official documentation:
https://dev.twitch.tv/docs/cli/websocket-event-command/

2023/03/19 11:45:17 Connect to the WebSocket server at: ws://127.0.0.1:8080/ws

```

To end the server, enter `Ctrl + C` on your keyboard.

### Connecting to the server  {#connecting-to-the-server}

The URI that you use in your client code to connect your client to the server is: `ws://localhost:8080/ws`.

After connecting your client to the server, the server sends the client a [Welcome](/docs/eventsub/handling-websocket-events#welcome-message) message followed by [Ping](/docs/eventsub/handling-websocket-events#ping-message) and [Keepalive](/docs/eventsub/handling-websocket-events#keepalive-message) messages.

## Forwarding mock events to clients  {#forwarding-mock-events-to-clients}

Once the server is running, open another terminal window and execute normal EventSub events, using `twitch event trigger`, with the additional flag `--transport=websocket`
To successfully forward mock events you must have at least one client already connected to your local WebSocket server. If there is not, a failure message will appear when you execute the command.

In a terminal window, the command should be executed like this:

```
twitch event trigger channel.ban --transport=websocket

```

By default, this will send to every client connected to the WebSocket server. If you prefer to target a specific client, you can specify its session ID with the `--session` flag:

```
twitch event trigger channel.ban --transport=websocket --session=e411cc1e_a2613d4e

```

## Simulate subscribing to mock EventSub  {#simulate-subscribing-to-mock-eventsub}

Running the server allows access to both a mock WebSocket server and a mock EventSub endpoint: `http://localhost:8080/eventsub/subscriptions`

This endpoint simulates all the features provided by the [EventSub Subscription API endpoints](/docs/api/reference/#create-eventsub-subscription). This feature is **optional**, and is not required to forward mock EventSub events to your client, except when you have the `--require-subscription` flag enabled.

If you used the `--require-subscription` flag, you also must subscribe to at least one EventSub event or the server will disconnect your client and send the Close message “Connection unused”.

## Testing Reconnect Messages  {#testing-reconnect-messages}

Occasionally Twitch’s EventSub WebSocket server will need to drop connections. When this occurs a Reconnect message is sent, subscriptions are saved, and the client will need to drop within 30 seconds to connect to the new URL.

To simulate this case within your local WebSocket server, from another terminal window you can run

```
twitch event websocket reconnect

```

This will immediately start another WebSocket server in the background that can be accessed at the same WebSocket URL endpoint. Clients connecting to the endpoint will be sent to the new server, and reconnecting with the provided `reconnect_url` will restore subscriptions you previously made. Clients should follow the [Reconnect flow](/docs/eventsub/handling-websocket-events/#reconnect-message) exactly as described to ensure no messages or subscriptions are dropped.

After 30 seconds all clients still connected to the old WebSocket server will be automatically disconnected with the Close message “Reconnect grace time expired”.

## Advanced Testing  {#advanced-testing}

While most common features are available through the WebSocket server’s normal operation, there is the ability to simulate additional features, including all Close message codes and changing subscription statuses.

### Close Messages  {#close-messages}

Through normal operation, the local WebSocket server will send about half of the [Close](/docs/eventsub/handling-websocket-events/#close-message) messages. To simulate any specific Close message you can immediately disconnect the client by executing `twitch event websocket close`

In this command you must specify flags:

- The `--session` flag, containing the targeted client’s `session_id` given in the [Welcome](/docs/eventsub/handling-websocket-events/#welcome-message) message.
- The `--reason` flag, with the [Close message code](/docs/eventsub/handling-websocket-events/#close-message) corresponding with the Close message you wish to send to the client.

```
twitch event websocket close --session=05d9cfeb_cf06ebe7 --reason=4006

```

### Modifying Subscription Statuses  {#modifying-subscription-statuses}

When running GET EventSub Subscriptions to the mock EventSub endpoints provided earlier, the server will only be able to set EventSub subscriptions to a status that is relevant to the operation of the server.

You can override the Status field that is set for a specific Subscription by executing `twitch event websocket subscription`

In this command you must specify flags:

- The `--status` flag, with the [status type](/docs/api/reference/#get-eventsub-subscriptions) you wish to set the Subscription’s Status to.
- The `--subscription` flag, with the Subscription ID provided when you subscribe to the mock Create EventSub Subscription endpoint.

## Reference  {#reference}

### Flags used with start-server  {#flags-used-with-start-server}

Use these flags to change the server’s behavior or send additional messages. All flags are optional.

| Flag | Shorthand | Description | Example |
|---|---|---|---|
| --port | -p | Use to specify the port number the websocket server will bind to. The syntax is `--port <number>`. The default is 8080. | `-p 3000` |
| --ip |  | Use to specify the IP address the websocket server will bind to. The syntax is `--ip <ip address>`. The default is localhost. | `--ip 127.0.0.1` |
| --require-subscription | -S | Prevents the server from allowing subscriptions to be forwarded unless they have a subscription created.  Also enables 10 second subscription requirement when a client connects. | `-S` |
| --ssl |  | Enables SSL on the websocket server, and changes connection protocols from `http` and `ws` to `https` and `wss`. SSL is not required for normal testing, and SSL is disabled on the websocket server by default. Requires proper certificate files to start the server with this flag. | `--ssl` |

### Flags used with all other sub-commands  {#flags-used-with-all-other-sub-commands}

| Flag | Shorthand | Description | Example |
|---|---|---|---|
| --session | -s | Targets a specific client by the `session_id` given during its Welcome message. | `twitch event websocket close --session=e411cc1e_a2613d4e` |
| --reason |  | Specifies the Close message code you wish to close a client’s connection with.  Only used with “twitch websocket close”. | `twitch event websocket close --reason=4006` |
| --status |  | Specifies the Status code you wish to override an existing subscription’s status to.  Only used with “twitch websocket subscription”. | `twitch event websocket subscription --status=user_removed` |
| --subscription |  | Specifies the subscription ID you wish to target.  Only used with “twitch websocket subscription”. | `twitch event websocket subscription --subscription=48d3-b9a-f84c` |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
