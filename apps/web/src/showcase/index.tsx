import { For, onMount } from 'solid-js';
import './style.css';

type Place = { number: string; title: string; description: string; status: 'LIVE' | 'SIMULATED' | 'RECORDED' | 'UNAVAILABLE'; href?: string; action?: string };
const places: Place[] = [
  { number: '01', title: 'Walk the kingdom', description: 'Enter the real realm and explore its streets as a visitor.', status: 'LIVE', href: '/?walk=1&kingdom=129634568', action: 'Walk in' },
  { number: '02', title: 'On stream', description: 'See the real realm through its stream-facing camera.', status: 'LIVE', href: '/stream?source=realm&kingdom=129634568', action: 'Watch the realm' },
  { number: '03', title: 'The Forge', description: 'Try shaping a house piece in the simulated kingdom.', status: 'SIMULATED', href: '/?forge=1', action: 'Visit the Forge' },
  { number: '04', title: 'The Atlas', description: 'Explore Twitch from the recorded Surveyor snapshot of 30 October.', status: 'RECORDED', href: '/map', action: 'Open the map' },
  { number: '05', title: 'The panel', description: 'See a simulated night in the panel made for Twitch.', status: 'SIMULATED', href: '/panel?source=simulated', action: 'Open the panel' },
  { number: '06', title: 'The Chronicle', description: 'The kingdom’s remembered moments have no public page yet.', status: 'UNAVAILABLE' },
];

export default function Showcase() {
  onMount(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  return <div class="showcase">
    <header class="showcase-header"><a class="showcase-brand" href="/" aria-label="Chatdom home"><span class="showcase-brand-mark">C</span><span>Chatdom</span></a><a class="showcase-back" href="/">Back to the kingdom <span aria-hidden="true">↗</span></a></header>
    <main class="showcase-main">
      <section class="showcase-intro"><div class="showcase-kicker"><span /> A WORLD FOR EVERY CHAT <span /></div><h1>There’s a place<br /><em>for everyone.</em></h1><p>Kingdoms are made of people, and there are many ways to find your way in. Choose a door and see what’s here.</p><div class="showcase-ornament" aria-hidden="true">✦ <span /> ✦</div></section>
      <section aria-labelledby="places-heading"><div class="showcase-section-heading"><div><p class="showcase-label">THE OPEN DOORS</p><h2 id="places-heading">Come on in.</h2></div><p>Some places use live services and may ask you to sign in. Simulated experiences are marked.</p></div>
        <div class="showcase-grid"><For each={places}>{place => <article class={`showcase-card showcase-card--${place.status.toLowerCase()}`}><div class="showcase-card-top"><span class="showcase-number">{place.number} / 06</span><span class="showcase-status"><i />{place.status}</span></div><h3>{place.title}</h3><p>{place.description}</p>{place.href ? <a href={place.href}>{place.action}<span aria-hidden="true">↗</span></a> : <span class="showcase-unavailable">Not available yet</span>}</article>}</For></div>
      </section>
      <section class="showcase-future" aria-labelledby="future-heading"><div><p class="showcase-label">ON THE HORIZON</p><h2 id="future-heading">More kingdoms await.</h2><p>A coastal hamlet, a river town and a mountain city. Their doors open here when ready.</p></div><div class="showcase-future-list"><For each={['Coastal hamlet', 'River town', 'Mountain city']}>{name => <div><span>{name}</span><small>UNAVAILABLE</small></div>}</For></div></section>
    </main><footer class="showcase-footer"><span>CHATDOM</span><p>A kingdom lit by its people.</p><a href="/">Return home ↑</a></footer>
  </div>;
}
