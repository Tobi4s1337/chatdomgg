import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { compileChannelGenesis, compileGenesisSettlement, resolveGenesisEntry } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '@chatdom/world/genesis/observed';
import { REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema, RealmApiErrorSchema } from '@chatdom/shared/realm';
import { KingdomIdSchema, type KingdomPresenceFrame, type PresenceFeed, type Vec3 } from '@chatdom/shared';
import Kingdom from '../kingdom';
import type { PotentialKingdomView } from '../kingdom/scene';
import { readRealmJson } from '../realm/adapters/entry';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from './channels';
import { createGenesisWindowPreview } from './window-preview';
import { createGenesisSeatContent } from './seat-content';
import { genesisKingdomComposer } from './kingdom-composer';
import './preview.css';

type View = { potential: PotentialKingdomView; name: string; feed: PresenceFeed; category: string; average: number; landscape: string; lore: string };

/** Potential land is scenery, not a room, a deed, or a synthetic audience. */
export default function GenesisPreview() {
  const [view, setView] = createSignal<View>();
  const [error, setError] = createSignal<string>();
  const abort = new AbortController();
  onCleanup(() => abort.abort());
  onMount(() => { void open().catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'The land could not be read.'); }); });
  async function open() {
    const id = KingdomIdSchema.parse(location.pathname.split('/')[2]);
    const channel = GENESIS_CHANNELS.find(item => item.id === id);
    const observed = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === id);
    const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(item => item.broadcasterId === id);
    if (!channel || !observed || !choice) throw new Error('This holding’s land is not available here yet. Return to the Atlas to choose a kingdom.');
    const response = await fetch(REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', id), {
      signal: abort.signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const body = await readRealmJson(response, 'Reading the kingdom’s adopted land');
    if (response.ok) {
      const adopted = RealmFoundedManifestSchema.parse(body);
      resolveGenesisEntry({ broadcasterId: id }, adopted);
      // Existing adopted bytes always win over procedural potential, including during metadata outages.
      location.replace(`/stream?source=realm&kingdom=${encodeURIComponent(id)}`);
      return;
    }
    const unavailable = RealmApiErrorSchema.safeParse(body);
    if (response.status !== 404 || !unavailable.success) throw new Error(unavailable.success ? unavailable.data.message : 'The adopted-land service is unavailable. Its outage cannot generate a replacement world.');
    const recipe = compileChannelGenesis({ ...observed, profileColours: [...channel.palette], evidence: {
      kind: 'observed', sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT),
    } });
    const landscape = recipe.landscapes.find(item => item.character === choice.character)!;
    const proposed = compileGenesisSettlement(recipe, landscape.id);
    const composed = genesisKingdomComposer(id)?.compose({ recipe, landscape, plan: proposed });
    const plan = composed?.plan ?? proposed;
    const centreX = (plan.bounds.minX + plan.bounds.maxX) / 2;
    const centreZ = (plan.bounds.minZ + plan.bounds.maxZ) / 2;
    const span = Math.max(plan.bounds.maxX - plan.bounds.minX, plan.bounds.maxZ - plan.bounds.minZ);
    const target: [number,number,number] = [centreX, plan.market.elevation + 6, centreZ];
    const turn = landscape.coast.oceanToward;
    const offset = (x: number, z: number): readonly [number, number] => turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
    const direction = offset(-.46, .72);
    let eye: Vec3 = [centreX + span * direction[0], plan.market.elevation + span * .43, centreZ + span * direction[1]];
    if(choice.character==='coastal-harbour'){
      // Look across the harbour from the land: the sea occupies the far half
      // of the composition, with the village and its keep on the near shore.
      const look=offset(-50,125),near=offset(-155,-20);
      target[0]=look[0];target[2]=look[1];target[1]=plan.market.elevation+7;
      eye=[near[0],target[1]+63,near[1]];
    }
    if(choice.character==='river-valley'){
      const look=offset(20,5),near=offset(210,190);
      target[0]=look[0];target[2]=look[1];target[1]=plan.market.elevation+5;
      eye=[near[0],target[1]+76,near[1]];
    }
    const empty: KingdomPresenceFrame = { version: 1, kingdomId: id, epoch: `potential:${id}`, sequence: 0,
      asOf: recipe.evidence.asOf, origin: 'simulated', connection: 'offline', streamLive: false, windows: [] };
    const feed: PresenceFeed = { label: 'SIMULATED', subscribe(receive) { receive(empty); return () => {}; } };
    const seat = composed?.seat ?? (choice.character === 'coastal-harbour' ? createGenesisSeatContent(recipe, landscape, plan) : undefined);
    if (!abort.signal.aborted) setView({ potential: { plan, size: recipe.size.tier, style: recipe.identity.styleFamily,
      ...(seat ? { seat } : {}),
      camera: composed?.camera ?? { eye, target, fov: 50 }, windowPreview: createGenesisWindowPreview(id, plan.homes, recipe.evidence.asOf) }, name: channel.name, feed, category: observed.categories[0]!.name,
      average: observed.audience.averageViewers!, landscape: choice.character.replaceAll('-', ' '), lore: channel.lore });
  }
  return <Show when={view()} fallback={<div class="genesis-wait"><p>CHATDOM · THE LAND BEYOND THE MAP</p><h1>{error() ? 'The road needs a moment.' : 'Unfolding the land…'}</h1><p>{error() ?? 'Reading this channel’s own seed.'}</p><a href="/map">Return to the Atlas</a></div>}>{current => <>
    <Kingdom kingdomName={current().name} potential={current().potential} presenceFeed={current().feed} />
    <aside class="genesis-caption"><strong>{current().landscape}</strong><span>{current().category} · about {Math.round(current().average)} viewers in the recorded survey</span><p>{current().lore}</p><a href="/map">Return to the Atlas</a> · <a href="/showcase">Compare the three kingdoms ↗</a></aside>
  </>}</Show>;
}
