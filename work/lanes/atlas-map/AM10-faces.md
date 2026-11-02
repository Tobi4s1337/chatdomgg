# AM10 faces checkpoint

Mapped and waiting channel cards now put the streamer's own Twitch picture in a
64 px wax seal. Search rows use the same seal at 32 px. The channel's seeded
shield holds the space until the picture loads and returns for a missing,
expired or failed image. Image failure changes neither the frame size nor the
card's layout. Pictures appear only on the open card and open search rows;
the map's hundreds of marks and road lists keep their heraldry.

## The clock belongs to the picture

The importer previously combined `facts_at` and `last_live` into `factsAt` for
names. A live sweep confirms a name; it does not establish a new avatar age.
New observation records therefore preserve the original source `facts_at` as
`avatarFactsAt`, alongside a retained avatar URL. The two are present or null
together. Old revisions without that separate clock remain readable, but their
pictures use the shield rather than borrowing a newer name clock.

Card and search projections use that original timestamp plus exactly one day.
They omit an expired or implausibly future picture at request time. The browser
checks the CDN path and expiry again, drops a picture at its deadline while the
card stays open, and cancels its timer on disposal. A replaced image cannot
report itself loaded for another subject. Image requests carry no referrer.

Only requests with `portraits=1` receive the optional `portrait: {url,
freshUntil}` field. The new client opts in on search and card reads; older
strict clients keep their original v1 reply shape. A new client talking to an
older service accepts the original shape and shows the shield. No new route,
gateway allowlist change or public bulk image projection is needed.

The picture URL and its clock stay out of `world.json`, region chunks, public
bulk names, live frames and year-long immutable assets. Internal observation
revisions retain the existing bounded retention policy.

## Verification and evidence

- 57 distinct focused unit/integration tests passed. These cover original avatar
  time versus later name confirmation, the exact day boundary, missing and
  withheld pictures, CDN validation, retained replies, opt-in HTTP compatibility,
  import retention, and absence of image data from preview files.
- Scoped TypeScript, ESLint, service build and web production build passed.
- The browser face flow passed 12 checks: dated still readiness, zero overview
  image requests, open-row requests, row removal, selected picture, close/removal,
  actual load failure, expiry while open, no request for an already stale
  picture, disposal, timer baseline restoration with a fresh picture open, and
  no uncaught errors. Controlled responses belong only to that test; the visual
  captures below use unmodified real replies.
- That flow exposed a `Stale read from Show` error during card close. Channel
  card subjects now use stable keyed values through teardown. Closing and
  replacing a card removes its image and timer cleanly.
- One read-only collector import published
  `obs-20261101T223528Z-f83a4722106d`: 490,930 observed channels, 78.84 hours,
  1,578 sweeps, no gaps or rejected rows, 4,215 stale avatars dropped.
  The derived draft preview is `pv-20261101T223528Z-0eafe4c17e44`, with 58,499
  mapped holdings. Nothing founded and no prior preview was overwritten.
- `atlas:check` passed the new revision, preview reproduction and all three
  retained previews' aligned live frames. A read-only live pass observed 7,971
  live holdings and 23,089 pencil dabs on the new preview at 22:38 UTC.
- Real HTTP evidence confirms exact source-day expiry for Squeezie and Caedrel,
  and the shield for BOULAWEEED's stale source avatar. The older retained
  revision also returned a shield for Caedrel rather than reviving its ambiguous
  clock. See `work/evidence/atlas-map/am10-face-freshness.json`.
- Eight PNGs at 1440×900 and 390×844 were opened and reviewed: live Squeezie,
  offline Caedrel, stale-picture BOULAWEEED, and open search rows. Paths, source
  observation times and live states are in
  `work/evidence/atlas-map/am10-face-shots.json`. Both seal sizes fit without
  clipping; pictures stay recognisable on a phone. The wax could gain a little
  more irregular pressed texture during the carved UI pass.

These captures deliberately exercise the dated WebGL-free map. The previous
checkpoint's still-to-WebGL readiness issue remains for the final AM10 pass.
The real-GPU lease was occupied; this checkpoint makes no new frame-time claim.
The long existing chrome is still scheduled for the carved UI checkpoint.

## Operator adoption after merge

1. Build the merged web and Atlas service. Their changes may be adopted in
   either order: absent pictures use shields, and old clients receive the old
   reply shape.
2. Run one niced, bounded read-only `atlas:import` against the existing collector,
   or let the next scheduled import do it. This exports `avatarFactsAt`; an
   `atlas:preview` rebuild of an old revision cannot recover that source clock.
   Do not start a new Twitch survey. Existing pinned previews keep their land.
3. Run `atlas:live --once` and `atlas:check` against the service's data directory,
   then adopt/restart through the operator's existing workflow. The lane never
   restarts the live service. Confirm a fresh picture, a shield for a stale
   picture and Watch on Twitch on a channel card.

Temporary testing used service `127.0.0.2:5199` and preview
`127.0.0.2:5175` (earlier captures used preview `127.0.0.1:5175`). Occupied
listeners on other loopback addresses were left untouched. These owned test
servers are stopped after verification.

AM10 stays unchecked. Next: server-side search fallback, then carved UI and the
complete real-GPU/phone pass. The proposed language-name review remains needed
at `apps/surveyor/src/cartography/language-names-1.json`.
