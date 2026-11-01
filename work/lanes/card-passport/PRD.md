# Lane card-passport
Spec (background, Rules and Decisions hold): `work/specs/45-raid-passport.md`, with `19-citizen-card.md` and `07-panel-stream.md` · Branch: `lane/card-passport` · Worktree: `../worktrees/card-passport` · Worker: Opus high
Scope: `apps/panel/src/**`, `apps/web/src/passport/**`, `apps/web/src/citizen-card/**`, `packages/ui/src/passport/**`, `shots/card-passport/**`, and this lane's PRD, progress and evidence (`work/lanes/card-passport/**`, `work/evidence/card-passport/**`).

## The part
Your place in the kingdom, inside Twitch: the citizen card and the raid passport in the panel, made with love, with the new painted portraits. Open the panel beside the stream and there you are: your painted citizen (the same character as in the town and the builder), your home and its tier, your tenure, your keepsakes and earned pieces. Turn the page and it's your passport: a worn leather book with inked stamps and wax seals, one for each raid you rode in (the kingdom visited, its crest and colours, the date, the road on the Atlas, who led it, the gift left or brought back), plus kingdoms visited and bonds. Never a stats list.
The bar: someone who has never heard of Chatdom opens the panel and wants one. Beautiful at the real panel size (318×496) and on the card page, with a share picture; one portrait everywhere.
You own it end to end and make the design calls.
Context: what exists in `apps/panel/src` (passport/, ui/), `apps/web/src/passport` and `apps/web/src/citizen-card`, `packages/ui/src/passport`; the avatar recipe-to-portrait entry points in `packages/content/src/avatar-style/` and the builder in `apps/web/src/avatar-builder/` (use them, don't change them); `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/Moments.md`.
Boundaries: `apps/api`, `packages/shared`, the avatar-style package and the kingdom and stream scenes are main's; privacy rules from the passport lane (disclosure) hold. Fixtures stay labelled SIMULATED.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.

## Tasks
- [ ] **CP10 — The card and the passport in the panel, with the painted portraits.** Card and passport at panel size and on the card page, with the painted portrait, the stamps and seals, page-turn and gesture motion, sounds, the share picture, captured as before/after against the current panel.

## Backlog
