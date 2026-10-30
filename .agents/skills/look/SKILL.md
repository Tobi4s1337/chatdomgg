---
name: look
description: Take screenshots of Chatdom surfaces at the standard sizes in headless Chrome (WebGL via SwiftShader), look at them, and judge them against the art direction. Use for any visual change before calling it done.
---

# Look at it

Visual work is done only once you have looked at it.

## Sizes

| Surface | Viewports |
|---|---|
| Web app (kingdom, Atlas, build mode) | 1440×900 and 390×844 |
| Stream view / overlay | 1920×1080 (also check 1280×720) |
| Chatdom panel (extension) | 318×496 |

## How

- Use the repo's shot script (`pnpm shots` / `packages/testing`). If it doesn't exist yet, build it once:
  - Use Playwright with `channel: 'chrome'`, headless.
  - Launch args: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox`.
  - Point it at a running dev server or a `vite preview`.
  - Each page sets `window.__chatdomReady = true` once the first meaningful frame has rendered (assets loaded,
    camera placed). Wait for that flag, not for a timeout.
  - Pass a deterministic seed and a fixed time of day through URL params (`?seed=…&hour=…`), so shots compare
    run to run.
  - Write to `shots/<area>/<name>@<w>x<h>.png`. `shots/` is gitignored. Copy the shots you want as evidence
    into `work/evidence/<task>/`.
- There is no GPU, so SwiftShader is slow: keep scenes reasonable and never trust fps here.
- Open every shot with `view_image`. For many shots, tile a contact sheet with ffmpeg
  (`ffmpeg -i a.png -i b.png -filter_complex hstack …`) and look at that.

## Judge

Hold the shot against `chatdom/Artstyle-Soul-Feel.md` and the slop list in `chatdom/Quality.md`:
- Does warm light read as people?
- Is it a crafted diorama, or flat Minecraft?
- Does the UI look carved and handmade, or like generic dark glass?
- Is the text readable at 390 px?
- Is there anything clipped, z-fighting, empty or placeholder-looking?

Fix what looks cheap before you report. In the evidence block, name the shots and say what you still don't like.
