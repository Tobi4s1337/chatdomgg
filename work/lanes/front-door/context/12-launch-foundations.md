# 12 Launch foundations: Ready for real streamers

**End state:** Chatdom can be run in public by saartech.de: anyone can sign in, install the panel and use it, the legal pages exist, data rights are honoured, the service on this host is supervised and backed up, and the vision files say what was decided today.

**Today:** Today sign-in fails at Twitch, the extension is not created, there is no imprint, privacy policy or terms, robots.txt returns a page, everything runs in tmux on a shared host, and several of today's answers contradict the vision files.

## L01 Register the Twitch redirect URI
- **Today (honest):** Sign-in fails at Twitch.
- **Ambitious end state:** https://chatdom.io/api/realm/auth/callback is registered on the Twitch app; sign-in works.
- **Done when:** A real sign-in.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added
- **Notes:** HANDOVER §2.1.

## L02 Create the panel extension; Hosted Test
- **Today (honest):** The zip passes Hosted Test checks; the extension does not exist yet.
- **Ambitious end state:** The extension exists on dev.twitch.tv in Hosted Test, the testing account is allowed, the backend keys are set and the public window restarted.
- **Done when:** The panel loads on tobi4s_ for the testing account.
- **Depends on:** L03 privacy URL
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added
- **Notes:** deploy/public/EXTENSION-STEPS.md; zip in worktrees/public/deploy/public/dist/.

## L03 Imprint, privacy policy and terms (saartech.de)
- **Today (honest):** None; /privacy returns 404.
- **Decided:** The operator is saartech.de (Q30).
- **Ambitious end state:** An imprint for saartech.de, a privacy policy covering Twitch data, presence of quiet viewers, retention and rights, and terms for the extension, linked from every page and the extension.
- **Done when:** Pages live and linked.
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Added
- **Notes:** Twitch requires a privacy URL for the extension.

## L04 Data rights and reports
- **Today (honest):** "!chatdom forget" and data export are not built; no report path.
- **Decided:** Safety §7.
- **Ambitious end state:** Export and erase on request, a report path from the panel and the site, and a notice-and-action process.
- **Done when:** Tests.
- **Depends on:** L03
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## L05 Extension review and Bits onboarding
- **Today (honest):** Bits off; no reviewed version.
- **Ambitious end state:** Plan releases around 3 to 15 working days of review. Complete monetisation onboarding for saartech.de, including the tax interviews.
- **Done when:** An approved version.
- **Depends on:** L02, L03
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** Twitch.md §17.

## L06 Run properly on this host
- **Today (honest):** Services run in tmux windows; the Atlas data service is unsupervised; production shares cores 9 to 11 with other services.
- **Decided:** Stay on this host (Q31).
- **Ambitious end state:** Chatdom's services are supervised containers within cores 0 to 8, with database backups, health checks and an alert when something is down. Clear limits on what load is safe on this host.
- **Done when:** A restart drill and a restore from backup.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** the managed services, the public gateway and the Atlas data service on 5193.

## L07 Ready to be found
- **Today (honest):** noindex on; robots.txt returns HTML; no sitemap or share images. Docs say chatdom.gg, the site is chatdom.io.
- **Ambitious end state:** Decide the canonical domain; robots.txt, sitemap, page descriptions and share images for kingdoms and cards; remove noindex at launch.
- **Done when:** Checks.
- **Phase:** 2 Launch
- **Size:** S
- **Source:** Added

## L08 Every name renders
- **Today (honest):** Panel fonts are Latin-only.
- **Decided:** English UI with fonts for every script (Q32).
- **Ambitious end state:** Names in every script (Cyrillic, CJK, Arabic, Thai, and so on) render well in the panel, Atlas, cards and world.
- **Done when:** Stills of names in 8 scripts.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added

## L09 No SIMULATED labels
- **Today (honest):** Simulated scenes carry SIMULATED chips.
- **Decided:** No labels at all (Q25, a general rule).
- **Ambitious end state:** Remove SIMULATED chips from every visible surface and record the change in the vision files.
- **Done when:** A search shows none left.
- **Depends on:** L13
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added
- **Notes:** See the open question on honesty.

## L10 Abuse limits
- **Today (honest):** Public routes have no per-IP limits; the stream view link is public.
- **Ambitious end state:** Per-IP limits on public routes, protection for the Twitch rate budget, secret stream links.
- **Done when:** Load and abuse tests.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## L11 Consent of featured streamers
- **Today (honest):** The Showcase features The_AGGman, PinkKittyRose and MashaD4; no recorded consent.
- **Ambitious end state:** Written consent from each featured streamer, or their kingdoms removed from public pages.
- **Done when:** Consent on file.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added

## L12 Clean up the lanes
- **Today (honest):** realm-server has an unresolved merge; several lanes hold partial work (see the register).
- **Ambitious end state:** Every lane is merged, finished or closed with a clear note; no unresolved merges.
- **Done when:** The register is current.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** work/HANDOFF-LANES.md.

## L13 Update the vision files for today's decisions
- **Today (honest):** Several answers contradict chatdom/*.md.
- **Decided:** See the Decisions tab, "Changes" column.
- **Ambitious end state:** Each reversed decision is amended in its file with a dated change-log line, so the team builds from one truth.
- **Done when:** Diff reviewed by Tobias.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added
- **Notes:** ChatDom.md says designs follow it or it changes on purpose.
