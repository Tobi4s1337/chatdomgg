<!-- source: https://dev.twitch.tv/docs/cli/ -->

Contents

# Twitch CLI  {#twitch-cli}

Twitch offers a command-line interface for managing Twitch resources. You can execute the commands in a terminal window or script.

## Download and install the Twitch CLI  {#download-and-install-the-twitch-cli}

Depending on your operating system, use the following options to download and install the Twitch CLI. Both options add the CLI to your path.

If you have trouble installing or running the CLI, request help by posting a note in the **#cli-help** channel of the [TwitchDev Discord server](https://discord.com/invite/G8UQqNy).

### MacOS or Linux  {#macos-or-linux}

To install the CLI on macOS or Linux, use [Homebrew](https://brew.sh/). Using Homebrew has the added benefit of managing versioning for you.

To install the CLI using Homebrew, run the following command from a terminal window:

```
brew install twitchdev/twitch/twitch-cli

```

To upgrade the CLI, use:

```
brew upgrade twitchdev/twitch/twitch-cli

```

### Windows  {#windows}

To install the CLI on Windows, use [Scoop](https://scoop.sh/). Using Scoop has the added benefit of managing versioning for you.

To install the CLI using Scoop, run the following commands from a terminal window:

```
scoop bucket add twitch https://github.com/twitchdev/scoop-bucket.git
scoop install twitch-cli

```

To upgrade the CLI, use:

```
scoop update twitch-cli

```

### Manual Download  {#manual-download}

To download the CLI manually, go to Twitch CLI [Releases](https://github.com/twitchdev/twitch-cli/releases). Scroll down to the **Assets** section of the page and click the link (.gz or .zip) for your OS and extract the files. You can use the checksum file to verify the executable, if needed. Make sure your system Path includes the path to the Twitch CLI binary (twitch) you downloaded.

**Note**: On macOS, if you’re not able to run commands, you may need to change the binary’s permissions to allow execution. From the binary’s folder, run: `chmod 755 twitch`.

## Twitch CLI Usage  {#twitch-cli-usage}

After installing the Twitch CLI, open a terminal window and enter `twitch` at the command prompt to display the CLI’s usage.

```
$ twitch
A simple CLI tool for the New Twitch API and Webhook products.

Usage:
  twitch [command]

Available Commands:
  api         Used to call the Twitch API
  configure   Used to configure your Twitch CLI with your Client ID and Secret
  event       Used to test your webhook callback or WebSocket client
  help        Help about any command
  mock-api    Used to call the mock Twitch API, which returns mock data
  token       Returns an access token using your configured client id and secret
  version     Returns the current version of the CLI

Flags:
      --config string   config file (default is $HOME/.twitch-cli/.twitch-cli.env)
  -h, --help            help for twitch

Use "twitch [command] --help" for more information about a command.

```

## Contributing changes to the CLI  {#contributing-changes-to-the-cli}

To help make the CLI better, see [CONTRIBUTING](https://github.com/twitchdev/twitch-cli/blob/main/CONTRIBUTING.md).

## License  {#license}

This library is licensed under the Apache 2.0 License.

## Next steps  {#next-steps}

The next step is to [configure the CLI](/docs/cli/configure-command).

To test your webhook callback, see [Testing webhook events](/docs/cli/event-command).

To test your WebSocket client, see [Testing WebSocket events](/docs/cli/websocket-event-command).

To create a mock server and mock data that you can use to test your application’s calls to the Twitch API, see the [mock-api](/docs/cli/mock-api-command) command.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
