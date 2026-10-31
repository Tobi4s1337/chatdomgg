# Spec 49: Avatar style study
Status: frozen 2026-10-31
Vision: `chatdom/ChatDom.md` (belonging, make it yours); `chatdom/Artstyle-Soul-Feel.md` (characters); `chatdom/Quality.md` (one palette, crafted diorama).

## What and why
Tobias chooses the citizen's shape by seeing three clearly different voxel interpretations of the same five wardrobe looks together. The choice must be about proportions and silhouette, while each person's identity and clothing remain recognizable. This is a study, not a production rollout.

## Current state
`apps/web/src/citizens/review.ts` and `review.html` provide the existing citizen bench, camera and light; `capture-review.mjs` captures it. `packages/content/src/avatars/review.ts` and `README.md` describe actual simulated wardrobe fixtures and their renderer. The current rig and wardrobe are read-only inputs, not an invitation to redesign their contracts.

## Rules
- R1. Produce three distinct geometry and proportion options: chunky Cube World/Trove inspired, blockier Minecraft inspired, and slim storybook voxel. All three are genuine choices for Tobias; keep original assets and the kingdom palette.
- R2. Pick five existing real wardrobe fixture looks, document their IDs, and preserve the same five, their outfits, poses, skin tones, hair identities, order, scale reference, camera, lighting, backdrop and framing across all options. Label every fixture SIMULATED. Differences must be visible in body/head/limb proportions and silhouettes, not merely palette or material changes.
- R3. Hair stays fitted to the head and recognizable without bloated round masses; bodies must feel alive, not stiff. Keep palette and crafted toy-kingdom feel. Do not disguise identity differences as style changes.
- R4. Render each option at 1920×1080 using the same existing bench setup. Also produce one labelled side-by-side contact sheet containing all three options and all five full-body citizens per option; if 1920×1080 overall, ensure figures remain large enough to judge silhouette and facial/hair identity, and retain the individual full-resolution views for inspection. No cropping feet or heads.
- R5. Open the sheet and individual views with `view_image`; compare against the art direction. Improve the distinct silhouettes by looking. Every visual fix gets a before/after side-by-side using the same view and controls, preserved with the evidence.
- R6. AS02 stays unchecked until Tobias explicitly selects an option. No default choice, inferred approval, or production wardrobe rollout. Record his actual choice before work proceeds; his selection authorizes main to apply that style across the wardrobe.
- R7. After selection, prepare the selected conversion recipes and fixtures for the whole wardrobe in the owned scope, and hand them to main's wardrobe lane for application. Main applies the selected style to production wardrobe files; this lane supplies the selected art recipes within its owned folders. Verify that selected recipes preserve each look's identity and fit.

## Contracts and scope
Consume the existing avatar rig, palette and review fixtures as read-only. No shared/core rig contract changes, new avatar engine, collision or netcode work. Write only new `apps/web/src/citizens/style-study/**` and `packages/content/src/avatar-style/**` fixture files, plus this lane's PRD and progress. Existing production wardrobe and global rendering/runtime files remain read-only. If those boundaries prevent the study, record the precise blocker for main; do not widen scope.

## Acceptance
Run `pnpm typecheck`, `pnpm exec vitest run <changed-test-files>` when tests are added or changed, and `pnpm --filter @chatdom/web build`. Capture the three 1920×1080 options, labelled contact sheet and any before/after comparisons with the study's documented repeatable command. Open and judge them with `view_image`; record paths, fixture IDs, controls, remaining weaknesses and results in progress. One focused visual look per iteration; no unrelated screenshot matrix. The study is ready for Tobias to pick only when all three are legible and genuinely distinct.

## Quality bar
A handmade, warm voxel kingdom: deliberate silhouettes, coherent palette, no random voxel noise, generic reskins, bloated hair or rigid mannequin bodies. The study is a visual comparison, not proof of production animation or performance. `packages/content/README.md` and `packages/content/src/avatars/README.md` describe the current formats and palette.

## References
Existing citizen bench and wardrobe fixtures above; no external system or new engine is required.

## Not now
Production rollout before selection; speculative systems, rig changes, networking and collision work.

## Decisions
- 2026-10-31: Tobias selects the look explicitly. Until then AS02 remains pending. Main applies the chosen style through the wardrobe lane if production files are outside this lane's scope.
