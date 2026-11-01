# Lane handoff register

Build paused at Tobias’s request on 2026-11-01. Checkpoint snapshot taken before the final Atlas names and handoff commits, from the branch, ahead-count and worktree inventories. Later checkpoint notes have not been re-reviewed. Lane notes are read from each branch's `work/lanes/<lane>/progress.txt`; `../worktrees/<lane>/` identifies the sibling checkout when one exists. An ahead count records ancestry relative to the snapshot base, not a count of unmerged feature work: merge commits may account for it. `0` means the snapshot reports no commits ahead, not that the task is complete. See the lane PRD and progress file for full evidence.

| Lane / branch | Head | Ahead | Latest checkpoint / state and next action |
|---|---|---:|---|
| anvil-hero | `c807642` | 0 | AH06 landed. Forge accepted/closed by Tobias; preserve the current look. Older silhouette criticisms are historical, not a new task. |
| anvil-hero-w2 | `1e55f31` | 0 | Secondary worker instructed to finish only its current task and park; return work to primary lane. |
| atlas | `5016549` | 0 | Atlas visual/live lane remains open; content labels unavailable and /map motion awaits real-GPU review. |
| atlas-door | `2ab4874` | 4 | AD10 camera accepted; next card/door, raid and random sheet captures need fresh survey names. |
| atlas-w2 | `47cf3bc` | 0 | A03 complete; key ceremony, founder review of taxonomy and main founded-record producer remain. |
| atlas-w3 | `6b090e9` | 0 | No lane progress note in this checkout; head is an integration-queue merge. Inspect lane PRD before resuming. |
| avatar-style | `f14087e` | 0 | AS11 builder/earned pieces checkpoint; preserve older earned ribbon marks on tenure updates, then improve deep-skin eye readability. |
| build-templates | `88631ad` | 2 | BT01/02 accepted and mounted; lane parked after current task. |
| build-tools | `c7d52b7` | 0 | BT03 accepted; BT04 remains uncommitted producer work; retain controller and input behavior. |
| campfire | `d93d474` | 9 | Fire game set aside; parked, preserve finished work and do not merge half-done changes. |
| campfire-w2 | `06bcddc` | 7 | CF02 rules authored; remaining untracked files need review and main merge/done-check. Park after current task. |
| card-passport | `104a52f` | 0 | CP10 share flow complete in lane; main still owns public share route/host binding and fresh shelf wording evidence. |
| chronicle | `1b346d1` | 0 | CH02 phone checks and focused checks passed; continuous 30s recording review still pending, plus durable ordered history and authoritative scene bindings. |
| citizen-card | `29b94da` | 2 | CC01 checks/captures passed; real-GPU lighting doubt remains; parked. |
| civic-props | `66a7ea8` | 0 | CP03 heraldry props checkpoint; consult lane progress/PRD for remaining composition and review. |
| crowd-behaviour | `837aeb5` | 0 | CB03 witnessed chat cue behavior checkpoint; consult lane progress/PRD for remaining integration/review. |
| dock | `74f2bd6` | 0 | DK10 authored surface merged; moderator/undo/attendance/procession/fire joins and real stream proof remain. Public-script lint fixed in wrap-up. |
| effects-library | `c807642` | 0 | EL11 mounted. Forge accepted/closed; keep parked. Main owns actual-history adapter/camera joins. |
| emotes | `ac85f2a` | 0 | E08/E09 work recorded; finish cue timestamp bounds and safe scheduled source reconciliation per lane notes. |
| first-look-polish | `4c9bb5a` | 0 | FL02 Forge panel checkpoint; consult lane notes for remaining visual/integration work. |
| first-look-polish-w2 | `6b090e9` | 0 | Main requests closer idle Forge camera framing for phone; camera call-site belongs to integrator. |
| forge-pieces | `4e0354d` | 2 | FP03 review parked; next visual task is readable watchful-owl eyes/beak without bypassing a confident judge rejection. |
| forge-refusals | `04761d2` | 2 | FF02 refusal beat complete/tested; consult PRD for acceptance/remaining integration. |
| forge-ritual | `851dc64` | 0 | FR03 landed; Forge accepted/closed. Earlier listening/capture notes are historical; do not reopen accepted work. |
| genesis-aggman | `b5796bb` | 0 | Head is a merge of growth; no branch-local lane progress found. Check genesis/growth PRDs before resuming. |
| genesis-emote-art | `887faa7` | 0 | Lane marked complete; soften central stained-glass emission while retaining emote features; actual mount is main-owned. |
| genesis-heraldry | `f0ea0d5` | 0 | Heraldry generator checkpoint; use lane progress/PRD for remaining capture and composition. |
| genesis-keepers | `f41c7e0` | 0 | GK10 review reports typecheck/test failures from missing ferryman role and placeholder act; finish role and rerun. |
| genesis-landmarks | `e8a2b67` | 0 | GL03 proposals exist; placement unvalidated; reframe river capture and inspect mountain scene. |
| genesis-masha | `5ea162a` | 0 | GM10 mountain city checkpoint; consult lane progress for remaining captures/integration. |
| genesis-pinkkitty | `54ddebf` | 0 | GP10 needs unfounded-land label restored; size test exceeded Vitest duration. |
| genesis-sound | `8545c0c` | 0 | Main must mount soundscape on kingdom audio host and update it per rendered frame/visibility/profile. |
| grand-artisans | `adac9ac` | 4 | GA10 kit/material checkpoint; remaining views/orbit and native producer integration. |
| grand-kingdom | `a6f92ae` | 0 | GK10 producer plus GK11 merge; GK11 pipeline hook is not adopted, sizing and paved material dependencies remain. Main adoption is separate. |
| grand-kingdom-w2 | `3183120` | 0 | Branch head predates GK11 merge; inventory showed dirty GK11 work in its checkout. Producer settlement/worker/layer hook and sizing remain the join. |
| ground-dressing | `c7a5af0` | 0 | GD03 merged; bind tree collision proxies/elder seat only after durable founded placement authority. |
| ground-dressing-w2 | `13a11a6` | 0 | Head is realm identity/fenced-loading commit; no lane-specific progress note found. Review PRD before resuming. |
| growth | `a052c61` | 2 | GR10 Emberfold v2 content, exports and earned version-aware native publication are on main. Uncommitted presentation/capture work remains in the lane; new cottage still not visually accepted. |
| growth-card | `f6ccc08` | 0 | GCA02 keepsake disclosure checkpoint; check lane progress for remaining task. |
| growth-civic | `e872286` | 0 | Fully merged per takeover instruction; retire this lane. |
| growth-crier | `abd21c7` | 0 | GCR02 witnessed growth batching checkpoint; consult PRD for remaining integration. |
| growth-history | `9c5b1be` | 0 | GH02 safe simulated scene projection checkpoint; consult PRD for remaining integration. |
| herald | `8d2b3ef` | 0 | Lane complete and parked. |
| home-interiors | `6b090e9` | 0 | Queue merge head; lane progress only records park-after-current-task policy. |
| homes-hearth | `a088e76` | 0 | HH04 accepted; main integrated verify and collection evidence passed. |
| homes-tide | `e0d6438` | 0 | HT03 manor/hall family checkpoint; use lane progress/PRD for remaining checks. |
| integrator | `8c1a92d` | 0 | No lane progress note found; head is Forge engraving fix. |
| interactions | `3eb261f` | 0 | IN03 interaction controller checkpoint; consult PRD for remaining mount/review. |
| kingdom-land | `fc4dee3` | 0 | LD04 main merge; soften bright red route scar with worn earth center and irregular green verge. |
| kingdom-land-w2 | `13a11a6` | 0 | Head is realm identity/fenced-loading commit; lane notes say parked. |
| kingdom-light | `1b44498` | 0 | KL04 sunlit-floor gap fix; consult PRD for any remaining review. |
| kingdom-light-w2 | `e3e8cae` | 0 | KL04 duplicate branch checkpoint; consult lane ownership before resuming. |
| kingdom-light-w3 | `375f980` | 0 | Queue merge head; no branch-local progress note found. |
| live-twitch | `c1f2eb7` | 0 | Capture guard stopped long series; resume with one still/short clip per lock, then inspect latest progress. |
| panel-stream | `d094e7a` | 0 | PS06 simulated config/live-config and interaction checkpoint; stream-show name timing passed isolated rerun. |
| passport | `f6fc95b` | 0 | P04 passport stamp/share picture checkpoint; consult PRD for public route integration. |
| picture-land | `a175e51` | 0 | PL03 producer v2 and seven looked-at iterations complete; review lane notes for next task. |
| picture-trees | `008a130` | 0 | PT10 tree family complete; verify sculpt tests and before/after stream view as recorded. |
| places-high | `477c33a` | 0 | PH01 actual-renderer place bench checkpoint; consult PRD for review/integration. |
| places-high-w2 | `6b090e9` | 0 | Queue merge head; park-after-current-task note. |
| places-high-w3 | `6b090e9` | 0 | Queue merge head; no branch-local progress note found. |
| places-water | `9254915` | 0 | PW01 boats/boathouse exports; file review, captures, focused tests and root validation remain. |
| places-water-w2 | `6b090e9` | 0 | Queue merge head; park-after-current-task note. |
| raid-gate | `9c41703` | 0 | RG10 gift policy/welcome flow checkpoint; consult PRD for remaining proof/integration. |
| raid-road | `2056fed` | 0 | Head is main merge; no lane progress note found. |
| realm-server | `a4664ce` | 0 | RS06 flood threshold corrected; focused checks pass; full verify hit unrelated Herald issue, isolated rerun pending. |
| realm-server-w2 | `02a1242` | 0 | Main merge head; one-worker policy says secondary worker parks after current task. |
| realm-server-world | `e0ef054` | 0 | FW02 collision compiler/adapter checkpoint; consult PRD for remaining integration. |
| realm-wiring | `a1cb0ad` | 0 | RW05 parked WIP in evidence patch; not ticked. Reconcile with main's current authority and needs before resuming. |
| sky-moments | `ac41f47` | 0 | Dragon settled in dusk town; no branch-local progress note found. |
| soul | `2af7d75` | 0 | SO10 checkpoint; blocked on civic/topology binding and authoritative clock, plus real walk/stream demonstration. |
| sound | `74c002c` | 0 | Lane complete and parked. |
| street-props | `a088e76` | 0 | SP03 accepted; integrated verify and collection/join evidence passed. |
| tavern-tables | `908f772` | 2 | TT02 runtime/durable host checkpoint; main must review runtime and supply realm package/Postgres adapter. |
| tavern-tables-w2 | `2101711` | 0 | Handoff docs checkpoint; park-after-current-task policy. |
| try-it | `e68485c` | 0 | TI10 gateway/panel checkpoint; capture guard stopped long capture series; resume individually. |
| twitch-moments | `6bcfcdd` | 0 | TM10 composed support path verified through ingest, durable delivery and room feed; consult PRD for remaining product proof. |
| twitch-moments-w2 | `bc9d2ab` | 0 | Handoff docs checkpoint; park-after-current-task policy. |
| vox-import | `3d41bec` | 4 | VI03 phone fit sheet hides object; collapse file details after selection and preserve visible object/Insert action. |
| walk-controller | `faa57bb` | 0 | WC06 prediction checkpoint; needs realm-wiring revision collision source and WC05 grounded step-ease binding; main test has unrelated x+44/30 failure. |
| walk-controller-w2 | `295cfaa` | 0 | Branch merge head; secondary worker parks after current task. |
| walking-together | `c851a59` | 3 | WT10 consumer patch is on main; observed-head fixture correction applied and tested in wrap-up. Approved outfits/tools, gestures, own door, terrain/soft-push and guest speech remain main-owned; motion proof incomplete. |
| wardrobe-body | `dc7927b` | 0 | WB02 visual set completed in later lane note, but branch still has outstanding capes fit review/contrast doubts; check latest PRD before tick. |
| wardrobe-body-w2 | `4da2c7c` | 3 | Merge head; duplicate WB02 note says visual done-check incomplete. Resolve against primary lane before resuming. |

## Remaining named seams

- **Soul:** civic/clock topology binding and authoritative clock are main-owned; lane's last checkpoint is blocked until those exist.
- **Dock:** main-owned integration fixes/authority presentation and actual stream proof are outstanding; lane's latest checkpoint is blocked.
- **Walking together:** the observed-head fixture patch is applied and tested. Supply approved outfits/tools, gestures, own door, terrain/soft-push and guest speech before native-town motion proof.
- **Grand kingdom:** the GK10 producer is on `../worktrees/grand-kingdom/`; GK11 changes are merged there at the branch head, while `../worktrees/grand-kingdom-w2/` has its own earlier head and dirty work per inventory. Producer pipeline dependencies (settlement-aware worker, post-raise seating, reserve clearing, sites/focus, cache identity, layer lifecycle, size and paved material) remain unjoined; kingdom-scene adoption remains main-owned.
- **Growth civic:** fully merged; retire branch `lane/growth-civic`. The content/adapter is not actual site installation: cleared tavern/bridge anchors and production scene binding remain main-owned.
- **Unready grand adoption:** local branch `wip/grand-land-adoption` at `5dcc56d` preserves the complete main-owned hosted terrain/water candidate and actual failed frame. It is not merged into main. See that branch’s `work/evidence/grand-adoption-wip/README.md`. The browser stayed loading for 300s; no fix is proven. A CPU run used a different kingdom identity and cannot certify the actual render.

Accepted Forge/window-wave/light work stays closed. Older producer art requests in rows above do not override Tobias’s acceptance. All next actions are handoff context; no worker is being restarted by this document.

## Preserved uncommitted lane work

These edits were left untouched. Counts are `git status --short` entries, not file or feature counts; an untracked directory is one entry. Progress-only edits are preserved too.

| Lane worktree | Status entries | First paths |
|---|---:|---|
| `lane/anvil-hero-w2` / `../worktrees/anvil-hero-w2` | 1 | `work/lanes/anvil-hero/progress.txt` |
| `lane/atlas` / `../worktrees/atlas` | 21 | `apps/surveyor/src/live/target.ts`, `apps/surveyor/src/serve.ts`, `apps/web/src/atlas/atlas.css`, `apps/web/src/atlas/checks/atlas-checks.mjs`, `apps/web/src/atlas/data/preview.ts`, `apps/web/src/atlas/index.tsx`, `apps/web/src/atlas/map/view.ts`, `apps/web/src/atlas/ui/Card.tsx` |
| `lane/atlas-w2` / `../worktrees/atlas-w2` | 1 | `work/lanes/atlas/progress.txt` |
| `lane/atlas-w3` / `../worktrees/atlas-w3` | 1 | `work/lanes/atlas/progress.txt` |
| `lane/campfire` / `../worktrees/campfire` | 2 | `work/lanes/campfire/PRD.md`, `work/lanes/campfire/progress.txt` |
| `lane/civic-props` / `../worktrees/civic-props` | 4 | `packages/content/src/civic/index.ts`, `work/lanes/civic-props/progress.txt`, `packages/content/src/civic/review.ts`, `packages/content/src/civic/square.ts` |
| `lane/crowd-behaviour` / `../worktrees/crowd-behaviour` | 1 | `work/lanes/crowd-behaviour/progress.txt` |
| `lane/first-look-polish-w2` / `../worktrees/first-look-polish-w2` | 1 | `work/lanes/first-look-polish/progress.txt` |
| `lane/genesis-pinkkitty` / `../worktrees/genesis-pinkkitty` | 1 | `work/lanes/genesis-pinkkitty/progress.txt` |
| `lane/grand-kingdom` / `../worktrees/grand-kingdom` | 1 | `work/lanes/grand-kingdom/progress.txt` |
| `lane/grand-kingdom-w2` / `../worktrees/grand-kingdom-w2` | 13 | `apps/web/src/grand/kingdom/attach.ts`, `apps/web/src/grand/kingdom/mount.ts`, `packages/world/src/grand/kingdom/frame.ts`, `packages/world/src/grand/kingdom/grade.ts`, `packages/world/src/grand/kingdom/index.ts`, `packages/world/src/grand/kingdom/kingdom.test.ts`, `packages/world/src/grand/kingdom/seat.ts`, `packages/world/src/grand/kingdom/types.ts` |
| `lane/ground-dressing-w2` / `../worktrees/ground-dressing-w2` | 1 | `work/lanes/ground-dressing/progress.txt` |
| `lane/growth` / `../worktrees/growth` | 7 | `apps/web/src/growth/capture.mjs`, `apps/web/src/growth/growth.test.ts`, `apps/web/src/growth/town.ts`, `work/lanes/growth/progress.txt`, `work/evidence/growth/cottage-street@1920x1080.png`, `work/evidence/growth/hut-cottage-street-pair.png`, `work/evidence/growth/hut-street@1920x1080.png` |
| `lane/herald` / `../worktrees/herald` | 1 | `work/lanes/herald/progress.txt` |
| `lane/home-interiors` / `../worktrees/home-interiors` | 2 | `work/lanes/home-interiors/progress.txt`, `packages/content/src/home-interiors/` |
| `lane/homes-hearth` / `../worktrees/homes-hearth` | 1 | `work/lanes/homes-hearth/progress.txt` |
| `lane/homes-tide` / `../worktrees/homes-tide` | 1 | `work/lanes/homes-tide/progress.txt` |
| `lane/interactions` / `../worktrees/interactions` | 34 | `apps/realm/src/interactions/authority.ts`, `apps/realm/src/interactions/index.ts`, `apps/realm/src/interactions/interactions.test.ts`, `apps/realm/src/interactions/ports.ts`, `apps/web/src/interactions/README.md`, `apps/web/src/interactions/bench/court.ts`, `apps/web/src/interactions/bench/main.tsx`, `apps/web/src/interactions/bench/room.ts` |
| `lane/kingdom-land-w2` / `../worktrees/kingdom-land-w2` | 1 | `work/lanes/kingdom-land/progress.txt` |
| `lane/kingdom-light` / `../worktrees/kingdom-light` | 1 | `work/lanes/kingdom-light/PRD.md` |
| `lane/live-twitch` / `../worktrees/live-twitch` | 53 | `apps/herald/src/auth/auth.test.ts`, `apps/herald/src/auth/grants.ts`, `apps/herald/src/cli/report.ts`, `apps/herald/src/ingest/ingest.test.ts`, `apps/herald/src/ingest/ingest.ts`, `apps/herald/src/ingest/spectacles.test.ts`, `apps/herald/src/ingest/spectacles.ts`, `apps/herald/src/ingest/subscriptions.ts` |
| `lane/panel-stream` / `../worktrees/panel-stream` | 1 | `work/lanes/panel-stream/progress.txt` |
| `lane/places-high-w2` / `../worktrees/places-high-w2` | 1 | `work/lanes/places-high/progress.txt` |
| `lane/places-high-w3` / `../worktrees/places-high-w3` | 1 | `work/lanes/places-high/progress.txt` |
| `lane/places-water-w2` / `../worktrees/places-water-w2` | 1 | `work/lanes/places-water/progress.txt` |
| `lane/realm-server` / `../worktrees/realm-server` | 65 | `apps/realm/README.md`, `apps/realm/src/ingress/codec.ts`, `apps/realm/src/ingress/transition.test.ts`, `apps/realm/src/ingress/transition.ts`, `apps/realm/src/kingdom-room.test.ts`, `apps/realm/src/outbox/dispatcher.ts`, `apps/realm/src/outbox/projection.test.ts`, `apps/realm/src/outbox/projection.ts` |
| `lane/realm-server-w2` / `../worktrees/realm-server-w2` | 1 | `work/lanes/realm-server/progress.txt` |
| `lane/realm-server-world` / `../worktrees/realm-server-world` | 1 | `work/lanes/realm-server/progress.txt` |
| `lane/realm-wiring` / `../worktrees/realm-wiring` | 7 | `work/lanes/realm-wiring/PRD.md`, `work/lanes/realm-wiring/progress.txt`, `apps/herald/src/realm-sink/`, `apps/realm/src/wiring/`, `apps/web/src/realm/adapters/`, `work/lanes/realm-wiring/decisions.md`, `work/lanes/realm-wiring/evidence/` |
| `lane/sound` / `../worktrees/sound` | 1 | `work/lanes/sound/progress.txt` |
| `lane/street-props` / `../worktrees/street-props` | 1 | `work/lanes/street-props/progress.txt` |
| `lane/tavern-tables-w2` / `../worktrees/tavern-tables-w2` | 4 | `work/lanes/tavern-tables/progress.txt`, `work/specs/22-tavern-tables.md`, `apps/web/src/tavern/`, `packages/games/` |
| `lane/try-it` / `../worktrees/try-it` | 3 | `work/lanes/try-it/PRD.md`, `work/lanes/try-it/progress.txt`, `work/evidence/try-it/` |
| `lane/twitch-moments-w2` / `../worktrees/twitch-moments-w2` | 5 | `work/lanes/twitch-moments/progress.txt`, `apps/api/`, `apps/herald/src/twitch-moments/`, `apps/web/src/twitch-moments-bench/`, `apps/web/src/twitch-moments/` |
