# 3 Panel: The panel: a small, beautiful window under the video

**End state:** Under the video, a quiet, beautiful window into the kingdom: your lit window with your name, tonight's live moment, and a gift shelf. Three tabs, almost no text, real data, and it works on Twitch mobile too.

**Today:** In the simulated fixture it looks good. For a real viewer almost every section says "not reaching the panel yet", the portrait never shows, travel stamps are hard-coded empty and Bits are switched off end to end.

## C01 Redesign: three tabs, no walls of text
- **Tobias note:** Much more love, nicer unique UI, much nicer typography, less text. Really clean it up, more intuitive navigation, don't confuse users.
- **Today (honest):** 318x496 panel: header with seal, motto, a "Simulated" tag and a bell; 4 tabs (Home, Tonight, Tavern, Forge); 6 drawers, three layers deep. IM Fell English at 11 to 13 px. Forge tab is three paragraphs of rules.
- **Decided:** spec 07 R3: keep secondary detail out of the first view; 44 px targets. No SIMULATED labels (Q25).
- **Ambitious end state:** Three destinations: Kingdom (live picture and the current moment), You (window, card, passport) and Gifts (Bits). Tavern and Forge become "Walk in" links inside Kingdom. The first view uses 12 words or fewer. Unavailable states are a picture and one line. The decorative face is for headings only; body text uses a clean, readable face. One shared kit with the Atlas and card.
- **Done when:** Stills of every view at 318x496 and on mobile; a word count per view.
- **Phase:** 1 First
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/panel/src/Panel.tsx, panel.css:4-7.

## C02 The kingdom, live, in the panel
- **Today (honest):** Production shows "The kingdom's picture is not painted for the panel yet". No count of tonight's lights.
- **Decided:** Twitch.md §4, §16: a living picture, not the game.
- **Ambitious end state:** A painting of the kingdom right now, refreshed every minute, with tonight's lights counted and the current moment (a forge reveal, a raid arriving) shown as it happens.
- **Done when:** Stills at different moments; refresh test.
- **Phase:** 1 First
- **Size:** M
- **Source:** Added
- **Notes:** Needs Extension PubSub or polling.

## C03 You: your real card and passport
- **Today (honest):** Production card has no portrait and no worn pieces; travel stamps are hard-coded empty with hidden:false.
- **Decided:** Passport public on your card, with a hide switch.
- **Ambitious end state:** Your real portrait and look, following since, nights, homes, things you made, and passport stamps from real raids and visits, with a working hide switch.
- **Done when:** Stills with a real account; disclosure tests.
- **Depends on:** Trusted citizen subject and disclosure projection (register: card-passport, citizen-card PARTIAL)
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## C04 The Gifts tab: more, and more visible
- **Tobias note:** The Bits options a bit more prominent, more options.
- **Today (honest):** Six items in the shelf menu, two taps deep; production hides the shelf; requestProduct is a no-op; the extension is set to "Bits: off".
- **Decided:** A permanent Gifts tab and a bigger catalogue of 15 to 25 moments; the streamer picks about 8 and prices them within bands (Q27). Bits never buy coal, standing, votes or anything permanent (ChatDom §8).
- **Ambitious end state:** A Gifts tab that is always one tap away and never pops up by itself. 15 to 25 moments everyone sees, for example fireworks for a friend, light every lantern on my street, kites, ring the bell for someone, dress my home for the night, a bard's song, a parade, a royal feast. Each plays on stream and in the world with a credit line. Real Bits products, receipts verified on our server, effects delivered exactly once. Copy follows Twitch's wording rules (no "buy", "spend", "price").
- **Done when:** Bits test-mode purchase end to end; stills of the tab and each effect.
- **Depends on:** L05 review and monetisation onboarding
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Tobias
- **Notes:** apps/panel/src/shelf-menu.ts. Twitch.md §17 (rules, 80/20 split, review needed to turn Bits on).

## C05 Tavern and Forge as live doorways
- **Today (honest):** Tavern and Forge tabs are signposts with nothing to do.
- **Ambitious end state:** Inside Kingdom: who is at the tables right now, the last things forged, and "Walk in" to go there.
- **Done when:** Stills.
- **Depends on:** G03, I05
- **Phase:** 2 Launch
- **Size:** S
- **Source:** Added

## C06 Works on Twitch mobile
- **Today (honest):** Never checked on a real phone; first load must stay under 1 MB.
- **Ambitious end state:** A thumb-first layout on Twitch mobile with the same three tabs; first load under 1 MB.
- **Done when:** A real-device recording.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## C07 Streamer configuration for the panel
- **Today (honest):** config.html is a placeholder; the extension is set to "Configuration: None".
- **Ambitious end state:** The streamer chooses which tabs show, picks and prices gifts, and sees whether the panel is connected, in the extension's configuration page.
- **Done when:** Stills; config saved through Twitch's configuration service.
- **Depends on:** D01
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
