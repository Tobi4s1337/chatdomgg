import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createKingdomScene, type CameraName, type NameLabel } from './scene';
import type { SpeechLabel } from './citizen-scene';
import { BuildTools } from '../build';
import type { KingdomBuildSession } from './build-scene';
import './kingdom.css';
import { ForgePanel } from '../forge';
import type { ForgeStatus } from '../forge/scene';
import { parseKingdomPresentationParams } from '../stream/params';

export default function Kingdom() {
  const query=new URLSearchParams(location.search),tier=query.get('tier')==='hamlet'?'hamlet':'town';
  const presentation=parseKingdomPresentationParams(query,tier);
  const realm=query.get('realm'),realmFamily=realm==='hearth'?'hearth':realm==='grove'?'grove':'tide',realmName=realm==='hearth'?'Emberwick':realm==='grove'?'Mossmere':'Willowmere';
  const rawHour=Number(query.get('hour')??19.5),rawTime=Number(query.get('time'));
  const initialHour=Number.isFinite(rawHour)?((rawHour%24)+24)%24:19.5,initialTime=query.has('time')&&Number.isFinite(rawTime)?Math.max(0,Math.min(3600,rawTime)):null;
  const [ready,setReady]=createSignal(false),[progress,setProgress]=createSignal(0),[phase,setPhase]=createSignal('Unfolding the valley');
  const [names,setNames]=createSignal<NameLabel[]>([]),[speech,setSpeech]=createSignal<SpeechLabel[]>([]),[hour,setHour]=createSignal(initialHour),[view,setView]=createSignal<CameraName>(query.get('camera')==='citizen'?'citizen':query.get('camera')==='window'?'window':'hero');
  const [source,setSource]=createSignal(query.get('source')==='herald'?'CONNECTING':'SIMULATED'),[error,setError]=createSignal(false),[sound,setSound]=createSignal(false);
  const stream=location.pathname.endsWith('/stream')||location.pathname==='/stream';
  let canvas!:HTMLCanvasElement,engine:Awaited<ReturnType<typeof createKingdomScene>>|undefined,unmounted=false,openingFrame=0;
  const [buildSession,setBuildSession]=createSignal<KingdomBuildSession|null>(null),[housewarming,setHousewarming]=createSignal<string|null>(null);
  const construction=new AbortController();
  const [forgeStatus,setForgeStatus]=createSignal<ForgeStatus|null>(null);
  onMount(()=>{
    const testWindow=window as Window & {__chatdomReady?:boolean;__chatdomKingdom?:unknown};
    testWindow.__chatdomReady=false;
    document.body.classList.add('kingdom-page');
    void createKingdomScene(canvas,{signal:construction.signal,tier,...presentation,seed:query.get('seed')??realmName.toLowerCase(),realmName,forgeFamily:realmFamily,...(realm==='hearth'||realm==='grove'?{nativeStyle:realmFamily}:{}),hour:initialHour,time:initialTime,camera:view(),source:query.get('source')==='herald'?'herald':'simulated',presenceOrigin:query.get('presenceOrigin')==='simulated'?'simulated':'live',
      onForge:setForgeStatus,onReady:()=>{if(!unmounted&&!error()){testWindow.__chatdomReady=true;setReady(true);}},onProgress:(text,fraction)=>{setPhase(text);setProgress(fraction);},onNames:setNames,onSpeech:setSpeech,onBuild:setBuildSession,onHousewarming:setHousewarming,onSource:setSource,onError:()=>{setError(true);setReady(false);(window as Window & {__chatdomReady?:boolean}).__chatdomReady=false;},
    }).then(instance=>{
      if(unmounted){instance.dispose();return;}engine=instance;
      testWindow.__chatdomKingdom={stats:instance.debug,build:instance.build,forge:instance.forge,inspect:()=>instance.inspect(),subject:()=>instance.subject(),pose:instance.pose,seek:(time:number,camera?:CameraName)=>instance.seek(time,camera),hour:(value:number)=>{instance.setHour(value);setHour(value);},play:()=>instance.play(),capture:(time:number)=>instance.capture(time)};
      const showReady=()=>{
        if(unmounted||error())return;
        if(!instance.debug.ready){openingFrame=requestAnimationFrame(showReady);return;}
        setReady(true);testWindow.__chatdomReady=true;
      };
      openingFrame=requestAnimationFrame(showReady);
      if(query.get('build')==='1')void instance.build.enter();
      if(query.get('forge')==='1')instance.forge.open();
    }).catch(cause=>{console.error('Kingdom construction failed',cause);if(!unmounted)setError(true);});
  });
  onCleanup(()=>{unmounted=true;cancelAnimationFrame(openingFrame);construction.abort();engine?.dispose();(window as Window & {__chatdomReady?:boolean}).__chatdomReady=false;document.body.classList.remove('kingdom-page');});
  function tap(action:()=>void){if(!engine)return;if(!sound()){void engine.sound.unlock().then(setSound);}action();}
  function chooseHour(value:number){setHour(value);tap(()=>engine!.setHour(value));}
  function chooseView(value:CameraName){setView(value);tap(()=>engine!.setCamera(value));}
  return <div class={`kingdom ${stream?'kingdom-stream':''}`} data-chatdom-kingdom data-forge-phase={forgeStatus()?.phase} data-chatdom-build={buildSession()?true:undefined}>
    <canvas ref={element=>{canvas=element;}} class="kingdom-canvas" aria-label={`${realmName}, a voxel kingdom lit by its people`} />
    <div class="kingdom-vignette" aria-hidden="true" />
    <header class="kingdom-heading">
      <svg class="realm-mark" viewBox="0 0 48 60" aria-hidden="true"><path d="M8 20h8v-6h6v6h4v-6h6v6h8v25L24 55 8 45Z"/><path d="M18 39V28h12v11m-6-26c-7-5-4-10 0-13 0 6 7 7 0 13Z"/><path d="M5 10h4m30 0h4M24 58v2"/></svg>
      <div><p class="kingdom-eyebrow">A home for your chat</p><h1>{realmName}</h1><p class="kingdom-subtitle">{tier==='hamlet'?'A little kingdom. Every light matters.':'Old streets. Familiar names. A light for everyone.'}</p></div>
    </header>
    <div class={`source-ribbon ${source()==='SIMULATED'?'simulation':''}`}><span class="source-pip" />{source()}</div>
    <div class="window-names" aria-live="polite"><For each={names()}>{label=><div class="window-name" style={{left:`${label.x}px`,top:`${label.y}px`}}><span class="name-diamond" />{label.name}<small>home again</small></div>}</For></div>
    <div class="citizen-speech"><For each={speech()}>{label=><div class="citizen-bubble" style={{left:`${label.x}px`,top:`${label.y}px`}}><Show when={label.name}><small>{label.name}</small></Show><p><For each={label.parts}>{part=>part.kind==='text'?part.text:<img src={`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(part.id)}/default/dark/1.0`} alt={part.alt} />}</For></p></div>}</For></div>
    <Show when={!ready()||error()}><div class="kingdom-gate" role="status">
      <svg viewBox="0 0 80 80" aria-hidden="true"><path d="M17 70V25l12-12h22l12 12v45M26 70V31a14 14 0 0 1 28 0v39M12 70h56M31 13V7h6v6m6 0V7h6v6"/></svg>
      <h2>{error()?'The road needs a moment.':phase()}</h2>
      <p>{error()?'The kingdom could not open. Try the gate again.':'A place is waiting for you.'}</p>
      <Show when={!error()} fallback={<button onClick={()=>location.reload()}>Try the gate again</button>}><div class="gate-progress"><i style={{width:`${Math.round(progress()*100)}%`}} /></div></Show>
    </div></Show>
    <Show when={!stream&&forgeStatus()?.open}><ForgePanel status={forgeStatus()!} submit={words=>engine!.forge.submit(words)} close={()=>engine?.forge.close()} refit={()=>{void engine?.forge.refit();}} family={value=>{location.href=`/?tier=${tier}&hour=${hour()}&forge=1&realm=${value}`;}} /></Show>
    <Show when={!stream&&buildSession()}>{session=><BuildTools controller={session().controller} ownerName="Juniper" imports={session().imports}/>}</Show>
    <Show when={housewarming()}>{name=><div class="housewarming-name">{name()}’s home<small>SIMULATED · welcome to the street</small></div>}</Show>
    <Show when={ready()&&!error()&&!stream&&!buildSession()&&!forgeStatus()?.open}><nav class="kingdom-controls" aria-label="Kingdom view">
      <div class="time-controls" aria-label="Time of day"><button classList={{selected:hour()<16}} onClick={()=>chooseHour(12)}>Noon</button><button classList={{selected:hour()>=16&&hour()<22}} onClick={()=>chooseHour(19.5)}>Dusk</button><button classList={{selected:hour()>=22}} onClick={()=>chooseHour(23)}>Night</button></div>
      <span class="control-divider" />
      <Show when={source()==='SIMULATED'&&query.get('source')!=='herald'}><button class="arrival-button" onClick={()=>{setView('hero');tap(()=>engine!.play());}}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 8 6-8 6Zm-4 0v12"/></svg>Let them in</button></Show>
      <button class="window-button" onClick={()=>chooseView(view()==='window'?'hero':'window')}>{view()==='window'?'The whole kingdom':'At the window'}</button>
      <button class="window-button" onClick={()=>chooseView(view()==='citizen'?'hero':'citizen')}>{view()==='citizen'?'Above the streets':'Walk the street'}</button>
      <Show when={source()==='SIMULATED'}><button onClick={()=>tap(()=>{void engine!.build.enter();})}>Build my home</button><button onClick={()=>tap(()=>engine!.forge.open())}>At the Forge</button></Show>
      <span class="control-divider" />
      <a class="tier-button" onClick={()=>tap(()=>engine!.sound.cue('wood'))} href={`?tier=${tier==='hamlet'?'town':'hamlet'}&hour=${hour()}&time=30`}>{tier==='hamlet'?'Visit the town':'Visit the hamlet'}</a>
      <button class="sound-button" aria-label={sound()?'Mute sound':'Turn sound on'} aria-pressed={sound()} onClick={()=>{if(engine)setSound(engine.sound.toggle());}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/><Show when={sound()} fallback={<path d="m17 9 5 6m0-6-5 6"/>}><path d="M17 8q5 4 0 8m3-11q8 7 0 14"/></Show></svg></button>
    </nav><p class="kingdom-caption">{source()==='SIMULATED'?'Every warm window is someone home':'Windows follow the people in chat'}</p></Show>
    <Show when={ready()&&stream}><div class="stream-signature">{realmName} <span>·</span> a kingdom lit by its people</div></Show>
  </div>;
}
