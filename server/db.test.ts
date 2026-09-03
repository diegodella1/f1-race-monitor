import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from './db.js';
import { initialState } from './state.js';

test('stores only identified phases and closes each phase separately',()=>{
  const file=join(tmpdir(),`f1-monitor-${process.pid}-${Date.now()}.sqlite`),store=new SessionStore(file),unknown=initialState();
  store.save(unknown);assert.equal(store.list().length,0);
  const q1=initialState();q1.status='CONNECTED';q1.sessionUid='weekend';q1.sessionLinkId=10;q1.sessionType='Qualifying 1';q1.track='Monza';q1.context.category='QUALIFYING';q1.updatedAt=1000;store.save(q1);
  const race={...q1,sessionLinkId:11,sessionType:'Race',context:{...q1.context,category:'RACE' as const},strategy:{...q1.strategy,decisions:[{id:'strategy-box-next',lap:6,at:2000,status:'EMITTED' as const,reason:'Mandatory stop'}]},engineer:{...q1.engineer,log:[{id:'strategy-box-next',lap:6,at:2001,status:'EMITTED' as const,reason:'Highest value'}]},updatedAt:2000};store.save(race);store.stop(3000);
  const sessions=store.list() as {id:number;mode:string;endedAt:number|null}[];assert.deepEqual(sessions.map(x=>x.mode),['Race','Qualifying 1']);assert.ok(sessions.every(x=>x.endedAt!==null));
  const decisions=store.decisions(sessions[0].id) as {source:string;eventId:string}[];assert.deepEqual(decisions.map(x=>x.source),['strategy','engineer']);assert.ok(decisions.every(x=>x.eventId==='strategy-box-next'));
  store.close();rmSync(file,{force:true});
});
