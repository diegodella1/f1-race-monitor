import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioQueue } from './radioQueue';
import { initialState } from '../server/state.js';
import { controlMessages, observeControlCounters } from '../server/raceControl.js';

function withControls(s:ReturnType<typeof initialState>,at=1000){
  s.updatedAt=at;s.sessionTime=10;
  s.raceControl=observeControlCounters(s,2,1);
  s.context.penalties=2;s.context.warnings=1;
  s.engineer.control=controlMessages(s,at+2000);
}

test('control notices survive a busy radio beyond 30 seconds, ahead of ordinary calls',()=>{
  const {queue,s,m,spoken,finish,log}=setup();
  queue.update({...m,id:'contact',eventId:'contact',priority:'critical'},s,'Contact',0);
  withControls(s);queue.update(m,s,'Push',3000);
  queue.update(null,s,'',35000);assert.deepEqual(spoken,['Contact']);
  finish();queue.update(null,s,'',36000);assert.match(spoken[1],/2.second penalty/i);
  finish();queue.update(null,s,'',36100);assert.match(spoken[2],/warning/i);
  finish();queue.update(null,s,'',37000);assert.ok(log.some(x=>x.includes('COMPLETED')));
  assert.equal(spoken.filter(x=>/penalty/i.test(x)).length,1);
});

test('control notices bypass the ordinary budget and survive pause',()=>{
  const {queue,s,m,spoken,finish}=setup();
  for(let i=0;i<3;i++){queue.update({...m,eventId:'ordinary-'+i,expiresAt:120000},s,'Ordinary',i*16000);finish();}
  s.status='PAUSED';withControls(s,33000);queue.update(null,s,'',35000);
  s.status='CONNECTED';queue.update(null,s,'',36000);assert.match(spoken[3],/penalty/i);
});

test('activation skips old events and announces current totals once',()=>{
  const {queue,s,spoken,finish}=setup();withControls(s);
  queue.activate(s,10000);queue.update(null,s,'',10000);assert.equal(spoken.length,1);assert.match(spoken[0],/status/i);
  finish();queue.update(null,s,'',12000);assert.equal(spoken.length,1);
});

test('finish updates a pending sanction and discards pending warnings',()=>{
  const {queue,s,m,spoken,finish,log}=setup();
  queue.update({...m,priority:'critical'},s,'Contact',0);withControls(s);queue.update(null,s,'',3000);
  s.context.lifecycle='FINISHED';s.engineer.control=controlMessages(s,4000);
  finish();queue.update(null,s,'',4000);assert.match(spoken[1],/Session ended/);
  finish();queue.update(null,s,'',4100);assert.equal(spoken.length,2);assert.ok(log.some(x=>x.includes('EXPIRED')));
});

test('flashback within the same lap drops queued control events',()=>{
  const {queue,s,m,log,spoken,finish}=setup();
  queue.update({...m,priority:'critical'},s,'Contact',0);withControls(s);queue.update(null,s,'',3000);
  s.raceControl={generation:1,events:[]};s.engineer.control=[];
  finish();queue.update(null,s,'',4000);assert.equal(spoken.length,1);assert.ok(log.some(x=>x.includes('CANCELLED')));
});

test('an interrupted penalty is retried after critical safety speech',()=>{
  const {queue,s,m,spoken,finish,log}=setup();withControls(s);queue.update(null,s,'',3000);
  assert.match(spoken[0],/penalty/i);
  queue.update({...m,priority:'critical'},s,'Contact',3100);assert.equal(spoken[1],'Contact');
  finish();queue.update(null,s,'',5000);assert.match(spoken[2],/penalty/i);
  finish();assert.equal(log.filter(x=>x.includes('penalty-')&&x.includes('COMPLETED')).length,1);
});

test('a reversed penalty is discarded while queued and the next same-size penalty is new',()=>{
  const {queue,s,m,spoken,finish,log}=setup();queue.update(m,s,'Push',0);withControls(s);queue.update(null,s,'',3000);
  s.sessionTime=11;s.raceControl=observeControlCounters(s,0,1);s.context.penalties=0;s.engineer.control=controlMessages(s,4000);
  finish();queue.update(null,s,'',4000);assert.ok(!spoken.some(text=>/penalty/i.test(text)));
  assert.ok(log.some(x=>x.includes('penalty-')&&x.includes('EXPIRED')));
  finish();s.sessionTime=12;s.updatedAt=5000;s.raceControl=observeControlCounters(s,2,1);s.context.penalties=2;s.engineer.control=controlMessages(s,7000);
  queue.update(null,s,'',7000);assert.match(spoken.at(-1)!,/penalty/i);
});

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
  assert.ok(cancelled);assert.equal(queue.status,'ATTENTION');assert.ok(events.some(x=>x.includes('ERROR:Speech did not start')));
});
