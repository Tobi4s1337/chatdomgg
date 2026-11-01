import test from 'node:test';
import assert from 'node:assert/strict';
import {canResume, readCaptureRecords, publishCaptureRecord} from './capture-records.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const a={path:'still.png',key:'A',sourceHash:'source-A',imageHash:'image-A'};
const b={...a,key:'B',sourceHash:'source-B',imageHash:'image-B'};
test('resumes only the latest matching artifact, including its actual PNG bytes',()=>{
  assert.equal(canResume([a],a),true);
  assert.equal(canResume([a,b],a),false);
  assert.equal(canResume([a,b],{...a,imageHash:b.imageHash}),false);
  assert.equal(canResume([a,b],b),true);
  assert.equal(canResume([a,b],{...b,imageHash:'tampered'}),false);
  assert.equal(canResume([a,{...b,path:'another.png'}],a),true);
  assert.equal(canResume([{...a,imageHash:undefined}],a),false);
});

test('independent atomic manifests survive torn logs and unpublished partial records',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'artisan-records-'));
  try {
    const first={...a,path:directory+'/first.png',capturedAt:'2026-11-01T01:00:00Z'};
    const second={...b,path:directory+'/second.png',capturedAt:'2026-11-01T02:00:00Z'};
    await writeFile(directory+'/capture-log.jsonl','{"torn":');
    await writeFile(directory+'/aborted.png.json.pending','{"partial":');
    await Promise.all([publishCaptureRecord(first),publishCaptureRecord(second)]);
    assert.deepEqual(await readCaptureRecords(directory),[first,second]);
  } finally {await rm(directory,{recursive:true,force:true});}
});
