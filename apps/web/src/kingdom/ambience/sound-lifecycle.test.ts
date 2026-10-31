import { afterEach, expect, it, vi } from 'vitest';
import { createKingdomSound } from '../sound';

const host=vi.hoisted(()=>{
  const state={status:'locked',settings:{muted:false,volume:.65}};
  return {state,phrase:vi.fn(()=>true),settings:vi.fn((next:Partial<typeof state.settings>)=>Object.assign(state.settings,next))};
});
vi.mock('@chatdom/audio',()=>({
  createKingdomAudio:()=>({
    getState:()=>host.state,setSettings:host.settings,
    unlock:async()=>{host.state.status='ready';return true;},dispose:vi.fn(),cue:()=>true,
  }),
  playKingdomPhrase:host.phrase,kingdomAudioHost:()=>null,createForgeAudio:vi.fn(),
}));
afterEach(()=>vi.unstubAllGlobals());

it('opens ambience after unlock, drains the mix on hide, and preserves explicit mute across visibility',async()=>{
  const page=Object.assign(new EventTarget(),{hidden:false});vi.stubGlobal('document',page);
  const sound=createKingdomSound(),target={wind:.2,water:.8,waterPan:-.3};
  try{
    sound.ambienceUpdate(0,target);expect(host.phrase).not.toHaveBeenCalled();
    await sound.unlock();sound.ambienceUpdate(100,target);expect(host.phrase).toHaveBeenCalledTimes(1);
    page.hidden=true;page.dispatchEvent(new Event('visibilitychange'));
    expect(host.settings).toHaveBeenLastCalledWith({muted:true});
    sound.ambienceUpdate(1700,target);expect(host.phrase).toHaveBeenCalledTimes(1);
    page.hidden=false;page.dispatchEvent(new Event('visibilitychange'));
    expect(host.settings).toHaveBeenLastCalledWith({muted:false});
    sound.ambienceUpdate(3300,target);expect(host.phrase).toHaveBeenCalledTimes(2);
    sound.toggle();expect(sound.enabled).toBe(false);
    page.hidden=true;page.dispatchEvent(new Event('visibilitychange'));
    page.hidden=false;page.dispatchEvent(new Event('visibilitychange'));
    expect(host.settings).toHaveBeenLastCalledWith({muted:true});
    sound.ambienceUpdate(5000,target);expect(host.phrase).toHaveBeenCalledTimes(2);
  }finally{sound.dispose();}
  sound.ambienceUpdate(8000,target);expect(host.phrase).toHaveBeenCalledTimes(2);
});
