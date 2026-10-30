import {it,expect,vi,afterEach} from 'vitest';
import {requestForgeRun} from './run-client';
import {createHome} from '@chatdom/content';
afterEach(()=>vi.unstubAllGlobals());
it('waits through split stage chunks and never accepts a hold or an unfinished stream',async()=>{
 const input={words:'A shell that keeps the evening light',family:'tide' as const,home:createHome('house','tide',0)},stages:string[]=[];
 const response=(parts:string[])=>new Response(new ReadableStream({start(c){for(const p of parts)c.enqueue(new TextEncoder().encode(p));c.close();}}));
 vi.stubGlobal('fetch',vi.fn(async()=>response(['{"type":"stage","stage":"draft','ing"}\n','{"type":"stopped","outcome":"hold","message":"Waiting for the Watch"}\n'])));
 await expect(requestForgeRun(input,s=>stages.push(s),new AbortController().signal)).rejects.toThrow('Waiting for the Watch');expect(stages).toEqual(['drafting']);
 vi.stubGlobal('fetch',vi.fn(async()=>response(['{"type":"stage","stage":"drafting"}\n'])));
 await expect(requestForgeRun(input,()=>{},new AbortController().signal)).rejects.toThrow('connection returns');
});
