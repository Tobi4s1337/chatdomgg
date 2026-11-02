<!-- Copy of the goals file 08-make-it-yours.md from Tobias's workbook, 1 Nov 2026. Phase labels and a few unrelated words reworded; the content is unchanged. -->
# 8 Make it yours: Your look and your home are yours

**End state:** Your look and your home are yours: a joyful builder full of funny and earned pieces, a wardrobe in your home, pieces you own placed anywhere on your lot as you walk, and real voxel building inside and out, all saved to your Twitch identity and seen by everyone.

**Today:** Today the builder saves to the browser only and the walking avatar is one of six starter looks. Building exists only in a simulated preview, with mirror mode, no way to work under a roof and a placeholder owner name.

## H01 Your look is saved to you
- **Today (honest):** The builder saves to localStorage; walkers wear one of 6 starter looks picked by hash.
- **Ambitious end state:** Your look is stored against your Twitch identity and shows everywhere: the walk, the stream, your card, the panel, the Atlas.
- **Done when:** Test across two browsers; stills.
- **Depends on:** A09
- **Phase:** 1 (in the Monday build)
- **Size:** M
- **Source:** Added
- **Notes:** packages/shared/src/citizen-look.ts; apps/realm/src/auth/authenticator.ts:73.

## H02 A builder made with love
- **Tobias note:** Nicer typography, more love and ambition, more depth, show the passion, better choices.
- **Today (honest):** Small 11 to 12 px labels; earned pins are 1 to 2 voxels and unreadable.
- **Decided:** Reopen the builder's interface; the character art stays accepted (Q23).
- **Ambitious end state:** Item cards that tell each piece's story, a close-up zoom on what you wear, a reveal moment for every unlock, readable earned pieces, beautiful type.
- **Done when:** Stills.
- **Phase:** 1 (in the Monday build)
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/web/src/avatar-builder/builder.css.

## H03 Many more pieces, including funny ones
- **Tobias note:** Increase options where reasonable: creative, funny items. Much more items to unlock.
- **Today (honest):** About 70 parts across hair, face, hats, glasses, clothes and dyes. Nothing funny or held; fey ears were decided but never built.
- **Decided:** New items in the accepted style (Q23).
- **Ambitious end state:** At least 250 pieces: a funny tier (silly hats, held toys, face paint), fey ears, seasonal pieces, and pieces earned through tenure, moments, games, fishing and the Forge. A free base set for everyone. Every new set is checked for harmful combinations.
- **Done when:** A contact sheet of every piece; combination tests.
- **Depends on:** G01
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Tobias
- **Notes:** packages/content/src/avatar-style/character/recipe.ts; Safety §3.1.

## H04 A wardrobe in your home
- **Tobias note:** Integrate into the game: you can go home and change there (think Animal Crossing).
- **Today (honest):** Not mounted anywhere in the game. Home interiors are types only.
- **Decided:** Mirror in the intro and a wardrobe at home (Q22).
- **Ambitious end state:** A wardrobe or mirror stands in your home; you change there and walk out wearing it.
- **Done when:** Stills and a short clip.
- **Depends on:** H01, H05
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias

## H05 Homes you can live in
- **Today (honest):** Entering a home lands you in an empty shell. Interiors are types only, no fitter.
- **Ambitious end state:** Every home has a furnished, candlelit interior that matches its tier, with room for the pieces you place.
- **Done when:** Stills of each tier inside.
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Added
- **Notes:** home-interiors lane PARTIAL; spec 31.

## H06 Place your pieces as you walk
- **Tobias note:** Make it possible to place some items also in play view (think Animal Crossing).
- **Today (honest):** Not possible. Forge parts attach only to fixed house slots.
- **Decided:** Pieces for everyone; voxels for returning citizens (Q16).
- **Ambitious end state:** Pick a piece from your bag, see a ghost preview, rotate and set it on your lot or inside your home on a half-metre grid, without leaving the walk. Leave gifts on doorsteps.
- **Done when:** Recording; tests for ownership and lot bounds.
- **Depends on:** G01
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Tobias

## H07 Real voxel building in the live kingdom
- **Today (honest):** Building works only in a simulated preview with drafts in the browser. Live publishing needs a review service that does not exist.
- **Decided:** Free voxels open to returning citizens (Safety.md, Q16).
- **Ambitious end state:** Returning citizens build their home block by block in the live kingdom, saved durably and checked before it goes on the street.
- **Done when:** A recorded build published to a live kingdom.
- **Depends on:** D07 hold queue
- **Phase:** 2 Launch
- **Size:** XL
- **Source:** Added
- **Notes:** specs 12 to 14.

## H08 Working inside under a roof
- **Tobias note:** Weird in building mode when you want to do something inside; not possible if a layer is on top; find what other games do.
- **Today (honest):** Orbit camera with face picking; no cutaway or level selection.
- **Decided:** Tech §8.2: a dollhouse cutaway takes over indoors.
- **Ambitious end state:** The roof lifts away automatically when you work inside; Page Up and Page Down pick a level with a clean cut; a walls-down toggle like The Sims.
- **Done when:** Stills at each level.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias
- **Notes:** build/session.ts.

## H09 Remove mirror mode
- **Tobias note:** Remove this mirror mode, it confuses.
- **Today (honest):** Mirror (off, X, Z, X+Z) is in the build bar.
- **Decided:** Remove entirely (Q35).
- **Ambitious end state:** Mirror mode is gone from the build tools.
- **Done when:** Still; tests updated.
- **Phase:** 1 (in the Monday build)
- **Size:** S
- **Source:** Tobias
- **Notes:** Amend spec 13 R3 and Tech §9 (L13).

## H10 A build menu worth using
- **Tobias note:** Improve the menu, nicer typography.
- **Today (honest):** Wood-and-parchment panel with 4 tools, 16 swatches, 3 brushes; owner name hard-coded as "Juniper".
- **Ambitious end state:** A clear, carved build menu in the shared kit, with the real owner's name and your pieces one tap away.
- **Done when:** Stills.
- **Phase:** 1 (in the Monday build)
- **Size:** S
- **Source:** Tobias
- **Notes:** apps/web/src/kingdom/index.tsx (Juniper).

## H11 Sub pieces and the sub tint
- **Today (honest):** Decided; not built.
- **Decided:** Subs grant capes, banners and colours, and tint the edge of a light (never brighter); they dim when a sub lapses.
- **Ambitious end state:** Real sub status gives sub pieces and a light-edge tint by tier.
- **Done when:** Stills.
- **Depends on:** H01
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** ChatDom §8.
