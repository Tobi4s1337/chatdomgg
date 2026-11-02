# PW13 switch-on contract

## Decisions — 2 November 2026

- The realm owns preferences and gift eligibility. Twitch holds a public published copy. A realm save is durable
  immediately; publication is pending until an owner-signed server GET verifies the exact current public reading.
- Browsers never call `Helper.configuration.set`. The server publishes from a durable coalesced outbox, with fresh
  claim identities, expiry, fenced completion and periodic drift repair. A database claim cannot fence a delayed
  remote HTTP write; convergence is eventual after those requests settle, never a cross-service atomic transaction.
- The current composition serves one Extension per realm origin. Publication binds to the configured Client ID;
  trusted publisher startup activates its durable binding generation, making old channels eligible without a
  browser visit. Changing the Client ID invalidates old acknowledgements. Claims and request permits carry both
  the trusted binding generation and a fresh claim ID. Same-client replicas share their active generation.
- A shared SQL quota spaces all configuration GET and PUT requests by at least 3,100 ms, conservatively respecting
  Twitch's documented 20/minute limits across workers and channels. Realm locks are released before external HTTP.
  At most two claims run across all replicas. Dirty preferences and rebinding take priority over routine audits;
  audit latency includes backlog and provider recovery, so the 60-second audit target is not a convergence promise.
- Connection is derived by the realm and included in the published reading, never accepted as a saved preference.

The owned shared types `PanelSettings`, `PanelSettingsReading` and `PanelSettingsSync` plus
`apps/panel/src/settings/schema.ts` define the public channel preferences. Kingdom stays available as the safe
entry. The broadcaster may hide the You/Gifts destinations deliberately; normal state changes never move or open
Gifts. Eight selections at most, one fixed band per gift. Actual Helper products supply visible Bits amounts.
Connection, person identity, effect readiness and payment status are not writable preferences.

The broadcaster segment of Twitch's Configuration Service stores the public reading with version `1`.
A viewer cannot authorize gifts by editing Helper data.
Settings/Hide writes require a verified broadcaster JWT whose user equals its channel. A stale config page cannot
overwrite a newer Hide: writes use an expected revision and return conflict rather than silently losing changes.
The config UI confirms the realm write, then reads publication status. A pending change remains visible and can be
checked again without editing or saving twice. A different revision is a conflict, never a stale Saved confirmation.
Unsaved draft edits cannot be confirmed by checking an older publication. Tokens remain in memory. No configuration
contains secrets.

## HTTP and realm doors

- `POST /api/panel/v1/configuration {}` reads `{version:1,status:'settings',revision,settings,connected}`.
- `POST /api/panel/v1/configure {expectedRevision,settings}` saves, only for the verified broadcaster. Returns a
  settings reading, `{version:1,status:'conflict',current:<reading>}`, or refused/unavailable.
- `POST /api/panel/v1/configuration-sync {}` reads
  `{version:1,status:'sync',reading,publication:'pending'|'verified',verifiedAt:number|null}`. This uses a verified
  viewer token; the Extension Client ID comes from server configuration, never the request body.
- Internal bearer routes `/internal/realm/panel/settings` and `/internal/realm/panel/settings-save` carry the
  verified kingdom ID; the save also carries personId equal to kingdomId. Never trust a browser-supplied identity.
- An unset channel uses revision `0` and defaults. Invalid persisted settings are unavailable, never defaults.
- Internal bearer-only `settings-sync`, `settings-mirror-activate`, `settings-mirror-claim`, `settings-mirror-permit` and
  `settings-mirror-finish` routes serve the durable publisher. Every permit/finish needs the active claim ID and
  configured Extension ID and binding generation. A stale claim cannot obtain a permit, acknowledge or requeue a
  replacement, including an old worker when the deployment moves from one Client ID to another and back again.
- Hide pauses new panel gifts and delivery of already paid pending gifts; obligations survive. Presence and free
  claim are unaffected. Unhide can resume pending gifts. Gift commits and Hide must serialize with the realm writer.

## PubSub

The server sends only a bounded broadcast invalidation `{version:1,type:'panel.refresh'}` signed with a
channel-scoped external JWT. Its `user_id` is the extension owner's verified ID, not the target channel.
`channel_id` scopes the destination. Twitch's signing requirements make the two-key switch-on promise insufficient
without owner metadata: the current composition names `TWITCH_EXTENSION_OWNER_ID` as missing rather than guessing.
Clients re-read the verified API; a message can never grant a gift or supply names.
At most one broadcast per second/channel, bounded active-channel registry, coalesced polling and disposal.
The Helper subscription is registered once and has per-adapter listeners. Hidden/disposed panels do no reads;
the five-second poll remains the fallback. Production broadcasts are Twitch writes by the application; this lane
does not run them against Twitch while developing. Test providers exercise the protocol locally.

## Evidence still needed

The complete switch-on rehearsal covers read/join/light, config/Hide and a gift plus PubSub in another real panel.
The provider and effect test ports remain explicit. Hosted Test is not run and C04's purchase bar is open.
No real world effect becomes ready merely because settings or Extension credentials exist.

## References

[Configuration outbox](references/configuration-outbox.md): atomic claims, attempt fencing and Twitch readback,
request limits and the boundary between database ownership and remote HTTP effects. Techniques only.
