import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { TelemetryMonitor } from './telemetry.js';

const packet=(id:number)=>{const value=Buffer.alloc(29);value.writeUInt8(id,6);return value};
const connected=()=>{const state=initialState();state.status='CONNECTED';state.sessionUid='quality';state.sessionLinkId=1;state.sessionType='Race';state.context.category='RACE';state.packetCount=100;return state};

test('telemetry quality becomes high when every decision packet is fresh',()=>{
  const monitor=new TelemetryMonitor(),state=connected(),now=10000;
  for(const id of [1,2,4,6,7,10])monitor.observe(packet(id),true,'192.168.1.50',now);
  const quality=monitor.quality(state,now+100);
  assert.equal(quality.confidence,'HIGH');assert.equal(quality.score,100);assert.deepEqual(quality.missing,[]);assert.equal(quality.source,'192.168.1.50');assert.equal(quality.replayReady,true);
});

test('telemetry quality exposes missing and invalid packet evidence',()=>{
  const monitor=new TelemetryMonitor(),state=connected(),now=10000;
  monitor.observe(packet(6),false,'console',now);
  const quality=monitor.quality(state,now+3000);
  assert.equal(quality.confidence,'LOW');assert.ok(quality.missing.includes(2));assert.ok(quality.invalidPackets>0);assert.ok(quality.warnings.some(warning=>warning.includes('invalid')));
});

test('a paused game retains the last reliable packet health',()=>{
  const monitor=new TelemetryMonitor(),state=connected(),now=10000;
  for(const id of [1,2,4,6,7])monitor.observe(packet(id),true,'console',now);
  state.status='PAUSED';state.context.gamePaused=true;
  const quality=monitor.quality(state,now+20000);
  assert.equal(quality.confidence,'HIGH');assert.ok(quality.warnings.some(warning=>warning.includes('paused')));
});
