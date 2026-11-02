# 11 Teaser film: A teaser that looks like real Twitch footage

**End state:** A YouTube teaser that looks like real Twitch footage: the actual Twitch channel page with the kingdom on stream, its chat, panel and alerts edited live in the page, with ambitious creative shots, a warm narrator, and a cut assembled in diffusion.studio.

**Today:** FILM.md holds a 2:57 script and a planned pipeline. Nothing records the Twitch page today. diffusion.studio is free, open source (MPL-2.0), exports up to 4K and can be driven by an agent through its desktop app and its CLI.

## K01 The Twitch page studio
- **Tobias note:** Simulate a real Twitch chat and stream by faking the Twitch HTML, so we can cut a suitable video and clips. Same for the extension visible on a livestream, and a Twitch overlay. All polished, authentic, efficient.
- **Today (honest):** Nothing.
- **Decided:** The actual Twitch page with live HTML editing, like real recorded footage, ambitious and creative (Q34).
- **Ambitious end state:** A script-driven browser opens the real Twitch channel page and edits it live and only on our screen: the video area shows the kingdom, chat fills with scripted messages and emotes, the panel extension and alerts appear, viewer counts move. It is deterministic and replayable, records at 4K 60 fps on a real GPU, and never posts anything to Twitch.
- **Done when:** Sample recordings of 3 shots reviewed by Tobias.
- **Phase:** 1 Hackathon
- **Size:** L
- **Source:** Tobias
- **Notes:** Tobias's PC GPU through pc-lease. Real Twitch is never written to.

## K02 An ambitious shot list
- **Today (honest):** FILM.md §4.2 script v2.
- **Ambitious end state:** A shot list built for wow: push in from Twitch chat through the video into the kingdom; one message lights a window; a "!forge" line becomes a chimney; a hype train wakes the dragon; a raid draws a road and the camera rises to the whole map of Twitch; a hamlet grows into a city in seconds; a panel tap lights a lurker's window.
- **Done when:** Tobias approves the list.
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** context/FILM.md §4, §5.

## K03 Kingdom footage at film quality
- **Today (honest):** Stills and short clips exist.
- **Ambitious end state:** Every kingdom shot rendered in a fixed-step film mode at 4K with the best settings.
- **Done when:** Footage reviewed.
- **Depends on:** E01, K02
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Added
- **Notes:** FILM.md §6 (record once, shoot forever).

## K04 Narration
- **Today (honest):** FILM.md §4.5 narration ready for ElevenLabs.
- **Decided:** ElevenLabs, chosen voice (J01).
- **Ambitious end state:** Narration rendered in the chosen voice, three takes per line, timed captions from the alignment data.
- **Done when:** Tobias picks takes.
- **Depends on:** J01
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Added

## K05 The cut
- **Tobias note:** For the video generation we use a combination of tools, and for cutting diffusion.studio.
- **Today (honest):** Nothing.
- **Decided:** diffusion.studio (Q34).
- **Ambitious end state:** A 16:9 master for YouTube plus 60 s, 30 s and 9:16 cuts, cut on the music's beats, with captions and licensed music, assembled in diffusion.studio.
- **Done when:** Tobias approves the master.
- **Depends on:** K01 to K04
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** Agent editing needs the desktop app; captions and AI audio are paid credits.
