import {describe,it,expect,vi} from 'vitest';
import {createHome} from '@chatdom/content';
import type {ForgeDraft,ForgeRunEvent} from '@chatdom/shared';
import {runForge,type ForgeRunRecord} from './run';
import type {ForgeProviders} from './providers';
const home=createHome('house','hearth',0),request={words:'A chimney for a little dragon who fell asleep guarding my home',family:'hearth',home};
const draft:ForgeDraft={plan:{version:2,kind:'chimney',motif:'sleeping-dragon',finish:'native',accent:'none'},title:'The sleepy keeper',plaque:'A quiet watch over a warm hearth.'};
const pass={outcome:'pass' as const,reason:'passed',records:[]};
function setup(){const events:ForgeRunEvent[]=[],records:ForgeRunRecord[]=[];const providers:ForgeProviders={judgeWords:vi.fn(async()=>pass),draft:vi.fn(async()=>draft),judgeResult:vi.fn(async()=>pass)};return{events,records,providers,emit:(event:ForgeRunEvent)=>events.push(event),record:async(record:ForgeRunRecord)=>{records.push(record);}};}
describe('the host owns the complete Forge run',()=>{
 it('judges words before Codex, builds its plan, judges a real sheet, then records before releasing',async()=>{const s=setup(),safetyIdentifier='trusted-citizen-opaque-hash-0001';await runForge(request,s.providers,event=>{if(event.type==='approved')expect(s.records[0]?.outcome).toBe('approved');s.emit(event);},s.record,undefined,{safetyIdentifier});
 expect(s.events.map(e=>e.type==='stage'?e.stage:e.type)).toEqual(['judging-words','drafting','assembling','judging-piece','approved']);
 expect(s.providers.judgeWords).toHaveBeenCalledWith(expect.objectContaining({safetyIdentifier}));
 expect(s.providers.judgeResult).toHaveBeenCalledWith(expect.objectContaining({safetyIdentifier,contactSheet:expect.stringMatching(/^data:image\/png;base64,/)}));expect(s.records[0]?.verdicts).toHaveLength(2);
 });
 it('never drafts rejected words or releases a held piece, and stays cold on outage',async()=>{const rejected=setup();vi.mocked(rejected.providers.judgeWords).mockResolvedValue({...pass,outcome:'refuse'});await runForge(request,rejected.providers,rejected.emit,rejected.record);expect(rejected.providers.draft).not.toHaveBeenCalled();expect(rejected.events.at(-1)?.type).toBe('stopped');
 const held=setup();vi.mocked(held.providers.judgeResult).mockResolvedValue({...pass,outcome:'hold'});await runForge(request,held.providers,held.emit,held.record);expect(held.events.some(e=>e.type==='approved')).toBe(false);
 const cold=setup();vi.mocked(cold.providers.judgeWords).mockRejectedValue(new Error('offline'));await runForge(request,cold.providers,cold.emit,cold.record);expect(cold.events.at(-1)).toMatchObject({type:'stopped',outcome:'cold'});
 });
 it('records a low quality score without turning a safety pass into a stopped event',async()=>{
  const s=setup(),quality={policy:'fw10-test',score:0.1,recognisability:0.1,completeness:0.2,cleanMarks:0};
  vi.mocked(s.providers.judgeResult).mockResolvedValue({...pass,quality});
  await runForge(request,s.providers,s.emit,s.record);
  expect(s.events.filter(e=>e.type==='stopped')).toEqual([]);
  expect(s.events.at(-1)).toMatchObject({type:'approved'});
  expect(s.records).toHaveLength(1);
  expect(s.records[0]).toMatchObject({outcome:'approved',verdicts:[pass,{...pass,quality}]});
 });
 it.each(['hold','refuse'] as const)('never approves a safety %s at either gate',async(outcome)=>{
  for(const gate of ['judgeWords','judgeResult'] as const){
   const s=setup();vi.mocked(s.providers[gate]).mockResolvedValue({...pass,outcome,reason:'private safety reason'});
   await runForge(request,s.providers,s.emit,s.record);
   expect(s.events.filter(e=>e.type==='approved')).toEqual([]);
   expect(s.events.at(-1)).toMatchObject({type:'stopped',outcome,message:'private safety reason'});
   expect(s.records).toHaveLength(1);expect(s.records[0]?.outcome).toBe(outcome);
   if(gate==='judgeWords')expect(s.providers.draft).not.toHaveBeenCalled();
  }
 });
});
