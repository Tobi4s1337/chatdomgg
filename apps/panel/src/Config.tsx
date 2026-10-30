// The streamer's side of the panel. Today no kingdom service can save a choice, hide
// panel moments or review content, so each of those says so plainly. Twitch's role in
// this view never grants a royal act: those stay on the throne.
import { For, onCleanup, onMount } from 'solid-js';
import { connectHelper } from './helper';
import { PanelDefs, Seal } from './ui/art';
import './panel.css';

const SECTIONS = [
  { name: 'The night', detail: 'The picture of your kingdom and tonight’s moments.' },
  { name: 'Your home', detail: 'Each viewer’s own window and home plaque.' },
  { name: 'Crowd acts', detail: 'One tap for the vote or errand chat is already doing.' },
  { name: 'The shelf', detail: 'A small fixed menu of shared moments, where Bits are on.' },
];

export default function Config(props: { live: boolean }) {
  const helper = connectHelper();
  onMount(() => {
    document.documentElement.classList.add('cp-document', 'cp-config-document');
    requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  });
  onCleanup(() => document.documentElement.classList.remove('cp-document', 'cp-config-document'));
  const outside = helper.status().kind === 'absent';
  return <div class="cp cp-config" data-chatdom-panel-config data-live={props.live ? 'true' : 'false'}>
    <PanelDefs />
    <header class="cp-head">
      <Seal blank />
      <div class="cp-title">
        <h1 class="cp-name">{props.live ? 'Tonight' : 'Your panel'}</h1>
        <p class="cp-motto">{outside ? 'Opens on Twitch' : props.live ? 'While you are live' : 'Under your video'}</p>
      </div>
      <span class="cp-tag quiet">Not connected</span>
    </header>
    <main class="cp-config-page">
      {props.live
        ? <section class="cp-sheet">
          <p class="cp-label">Hide panel moments</p>
          <p class="cp-body">Hide pauses every crowd act and the shelf in viewers’ panels at once.</p>
          <p class="cp-unavailable" role="note">Not available yet: the kingdom service that carries Hide to every panel is not connected.</p>
          <p class="cp-label">Viewer content</p>
          <p class="cp-unavailable" role="note">Not available yet: there is nothing to review until the kingdom service is connected.</p>
        </section>
        : <section class="cp-sheet">
          <p class="cp-label">Connect your kingdom</p>
          <p class="cp-body">The panel shows the kingdom your chat lives in. It opens once your channel’s kingdom is founded and connected.</p>
          <p class="cp-unavailable" role="note">Founding from this page is not available yet.</p>
          <p class="cp-label">What viewers see</p>
          <ul class="cp-sections">
            <For each={SECTIONS}>{section => <li><strong>{section.name}</strong><span>{section.detail}</span></li>}</For>
          </ul>
          <p class="cp-unavailable" role="note">Choosing sections needs the kingdom service, which is not connected yet. Nothing here is saved.</p>
        </section>}
    </main>
  </div>;
}
