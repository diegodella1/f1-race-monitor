import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceAuth,RateLimit,sessionCookie } from './auth.js';
import { PacketGate,packetSupport } from './packetGate.js';
import { TelemetryMonitor } from './telemetry.js';
import { initialState } from './state.js';
import { parsePacket } from './parser.js';
import { LatestStateStream } from './stateStream.js';

function packet(id=1,size=926,frame=10){const b=Buffer.alloc(size);b.writeUInt16LE(2026);b[5]=1;b[6]=id;b.writeBigUInt64LE(1n,7);b.writeUInt32LE(frame,19);return b;}
test('pairing links are single use, expire and devices can be revoked',()=>{
  const auth=new DeviceAuth(':memory:');
  const token=auth.pair(0),device=auth.redeem(token,'Tablet',1)!;
  assert.ok(device);assert.equal(auth.redeem(token,'Other',2),null);
  assert.equal(auth.device(device.secret,3)?.name,'Tablet');
  auth.revoke(device.id);assert.equal(auth.device(device.secret,4),undefined);
  assert.equal(auth.redeem(auth.pair(0),'Late',600001),null);
  assert.equal(sessionCookie('other=a; f1_session=hello'),'hello');auth.close();
});
test('rate windows reset after one minute',()=>{const limit=new RateLimit();assert.ok(limit.allow('ip',1,0));assert.equal(limit.allow('ip',1,1),false);assert.ok(limit.allow('ip',1,60000));});
test('truncated, unsupported and non-finite packets do not become fresh telemetry',()=>{
  const truncated=packet(1,29);assert.equal(parsePacket(truncated,initialState()),null);
  const legacy=packet();legacy.writeUInt16LE(2025);assert.equal(packetSupport(legacy),'unsupported');
  const bad=packet(6,1448);bad.writeFloatLE(NaN,31);assert.equal(packetSupport(bad),'invalid');
  const monitor=new TelemetryMonitor();monitor.observe(truncated,false,'console',1000);
  assert.equal(monitor.quality(initialState(),1001).packets.find(p=>p.id===1)?.healthy,false);
});
test('source lock rejects a second sender and stale frames without confusing flashback',()=>{
  const gate=new PacketGate('console');assert.equal(gate.accept(packet(),'other'),false);
  assert.ok(gate.accept(packet(),'console'));assert.equal(gate.accept(packet(),'console'),false);
  assert.equal(gate.accept(packet(1,926,9),'console'),false);
  const flashback=packet(3,45,11);flashback.write('FLBK',29);assert.ok(gate.accept(flashback,'console'));
  assert.ok(gate.accept(packet(1,926,2),'console'));assert.equal(gate.accept(flashback,'console'),false);
});
test('lost acknowledgement recovers latest state and ignores the old callback',()=>{
  const values:number[]=[],acks:(()=>void)[]=[];let resets=0;
  const stream=new LatestStateStream<number>((value,ack)=>{values.push(value);acks.push(ack);},100,()=>resets++);
  stream.update(1);stream.flush(0);stream.update(2);stream.flush(2001);assert.deepEqual(values,[1,2]);assert.equal(resets,1);
  acks[0]();stream.update(3);stream.flush(2200);assert.deepEqual(values,[1,2]);acks[1]();stream.flush(2300);assert.deepEqual(values,[1,2,3]);
});
test('flashback rejects delayed packets from the previous timeline',()=>{
  const gate=new PacketGate(),before=packet();before.writeUInt32LE(100,23);assert.ok(gate.accept(before,'console'));
  const event=packet(3,45,11);event.write('FLBK',29);event.writeUInt32LE(101,23);assert.ok(gate.accept(event,'console'));
  const late=packet(1,926,12);late.writeUInt32LE(100,23);assert.equal(gate.accept(late,'console'),false);
  const after=packet(1,926,2);after.writeUInt32LE(102,23);assert.ok(gate.accept(after,'console'));
});
test('session history remains supported and cross-packet delays do not rewind session time',()=>{
  assert.equal(packetSupport(packet(11,1460)),'valid');
  const state=initialState();state.sessionUid='1';state.sessionTime=20;
  const delayed=packet();delayed.writeFloatLE(19.9,15);
  assert.equal(parsePacket(delayed,state)?.sessionTime,20);
});
