# The Chatdom panel on twitch.tv/tobi4s_: console steps

These steps put the panel into Hosted Test on the tobi4s_ channel. Hosted Test is visible only to the owner and
to accounts on the testing allowlist. You need the Twitch account that owns tobi4s_ (with two-factor sign-in on),
the zip `chatdom-panel-0.0.1.zip`, and https://chatdom.io already running ([README.md](README.md)).

Build the zip with `node scripts/public/extension.mjs` (part of `node scripts/public/build.mjs`). It writes
`deploy/public/dist/chatdom-panel-0.0.1.zip`, and next to it a report of the checks it passed.

1. **Open the console.** Go to https://dev.twitch.tv/console/extensions, signed in as tobi4s_.
2. **Create or pick the version.**
   - New: click **Create Extension**, name it `Chatdom`, set the version to `0.0.1`, choose the type **Panel**,
     and also tick **Mobile**.
   - Existing: open `Chatdom`, then open version `0.0.1` (or **Create New Version** with the next number, and
     build the zip with `--version <that number>`).
3. **Version Details.** Fill in the summary (`Your chat's kingdom, under the stream: your home, your card and
   your passport.`), the description and both emails. Logos and screenshots are needed only for review, not for
   Hosted Test.
4. **Capabilities.**
   - **Request Identity Link:** Yes (so a viewer can share who they are and see their own card).
   - **Chat Capabilities:** No. **Bits:** off. **Configuration:** None.
   - **Allowlist for Panel URLs:** `https://chatdom.io`
   - **Allowlist for Config URLs:** leave empty.
   - Save.
5. **Monetization.** Answer No to Bits and to subscription support, then save.
6. **Asset Hosting.**
   - **Testing Base URI:** `https://localhost:8080/` (used only by Local Test; Hosted Test serves the zip)
   - **Panel Viewer Path:** `panel.html`. **Panel Height:** `496`
   - **Mobile Path:** `mobile.html`
   - **Config Path:** `config.html`. **Live Config Path:** `live_config.html`
   - **Allowlist for URL Fetching Domains:** `https://chatdom.io`
   - **Allowlist for Image Domains** and **Allowlist for Media Domains:** leave empty.
   - Save.
7. **Access.** In **Testing Account Allowlist**, enter `129634568` (tobi4s_), plus the numeric Twitch user IDs of
   anyone else who should see it, separated by commas. Save.
8. **Give the host its keys.** Open **Extension Settings** (top right). Send the host the **Client ID** and the
   **Extension Secret** (the long base64 value under *Extension Secrets*) through the password manager, never
   by email. The host sets them as `TWITCH_EXTENSION_CLIENT_ID` and `TWITCH_EXTENSION_SECRET` and restarts.
   Check `https://chatdom.io/healthz` answers `200` afterwards.
9. **Upload the zip.** Go to **Files** → **Upload Version Assets**, choose `chatdom-panel-0.0.1.zip`, and wait until
   it says the assets are uploaded.
10. **Move to Hosted Test.** Go to **Status** and click **Move to Hosted Test**. If Twitch lists missing fields,
    fill them in and click it again.
11. **Install it on the channel.** On **Status**, click **View on Twitch and Install**, then **Install**.
12. **Activate it.** On the tobi4s_ creator dashboard, go to **Extensions** → **My Extensions** → `Chatdom` →
    **Activate** → **Set as Panel 1**.
13. **Check it.** Open https://www.twitch.tv/tobi4s_ in a browser signed in with an allowlisted account, then
    scroll below the video to the panels. Accept Twitch's test-extension notice. The panel shows Willowmere.
    Tap **See your citizen card**, share your identity when Twitch asks, and your own card and passport open.
    The app works the same way: open the channel, tap the panel tab under the video.

**If the panel stays empty:** the account is not on the testing allowlist (step 7), or the panel is not
activated (step 12). If it shows *Out of reach*, check that the host has the keys (step 8), that
`https://chatdom.io` is in the URL Fetching allowlist (step 6), and that the zip was built for
`https://chatdom.io`. Its report says which origin it was built for.
