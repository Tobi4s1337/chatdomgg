---
name: voxel-content
description: Make voxel content for Chatdom (props, house pieces, homes, wardrobe pieces, emote statues, forge parts) in the house style, with renders and a contact sheet to judge them by eye. Use for any content-library or fan-out content task.
---

# Voxel content

1. **Read first:** `packages/content/README.md` (the current format, palette and budgets; the main thread owns
   it), `chatdom/Artstyle-Soul-Feel.md` (the world and characters sections) and `chatdom/World-Tree.md` (where
   the thing belongs).
2. **The look:**
   - A crafted diorama: bevelled, chunky, warm, with hand-placed detail where the eye lands.
   - Never flat Minecraft cubes, never noisy random voxels.
   - Silhouette first, then the material break-up, then two or three accents.
   - Emissive voxels are people's light. Use them on purpose.
3. **Make it in code or data,** never by image generation. Generators in TypeScript with a seeded rng are best for
   families (25 roof variants from one grammar beat 25 hand-made ones). Hand-authored data suits hero pieces.
4. **Stay in the kingdom's palette and style kit.** Each kingdom has a kit (palette, emote motifs, native
   material, shape language). The same prompt in two kingdoms should come out in two different styles.
5. **Render and look.** Run the content render script to get each piece from three angles at dusk light, plus a
   contact sheet per folder. Open the sheet with `view_image`. Do up to three improvement rounds. Weak pieces
   get cut, not shipped.
6. **Validate.** Run the content validator (schema, palette lock, voxel budget, unique names). It must be green
   before you report.
7. **Scope.** Work only in the folder you were given. Never run git. Report the sheet paths and the pieces you
   cut.
