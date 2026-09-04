import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceEngineer } from './intelligence.js';
import { initialState } from './state.js';

function race(){const s=initialState();s.status='CONNECTED';s.sessionUid='test';s.sessionLinkId=1;s.sessionType='Race';s.context.category='RACE';s.context.lifecycle='ACTIVE';s.player.position=2;s.player.driver='PLAYER';s.player.fuel=30;s.player.fuelRemainingLaps=2;s.player.ers=60;s.drivers=[{vehicleIndex:0,position:1,name:'AHEAD',team:'Ferrari',lap:3,sector:1,gap:'LEADER',interval:'—',tyre:'MEDIUM',tyreAge:8,pit:false},{vehicleIndex:1,position:2,name:'PLAYER',team:'Alpine',lap:3,sector:1,gap:'+0.800',interval:'+0.800',tyre:'SOFT',tyreAge:2,pit:false},{vehicleIndex:2,position:3,name:'BEHIND',team:'McLaren',lap:3,sector:1,gap:'+2.600',interval:'+1.800',tyre:'HARD',tyreAge:10,pit:false}];return s}

test('does not announce an obvious DRS gap when monitoring starts',()=>{const engineer=new RaceEngineer(),state=race();assert.equal(engineer.analyze(state,1000).engineer.primary,null);assert.equal(engineer.analyze(state,5000).engineer.primary,null)});
test('announces DRS only when the same rival crosses into range',()=>{const engineer=new RaceEngineer(),state=race();state.drivers[1].interval='+1.400';engineer.analyze(state,1000);state.drivers[1].interval='+0.900';const result=engineer.analyze(state,2000);assert.match(result.engineer.primary?.id??'',/^drs-attack-/);assert.equal(result.engineer.primary?.priority,'opportunity')});
test('does not repeat the same DRS call after its cooldown starts',()=>{const engineer=new RaceEngineer(),state=race();state.drivers[1].interval='+1.400';engineer.analyze(state,1000);state.drivers[1].interval='+0.900';engineer.analyze(state,2000);engineer.analyze(state,12000);state.drivers[1].interval='+1.400';engineer.analyze(state,13000);state.drivers[1].interval='+0.900';assert.equal(engineer.analyze(state,14000).engineer.primary,null)});
test('predicts a multi-lap catch from the strategy trend',()=>{const state=race();state.totalLaps=20;state.lap=5;state.strategy.ahead={name:'AHEAD',position:1,gap:2,rate:-.5,direction:'GAINING',laps:4,catchLaps:4,tyre:'MEDIUM',tyreAge:8,pit:false};const result=new RaceEngineer().analyze(state,1000);assert.match(result.engineer.primary?.id??'',/^prediction-ahead-/);assert.match(result.engineer.primary?.title??'',/4 LAPS/)});
test('tyre wear alone is not reported as structural car damage',()=>{const state=race();state.context.damage.tyres=45;assert.equal(new RaceEngineer().analyze(state,1000).engineer.primary,null)});
test('critical damage overrides an attack opportunity',()=>{const state=race();state.context.damage.frontWing=72;const result=new RaceEngineer().analyze(state);assert.match(result.engineer.primary?.id??'',/^damage-frontWing-60-/);assert.equal(result.engineer.primary?.priority,'critical')});
test('safety messages override a strategy call',()=>{const state=race(),now=1000;state.flag='RED';state.strategy.recommendation={id:'strategy-undercut',priority:'opportunity',title:'UNDERCUT AVAILABLE',evidence:'Three clean laps support the call.',action:'Box before the car ahead.',confidence:94,createdAt:now,expiresAt:now+12000};const result=new RaceEngineer().analyze(state,now);assert.equal(result.engineer.primary?.id,'red-flag');assert.equal(result.engineer.primary?.priority,'critical')});

test('a quiet 15-lap race produces useful pulses without becoming repetitive',()=>{
  const engineer=new RaceEngineer(),state=race(),emitted:string[]=[];state.totalLaps=20;state.packetCount=500;state.telemetry.score=100;state.telemetry.confidence='HIGH';state.strategy.status='READY';state.strategy.raceMode='MANAGE';state.strategy.targetLapTime='1:35.500';
  state.strategy.ahead={name:'AHEAD',position:1,gap:4.2,rate:0,direction:'STABLE',laps:5,catchLaps:null,tyre:'MEDIUM',tyreAge:8,pit:false};
  state.strategy.behind={name:'BEHIND',position:3,gap:5.1,rate:0,direction:'STABLE',laps:5,catchLaps:null,tyre:'HARD',tyreAge:10,pit:false};
  let previous='';
  for(let lap=1;lap<=15;lap++){state.lap=lap;const now=lap*10000;engineer.analyze(state,now);const result=engineer.analyze(state,now+2000),id=result.engineer.primary?.id??'';if(id&&id!==previous)emitted.push(id);previous=id;}
  assert.ok(emitted.length>=4);assert.ok(emitted.length<=6);assert.ok(emitted.every(id=>id.startsWith('pace-outlook-')||id.startsWith('mode-')));assert.equal(new Set(emitted).size,emitted.length);
});

test('the engineer exposes score, next action and suppression metrics',()=>{
  const state=race(),now=1000;state.packetCount=100;state.telemetry.score=100;state.strategy.recommendation={id:'strategy-undercut',priority:'opportunity',title:'UNDERCUT AVAILABLE',evidence:'Pit exit is clear.',action:'Box before the car ahead.',confidence:94,createdAt:now,expiresAt:now+12000};state.context.damage.frontWing=35;
  const engineer=new RaceEngineer();engineer.analyze(state,now);const result=engineer.analyze(state,now+2000);
  assert.match(result.engineer.primary?.id??'',/^damage-frontWing-30-/);assert.ok((result.engineer.primary?.score??0)>0);assert.equal(result.engineer.next?.id,'strategy-undercut');assert.ok(result.engineer.metrics.candidates>=2);
});

test('persistent damage becomes context, accepts a no-repair stop and only re-alerts on escalation',()=>{
  const engineer=new RaceEngineer(),state=race();state.lap=4;state.context.damage.frontWing=43;
  let result=engineer.analyze(state,1000);
  assert.match(result.engineer.primary?.id??'',/^damage-frontWing-30-/);
  assert.equal(result.engineer.conditions[0]?.status,'NEW');
  state.lap=5;result=engineer.analyze(state,12000);
  assert.equal(result.engineer.conditions[0]?.status,'KNOWN');
  assert.ok(!result.engineer.primary?.id.startsWith('damage-frontWing'));
  state.player.pit=true;engineer.analyze(state,13000);
  state.player.pit=false;state.lap=6;result=engineer.analyze(state,14000);
  assert.equal(result.engineer.conditions[0]?.status,'ACCEPTED');
  state.context.damage.frontWing=65;result=engineer.analyze(state,15000);
  assert.equal(result.engineer.conditions[0]?.status,'ESCALATED');
  assert.match(result.engineer.primary?.id??'',/^damage-frontWing-60-/);
});

test('one-shot pit exit call bypasses signal confirmation',()=>{
  const engineer=new RaceEngineer(),state=race(),now=1000;
  state.strategy.recommendation={id:'strategy-pit-exit-7',priority:'opportunity',title:'PIT EXIT: P20',evidence:'Inside predicted range.',action:'Push for two laps.',confidence:94,createdAt:now,expiresAt:now+12000};
  assert.equal(engineer.analyze(state,now).engineer.primary?.id,'strategy-pit-exit-7');
});

test('announces the final lap once and keeps one factual finish message',()=>{
  const engineer=new RaceEngineer(),state=race();state.totalLaps=10;state.lap=10;state.context.lifecycle='FINAL_LAP';state.strategy.rules.stops=1;state.strategy.rules.compoundsUsed=['MEDIUM','SOFT'];state.player.bestLap='1:30.123';
  let result=engineer.analyze(state,1000);assert.equal(result.engineer.primary?.id,'final-lap');
  result=engineer.analyze(state,2000);assert.equal(result.engineer.log.filter(item=>item.id==='final-lap'&&item.status==='EMITTED').length,1);
  state.status='PAUSED';state.context.lifecycle='FINISHED';state.player.position=1;result=engineer.analyze(state,3000);
  assert.equal(result.engineer.primary?.id,'race-finished');assert.equal(result.sessionSummary?.finalPosition,1);assert.equal(result.sessionSummary?.positionsGained,1);assert.equal(result.sessionSummary?.stops,1);
  result=engineer.analyze(state,4000);assert.equal(result.engineer.log.filter(item=>item.id==='race-finished'&&item.status==='EMITTED').length,1);
});

test('speaks only incidents involving the player or an immediate rival',()=>{
  const engineer=new RaceEngineer(),state=race();state.context.incidents=[{id:'far',kind:'COLLISION',lap:3,at:1000,vehicleIndices:[7,8],title:'Cars 8 / 9',detail:'Collision.',severity:'warning'}];
  assert.equal(engineer.analyze(state,1000).engineer.primary,null);
  state.context.incidents=[{id:'near',kind:'COLLISION',lap:3,at:2000,vehicleIndices:[0,7],title:'AHEAD / Car 8',detail:'Collision.',severity:'warning'},...state.context.incidents];
  assert.match(engineer.analyze(state,2000).engineer.primary?.id??'',/^incident-collision-/);
});
