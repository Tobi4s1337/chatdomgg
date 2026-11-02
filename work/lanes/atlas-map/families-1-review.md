# Families 1 — founder review

**PROPOSED.** [families-1.json](../../../apps/surveyor/src/cartography/families-1.json) was proposed on 2026-10-30. Its reviewer and date are empty. Tobias: approve it or mark exact changes. Nothing here claims approval.

Survey: `obs-20261101T223528Z-f83a4722106d`, preview `pv-20261101T223528Z-0eafe4c17e44`. The window runs from 29 October 15:44 to 1 November 22:35 UTC: 78.8 h and 1,578 sweeps. 490,930 channels were observed, giving 58,499 mapped holdings; 1,095 gambling channels were kept off. 55,639 holdings are on the 10 continents (en, ru, de, es, fr, pt, ja, zh, it, pl). The other 2,860 are on 24 language isles, where each isle is a single realm and families do not apply. The proposal was hand-assigned from the 690 main categories of the 30 October survey. Every number below comes from the 1 November revision.

**How a holding gets its realm.** Each family counts as one community, and every game outside the families counts as its own.
- **Crossroads.** A channel is variety (`variety-1`) when it has at least 2 h on record, no community holds half its minutes, and at least three communities hold 12 % or more each. Variety channels live in their continent's Crossroads.
- **Family realms.** Every other channel goes by its community with the most minutes. A family gets its own realm on a continent only if at least max(24, 1.5 %) of that continent's holdings belong to it (`realm-threshold-1`). On this survey the cut-off is 424 on English, 115 on Russian, 67 on German and 24 on Chinese, Italian and Polish.
- **Wilds.** A family below that cut-off goes to the continent's Wilds, and so does a channel whose top community is a game outside the families.

**What approving freezes.** Founding Edition I copies this file byte for byte into the edition. Its SHA-256 goes into the drawn world and into the founding authorization. From then on, every new holding in Edition I is placed with these families, for the life of the edition. In detail:
- Fixed with no way back: family ids and the games in each family.
- The words are not fixed. The map now labels every realm from a separate display table,
  [realm-names-1.json](../../../apps/surveyor/src/cartography/realm-names-1.json), keyed by family id (and by kind for
  the Crossroads, the Wilds, the Isles of Many Tongues and the Outer Isles), the way `language-names-1` labels languages.
  The `name` and `realmName` inside this file stay in its frozen bytes as the record of the founding, but a later table
  can rename any realm without touching the land, the taxonomy hash or anyone's place. Today the table repeats these
  labels word for word, so nothing on the map changed.
- The variety rule and the threshold live in code, recorded by id, not in this file.

## The families

Each row is one family:
- **Games:** how many games the family holds.
- **Top five:** its games with the most hours streamed by mapped holdings in this revision.
- **In realm:** holdings in the family's own realms, summed over the continents.
- **Realms:** the number of continents, out of 10, where the family has its own realm.
- **To Wilds:** holdings that belong to the family but landed in a Wilds, because the family was below the cut-off on their continent.

| id | Map label | Proposed realm name | Games | Top five by hours | In realm | Realms | To Wilds | Note |
|---|---|---|---:|---|---:|---:|---:|---|
| just-chatting | Just Chatting & IRL | The Lantern-Lit Commons | 15 | Just Chatting, Always On, IRL, ASMR, Special Events | 10,298 | 10 | 0 | Just Chatting is 66 % of the hours. Includes Politics. |
| creative | Creative & Music | The Minstrel's Painted Coast | 13 | DJs, Art, Music, Software and Game Development, osu! | 2,815 | 6 | 120 | No realm on ru, pt, it or pl. Rhythm games and Geometry Dash sit here as music performance. |
| shooters | Shooters | The Gunpowder Marches | 68 | VALORANT, Counter-Strike, Fortnite, Call of Duty: Modern Warfare 4, Overwatch | 9,486 | 10 | 0 | Also looter, hero and vehicle shooters (Destiny 2, Warframe, World of Tanks, War Thunder). |
| arenas | Arenas & MOBAs | The Warring Lanes | 15 | League of Legends, Dota 2, Deadlock, Mobile Legends: Bang Bang, SMITE 2 | 3,008 | 10 | 0 | Melee battle royales (NARAKA, My Hero Ultra Rumble) sit here, not in Shooters. |
| mmo | Online Worlds | The Thousand-Guild Kingdoms | 41 | AION 2, World of Warcraft, Tibia, Black Desert, FINAL FANTASY XIV ONLINE | 3,817 | 9 | 23 | No realm on it. The realm name says "Kingdoms", which is what every channel is in Chatdom. |
| roleplay | Roleplay & Open Worlds | The Masquerade Free Cities | 7 | Grand Theft Auto V, Red Dead Redemption II, Dungeons & Dragons, Black Russia, Tabletop RPGs | 2,397 | 7 | 66 | GTA V is 91 % of the hours, and all GTA V play lands here, roleplay or not. No realm on es, zh or pl. "Cities" is also a holding tier. |
| sandbox | Builders & Sandboxes | The Blockwright Highlands | 20 | Minecraft, ROBLOX, nanos world, Planet Zoo 2, Garry's Mod | 1,790 | 7 | 46 | Minecraft is 67 % of the hours. No realm on ja, it or pl. |
| survival | Survival & Horror | The Moors of Last Light | 98 | Dead by Daylight, Rust, Phasmophobia, Enshrouded, DayZ | 3,868 | 9 | 20 | No realm on it. Resident Evil 2, Resident Evil 4 and Silent Hill 2 also have a same-named category in Retro, so two patches would carry the same label. |
| adventure | Adventures & RPGs | The Wandering Heroes' Reach | 116 | Phantom Blade Zero, Aniimo, Cyberpunk 2077, Crimson Desert, Genshin Impact | 3,193 | 10 | 0 | The widest family: soulslikes, ARPGs (Path of Exile, Diablo), gacha RPGs, mainline Pokémon, HITMAN, Sea of Thieves. Phantom Blade Zero is 26 % of the hours in this window. |
| strategy | Strategy & Cards | The Chequered Vale | 64 | Hearthstone, Teamfight Tactics, Heroes of Might and Magic III, Magic: The Gathering, Pokémon Trading Card Game | 1,654 | 9 | 39 | No realm on pt. Also has Chess, board games and Warhammer. |
| sports | Sports, Racing & Simulators | The Tournament Downs | 41 | EA Sports FC 27, NBA 2K27, Sports, Rocket League, Football Manager 27 | 2,236 | 8 | 14 | No realm on ja or zh. Also has Farming Simulator, truck and flight sims, fishing and kart racers. |
| fighting | Fighting Games | The Duelists' Cliffs | 18 | Street Fighter 6, TEKKEN 8, MARVEL Contest of Champions, Super Smash Bros. Ultimate, Brawlhalla | 135 | 1 (ja) | 424 | Has its own realm only on Japanese. 299 English holdings fall short of the English cut-off of 424 and go to the Wilds. |
| retro | Retro & Speedruns | The Old Cartridge Ruins | 36 | Retro, Pokémon FireRed/LeafGreen, Diablo II, The Legend of Zelda: Ocarina of Time, Grand Theft Auto: San Andreas | 666 | 2 (en, ja) | 259 | Games originally released before about 2006; remasters go by genre. "Ruins" may read as abandoned to a living speedrun scene. |
| cozy | Cozy & Party | The Tea-Garden Hamlets | 47 | Marbles on Stream, Games + Demos, Pokémon GO, Palia, Pokémon Community Game | 866 | 3 (en, de, fr) | 154 | Games + Demos is Twitch's catch-all category and comes second here by hours. "Hamlets" is also a holding tier. |

All family realms together hold 46,229 holdings across 101 realms. The file's 15 notes explain the hand calls (ARPGs, retro cut-off, gachas, kart racers and so on); they read well and are not repeated here.

## The Crossroads and the Wilds

- **The Crossroads:** 3,474 holdings, 6.2 % of the continents' holdings, ranging from 1,873 on English to 51 on Italian. A variety channel's game mix never matters to the families. Another 163 variety channels on isles stay in their isle.
- **The Wilds:** 5,936 holdings, 10.7 % of the continents' holdings. 199 of them are cities or capitals, including 8 capitals. Where they come from:
  - 2,743 have as their top community a game the file does not name at all. That is 1,677 categories, 1,141 of which send a single holding each. Many are siblings of games already in the file: ARK: Survival Evolved, Little Nightmares, Mario Kart Wii, Counter-Strike 1.6, Pokémon Sword/Shield, Arma 3, V Rising, Monster Hunter Generations Ultimate, and further category IDs for Resident Evil 2 and 4.
  - 1,407 come from games on the unassigned list (next section).
  - 1,165 belong to a family that is below the cut-off on their continent. Fighting accounts for 424, Retro 259, Cozy 154 and Creative 120.
  - 621 have no category minutes on record.

The Wilds is where a continent puts what it cannot sort. Once Edition I is founded it also takes every game the frozen file does not name, including games released later, for the life of the edition.

## The 91 unassigned games

On this survey, 1,450 holdings have one of these games as their top community. 1,407 of them are on continents, all in the Wilds, and 43 are on isles. The listed games account for 3.7 % of mapped hours. Games the file does not name at all account for another 6.7 %.

| `why` | Games | To Wilds | Most-streamed (holdings sent to the Wilds) |
|---|---:|---:|---|
| Unrecognised title, no reliable genre cue: 70 with that exact reason, plus 5 near variants (WARDOGS, Dressmaker (2026), Gaming Late at Night, KOTÁMON, Safari-TV) | 75 | 1,044 | WARDOGS 198, Terrible Lizards 96, Moon Sweepers 87, Probably Stolen 76, Tenebris Somnia 48, Dressmaker (2026) 44 |
| Unrecognised title with a genre hint (possibly a shooter, a Final Fantasy RPG, witch, online, submarine, cooking ×2, fishing, horror, anime, "vaguely recognised") | 11 | 178 | STALZONE 73, Final Fantasy Resonance 71, Witchspire 10 |
| Gambling- or money-adjacent, left for a founder call (casino simulation ×2, poker game, trading and speculation; plus "hints at scams or money, needs a check") | 5 | 185 | Crypto 133, Casino Simulator 2024 16, $cam With Your Friends 14, Casino Simulator 12, Tournament Poker 10 |

Six of the biggest can now be identified: most are October 2026 releases, around or after the 30 October basis survey.

| Game | What it is | Fits | To Wilds |
|---|---|---|---:|
| WARDOGS | Military FPS | Shooters | 198 |
| STALZONE (formerly STALCRAFT: X) | Extraction MMO shooter | Shooters, beside Escape from Tarkov | 73 |
| Final Fantasy Resonance | Single-player turn-based RPG | Adventures | 71 |
| Terrible Lizards | Horror chase game | Survival & Horror | 96 |
| Moon Sweepers | Co-op cleaning sim | Cozy, beside PowerWash Simulator 2 | 87 |
| Probably Stolen | Shop sim | Cozy, beside TCG Card Shop Simulator | 76 |

Together these six send 601 holdings to the Wilds.

## To decide

1. **Games outside the file.** The file never names the categories behind 2,743 Wilds holdings, which is more than the whole unassigned list sends. Do you want a top-up pass on the founding revision before you sign? Taking every category that is the top community of 3 or more Wilds holdings would mean 231 games and 992 holdings. And do you accept that games released after founding live in the Wilds for all of Edition I?
2. **The six identified titles.** Should they go into the families listed above, taking 601 holdings out of the Wilds?
3. **Fighting Games.** It has its own realm only on Japanese. 299 English, 37 Spanish and 26 French fighting holdings go to the Wilds. Options: keep it as it is, or merge it into Arenas & MOBAs under a new label. The same question applies on a smaller scale to Retro (2 continents) and Cozy (3).
4. **Money-adjacent categories.** Should Crypto, Casino Simulator, Casino Simulator 2024 and Tournament Poker be kept off the map like Slots and Poker? That would mean a new gambling list, `gambling-categories-2`, and removing them from the unassigned list, which the schema requires. The alternative is to leave them in the Wilds. The category "Casino" (493887283, 6 Wilds holdings) is in neither list. $cam With Your Friends needs a look.
5. **Realm names.** Show the `realmName` proposals once the file is reviewed, keep the plain labels, or use both (realm name on the map, plain label on cards)? Three of the names reuse Chatdom's own words: Kingdoms (Online Worlds), Free Cities (Roleplay) and Hamlets (Cozy).
6. **Renaming later.** Done, so you need not decide it before signing: `realm-names-1` (proposed, 2 Nov) labels realms by family id outside the frozen land. Approve its words with this file, or send renames any time; they never need a new edition. It is not a founding gate.
7. **Placements to confirm:**
   - all GTA V play goes to Roleplay
   - Games + Demos goes to Cozy
   - Geometry Dash and the rhythm games go to Creative
   - Pokémon is split across five families
   - Diablo II goes to Retro, but Diablo II: Resurrected to Adventures
   - same-named Resident Evil 2, Resident Evil 4 and Silent Hill 2 sit in both Survival and Retro
8. **One-window placement.** A holding's realm is fixed from its minutes in the founding window, which must cover at least 7 days for Edition I. On this survey, 8 capitals sit in the Wilds because their top category in the window fell outside the families: Monster Hunter Generations Ultimate, Halloween, Nitroglycerine!, Probably Stolen (twice), and others. Accept this, or ask for a rule change? A rule change would be separate from this file.

The numbers will move a little on the founding revision. Edition I is eligible from 5 November 15:44 UTC at the earliest.

Sources for the six identified titles: [WARDOGS on Steam](https://store.steampowered.com/app/1867240), [STALZONE on Steam](https://store.steampowered.com/app/1818450), [Final Fantasy Resonance (RPG Site)](https://www.rpgsite.net/news/20619-final-fantasy-resonance-a-new-hd-2d-ff-game-launches-october-22), [Terrible Lizards on Steam](https://store.steampowered.com/app/2920220), [Moon Sweepers (Mein-MMO)](https://mein-mmo.de/steam-moon-sweepers-hit/), [Probably Stolen (WN Hub)](https://wnhub.io/news/finance/item-52533).

**Sign-off.** To approve, set `review.status` to `reviewed`, `reviewedBy` to the reviewer's name and `reviewedAt` to the approval date. Do this only after Tobias's actual approval, and keep the proposal as it is until then.

The edit changes the file's bytes, and with them its SHA-256 (now `dd3ecc6c…8df45b`), which the founding authorization names. So sign the authorization after this edit and after any other changes, never before. Founding then copies the file into Edition I.

To ask for changes instead, reply with them: moves by game name and ID, renames, exclusions. They go into the file, the preview is redrawn, and this sheet's numbers are recomputed before sign-off.
