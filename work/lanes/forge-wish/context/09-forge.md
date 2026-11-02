<!-- Copy of the goals file 09-forge.md from Tobias's workbook, 1 Nov 2026. Phase labels and a few unrelated words reworded; the content is unchanged. -->
# 9 Forge: Words almost always become things

**End state:** A wish typed in chat or at the anvil almost always becomes something: a house part, a prop or something to wear, in the kingdom's own style, revealed on stream and placed where you choose. The forge remembers everything it made and who wished for it.

**Today:** Since 31 Oct, 12 of 15 wishes were refused after being built, mostly because the picture check could not recognise the subject (a dragon reads as a blob). The Forge knows 3 part types and 7 motifs. In the live kingdom the anvil only says "write !forge in chat".

## I01 Soften and retry, never refuse for quality
- **Tobias note:** Most requests fail and say the forge is in a mood tonight.
- **Today (honest):** Quality failures are treated as refusals and play the public mood beat. Softening is not built. Private messages say "the forge is cold tonight" for every cause.
- **Decided:** Soften plus quiet retry; only safety failures refuse (Q6).
- **Ambitious end state:** Four outcomes: delivered; quietly retried; softened ("the closest I can make"); refused only for safety, privately, with the nameless mood beat at most once every 10 minutes. 90% or more of safe wishes come back as a piece, with a median reveal under 60 s. Each private message names the real cause.
- **Done when:** The refusal rate over a set of 50 typical wishes; tests per outcome.
- **Phase:** 1 (in the Monday build)
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/codex/src/providers/policy.ts, providers/index.ts; .forge.local/runs.jsonl.

## I02 visitors that agree with themselves
- **Today (honest):** The same owl plan scored 0.01 in one run and 0.99 in another; either judge can veto alone.
- **Ambitious end state:** Judge scores are calibrated and recorded; one noisy judge cannot veto alone; the checks run on warm sessions so a wish takes seconds, not minutes.
- **Done when:** A repeatability test on fixed wishes.
- **Phase:** 1 (in the Monday build)
- **Size:** M
- **Source:** Added
- **Notes:** apps/codex/src/providers/codex-cli.ts.

## I03 A much larger Forge
- **Today (honest):** 3 part types (chimney, lantern, weathervane), 7 motifs, 3 finishes, 4 accents.
- **Decided:** All house slots, composed parts, and wardrobe items too (Q7).
- **Ambitious end state:** The Forge makes all 18 house parts, props and furniture, and things to wear (hats, capes, held toys) for the avatar builder, composed from hand-made sub-parts in the kingdom's style. A weekly loop adds the motifs people ask for most.
- **Done when:** A contact sheet of 50 wishes across slots, each recognisable.
- **Depends on:** H03, G01
- **Phase:** 2 Launch
- **Size:** XL
- **Source:** Tobias
- **Notes:** packages/shared/src/forge.ts:11-13.

## I04 Forge from the play screen
- **Tobias note:** Forge: make it possible to use it while playing, like the menu on the forge demo screen.
- **Today (honest):** In the live kingdom the anvil shows "Write !forge in Twitch chat". Typing a wish works only in the simulated bench.
- **Decided:** In-world typing posts to Twitch (Q14), so the same applies here.
- **Ambitious end state:** At the anvil, a wish box sends your wish as your own "!forge" chat message, so the stream sees it and the same coal and safety rules apply. You watch it being forged where you stand.
- **Done when:** A recording from the walk.
- **Depends on:** F10
- **Phase:** 1 (in the Monday build)
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/web/src/kingdom/index.tsx:148.

## I05 The forge remembers
- **Tobias note:** A list of items the forge created in that kingdom so far (by whom).
- **Today (honest):** No list.
- **Ambitious end state:** A wall at the forge, and a page in the Esc menu and the panel, list every piece forged here, with the piece, who wished for it and when; later, how many homes carry copies.
- **Done when:** Stills with real entries.
- **Phase:** 1 (in the Monday build)
- **Size:** S
- **Source:** Tobias
- **Notes:** Chronicle facts hold the data.

## I06 Choose where it goes, and wear its twin
- **Tobias note:** The items one gets should be in an inventory: placed in build mode after the animation, or wardrobe unlocks.
- **Today (honest):** Forged parts attach straight onto the house.
- **Decided:** Choose at the reveal plus a worn twin (Q24).
- **Ambitious end state:** At the reveal you place it on a free slot now or send it to your bag for later. Forging a house part also unlocks a matching worn piece (a hat or pin with the same motif).
- **Done when:** Recording; tests.
- **Depends on:** G01, H06
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias

## I07 No wish is lost
- **Today (honest):** The forge service restarts every 10 to 90 minutes with builds and loses wishes in flight; one wish at a time on the bench.
- **Decided:** Keep the Codex login (Q8).
- **Ambitious end state:** Wishes are queued durably and survive restarts; several can be forged at once; the streamer sees the queue.
- **Done when:** A restart test mid-wish.
- **Phase:** 1 (in the Monday build)
- **Size:** M
- **Source:** Added
- **Notes:** The host service log records the forge restarts. See open question on the Codex login.
