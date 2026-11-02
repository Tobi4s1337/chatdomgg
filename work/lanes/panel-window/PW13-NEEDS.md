# PW13 owner requests

No production deployment, extension console action or Twitch write was performed.

needs: raid-show Apply `PW13-NEEDS.patch` to `apps/herald/src/auth/grants.ts`. It limits a first connection to Tech §7.2's six
Tier 1 scopes. The patch passes `patch --dry-run -p1` and is deliberately left unapplied here. Main or front-door must
supply the real founding OAuth entry and its connection result. Until then, Config honestly says "Kingdom not connected"
and offers no "Found your kingdom" link, because a link to Twitch consent with no callback would be fake success. Once
the entry exists, the link is one anchor in `apps/panel/src/Config.tsx` beside `cfg-connection`, with
`https://chatdom.io` already in the Panel URLs allowlist.

needs: main/grand-world The production gift capability, dispatch and effects in `PW12-NEEDS.md` and `.patch` still
stand. Settings and registered SKUs cannot make an effect ready, so the production shelf stays closed until its owner
mounts the effects.

Resolved: the extension owner ID is a settled lane decision (see `PW13-CONTRACT.md`, "The switch-on values"). The
shared Passport entry landed in PW10, and the zip passes. The full GPU capture ran on 2 November 2026.

Open with Tobias: Hosted Test (`HOSTED-TEST.md`), which ends with the first real test-mode gift. C04's purchase bar
stays open until that gift happens.
