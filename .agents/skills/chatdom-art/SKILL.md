---
name: chatdom-art
description: Generate painted art for Chatdom (interiors, game boards, UI art, concept and target frames, Atlas stamps) with the built-in image_gen tool, in the house style, and bring it into the repo properly. Use whenever a task needs a painting or illustrated texture, not for voxel models, fonts or icons.
---

# Painted art for Chatdom

## What to generate, and what never to

| Generate | Never generate |
|---|---|
| Painted interiors (tavern, throne room), game-board styles, concept and target frames, parchment and wood textures, tavern signs, crest backgrounds | Voxel models or props (they come from code and grammar, `$voxel-content`), fonts and lettering, icons, logos, anything that has to match pixel-exact across a set |

## How

- Use the built-in `image_gen` tool (the `$imagegen` system skill). It needs no API key, but uses plan limits
  3–5x faster than a normal turn. Batch carefully, and don't regenerate for small taste differences.
- Files land in `~/.codex/generated_images/<thread>/`. **Copy** the keepers into the repo at
  `packages/content/art/<area>/<name>.png`, and write `<name>.json` next to each with the prompt, the date and
  the reference images used (provenance).
- **Style anchor.** Every prompt starts from the house style in `chatdom/Artstyle-Soul-Feel.md`: "a handmade toy
  kingdom at dusk, lit by its people". Warm, rich saturation; painterly; storybook, not anime and not
  photoreal. Pass one or two earlier keepers as reference images, so a set stays consistent.
- **Interiors.** Paint one master painting per room, then split it into depth layers. Separately generated
  layers never match in scale.
- **Post-process:** crop to the target size, quantise to the kingdom palette where the spec asks for it, fix
  alpha edges on cut-outs, and export WebP for runtime.
- Look at every keeper with `view_image` next to the screenshot of where it will sit. Reject anything generic,
  wrongly lit, or with garbled text.
- Pure AI output is not "hand-painted". Never label it that way.

If `image_gen` fails with a usage limit, stop generating and say so in your evidence block. The Replicate MCP is
the fallback, but only when the brief allows it.
