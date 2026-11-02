# Hosted Test

**Not run. C04's purchase bar remains open.** This lane has not configured the extension in Twitch, registered
products or subscribed a webhook. Signed local receipts and Helper harnesses are development proof only.
Production world/stream effects still need their owner's readiness acknowledgement. Use the console details in
[EXTENSION-STEPS.md](../../../deploy/public/EXTENSION-STEPS.md); this checklist records no deploy or Twitch action.

1. **First real test-mode gift checkpoint:** make the first real gift through Twitch Hosted Test on tobi4s_ the
   acceptance target. Record **Not run / C04 open** now; perform it in the final step after the prerequisites below.
   An earlier successful run may be referenced with evidence; never substitute a Helper mock.
2. Use the owning tobi4s_ account with two-factor sign-in and two allowlisted testers. Confirm extension version,
   channel `129634568`, Panel + Mobile types and pre-release disclosure. Use development products on tobi4s_ only.
3. Build the versioned zip with `node scripts/public/extension.mjs --origin https://chatdom.io --version 0.0.1`.
   Review its report: relative assets, four HTML views, correct backend, mobile first load at most 1 MB.
4. Turn Bits on, Request Identity Link on, Configuration Service on with broadcaster version `1`. Set the report's
   backend origin in URL Fetching and Image Domains, allow panel/config links, and set `panel.html`, `mobile.html`,
   `config.html`, `live_config.html`, panel height `496`.
5. Have the operator privately configure the extension Client ID, base64 Extension Secret and OAuth Client Secret
   plus realm ingress. For the host's PubSub publisher, also set `TWITCH_EXTENSION_OWNER_ID` from the verified
   extension owner's numeric Twitch ID: it is public and has a distinct role from the target channel; never infer
   it from that channel even if the verified IDs match. Health names this field if missing or invalid. The two-key
   switch-on promise is not met without it; the OAuth product/webhook tools still need only their three credential
   values. Do not use Atlas credentials
   or browser storage. Check `/healthz` and `/api/panel/v1/health`; record missing names only, never secret values.
6. Review offline catalogue/webhook plans, then `--inspect` using the private environment file. The operator runs
   `--apply` deliberately after review. Verify all 60 SKUs in development with broadcast on; each gift's bands give
   the same effect. Released or retired entries require separate review.
7. Inspect the `extension.bits_transaction.create` v1 webhook for this extension ID at
   `https://chatdom.io/api/panel/v1/bits-webhook`, using the API's matching private derived HMAC secret. Require
   `enabled`, not pending verification. Wrong callback/status needs repair, not duplication. Capture no secrets.
8. Upload the zip, move to Hosted Test, install on tobi4s_, open Configure, save version `1`, activate Panel 1.
   Verify the actual kingdom connection. The founding OAuth route is not wired: keep that check open until
   main/Herald supplies the real entry with Tech §7.2's six Tier 1 scopes. Do not invent a URL or forge connection.
9. In two real panels read Kingdom, share identity, Take your place and light the citizen's window. Confirm real
   state in both, without fixtures. Check hidden/paused/offline stop conditions without granting presence.
10. From Configure select tabs and about eight gifts with one band each; wait for **Saved**, reload and verify
    persistence. Pending changes offer **Check Twitch again** without another save. A routine authorization refresh
    must retain unsaved edits; a real identity change must clear them.
    Keep another panel on Kingdom; settings must never open Gifts or move its current tab. Verify visible Bits
    amounts come from Twitch products.
11. From Live Config Hide gifts: new gifts close and pending paid gifts wait. Resume; pending obligations survive.
    Only the broadcaster can save/Hide; viewer changes to Helper data cannot authorize gifts.
12. Confirm a committed public moment reaches the second panel over PubSub within one second. Disable that delivery
    in the owned test setup, verify the five-second polling fallback, then restore it. PubSub cannot grant a gift.
13. In the actual Twitch mobile app check all three tabs, thumb targets, identity and safe Bits-unavailable behavior.
    Capture desktop 318×496 and mobile 390×844 evidence without JWTs or receipts.
14. Obtain readiness for the selected world/stream gift; verify stream live, Bits enabled and the actual SKU offered.
    Cancel once and confirm no delivery. Confirm the product is in development and no real Bits will be deducted.
    Loopback without an authoritative provider transaction does not satisfy this checkpoint.
15. **Perform the first real test-mode gift in Hosted Test on tobi4s_.** Give the mounted gift through Twitch's own
    dialog. Record SKU, provider test mode, visible world/stream effect, committed event ID and second-panel moment;
    keep transaction ID private. Verify no real Bits deducted. Replay its verified receipt and webhook through the
    owned test path and confirm exactly one delivery. Record actual results and evidence; only a successful
    provider-backed run closes C04's purchase bar. Otherwise retain **Not run / C04 open**.
