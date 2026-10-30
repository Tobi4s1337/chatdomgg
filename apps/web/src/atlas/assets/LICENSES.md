# Atlas assets: licences and sources

## Map stamps: `stamps.webp`, `stamps.json`

All stamps come from K. M. Alexander's **#NoBadMaps** PNG packs, released under **CC0 1.0**
(https://creativecommons.org/publicdomain/zero/1.0/). Source: https://www.kmalexander.com/free-stuff/fantasy-map-brushes/

Every pack's ReadMe says: *"… is free for any use for any project and is distributed with a Creative Commons CC0 'No
Rights Reserved,' which means you can freely use it in commercial work and distribute adaptations, and no attribution
is required."* Attribution is not required, but we give it anyway.

| Pack (folder as distributed) | Version (ReadMe) | Used for | Files packed |
|---|---|---|---|
| Lumbia (`lumbia-cartography-brushes-2.0-png-pack`) | 2.0 | mountain, hill | Landforms/Large Mountains 004, 008, 010, 013; Medium Mountains 001, 003, 007, 008, 016, 023, 028; Small Mountains 005, 012, 013, 015; Hills 001, 005, 010, 015, 027, 038, 039, 046, 050, 063 |
| Mercator Settlement (`mercator-settlement-png-pack-1.1`) | 1.0 (folder says 1.1) | forest, capital, city, town, village | Flora/Small Forest 001, 002, 004, 005, 006, 008, 010, 012; Flora/Forests 001–003; Settlements/Cities 001; Large Towns 002, 005, 006, 007, 010, 011, 013, 014; Towns 014, 021, 022, 029, 038, 039, 040, 054, 068, 069; Small Towns 001, 002, 003, 005, 006, 007, 008, 009, 011 |
| De Fer, Cartography (`de-fer-cartography-brushes-2.0-png-pack`) | 2.0 | marsh | Landforms/Swamps 001, 002, 003, 006 |
| Hogenburg (`hogenburg-urban-cartography-png-pack`) | 1.0 | capital | Buildings/Castles_3, Castles_7 |
| Vischer (`vischer-cartography-brushes-2.0-png-pack`) | 2.0 | capital | Settlements/City 011, 025 |
| Here There Be Monsters (`here-there-be-monsters-png-pack-1.1`) | 1.1 | monster | Ortelius' Monsters (1570)/Grumpy Frog Beast, Spouting Frog Beast; Vrients' Monsters (1583-1608)/Excited Sea Monster |
| Janssonius (`janssonius-cartography-brushes-2.0-png-pack`) | 2.0 | ship | Cartouches/Ships/Ship 005 |
| Zannoni's Navy (`zannonis-navy-png-pack`) | 1.0 | ship | SingleShips/SingleShips_13, _15, _36 |
| Aubers (`aubers-cartography-brushes-2.1-png-pack`) | 2.1 | compass | Cartouches/Map Elements (2)/Compass Rose |
| Homann (`homann-cartography-brushes-2.0-png-pack`) | 2.0 | compass | Cartouches/Map Elements/Compass Rose |

The exact path of every packed file is in the `source` field of each entry in `stamps.json`.

**What we changed.** Each stamp is cropped, scaled down, and recoloured to sepia ink (#3b2f25). Fine engravings get a
1 px line boost, and the Zannoni ships get an alpha lift. Each stamp also gets a generated fill silhouette. Built by
`apps/surveyor/tools/pack-stamps.py` (the command is in its header).

## Fonts: `fonts/`

Downloaded from the google/fonts repository at commit `6157dfaa640ca5738b4d1a7070fe389c3036d7fc` (main, 2026-10-29).
Licence: **SIL Open Font License 1.1**. Each family's licence text sits next to its files.

| Family | Copyright (from OFL.txt) | Source | Files |
|---|---|---|---|
| IM Fell English (Roman, Italic) | Copyright (c) 2010, Igino Marini (mail@iginomarini.com) | https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/imfellenglish (`IMFeENrm28P.ttf`, `IMFeENit28P.ttf`) | `im-fell-english-regular.woff2`, `im-fell-english-italic.woff2`, `OFL-IMFellEnglish.txt` |
| IM Fell English SC | Copyright (c) 2010, Igino Marini (mail@iginomarini.com) | https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/imfellenglishsc (`IMFeENsc28P.ttf`) | `im-fell-english-sc.woff2`, `OFL-IMFellEnglishSC.txt` |
| Alegreya (variable, roman and italic) | Copyright 2011 The Alegreya Project Authors (https://github.com/huertatipografica/Alegreya) | https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/alegreya (`Alegreya[wght].ttf`, `Alegreya-Italic[wght].ttf`) | `alegreya-{roman,italic}-{latin,cyrillic,greek}.woff2`, `OFL-Alegreya.txt` |

**How the fonts were subset.** We used `pyftsubset` from fontTools, with WOFF2 and Brotli output, hinting removed,
and the Unicode ranges of the Google Fonts subsets.
- **IM Fell:** latin + latin-ext, keeping `kern`, `liga`, `dlig` and `hist`. These fonts have no GPOS table, so the
  legacy `kern` table is kept.
- **Alegreya:** the `wght` axis (400–900) is kept, with the default layout features plus `smcp`, `c2sc`, `onum`,
  `lnum`, `tnum` and `pnum`. It is split into three files per style, so a page loads only the scripts it shows:
  - latin + latin-ext
  - cyrillic + cyrillic-ext
  - greek

  Declare each file with a matching `unicode-range` (the ranges are in the build script).

Neither family declares a Reserved Font Name, and the OFL allows subsetting. Built by
`apps/surveyor/tools/build-atlas-fonts.sh`.
