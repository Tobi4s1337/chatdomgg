import { For, onMount } from 'solid-js';
import './style.css';
import { GENESIS_CHANNELS } from '../genesis/channels';

type Place = { number: string; title: string; description: string; status: 'LIVE' | 'SIMULATED' | 'RECORDED' | 'UNAVAILABLE'; href?: string; action?: string };
const places: Place[] = [
  { number: '01', title: 'The evening begins', description: 'Watch chat light the town, then follow the lanterns home.', status: 'SIMULATED', href: '/stream?source=simulated&tier=town&hour=19.5&seam=starting', action: 'Watch the homecoming' },
  { number: '02', title: 'The Forge', description: 'Try shaping a house piece in the simulated kingdom.', status: 'SIMULATED', href: '/?forge=1', action: 'Visit the Forge' },
  { number: '03', title: 'The Atlas', description: 'Explore Twitch from the recorded Surveyor snapshot of 30 October.', status: 'RECORDED', href: '/map', action: 'Open the map' },
  { number: '04', title: 'The panel', description: 'See a simulated night in the panel made for Twitch.', status: 'SIMULATED', href: '/panel?source=simulated', action: 'Open the panel' },
  { number: '05', title: 'Make your citizen', description: 'Find a look that feels like you, with hair, clothes and earned keepsakes.', status: 'SIMULATED', href: '/-/avatar-builder', action: 'Make your citizen' },
  { number: '06', title: 'Citizen card & passport', description: 'Meet Wren through their portrait, keepsakes and ink-stamped travels.', status: 'SIMULATED', href: '/-/citizen-card?fixture=wren&mode=page&light=dusk&chrome=0', action: 'See the card' },
  { number: '07', title: 'The Chronicle', description: 'Read Willowmere’s recorded nights and see how its homes changed.', status: 'LIVE', href: '/stream?source=realm&kingdom=129634568&chronicle=1', action: 'Open the kingdom’s story' },
];

const kingdoms = [
  { ...GENESIS_CHANNELS[0], landscape: 'Coastal hamlet', category: 'Counter-Strike', average: '16', note: 'A harbour lane above the shore, with a keep on the rise.' },
  { ...GENESIS_CHANNELS[1], landscape: 'River town', category: 'Retro', average: '140', note: 'A market and winding neighbourhoods beside a river descending from the hills.' },
  { ...GENESIS_CHANNELS[2], landscape: 'Mountain city', category: 'Chess', average: '852', note: 'A city beneath the keep and the mountain pass.' },
] as const;

export default function Showcase() {
  onMount(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  return <div class="showcase">
    <header class="showcase-header"><a class="showcase-brand" href="/" aria-label="Chatdom home"><span class="showcase-brand-mark">C</span><span>Chatdom</span></a><a class="showcase-back" href="/">Back to the kingdom <span aria-hidden="true">↗</span></a></header>
    <main class="showcase-main">
      <section class="showcase-intro"><div class="showcase-kicker"><span /> A WORLD FOR EVERY CHAT <span /></div><h1>There’s a place<br /><em>for everyone.</em></h1><p>Kingdoms are made of people, and there are many ways to find your way in. Choose a door and see what’s here.</p><div class="showcase-ornament" aria-hidden="true">✦ <span /> ✦</div></section>
      <section class="showcase-door" aria-labelledby="willowmere-heading">
        <div class="showcase-door-story"><p class="showcase-label">LIVE KINGDOM · TOBI4S_</p><h2 id="willowmere-heading">Welcome to <em>Willowmere.</em></h2><p>One kingdom, whether you watch on stream, walk its streets or lead the evening from the throne.</p><span class="showcase-door-seal" aria-hidden="true">W</span></div>
        <div class="showcase-door-links">
          <a href="/stream?source=realm&kingdom=129634568"><span><strong>Watch on stream</strong><small>See Willowmere through its stream camera</small></span><b aria-hidden="true">↗</b></a>
          <a href="/?walk=1&kingdom=129634568"><span><strong>Walk in</strong><small>Twitch sign-in required to enter</small></span><b aria-hidden="true">↗</b></a>
          <a href="/dock"><span><strong>Monarch’s throne</strong><small>Sign in as monarch to lead your kingdom</small></span><b aria-hidden="true">↗</b></a>
        </div>
      </section>
      <section aria-labelledby="places-heading"><div class="showcase-section-heading"><div><p class="showcase-label">THE OPEN DOORS</p><h2 id="places-heading">Come on in.</h2></div><p>Some places use live services and may ask you to sign in. Simulated experiences are marked.</p></div>
        <div class="showcase-grid"><For each={places}>{place => <article class={`showcase-card showcase-card--${place.status.toLowerCase()}`}><div class="showcase-card-top"><span class="showcase-number">{place.number} / {String(places.length).padStart(2, '0')}</span><span class="showcase-status"><i />{place.status}</span></div><h3>{place.title}</h3><p>{place.description}</p>{place.href ? <a href={place.href}>{place.action}<span aria-hidden="true">↗</span></a> : <span class="showcase-unavailable">Not available yet</span>}</article>}</For></div>
      </section>
      <section class="showcase-kingdoms" aria-labelledby="kingdoms-heading"><div class="showcase-section-heading"><div><p class="showcase-label">THREE COMMUNITIES · THREE LANDSCAPES</p><h2 id="kingdoms-heading">Different places to belong.</h2></div><p>Land previews from real channels in the recorded 30 October Atlas survey. No residents have been assigned to these places.</p></div><div class="showcase-grid"><For each={kingdoms}>{kingdom => <article class="showcase-card showcase-kingdom-card"><div class="showcase-card-top"><span class="showcase-number">{kingdom.landscape}</span><span class="showcase-status">RECORDED · UNFOUNDED</span></div><h3>{kingdom.name}</h3><p>{kingdom.note}</p><p class="showcase-kingdom-source">{kingdom.category} · about {kingdom.average} viewers in the recorded survey</p><a href={`/kingdom/${kingdom.id}`}>See the land<span aria-hidden="true">↗</span></a></article>}</For></div></section>
    </main><footer class="showcase-footer"><span>CHATDOM</span><p>A kingdom lit by its people.</p><a href="/">Return home ↑</a></footer>
  </div>;
}
