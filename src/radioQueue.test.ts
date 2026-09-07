import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioQueue } from './radioQueue';
import { initialState } from '../server/state.js';

function setup(){
  const log:string[]=[],spoken:string[]=[];
  let finish=()=>{};
  const queue=new RadioQueue({speak:(text,cb)=>{spoken.push(text);cb.start();finish=cb.end;},cancel:()=>{},log:(c,status,reason)=>log.push(`${c.message.id}:${status}:${reason}`)});
  const s=initialState();s.status='CONNECTED';s.sessionUid='spa';s.sessionLinkId=2;s.lap=7;
  const m={id:'push',eventId:'push-1',priority:'opportunity' as const,title:'Push',evidence:'',action:'',confidence:90,createdAt:0,expiresAt:60000};
  return {queue,s,m,log,spoken,finish:()=>finish()};
}
test('speech dedupes event identity and waits for ordinary spacing',()=>{
  const {queue,s,m,spoken,finish}=setup();queue.update(m,s,'Push',1000);finish();
  queue.update({...m,createdAt:2000},s,'Push',2000);assert.equal(spoken.length,1);
  queue.update({...m,id:'other',eventId:'other'},s,'Other',2000);assert.equal(spoken.length,1);
  queue.update(null,s,'',16000);assert.deepEqual(spoken,['Push','Other']);
});
test('critical event interrupts and records cancellation',()=>{
  const {queue,s,m,log,spoken}=setup();queue.update(m,s,'Push',1000);
  queue.update({...m,id:'contact',eventId:'contact',priority:'critical'},s,'Contact',2000);
  assert.equal(spoken.length,2);assert.ok(log.some(x=>x.includes('CANCELLED:Interrupted')));
});
test('info expires without a safe driving window',()=>{
  const {queue,s,m,log,spoken}=setup();s.player.brake=80;
  queue.update({...m,priority:'info'},s,'Status',1000);queue.update(null,s,'',11000);
  assert.equal(spoken.length,0);assert.ok(log.some(x=>x.includes('EXPIRED:No safe')));
});
test('pause cancels pending and session change allows a fresh event',()=>{
  const {queue,s,m,log}=setup();queue.update({...m,priority:'info'},s,'Status',1000);
  s.status='PAUSED';queue.update(m,s,'',2000);assert.ok(log.some(x=>x.includes('CANCELLED:Paused')));
  s.status='CONNECTED';s.sessionLinkId=3;queue.update(m,s,'Push',3000);assert.equal(queue.status,'SPEAKING');
});

test('ordinary budget is three per lap and a required box still plays',()=>{
  const {queue,s,m,spoken,finish}=setup();
  for(let i=0;i<4;i++){queue.update({...m,id:'call-'+i,eventId:'call-'+i,expiresAt:120000},s,'Call',i*16000);finish();}
  assert.equal(spoken.length,3);
  queue.update({...m,id:'strategy-box-mandatory',eventId:'box'},s,'Box',50000);
  assert.equal(spoken.length,4);
});

test('safe window must last half a second and completed is a browser callback',()=>{
  const {queue,s,m,spoken,finish,log}=setup();
  queue.update({...m,priority:'info'},s,'Status',1000);
  queue.update(null,s,'',1400);assert.equal(spoken.length,0);
  queue.update(null,s,'',2000);assert.equal(spoken.length,1);
  assert.ok(!log.some(x=>x.includes('COMPLETED')));finish();assert.ok(log.some(x=>x.includes('COMPLETED')));
});

test('pending mode is cancelled when the tactical context changes',()=>{
  const {queue,s,m,log,spoken}=setup();s.strategy.raceMode='PUSH';s.player.brake=90;
  queue.update({...m,id:'mode-push-7',context:{mode:'PUSH'},priority:'info'},s,'Push',1000);
  s.strategy.raceMode='DEFEND';queue.update(null,s,'',2000);
  assert.equal(spoken.length,0);assert.ok(log.some(x=>x.includes('EXPIRED:Context')));
});

test('latency logs separate local queue waiting from browser startup',()=>{
  const {queue,s,m,log}=setup();
  queue.update({...m,priority:'info'},s,'Status',1000);
  assert.ok(log.some(x=>x.includes('DEFERRED:Waiting for a safe')));
  assert.ok(!log.some(x=>x.includes('SUBMITTED')));
  queue.update(null,s,'',1500);
  assert.ok(log.some(x=>x.includes('SUBMITTED:Sent to browser')));
  assert.ok(log.some(x=>x.includes('STARTED:Browser')));
});

test('a stalled speech engine cannot block the queue indefinitely',()=>{
  const events:string[]=[];let cancelled=false;
  const queue=new RadioQueue({speak:()=>{},cancel:()=>{cancelled=true;},log:(_,status,reason)=>events.push(status+':'+reason)});
  const {s,m}=setup();queue.update(m,s,'Push',1000);queue.update(null,s,'',11001);
  assert.ok(cancelled);assert.equal(queue.status,'READY');assert.ok(events.some(x=>x.includes('ERROR:Speech did not start')));
});
