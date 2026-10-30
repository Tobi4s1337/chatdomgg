import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import type { ForgePhase } from '@chatdom/shared';
/** Original procedural instruments, routed through the kingdom's unlocked master. */
export function playForgeSound(output:{context:BaseAudioContext;master:GainNode}|null,phase:ForgePhase|'refusal',offset=0){
  if(!output)return;const {context,master}=output,t=context.currentTime+offset;
  function tone(f:number,delay:number,length:number,gain:number,type:OscillatorType='sine'){
    const osc=context.createOscillator(),envelope=context.createGain();osc.type=type;osc.frequency.setValueAtTime(f,t+delay);
    envelope.gain.setValueAtTime(0,t+delay);envelope.gain.linearRampToValueAtTime(gain,t+delay+.008);envelope.gain.exponentialRampToValueAtTime(.0001,t+delay+length);osc.connect(envelope);envelope.connect(master);osc.start(t+delay);osc.stop(t+delay+length+.02);osc.onended=()=>{osc.disconnect();envelope.disconnect();};
  }
  if(phase==='words')for(let i=0;i<5;i++)tone([220,293.66,329.63,440,587.33][i]!,i*.19,.7,.09,'triangle');
  if(phase==='blueprint')for(const f of [440,659.25,880])tone(f,0,1.8,.09);
  if(phase==='pour')for(let i=0;i<16;i++)tone(110+(i%5)*27.5,i*.32,.18,.06,'triangle');
  if(phase==='seal'){tone(120,0,.12,.4,'triangle');tone(240,.04,.2,.13);}
  if(phase==='strike'){tone(73.4,0,.35,.9,'triangle');for(const f of [440,1194,2673])tone(f,.01,1.1,.19);}
  if(phase==='cool')for(let i=0;i<6;i++)tone(1046.5/(1+i*.13),i*.3,.5,.055);
  if(phase==='flight')for(let i=0;i<8;i++)tone(261.63*Math.pow(2,i/12),i*.22,.65,.07);
  if(phase==='landed')for(const f of [261.63,329.63,392,523.25])tone(f,0,2.5,.11,'triangle');
  if(phase==='refusal'){tone(92,0,.23,.28,'sawtooth');tone(65,.23,.45,.12,'triangle');}
}

/** Development film audio uses the same instruments and mix, sampled offline rather than a microphone. */
export async function renderForgeRitualAudio():Promise<number[]>{
  const context=new OfflineAudioContext(1,22*48000,48000),master=context.createGain(),limiter=context.createDynamicsCompressor();
  master.gain.value=.16;limiter.threshold.value=-18;limiter.knee.value=12;limiter.ratio.value=8;master.connect(limiter);limiter.connect(context.destination);
  for(const [phase,start] of FORGE_STAGE_TIMING)playForgeSound({context,master},phase,start);
  const rendered=await context.startRendering(),samples=rendered.getChannelData(0),buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const text=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]!))*32767,true);
  return Array.from(new Uint8Array(buffer));
}
