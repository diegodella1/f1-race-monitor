import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { parsePacket } from './parser.js';
import { controlMessages } from './raceControl.js';
import { RaceEngineer } from './intelligence.js';
import { SessionStore } from './db.js';

function packet(id:number,size:number,time=10){
  const b=Buffer.alloc(size);b.writeUInt16LE(2026);b.writeUInt8(id,6);b.writeBigUInt64LE(123n,7);b.writeFloatLE(time,15);b.writeUInt32LE(time*100,19);b.writeUInt8(1,27);return b;
}
function penalty(type=4,seconds=2,time=10,car=1){
  const b=packet(3,45,time);b.write('PENA',29);b.set([type,17,car,255,seconds,1,0],33);return b;
}
function lap(seconds=0,warnings=0,time=10){
  const b=packet(2,1399,time),o=29+57;b.writeUInt8(1,o+33);b.writeUInt8(seconds,o+38);b.writeUInt8(warnings,o+39);return b;
}
function state(){const s=initialState();s.sessionUid='123';s.sessionLinkId=2;s.sessionType='Race';s.context.category='RACE';s.context.lifecycle='ACTIVE';return s;}

test('PENA and lap counters produce one notice in either arrival order',()=>{
  for(const packets of [[penalty(),lap(2)],[lap(2),penalty()]]){
    let s=state();for(const b of packets)s=parsePacket(b,s)!;
    const calls=controlMessages(s,Date.now()+2000);
    assert.equal(calls.length,1);assert.match(calls[0].radio!.en,/2.second penalty/i);assert.match(calls[0].radio!.en,/pit lane/i);
  }
});
test('same-duration sanctions remain distinct but duplicate UDP packets do not',()=>{
  let s=state();for(const b of [penalty(),penalty(),lap(2),penalty(4,2,12),lap(4,0,12)])s=parsePacket(b,s)!;
  assert.equal(controlMessages(s,Date.now()+2000).length,2);
});
test('warning fallback reconciles with PENA and does not guess the next penalty',()=>{
  let s=parsePacket(lap(0,1),state())!;s=parsePacket(penalty(5,0),s)!;
  const calls=controlMessages(s,Date.now()+2000);assert.equal(calls.length,1);assert.match(calls[0].radio!.en,/warning/i);assert.doesNotMatch(calls[0].radio!.en,/next penalty|remaining/i);
});
test('other cars and truncated PENA do not create player notices',()=>{
  assert.equal(controlMessages(parsePacket(penalty(4,2,10,0),state())!,Date.now()+2000).length,0);
  assert.equal(parsePacket(penalty().subarray(0,38),state()),null);
});
test('unknown penalty codes remain factual and non-time sanctions are supported',()=>{
  for(const [type,pattern] of [[0,/drive.through/i],[1,/stop.go/i],[6,/disqualified/i],[250,/race control/i]] as const){
    const b=penalty(type,0);b.writeUInt8(250,34);
    const calls=controlMessages(parsePacket(b,state())!,Date.now()+2000);assert.equal(calls.length,1);assert.match(calls[0].radio!.en,pattern);assert.doesNotMatch(calls[0].radio!.en,/0.second/);
  }
});
test('counter reversal and flashback invalidate stale notices',()=>{
  let s=parsePacket(lap(2),state())!;s=parsePacket(lap(0,0,11),s)!;assert.equal(controlMessages(s,Date.now()+2000).length,0);
  s=parsePacket(lap(2,0,12),s)!;const b=packet(3,45,13);b.write('FLBK',29);s=parsePacket(b,s)!;
  assert.equal(controlMessages(s,Date.now()+2000).length,0);
  s=parsePacket(lap(0,0,9),s)!;s=parsePacket(lap(2,0,10),s)!;assert.equal(controlMessages(s,Date.now()+2000).length,1);
});
test('session finish retains penalties with closing copy and drops warnings',()=>{
  let s=parsePacket(lap(2,1),state())!;s.context.lifecycle='FINISHED';
  const calls=controlMessages(s,Date.now()+2000);assert.equal(calls.length,1);assert.match(calls[0].radio!.en,/session ended/i);assert.doesNotMatch(calls[0].radio!.en,/build.*margin/i);
});

test('serving a drive-through or stop-go clears only the matching player sanction',()=>{
  for(const [type,code] of [[0,'DTSV'],[1,'SGSV']] as const){
    let s=parsePacket(penalty(type,0),state())!;
    const served=packet(3,45,15);served.write(code,29);served.writeUInt8(0,33);
    s=parsePacket(served,s)!;assert.equal(controlMessages(s,Date.now()+2000).length,1);
    served.writeUInt8(1,33);s=parsePacket(served,s)!;assert.equal(controlMessages(s,Date.now()+2000).length,0);
  }
});

test('two PENA events followed by an aggregate counter update stay two notices',()=>{
  let s=state();for(const b of [penalty(),penalty(4,2,10.5),lap(4,0,11)])s=parsePacket(b,s)!;
  assert.equal(controlMessages(s,Date.now()+2000).length,2);
});

test('duplicate service packets do not clear another outstanding drive-through',()=>{
  let s=parsePacket(penalty(0,0),state())!;s=parsePacket(penalty(0,0,12),s)!;
  const served=packet(3,45,15);served.write('DTSV',29);served.writeUInt8(1,33);
  s=parsePacket(served,s)!;s=parsePacket(served,s)!;assert.equal(controlMessages(s,Date.now()+2000).length,1);
});

test('normalized control events and published decisions survive snapshot persistence',()=>{
  const store=new SessionStore(':memory:');
  try{
    let s=parsePacket(penalty(),state())!;s.track='Bahrain';s=new RaceEngineer().analyze(s);
    store.save(s);
    const id=(store.list()[0] as {id:number}).id;
    assert.deepEqual(store.replay(id)[0].state.raceControl,s.raceControl);
    assert.equal(store.replay(id)[0].state.engineer.control?.length,1);
    assert.ok(store.decisions(id).some(row=>row.eventId===s.engineer.control![0].id));
  }finally{store.close();}
});
