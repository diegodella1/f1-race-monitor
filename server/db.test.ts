import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from './db.js';
import { initialState } from './state.js';
import type { DatabaseSync } from 'node:sqlite';

test('stores only identified phases and closes each phase separately',()=>{
  const file=join(tmpdir(),`f1-monitor-${process.pid}-${Date.now()}.sqlite`),store=new SessionStore(file),unknown=initialState();
  store.save(unknown);assert.equal(store.list().length,0);
  const q1=initialState();q1.status='CONNECTED';q1.sessionUid='weekend';q1.sessionLinkId=10;q1.sessionType='Qualifying 1';q1.track='Monza';q1.context.category='QUALIFYING';q1.updatedAt=1000;store.save(q1);
  const race={...q1,sessionLinkId:11,sessionType:'Race',context:{...q1.context,category:'RACE' as const},strategy:{...q1.strategy,decisions:[{id:'strategy-box-next',lap:6,at:2000,status:'EMITTED' as const,reason:'Mandatory stop'}]},engineer:{...q1.engineer,log:[{id:'strategy-box-next',lap:6,at:2001,status:'EMITTED' as const,reason:'Highest value'}]},updatedAt:2000};store.save(race);store.stop(3000);
  const sessions=store.list() as {id:number;mode:string;endedAt:number|null}[];assert.deepEqual(sessions.map(x=>x.mode),['Race','Qualifying 1']);assert.ok(sessions.every(x=>x.endedAt!==null));
  const decisions=store.decisions(sessions[0].id) as {source:string;eventId:string}[];assert.deepEqual(decisions.map(x=>x.source),['strategy','engineer']);assert.ok(decisions.every(x=>x.eventId==='strategy-box-next'));
  const replay=store.replay(sessions[0].id),report=store.report(sessions[0].id);
  assert.ok(report);assert.equal(replay.length,1);assert.equal(replay[0].state.sessionType,'Race');assert.equal(Number(report.snapshots?.frames),1);
  store.close();rmSync(file,{force:true});
});
test('a full database rolls back cleanly and recording resumes after capacity returns',()=>{
  const store=new SessionStore(':memory:'),db=(store as unknown as {db:DatabaseSync}).db;
  const state=initialState();Object.assign(state,{sessionUid:'full',sessionLinkId:1,sessionType:'Race',track:'Monza',updatedAt:10000});state.context.category='RACE';
  store.save(state);const id=Number((store.list()[0] as {id:number}).id);
  const pages=Number((db.prepare('PRAGMA page_count').get() as {page_count:number}).page_count);db.exec('PRAGMA max_page_count='+pages);
  state.updatedAt=13000;
  state.strategy.modeReason='x'.repeat(2_000_000);
  assert.throws(()=>store.save(state),/full/);
  assert.equal(store.replay(id).length,1);
  db.exec('PRAGMA max_page_count=100000');state.strategy.modeReason='Recovered';store.save(state);
  assert.equal(store.replay(id).length,2);assert.equal(store.list().length,1);store.close();
});
