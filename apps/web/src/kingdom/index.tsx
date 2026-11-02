import { createDockConnection } from '../stream/dock-connection';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createKingdomScene, type CameraName, type NameLabel, type PotentialKingdomView } from './scene';
import type { RealmFoundedScene } from '@chatdom/world';
import type { GrowthSceneFeed, PresenceFeed } from '@chatdom/shared';
import type { RealmWalkerFeed } from '@chatdom/shared/realm';
import type { RealmChatFeed } from '../realm/adapters/chat';
import { realmEntryFailureMessage } from '../realm/adapters/entry';
import type { RealmForgeFeed } from '../realm/adapters/forge-feed';
import type { KingdomWalkBinding, WalkerLabel } from './walk-scene';
import type { SpeechLabel } from './citizen-scene';
import { BuildTools } from '../build';
import type { KingdomBuildSession } from './build-scene';
import './kingdom.css';
import { ForgePanel } from '../forge';
import type { ForgeStatus } from '../forge/scene';
import { parseKingdomPresentationParams } from '../stream/params';
import { ProvenanceSeal, provenanceFromSource } from '@chatdom/ui';
import '@chatdom/ui/kit.css';
import { isEditableTarget, isKeyboardControl } from '../walk';
import type { ScreenCaption, TwitchMomentFeed } from '../twitch-moments';
import './moment-captions.css';
import { PeopleLabels, peopleFromLabels, measureReservedElements } from '../walk/labels/index';
import { openDurableChronicle } from '../chronicle/native-overlay';

/** Wiring supplies checked geometry and public presence; the ordinary stream view remains a spectator. */
export default function Kingdom(props:{potential?:PotentialKingdomView;founded?:RealmFoundedScene;growthFeed?:GrowthSceneFeed;presenceFeed?:PresenceFeed;chatFeed?:RealmChatFeed;forgeFeed?:RealmForgeFeed;momentFeed?:TwitchMomentFeed;walkerFeed?:RealmWalkerFeed;walk?:KingdomWalkBinding;kingdomName?:string}={}) {
  const query=new URLSearchParams(location.search),tier=props.founded?.plan.config.tier??props.potential?.plan.config.tier??(query.get('tier')==='hamlet'?'hamlet':'town');
  const presentation=parseKingdomPresentationParams(query,tier);
  const realm=query.get('realm'),realmFamily=props.potential?.style??(realm==='hearth'?'hearth':realm==='grove'?'grove':'tide'),realmName=props.kingdomName??(realm==='hearth'?'Emberwick':realm==='grove'?'Mossmere':'Willowmere');
  const rawHour=Number(query.get('hour')??19.5),rawTime=Number(query.get('time'));
  const initialHour=Number.isFinite(rawHour)?((rawHour%24)+24)%24:19.5,initialTime=query.has('time')&&Number.isFinite(rawTime)?Math.max(0,Math.min(3600,rawTime)):null;
  const [ready,setReady]=createSignal(false),[progress,setProgress]=createSignal(0),[phase,setPhase]=createSignal('Unfolding the valley');
  const [names,setNames]=createSignal<NameLabel[]>([]),[speech,setSpeech]=createSignal<SpeechLabel[]>([]),[hour,setHour]=createSignal(initialHour),[view,setView]=createSignal<CameraName>(query.get('camera')==='citizen'?'citizen':query.get('camera')==='window'?'window':'hero');
  const [walkers,setWalkers]=createSignal<readonly WalkerLabel[]>([]),[walking,setWalking]=createSignal(false);
  const [momentCaptions,setMomentCaptions]=createSignal<readonly ScreenCaption[]>([]);
  let host!:HTMLDivElement, peopleLabelsRoot:HTMLElement|null=null;
  const peopleHud=()=>peopleLabelsRoot?measureReservedElements(peopleLabelsRoot,[...host.querySelectorAll('.kingdom-heading,.kingdom-seal,.kingdom-controls,.walk-look,.walk-stick,.walk-jump,.walk-gestures-trigger,.walk-gestures-panel:not([hidden]),.kingdom-moment-caption')]):[];
  const [source,setSource]=createSignal(props.presenceFeed?.label??(query.get('source')==='herald'?'CONNECTING':'SIMULATED')),[error,setError]=createSignal<string|null>(null),[sound,setSound]=createSignal(false);
  const stream=location.pathname.endsWith('/stream')||location.pathname==='/stream';
  let canvas!:HTMLCanvasElement,engine:Awaited<ReturnType<typeof createKingdomScene>>|undefined,unmounted=false,openingFrame=0;
  const [buildSession,setBuildSession]=createSignal<KingdomBuildSession|null>(null),[housewarming,setHousewarming]=createSignal<string|null>(null);
  const construction=new AbortController();
  const dock=props.founded?.origin==='live'?createDockConnection(props.founded.kingdomId):undefined;
  let unsubscribeChat:(()=>void)|undefined;
  const [forgeStatus,setForgeStatus]=createSignal<ForgeStatus|null>(null);
  const [anvilVisit,setAnvilVisit]=createSignal<{leave:()=>void}|null>(null);
  let chronicle:ReturnType<typeof openDurableChronicle>|undefined;
  const openChronicle=()=>{if(!props.founded||!engine||chronicle)return;chronicle=openDurableChronicle({kingdomId:props.founded.kingdomId,liveEngine:engine,onClose:()=>{chronicle=undefined;}});};
  const unlockSound=()=>{
    const instance=engine;
    if(instance)void instance.sound.unlock().then(()=>{if(!unmounted&&engine===instance)setSound(instance.sound.enabled);});
  };
  const unlockWithWalk=(event:KeyboardEvent)=>{
    if(!event.isTrusted||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||isEditableTarget(event.target))return;
    const letters=['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'];
    const movement=letters.includes(event.code)||['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code);
    if((event.code==='KeyE'||movement)&&engine?.walkDebug()?.owner==='walking'
      &&(letters.includes(event.code)||!isKeyboardControl(event.target)))unlockSound();
  };
  /** Local practice on this screen (Forge, a simulated home build, its housewarming) is its own fact beside the feed. */
  const practice=()=>!!forgeStatus()?.open||buildSession()?.controller.snapshot().mode==='SIMULATED'||!!housewarming();
  async function attachWalk(binding:KingdomWalkBinding){
    if(!engine||unmounted)return;
    await engine.attachWalk({...binding,hud:host,play:{live:()=>source()==='LIVE CHAT',hour:()=>hour(),kingdomName:props.kingdomName??'',...binding.play},interactionPlaces:binding.interactionPlaces??{
      open(accepted,closed){
        if(accepted.action!=='forge')return null;
        setAnvilVisit({leave:closed});
        return {close(){setAnvilVisit(null);}};
      },
    },onSceneNeeded:()=>{
      setReady(false);setPhase('The street is finding its new shape');
      window.__chatdomReady=false;binding.onSceneNeeded?.();
    }});
    if(unmounted)return;
    const debug=engine.walkDebug();if(debug)window.__chatdomWalk=debug;
    setWalking(engine.walkSelected());
  }
  onMount(()=>{
    document.addEventListener('keydown',unlockWithWalk);
    const testWindow=window as Window & {__chatdomReady?:boolean;__chatdomKingdom?:unknown};
    testWindow.__chatdomReady=false;
    document.body.classList.add('kingdom-page');
    void createKingdomScene(canvas,{...(dock?{dockFeed:dock}:{}),...(props.potential?{potential:props.potential,nativeStyle:props.potential.style}:{}),...(props.founded?{founded:props.founded}:{}),...(props.presenceFeed?{presenceFeed:props.presenceFeed}:{}),...(props.growthFeed?{growthFeed:props.growthFeed}:{}),...(props.forgeFeed?{forgeFeed:props.forgeFeed}:{}),...(props.momentFeed?{momentFeed:props.momentFeed}:{}),...(props.walkerFeed?{walkerFeed:props.walkerFeed}:{}),onWalkers:setWalkers,signal:construction.signal,tier,...presentation,seed:props.potential?.plan.config.seed??query.get('seed')??realmName.toLowerCase(),realmName,forgeFamily:realmFamily,...(!props.potential&&(realm==='hearth'||realm==='grove')?{nativeStyle:realmFamily}:{}),hour:initialHour,time:initialTime,camera:view(),source:query.get('source')==='herald'?'herald':'simulated',presenceOrigin:query.get('presenceOrigin')==='simulated'?'simulated':'live',
      onForge:setForgeStatus,onReady:()=>{if(!unmounted&&!error()){testWindow.__chatdomReady=true;setReady(true);}},onProgress:(text,fraction)=>{setPhase(text);setProgress(fraction);},onNames:setNames,onSpeech:setSpeech,onMomentCaptions:setMomentCaptions,onBuild:setBuildSession,onHousewarming:setHousewarming,onSource:setSource,onError:message=>{setError(message||'The kingdom renderer did not give a reason.');setReady(false);(window as Window & {__chatdomReady?:boolean}).__chatdomReady=false;},
    }).then(instance=>{
      if(unmounted){instance.dispose();return;}engine=instance;
      // OBS may allow autoplay; a browser that requires a gesture stays honestly locked until the retry.
      if(stream)unlockSound();
      unsubscribeChat=props.chatFeed?.subscribe(message=>{
        if(unmounted)return;
        if(message.type==='chat')instance.receiveChat(message.cue);
        else if(message.type==='chat.remove')instance.clearChat(message.cueIds);
        else {instance.clearChat();setSpeech([]);}
      });
      testWindow.__chatdomKingdom={attachWalk,detachWalk:()=>{instance.detachWalk();delete window.__chatdomWalk;setWalking(false);},walkDebug:instance.walkDebug,interactionDebug:instance.interactionDebug,stats:instance.debug,build:instance.build,forge:instance.forge,inspect:()=>instance.inspect(),subject:()=>instance.subject(),pose:instance.pose,seek:(time:number,camera?:CameraName)=>instance.seek(time,camera),hour:(value:number)=>{instance.setHour(value);setHour(value);},play:()=>instance.play(),capture:(time:number)=>instance.capture(time)};
      const showReady=()=>{
        if(unmounted||error())return;
        if(!instance.debug.ready){openingFrame=requestAnimationFrame(showReady);return;}
        setReady(true);testWindow.__chatdomReady=true;
      };
      openingFrame=requestAnimationFrame(showReady);
      if(query.get('chronicle')==='1')openChronicle();
      if(props.walk)void attachWalk(props.walk).catch(cause=>{if(unmounted)return;setError(`Could not start walking: ${realmEntryFailureMessage(cause)}`);setReady(false);window.__chatdomReady=false;});
      if(!props.founded&&!props.potential&&query.get('build')==='1')void instance.build.enter();
      if(!props.founded&&!props.potential&&query.get('forge')==='1')instance.forge.open();
    }).catch(cause=>{console.error('Kingdom construction failed',cause);if(!unmounted)setError(`Could not draw the kingdom: ${realmEntryFailureMessage(cause)}`);});
  });
  onCleanup(()=>{unmounted=true;chronicle?.close();document.removeEventListener('keydown',unlockWithWalk);cancelAnimationFrame(openingFrame);construction.abort();dock?.dispose();unsubscribeChat?.();unsubscribeChat=undefined;engine?.dispose();delete window.__chatdomWalk;(window as Window & {__chatdomReady?:boolean}).__chatdomReady=false;document.body.classList.remove('kingdom-page');});
  function tap(action:()=>void){if(!engine)return;if(!sound())unlockSound();action();}
  function chooseHour(value:number){setHour(value);tap(()=>engine!.setHour(value));}
  function chooseView(value:CameraName){setWalking(false);setView(value);tap(()=>engine!.setCamera(value));}
  function chooseWalking(){
    if(engine?.walkDebug()){tap(()=>engine!.selectWalk(true));setWalking(true);return;}
    const destination=new URLSearchParams(location.search);
    destination.set('walk','1');destination.set('hour',String(hour()));
    // The existing simulated town enters its explicitly labelled room. A Herald/live view must use real entry.
    const simulated=!props.founded&&query.get('source')!=='herald'&&query.get('source')!=='realm';
    destination.set('source',simulated?'simulated':'realm');
    for(const parameter of ['camera','build','forge'])destination.delete(parameter);
    location.assign(`${location.pathname}?${destination}`);
  }
  return <div ref={element=>{host=element;}} onPointerDown={event=>{
    // The sound button owns its toggle; an earlier root unlock would turn its first click into a mute.
    if(event.isTrusted&&!(event.target instanceof Element&&event.target.closest('.sound-button')))unlockSound();
  }}
    class={`kingdom ${walking()?'kingdom-walking':''} ${stream?'kingdom-stream':''}`} data-chatdom-kingdom data-forge-phase={forgeStatus()?.phase} data-chatdom-build={buildSession()?true:undefined}>
    <canvas ref={element=>{canvas=element;}} class="kingdom-canvas" aria-label={`${realmName}, a voxel kingdom lit by its people`} />
    <div class="kingdom-vignette" aria-hidden="true" />
    <header class="kingdom-heading">
      <svg class="realm-mark" viewBox="0 0 48 60" aria-hidden="true"><path d="M8 20h8v-6h6v6h4v-6h6v6h8v25L24 55 8 45Z"/><path d="M18 39V28h12v11m-6-26c-7-5-4-10 0-13 0 6 7 7 0 13Z"/><path d="M5 10h4m30 0h4M24 58v2"/></svg>
      <div><p class="kingdom-eyebrow">A home for your chat · <a href="/showcase" style={{color:"inherit"}}>Explore Chatdom</a></p><h1>{realmName}</h1><p class="kingdom-subtitle">{props.potential?`${props.potential.size} · A home for this chat`:tier==='hamlet'?'A little kingdom. Every light matters.':'Old streets. Familiar names. A light for everyone.'}</p></div>
    </header>
    <ProvenanceSeal class="source-ribbon kingdom-seal" state={provenanceFromSource(source())} simulated={!!props.potential||practice()} />
    <div class="window-names" aria-live="polite"><For each={names()}>{label=><div class="window-name" style={{left:`${label.x}px`,top:`${label.y}px`}}><span class="name-diamond" />{label.name}<small>home again</small></div>}</For></div>
    <PeopleLabels people={peopleFromLabels(walkers(),speech())} reserved={peopleHud()} onRoot={root=>{peopleLabelsRoot=root;}} />
    <div class="kingdom-moment-captions"><For each={momentCaptions()}>{caption=><div class="kingdom-moment-caption" style={{left:`${caption.x}px`,top:`${caption.y}px`,opacity:caption.opacity}}><strong>{caption.title}</strong><p>{caption.line}</p><Show when={caption.detail}><small>{caption.detail}</small></Show></div>}</For></div>
    <Show when={!ready()||error()}><div class="kingdom-gate" role="status">
      <svg viewBox="0 0 80 80" aria-hidden="true"><path d="M17 70V25l12-12h22l12 12v45M26 70V31a14 14 0 0 1 28 0v39M12 70h56M31 13V7h6v6m6 0V7h6v6"/></svg>
      <h2>{error()?'The road needs a moment.':phase()}</h2>
      <p>{error()??'A place is waiting for you.'}</p>
      <Show when={!error()} fallback={<button onClick={()=>location.reload()}>Try the gate again</button>}><div class="gate-progress"><i style={{width:`${Math.round(progress()*100)}%`}} /></div></Show>
    </div></Show>
    <Show when={!stream&&forgeStatus()?.open}><ForgePanel status={forgeStatus()!} submit={words=>engine!.forge.submit(words)} close={()=>engine?.forge.close()} refit={()=>{void engine?.forge.refit();}} family={value=>{location.href=`/?tier=${tier}&hour=${hour()}&forge=1&realm=${value}`;}} /></Show>
    <Show when={!stream&&anvilVisit()}>{visit=><section class="forge-panel" role="dialog" aria-label="At the anvil">
      <div class="forge-panel-top"><span class="forge-eyebrow">THE FORGE</span><button onClick={()=>visit().leave()} aria-label="Leave the anvil">×</button></div>
      <h2>Give the smith a wish.</h2>
      <p class="forge-message">Write <code>!forge a chimney shaped like a sleeping dragon</code> in Twitch chat. When the fire is awake and you have a coal, your words can become part of your home.</p>
      <p class="forge-footnote">The anvil listens to chat. Escape returns you to the street.</p>
      <button class="forge-submit" onClick={()=>visit().leave()}>Back to the street</button>
    </section>}</Show>
    <Show when={!stream&&buildSession()}>{session=><BuildTools controller={session().controller} {...(props.walk?.client.room.state.walkers.get(props.walk.client.selfId)?.name?{ownerName:props.walk.client.room.state.walkers.get(props.walk.client.selfId)!.name}:{})} imports={session().imports}/>}</Show>
    <Show when={housewarming()}>{name=><div class="housewarming-name">{name()}’s home<small>Welcome to the street</small></div>}</Show>
    <Show when={ready()&&walking()&&!error()&&!stream}><button class="walk-overlook" onClick={()=>chooseView('hero')}>Above the streets</button></Show>
    <Show when={ready()&&props.founded&&!error()&&!stream}><button class="kingdom-chronicle-button" onClick={openChronicle}>The Chronicle</button></Show>
    <Show when={ready()&&!props.potential&&!walking()&&!error()&&!stream&&!buildSession()&&!forgeStatus()?.open}><nav class="kingdom-controls" aria-label="Kingdom view">
      <div class="time-controls" aria-label="Time of day"><button classList={{selected:hour()<16}} onClick={()=>chooseHour(12)}>Noon</button><button classList={{selected:hour()>=16&&hour()<22}} onClick={()=>chooseHour(19.5)}>Dusk</button><button classList={{selected:hour()>=22}} onClick={()=>chooseHour(23)}>Night</button></div>
      <span class="control-divider" />
      <Show when={source()==='SIMULATED'&&!props.presenceFeed&&query.get('source')!=='herald'}><button class="arrival-button" onClick={()=>{setView('hero');tap(()=>engine!.play());setWalking(false);}}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 8 6-8 6Zm-4 0v12"/></svg>Let them in</button></Show>
      <button class="window-button" onClick={()=>chooseView(view()==='window'?'hero':'window')}>{view()==='window'?'The whole kingdom':'At the window'}</button>
      <button class="window-button" onClick={chooseWalking}>Walk the street</button>
      <Show when={source()==='SIMULATED'&&!props.founded}><button onClick={()=>tap(()=>{void engine!.build.enter();})}>Build my home</button><button onClick={()=>tap(()=>engine!.forge.open())}>At the Forge</button></Show>
      <span class="control-divider" />
      <a class="tier-button" onClick={()=>tap(()=>engine!.sound.cue('wood'))} href={`?tier=${tier==='hamlet'?'town':'hamlet'}&hour=${hour()}&time=30`}>{tier==='hamlet'?'Visit the town':'Visit the hamlet'}</a>
      <button class="sound-button" aria-label={sound()?'Mute sound':'Turn sound on'} aria-pressed={sound()} onClick={()=>{if(engine){const requested=engine.sound.toggle();setSound(engine.sound.enabled);if(requested)unlockSound();}}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/><Show when={sound()} fallback={<path d="m17 9 5 6m0-6-5 6"/>}><path d="M17 8q5 4 0 8m3-11q8 7 0 14"/></Show></svg></button>
    </nav><p class="kingdom-caption">{source()==='SIMULATED'?'Every warm window is someone home':'Windows follow the people in chat'}</p></Show>
    <Show when={ready()&&stream}><div class="stream-signature">{realmName} <span>·</span> a kingdom lit by its people</div></Show>
  </div>;
}
