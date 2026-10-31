import {createSignal,For,Show} from 'solid-js';
import type {StyleKey} from '@chatdom/content';
import {CrestChoice,ParchmentField,type CrestOption} from '@chatdom/ui';
import '@chatdom/ui/kit.css';
import type {ForgeStatus} from './scene';
import './forge.css';

const REALMS=[
  {value:'hearth',name:'Emberwick',note:'Hearth',crest:'hearth'},
  {value:'tide',name:'Willowmere',note:'Tide',crest:'tide'},
  {value:'grove',name:'Mossmere',note:'Grove',crest:'grove'},
] as const satisfies readonly CrestOption<StyleKey>[];
const WISHES=[['Dragon chimney','a chimney shaped like a sleeping dragon'],['Moon lantern','a crescent moon lantern'],['Owl vane','an owl weathervane']] as const;
const MAX_WORDS=240;
const realmName=(family:StyleKey)=>REALMS.find(realm=>realm.value===family)?.name??'this kingdom';

/** The Forge panel: carved wood, a parchment slip for the words and crest seals for the realms. Presentation only. */
export function ForgePanel(props:{status:ForgeStatus;submit:(words:string)=>Promise<boolean>;close:()=>void;refit:()=>void;family:(family:StyleKey)=>void;cue?:(cue:'wood')=>void}){
  const [words,setWords]=createSignal('!forge a chimney shaped like a sleeping dragon');
  // A failed attempt hands the words back with its private reason, so nothing typed is lost.
  const [returned,setReturned]=createSignal(false),[travelling,setTravelling]=createSignal<StyleKey|null>(null);
  async function submit(event:SubmitEvent){
    event.preventDefault();const request=words();setWords('');setReturned(false);
    const accepted=await props.submit(request);
    if(!accepted&&!words()){setWords(request);setReturned(true);}
  }
  const fieldError=()=>returned()&&props.status.privateError?props.status.privateError:undefined;
  return <section class="forge-panel cd-plate cd-kit" aria-label="The Forge" style={{display:props.status.phase==='refusal'?'none':undefined}}>
    <header class="forge-panel-top">
      <div><p class="forge-eyebrow">The Forge</p><h2>{props.status.title}</h2></div>
      <button class="forge-close" disabled={props.status.busy} onClick={props.close} aria-label="Leave the Forge"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg></button>
    </header>
    <p class="forge-message" role="status">{props.status.message}</p>
    <Show when={!props.status.busy} fallback={<div class="forge-ritual-caption"><span>✦</span> A wish is becoming part of the kingdom.</div>}>
      <form class="forge-form" onSubmit={submit}>
        <ParchmentField id="forge-wish" label="Your words" value={words()} max={MAX_WORDS} rows={2} placeholder="!forge a crescent moon lantern"
          invalid={fieldError()} invalidTag="Only you" onInput={value=>{setWords(value);setReturned(false);}}/>
        <button class="forge-submit" type="submit" disabled={!words().trim()} aria-describedby={words().trim()?undefined:'forge-submit-why'}>Set the words on the anvil <span aria-hidden="true">✦</span></button>
        <Show when={!words().trim()}><p class="forge-why" id="forge-submit-why">Write a wish first.</p></Show>
      </form>
      <div class="forge-wishes" role="group" aria-labelledby="forge-wishes-label"><span class="forge-wishes-label" id="forge-wishes-label">Try</span><For each={WISHES}>{([name,wish])=><button type="button" onClick={()=>{setWords(`!forge ${wish}`);setReturned(false);}}>{name}</button>}</For></div>
      <CrestChoice class="forge-realms" label="Visit another kingdom" value={travelling()??props.status.family} options={REALMS}
        disabled={!!travelling()} disabledReason={`Taking the road to ${realmName(travelling()??props.status.family)}…`}
        hint={`You are in ${realmName(props.status.family)}.`} onCue={cue=>props.cue?.(cue)}
        onChange={value=>{setTravelling(()=>value);props.family(value);}}/>
    </Show>
    <Show when={props.status.privateError&&!fieldError()}><p class="forge-private"><b>Only you</b> {props.status.privateError}</p></Show>
    <Show when={props.status.kept&&!props.status.busy}><button class="forge-kept" type="button" onClick={props.refit}>Return a kept piece · {props.status.kept}</button></Show>
    <Show when={props.status.plaque&&!props.status.busy}><p class="forge-origin">{props.status.plaque}</p></Show>
    <Show when={props.status.maker}><p class="forge-origin">{props.status.maker}</p></Show>
    <p class="forge-footnote"><Show when={props.status.runtime==='fixture'}><span>Authored wishes · checks simulated</span></Show><span>Practice Forge · your coals are untouched</span></p>
  </section>;
}
