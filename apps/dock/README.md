# The throne dock

Solid/Vite app, built at `/dock/`. It uses the existing Chatdom Twitch sign-in cookie and the
same-origin `/api/dock/status` and `/api/dock/actions` routes. The API resolves the person and
verifies authority. Current royal acts are broadcaster-only; verified moderators can observe.

For development, set `CHATDOM_DOCK_API` to an API you own and run
`pnpm --filter @chatdom/dock dev` (strict port 5176). Build with
`pnpm --filter @chatdom/dock build`; preview uses strict port 5177. Check ports are free first.
No fixture or fake success runs in this app. The separate evidence harness supplies visibly
SIMULATED HTTP responses. API failures disable controls.

Once the public origin serves this build and its API, add the `/dock/` URL as an OBS Custom
Browser Dock. A moderator selects their kingdom with `/dock/?kingdom=<Twitch broadcaster ID>`;
the API verifies access. Sign-in returns to `/dock`; the selected kingdom is restored from
this browser's session storage. No credentials belong in the dock URL. The page also works directly
in a browser. At narrow widths it scrolls vertically; selections stay focused during polling.

The realm bridge is a required integration dependency, detailed in
`work/lanes/dock/needs.md`. Until it exists the dock deliberately reports unavailable and
cannot produce stream ceremonies. An accepted action requires a realm delivery receipt.
Lost/uncertain replies lock further actions across a reload until the streamer explicitly
checks the stream. The client never automatically resends an action.

The app reuses the shared UI typefaces and quiet audio kit. The sound toggle controls only
this dock's cues. It does not mute the kingdom's stream audio.
