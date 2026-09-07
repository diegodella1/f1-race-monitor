import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { RaceEngineer } from './intelligence.js';

function race() {
  const s = initialState();
  s.status = 'CONNECTED'; s.sessionUid = 'spa'; s.sessionLinkId = 2;
  s.context.category = 'RACE'; s.context.lifecycle = 'ACTIVE';
  s.lap = 7; s.totalLaps = 11; s.telemetry.score = 100;
  s.player.fuel = 20; s.player.fuelRemainingLaps = 1; s.player.ers = 60;
  return s;
}

test('a rival already six tenths behind never generates a catch prediction', () => {
  const s = race();
  s.strategy.behind = {name:'VERSTAPPEN',vehicleIndex:3,position:2,gap:.6,rate:-.38,direction:'LOSING',laps:4,catchLaps:1.6,tyre:'MEDIUM',tyreAge:2,pit:false};
  assert.ok(!new RaceEngineer().analyze(s, 1000).engineer.primary?.id.startsWith('prediction-'));
});

test('pit exit and push are one instruction', () => {
  const s = race(), engineer = new RaceEngineer();
  s.strategy.raceMode = 'PUSH';
  s.strategy.recommendation = {id:'strategy-pit-exit-5',title:'PIT EXIT: P7',priority:'opportunity',evidence:'P7',action:'Push for two laps.',confidence:94,createdAt:1000,expiresAt:30000};
  const result = engineer.analyze(s, 1000);
  assert.equal(result.engineer.primary?.id, 'strategy-pit-exit-5');
  assert.ok(!result.engineer.log.some(e => e.id.startsWith('mode-push-')));
});

test('a required stop can replace another ordinary message in the same lap', () => {
  const s = race(), engineer = new RaceEngineer();
  s.strategy.raceMode = 'DEFEND';
  engineer.analyze(s,1000);
  s.strategy.recommendation = {id:'strategy-box-mandatory',priority:'action',title:'BOX THIS LAP',evidence:'Required compound.',action:'Box now.',confidence:98,createdAt:2000,expiresAt:20000};
  assert.equal(engineer.analyze(s,4000).engineer.primary?.id, 'strategy-box-mandatory');
});

test('damage escalation names the part and both measurements',()=>{
  const s=race(),engineer=new RaceEngineer();s.context.damage.frontWing=11;
  engineer.analyze(s,1000);s.lap=8;s.context.damage.frontWing=23;
  const result=engineer.analyze(s,100000);
  assert.match(result.engineer.primary?.radio?.es??'',/alerón delantero.*11.*23/);
});

test('continuous condition retains its event identity and frozen voice',()=>{
  const s=race(),engineer=new RaceEngineer();s.player.tyreTemps=[115,115,115,115];
  engineer.analyze(s,1000);const a=engineer.analyze(s,5000).engineer.primary;
  const b=engineer.analyze(s,6000).engineer.primary;
  assert.ok(a?.eventId);assert.equal(a?.eventId,b?.eventId);assert.deepEqual(a?.radio,b?.radio);
});
