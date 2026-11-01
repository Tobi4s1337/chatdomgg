# PW13 owner requests

PW13 remains unticked. No production deployment, extension console action or Twitch write was performed.

needs: raid-show Apply `PW13-NEEDS.patch` to `apps/herald/src/auth/grants.ts`. It limits first connection to Tech §7.2's six Tier 1 scopes. The patch passes `patch --dry-run -p1`; it is deliberately unapplied here. Main/front-door must provide the actual founding OAuth entry and its connection result before Config can offer a truthful “Found your kingdom” link. No public founding mutation or usable entry currently exists; a guessed link is not a substitute.

needs: front-door Supply the live-only Passport production entry described under “Exact shared-kit request” in `PW10-NOTES.md`, keeping exported names stable. The strict extension checker still finds simulation strings in the shared Passport chunks. Remove runtime simulation discriminants and seals from the production entry rather than hiding them or weakening the checker. This lane will then switch its import and rerun packaging.

needs: main Resolve the extension-owner identity bootstrap: Twitch's external PubSub JWT requires `user_id` to identify the extension owner, while `channel_id` identifies the receiving channel. Neither the Extension Secret nor Client ID contains that numeric identity. The current API explicitly names `TWITCH_EXTENSION_OWNER_ID` in health and disables publishing without it; this is an extra public setting and the original two-value promise remains unmet. Provide a trusted owner-metadata bootstrap or approve this explicit setting in the switch-on contract. Never infer the owner from a target channel. See https://dev.twitch.tv/docs/extensions/building/#signing-the-jwt.

needs: panel-window Continue the Configuration Service mirror work. Realm compare-and-save serializes Hide with gift commits. The page checks the realm revision before Helper set and after its matching callback; delayed responses cannot report a stale Saved. A newer realm save can still occur between the precheck and Helper set, leaving an older Twitch segment even though the postcheck reports conflict. Add a server-owned, revision-ordered Configuration Service publisher with durable retry/reconciliation; keep the realm purchase gate authoritative until both copies converge. Do not call this mirror race solved by the page checks.

needs: main/grand-world Existing production capability/dispatch/effect requests in `PW12-NEEDS.md` and `.patch` remain. Configuration and registered SKUs cannot fabricate effect readiness. Local browser proof uses an explicit test-only atomic dispatch; no production gift is enabled by that test.

needs: capture Once GPU Chrome reconnects, run the complete `--wait 30 --max 10` batch documented in `PW13-NOTES.md` and inspect every image. A busy shared lease is not a PW11 blocker. Hosted Test and the real C04 purchase remain unrun; Tobias's numbered checklist is `HOSTED-TEST.md`.
