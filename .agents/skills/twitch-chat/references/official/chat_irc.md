<!-- source: https://dev.twitch.tv/docs/chat/irc/ -->

Contents

# IRC Concepts  {#irc-concepts}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

Twitch IRC is a chat interface provided by Twitch based on a modified RFC1459 and IRCv3 Message Tag specification. While Twitch’s IRC server generally follows RFC1459, it doesn’t support all IRC messages. Twitch IRC has limited features, and for full chatbot functionality some API calls will need to be made, such as in the case of [using chat commands](/docs/chat/send-receive-messages/).

Twitch IRC has some limitations versus EventSub, and is more complicated to parse, so it is recommended that you use EventSub subscriptions and API calls instead.

## Connecting to the Twitch IRC Server  {#connecting-to-the-twitch-irc-server}

To connect to the Twitch IRC server, use one of the following URIs:

|  | WebSocket clients | IRC clients |
|---|---|---|
| **SSL** | wss://irc-ws.chat.twitch.tv:443 | irc://irc.chat.twitch.tv:6697 |
| **Non-SSL** | Unavailable ([see announcement](https://discuss.dev.twitch.com/t/decommission-of-non-secure-websocket-connections-to-twitch-irc-servers/64142)) | irc://irc.chat.twitch.tv:6667 |

### Requesting Twitch Capabilities  {#requesting-twitch-capabilities}

Once the connection is established, you have the option to request additional metadata to be included in messages sent to your chatbot. This is done using the using the `REQ` subcommand specified in the [IRC v3 capability negotiation](https://ircv3.net/specs/extensions/capability-negotiation.html) specification. You have the option to request the following Twitch-specific capabilities:

| Capability | Description |
|---|---|
| twitch.tv/commands | Lets your bot send `PRIVMSG` messages that include /me, and receive Twitch-specific IRC messages. |
| twitch.tv/membership | Lets your bot receive `JOIN` and `PART` messages when users join and leave the chat room. |
| twitch.tv/tags | Adds additional metadata to the command and membership messages. For the list of metadata available with each message, see Twitch tags. To request the tags capability, you must also request the commands capability. |

To request Twitch-specific command messages like `GLOBALUSERSTATE`, `ROOMSTATE`, and `USERSTATE`, send `CAP REQ:` followed by all of the capabilities listed above that you wish to include:

`CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands`

While the above example contains all 3, you can choose one or more of the capabilities when requesting.
 If your capabilities request succeeds, Twitch replies with the standard ACK subcommand message:

`:tmi.twitch.tv CAP * ACK :twitch.tv/membership twitch.tv/tags twitch.tv/commands`

If your bot requests a capability that the Twitch IRC server doesn’t support, the server replies with the standard NAK subcommand message that identifies the capabilities that were denied:

`CAP * NAK :twitch.tv/foo`

### Authenticating with the Twitch IRC server  {#authenticating-with-the-twitch-irc-server}

Before you can continue, you must authenticate with Twitch and get a User Access Token with `chat:read` (to read chat messages over IRC) and `chat:edit` (to send chat messages over IRC) scopes. You will need this token to continue, and also the username of the account you generated the token for.
 For more information on this, see [Authenticating](/docs/chat/authenticating#authenticating).

In your IRC connection, send a PASS message containing a text string with the access token. The string’s format is **oauth:** where token is the access token. For example:

`PASS oauth:yfvzjqb705z12hrhy1zkwa9xt7v662`

Then send a NICK message containing a text string to your bot’s nickname. The nickname should be the lowercase login name of the Twitch account used to get your access token. For example:

`NICK twitchdev`

If the Twitch IRC server successfully authenticates your bot, it replies with the following numeric messages:

```
:tmi.twitch.tv 001 <user> :Welcome, GLHF!
:tmi.twitch.tv 002 <user> :Your host is tmi.twitch.tv
:tmi.twitch.tv 003 <user> :This server is rather new
:tmi.twitch.tv 004 <user> :-
:tmi.twitch.tv 375 <user> :-
:tmi.twitch.tv 372 <user> :You are in a maze of twisty passages.
:tmi.twitch.tv 376 <user> :>
@badge-info=;badges=;color=;display-name=<user>;emote-sets=0,300374282;user-id=12345678;user-type= :tmi.twitch.tv GLOBALUSERSTATE

```

The above reply was formatted for readability, but the message is actually a single string that contains multiple messages. Each message is delimited by CRLF (\r\n). For example:

```
:tmi.twitch.tv 001 <user> :Welcome, GLHF!\r\n:tmi.twitch.tv 002 <user> :Your host is tmi.twitch.tv\r\n:tmi.twitch.tv 003 <user> :This server is rather new\r\n:tmi.twitch.tv 004 <user> :-\r\n:tmi.twitch.tv 375 <user> :-\r\n:tmi.twitch.tv 372 <user> :You are in a maze of twisty passages, all alike.\r\n:tmi.twitch.tv 376 <user> :>\r\n@badge-info=;badges=;color=;display-name=<user>;emote-sets=0,300374282;user-id=12345678;user-type= :tmi.twitch.tv GLOBALUSERSTATE\r\n

```

If the server fails to authenticate your bot, it replies with the following message and closes the connection.

```
:tmi.twitch.tv NOTICE * :Login authentication failed

```

Also, as stated above, if you don’t send the PASS and NICK messages in the correct order, the authentication fails and the server replies with:

```
:tmi.twitch.tv NOTICE * :Improperly formatted auth

```

## Parsing messages  {#parsing-messages}

So far, we’ve showed messages in multiple formats, so it should be clarified on how these messages are to appear when sent to you. When the Twitch IRC server sends a message, it may contain a single message or multiple messages. The following example shows what the message looks like if it contains a single message:

```
:foo!foo@foo.tmi.twitch.tv JOIN #bar\r\n

```

And here’s what the message looks like if it contains multiple messages. In this case, the message contains the `JOIN`, `353`, `366`, `USERSTATE`, `ROOMSTATE`, and `PART` messages. The messages are delimited by CRLF (\r\n).

```
:foo!foo@foo.tmi.twitch.tv JOIN #bar\r\n:foo.tmi.twitch.tv 353 foo = #bar :foo\r\n
:foo.tmi.twitch.tv 366 foo #bar :End of /NAMES list\r\n@badge-info=;badges=moderator/1;color=;display-name=foo;emote-sets=0,300374282;mod=1;subscriber=0;user-type=mod :tmi.twitch.tv USERSTATE #bar\r\n@emote-only=0;followers-only=-1;r9k=0;room-id=12345678;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #bar\r\n:foo!foo@foo.tmi.twitch.tv PART #bar\r\n

```

The Twitch IRC server does not guarantee the order of the messages. It may also send a message multiple times if it doesn’t think the chatbot received it.

## Keepalive Messages  {#keepalive-messages}

After connecting to the Twitch IRC server, even before joining a chatroom, the server sends PING messages to ensure that your chatbot is still alive and able to respond to the server’s messages. The message received by your bot will be the following:

```
PING :tmi.twitch.tv

```

After receiving a PING message, your chatbot must reply with a PONG message. The text of the PONG message must be the text from the PING message.

```
PONG :tmi.twitch.tv

```

If the bot fails to reply with a PONG, the server terminates the connection.

## Joining and Leaving Chatrooms  {#joining-and-leaving-chatrooms}

Now that your bot has successfully authenticated with the Twitch IRC server, the next step is to join a chat room and begin sending and receiving messages.

To join chat channels, use the JOIN message. You can specify a single channel, or join multiple channels using a command delimiter:

```
JOIN #<channel>,#<channel>

```

If the bot successfully joins the channel, the server replies with the `JOIN`, `353`, and `366` messages. The text portion of the `353` message lists the users in the channel at the time you joined. The following example shows the reply message when the bar bot joined the #twitchdev and #foo channels:

```
:bar!bar@bar.tmi.twitch.tv JOIN #twitchdev
:bar.tmi.twitch.tv 353 bar = #twitchdev :bar
:bar.tmi.twitch.tv 366 bar #twitchdev :End of /NAMES list

:bar!bar@bar.tmi.twitch.tv JOIN #foo
:bar.tmi.twitch.tv 353 bar = #foo :bar
:bar.tmi.twitch.tv 366 bar #foo :End of /NAMES list

```

If the channel already has users joined to it, the reply may contain two `353` messages. The first shows the existing users in the chat room and the second shows the bot that joined.

```
:bar!bar@bar.tmi.twitch.tv JOIN #twitchdev
:bar.tmi.twitch.tv 353 bar = #twitchdev :xhipgamer blushyface mauerbac_bot moobot...
:bar.tmi.twitch.tv 353 bar = #twitchdev :bar
:bar.tmi.twitch.tv 366 bar #twitchdev :End of /NAMES list

```

If your bot requests the commands capability, the server’s reply also includes the USERSTATE and ROOMSTATE messages.

```
:bar!bar@bar.tmi.twitch.tv JOIN #twitchdev
:bar.tmi.twitch.tv 353 bar = #twitchdev :bar
:bar.tmi.twitch.tv 366 bar #twitchdev :End of /NAMES list
@badge-info=;badges=;color=;display-name=bar;emote-sets=0,300374282;mod=0;subscriber=0;user-type= :tmi.twitch.tv USERSTATE #twitchdev
@emote-only=0;followers-only=-1;r9k=0;room-id=141981764;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #twitchdev

:bar!bar@bar.tmi.twitch.tv JOIN #foo
:bar.tmi.twitch.tv 353 bar = #foo :bar
:bar.tmi.twitch.tv 366 bar #foo :End of /NAMES list
@badge-info=;badges=moderator/1;color=;display-name=bar;emote-sets=0,300374282;mod=1;subscriber=0;user-type=mod :tmi.twitch.tv USERSTATE #foo
@emote-only=0;followers-only=-1;r9k=0;room-id=713936733;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #foo

```

If you try to join a suspended or deleted channel, the bot receives a `NOTICE` message with the appropriate text. If your bot requests the tags capability, the message’s `msg-id` tag is set to **msg_channel_suspended**. If you try to join a nonexistent channel, Twitch quietly drops your `JOIN` message.

### Leaving a chatroom  {#leaving-a-chatroom}

To leave a chatroom, use the `PART` message. Similar to `JOIN`, you can specify a single channel, or leave multiple channels using a command delimiter:

```
PART #<channel>,#<channel>

```

## Sending Messages  {#sending-messages}

To send a chat message to a channel’s chat room, use a PRIVMSG message:

`PRIVMSG #<channel name> :This is a sample message`

Your chat messages can also include emoticons. To include emoticons, use the name of the emote. The names are case sensitive. Don’t include colons around the name (e.g., :bleedPurple:). If Twitch recognizes the name, Twitch converts the name to the emote before writing the chat message to the chat room. For examples of emoticons, see [Emotes](https://www.twitch.tv/creatorcamp/en/learn-the-basics/emotes/).

`PRIVMSG #<channel name> :HeyGuys <3 PartyTime`

**NOTE:** If you send too many messages in rapid succession, The Twitch’s chat server will silently drop your messages and may even close the IRC connection. For more information on these limits, see [Rate Limits](/docs/chat#rate-limits).

### Replying to a chat message  {#replying-to-a-chat-message}

If your bot wants to [reply to a chat message](https://help.twitch.tv/s/article/chat-basics#replies), it needs to get the chat message’s ID. This means your chatbot must first request the tags capability. With tags enabled, the `PRIVMSG` message that the Twitch IRC server sends your bot will include the `id` tag, which identifies the chat message:

```
@badge-info=;badges=broadcaster/1;client-nonce=459e3142897c7a22b7d275178f2259e0;color=#0000FF;display-name=lovingt3s;emote-only=1;emotes=62835:0-10;first-msg=0;flags=;id=885196de-cb67-427a-baa8-82f9b0fcd05f;mod=0;room-id=713936733;subscriber=0;tmi-sent-ts=1643904084794;turbo=0;user-id=713936733;user-type= :lovingt3s!lovingt3s@lovingt3s.tmi.twitch.tv PRIVMSG #lovingt3s :bleedPurple

```

To reply to the above chat message, your bot sends the following `PRIVMSG` message and includes the `reply-parent-msg-id` tag, which identifies the chat message you’re replying to.

```
@reply-parent-msg-id=885196de-cb67-427a-baa8-82f9b0fcd05f PRIVMSG #lovingt3s :absolutely!

```

And this is what the reply looks like in the chat room:

### IRC Commands  {#irc-commands}

Currently, the only supported command over IRC is **/me**. It is used by inserting the command directly into your IRC message payload:

```
PRIVMSG #twitchdev :/me teleports behind you

```

This appears in chat formatted slightly different than a normal chat message:

### Phone verification  {#phone-verification}

If you receive the following IRC Notice message after sending a chat message, you must enable phone verification for your chatbot:

```
A verified phone number is required to chat in this channel. Please visit https://www.twitch.tv/settings/security to verify your phone number.

```

To enable phone verification, go to the chatbot’s [Security and Privacy](https://www.twitch.tv/settings/security) settings. Under **Contact**, click **Add a number** (next to **Phone Number**) and add a phone number that Twitch can verify.

If you requested tags capabilities, the `msg_id` tag is set to **msg_requires_verified_phone_number**. You should compare message IDs instead of comparing message strings, which may change in the future.

## Receiving Messages  {#receiving-messages}

When a user enters a message in the channel’s chat room, the Twitch IRC server sends your bot a `PRIVMSG` message:

```
:foo!foo@foo.tmi.twitch.tv PRIVMSG #bar :bleedPurple

```

In the above message, the first part of the message identifies who wrote the message in the chat room. In this case, foo wrote the message.

The second part of the message identifies the type of message (command) and the name of the channel (chat room). In this case, the command is `PRIVMSG` and the message came from the bar channel’s chat room.

The third part of the message is the chat message that the user posted in the chat room. In this case, the message text contains the bleedPurple emote.

Note that your chatbot’s connection will not receive `PRIVMSG` messages for chat messages that it writes to the chat room. Instead, it receives a `USERSTATE` message, but only if you request the tags and commands capabilities. The `display-name` tag contains the bot’s name. The message does not include the chat message the bot sent.

```
@badge-info=;badges=moderator/1;color=#FF4500;display-name=mybot;emote-sets=0,300374282;mod=1;subscriber=0;user-type=mod :tmi.twitch.tv USERSTATE #bar

```

If your bot requested the tags capability, the following example shows what the PRIVMSG message looks like when it includes tags:

```
@badge-info=;badges=broadcaster/1;client-nonce=28e05b1c83f1e916ca1710c44b014515;color=#0000FF;display-name=foofoo;emotes=62835:0-10;first-msg=0;flags=;id=f80a19d6-e35a-4273-82d0-cd87f614e767;mod=0;room-id=713936733;subscriber=0;tmi-sent-ts=1642696567751;turbo=0;user-id=713936733;user-type= :foofoo!foofoo@foofoo.tmi.twitch.tv PRIVMSG #bar :bleedPurple

```

For more information about what tags can be sent by the server, and how to parse them, see IRC Tag Reference.

## Shared Chat  {#shared-chat}

Shared Chat is a feature of Twitch Chat that allows multiple channels to communicate as if they were combined. When activated, messages sent from one channel will duplicate into other channels.

When shared chat is enabled, PRIVMSG and USERNOTICE IRC commands sent to the “source” channel (the channel in which the message originates from) will be duplicated into all other channels that are combined. Each of these messages will have their own unique Message ID, specified by the `id` tag. The original tag, sent to the source channel, will be preserved across all combined channels using the `source-id` tag. Additional tags are added to serve a similar purpose, duplicating other tags including `badges` and `room-id`. All of these tags are specified in the respective command’s IRC Tag Reference documentation below.

As an example, while the channels Twitch and TwitchRivals are combined using Shared Chat, a message sent in the channel Twitch will first appear in the channel Twitch:

```
@badge-info=;badges=staff/1,twitchcon-2024---san-diego/1;client-nonce=99a343c9cf2fcf4e96e0abc358f7b59b;color=#FF4500;display-name=TwitchDev;emotes=;first-msg=1;flags=;id=4dcec0e7-7f79-4a82-8aed-91aac9d0640c;mod=0;returning-chatter=0;room-id=12826;source-badge-info=;source-badges=staff/1,twitchcon-2024---san-diego/1;source-id=4dcec0e7-7f79-4a82-8aed-91aac9d0640c;source-room-id=12826;subscriber=0;tmi-sent-ts=1725918561648;turbo=0;user-id=141981764;user-type=staff :twitchdev!twitchdev@twitchdev.tmi.twitch.tv PRIVMSG #twitch:Howdy!

```

Note that the badges `source-id`, `source-room-id`, `source-badges`, `source-badge-info` all appear with values. This indicates that the room is in Shared Chat mode, and the `source-room-id` here matches the `room-id` value, indicating that this is the original room in which the message was sent from.

In addition, the message will also be sent to the TwitchRivals channel:

```
@badge-info=;badges=staff/1,twitchcon-2024---san-diego/1;client-nonce=99a343c9cf2fcf4e96e0abc358f7b59b;color=#FF4500;display-name=TwitchDev;emotes=;flags=;id=17152d83-1fc8-4869-9d44-5157ee212ff1;mod=0;room-id=197886470;source-badge-info=;source-badges=staff/1,twitchcon-2024---san-diego/1;source-id=4dcec0e7-7f79-4a82-8aed-91aac9d0640c;source-room-id=12826;subscriber=0;tmi-sent-ts=1725918561648;turbo=0;user-id=141981764;user-type=staff :twitchdev!twitchdev@twitchdev.tmi.twitch.tv PRIVMSG #twitchrivals:Howdy!

```

Here we can see the same tags as before, but with modified details in the aforementioned tags. The `source-room-id` indicates that the messages was sent to the Twitch channel, but is being duplicated into the TwitchRivals channel, indicated by the `room-id` matching the TwitchRivals account. In addition, the channel tag, **#twitchrivals**, differs from the **#twitch** channel tag from earlier, as the channel tag refers to the room in which the current `message-id` is being sent to.

## IRC Command Reference  {#irc-command-reference}

The Twitch IRC server sends your bot the following commands only if your bot requests the commands capability. For information about requesting the commands capability, see Requesting Twitch-specific capabilities. Because the messages for these commands include minimum information, you should also request the tags capability to get a richer set of information.

A list of possible commands you may receive from the Twitch IRC server:

| Message | Description |
|---|---|
| CLEARCHAT | Sent when the bot or moderator removes all messages from the chat room or removes all messages for the specified user. |
| CLEARMSG | Sent when the bot removes a single message from the chat room. |
| GLOBALUSERSTATE | Sent after the bot authenticates with the server. |
| NOTICE | Sent to indicate an event relating to the outcome of an action, such as attempting to join a chatroom you are banned from. |
| PART | Sent when a user leaves a chatroom, or when your bot is banned from a chatroom it is currently in. |
| PING | Sent when the server wants to ensure that your bot is still alive and able to respond to the server’s messages. |
| PRIVMSG | Sent when a user posts a chat message in the chat room. |
| RECONNECT | Sent when the Twitch IRC server needs to terminate the connection. |
| ROOMSTATE | Sent when the bot joins a channel or when the channel’s chat settings change. |
| USERNOTICE | Sent when events occur in the channel, such as someone subscribing to the channel. |
| USERSTATE | Sent when the bot joins a channel or sends a `PRIVMSG` message. |

### CLEARCHAT Command  {#clearchat-command}

   **Reference -- Click to Expand**

Sent when a moderator removes all messages from the chat room or removes all messages for the specified user.

The Twitch IRC server sends this message when:

- A moderator enters the /clear command in chat on the Twitch website, or calls the [Delete Chat Messages API](/docs/api/reference/#delete-chat-messages).
- A moderator enters the /ban or /timeout command in the chat room.

**Prototype**

`:tmi.twitch.tv CLEARCHAT #<channel> :<user>`

| Parameter | Description |
|---|---|
| channel | The name of the channel (chatroom) where the messages were removed from. |
| user | The login name of the user whose messages were removed from the chat room because they were banned or put in a timeout. |

**Examples**

The following message indicates that all chat messages were removed from the dallas chat room.

`:tmi.twitch.tv CLEARCHAT #dallas`

The following message indicates that all chat messages that ronni posted in the dallas chat room were removed.

`:tmi.twitch.tv CLEARCHAT #dallas :ronni`

**Adding tags to the CLEARCHAT message**

To include additional information with the `CLEARCHAT` message, request the tags capability. For details about the tags that the `CLEARCHAT` message can include, see Twitch IRC tags.

The following example shows a `CLEARCHAT` message with tags.

```
@room-id=12345678;target-user-id=87654321;tmi-sent-ts=1642715756806 :tmi.twitch.tv CLEARCHAT #dallas :ronni

```

### CLEARMSG Command  {#clearmsg-command}

   **Reference -- Click to Expand**

Sent when a bot with moderator privileges deletes a single message from the chat room.

The Twitch IRC server sends this message when:

- A moderator deletes a user’s chat message on the Twitch website, or calls the [Delete Chat Messages API](/docs/api/reference/#delete-chat-messages).

**Prototype**

`:tmi.twitch.tv CLEARMSG #<channel> :<message>`

| Parameter | Description |
|---|---|
| channel | The name of the channel (chat room) where the message was removed from. |
| message | The chat message that was removed. |

**Example**

The following message indicates that the specified chat message was removed from the dallas channel.

`:tmi.twitch.tv CLEARMSG #dallas :HeyGuys`

**Adding tags to the CLEARMSG message**

To include additional information with the `CLEARMSG` message, request the tags capability. For details about the tags that the `CLEARMSG` message can include, see Twitch IRC tags.

The following example shows a `CLEARMSG` message with tags.

```
@login=foo;room-id=;target-msg-id=94e6c7ff-bf98-4faa-af5d-7ad633a158a9;tmi-sent-ts=1642720582342 :tmi.twitch.tv CLEARMSG #bar :what a great day

```

### GLOBALUSERSTATE Command  {#globaluserstate-command}

   **Reference -- Click to Expand**

Sent after the bot successfully authenticates (by sending the `PASS`/`NICK` commands) with the server.

**Prototype**

`:tmi.twitch.tv GLOBALUSERSTATE`

**Example**

`:tmi.twitch.tv GLOBALUSERSTATE`

**Adding tags to the GLOBALUSERSTATE message**

As you can see from the example, the `GLOBALUSERSTATE` message on its own is not very useful. To include useful information with the `GLOBALUSERSTATE` message, request the tags capability. For details about the tags that the `GLOBALUSERSTATE` message can include, see Twitch IRC tags.

The following example shows a `GLOBALUSERSTATE` message with tags after dallas logged in.

```
@badge-info=subscriber/8;badges=subscriber/6;color=#0D4200;display-name=dallas;emote-sets=0,33,50,237,793,2126,3517,4578,5569,9400,10337,12239;turbo=0;user-id=12345678;user-type=admin :tmi.twitch.tv GLOBALUSERSTATE

```

### PART Command  {#part-command}

   **Reference -- Click to Expand**

Sent when a user has left a chatroom.

**NOTE:** Your bot won’t receive the JOIN and PART messages if the chat room contains more that 1,000 users.

**Prototype**

`:<user>!<user>@<user>.tmi.twitch.tv PART #<channel>`

| Parameter | Description |
|---|---|
| channel | The name of the channel (chat room) that the user left. |
| user | The login name of the user that left the chat room. |

**Example**

The following example shows that ronni left the dallas chatroom.

`:ronni!ronni@ronni.tmi.twitch.tv PART #dallas`

### PRIVMSG Command  {#privmsg-command}

   **Reference -- Click to Expand**

Sent when a user sends a chat message to a chatroom your bot has joined.

**Prototype** `:<user>!<user>@<user>.tmi.twitch.tv PRIVMSG #<channel> :<message>`

| Parameter | Description |
|---|---|
| channel | The name of the channel the user sent the message in. |
| user | The login name of the user that sent the message |
| message | The chat message that was sent |

**Example**

The following example shows ronni sending the message “Hello, chat!” to the dallas chatroom.

`:ronni!ronni@ronni.tmi.twitch.tv PRIVMSG #dallas :Hello, chat!`

**Adding tags to the PRIVMSG message**

To include additional information with the `PRIVMSG` message, request the tags capability. For details about the tags that the `PRIVMSG` message can include, see Twitch IRC tags.

For more information, see PRIVMSG Tags.

### NOTICE Command  {#notice-command}

   **Reference -- Click to Expand**

Sent to indicate the outcome of an action, such as banning a user.

The Twitch IRC server sends this message when:

- You attempt to perform an action that is disallowed for some reason, such as attempting to join a channel where you are banned.

**Prototype**

`:tmi.twitch.tv NOTICE #<channel> :<message>`

| Parameter | Description |
|---|---|
| channel | The channel (chat room) where the action occurred. |
| message | A message that describes the outcome of the action. |

**Example**

The following example shows that Twitch removed a message that foo posted to the bar chat room.

`:tmi.twitch.tv NOTICE #bar :The message from foo is now deleted.`

The following example shows that foo was banned from the bar chatroom.

`:tmi.twitch.tv NOTICE #bar :foo is now banned from this channel.`

**Adding tags to the NOTICE message**

To include additional information with the `NOTICE` message, request the tags capability. For details about the tags that the `NOTICE` message can include, see Twitch IRC tags.

The following example shows a `NOTICE` message with tags after Twitch removed a message that foo posted to the bar chat room. You can use the ID in the `msg-id` tag to determine the action’s outcome.

```
@msg-id=delete_message_success :tmi.twitch.tv NOTICE #bar :The message from foo is now deleted.

```

### RECONNECT Command  {#reconnect-command}

   **Reference -- Click to Expand**

Sent when the Twitch IRC server needs to terminate the connection for maintenance reasons. This gives your bot a chance to perform minimal clean up and save state before the server terminates the connection. The amount of time between receiving the message and the server closing the connection is indeterminate.

The normal course of action is to reconnect to the Twitch IRC server and rejoin the channels you were previously joined to prior to the server terminating the connection.

**Prototype**

`:tmi.twitch.tv RECONNECT`

### ROOMSTATE Command  {#roomstate-command}

   **Reference -- Click to Expand**

Sent when the bot joins a channel or when the channel’s chat settings change.

The Twitch IRC server sends this message when:

- The chatbot joins a channel in your IRC connection
- A moderator activates one of the following chatroom settings:

- Emote-only mode (on/off)
- Followers-only mode (on/off)
- Slowmode (on/off)
- Subscribers-only mode (on/off)
- Uniquechat mode (on/off)

**Prototype**

`:tmi.twitch.tv ROOMSTATE #<channel>`

| Parameter | Description |
|---|---|
| channel | The name of the channel (chatroom) that the room state information applies to. |

**Example**

`:tmi.twitch.tv ROOMSTATE #bar`

**Adding tags to the ROOMSTATE message**

To include additional information with the `ROOMSTATE` message, request the tags capability. For details about the tags that the `ROOMSTATE` message can include, see Twitch IRC tags.

The following example shows a `ROOMSTATE` message with tags after joining a channel.

```
@emote-only=0;followers-only=-1;r9k=0;room-id=12345678;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #bar

```

The following example shows a `ROOMSTATE` message with tags after turning on the unique-chat chat setting.

`@r9k=1;room-id=713936733 :tmi.twitch.tv ROOMSTATE #bar`

### USERNOTICE Command  {#usernotice-command}

   **Reference -- Click to Expand**

Sent when events occur in the channel, such as a user subscribing to the channel. Some examples include:

- A user subscribes to the channel, re-subscribes to the channel. or gifts a subscription to another user.
- Another broadcaster [raids](https://help.twitch.tv/s/article/how-to-use-raids) the channel.
- A viewer milestone is celebrated, such as a new viewer chatting for the first time.

**Prototype**

`:tmi.twitch.tv USERNOTICE #<channel> :[<message>]`

| Parameter | Description |
|---|---|
| channel | The name of the channel that the event occurred in. |
| message | **Optional.** The chat message that describes the event. |

**Example**

The following example shows the `USERNOTICE` sent after ronni resubscribed to the dallas channel.

`:tmi.twitch.tv USERNOTICE #dallas :Great stream -- keep it up!`

The following example shows the `USERNOTICE` sent after tww2 gifts a subscription to Mr_Woodchuck in forstycup’s channel.

```
:tmi.twitch.tv USERNOTICE #forstycup

```

**Adding tags to the USERNOTICE message**

As you can see from the examples, the `USERNOTICE` message on its own is not very useful. To include useful information with the `USERNOTICE` message, request the tags capability. For details about the tags that the `USERNOTICE` message can include, see Twitch IRC tags.

The following example shows a `USERNOTICE` message with tags after ronni resubscribed to the dallas channel.

```
@badge-info=;badges=staff/1,broadcaster/1,turbo/1;color=#008000;display-name=ronni;emotes=;id=db25007f-7a18-43eb-9379-80131e44d633;login=ronni;mod=0;msg-id=resub;msg-param-cumulative-months=6;msg-param-streak-months=2;msg-param-should-share-streak=1;msg-param-sub-plan=Prime;msg-param-sub-plan-name=Prime;room-id=12345678;subscriber=1;system-msg=ronni\shas\ssubscribed\sfor\s6\smonths!;tmi-sent-ts=1507246572675;turbo=1;user-id=87654321;user-type=staff :tmi.twitch.tv USERNOTICE #dallas :Great stream -- keep it up!

```

The following example shows a `USERNOTICE` message with tags after tww2 gifts a subscription to Mr_Woodchuck in forstycup’s channel.

```
@badge-info=;badges=staff/1,premium/1;color=#0000FF;display-name=TWW2;emotes=;id=e9176cd8-5e22-4684-ad40-ce53c2561c5e;login=tww2;mod=0;msg-id=subgift;msg-param-months=1;msg-param-recipient-display-name=Mr_Woodchuck;msg-param-recipient-id=55554444;msg-param-recipient-name=mr_woodchuck;msg-param-sub-plan-name=House\sof\sNyoro~n;msg-param-sub-plan=1000;room-id=12345678;subscriber=0;system-msg=TWW2\sgifted\sa\sTier\s1\ssub\sto\sMr_Woodchuck!;tmi-sent-ts=1521159445153;turbo=0;user-id=87654321;user-type=staff :tmi.twitch.tv USERNOTICE #forstycup

```

### USERSTATE Command  {#userstate-command}

   **Reference -- Click to Expand**

Sent when the chatbot joins a channel or sends a PRIVMSG message.

**Prototype**

`:tmi.twitch.tv USERSTATE #<channel>`

| Parameter | Description |
|---|---|
| channel | The name of the channel that the bot joined or sent a PRIVMSG in. |

**Example**

`:tmi.twitch.tv USERSTATE #dallas`

**Adding tags to the USERSTATE message**

As you can see from the example, the `USERSTATE` message on its own is not very useful. To include useful information with the `USERSTATE` message, request the tags capability. For details about the tags that the `USERSTATE` message can include, see Twitch IRC tags.

The following example shows a `USERSTATE` message with tags after ronni joins the dallas channel.

```
@badge-info=;badges=staff/1;color=#0D4200;display-name=ronni;emote-sets=0,33,50,237,793,2126,3517,4578,5569,9400,10337,12239;mod=1;subscriber=1;turbo=1;user-type=staff :tmi.twitch.tv USERSTATE #dallas

```

## IRC Tag Reference  {#irc-tag-reference}

Most IRC messages provide enough information that you can figure out what happened. For example, in the following PRIVMSG message, you know that user abc posted `HeyGuys` in the xyz channel.

`:abc!abc@abc.tmi.twitch.tv PRIVMSG #xyz :HeyGuys`

But what if you wanted to know more about the user? For example, are they a subscriber or what kind of badges do they have? Well, you’re in luck. Twitch provides rich information about the user if you request the tags capability (see Requesting Twitch-specific capabilities).

```
@badge-info=;badges=broadcaster/1;client-nonce=997dcf443c31e258c1d32a8da47b6936;color=#0000FF;display-name=abc;emotes=;first-msg=0;flags=0-6:S.7;id=eb24e920-8065-492a-8aea-266a00fc5126;mod=0;room-id=713936733;subscriber=0;tmi-sent-ts=1642786203573;turbo=0;user-id=713936733;user-type= :abc!abc@abc.tmi.twitch.tv PRIVMSG #xyz :HeyGuys

```

The Twitch IRC server follows the [IRCv3 Message Tag specification](https://ircv3.net/specs/extensions/message-tags.html) for including tags in messages. Tags are optional metadata that Twitch attaches to an IRC message. Tags are key/value pairs (key=value). The key’s value is optional (key=). Tags may appear in any order. You should only parse tags you recognize and ignore the others.

Tags are in the form: `@tag-name-1=<tag-value-1>;tag-name-2=<tag-value-2>;....`

The following are the commands that may include tags. If a tag is not documented here, it is not supported for third-party developer use.

| Message | Description |
|---|---|
| CLEARCHAT | Sent when the bot or moderator removes all messages from the chat room or removes all messages for the specified user. |
| CLEARMSG | Sent when the bot removes a single message from the chat room. |
| GLOBALUSERSTATE | Sent after the bot authenticates with the server. |
| NOTICE | Sent to indicate an event relating to the outcome of an action, such as attempting to join a chatroom you are banned from. |
| PRIVMSG | Sent when a user posts a chat message in the chat room. |
| ROOMSTATE | Sent when the bot joins a channel or when the channel’s chat settings change. |
| USERNOTICE | Sent when events occur in the channel, such as someone subscribing to the channel. |
| USERSTATE | Sent when the bot joins a channel or sends a `PRIVMSG` message. |

### CLEARCHAT Tags  {#clearchat-tags}

   **Reference -- Click to Expand**

Sent when a moderator removes all messages from the chat room or removes all messages for the specified user.

**Prototype**

```
@ban-duration=<duration>;room-id=<room-id>;target-user-id=<user-id>;tmi-sent-ts=<timestamp>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| ban-duration | **Optional.** The message includes this tag if the user was put in a timeout instead of a ban. The tag contains the duration of the timeout, in seconds. |
| room-id | The ID of the channel where the messages were removed from. |
| target-user-id | **Optional.** The User ID of the user that was banned or put in a timeout. |
| tmi-sent-ts | The UNIX timestamp. |

**Example**

The following example shows the message that the Twitch IRC server sent after dallas permanently banned ronni from the chat room and removed all of ronni’s messages:

```
@room-id=12345678;target-user-id=87654321;tmi-sent-ts=1642715756806 :tmi.twitch.tv CLEARCHAT #dallas :ronni

```

The following example shows the message that the Twitch IRC server sent after dallas removed all messages from the chat room:

```
@room-id=12345678;tmi-sent-ts=1642715695392 :tmi.twitch.tv CLEARCHAT #dallas

```

The following example shows the message that the Twitch IRC server sent after dallas put ronni in a timeout and removed all of ronni’s messages from the chat room:

```
@ban-duration=350;room-id=12345678;target-user-id=87654321;tmi-sent-ts=1642719320727 :tmi.twitch.tv CLEARCHAT #dallas :ronni

```

### CLEARMSG Tags  {#clearmsg-tags}

   **Reference -- Click to Expand**

Sent when a bot with moderator privileges deletes a single message from the chat room.

**Prototype**

```
@login=<login>;room-id=<room-id>;target-msg-id=<target-msg-id>;tmi-sent-ts=<timestamp>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| login | The name of the user who sent the message. |
| room-id | **Optional.** The ID of the channel (chat room) where the message was removed from. |
| target-msg-id | The ID of the message. In UUID format. |
| tmi-sent-ts | The UNIX timestamp. |

**Example**

The following example shows the message that the Twitch IRC server sent after the moderator deleted ronni’s HeyGuys message from the dallas chat room.

```
@login=ronni;room-id=;target-msg-id=abc-123-def;tmi-sent-ts=1642720582342 :tmi.twitch.tv CLEARMSG #dallas :HeyGuys

```

### GLOBALUSERSTATE Tags  {#globaluserstate-tags}

   **Reference -- Click to Expand**

Sent after the bot successfully authenticates (by sending the `PASS`/`NICK` commands) with the server.

**Prototype**

```
@badge-info=<badge-info>;badges=<badges>;color=<color>;display-name=<display-name>;emote-sets=<emote-sets>;turbo=<turbo>;user-id=<user-id>;user-type=<user-type>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| badge-info | Contains metadata related to the chat badges in the `badges` tag.  Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| badges | Comma-separated list of chat badges in the form, `<badge>/<version>`. For example admin/1. There are many possible badge values, but here are few:   - admin - bits - broadcaster - moderator - subscriber - staff - turbo Most badges have only 1 version, but some badges like subscriber badges offer different versions of the badge depending on how long the user has subscribed.  To get the badge, use the [Get Global Chat Badges](/docs/api/reference#get-global-chat-badges) and [Get Channel Chat Badges](/docs/api/reference#get-channel-chat-badges) APIs. Match the badge to the `set-id` field’s value in the response. Then, match the version to the `id` field in the list of versions. |
| color | The color of the user’s name in the chat room. This is a hexadecimal RGB color code in the form, #. This tag may be empty if it is never set. |
| display-name | The user’s display name, escaped as described in the [IRCv3 spec](https://ircv3.net/specs/core/message-tags-3.2.html). This tag may be empty if it is never set. |
| emote-sets | A comma-delimited list of IDs that identify the emote sets that the user has access to. Is always set to at least zero (0). To access the emotes in the set, use the [Get Emote Sets](/docs/api/reference#get-emote-sets) API. |
| turbo | A Boolean value that indicates whether the user has site-wide commercial free mode enabled. Is true (1) if enabled; otherwise, false (0). |
| user-id | The User ID of the relevant user. |
| user-type | The type of user. Possible values are:  - "" - A normal user - admin - A Twitch administrator - global_mod - A global moderator - staff - A Twitch employee |

**Example**

The following example shows the message that the Twitch IRC server sent after a user authenticated with the Twitch IRC server. The message shows the user state of dallas, an admin user, after logging in.

```
@badge-info=subscriber/8;badges=subscriber/6;color=#0D4200;display-name=dallas;emote-sets=0,33,50,237,793,2126,3517,4578,5569,9400,10337,12239;turbo=0;user-id=12345678;user-type=admin :tmi.twitch.tv GLOBALUSERSTATE

```

### NOTICE Tags  {#notice-tags}

   **Reference -- Click to Expand**

Sent when events occur in the channel, such as a user subscribing to the channel.

**Prototype**

```
@msg-id=<msg-id>;target-user-id=<user-id>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| msg-id | An ID that you can use to programmatically determine the action’s outcome. For a list of possible IDs, see NOTICE Reference. |
| target-user-id | The ID of the user that the action targeted. |

**Example**

The following example shows the message that the Twitch IRC server sent after the moderator deleted a message from the chat room. The `msg-id` tag is set to **delete_message_success**, which indicates that the user’s message was successfully deleted.

```
@msg-id=delete_message_success :tmi.twitch.tv NOTICE #bar :The message from foo is now deleted.

```

The following example shows the message that the Twitch IRC server sent after the user was unable to send a Whisper message. The `msg-id` tag is set to **whisper_restricted**, which indicates that the user can’t send whisper messages. You can use the ID in `target-user-id` along with the [Get Users](/docs/api/reference#get-users) API to get the name of the user the whisper was intended for.

```
@msg-id=whisper_restricted;target-user-id=12345678 :tmi.twitch.tv NOTICE #bar :Your settings prevent you from sending this whisper.

```

### PRIVMSG Tags  {#privmsg-tags}

   **Reference -- Click to Expand**

Sent when a user sends a chat message to a chatroom your bot has joined.

**Prototype**

```
@badge-info=<badge-info>;badges=<badges>;bits=<bits>client-nonce=<nonce>;color=<color>;display-name=<display-name>;emotes=<emotes>;first-msg=<first-msg>;flags=<flags>;id=<msg-id>;mod=<mod>;room-id=<room-id>;subscriber=<subscriber>;tmi-sent-ts=<timestamp>;turbo=<turbo>;user-id=<user-id>;user-type=<user-type>;reply-parent-msg-id=<reply-parent-msg-id>;reply-parent-user-id=<reply-parent-user-id>;reply-parent-user-login=<reply-parent-user-login>;reply-parent-display-name=<reply-parent-display-name>;reply-parent-msg-body=<reply-parent-msg-body>;reply-thread-parent-msg-id=<reply-thread-parent-msg-id>;reply-thread-parent-user-login=<reply-thread-parent-user-login>;vip=<vip>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| badge-info | Contains metadata related to the chat badges in the `badges` tag.  Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| badges | Comma-separated list of chat badges in the form, `<badge>/<version>`. For example admin/1. There are many possible badge values, but here are few:   - admin - bits - broadcaster - moderator - subscriber - staff - turbo Most badges have only 1 version, but some badges like subscriber badges offer different versions of the badge depending on how long the user has subscribed.  To get the badge, use the [Get Global Chat Badges](/docs/api/reference#get-global-chat-badges) and [Get Channel Chat Badges](/docs/api/reference#get-channel-chat-badges) APIs. Match the badge to the `set-id` field’s value in the response. Then, match the version to the `id` field in the list of versions. |
| bits | The amount of Bits the user cheered. Only a Bits cheer message includes this tag. To learn more about Bits, see the [Extensions Monetization Guide](https://help.twitch.tv/s/article/guide-to-cheering-with-bits). To get the cheermote, use the [Get Cheermotes](/docs/api/reference#get-cheermotes) API. Match the cheer amount to the `id` field’s value in the response. Then, get the cheermote’s URL based on the cheermote theme, type, and size you want to use. |
| color | The color of the user’s name in the chat room. This is a hexadecimal RGB color code in the form, #. This tag may be empty if it is never set. |
| display-name | The user’s display name, escaped as described in the [IRCv3](https://ircv3.net/specs/core/message-tags-3.2.html) spec. This tag may be empty if it is never set. |
| emotes | A slash-delimited list of emotes and their positions in the message. Each emote is in the form, `<emote ID>:<ranges>`, where ranges are comma-delimited pairs of indices in the form `<start position>-<end position>`. The position indices are zero-based.  To get the actual emote, see the [Get Channel Emotes](/docs/api/reference#get-channel-emotes) and [Get Global Emotes](/docs/api/reference#get-global-emotes) APIs.  **NOTE**: It’s possible for a message to begin with with `\001ACTION` when /me is used by a user in chat. In these cases emote positions should be considered to begin after `\001ACTION `, which includes its succeeding whitespace. |
| gifs | Comma-separated list of GIFs and their positions in the message. Each GIF is in the form, `<start position>-<end position>\|<gifID>\|<gifURL>`. The position indices are zero-based. Applications rendering the GIF must use the full URL provided; it must not be modified. |
| id | An ID that uniquely identifies the message. |
| mod | A Boolean value that determines whether the user is a moderator. Is true (1) if the user is a moderator; otherwise, false (0). |
| reply-parent-msg-id | An ID that uniquely identifies the direct parent message that this message is replying to. The message does not include this tag if this message is not a reply. |
| reply-parent-user-id | An ID that identifies the sender of the direct parent message. The message does not include this tag if this message is not a reply. |
| reply-parent-user-login | The login name of the sender of the direct parent message. The message does not include this tag if this message is not a reply. |
| reply-parent-display-name | The display name of the sender of the direct parent message. The message does not include this tag if this message is not a reply. |
| reply-parent-msg-body | The text of the direct parent message. The message does not include this tag if this message is not a reply. |
| reply-thread-parent-msg-id | An ID that uniquely identifies the top-level parent message of the reply thread that this message is replying to. The message does not include this tag if this message is not a reply. |
| reply-thread-parent-user-login | The login name of the sender of the top-level parent message. The message does not include this tag if this message is not a reply. |
| room-id | An ID that identifies the chat room (channel). |
| source-badges | Comma-seperated list of chat badges for the chatter in the room the message was sent from. This uses the same format as the `badges` tag. |
| source-badge-info | Contains metadata related to the chat badges in the source-badges tag. |
| source-id | A UUID that identifies the source message from the channel the message was sent from. |
| source-only | A Boolean that indicates if a message sent during a shared chat session is only sent to the source channel. Has no effect if the message is not sent during a shared chat session. |
| source-room-id | An ID that identifies the chat room (channel) the message was sent from. |
| subscriber | A Boolean value that determines whether the user is a subscriber. Is true (1) if the user is a subscriber; otherwise, false (0). |
| tmi-sent-ts | The UNIX timestamp. |
| turbo | A Boolean value that indicates whether the user has site-wide commercial free mode enabled. Is true (1) if enabled; otherwise, false (0). |
| user-id | The User ID of the user. |
| user-type | The type of user. Possible values are:  - "" - A normal user - admin - A Twitch administrator - global_mod - A global moderator - staff - A Twitch employee |
| vip | A Boolean value that determines whether the user that sent the chat is a VIP. The message includes this tag if the user is a VIP; otherwise, the message doesn’t include this tag (check for the presence of the tag instead of whether the tag is set to true or false). |

**Example**

The following example shows the message that the Twitch IRC server sent after ronni posted a message in the chat room.

```
@badge-info=;badges=turbo/1;color=#0D4200;display-name=ronni;emotes=25:0-4,12-16/1902:6-10;id=b34ccfc7-4977-403a-8a94-33c6bac34fb8;mod=0;room-id=1337;subscriber=0;tmi-sent-ts=1507246572675;turbo=1;user-id=1337;user-type=global_mod :ronni!ronni@ronni.tmi.twitch.tv PRIVMSG #ronni :Kappa Keepo Kappa

```

The following example shows the message that the Twitch IRC server sent after ronni cheered 100 Bits.

```
@badge-info=;badges=staff/1,bits/1000;bits=100;color=;display-name=ronni;emotes=;id=b34ccfc7-4977-403a-8a94-33c6bac34fb8;mod=0;room-id=12345678;subscriber=0;tmi-sent-ts=1507246572675;turbo=1;user-id=12345678;user-type=staff :ronni!ronni@ronni.tmi.twitch.tv PRIVMSG #ronni :cheer100

```

If ronni had cheered, Cheer1 Cheer1, the `bits` tag would be set to 2.

The following example shows that a VIP sent the message (see the `vip` tag).

```
@badge-info=;badges=vip/1,partner/1;client-nonce=cd15335a5e2059c3b087e22612de485e;color=;display-name=fun2bfun;emotes=;first-msg=0;flags=;id=1fd20412-965f-4c96-beb3-52266448f564;mod=0;returning-chatter=0;room-id=102336968;subscriber=0;tmi-sent-ts=1661372052425;turbo=0;user-id=12345678;user-type=;vip=1

```

The following example shows a chat message containing a GIF:

```
@badge-info=subscriber/30;badges=broadcaster/1,subscriber/0;color=#033700;display-name=TwitchDev;emotes=;first-msg=0;flags=;gifs=0-33|joSNxeswxuc74Juo8X|https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif?cid=095d7a5dzizsiwgabonagkmigggv8v1spfai91ac3x0dsiy0&ep=v1_gifs_trending&rid=giphy.gif&ct=g;id=401abf17-7e99-45d6-9bdf-43934e839327;mod=0;returning-chatter=0;room-id=12826;subscriber=1;tmi-sent-ts=1783632907018;turbo=0;user-id=141981764;user-type= :twitchdev!twitchdev@twitchdev.tmi.twitch.tv PRIVMSG #twitch :[Y A Y Yes GIF by Djemilah Birnie]

```

**Tags a client may include**

When sending a PRIVMSG to the Twitch IRC server, a client may send a `PRIVMSG` message to the Twitch IRC server with the following tags.

| Tag | Description |
|---|---|
| reply-parent-msg-id | An ID that uniquely identifies the parent message that this message is replying to. |

**Example**

The following example shows a `PRIVMSG` message that the client sent in reply to another message.

```
@reply-parent-msg-id=b34ccfc7-4977-403a-8a94-33c6bac34fb8 PRIVMSG #ronni :Good idea!

```

### ROOMSTATE Tags  {#roomstate-tags}

   **Reference -- Click to Expand**

Sent when the bot joins a channel or when the channel’s chat settings change.

**Prototype**

```
@emote-only=<emote-only>;followers-only=<followers-only>;r9k=<r9k>;room-id=<room-id>;slow=<slow>;subs-only=<subs-only>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| emote-only | A Boolean value that determines whether the chat room allows only messages with emotes. Is true (1) if only emotes are allowed; otherwise, false (0). |
| followers-only | An integer value that determines whether only followers can post messages in the chat room. The value indicates how long, in minutes, the user must have followed the broadcaster before posting chat messages. If the value is -1, the chat room is not restricted to followers only. |
| r9k | A Boolean value that determines whether a user’s messages must be unique. Applies only to messages with more than 9 characters. Is true (1) if users must post unique messages; otherwise, false (0). |
| room-id | An ID that identifies the chat room (channel). |
| slow | An integer value that determines how long, in seconds, users must wait between sending messages. |
| subs-only | A Boolean value that determines whether only subscribers and moderators can chat in the chat room. Is true (1) if only subscribers and moderators can chat; otherwise, false (0). |

**Example**

The following example shows the message that the Twitch IRC server sent after a user joined the dallas chat room. The message shows the chat room’s settings.

```
@emote-only=0;followers-only=0;r9k=0;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #dallas

```

The following example shows the message that the Twitch IRC server sent after the moderator turned on slow mode requiring users to wait 10 seconds between sending messages.

```
@slow=10 :tmi.twitch.tv ROOMSTATE #dallas

```

### USERNOTICE Tags  {#usernotice-tags}

   **Reference -- Click to Expand**

Sent when events occur in the channel, such as a user subscribing to the channel. Some examples include:

- A user subscribes to the channel, re-subscribes to the channel. or gifts a subscription to another user.
- Another broadcaster [raids](https://help.twitch.tv/s/article/how-to-use-raids) the channel.
- A viewer milestone is celebrated, such as a new viewer chatting for the first time.

**Prototype**

```
@badge-info=<badge-info>;badges=<badges>;color=<color>;display-name=<display-name>;emotes=<emotes>;id=<id-of-msg>;login=<user>;mod=<mod>;msg-id=<msg-id>;room-id=<room-id>;subscriber=<subscriber>;system-msg=<system-msg>;tmi-sent-ts=<timestamp>;turbo=<turbo>;user-id=<user-id>;user-type=<user-type>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| badge-info | Contains metadata related to the chat badges in the badges tag.  Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| badges | Comma-separated list of chat badges in the form, `<badge>/<version>`. For example admin/1. There are many possible badge values, but here are few:   - admin - bits - broadcaster - moderator - subscriber - staff - turbo Most badges have only 1 version, but some badges like subscriber badges offer different versions of the badge depending on how long the user has subscribed.  To get the badge, use the [Get Global Chat Badges](/docs/api/reference#get-global-chat-badges) and [Get Channel Chat Badges](/docs/api/reference#get-channel-chat-badges) APIs. Match the badge to the `set-id` field’s value in the response. Then, match the version to the `id` field in the list of versions. |
| color | The color of the user’s name in the chat room. This is a hexadecimal RGB color code in the form, #. This tag may be empty if it is never set. |
| display-name | The user’s display name, escaped as described in the [IRCv3 spec](https://ircv3.net/specs/core/message-tags-3.2.html). This tag may be empty if it is never set. |
| emotes | A slash-delimited list of emotes and their positions in the message. Each emote is in the form, `<emote ID>:<ranges>`, where ranges are comma-delimited pairs of indices in the form `<start position>-<end position>`. The position indices are zero-based.  To get the actual emote, see the [Get Channel Emotes](/docs/api/reference#get-channel-emotes) and [Get Global Emotes](/docs/api/reference#get-global-emotes) APIs.  **NOTE**: It’s possible for a message to begin with with `\001ACTION` when /me is used by a user in chat. In these cases emote positions should be considered to begin after `\001ACTION `, which includes its succeeding whitespace. |
| id | An ID that uniquely identifies this message. |
| login | The login name of the user whose action generated the message.d |
| mod | A Boolean value that determines whether the user is a moderator. Is true (1) if the user is a moderator; otherwise, false (0). |
| msg-id | The `type` of notice (not the ID). Possible values are:  - sub - resub - subgift - submysterygift - giftpaidupgrade - rewardgift - anongiftpaidupgrade - raid - unraid - bitsbadgetier - sharedchatnotice - modiversary - viewermilestone |
| room-id | An ID that identifies the chat room (channel). |
| source-badges | Comma-seperated list of chat badges for the chatter in the room the message was sent from. This uses the same format as the `badges` tag. |
| source-badge-info | Contains metadata related to the chat badges in the source-badges tag. |
| source-id | A UUID that identifies the source message from the channel the message was sent from. This will be the same as `id` if this is the message sent to the source channel. |
| source-room-id | An ID that identifies the chat room (channel) the USERNOTICE was sent from. |
| source-msg-id | The value of msg-id from the USERNOTICE sent to the source channel. |
| subscriber | A Boolean value that determines whether the user is a subscriber. Is true (1) if the user is a subscriber; otherwise, false (0). |
| system-msg | The message Twitch shows in the chat room for this notice. The provided string will use `\\s` in place of spaces. |
| tmi-sent-ts | The UNIX timestamp for when the Twitch IRC server received the message. |
| turbo | A Boolean value that indicates whether the user has site-wide commercial free mode enabled. Is true (1) if enabled; otherwise, false (0). |
| user-id | The user’s ID. |
| user-type | The type of user. Possible values are:  - "" - A normal user - admin - A Twitch administrator - global_mod - A global moderator - staff - A Twitch employee |

The following tags are are only included in notices relating to subscriptions, raids, modiversary, and viewer milestones:

| Tag | Description |
|---|---|
| msg-param-cumulative-months | Included only with `sub` and `resub` notices.  The total number of months the user has subscribed. This is the same as `msg-param-months` but sent for different types of user notices. |
| msg-param-displayName | Included only with `raid` notices.  The display name of the broadcaster raiding this channel. |
| msg-param-login | Included only with `raid` notices.  The login name of the broadcaster raiding this channel. |
| msg-param-months | Included only with `subgift` and `modiversary` notices.  **subgift:** The total number of months the user has subscribed. This is the same as `msg-param-cumulative-months` but sent for different types of user notices.  **modiversary:** The total number of months the user has been a moderator in this channel. |
| msg-param-promo-gift-total | Included only with `anongiftpaidupgrade` and `giftpaidupgrade` notices.  The number of gifts the gifter has given during the promo indicated by `msg-param-promo-name`. |
| msg-param-promo-name | Included only with `anongiftpaidupgrade` and `giftpaidupgrade` notices.  The subscriptions promo, if any, that is ongoing (for example, Subtember 2018). |
| msg-param-recipient-display-name | Included only with `subgift` notices.  The display name of the subscription gift recipient. |
| msg-param-recipient-id | Included only with `subgift` notices.  The user ID of the subscription gift recipient. |
| msg-param-recipient-user-name | Included only with `subgift` notices.  The user name of the subscription gift recipient. |
| msg-param-sender-login | Included only with `giftpaidupgrade` notices.  The login name of the user who gifted the subscription. |
| msg-param-sender-name | Include only with `giftpaidupgrade` notices.  The display name of the user who gifted the subscription. |
| msg-param-should-share-streak | Included only with `sub` and `resub` notices.  A Boolean value that indicates whether the user wants their streaks shared. |
| msg-param-streak-months | Included only with `sub` and `resub` notices.  The number of consecutive months the user has subscribed. This is zero (0) if `msg-param-should-share-streak` is 0. |
| msg-param-sub-plan | Included only with `sub`, `resub` and `subgift` notices.  The type of subscription plan being used. Possible values are:  - `>prime` — Amazon Prime subscription - `1000` — First level of paid subscription - `2000` — Second level of paid subscription - `3000` — Third level of paid subscription |
| msg-param-sub-plan-name | Included only with `sub`, `resub`, and `subgift` notices.  The display name of the subscription plan. This may be a default name or one created by the channel owner. |
| msg-param-viewerCount | Included only with `raid` notices.  The number of viewers raiding this channel from the broadcaster’s channel. |
| msg-param-threshold | Included only with `bitsbadgetier` notices.  The tier of the Bits badge the user just earned. For example, 100, 1000, or 10000. |
| msg-param-gift-months | Included only with `subgift` notices.  The number of months gifted as part of a single, multi-month gift. |
| msg-param-category | Included only with `viewermilestone` notices.  The category of the viewer milestone being presented. Possible values are:  - `watch-streak` — A user [Watch Streak](https://help.twitch.tv/s/article/recover-watch-streaks) |
| msg-param-id | Included only with `viewermilestone` notices.  The unique ID of the viewermilestone event. This value is different from the chat message ID. |
| msg-param-value | Included only with `viewermilestone` notices.  The number of consecutive streams watched by the user to achieve this Watch Streak milestone. |

**Example**

The following example shows the message that the Twitch IRC server sent after ronni resubscribed to the dallas channel.

```
@badge-info=;badges=staff/1,broadcaster/1,turbo/1;color=#008000;display-name=ronni;emotes=;id=db25007f-7a18-43eb-9379-80131e44d633;login=ronni;mod=0;msg-id=resub;msg-param-cumulative-months=6;msg-param-streak-months=2;msg-param-should-share-streak=1;msg-param-sub-plan=Prime;msg-param-sub-plan-name=Prime;room-id=12345678;subscriber=1;system-msg=ronni\shas\ssubscribed\sfor\s6\smonths!;tmi-sent-ts=1507246572675;turbo=1;user-id=87654321;user-type=staff :tmi.twitch.tv USERNOTICE #dallas :Great stream -- keep it up!

```

The following example shows the message that the Twitch IRC server sent after tww2 gifted a subscription to Mr_Woodchuck in forstycup’s channel.

```
@badge-info=;badges=staff/1,premium/1;color=#0000FF;display-name=TWW2;emotes=;id=e9176cd8-5e22-4684-ad40-ce53c2561c5e;login=tww2;mod=0;msg-id=subgift;msg-param-months=1;msg-param-recipient-display-name=Mr_Woodchuck;msg-param-recipient-id=55554444;msg-param-recipient-name=mr_woodchuck;msg-param-sub-plan-name=House\sof\sNyoro~n;msg-param-sub-plan=1000;room-id=19571752;subscriber=0;system-msg=TWW2\sgifted\sa\sTier\s1\ssub\sto\sMr_Woodchuck!;tmi-sent-ts=1521159445153;turbo=0;user-id=87654321;user-type=staff :tmi.twitch.tv USERNOTICE #forstycup

```

The following example shows the message that the Twitch IRC server sent after a broadcaster raided the channel.

```
@badge-info=;badges=turbo/1;color=#9ACD32;display-name=TestChannel;emotes=;id=3d830f12-795c-447d-af3c-ea05e40fbddb;login=testchannel;mod=0;msg-id=raid;msg-param-displayName=TestChannel;msg-param-login=testchannel;msg-param-viewerCount=15;room-id=33332222;subscriber=0;system-msg=15\sraiders\sfrom\sTestChannel\shave\sjoined\n!;tmi-sent-ts=1507246572675;turbo=1;user-id=123456;user-type= :tmi.twitch.tv USERNOTICE #othertestchannel

```

The following example shows the message that the Twitch IRC server sent after a user shared their modiversary.

```
@badge-info=;badges=staff/1,moderator/1;color=#007EFE;display-name=BlueLava;emotes=;flags=;id=5d0a7492-b2c4-441b-be78-8606d16ec5e8;login=bluelava;mod=1;msg-id=modiversary;msg-param-months=108;room-id=141981764;subscriber=0;system-msg=has\sbeen\sa\smoderator\sfor\s24\smonths!;tmi-sent-ts=1780142048673;user-id=135093069;user-type=mod;vip=0 :tmi.twitch.tv USERNOTICE #twitchdev :I'm celebrating my 9 year Mod Anniversary!

```

The following example shows the message that the Twitch IRC server sent after a user shared their Watch Streak.

```
@badge-info=;badges=;color=#1E90FF;display-name=TwitchDev;emotes=;flags=;id=97459ff9-8cd9-47d0-8a81-1fa5fe1d4367;login=twitchdev;mod=0;msg-id=viewermilestone;msg-param-category=watch-streak;msg-param-id=a872953b-606f-410a-9970-c95b744f116c;msg-param-value=3;room-id=197886470;subscriber=0;system-msg=TwitchDev\swatched\s3\sconsecutive\sstreams\sthis\smonth\sand\ssparked\sa\swatch\sstreak!;tmi-sent-ts=1681057151588;user-id=141981764;user-type= :tmi.twitch.tv USERNOTICE #twitchrivals

```

### USERSTATE Tags  {#userstate-tags}

   **Reference -- Click to Expand**

Sent when the chatbot joins a channel or sends a PRIVMSG message.

**Prototype**

```
@badge-info=<badge-info>;badges=<badges>;color=<color>;display-name=<display-name>;emote-sets=<emote-sets>;id=<id>;mod=<mod>;subscriber=<subscriber>;turbo=<turbo>;user-type=<user-type>

```

The following are the tags that the message may include:

| Tag | Description |
|---|---|
| badge-info | Contains metadata related to the chat badges in the badges tag.  Currently, this tag contains metadata only for subscriber badges, to indicate the number of months the user has been a subscriber. |
| badges | Comma-separated list of chat badges in the form, `<badge>/<version>`. For example admin/1. There are many possible badge values, but here are few:   - admin - bits - broadcaster - moderator - subscriber - staff - turbo Most badges have only 1 version, but some badges like subscriber badges offer different versions of the badge depending on how long the user has subscribed.  To get the badge, use the [Get Global Chat Badges](/docs/api/reference#get-global-chat-badges) and [Get Channel Chat Badges](/docs/api/reference#get-channel-chat-badges) APIs. Match the badge to the `set-id` field’s value in the response. Then, match the version to the `id` field in the list of versions. |
| color | The color of the user’s name in the chat room. This is a hexadecimal RGB color code in the form, #. This tag may be empty if it is never set. |
| display-name | The user’s display name, escaped as described in the [IRCv3 spec](https://ircv3.net/specs/core/message-tags-3.2.html). This tag may be empty if it is never set. |
| emote-sets | A comma-delimited list of IDs that identify the emote sets that the user has access to. Is always set to at least zero (0). To access the emotes in the set, use the [Get Emote Sets](/docs/api/reference#get-emote-sets) API. |
| id | If a `privmsg` was sent, an ID that uniquely identifies the message. |
| mod | A Boolean value that determines whether the user is a moderator. Is true (1) if the user is a moderator; otherwise, false (0). |
| subscriber | A Boolean value that determines whether the user is a subscriber. Is true (1) if the user is a subscriber; otherwise, false (0). |
| turbo | A Boolean value that indicates whether the user has site-wide commercial free mode enabled. Is true (1) if enabled; otherwise, false (0). |
| user-type | The type of user. Possible values are:  - "" - A normal user - admin - A Twitch administrator - global_mod - A global moderator - staff - A Twitch employee |

**Example**

The following example shows the message that the Twitch IRC server sent after ronni joined the dallas channel.

```
@badge-info=;badges=staff/1;color=#0D4200;display-name=ronni;emote-sets=0,33,50,237,793,2126,3517,4578,5569,9400,10337,12239;mod=1;subscriber=1;turbo=1;user-type=staff :tmi.twitch.tv USERSTATE #dallas

```

## NOTICE Reference  {#notice-reference}

If you request the tags capability, the `NOTICE` message includes the `msg-id` tag (see NOTICE message tags). The following table lists the symbolic constants that the `msg-id` tag may be set to when the Twitch IRC server sends you a `NOTICE` message:

   **Reference -- Click to Expand**

| Msg-Id | Message |
|---|---|
| emote_only_off | This room is no longer in emote-only mode. |
| emote_only_on | This room is now in emote-only mode. |
| followers_off | This room is no longer in followers-only mode. |
| followers_on | This room is now in <duration> followers-only mode. |
| followers_on_zero | This room is now in followers-only mode. |
| msg_banned | You are permanently banned from talking in <channel>. |
| msg_bad_characters | Your message was not sent because it contained too many unprocessable characters. If you believe this is an error, please rephrase and try again. |
| msg_channel_blocked | Your message was not sent because your account is not in good standing in this channel. |
| msg_channel_suspended | This channel does not exist or has been suspended. |
| msg_duplicate | Your message was not sent because it is identical to the previous one you sent, less than 30 seconds ago. |
| msg_emoteonly | This room is in emote-only mode. You can find your currently available emoticons using the smiley in the chat text area. |
| msg_followersonly | This room is in <duration> followers-only mode. Follow <channel> to join the community! Note: These `msg_followers` tags are kickbacks to a user who does not meet the criteria; that is, does not follow or has not followed long enough. |
| msg_followersonly_followed | This room is in <duration1> followers-only mode. You have been following for <duration2>. Continue following to chat! |
| msg_followersonly_zero | This room is in followers-only mode. Follow <channel> to join the community! |
| msg_r9k | This room is in unique-chat mode and the message you attempted to send is not unique. |
| msg_ratelimit | Your message was not sent because you are sending messages too quickly. |
| msg_rejected | Hey! Your message is being checked by mods and has not been sent. |
| msg_rejected_mandatory | Your message wasn’t posted due to conflicts with the channel’s moderation settings. |
| msg_requires_verified_phone_number | A verified phone number is required to chat in this channel. Please visit https://www.twitch.tv/settings/security to verify your phone number. |
| msg_slowmode | This room is in slow mode and you are sending messages too quickly. You will be able to talk again in <number> seconds. |
| msg_subsonly | This room is in subscribers only mode. To talk, purchase a channel subscription at https://www.twitch.tv/products/<broadcaster login name>/ticket?ref=subscriber_only_mode_chat. |
| msg_suspended | You don’t have permission to perform that action. |
| msg_timedout | You are timed out for <number> more seconds. |
| msg_verified_email | This room requires a verified account to chat. Please verify your account at https://www.twitch.tv/settings/security. |
| slow_off | This room is no longer in slow mode. |
| slow_on | This room is now in slow mode. You may send messages every <number> seconds. |
| subs_off | This room is no longer in subscribers-only mode. |
| subs_on | This room is now in subscribers-only mode. |
| tos_ban | The community has closed channel <channel> due to Terms of Service violations. |
| unrecognized_cmd | Unrecognized command: <command> |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
