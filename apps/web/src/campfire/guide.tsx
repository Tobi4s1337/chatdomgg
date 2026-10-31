import { For } from 'solid-js';
import { ROLE_LINES, ROLE_NAMES } from './copy';
import { Glyph } from './glyphs';
import { DUSK_COURT_ROLES } from './ports';

/** The short, complete explanation shown before anyone joins. Rules come from Dusk Court's authored settings. */
export function DuskCourtGuide(props: { id?: string; class?: string }) {
  return <section id={props.id} class={`campfire-guide ${props.class ?? ''}`} aria-labelledby="campfire-guide-title">
    <header>
      <p class="campfire-guide-eyebrow">A game for the fire</p>
      <h2 id="campfire-guide-title">Dusk Court</h2>
      <p class="campfire-guide-lede">Someone at this fire has been putting out the town's lanterns. The rest have until dawn to decide whom they trust.</p>
    </header>
    <ul class="campfire-roles">
      <For each={DUSK_COURT_ROLES}>{role => <li><Glyph name={role} class="campfire-role-mark" /><div><h3>{ROLE_NAMES[role]}</h3><p>{ROLE_LINES[role]}</p></div></li>}</For>
    </ul>
    <ol class="campfire-day">
      <li><b>Night</b> Every seat gets a sealed card and a private tap, even to rest.</li>
      <li><b>Dawn</b> What happened is told, and a lost lantern's card is turned.</li>
      <li><b>Talk</b> Everything said at the fire is public, by voice or in chat.</li>
      <li><b>Ballot</b> Each living player votes once, or abstains.</li>
    </ol>
    <p class="campfire-guide-gallery"><Glyph name="gallery" class="campfire-role-mark" /><span><b>The Gallery.</b> Watching on Twitch, type <kbd>!sus name</kbd>. Suspicion glows as an ember by that log; it never votes and never marks anyone afterwards.</span></p>
    <p class="campfire-guide-foot">Five to eleven players and the Magistrate · one Snuffer up to seven players, two from eight · at most eight days · a text seat has the same say as a voice.</p>
  </section>;
}
