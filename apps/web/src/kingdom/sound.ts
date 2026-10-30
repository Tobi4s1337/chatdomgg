/** Original procedural instruments. No samples or third-party recordings. */
export function createKingdomSound() {
  let context:AudioContext|undefined, master:GainNode|undefined, variation=0, enabled=false;
  function unlock(){
    context??=new AudioContext();
    if(!master){master=context.createGain();master.gain.value=.16;const limiter=context.createDynamicsCompressor();limiter.threshold.value=-18;limiter.knee.value=12;limiter.ratio.value=8;master.connect(limiter);limiter.connect(context.destination);}
    master.gain.setTargetAtTime(.16,context.currentTime,.03);void context.resume();enabled=true;
  }
  function note(frequency:number,delay:number,duration:number,volume:number,type:OscillatorType='sine'){
    if(!enabled||!context||!master)return;
    const t=context.currentTime+delay,osc=context.createOscillator(),gain=context.createGain();
    osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(volume,t+.018);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);osc.connect(gain);gain.connect(master);osc.start(t);osc.stop(t+duration+.03);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  return {unlock,output:()=>enabled&&context&&master?{context,master}:null,get enabled(){return enabled;},toggle(){if(enabled){enabled=false;master?.gain.setTargetAtTime(0,context!.currentTime,.03);return false;}unlock();return true;},
    cue(kind:'wood'|'light'|'wave'|'beacon') {
      const shift=[1,1.015,.985,1.008][variation++%4]!;
      if(kind==='wood'){note(180*shift,0,.07,.28,'triangle');note(360*shift,.008,.04,.08);}
      if(kind==='light'){note(523.25*shift,0,1.6,.22);note(1046.5*shift,.04,.7,.06);}
      if(kind==='wave')for(let i=0;i<6;i++)note([261.63,329.63,392,523.25,659.25,784][i]!*shift,i*.13,2,.1);
      if(kind==='beacon'){for(const f of [130.81,196,261.63,329.63,392])note(f*shift,0,4,.10,'triangle');note(1046.5,.2,3,.05);}
    },dispose(){void context?.close();context=undefined;master=undefined;}};
}
