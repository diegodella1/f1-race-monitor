import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { PitwallStrategy } from './strategy.js';
import type { RaceState } from './types.js';

function race(lap:number,aheadGap:number,behindGap:number,lastLap='—',wear=30):RaceState {
  const s=initialState();
  s.status='CONNECTED';s.sessionUid='strategy-test';s.sessionLinkId=7;s.sessionType='Race';s.context.category='RACE';s.lap=lap;s.totalLaps=30;s.sessionTime=lap*90;s.context.pitWindowIdeal=8;s.context.pitWindowLatest=12;s.context.pitRejoinPosition=6;s.context.tyreWear=[wear,wear-1,wear-3,wear-3];
  s.player.position=2;s.player.driver='PLAYER';s.player.tyre='MEDIUM';s.player.tyreAge=lap+3;s.player.lastLap=lastLap;s.player.driverStatus=4;
  s.drivers=[
    {vehicleIndex:0,position:1,name:'AHEAD',team:'Ferrari',lap,sector:1,gap:'LEADER',interval:'—',tyre:'MEDIUM',tyreAge:lap+6,pit:false},
    {vehicleIndex:1,position:2,name:'PLAYER',team:'McLaren',lap,sector:1,gap:`+${aheadGap.toFixed(3)}`,interval:`+${aheadGap.toFixed(3)}`,tyre:'MEDIUM',tyreAge:lap+3,pit:false},
    {vehicleIndex:2,position:3,name:'BEHIND',team:'Mercedes',lap,sector:1,gap:`+${(aheadGap+behindGap).toFixed(3)}`,interval:`+${behindGap.toFixed(3)}`,tyre:'HARD',tyreAge:lap+8,pit:false}
  ];
  return s;
}

test('learns multi-lap rival direction and stint degradation from clean laps',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(1,2,1.2));
  model.analyze(race(2,1.7,1.3,'1:30.000'));
  model.analyze(race(3,1.4,1.4,'1:30.200'));
  const result=model.analyze(race(4,1.1,1.5,'1:30.400'));
  assert.equal(result.strategy.status,'READY');
  assert.equal(result.strategy.ahead?.direction,'GAINING');
  assert.equal(result.strategy.behind?.direction,'GAINING');
  assert.ok(Math.abs((result.strategy.ahead?.rate??0)+.3)<.001);
  assert.ok(Math.abs((result.strategy.stint.degradationMs??0)-200)<1);
});

test('does not learn pace from an invalid lap',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(1,2,2));
  const invalid=race(2,1.8,1.9,'1:30.000');invalid.context.lapInvalid=true;model.analyze(invalid);
  const result=model.analyze(race(3,1.6,1.8,'1:35.000'));
  assert.equal(result.strategy.stint.cleanLaps,1);
  assert.equal(result.strategy.ahead?.direction,'LEARNING');
});

test('calls a stop only after enough reliable degradation evidence',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(5,2.6,2));
  model.analyze(race(6,2.4,2.1,'1:30.000',45));
  model.analyze(race(7,2.2,2.2,'1:30.400',48));
  model.analyze(race(8,2,2.3,'1:30.800',54));
  model.analyze(race(9,1.9,2.4,'1:31.200',56));
  const result=model.analyze(race(10,1.8,2.5,'1:31.600',58));
  assert.equal(result.strategy.recommendation?.id,'strategy-box');
  assert.equal(result.strategy.recommendation?.priority,'action');
});

test('never recommends a stop on the final lap or after the finish',()=>{
  const model=new PitwallStrategy(),state=race(30,2,2,'1:31.000',80);state.context.lifecycle='FINAL_LAP';
  assert.equal(model.analyze(state).strategy.recommendation,null);
  state.context.lifecycle='FINISHED';state.status='PAUSED';
  assert.equal(model.analyze(state).strategy.recommendation,null);
  assert.notEqual(model.analyze(state).strategy.raceMode,'BOX');
});

test('does not call a stop from noisy degradation with low tyre wear',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(4,8,4));
  model.analyze(race(5,8,4,'1:30.000',12));
  model.analyze(race(6,8,4,'1:30.500',14));
  model.analyze(race(7,8,4,'1:31.000',15));
  const result=model.analyze(race(8,8,4,'1:31.500',16));
  assert.equal(result.strategy.recommendation,null);
});

test('learns observed pit loss from the change in gap to the leader',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(1,10,3));
  const entry=race(1,10,3);entry.player.pit=true;entry.sessionTime=100;model.analyze(entry);
  const exit=race(1,32,3);exit.player.pit=false;exit.sessionTime=122;
  const result=model.analyze(exit);
  assert.equal(result.strategy.pitLossSeconds,22);
  assert.equal(result.strategy.plan.pitLossSource,'OBSERVED');
  assert.equal(result.strategy.plan.pitLossSeconds,22);
});

test('finds an undercut from degradation and rejoin traffic without using the game window',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(5,1.5,4));
  model.analyze(race(6,1.5,4,'1:30.000',55));
  model.analyze(race(7,1.4,4,'1:30.250',57));
  const final=race(8,1.4,4,'1:30.500',59);final.context.pitWindowIdeal=0;final.context.pitWindowLatest=0;
  const result=model.analyze(final);
  assert.equal(result.strategy.plan.status,'READY');
  assert.ok((result.strategy.plan.undercutGainSeconds??0)>=.6);
  assert.equal(result.strategy.recommendation?.id,'strategy-undercut');
});

test('recommends the overcut when the rival stops and one more lap is favorable',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(4,1.4,4));
  model.analyze(race(5,1.4,4,'1:30.000',35));
  model.analyze(race(6,1.4,4,'1:30.100',37));
  const final=race(7,1.4,4,'1:30.200',39);final.drivers[0].pit=true;
  const result=model.analyze(final);
  assert.ok((result.strategy.plan.overcutGainSeconds??0)>=.5);
  assert.equal(result.strategy.recommendation?.id,'strategy-overcut');
});

test('plans and calls the mandatory dry-compound stop in a short race',()=>{
  const model=new PitwallStrategy(),start=race(1,4,5);start.totalLaps=13;model.analyze(start);
  const window=race(5,4,5);window.totalLaps=13;
  const planned=model.analyze(window);
  assert.deepEqual(planned.strategy.rules.compoundsUsed,['MEDIUM']);
  assert.equal(planned.strategy.rules.recommendedPitLap,7);
  assert.equal(planned.strategy.recommendation?.id,'strategy-mandatory-window');
  const next=race(6,4,5);next.totalLaps=13;
  assert.equal(model.analyze(next).strategy.recommendation?.id,'strategy-box-next');
  const due=race(7,4,5);due.totalLaps=13;
  assert.equal(model.analyze(due).strategy.recommendation?.id,'strategy-box-mandatory');
});

test('marks the mandatory strategy complete and reports the pit exit',()=>{
  const model=new PitwallStrategy(),start=race(1,4,5);start.totalLaps=13;model.analyze(start);
  const entry=race(7,4,5);entry.totalLaps=13;entry.player.pit=true;entry.sessionTime=600;model.analyze(entry);
  const exit=race(8,28,5);exit.totalLaps=13;exit.player.tyre='SOFT';exit.player.tyreAge=1;exit.sessionTime=625;
  const result=model.analyze(exit);
  assert.equal(result.strategy.rules.mandatoryStopComplete,true);
  assert.deepEqual(result.strategy.rules.compoundsUsed,['MEDIUM','SOFT']);
  assert.match(result.strategy.recommendation?.id??'',/^strategy-pit-exit-/);
  assert.equal(result.strategy.lastStop?.actualLossSeconds,24);
  assert.equal(result.strategy.lastStop?.exitLap,8);
});

test('projects rejoin position from the field gaps instead of the game hint',()=>{
  const model=new PitwallStrategy(),state=race(1,4,5);state.totalLaps=13;state.track='Monza';state.player.position=1;state.context.pitRejoinPosition=12;
  state.drivers=Array.from({length:7},(_,i)=>({vehicleIndex:i,position:i+1,name:i?'D'+i:'PLAYER',team:'Team',lap:1,sector:1,gap:i?`+${i*5}.000`:'LEADER',interval:i?`+5.000`:'—',tyre:'MEDIUM' as const,tyreAge:4,pit:false}));
  const result=model.analyze(state);
  assert.equal(result.strategy.plan.rejoinPosition,5);
  assert.equal(result.strategy.plan.rejoinMin,5);
  assert.equal(result.strategy.plan.rejoinMax,6);
  assert.equal(result.strategy.plan.rejoinRival,'D5');
});

test('sets a useful race mode and lap-time target while leading',()=>{
  const model=new PitwallStrategy(),state=race(2,4,5,'1:26.000');state.totalLaps=13;state.player.position=1;
  state.drivers[0].name='PLAYER';state.drivers[0].position=1;state.drivers[1].name='BEHIND';state.drivers[1].position=2;state.drivers[1].interval='+5.000';state.drivers=state.drivers.slice(0,2);
  const result=model.analyze(state);
  assert.equal(result.strategy.raceMode,'MANAGE');
  assert.equal(result.strategy.targetLapTime,'1:26.600');
});

test('holds tactical modes for two laps and never returns to learning mid-race',()=>{
  const model=new PitwallStrategy();
  model.analyze(race(1,3,3));
  model.analyze(race(2,3,3,'1:30.000'));
  const attack=model.analyze(race(3,1.1,3,'1:30.100'));
  assert.equal(attack.strategy.raceMode,'ATTACK');
  const threat=race(4,3,.8,'1:30.200');
  assert.equal(model.analyze(threat).strategy.raceMode,'ATTACK');
  const defend=race(5,3,.8,'1:30.300');
  assert.equal(model.analyze(defend).strategy.raceMode,'DEFEND');
  const newStint=race(7,5,5,'—');newStint.player.tyre='SOFT';newStint.player.tyreAge=0;
  assert.notEqual(model.analyze(newStint).strategy.raceMode,'LEARNING');
});
