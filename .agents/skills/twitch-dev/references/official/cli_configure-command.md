<!-- source: https://dev.twitch.tv/docs/cli/configure-command/ -->

Contents

# Configure the Twitch CLI  {#configure-the-twitch-cli}

Before you can use the Twitch CLI, you must configure it with your application’s client ID and secret. For information about getting a Twitch client ID and secret, see [Register your app](/docs/authentication/register-app).

The `configure` command sets information that the CLI requires to run. For most commands that you’ll use, the CLI requires your application’s client ID and secret. By default, `configure` asks for the information using interactive prompts.

```
% twitch configure
Client ID: t214nt...
Client Secret: hyss6ng...
Updated configuration.

```

To provide your application’s client ID and secret without prompts, use the following flags:

| Flag | Shorthand | Description |
|---|---|---|
| --client-id | -i | Your app’s client ID. |
| --client-secret | -s | Your app’s client secret. |

You must provide both flags; otherwise, `configure` prompts you for the missing information.

```
% twitch configure -i g4lvqc... -s u4vcrix...
Updated configuration.

```

## Next steps  {#next-steps}

The next step is to [get an access token](/docs/cli/token-command) to use with the [api](/docs/cli/api-command) command.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
