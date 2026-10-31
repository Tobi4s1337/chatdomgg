# Spec 45: Raid passport

Status: frozen 2026-10-31  
Vision: `chatdom/ChatDom.md` principles 3, 10, 13, 17–18; `chatdom/World-Tree.md` rule 9 and passport; `chatdom/Moments.md` §2.

## What and why

A citizen carries a worn leather book of places actually reached. Hand-inked, slightly crooked kingdom stamps and wax seals remember the roads and people that made a journey; visited kingdoms, bonds and keepsakes sit beside them. This is an intimate object with pages to turn, not a statistics screen. It belongs in the narrow Twitch panel and on the citizen card's shareable page and image. An empty book is inviting, and a well-travelled one remains readable. The book shows what the world witnessed, and respects a citizen's choice to keep their travels private.

## Current state

- `packages/shared/src/passport.ts`, exported as `@chatdom/shared/passport`, defines the frozen `PassportBookSchema` and related schemas. It is a public **read projection**, not evidence, authority, or a write contract. Visible books contain holder, revision, as-of and four independently paginated collections; hidden books contain only version, origin and visibility.
- `apps/api/src/raid-gate/contracts.ts` already defines a minimal local `PassportStamp` (`id`, `kingdomId`, `occurredAt`, `kind`, `raidId`) and `PassportView`. Preserve this boundary: adapt with trusted enrichment where available; never replace its shape or fabricate missing details.
- `apps/api/src/citizen-card/contracts.ts` defines `CardSource` and `apps/api/src/citizen-card/project.ts` implements `projectCard`: before first sign-in no passport or foreign homes; hiding travels removes the passport while homes remain. Spec 19 specifies public pages, images and invalidation; spec 23 R8 defines witnessed travel. Existing card, panel and gate source files are read-only for this lane.
- `packages/ui/src/kit.css`, its fonts and `ProvenanceSeal.tsx` are the existing UI family; `work/specs/39-channel-genesis.md` and `work/references/channel-genesis.md` describe crest grammar and colour treatment. Render supplied actual crest grammar when no approved asset is supplied; do not substitute generic arms.

## Rules

1. **R1 — Evidence belongs to its authority.** A visit requires successful committed arrival. A raid stamp requires observed raid plus committed walker march or source-citizen identity and destination-chat evidence within ten minutes, verified by spec 23 authority. A Twitch raid count, public raid event, URL, fixture, request or welcome alone is never a rider list or evidence. Reuse Gate/road IDs and actual accepted gift records; no separate travel ledger, award, command or reward. Do not invent leader, road, gift or art when missing. Gifts shown are accepted records, labelled left or brought back.
2. **R2 — Read the frozen book.** Validate every external `PassportBook` with its schema at the boundary. Carry stable record IDs, supplied kingdom name, crest and colours, UTC date, actual road and leader when supplied. Ink placement/rotation derives deterministically from record ID, not randomness. Each collection has stable cursor pagination, at most 50 records per page, and must remain navigable without loading all history. Respect revision/as-of consistency across pages; discard/reload stale results rather than mixing snapshots. Do not infer unavailable records from a partial page.
3. **R3 — Privacy precedes presentation.** The trusted host supplies current `CardSource`; run `projectCard` and require disclosed, visible card passport before releasing any enriched book. Before first sign-in or when travels are hidden, release only the schema's hidden variant and remove stamps, visited kingdoms, bonds, keepsakes, travel-derived names, routes, counts, cursors and history-derived imagery from every payload, DOM, accessibility tree, metadata and image. Never hide card homes because travel is hidden. Owner changes go through the existing authority and require acknowledged replacement, not optimistic success. Cancel or suppress stale/late reads and renders after privacy change. The share handler must read a fresh publishable snapshot and check again before returning late image jobs; no immutable public cache may bypass revocation. Already downloaded images cannot be recalled; promise removal only from served surfaces.
4. **R4 — Truthful states.** A schema-valid empty visible book is a beautiful empty book with no invented stamps. Pending, unavailable, malformed, hidden and valid empty are distinct states; malformed source fails closed as unavailable, never silently as empty. Live origin is only used when the supplied authority says live. Seed exactly three complete illustrative books first: no raids, three raids, and84 raids across several kingdoms with independently paged history. Their invented fixture citizens/kingdoms never impersonate a real source. All seeded none/few/many fixtures visibly say SIMULATED on every panel, page and export that displays them; fixtures must never be presented as live.
5. **R5 — A book, not a list.** Build an accessible interactive passport with real spread navigation and readable stamps; put kingdoms, bonds and keepsakes alongside the travel story, not into a stats dashboard. Respect supplied facts and preserve full names including non-Latin text. Large histories paginate/spread, never collapse to microtext. Fit 318×496 panel, card page at 1440×900 and a deliberate 1200×800 share composition; keep text legible at small size. The share image may show a curated current spread, not claim to contain every record.
6. **R6 — Interaction.** Keyboard and touch can turn spreads, access records and pagination, and see focus; controls have accessible names and logical reading order. Reduced motion disables or simplifies page turns without removing function. Long names wrap or have accessible full text. Dynamic updates cannot expose a previous subject. No current-location, roster, computed affinity, ranking or fake success.
7. **R7 — Integration boundary.** Export feature adapters, components and server-side image/share handlers from the owned new folders for main to bind. Existing card, gate, panel and route files are read-only; report missing data/authority as `needs:` in progress. Main binds mounts and API authority. The lazy `/-/passport` host registration is supplied now and activates when the worker exports its real index; it creates no pretend passport surface before then. No fake live port or fabricated success while integration is absent.

## Contracts

Consume `PassportBookSchema`, `PassportStampSchema`, `PassportKingdomSchema`, `PassportCrestSchema` and inferred types from `@chatdom/shared/passport`. The four visible pages have `items` (maximum 50) and `nextCursor`; hidden variant intentionally has no holder, revision or history. `origin` is `live` or `simulated`. Stamps distinguish visits and raids; raid road must end at the stamped kingdom and gifts are bounded accepted records. A null leader or asset is unknown, not an invitation to invent. `CardSource` and `projectCard` supply the existing disclosure gate. Enrich the local Gate stamp only with authority-backed corresponding records, retaining its IDs; unavailable enrichment is explicit. No changes to `packages/shared`: main owns any required contract change.

## Scope

Write only `packages/ui/src/passport/**`, `apps/panel/src/passport/**`, `apps/web/src/passport/**`, `apps/api/src/passport/**`, and this lane's PRD/progress. Everything else is read-only. Main owns host routing, mounting, authority and shared contracts. Keep the three surfaces in this single lane, using shared craft primitives where appropriate.

## Acceptance

- Run `pnpm typecheck`, focused Vitest tests for the new passport folders (`pnpm exec vitest run` with the relevant test paths), and `pnpm --filter @chatdom/panel build`, `pnpm --filter @chatdom/web build`, `pnpm --filter @chatdom/api build` as applicable to the changed surface. Record commands/results; no per-task full `pnpm verify` or screenshot matrix.
- Meaningful tests cover evidence/enrichment refusal, valid empty versus malformed/unavailable, independent pagination and revision replacement, deterministic ink, and disclosure before sign-in/after hide. Include a late image/read race and assert no private data leaks while homes stay. Test an actual share response reads a fresh publishable source and cannot reuse a stale image.
- For each visual change capture and **look at** the relevant surface with `view_image`: panel 318×496, card page 1440×900, share export 1200×800. A single bench contact sheet can show seeded none/few/many at the relevant size. Use `$look`; main's actual bench route is required before the first capture. Save paths and observations in progress. Test keyboard, touch and reduced motion, long/non-Latin names, and many records without microtext.

## Quality bar

A hand-crafted leather book: worn edges, a stitched spine, rubbed leather highlights, brass corners, layered paper shadows, broken ink edges and wax with a thumbprint. The empty book has an embossed cover, a named flyleaf and room waiting for its first real journey: no fabricated stamp, zero counter or empty dashboard. A many-raid book opens into generous spreads with thumb tabs rather than a wall of tiny icons. Each kingdom’s supplied arms and palette make a different ink impression and seal, not the same red wax badge on every entry. Vary stamps within a coherent family; let real crest colours and shapes give each kingdom its character. Code-native SVG/CSS craft first, no stock icons or plain parchment data lists. Reuse the UI kit's typographic language and spec 39 crest grammar. Empty pages should feel like an invitation; many stamps should have room to breathe. Main may later supply painted assets, but they are not a dependency or a reason to expand this lane into an art library. Judge against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`.

## References

- `work/specs/19-citizen-card.md` — disclosure, public share and image revocation.
- `work/specs/23-raid-gate.md` — witnessed evidence, IDs, travel and gift authority.
- `work/specs/39-channel-genesis.md`, `work/references/channel-genesis.md` — actual heraldic grammar and colour identity.
- `packages/ui/src/kit.css` and `packages/ui/src/ProvenanceSeal.tsx` — existing visual vocabulary.

## Not now

No new ledger, authority, rewards, Twitch rider inference, card/gate/panel host edits, art production lane, follower list, analytics or leaderboard. No production routing or deployment in this lane. The new `@chatdom/ui/passport` subpath is supplied by main; create its actual `index.ts` in the owned scope. Panel/API workspace dependencies are supplied by main, so no lockfile edits are needed.

## Decisions

- **2026-10-31 — One book across three surfaces.** The shared projection is read-only; main owns authority and integration. A worker owns passport craft, panel/card adapters and share image handler together, with actual supplied evidence and strict card privacy.
