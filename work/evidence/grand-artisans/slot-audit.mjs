// An isolated scheduler audit. This never acquires the real host capture path or starts a browser.
const { acquireCaptureLock } = await import(process.env.ARTISAN_AUDIT_MODULE ?? '../../../packages/testing/capture-lock.mjs');
const path = process.env.ARTISAN_AUDIT_LOCK;
if (!path?.startsWith('/tmp/grand-artisans-slot-audit-')) throw new Error('Use a lane-owned isolated audit lock');
const release = await acquireCaptureLock({path,priority:'main'});
console.log(JSON.stringify({state:'acquired',pid:process.pid,time:Date.now()}));
await new Promise(resolve=>setTimeout(resolve,45000));
await release();
console.log(JSON.stringify({state:'released',time:Date.now()}));
