# Spec 49: Citizens like this, and a real avatar builder
Status: frozen 2026-10-31 (replaces the three-option style study; Tobias chose none of A/B/C)
Vision: `chatdom/ChatDom.md` (belonging, make it yours); `chatdom/Artstyle-Soul-Feel.md` (characters); `chatdom/Quality.md`.
Reference: `work/references/avatar-style/reference.png` (twenty bust portraits on a purple gradient). This is the look.

## What and why
Every citizen is the person behind a chat name. They must be instantly lovable at thumbnail size, and two citizens should
rarely look alike. The look is the reference: crisp chunky voxel heads, an iconic minimal face, hair as the signature,
patterned layered clothes, accessories with personality. Around it, a real avatar builder: Twitch gives you a sensible
default, you tweak it, and you wear what you earned by being there. The same character appears everywhere: walking in the
kingdom, on stream, on the citizen card, and as the passport portrait.

## The look (what makes the reference work)
- L1. Crisp, chunky voxels at one consistent resolution. Square head about 10-12 voxels wide, hard edges, no rounding or
  smoothing. Short, compact body; the head dominates without looking bloated. Hair sits close to the head (at most about
  one voxel proud of the skull except where the style itself is the silhouette: buns, afro, ponytail, long waves).
- L2. Minimal face: two solid black eye blocks, no mouth. Optional eye variants (spacing, glasses over them, a closed
  blink), freckles and blush as single-voxel paint. Character comes from hair, accessories and clothes, not the face.
- L3. Hair as the signature silhouette: at least sixteen distinct styles at low resolution (curls, buns, afro, ponytail,
  bob, long waves, quiff, side shave, mohawk, braids, spiky, slicked, short crop, bald, pigtails, wild tuft), any colour
  including wild ones; beards and moustaches as separate parts.
- L4. Accessories: cap (forward and backwards), beanie, straw hat with a coloured band, wizard-ish pointed hat, round and
  square glasses, goggles, scarf, earrings, a flower.
- L5. Clothes with pattern and layers: tee, tank, hoodie, plaid shirt, vest or jacket over a tee, overalls, tie, scarf,
  printed tees, robes; trousers, shorts, skirts; strong colours. Patterns are painted voxels (plaid, stripes, a chest print).
- L6. Clean soft lighting. Every look reads as a bust portrait on a Twitch-purple gradient at 128 px and at 512 px, and as
  a full body at stream distance in the dusk kingdom.

## The builder
- B1. A builder page in the web app and a compact layout for the Twitch panel: hair style and colour, a wide range of skin
  tones, eye variants, freckles and blush, beard, hat, glasses, top, bottom and outer layer with dyes. Live turntable
  preview (drag to rotate) with the bust portrait beside it. Randomise, then tweak. Undo. Saves to the person's look.
- B2. Defaults from Twitch: the chat name colour becomes the favourite dye; sub tenure unlocks tenure garb; the default look
  is seeded from the person id, so a newcomer already looks like someone.
- B3. Earned items, never bought: tenure ribbons and hood, passport keepsakes worn as pins, Forge-made accessories (a forged
  hat or pin, from the piece's palette and motif), moment drops (the cheer cape, the raid scarf). In the builder, locked
  items show how they're earned. Seeded SIMULATED earn states make the bench show all of them.
- B4. Variety: the combination space is large and the randomiser avoids near-duplicates in one town.

## Contracts and scope
- Build on `AvatarPartBlueprint`, the rig, the sockets (`hat`, `face`, `back`, grips) and `citizen-look` in
  `@chatdom/shared`. If the look recipe, the rig proportions or the sockets must change for this look, write the exact
  proposal to `work/lanes/avatar-style/contract-proposal.md` and stop that part: main freezes contract changes.
- Lane scope: `packages/content/src/avatar-style/**` (parts library, recipes, randomiser, portrait renderer helpers),
  `apps/web/src/avatar-builder/**` (builder page and panel layout), `apps/web/src/citizens/style-study/**` (retire or reuse),
  this lane's records and captures. Main wires the character into the kingdom, stream, card and passport, and mounts the
  compact builder in `apps/panel`. Both builder layouts consume the same recipe and parts, never separate characters.
- Keep the existing avatar voxel lattice for every part, including hair and facial paint. Capes remain the frozen thin
  cloth-sheet treatment, not voxel backpacks. A new head shape does not silently change live rig offsets or sockets.
- A save must use the real person's look authority supplied by main; a preview draft is not a saved look. Earned-item
  availability reads verified entitlement records, never a client-only grant. Propose any missing save/entitlement seam
  to main while continuing the visible parts; seeded earning records are explicitly SIMULATED.

## Acceptance
`pnpm typecheck`, the changed test files with `pnpm exec vitest run <files>`, and `pnpm --filter @chatdom/web build`.
Captures that are looked at with view_image, side by side with the reference: a 4×5 contact sheet of twenty different
citizens as bust portraits on the purple gradient (same layout as the reference), a full-body lineup at stream distance in
dusk light, and the builder at 1920×1080 and at panel size. Every visual fix keeps a same-view before/after.

## Quality bar
Put the contact sheet next to the reference: it should be hard to say which is ours. Crisp, deliberate, lovable, varied.
No blobby hair, no rounded smoothing, no generic mannequins, no muddy palettes.

## Decisions
- 2026-10-31 19:45: Tobias rejected all three study options and chose this reference look plus a real builder with earned
  items. The same character everywhere.
- 2026-10-31: Main reviewed and approved the replacement spec and reference. The former AS02 choice gate is superseded;
  AS03 can proceed. Recipe, rig and socket proposals still require a small tested freeze by main before adoption.
