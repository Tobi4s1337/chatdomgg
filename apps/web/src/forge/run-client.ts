import {ForgeRunEventSchema,type ForgeRunRequest,type ForgeRunEvent} from '@chatdom/shared';
export class ForgeRunStopped extends Error{constructor(readonly outcome:'cold'|'hold'|'refuse',message:string){super(message);this.name='ForgeRunStopped';}}
/** A private response stream; only approved plans cross into the public ritual. */
export async function requestForgeRun(input:ForgeRunRequest,onStage:(stage:string)=>void,signal:AbortSignal){
 const response=await fetch('/forge-data/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal});
 if(!response.ok||!response.body)throw new Error(response.status===429?'The anvil is occupied. Give the smith a moment.':'The forge is cold tonight. Please try another night.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',terminal:Extract<ForgeRunEvent,{type:'approved'}>|null=null;
 try{while(true){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});if(pending.length>32768)throw new Error('The forge could not finish this wish.');
  let boundary;while((boundary=pending.indexOf('\n'))>=0){const line=pending.slice(0,boundary);pending=pending.slice(boundary+1);if(!line.trim())continue;const event=ForgeRunEventSchema.parse(JSON.parse(line));
   if(event.type==='stage')onStage(event.stage);else if(event.type==='stopped')throw new ForgeRunStopped(event.outcome,event.message);else terminal=event;
  }if(done)break;
 }if(!terminal)throw new Error('The smith is keeping this wish safe until the connection returns.');return terminal;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
