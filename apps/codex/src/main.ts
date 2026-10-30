import {createServer} from 'node:http';
import {appendFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runForge} from './run';
import {createForgeProviders} from './providers';
const port=Number(process.env.FORGE_PORT??5195),providers=createForgeProviders();
const directory=resolve(process.env.FORGE_DATA_DIR??'../../.forge.local');
await mkdir(directory,{recursive:true});
let occupied=false;
const server=createServer(async(req,res)=>{
 const send=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url==='/forge-data/status'){send(200,{mode:'local-development',citizens:'simulated',judgesConfigured:!!process.env.OPENAI_API_KEY,occupied});return;}
 if(req.method!=='POST'||req.url!=='/forge-data/run'){send(404,{error:'Not found'});return;}
 // This development room never accepts a Twitch identity, realm authority or coal balance from a browser.
 if(req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'Open the Forge from the kingdom.'});return;}
 if(occupied){send(429,{error:'The anvil is occupied. Try again when the hammer rests.'});return;}
 occupied=true;const abort=new AbortController();res.on('close',()=>abort.abort());
 try{
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>1048576)throw new Error('Wish too large');chunks.push(Buffer.from(chunk));}
  const input:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store','x-accel-buffering':'no'});res.flushHeaders();
  await runForge(input,providers,event=>{if(!res.destroyed)res.write(`${JSON.stringify(event)}\n`);},entry=>appendFile(resolve(directory,'runs.jsonl'),`${JSON.stringify(entry)}\n`,{mode:0o600}),abort.signal);
  res.end();
 }catch{if(!res.headersSent)send(400,{error:'The Forge needs one short wish and a house.'});else if(!res.destroyed)res.end(`${JSON.stringify({type:'stopped',outcome:'cold',message:'The forge needs a moment to rest.'})}\n`);}
 finally{occupied=false;}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Chatdom spell runtime on 127.0.0.1:${port} (development citizens)\n`));
