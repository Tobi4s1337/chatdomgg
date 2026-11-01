import { spawn } from 'node:child_process';
import { acquireCaptureLock, CAPTURE_LOCK_PATH } from '../../../packages/testing/capture-lock.mjs';

// The shared module explicitly supports exclusive compatibility holders. Use that
// kernel-only path while its PID-based FIFO liveness is unsafe across tool namespaces.
// No queue record, foreign process, priority setting or lock inode is changed here.
const guard = `
  import { openSync, closeSync } from 'node:fs';
  import { spawn } from 'node:child_process';
  const fd = openSync(process.argv[1], 'a');
  let helper, stopped = false;
  const stop = () => { if (stopped) return; stopped = true; helper?.kill('SIGTERM'); closeSync(fd); process.stdin.destroy(); };
  process.stdin.resume(); process.stdin.once('end', stop); process.stdin.once('error', stop);
  process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdout.on('error', stop);
  helper = spawn('flock', ['--exclusive', '3'], { stdio: ['ignore', 'ignore', 'inherit', fd] });
  helper.once('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
  helper.once('close', code => { helper = undefined; if (stopped) return; if (code === 0) process.stdout.write('acquired\\n'); else { process.exitCode = 1; stop(); } });
`;

export async function acquireArtisanCapture({ path = CAPTURE_LOCK_PATH, compatibility = process.env.ARTISAN_CAPTURE_COMPAT === '1' } = {}) {
  if (!compatibility) return acquireCaptureLock({path});
  console.log('[capture] waiting for exclusive compatibility lease');
  const child = spawn(process.execPath, ['--input-type=module','-e',guard,path], {stdio:['pipe','pipe','inherit']});
  child.stdin.on('error',()=>{});
  const closed = new Promise(resolve=>child.once('close',resolve));
  let releasePromise;
  const release = () => releasePromise ??= (child.stdin.end(),closed);
  try {
    await new Promise((resolve,reject)=>{
      let output=''; child.stdout.on('data',b=>{output+=b; if(output.includes('acquired\n'))resolve();});
      child.once('error',reject); child.once('close',()=>reject(new Error('Compatibility capture guard closed before acquisition')));
    });
    console.log('[capture] acquired exclusive compatibility lease');
    return release;
  } catch(error) { await release(); throw error; }
}
