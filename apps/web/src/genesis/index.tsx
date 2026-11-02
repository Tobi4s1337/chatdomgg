import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { compileChannelGenesis, compileGenesisSettlement, resolveGenesisEntry, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '@chatdom/world/genesis/observed';
import { REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema, RealmApiErrorSchema } from '@chatdom/shared/realm';
import { KingdomIdSchema, type KingdomPresenceFrame, type PresenceFeed, type Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import Kingdom from '../kingdom';
import type { PotentialKingdomView } from '../kingdom/scene';
import { readRealmJson } from '../realm/adapters/entry';
import { HoldingError, holdingPlace, readDoorHolding, takeHandOff, type DoorHolding } from '../atlas/data/holding';
import type { PreviewSource } from '../atlas/data/preview';
import { DoorCartouche, type DoorStep } from '../atlas/ui/Door';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from './channels';
import { createGenesisWindowPreview } from './window-preview';
import { createGenesisSeatContent } from './seat-content';
import { genesisKingdomComposer } from './kingdom-composer';
import { composeMashaKingdom, MASHA_ID } from './kingdoms/masha';
import { GENESIS_KINGDOMS } from './kingdoms';
import { chooseLandscape, compileHoldingGenesis } from './holding-facts';
import { composeGeneratedKingdom } from './generated/compose';
import { RaidRide } from './raid-ride';
import './preview.css';

type View = { potential: PotentialKingdomView; name: string; feed: PresenceFeed; category: string; average: number; landscape: string; lore: string; place: string; authored: boolean };

const SOURCE: PreviewSource = { base: '/map-data', fetch: (input, init) => fetch(input, init) };
const LANDSCAPE_NAMES: Record<GenesisLandscape['character'], string> = { 'coastal-harbour': 'a harbour', 'river-valley': 'a river valley', 'mountain-pass': 'a mountain pass' };
const SIZE_NAMES: Record<ChannelKingdomRecipe['size']['tier'], string> = { hamlet: 'hamlet', village: 'village', town: 'town', city: 'city', capital: 'capital' };
/** A step that takes longer than this brings the raven. */
const RAVEN_MS = 2_500;

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** Potential land is scenery, not a room, a deed, or a synthetic audience. */
export default function GenesisPreview() {
  const [view, setView] = createSignal<View>();
  const [error, setError] = createSignal<string>();
  const [door, setDoor] = createSignal<{ id: string; name: string; subtitle: string }>();
  const [steps, setSteps] = createSignal<DoorStep[]>([]);
  const [phase, setPhase] = createSignal<'stamp' | 'ink' | 'wake' | 'gone'>('ink');
  const [waiting, setWaiting] = createSignal(false);
  const [raid, setRaid] = createSignal<{ from: string; to: string; viewers: number }>();
  const abort = new AbortController();
  let raven: ReturnType<typeof setTimeout> | undefined;
  let watch = 0;
  let rideDone = false;
  onCleanup(() => { abort.abort(); clearTimeout(raven); cancelAnimationFrame(watch); });

  /** Write a step in the margin: the one before it is done. */
  const step = (text: string) => {
    setSteps(current => [...current.map(item => ({ ...item, done: true })), { text, done: false }]);
    setWaiting(false);
    clearTimeout(raven);
    raven = setTimeout(() => setWaiting(true), RAVEN_MS);
  };
  const finish = (text: string) => {
    setSteps(current => [...current.map(item => ({ ...item, done: true })), { text, done: true }]);
    clearTimeout(raven);
    setWaiting(false);
  };

  onMount(() => {
    void open().catch(cause => {
      if (abort.signal.aborted) return;
      clearTimeout(raven);
      setWaiting(false);
      setError(cause instanceof Error ? cause.message : 'The land could not be read.');
    });
  });

  async function open() {
    const id = KingdomIdSchema.parse(location.pathname.split('/')[2]);
    const query = new URLSearchParams(location.search);
    const channel = GENESIS_CHANNELS.find(item => item.id === id);
    const observed = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === id);
    const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(item => item.broadcasterId === id);
    const authored = channel && observed && choice ? { channel, observed, choice } : null;
    // The holding: handed over by the Atlas card, or read from the survey this tab draws.
    let holding = takeHandOff(sessionStore(), id);
    setDoor({ id, name: holding?.name ?? channel?.name ?? 'A holding', subtitle: holding ? holdingPlace(holding) : 'Reading the Atlas' });
    // Adopted land is asked for first: a founded kingdom opens from its own bytes, whether or not the Atlas survey
    // has observed the channel (a small channel may never cross the survey's floor).
    step('The gate is opened');
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

    // Only an unfounded holding is drawn from the survey.
    if (!holding) {
      step('The survey is read');
      try {
        holding = await readDoorHolding(SOURCE, sessionStore(), id, abort.signal);
      } catch (cause) {
        if (abort.signal.aborted) return;
        // The three composed kingdoms keep their own recorded facts and open without the survey.
        if (!authored) throw cause instanceof HoldingError ? new Error(holdingMessage(cause)) : cause;
        setDoor({ id, name: authored.channel.name, subtitle: 'Drawn from its recorded survey' });
      }
      if (holding) setDoor({ id, name: holding.name, subtitle: holdingPlace(holding) });
    }
    const from = query.get('from');
    if (from && from !== id && /^[1-9][0-9]{0,31}$/.test(from)) setRaid({ from, to: id, viewers: Number(query.get('viewers') ?? 0) || 0 });

    const composed = authored ? await composeAuthored(id, authored) : await composeFromHolding(holding!);
    if (abort.signal.aborted) return;
    const { recipe, landscape, plan, seat, camera, openingHour, lore, style } = composed;
    const generated = 'kit' in composed && 'skyline' in composed ? { kit: composed.kit, skyline: composed.skyline } : {};
    if (openingHour !== undefined && !query.has('hour')) {
      const address = new URL(location.href); address.searchParams.set('hour', String(openingHour)); history.replaceState(history.state, '', address);
    }
    step(`${plan.homes.length.toLocaleString('en')} homes are set out in ${LANDSCAPE_NAMES[landscape.character]}`);
    await nextFrame();
    const empty: KingdomPresenceFrame = { version: 1, kingdomId: id, epoch: `potential:${id}`, sequence: 0,
      asOf: recipe.evidence.asOf, origin: 'simulated', connection: 'offline', streamLive: false, windows: [] };
    const feed: PresenceFeed = { label: 'SIMULATED', subscribe(receive) { receive(empty); return () => {}; } };
    const windowPreview = createGenesisWindowPreview(id, plan.homes, recipe.evidence.asOf);
    const lit = windowPreview.windows.filter(window => window.present).length;
    step(`The lamps are lit in ${lit.toLocaleString('en')} windows`);
    const name = holding?.name ?? authored?.channel.name ?? id;
    setView({
      potential: { plan, size: recipe.size.tier, style, ...(seat ? { seat } : {}), camera, windowPreview },
      name, feed,
      category: holding?.game?.name ?? authored?.observed.categories[0]!.name ?? '',
      average: holding?.average ?? authored?.observed.audience.averageViewers ?? 0,
      landscape: `A ${SIZE_NAMES[recipe.size.tier]} in ${LANDSCAPE_NAMES[landscape.character]}`,
      // The heading already says how big; the line under it says where on the Atlas the holding stands.
      lore, place: holding && !authored ? capitalise(holdingPlace(holding).replace(/^An? \S+ /, '')) : '', authored: !!authored,
    });
    // Read by captures and checks: what this door opened.
    (window as Window & { __chatdomGenesis?: unknown }).__chatdomGenesis = {
      id, name, tier: recipe.size.tier, landscape: landscape.character, landmark: recipe.identity.landmark, biome: recipe.identity.biome,
      style, ...generated, homes: plan.homes.length, generated: !authored, hour: openingHour ?? null,
    };
    // The world wakes under the parchment once its first full frame is drawn.
    const wake = () => {
      if (abort.signal.aborted) return;
      if (!(window as Window & { __chatdomReady?: boolean }).__chatdomReady || (raid() && !rideDone)) { watch = requestAnimationFrame(wake); return; }
      finish('The kingdom wakes');
      setPhase('wake');
      setTimeout(() => setPhase('gone'), 1_700);
    };
    watch = requestAnimationFrame(wake);
  }


  /** The three composed kingdoms, each by its own composition, from their recorded facts. */
  async function composeAuthored(id: string, authored: { channel: typeof GENESIS_CHANNELS[number]; observed: typeof OBSERVED_GENESIS_FIXTURES[number]; choice: typeof OBSERVED_GENESIS_SHOWCASE_CHOICES[number] }) {
    const { channel, observed, choice } = authored;
    step('The land is drawn from the channel’s own seed');
    await nextFrame();
    const facts = { ...observed, profileColours: [...channel.palette], evidence: {
      kind: 'observed' as const, sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT),
    } };
    const own = await (await GENESIS_KINGDOMS[id]?.())?.composeGenesisKingdom({ facts, character: choice.character });
    const recipe = own?.recipe ?? compileChannelGenesis(facts);
    const selected = own?.landscape ?? recipe.landscapes.find(item => item.character === choice.character)!;
    const mountain = id === MASHA_ID ? composeMashaKingdom(recipe, selected) : undefined;
    const landscape = mountain?.landscape ?? selected;
    const proposed = own?.plan ?? mountain?.plan ?? compileGenesisSettlement(recipe, landscape.id);
    const composed = own ?? mountain ?? genesisKingdomComposer(id)?.compose({ recipe, landscape, plan: proposed });
    const plan = composed?.plan ?? proposed;
    const seat = composed?.seat ?? (choice.character === 'coastal-harbour' ? createGenesisSeatContent(recipe, landscape, plan) : undefined);
    const camera = composed?.camera ?? fallbackCamera(plan, landscape);
    return { recipe, landscape, plan, seat, camera, openingHour: own?.hour ?? mountain?.hour, lore: own?.lore ?? channel.lore, style: mountain?.style ?? recipe.identity.styleFamily };
  }

  /** Any other holding: its facts from the survey, its recipe, the land its realm leans to, and its generated town. */
  async function composeFromHolding(holding: DoorHolding) {
    step('The land is drawn from the channel’s own seed');
    await nextFrame();
    const recipe = compileHoldingGenesis(holding);
    const landscape = chooseLandscape(recipe);
    step(`${capitalise(SIZE_NAMES[recipe.size.tier])} streets are laid out`);
    await nextFrame();
    const kingdom = composeGeneratedKingdom(recipe, landscape);
    return { recipe, landscape, plan: kingdom.plan, seat: kingdom.seat, camera: kingdom.camera, openingHour: kingdom.hour, lore: kingdom.lore!, style: kingdom.style,
      kit: kingdom.kit.secondary ? `${kingdom.kit.primary}+${kingdom.kit.secondary}` : kingdom.kit.primary, skyline: kingdom.sites.skyline.map(piece => piece.kind) };
  }

  return <>
    <Show when={view()}>{current => <>
      <Kingdom kingdomName={current().name} potential={current().potential} presenceFeed={current().feed} />
      <aside class="genesis-caption"><strong>{current().landscape}</strong>
        <span>{current().place ? `${current().place} · ` : ''}{current().category ? `${current().category} · ` : ''}about {Math.round(current().average).toLocaleString('en')} viewers in the recorded survey</span>
        <p>{current().lore}</p><a href="/map">Return to the Atlas</a></aside>
    </>}</Show>
    <Show when={phase() !== 'gone' && raid()}>
      {current => <div classList={{ 'raid-ride-out': phase() === 'wake' }}><RaidRide from={current().from} to={current().to} viewers={current().viewers} signal={abort.signal}
        onArrived={() => { rideDone = true; }} onUnavailable={() => { rideDone = true; setRaid(undefined); }} /></div>}
    </Show>
    <Show when={door()} fallback={<div class="genesis-wait"><p>CHATDOM · THE LAND BEYOND THE MAP</p><h1>Unfolding the land…</h1></div>}>
      {current => <DoorCartouche id={current().id} name={current().name} subtitle={current().subtitle} steps={steps()}
        phase={raid() && !view() ? 'ink' : phase()} waiting={waiting()} failure={error() ?? null} />}
    </Show>
  </>;
}

function holdingMessage(error: HoldingError): string {
  if (error.reason === 'missing') return 'This channel has no holding on the current survey of the Atlas.';
  if (error.reason === 'withheld') return 'This holding is not shown on the Atlas.';
  return 'The Atlas could not be read just now, so the road into this land is closed for a moment.';
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The view the preview used before a kingdom had a composition of its own. */
function fallbackCamera(plan: SettlementPlan, landscape: DeepReadonly<GenesisLandscape>): { eye: Vec3; target: Vec3; fov: number } {
  const centreX = (plan.bounds.minX + plan.bounds.maxX) / 2, centreZ = (plan.bounds.minZ + plan.bounds.maxZ) / 2;
  const span = Math.max(plan.bounds.maxX - plan.bounds.minX, plan.bounds.maxZ - plan.bounds.minZ);
  const turn = landscape.coast.oceanToward;
  const offset = (x: number, z: number): readonly [number, number] => turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
  const direction = offset(-.46, .72);
  return { eye: [centreX + span * direction[0], plan.market.elevation + span * .43, centreZ + span * direction[1]], target: [centreX, plan.market.elevation + 6, centreZ], fov: 50 };
}
