# PW11: unapplied owner patches

Prepared 2026-11-01 against the panel-window checkout. Only this note and `PW11-NEEDS.patch` were written. No application source, database or git operation was changed by this work.

The patch is a bounded integration proposal, **not completion of quiet or forget**. Keep `PersonPrivacy.projection` as `pending`; keep real forget unavailable until the authority described below exists. The candidate imports the lane's canonical `setPersonQuiet` and `forgetPerson`; it never emits the old presence `remove/forget` tombstone.

## Apply prerequisites and migration

`0012b_realm_panel_privacy.sql` already exists in the lane, after `0012_realm_panel.sql`. Include both files in the integrated build. The migration discovery glob already includes them; do not edit an applied migration or add manual table creation. The host owner runs the existing command, with the intended environment/schema loaded:

```sh
node apps/realm/scripts/migrate.mjs --schema realm
```

This command is an operator handoff, **not executed here**. Startup checks will refuse the new build until its exact migration checksums are applied. Use an isolated schema for testing; do not run this against live storage during lane work.

`patch --dry-run -p1 < work/lanes/panel-window/PW11-NEEDS.patch` checks the unapplied candidate without git.

## needs: raid-show — verified commands and real reply composition

The patch adds the parser at `ChatIngest.#chat`, after verified EventSub subscription, channel, source-channel, numeric author, time, coverage and deletion checks, before ordinary chat presence. It threads an optional `privacy` application through `DeliveryRuntime` and `startLiveSource`. No name or caller-supplied target selects the subject. Commands do not echo as speech or settle/relight someone during their forget request.

Supported commands are `!chatdom quiet`, `!chatdom quiet off`, `!chatdom forget`, and `!chatdom forget confirm <code>`. Bare forget only asks the Herald-only realm route for a fresh challenge. The challenge explicitly says **all kingdoms**, preserves homes/earned things, expires after two minutes, and is bound to the same numeric person and channel. Confirmation must be a newer, different message. A consumed or lost challenge requires a new request; no automatic destructive retry occurs. At most 1,024 challenges exist in a process; restart clears them and therefore fails closed.

The existing Herald composition has **no general authorized chat reply service**. It must pass the new application to `startLiveSource`:

```ts
privacy: createPrivacyClient({
  url: realm.options.url,
  secret: realm.options.secret,
  reply: (request, line) => privacyReplies.send(request.kingdomId, line),
}),
```

`privacyReplies.send` is the required owner port, not an existing export or a supplied implementation. It must use the configured bot's authorized Send Chat Message path, respect rate limits and check `is_sent`, never @-mention the subject, and use the same verified channel. Do not connect a console logger or report a send before provider confirmation. Until this port is supplied the optional parser hook is deliberately uncomposed. Development writes stay restricted to Tobias's channel. The candidate transport caps concurrent requests at 32; overflow is dropped without any acknowledgement. No Twitch write was made here. The proposal requires no new Helix name lookup: identity comes from the verified EventSub event; any bot/channel resolution continues to use numeric Helix IDs.

The confirmation cache is deliberately not the erasure authorization ledger. Before enabling an authority, main must tie confirmed operations to an authoritative consent generation so a challenge from another process or an intervening panel rejoin cannot authorize a second erasure. The current lane `RealmForgetAuthority` lacks that generation; do not enable destructive production chat commands by adding only the optional authority argument.

## needs: main + grand-world — current watch projection

The patch adds `readWatchNames` and injects it at the actual `mountRealmWatchRoutes` composition in `apps/realm/src/main.ts`. It reads the person-global quiet registry privately, binds owned homes/castle to their immutable slots, and projects only the public SSE output. Stored facts, immutable geometry hashes, cards and ownership remain unchanged. No person ID or quiet registry is sent publicly.

Covered outputs:

- Initial watch checkpoint and subsequent public deliveries: presence `publicName` becomes null for quiet slots. Existing home/window label rendering derives its names from these frames; the light remains present.
- Structured moment credits: direct credit, gift giver/recipients/forwarder, Hype contributors and charity donor. Null-slot credits are always anonymous because the public record contains no identity that can authorize them. This is deliberately conservative; it does not guess identity from a display name.
- Stream UI clears retained labels, speech and moment captions on a non-ready scene, and stops retaining the last withdrawn climax name for a fade.

**Residuals; this does not make quiet complete:** watcher names in `RealmWalkerFrame`, Forge `provenance.makerName`, clip-still clipper/title, channel names, authored/free text, dock credits, Chronicle/replays, public scene bytes, existing stills/card images and alternative non-watch transports are not covered. The patch does not claim that removing a home-window label removes maker attribution elsewhere. Cards must remain owned/named; stream-specific derivatives need their own policy.

The candidate polls the quiet set once per second and closes/reopens the watch when it changes. This has a real race: a save between two reads can leave the prior name visible for about one second plus query/transport delay. A failed or hung query can extend that until existing database timeouts close the stream. The patch therefore remains `projection: pending`; it must not acknowledge “name is off stream.” Main's final projection service needs an ordered disclosure revision/invalidation fence across writers and transports, with no stale named publication after its acknowledged revision. Prefer one shared bounded watcher per kingdom over 32 per-connection queries/second before production. Persistent art may contain attribution; do not mutate digested approved bytes to hide it.

## needs: main/integrator — replay-safe RealmForgetAuthority

The lane's exact compositional interface is exported from `apps/realm/src/ingress/panel/privacy.ts`:

```ts
forget({ personId, requestedFromKingdomId, origin, requestId }): Promise<
  | { status: 'forgotten'; operationId: string; erased: readonly string[]; retained: readonly string[] }
  | { status: 'pending'; operationId: string }
  | { status: 'unavailable' }
>
```

Compose one authority instance into `RealmPanelService({ forgetAuthority })` and `mountChatPrivacy({ authority: forgetAuthority })`. Do not use the request's kingdom to narrow global erasure. The sample mount intentionally supplies no authority, so chat returns “Forget is unavailable. Nothing was erased.”

Main must first add a durable operation/status/consent-generation contract: retries resolve the same outcome; fresh Take your place advances consent; stale observations and prior challenges cannot cross it. Panel currently creates a new request ID per HTTP attempt, and has no operation-status endpoint. Those are explicit integration gaps, not evidence of a restart-safe erasure API. Preserve actual moderation bans independently of privacy consent.

Required owner work cannot be implemented by the panel's allowed SQL table addition:

1. `DurableKingdom.ingest` and repository `executeIngress` own serialization, fenced transaction, in-process state/cache adoption and public delivery. Their transition port cannot perform erasure SQL or replace replay state. Separate panel SQL races these owners.
2. Allocation's `realm_deed_guard` freezes person, tenure evidence and install-command copies. Private facts/snapshots include identity/name evidence; replay requires digests and a contiguous fact tail. Arbitrary deletion breaks recovery, while a new checkpoint alone leaves old snapshots/facts recoverable. Add deliberate versioned redaction/replay support and allocation evidence separation under owner migrations.
3. Sweep the subject's checkpoint/runs, pending and settled inbox payloads, provider fields in facts/snapshots/deeds, name/profile rows, public outbox/history, dependent images/replays and process caches. Include a retention/backup policy and prevent restored backups from republishing erased data. Report categories actually completed, not a count of convenient tables.
4. Preserve homes, earned balances/items and other subjects. `PersonId` is currently the raw Twitch ID even inside Chatdom ownership records: main must explicitly define/disclose retained ownership linkage or separate internal ownership identity before claiming all Twitch-derived records erased.
5. Commit the erasure receipt only when the sweep and all publication invalidations are durably complete. Pending remains pending. A COMMIT reply loss is uncertain, never “nothing changed.”

Acceptance evidence the owners must supply: authenticated quiet/forget commands; bare forget writes no erasure; wrong person/channel/code, old/duplicate message, restart and expired confirmation refuse; no unauthenticated service access; the quiet projection preserves lights and suppresses covered credits; erase → restart/replay → stale inbox retry → same-ID Take your place; belongings and an unrelated person's bytes/records remain intact; cross-process stale challenge and lost commit/reply tests. Add focused tests beside each touched owner module. No root tests were run for this proposed patch.

## Evidence and doubts

Read the vision, PRD, seams, current privacy functions, Herald EventSub path, realm writer/repository, allocation guards and watch/stream rendering. Used the local Twitch development/chat skills for identity and reply boundaries. No external code adapted. Validation: `patch --dry-run -p1` passed against all nine target paths; TypeScript syntax/transpile checks passed for the three proposed new modules. These are patch-shape and syntax checks, not semantic typechecking or runtime tests. The patch is unapplied; it is not a claim of verified production behavior. Main still owns the complete erasure protocol, truthful completion semantics and the remaining stream surfaces.
