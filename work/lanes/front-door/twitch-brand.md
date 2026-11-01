# Twitch brand: what we checked and the rules the sign-in seal follows

Checked on **1 November 2026**. This is our reading of Twitch's published rules, not legal advice. Anything outside
them goes to brandquestions@twitch.tv with a mock-up.

## Sources and versions

| Source | Version or date |
|---|---|
| brand.twitch.tv (now redirects to brand.twitch.com, one "Brand Assets" page) | sitemap lastmod 6 Nov 2024 |
| Brand kit `https://brand.twitch.com/uploads/Twitch-Brand.zip` | sha256 `d892d03a52af30f5734c8f39fa4e46f07f48a79b5b7432441f833028e4cd14a8`, files dated 2023-05-28 to 2024-03-06 |
| "Logo Usage Guidelines (Speedrun Edition)", the PDF in the kit | **v3.0, 14 December 2023** |
| Trademark Guidelines, legal.twitch.com/en/legal/trademark/ | last modified 11 July 2018 |
| Developer Services Agreement, legal.twitch.com/en/legal/developer-agreement/ | last modified 4 December 2024 |
| Extensions Guidelines 4.3 and "Designing Extensions", dev.twitch.tv | read 1 Nov 2026 |

## The mark we use

- `apps/web/src/site/twitch/glitch_flat_purple.svg`: the kit's **Twitch Purple Glitch** (purple body and eyes,
  white face built in), copied byte for byte. sha256
  `7d18ac0c4b836855f913d51e88e97cb3cf2e0deabe8b21ef5c744a5dbe40e078`, the same as
  `Twitch Logos/02. Glitch/01. Twitch Purple/glitch_flat_purple.svg` in the kit.
- It is loaded as an `<img>`, never inlined, so its class and id names can't collide and nothing on the page can
  restyle its paths.

## Rules followed, and how

| Rule (source) | How the seal follows it |
|---|---|
| Use the official file and colours, unchanged (Trademark Guidelines; PDF p.4–5) | The unaltered purple SVG on a **Black Ops `#000000`** plate, a combination the guidelines show on p.5. |
| Clear space: a third of the Glitch's width on top, left and right; half its width below the bubble body (PDF p.2) | The black plate is exactly that box. Its padding is W/3 on the top and sides and 0.2917·W under the tail tip, which puts W/2 under the bubble body (`.seal-plate` in `apps/web/src/site/site.css`, `--g` is the mark's width). The brass bezel, the walnut and the label all sit outside the plate. |
| No stretch, rotation, outline, effects, shadow, glow, gradient, texture or 3D on the Glitch; no masking imagery inside it; never a low-res version (PDF p.7–8) | The mark keeps its 6:7 aspect (`width: var(--g); height: calc(var(--g) * 7 / 6)`). No CSS `filter`, `mix-blend-mode`, shadow or transform applies to the mark or its plate; the plate's shadows ring the plate's edge outside the clear space. The vector is used at every size. |
| No busy background behind the mark (2018 guide; a reasonable reading of v3.0) | The plate is flat black; the walnut texture never reaches it. |
| Minimum size: none published | Our own floor: the mark is 15 px wide in a phone's header, 18 px in the desktop header and 22 px in the story. |
| Functional use only; no logos in third-party marketing, websites or hero art (Trademark Guidelines, "Logos") | The Glitch appears only on the sign-in seal, which starts Twitch sign-in. It is not in the hero picture, the story's pictures, the crest or any ornament. Signed in, the seal swaps the mark for our own wax seal. |
| Twitch's marks as adjectives; Twitch's own buttons say "Log in with Twitch" / "Connect with Twitch" | The label is **"Sign in with Twitch"**. No Chatdom feature or product name contains "Twitch". |
| Be honest about the relationship; imply no endorsement (Developer Services Agreement; Trademark Guidelines) | Every page's footer: "Live from Twitch. Chatdom is not affiliated with or endorsed by Twitch." and "Twitch and the Glitch logo are trademarks of Twitch Interactive, Inc." The wording is ours: Twitch requires no exact sentence. |
| A clear path to the source for Twitch content (Developer Services Agreement §VII.C) | Not applicable to the seal. The Atlas cards' "Watch on Twitch" buttons cover this (atlas-map, with the kit's mark in FD11). |

## The Twitch panel extension: no Glitch

Extensions Guidelines 4.3: "Extensions may not use the Twitch name, Twitch branding, the Twitch logo, Twitch global
emotes, or the Twitch Glitch in their Extension content." "Designing Extensions": "Your extension cannot include
Twitch-branded elements, including the Twitch or Glitch logos."

So the seal, the Twitch mark and the Twitch footer line are **for chatdom.io pages only**. The panel (`apps/panel`,
panel-window's) must not show the Glitch or the word "Twitch" as branding. This is written in SEAMS.md §3 for
panel-window.

## Open questions

- Twitch publishes no button spec. The brass bezel around the black plate is unusual enough that a mock-up to
  brandquestions@twitch.tv before launch is worth sending (Tobias decides; it is listed in `legal-review.md`).
- The hero plate's entrance animation fades the whole plate in, seal included. The mark itself is never animated,
  recoloured or moved relative to its plate. We read that as within the rules.
