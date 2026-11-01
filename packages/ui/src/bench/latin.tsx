// The same names bench with Latin names only: the page a test loads to prove a Latin page fetches no other script's
// faces, whatever kit pieces it shows (seals, slips, the footer, a canvas and the How it works sheet).
import { render } from 'solid-js/web';
import { HowItWorksSheet } from '../index';
import { LATIN_NAMES, NamesBench } from './names';

render(() => <>
  <NamesBench names={LATIN_NAMES} title="A Latin page" lede="The same pieces with Latin names only. This page loads no other script's faces." />
  <section class="nb-hiw"><HowItWorksSheet title="A map of all of Twitch" heading={3} /></section>
</>, document.getElementById('root')!);
