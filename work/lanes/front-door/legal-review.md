# Legal pages: review notes for Tobias

For Tobias's review. This is not legal advice. The three pages were drafted from the operator details in the PRD
and from what the code does on 1 November 2026; a lawyer should read them before they carry legal weight. Nothing
in this file appears on the pages.

Pages (fragments placed inside `<article class="legal-sheet">`):

- `apps/web/src/site/partials/legal-imprint.html` (about 230 words)
- `apps/web/src/site/partials/legal-privacy.html` (about 3,300 words including the table of contents; a little over
  the 3,000 target because every live data flow has its own section)
- `apps/web/src/site/partials/legal-terms.html` (about 1,600 words)

All three say "Last updated: 1 November 2026". Change that date whenever the text changes.

## 1. Data inventory (what the code does on 1 Nov 2026)

Paths are relative to the repo. "No deletion code" means nothing in the repo ever deletes the rows; they stay until
someone deletes them by hand.

### 1.1 Twitch sign-in (`apps/api/src/realm-auth/`)

- OIDC with scope `openid` only, plus the claim `preferred_username` (`oidc.ts:38-39`). No email, no picture.
- Kept: the Twitch user id (`sub`) and the sanitised display name. Twitch's access and refresh tokens are thrown
  away right after the ID token is read; never stored or logged (`oidc.ts:46-62`).
- `realm_persons`: user id, origin, issuer, public name, name-approval label (`provider-display-name-v1`,
  `presentation.ts:8`) and time, `created_at`, `last_sign_in_at` (`service.ts:170-175`, migration
  `apps/realm/src/persistence/migrations/0001_realm_auth.sql`). **No deletion code.**
- Cookies (`http.ts`): `__Host-chatdom_session` (HttpOnly, SameSite=Lax, Secure, Path=/, 14 days);
  `__Host-chatdom_signin` (same flags, 10 minutes, cleared at the callback). The session cookie is also read by
  `apps/api/src/dock/auth.ts` and `apps/api/src/raid-gate/session.ts`.
- `realm_sessions`: SHA-256 hash of the session handle, user id, opaque `resume_scope`, expiry and revocation. No IP
  address or user agent anywhere. `realm_sign_in_attempts`: hashes of state, nonce and binding, plus the return path.
  `realm_tickets`: single-use, 60 s.
- Sweep every 10 minutes (`service.ts:227`): attempts deleted 1 h after expiry, tickets 1 day after expiry, entries
  when the session ends, sessions 30 days after they expire or are revoked.
- CSRF token derived from the handle, never stored.
- Twitch contacted at `id.twitch.tv` (authorize in the browser; token and keys server-side).

### 1.2 Chat presence in founded kingdoms (`apps/herald`, `apps/realm`)

- Herald reads through Twitch EventSub over an app-token conduit (`apps/herald/src/auth/grants.ts`,
  `apps/herald/src/ingest/subscriptions.ts`): chat messages and notifications, `message_delete`, `clear`,
  `clear_user_messages`, stream online/offline, authorization revoked, Bits use, Hype Train, raids, follows,
  channel-point redemptions, polls.
- Scopes: Chatdom's reader account `user:bot`, `user:read:chat`, `user:write:chat`; the broadcaster `channel:bot`,
  `moderator:read:chatters`, `bits:read`, `channel:read:hype_train`, `moderator:read:followers`,
  `channel:manage:redemptions`, `channel:manage:polls` (`grants.ts:6-12`). Herald records which grants exist; it
  holds no broadcaster user token according to the comment in `grants.ts:1-5`.
- Chat text is not stored: shown as a speech bubble (max 240 characters, valid 10 seconds), never written to
  history, snapshots or the outbox. Exceptions: `!forge <words>` (1.5) and `!strike`, which is transient and never
  stored (`apps/herald/src/realm-delivery/delivery.ts:131-141`, `apps/herald/src/ingest/spectacles.ts:118`).
- Named vs unnamed: a chatter's user id and display name enter presence as "named". Lurkers come from Twitch's Get
  Chatters list, read every minute: user ids only, marked anonymous, shown as unnamed lit windows.
- Herald files on disk: per-kingdom table user id to window slot (no names), erased only when the broadcaster
  revokes access; delivery outbox until delivered (spectacle entries dropped after 15 minutes); duplicate checks
  keep only ids for 10 minutes.
- Realm Postgres, all with **no deletion code**:
  - `realm_ingress_inbox.observation`: every presence observation as JSON, including chatters' display names and
    each minute's lurker user-id list;
  - `realm_citizen_names`: user id, display name, last seen (migration `0006_realm_citizen_names.sql`);
  - `realm_deeds`: a named chatter's first message in a kingdom gives a home; the deed holds tenure and signed
    evidence (follow date, subscription months). Deeds are never deleted, by database rule;
  - `realm_facts`, `realm_snapshots`, `realm_coal_ledger`, `realm_outbox`, `realm_ingress_checkpoints`: owner ids
    and names on home and castle plaques;
  - `realm_moment_values` / facts: Bits payer and amount; Hype Train contributors (id, name); raiding channel and
    viewer count; follower and follow time; redeemer and reward title (never the redemption's input text); poll
    titles and votes; sub and gift-sub tiers and months.
- Public visibility: presence frames show the names of people present (`/presence-data/stream`, when enabled); the
  realm's public founded, watch and chronicle reads rebuild kingdom history including makers' names. **The exact
  public fields are unverified.**
- Safety identifier: an HMAC of the person id per origin (`apps/realm/src/evening/castle.ts:83`), validated at the
  judge boundary and, per the code comment, not sent to the models (`apps/codex/src/providers/index.ts:66-74`).

### 1.3 Twitch panel extension (`apps/panel`, `apps/api/src/public/panel/`)

- The extension JWT is verified; only `channel_id`, `opaque_user_id`, `role` and `user_id` are read (`token.ts`).
- The real `user_id` is used only after the viewer shares identity, which the panel asks for only when they open
  their own card.
- Nothing is written. The backend reads `realm_deeds`, `realm_guests`, `realm_persons`, `realm_citizen_names`
  (`reading.ts`).
- Twitch Get Users and Get User Chat Color with the app token (`twitch-users.ts`), cached in memory 10 minutes, at
  most 5,000 people.
- CORS only for `<extension id>.ext-twitch.tv`. The panel page loads Twitch's Extension Helper from
  `extension-files.twitch.tv` and keeps a mute choice in localStorage (`chatdom-panel-muted`).

### 1.4 The Atlas (`apps/surveyor`, collector outside the repo)

- Collection is done by a collector service run by the operator outside this repo (the Surveyor at
  `twitch-demo.saartech.de/atlas/api/`). **Its Twitch endpoints, scopes and retention are unverified.**
- Per channel: id, login, display name, language, title, game, live state, current and peak viewers, live minutes,
  avatar URL (`apps/surveyor/src/export/schema.ts`), raid pairs with viewer counts. Nothing about individual
  viewers.
- Files under `ATLAS_DATA_DIR`; 3 revisions and 4 live frames kept; avatars and stream facts dropped after 24 hours;
  a gone channel's land kept 30 days. The search query `q` is not stored or logged.
- Hiding a channel: by hand (`moderation/withheld.json`, read by `apps/surveyor/src/policy/visibility.ts`). No
  self-serve hide yet (A12).
- Images: the Atlas loads no Twitch images today. The only images from `static-cdn.jtvnw.net` loaded in a visitor's
  browser are emotes in speech bubbles (`apps/web/src/walk/labels/index.tsx`, `apps/web/src/emotes/`). The CSP
  allows that host for images (`apps/api/src/public/main.ts`).

### 1.5 The Forge (`apps/codex`, `apps/realm/src/wiring/forge.ts`)

- Website `POST /forge-data/run`: live only if `PUBLIC_FORGE_TARGET` is set (unset by default; answers 503).
  Request: wish, style, home layout; no identity. Each run, including the wish, is appended to
  `.forge.local/runs.jsonl` (`apps/codex/src/main.ts`). **No deletion code.**
- Chat `!forge <words>` while live: approved words stored permanently in a realm fact as `creation.words`; approval
  audits keep hashes only (`evidenceHash`, `providers/index.ts:70`).
- Provider: OpenAI, through the Codex CLI signed in with a ChatGPT/Codex account login, not an API key
  (`apps/codex/src/providers/codex-cli.ts`). The wish, the generated text and a rendered contact-sheet image go to
  OpenAI. The models see `[MAKER]` in place of a name (`providers/index.ts:156, 177`). No identity is sent. No other
  AI or moderation provider.
- Judge outcomes in code: `pass`, `hold`, `refuse` (`providers/index.ts:6, 146-149`). Safety.md's fourth outcome,
  "soften", is not in the judge code, so the pages do not mention it.
- The 30-day retention of refused words promised in `chatdom/Safety.md` §5.6 is **not enforced in code**.

### 1.6 Voice

ElevenLabs appears only in the design documents. No speech provider runs on the public origin. Not on the pages.

### 1.7 Browser storage

- Cookies: only the two in 1.1.
- sessionStorage: `chatdom:realm:v1:[endpoint,kingdom,resumeScope]` (reconnect seat token, cleared at sign-out);
  `chatdom:reference-scope:*`; `chatdom.atlas.preview.v1`; `chatdom.door.v1` (passes the opened holding to the
  kingdom page); `chatdom:return-view:v1` (where you were before sign-in; read once on return; 15 minutes;
  `packages/ui/src/site/return-view.ts`).
- localStorage: `chatdom:forge:<practice key>:<seed>:<slot>` (placed practice Forge pieces),
  `chatdom:build:...:<plot>:<owner>` (build draft), `chatdom-panel-muted`.
- IndexedDB `chatdom-grand-lands`: cache of generated lands, 6 kept.
- All judged strictly necessary for a service the person asks for, so no consent banner (§ 25 (2) no. 2 TDDDG).

### 1.8 Logs

- Public gateway: method and path without query, on failure only; sign-in errors by route; panel failures by error
  type; a startup line. Realm: kingdom and deed ids and storage errors, no names, text or IPs. Herald: no personal
  data.
- No app code stores or logs IP addresses. The gateway forwards `x-forwarded-for`; internal services ignore it.
- The TLS reverse proxy in front (Traefik) may keep access logs with IPs. **Unverified.**

### 1.9 Other

- No analytics, ads, tracking or error-reporting SDK. Fonts self-hosted. CSP `default-src 'self'`,
  `connect-src 'self'`, images also from `static-cdn.jtvnw.net`, `frame-ancestors 'none'`, HSTS.
- Raid Gate is not deployed on the public origin.
- Dock (`/api/dock/*`, the streamer's throne, session cookie) stores royal acts with `actor_id`. **No deletion
  code.**
- Passport and citizen card: read-only, served only to the viewer who shared identity.
- Follow dates and subscription months are signed as tenure evidence and stored in deeds.
- No Bits purchases in the panel; no paid features anywhere.

## 2. Assumptions made on the pages

Imprint:

1. "Every message is read by a person" (imprint, terms). True only while Tobias reads the inbox himself.
2. "We answer in English or German": the DSA contact languages (Art. 11 (3), Art. 12) are stated as English and
   German.
3. The imprint says it covers chatdom.io and the panel extension. chatdom.gg (named in `AGENTS.md`) is not
   mentioned.
4. § 18 (2) MStV is included as instructed. It strictly applies only to journalistic-editorial content; keeping it is
   harmless.
5. The consumer dispute line says "neither willing nor obliged" (§ 36 VSBG wording), matching saartech.de.
6. The EU ODR platform is not linked. To my knowledge, Regulation (EU) 2024/3228 repealed the ODR Regulation
   (EU) 524/2013 and the platform closed on 20 July 2025, so the old link duty is gone. This is from knowledge, not
   checked online today.

Privacy policy:

7. Hosting: "our hosting provider, Hetzner Online GmbH, on servers in Germany". I added Hetzner's registered address
   (Industriestr. 25, 91710 Gunzenhausen) from knowledge, and the sentence that Hetzner is "bound by a data
   processing agreement". **The page asserts a DPA with Hetzner exists; conclude or confirm it (Hetzner offers one in
   its customer console) before publishing.**
8. Reverse-proxy logs: the page says they "may" exist and are kept "only as long as that needs". No number is given
   because none is set (see 4).
9. Twitch is described as an independent controller for sign-in, the platform, the extension frame and the CDN
   images. Twitch's own transfer safeguards are left to Twitch's notice.
10. OpenAI is listed as a recipient "for the Forge" and the transfer basis is worded "on the basis of the EU–US Data
    Privacy Framework and/or the EU Standard Contractual Clauses (Art. 45 and Art. 46 (2) (c) GDPR)". Whether OpenAI
    acts as our processor or as its own controller depends on the account and contract (see 3 and 4).
11. The website Forge is described with "where the Forge is offered on our website", because it is off by default.
    Its run log is mentioned without a retention period (none exists).
12. Legal bases chosen: 6 (1) (f) for the website, chat presence, moments, Atlas, CDN images, Forge safety checks and
    email; 6 (1) (b) for sign-in, browser storage, the streamer's own kingdom, the Forge itself, a signed-in
    citizen's own home and the panel card; 6 (1) (c) for answering rights requests. The interests are named on each.
13. "If you do not want to be part of a kingdom, write to us and we will take your name out of it", and in
    retention: "Where your data is woven into that shared history, we remove your name and Twitch id from it."
    **This is a promise without a procedure: deeds cannot be deleted by database rule and facts are append-only.**
    A manual anonymisation path (a tombstone or name redaction that the reducer honours) must exist before launch.
14. "Chatdom receives that notice and follows it" (message deletes and clears): the subscriptions exist
    (`subscriptions.ts:57-59`); exactly what the kingdom does with each was not traced.
15. Streamers: "Chatdom then stops reading your channel and deletes its list of which window belongs to which
    viewer" when the streamer revokes; from the inventory. "Chatdom may also create its own channel point rewards and
    open polls" follows the `grants.ts` comment.
16. The panel: "asks Twitch for your public profile and your chat name colour" (Get Users, Get User Chat Color).
17. The Atlas: "we collect" assumes the collector is run by saartech for Chatdom. Retention figures (24 hours,
    30 days, three versions) are the repo's surveyor settings, not the collector's.
18. Pictures from Twitch: only emotes are given as the example, because the Atlas loads no avatars today.
19. Rights requests answered "within one month" (Art. 12 (3) GDPR). Identity check described loosely ("show that
    the Twitch account is yours").
20. No data protection officer is named, assuming fewer than 20 people regularly process personal data (§ 38 BDSG)
    and no core activity of large-scale monitoring. Presence tracking in many kingdoms could later raise the
    "regular and systematic monitoring" question (Art. 37 (1) (b)).
21. Children: "Twitch's own minimum age applies". No age is stated because Twitch's age differs by country.
22. AI section: the judges "never touch your home, your Twitch account or your place in the kingdom" follows
    Safety.md §1 and §5.7; not traced in code.
23. Browser storage: the IndexedDB land cache and the Atlas-preview note are treated as strictly necessary. A
    regulator could call a performance cache "useful, not necessary"; low risk.
24. Storage keys are described by purpose rather than by name, so no key name with an internal word appears on the
    page.

Terms:

25. "Nothing in it is for sale" and "Coals, homes ... have no money value."
26. The licence is limited to running and showing Chatdom (kingdom, Atlas, panel, the channel's stream). **It does
    not cover marketing**, such as using a viewer's creation in a trailer or on the front page; see 4.
27. Licence exceptions: shared history keeps the thing but the name is removed on request; Twitch streams and clips
    cannot be changed; copies kept by law or while a dispute is open.
28. Moderation (DSA Art. 14 information): AI checks before and after making; pass, private hold or refuse; mods
    and the streamer decide; we act where the kingdom's own people do not, or on orders. Restrictions of a person
    (e.g. losing Forge access) "in proportion, considering the circumstances, and say why".
29. "When we restrict something you made and we can reach you, we tell you what we did and why": Chatdom has no
    email for most users, so DSA Art. 17 statements of reasons can only go through the product. No in-product
    notice for a mod's removal exists yet.
30. Reports by email with the Art. 16 (2) DSA elements; "We confirm that we received your report" (Art. 16 (4)).
31. Changes: published 30 days ahead, never retroactive, stop using if you disagree. No deemed-consent clause
    (deemed consent by silence is risky after BGH XI ZR 26/20).
32. Jurisdiction for merchants: "the courts at our registered office" (Schiffweiler, so Amtsgericht Neunkirchen /
    Landgericht Saarbrücken).
33. The liability clause is the standard German one. Not on the page: for a free service, gift-law standards
    (§ 521 BGB, liability only for intent and gross negligence) may apply by analogy and limit liability further;
    the standard clause was kept as instructed. Also check whether §§ 327 ff. BGB (digital products "paid" with
    personal data, § 327 (3)) apply; probably not, since the data serves only to deliver the service.
34. "If we end it, we will announce it on this website in good time." No period is promised.

## 3. What I could not verify

- The Hetzner data-centre location (Falkenstein, Nuremberg or Helsinki for dedicated servers) and whether the DPA
  with Hetzner is accepted.
- Traefik and process log contents and retention on the host.
- Which optional services are on in production (Herald presence, the map, the Forge, the website Forge), and which
  channels Herald reads.
- OpenAI: which entity contracts with us (for EEA business customers usually OpenAI Ireland Ltd), whether a ChatGPT
  or Codex account login comes with a DPA at all (consumer plans generally do not), the data retention and training
  setting on that account, and whether OpenAI's US entity is certified under the EU–US Data Privacy Framework.
- **Twitch Developer Services Agreement:** it restricts sharing Twitch Data with third parties without Twitch's
  written permission (`chatdom/Safety.md` §7). `!forge` words typed in Twitch chat go to OpenAI. A legal reading or
  Twitch's permission is needed before `!forge` runs on real channels.
- The Atlas collector: under which Twitch app and scopes it runs, and its own retention.
- The exact fields of the realm's public founded, watch and chronicle reads.
- Postgres backups: whether they exist, where, and for how long (backups extend every retention).
- The mail provider behind tk@saartech.de (a processor for emails; not named on the page).
- Twitch Interactive's own transfer basis.
- Whether the panel extension's Twitch review accepts these URLs as written.
- The ODR closure date (from knowledge, see 2.6).

## 4. Decisions only Tobias can make

1. **A second fast contact channel for the imprint.** § 5 (1) no. 2 DDG asks for fast electronic contact and direct
   communication; the CJEU (C-298/07, 2008) said email alone is not enough and a second direct way is needed, such
   as a contact form or a phone number. Options: a contact form on chatdom.io (also a better DSA Art. 16 notice
   mechanism than email), or a phone number.
2. **VAT ID.** If saartech has a USt-IdNr., § 5 (1) no. 6 DDG requires it in the imprint.
3. **A Chatdom-specific address** (for example a chatdom.io mailbox for privacy, reports and the DSA contact point)
   instead of tk@saartech.de.
4. **The data-centre location** (the page says Germany).
5. **OpenAI: contract, DPA and transfer basis.** Move the Forge to an account or plan with a DPA and training turned
   off, or treat OpenAI as an independent controller and say so. Then fix the transfer sentence to the real basis.
   Together with the Twitch Developer Agreement question in 3.
6. **Retention periods to set and enforce**, then write them on the page: `realm_persons` (for example delete
   after 24 months without sign-in), `realm_citizen_names`, `realm_ingress_inbox` (lurker id lists every minute,
   kept forever today: the strongest candidate for a short limit), facts and moments, the Dock's royal acts,
   `runs.jsonl`, refused words (Safety.md promises 30 days), reverse-proxy logs (for example 7 or 14 days), backups.
7. **How deletion works with immutable deeds and append-only facts:** redaction of name and id, a tombstone event,
   or re-keying to an anonymous id. The privacy page already promises the outcome (2.13).
8. **Log retention on the host** (Traefik access logs: keep IPs or not, and for how long).
9. **Extension URLs:** point the Twitch extension's privacy policy URL at `https://chatdom.io/privacy` and the terms
   URL at `https://chatdom.io/terms`.
10. **Marketing use of what people make** (2.26): ask first, or widen the licence and say so.
11. **chatdom.gg**: whether the imprint and policies should name it too.
12. **German versions** of the imprint and the privacy policy (PRD backlog). The English text is the only one today.
13. **A DPO**: confirm none is required.
14. **The sign-in seal's frame and Twitch.** Twitch publishes no button spec. The seal puts the official Glitch,
    unaltered, on a black plate inside a brass bezel (see `twitch-brand.md`). Decide whether to send a mock-up to
    brandquestions@twitch.tv before launch.

## 5. Where the text must change when features ship

- **`!chatdom forget`:** privacy "Chat in a founded kingdom" (the "write to us" line), "Your rights" and "Your right
  to object" should name the command; retention should say what it removes and what stays anonymous.
- **Data export:** "Your rights" (Art. 15 and 20) should point to it.
- **Self-serve hide (A12):** privacy "The Atlas" should link "Hide my channel" instead of email only; terms
  unchanged.
- **Raid Gate going public:** it uses the session cookie (`apps/api/src/raid-gate/session.ts`); add what it records
  about raiders and raided channels to privacy, and its rules to the terms if people act there.
- **A speech provider (ElevenLabs) going live:** new recipient, transfer basis, what text or voice is sent, and
  whether any voice input is processed (voice can be biometric data). Safety.md's 16+ rule for voice belongs in the
  terms.
- **Analytics, ever:** a consent banner (§ 25 (1) TDDDG), a new privacy section and recipient; "In short" and the
  "What we never collect" panel on How it works must change.
- **Bits or paid features:** the terms need prices, payment, the consumer withdrawal right for digital content
  (§ 356 (5) BGB), and Twitch's monetisation terms; "Free to use" and "no money value" must go; privacy gains
  transaction data.
- **The Atlas loading streamer avatars from Twitch's CDN in the browser:** "Pictures from Twitch's servers" should
  name profile pictures on the Atlas as well as emotes.
- **The website Forge switched on (`PUBLIC_FORGE_TARGET`):** drop "where the Forge is offered" and give the run
  log's retention.
- **Refused-word retention enforced:** add "refused words are kept 30 days for appeals, then only the kind of
  limit" to the Forge section.
- **In-product reports, veils and appeals:** terms "Reporting content" and "How things are checked" should describe
  them; privacy gains reports (who reported what).
- **AutoMod checks (`moderation:read`) or blocked-terms reads:** new Twitch scopes in "If you found a kingdom", and
  names or words sent to Twitch for checking.
- **Chatdom posting in a channel's chat** (the reader account has `user:write:chat`): mention it in "If you found a
  kingdom".
- **The public passport with "hide my travels":** a new privacy section on what travels between kingdoms and who
  sees it.
- **A second AI or 3D provider** (for example a mesh service): Forge section, recipients and transfers.
- **Error reporting or a CDN:** recipients and transfers.
- **Any new cookie or storage key:** the storage section.
- **A contact form:** imprint contact, terms reporting and privacy "When you write to us".
