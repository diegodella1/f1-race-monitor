import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from './db.js';
import { initialState } from './state.js';
import { radioBatchSchema, type RadioEvent } from './radio-events.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('radio delivery is idempotent and associated with a saved session', () => {
  const store = new SessionStore(':memory:');
  const s = initialState();s.sessionUid='spa';s.sessionLinkId=2;s.sessionType='Race';s.track='Spa';s.context.category='RACE';
  store.save(s);
  const event:RadioEvent={eventId:'delivery-1',deviceId:'phone',sessionUid:'spa',sessionLinkId:2,sessionType:'Race',messageId:'push',status:'COMPLETED',text:'Empujá.',reason:'ended',category:'PACE',lap:7,clientAt:1000};
  assert.equal(store.saveRadioEvents([event,event]),1);
  assert.equal(store.saveRadioEvents([{...event,eventId:'unknown',sessionUid:'other'}]),0);
  assert.equal(store.radioEvents(1).total,1);
  assert.equal(store.radioEvents(1,{device:"'; DROP TABLE sessions;--"}).total,0);
  assert.equal(store.list().length,1);
  store.close();
});

test('radio batches reject excessive events and malformed identity', () => {
  assert.equal(radioBatchSchema.safeParse({events:Array(51).fill({})}).success,false);
  assert.equal(radioBatchSchema.safeParse({events:[{sessionLinkId:-1}]}).success,false);
});

test('latency report separates queue and synthesizer time on the same client clock',()=>{
  const store=new SessionStore(':memory:'),s=initialState();s.sessionUid='latency';s.sessionLinkId=1;s.sessionType='Race';s.track='Brazil';s.context.category='RACE';store.save(s);
  const base:RadioEvent={eventId:'selected',deviceId:'phone',sessionUid:'latency',sessionLinkId:1,sessionType:'Race',messageId:'call',status:'SELECTED',text:'Hold pace',reason:'',category:'PACE',lap:2,clientAt:1000};
  store.saveRadioEvents([base,{...base,eventId:'submitted',status:'SUBMITTED',clientAt:1500},{...base,eventId:'started',status:'STARTED',clientAt:1700}]);
  const timing=store.radioReport(1).latencies[0];
  assert.equal(timing.queueMs,500);assert.equal(timing.speechStartupMs,200);assert.equal(timing.totalMs,700);
  store.close();
});

test('read-only reports leave the session database byte-for-byte unchanged',()=>{
  const directory=mkdtempSync(join(tmpdir(),'f1-readonly-')),file=join(directory,'session.sqlite');
  try{
    const writer=new SessionStore(file);writer.close();
    const before=readFileSync(file),reader=new SessionStore(file,true);
    reader.list();reader.report(1);reader.close();
    assert.deepEqual(readFileSync(file),before);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
