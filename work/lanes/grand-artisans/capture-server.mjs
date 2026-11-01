import { spawnLeasedProcess } from './process-lease.mjs';
import { createServer } from 'node:net';
import { acquireArtisanCapture } from './capture-lease.mjs';
import { setTimeout as pause } from 'node:timers/promises';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';

async function available(port) {
  return await new Promise(resolve => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** Own only the process group we start; strictPort closes the bind-after-probe race. */
export async function startCaptureServer(cwd = process.cwd()) {
  const failures = [];
  for (const port of CAPTURE_PORTS) {
    if (!await available(port)) continue;
    const child = spawnLeasedProcess(['pnpm','--filter','@chatdom/web','exec','vite','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd});
    child.stdin.on('error',()=>{});
    let log = '', exited = false;
    const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    const stop = async () => {
      if (!exited) child.stdin.end();
      await closed;
    };
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Vite startup timeout on ${port}`)), 20000);
        const data = () => { if (log.includes('Local:')) { clearTimeout(timer); resolve(); } };
        child.stdout.on('data', data); child.stderr.on('data', data);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)); });
        data();
      });
      console.log(`[capture] owned Vite ready on ${port}`);
      return { port, stop };
    } catch (error) {
      await stop(); failures.push(`${port}: ${error.message}\n${log}`);
      // A strict-port collision can be retried. Configuration failures will repeat on every port.
      if (!/port.*(already in use|in use)|EADDRINUSE/i.test(log)) break;
    }
  }
  const error=new Error(`Unable to start capture Vite.\n${failures.join('\n') || 'No capture ports available.'}`);
  if (!failures.length) error.code='CAPTURE_PORTS_BUSY';
  throw error;
}

/** Port pressure is not a failed still and must not retain a capture slot while idle. */
export async function leaseCaptureServer(cwd) {
  while(true) {
    const release=await acquireArtisanCapture();
    try {return {server:await startCaptureServer(cwd),release};}
    catch(error) {
      await release();
      if(error.code!=='CAPTURE_PORTS_BUSY') throw error;
      console.log('[capture] allowed ports busy; lease released while waiting for a free port');
      let free=false;
      while(!free) {
        await pause(1000);
        for(const port of CAPTURE_PORTS) if(await available(port)) {free=true;break;}
      }
    }
  }
}
