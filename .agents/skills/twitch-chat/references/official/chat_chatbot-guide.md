<!-- source: https://dev.twitch.tv/docs/chat/chatbot-guide/ -->

Contents

# Example Chatbot  {#example-chatbot}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

This example shows a simple bot that runs locally. This chatbot uses [EventSub WebSockets](/docs/eventsub/handling-websocket-events/) to listen to chat messages in a given channel, and uses to Twitch API to respond to the message “HeyGuys” with the emote “VoHiYo”. This example uses [this websocket package for Node.js](https://github.com/websockets/ws) and Node.js 20. If using Node.js 22 or later, WebSockets are included in the standard library, and you can remove the websocket package dependency.

## How to set up and run the code  {#how-to-set-up-and-run-the-code}

- Open a terminal window and create a folder named heyguys-bot.
- Change to the heyguys-bot folder.
- Enter **npm init**. Use **bot.js** for the entry point.
- Enter **npm install ws**.
- Grab your favorite IDE and create a file named **bot.js** in the heyguys-bot folder.
- Copy the example code below and paste it in the bot.js file.
- Back in the terminal window, enter **node bot.js**

## Usage  {#usage}

By default, the bot will watch a chatroom to see if the message HeyGuys was sent. When it detects that, it responds with “VoHiYo” in the same chatroom.

## Example code  {#example-code}

```
import WebSocket from 'ws';

const BOT_USER_ID = 'CHANGE_ME_TO_YOUR_BOTS_USER_ID'; // This is the User ID of the chat bot
const OAUTH_TOKEN = 'CHANGE_ME_TO_YOUR_OAUTH_TOKEN'; // Needs scopes user:bot, user:read:chat, user:write:chat
const CLIENT_ID = 'CHANGE_ME_TO_YOUR_CLIENT_ID';

const CHAT_CHANNEL_USER_ID = 'CHANGE_ME_TO_THE_CHAT_CHANNELS_USER_ID'; // This is the User ID of the channel that the bot will join and listen to chat messages of

const EVENTSUB_WEBSOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws';

var websocketSessionID;

// Start executing the bot from here
(async () => {
	// Verify that the authentication is valid
	await getAuth();

	// Start WebSocket client and register handlers
	const websocketClient = startWebSocketClient();
})();

// WebSocket will persist the application loop until you exit the program forcefully

async function getAuth() {
	// https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
	let response = await fetch('https://id.twitch.tv/oauth2/validate', {
		method: 'GET',
		headers: {
			'Authorization': 'OAuth ' + OAUTH_TOKEN
		}
	});

	if (response.status != 200) {
		let data = await response.json();
		console.error("Token is not valid. /oauth2/validate returned status code " + response.status);
		console.error(data);
		process.exit(1);
	}

	console.log("Validated token.");
}

function startWebSocketClient() {
	let websocketClient = new WebSocket(EVENTSUB_WEBSOCKET_URL);

	websocketClient.on('error', console.error);

	websocketClient.on('open', () => {
		console.log('WebSocket connection opened to ' + EVENTSUB_WEBSOCKET_URL);
	});

	websocketClient.on('message', (data) => {
		handleWebSocketMessage(JSON.parse(data.toString()));
	});

	return websocketClient;
}

function handleWebSocketMessage(data) {
	switch (data.metadata.message_type) {
		case 'session_welcome': // First message you get from the WebSocket server when connecting
			websocketSessionID = data.payload.session.id; // Register the Session ID it gives us

			// Listen to EventSub, which joins the chatroom from your bot's account
			registerEventSubListeners();
			break;
		case 'notification': // An EventSub notification has occurred, such as channel.chat.message
			switch (data.metadata.subscription_type) {
				case 'channel.chat.message':
					// First, print the message to the program's console.
					console.log(`MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`);

					// Then check to see if that message was "HeyGuys"
					if (data.payload.event.message.text.trim() == "HeyGuys") {
						// If so, send back "VoHiYo" to the chatroom
						sendChatMessage("VoHiYo")
					}

					break;
			}
			break;
	}
}

async function sendChatMessage(chatMessage) {
	let response = await fetch('https://api.twitch.tv/helix/chat/messages', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer ' + OAUTH_TOKEN,
			'Client-Id': CLIENT_ID,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			broadcaster_id: CHAT_CHANNEL_USER_ID,
			sender_id: BOT_USER_ID,
			message: chatMessage
		})
	});

	if (response.status != 200) {
		let data = await response.json();
		console.error("Failed to send chat message");
		console.error(data);
	} else {
		console.log("Sent chat message: " + chatMessage);
	}
}

async function registerEventSubListeners() {
	// Register channel.chat.message
	let response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer ' + OAUTH_TOKEN,
			'Client-Id': CLIENT_ID,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			type: 'channel.chat.message',
			version: '1',
			condition: {
				broadcaster_user_id: CHAT_CHANNEL_USER_ID,
				user_id: BOT_USER_ID
			},
			transport: {
				method: 'websocket',
				session_id: websocketSessionID
			}
		})
	});

	if (response.status != 202) {
		let data = await response.json();
		console.error("Failed to subscribe to channel.chat.message. API call returned status code " + response.status);
		console.error(data);
		process.exit(1);
	} else {
		const data = await response.json();
		console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
	}
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
