# The throne dock

Solid/Vite app, built at `/dock/`. It uses the existing Chatdom Twitch sign-in cookie and the
same-origin `/api/dock/status` and `/api/dock/actions` routes. The API resolves the person and
verifies authority. Current royal acts are broadcaster-only; verified moderators can observe.
The app checks `/api/realm/session` before reading the dock, independently of bridge
availability. Sign-out uses `/api/realm/signout` with the canonical session CSRF token.

For development, set `CHATDOM_DOCK_API` to an API you own and run
`pnpm --filter @chatdom/dock dev` (strict port 5176). Build with
`pnpm --filter @chatdom/dock build`; preview uses strict port 5177. Check ports are free first.
No fixture or fake success runs in this app. The separate evidence harness supplies simulated HTTP responses; provenance remains in the response mode. API failures disable controls.

Once the public origin serves this build and its API, add the `/dock/` URL as an OBS Custom
Browser Dock. A moderator selects their kingdom with `/dock/?kingdom=<Twitch broadcaster ID>`;
the API verifies access. Sign-in returns to `/dock`; the selected kingdom is restored from
this browser's session storage. No credentials belong in the dock URL. The page also works directly
in a browser. At narrow widths it scrolls vertically. Named targets are direct action buttons,
three entries per group, with paging for additional targets. Stable IDs preserve their focus
during polling; only the pressed button changes its label while a request is pending.

The realm bridge is a required integration dependency, detailed in
`work/lanes/dock/needs.md`. Until it exists the dock deliberately reports unavailable and
cannot produce stream ceremonies. An accepted action requires a realm delivery receipt.
Lost/uncertain replies lock further actions across a reload until the streamer explicitly
checks the stream. The client never automatically resends an action.
Recovery is partitioned by the authenticated session's opaque `resumeScope` and kingdom.
Session replacement or confirmed sign-out clears prior recovery; storage failure leaves the
page readable and disables acts that cannot be recovered. After a command, the client
rechecks the session before applying its reply, so a replaced identity cannot inherit it.

Undo prefers the realm's optional `undoable` receipt list when supplied. An empty list means
none; an absent list falls back to the last accepted receipt saved in this session, subject
to the authority's undo capability and final realm validation. A refused cached undo is
cleared. No receipt or browser storage value grants authority by itself.

The app reuses the shared UI typefaces and quiet audio kit. The sound toggle controls only
this dock's cues. It does not mute the kingdom's stream audio.

## Decisions

- 2026-11-02: The 2026-11-01 founder decision 25 removes visible simulation labels. Internal response modes and validation remain unchanged.
