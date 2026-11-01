# PW13 switch-on contract

The owned shared types `PanelSettings` and `PanelSettingsReading` plus
`apps/panel/src/settings/schema.ts` define the public channel preferences. Kingdom stays available as the safe
entry. The broadcaster may hide the You/Gifts destinations deliberately; normal state changes never move or open
Gifts. Eight selections at most, one fixed band per gift. Actual Helper products supply visible Bits amounts.
Connection, person identity, effect readiness and payment status are not writable preferences.

The broadcaster segment of Twitch's Configuration Service stores the public preferences with version `1`.
The realm holds an authenticated mirror for purchase gates: a viewer cannot authorize gifts by editing Helper data.
Settings/Hide writes require a verified broadcaster JWT whose user equals its channel. A stale config page cannot
overwrite a newer Hide: writes use an expected revision and return conflict rather than silently losing changes.
The config UI confirms the realm write and observes the Helper configuration echo; a fire-and-forget Helper call
alone never produces a Saved confirmation. Tokens remain in memory. No configuration contains secrets.

The current page checks the realm revision before the Helper write and after its matching callback. This detects
a stale mirror but cannot atomically prevent it: another save can commit between the check and Helper write.
Revision-ordered server publication and durable reconciliation remain required before accepting this mirror.

## HTTP and realm doors

- `POST /api/panel/v1/configuration {}` reads `{version:1,status:'settings',revision,settings,connected}`.
- `POST /api/panel/v1/configure {expectedRevision,settings}` saves, only for the verified broadcaster. Returns a
  settings reading, `{version:1,status:'conflict',current:<reading>}`, or refused/unavailable.
- Internal bearer routes `/internal/realm/panel/settings` and `/internal/realm/panel/settings-save` carry the
  verified kingdom ID; the save also carries personId equal to kingdomId. Never trust a browser-supplied identity.
- An unset channel uses revision `0` and defaults. Invalid persisted settings are unavailable, never defaults.
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
