# The live evening bridge

`RealmEveningBridge` joins Herald's normalized delivery to the durable realm registry. It does not own a
repository, acquire a writer directly, allocate homes, approve names, create Forge rights, or credit coal.

Composition:

1. Create one `ForgeWriteGate` and install it in the existing `PostgresRealmRepository` options.
2. Create one `FileForgeApprovals` with a persistent private directory.
3. Create the bridge with `{ origin, ingress, gate, approvals }`. Its default providers use the existing
   isolated Codex CLI path. Tests may explicitly inject controlled providers.
4. Compose `bridge.attach(kingdom)` with the registry's ingress attachment hook, then call
   `bridge.use(services)` with that exact registry.
5. Mount `mountEveningRoutes(app, bridge)` once. This mounts both the existing
   `/internal/realm/ingress` and the shared `/internal/realm/herald` service paths. Do not also mount
   `mountIngressRoute` on the same app.
6. Stop the bridge before releasing the realm's registry and database.

Both routes authenticate with the existing ingress bearer credentials. The private route allows only
Herald, validates `RealmHeraldEnvelopeSchema`, and refuses a mismatched origin. No new service secret,
paid API-key setting, public browser route, or Twitch write is introduced.

Presence continues through the durable ingress inbox, checkpoint transition, and single writer. Private
Forge wishes wait up to five seconds for committed chat evidence, then run the actual kingdom Forge
coordinator with the same `FileForgeApprovals` sink read by `createForgeAuthority`. A counted registry hold
keeps that writer alive for the run. Deletion, offline, moderation, and source-loss delivery revoke the
caller before the authority's transactional `ForgeWriteGate` permits a change. A deletion received before
its wish leaves a bounded ten-minute tombstone. Durable attempt uniqueness prevents retry spending.

Forge stages use the transient channel. Committed attachments use only the authority's durable outbox;
the coordinator callback does not emit a second reveal. Refusal/hold/cold outcomes go privately to an
owner currently connected to the room. No ordinary chat text enters the persistence path.

Private chat identifies a real person. The bridge resolves their committed owned-home slot and the
realm presence epoch; Herald's presentation slot is never used. The private message ID is hashed into
a public speech ID. Only active cue IDs, person binding, and expiry are held in memory, for at most the
cue's ten-second lifetime, so deletion and author/room clear can remove witnessed bubbles.

Evidence: `pnpm exec vitest run apps/realm/src/evening/bridge.test.ts` exercises the actual bridge,
coordinator, file approvals, transactional gate, and durable registry with a controlled SIMULATED
repository/providers. It demonstrates one writer, one coal debit, durable attachment publication,
transient stages, cancellation, strict service/origin admission, slot mapping, and speech removal.
These tests do not claim real Twitch or real model execution.

`createRealmCitizens` composes first-chat settlement with that same registry. Construct it with the realm
database, origin and explicitly approved kingdom-name map; pass `citizens.furnish` to the durable boot,
then call `citizens.use(boot.allocation, boot.services)`. After the Herald gate admits an observation,
await `citizens.observe(observation)` before accepting its durable presence input. This callback only
settles current chat evidence of the matching origin. It retains the registry's existing kingdom,
recovers pending deeds, and calls the existing allocation and install services with empty history
evidence. The broadcaster keeps the castle exception and the service keeps the global three-home cap.

Native furnishing uses `createNativeForgeHost(deed.placement)` so the allocated citizen owns the exact
accepted home already on that plot. Names use the existing `provider-display-name-v1` cleaning rule.
Gate-admitted named chat persists only the cleaned provider name, approval and observation time in the
private `realm_citizen_names` table (migration 0006), independently of OIDC person/session rows. A missing
or unusable actual name leaves its deed pending; it never supplies an invented name or approval.
Names are saved before allocation, and the allocation service fixes prepared command bytes, so both
the allocation-to-preparation and preparation-to-installation crash windows recover after restart.
`citizens.recover(kingdom)` can also run on the registry's exact newly opened writer without acquiring
another hold. The callback grants no Forge or build rights and credits no coal.

Evidence: `pnpm exec vitest run apps/realm/src/evening/citizens.test.ts` runs the production allocation,
native furnishing, reducer and retained registry against controlled SIMULATED stores. It demonstrates
recovery with only persisted name/deed evidence, one installed home across retries, exact approved native
geometry, no invented follow/sub history, no auth-row writes, no rights/coal grants, one retained writer
and the monarch's castle exception. It does not claim real Twitch or Postgres execution.
