import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { messageFamily, scoreMessage } from './scoring.js';
import type { EngineerMessage } from './types.js';

const message=(patch:Partial<EngineerMessage>={}):EngineerMessage=>({id:'pace-note',priority:'info',title:'PACE NOTE',evidence:'Stable race.',action:'Continue.',confidence:50,createdAt:1000,expiresAt:11000,...patch});

test('low-value informational noise stays below the decision threshold',()=>{
  const state=initialState(),result=scoreMessage(message(),state,true,1000);
  assert.equal(result.eligible,false);assert.ok((result.message.score??100)<result.threshold);
});

test('safety calls always remain eligible even with weak telemetry',()=>{
  const state=initialState();state.packetCount=100;state.telemetry.score=10;
  const result=scoreMessage(message({id:'red-flag',priority:'critical',confidence:100}),state,true,1000);
  assert.equal(result.eligible,true);assert.equal(result.message.category,'SAFETY');assert.ok((result.message.score??0)>=90);
});

test('message families collapse lap-specific repetition',()=>{
  assert.equal(messageFamily('prediction-ahead-4-7'),'prediction-ahead');
  assert.equal(messageFamily('mode-push-12'),'race-mode');
  assert.equal(messageFamily('pace-outlook-status-9'),'pace-outlook');
});
