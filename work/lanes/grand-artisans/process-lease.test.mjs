import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {spawnLeasedProcess} from './process-lease.mjs';
const moduleUrl=new URL('./process-lease.mjs',import.meta.url).href;
const waitReady=child=>new Promise((resolve,reject)=>{
  let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('owned ready'))resolve();});
  child.once('error',reject);child.once('exit',code=>reject(new Error(`Exited before ready: ${code}`)));
});
const closed=child=>new Promise(resolve=>child.once('close',resolve));
test('pipe loss after caller termination stops only its owned process group',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'artisan-process-lease-'));
  const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try {
    for(const terminateCaller of [false,true]) {
      const marker=join(directory,terminateCaller?'terminated':'normal');
      const program=`const fs=require('node:fs');process.once('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'stopped');process.exit(0)});console.log('owned ready');setInterval(()=>{},1000);`;
      const command=[process.execPath,'-e',program];
      const child=terminateCaller
        ?spawn(process.execPath,['--input-type=module','-e',`import {spawnLeasedProcess} from ${JSON.stringify(moduleUrl)};const child=spawnLeasedProcess(${JSON.stringify(command)});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);process.stdin.resume();`],{stdio:['pipe','pipe','pipe']})
        :spawnLeasedProcess(command);
      const completion=closed(child);
      await waitReady(child);
      if(terminateCaller) child.kill('SIGTERM');else child.stdin.end();
      await completion;
      let value;
      for(let i=0;i<80;i++) {
        try {value=await readFile(marker,'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}
        await pause(100);
      }
      assert.equal(value,'stopped');assert.equal(sentinel.exitCode,null);
    }
  } finally {const completion=closed(sentinel);sentinel.kill('SIGTERM');await completion;await rm(directory,{recursive:true,force:true});}
});
