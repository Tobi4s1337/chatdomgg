import {spawn} from 'node:child_process';
// The supervisor owns its process group. Losing the caller's stdin pipe kills only
// that owned group, even if the caller itself is terminated before its finally block.
const supervisor=`
  import {spawn} from 'node:child_process';
  const args=JSON.parse(process.argv[1]);
  const child=spawn(args[0],args.slice(1),{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],detached:true});
  let stopped=false, escalation;
  const stop=()=>{
    if(stopped)return;stopped=true;
    if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
    escalation=setTimeout(()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}},5000);
    escalation.unref();
  };
  process.stdin.resume();process.stdin.once('end',stop);process.stdin.once('error',stop);
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  process.stdout.on('error',stop);process.stderr.on('error',stop);
  child.stdout.on('data',data=>process.stdout.write(data));
  child.stderr.on('data',data=>process.stderr.write(data));
  child.once('error',error=>{process.stderr.write(error.message);process.exitCode=1;process.stdin.destroy();});
  child.once('close',code=>{clearTimeout(escalation);process.stdin.destroy();process.exitCode=stopped?0:code??1;});
`;
export function spawnLeasedProcess(command,{cwd=process.cwd()}={}) {
  return spawn(process.execPath,['--input-type=module','-e',supervisor,JSON.stringify(command)],{cwd,stdio:['pipe','pipe','pipe']});
}
