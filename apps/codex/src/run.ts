import {randomUUID,createHash} from 'node:crypto';
import {ForgeDraftSchema,ForgeRunRequestSchema,type ForgeRunEvent,type ForgeRunRequest,type ForgeDraft} from '@chatdom/shared';
import {assembleForge,checkForge,findForgeSockets,forgeStyleKit,homeFingerprint} from '@chatdom/forge';
import {renderForgeContactSheet} from './contact-sheet';
import type {ForgeProviders,JudgeVerdict} from './providers';
export interface ForgeRunRecord {id:string;at:number;request:ForgeRunRequest;draft?:ForgeDraft;verdicts:JudgeVerdict[];outcome:string}
/** Supplied by trusted server identity, never by a browser or model plan. */
export interface ForgeRunContext { readonly safetyIdentifier: string }
/** The orchestrator owns both gates. A draft cannot approve itself or reach a public sink. */
export async function runForge(input:unknown,providers:ForgeProviders,emit:(event:ForgeRunEvent)=>void,record:(value:ForgeRunRecord)=>Promise<void>,signal?:AbortSignal,context?:ForgeRunContext){
 const request=ForgeRunRequestSchema.parse(input),id=`forge-${randomUUID()}`,verdicts:JudgeVerdict[]=[];
 const entry:ForgeRunRecord={id,at:Date.now(),request,verdicts,outcome:'running'};
 const safetyIdentifier=context?.safetyIdentifier??createHash('sha256').update('chatdom-local-development-citizen').digest('hex');
 if(!/^[a-zA-Z0-9_-]{16,128}$/.test(safetyIdentifier))throw new Error('Invalid trusted Forge identity.');
 const abort=()=>signal?.throwIfAborted();
 const stop=async(outcome:'hold'|'refuse'|'cold',message:string)=>{entry.outcome=outcome;await record(entry);emit({type:'stopped',outcome,message});};
 try{
  abort();emit({type:'stage',stage:'judging-words'});
  const words=await providers.judgeWords({words:request.words,safetyIdentifier,...(signal?{signal}:{})});verdicts.push(words);abort();
  if(words.outcome!=='pass'){await stop(words.outcome,words.reason);return;}
  const sockets=findForgeSockets(request.home,request.hostProfile);if(!sockets.length){await stop('hold','Your home needs a clear place for a new part.');return;}
  let feedback:string|undefined;
  for(let attempt=0;attempt<2;attempt++){
   emit({type:'stage',stage:'drafting'});
   const draft=ForgeDraftSchema.parse(await providers.draft({words:request.words,family:request.family,availableSockets:sockets,...(feedback?{feedback}:{}),...(signal?{signal}:{})}));abort();entry.draft=draft;
   emit({type:'stage',stage:'assembling'});
   let sheet:string;
   try{
    const socket=sockets.find(s=>s.kind===draft.plan.kind);if(!socket)throw new Error('This house has no clear socket for that kind of part.');
    const result=assembleForge(draft.plan,forgeStyleKit(request.family),socket);checkForge(result,request.home,request.hostProfile);
    sheet=renderForgeContactSheet(result.blueprint);
   }catch(error){abort();feedback=error instanceof Error?error.message:'The part could not be assembled.';if(attempt===1){await stop('hold','The smith needs another night to find a good fit.');return;}continue;}
   abort();emit({type:'stage',stage:'judging-piece'});
   const judged=await providers.judgeResult({draft,wish:request.words,contactSheet:sheet,safetyIdentifier,...(signal?{signal}:{})});verdicts.push(judged);abort();
   if(judged.outcome!=='pass'){await stop(judged.outcome,judged.reason);return;}
   entry.outcome='approved';await record(entry);abort();
   emit({type:'approved',runId:id,draft,hostFingerprint:homeFingerprint(request.home)});return;
  }
 }catch(error){if(signal?.aborted)throw error;await stop('cold','The forge is cold tonight. Your wish and your home are safe.');}
}
