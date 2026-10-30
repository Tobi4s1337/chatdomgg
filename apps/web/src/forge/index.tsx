import {createSignal,For,Show} from 'solid-js';
import type {StyleKey} from '@chatdom/content';
import type {ForgeStatus} from './scene';
import './forge.css';
export function ForgePanel(props:{status:ForgeStatus;submit:(words:string)=>Promise<boolean>;close:()=>void;refit:()=>void;family:(family:StyleKey)=>void}){
  const [words,setWords]=createSignal('!forge a chimney shaped like a sleeping dragon');
  const wishes=['a chimney shaped like a sleeping dragon','a crescent moon lantern','an owl weathervane'];
  async function submit(event:SubmitEvent){event.preventDefault();const request=words();setWords('');await props.submit(request);}
  return <section class="forge-panel" aria-label="The Forge">
    <div class="forge-panel-top"><span class="forge-eyebrow">THE FORGE · SIMULATED</span><button disabled={props.status.busy} onClick={props.close} aria-label="Leave the Forge">×</button></div>
    <h2>{props.status.title}</h2><p class="forge-message" role="status">{props.status.message}</p>
    <Show when={!props.status.busy} fallback={<div class="forge-ritual-caption"><span>✦</span> A wish is becoming part of the kingdom.</div>}>
      <form onSubmit={submit}><label for="forge-wish">Your words</label><textarea id="forge-wish" value={words()} onInput={e=>setWords(e.currentTarget.value)} maxlength="240" rows="2" placeholder="!forge a crescent moon lantern"/><button class="forge-submit" type="submit" disabled={!words().trim()}>Set the words on the anvil <span>✦</span></button></form>
      <div class="forge-wishes"><For each={wishes}>{(wish,i)=><button onClick={()=>setWords(`!forge ${wish}`)}>{['Dragon chimney','Moon lantern','Owl vane'][i()]}</button>}</For></div>
      <label class="forge-kit">Visit another kingdom<select value={props.status.family} onChange={e=>props.family(e.currentTarget.value as StyleKey)}><option value="hearth">Emberwick · Hearth</option><option value="tide">Willowmere · Tide</option><option value="grove">Mossmere · Grove</option></select></label>
    </Show>
    <Show when={props.status.privateError}><p class="forge-private">Only you · {props.status.privateError}</p></Show>
    <Show when={props.status.kept&&!props.status.busy}><button onClick={props.refit}>Return a kept piece · {props.status.kept}</button></Show>
    <Show when={props.status.plaque&&!props.status.busy}><p class="forge-origin">{props.status.plaque}</p></Show>
    <Show when={props.status.maker}><p class="forge-origin">{props.status.maker}</p></Show>
    <p class="forge-footnote">{props.status.runtime==='fixture'?'Presentation fixture · authored wishes. Judges and Codex simulated.':'Your words → the smith → a piece in this kingdom’s style.'}<br/>Development citizen · no coal spent.</p>
  </section>;
}
