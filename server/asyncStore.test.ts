import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncStore } from './asyncStore.js';
import { initialState } from './state.js';
test('worker saves history without blocking capture and terminal snapshots are idempotent',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pitwall-worker-')),store=new AsyncStore(join(dir,'test.sqlite'));
  try{
    const state=initialState();state.status='CONNECTED';state.sessionUid='worker';state.sessionLinkId=1;state.sessionType='Race';state.context.category='RACE';state.track='Test track';state.context.lifecycle='FINISHED';
    for(let i=0;i<20;i++)await store.call('save',{...state,updatedAt:10000+i*100});
    const sessions=await store.call('list');assert.equal(sessions.length,1);
    const report=await store.call('report',sessions[0].id);assert.equal(report.snapshots.frames,1);
    assert.equal(store.health.error,'');
    await assert.rejects(store.call('unknown'),/Unknown database method/);
    assert.equal((await store.call('list')).length,1);
  }finally{await store.close();rmSync(dir,{recursive:true,force:true});}
});
