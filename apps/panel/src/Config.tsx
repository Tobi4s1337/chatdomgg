import { onMount } from 'solid-js';
import './panel.css';
import './window.css';
/** Configuration has no authority until the Configuration Service is connected. No local preview impersonates a save. */
export default function Config(props: { live: boolean }) {
  onMount(() => { document.documentElement.classList.add('cp-document'); void document.fonts.ready.then(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; }); });
  return <div class="cp-frame"><div class="cp cw"><header class="cw-head"><h1>{props.live ? 'Tonight’s panel' : 'Your panel'}</h1></header><main class="cw-main"><section class="cw-gifts"><h2>The kingdom waits</h2><p>Configuration opens when the channel connects.</p></section></main></div></div>;
}
