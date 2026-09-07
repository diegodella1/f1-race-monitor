import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState } from './state.js';
import { PitwallStrategy } from './strategy.js';
import { RaceEngineer } from './intelligence.js';
import type { RaceState } from './types.js';

test('Spa observations retain pit exit, damage escalation and factual battle calls',()=>{
  const frames=JSON.parse(readFileSync(new URL('./fixtures/spa-observations.json',import.meta.url),'utf8')) as (Partial<RaceState>&{at:number})[];
  const strategy=new PitwallStrategy(),engineer=new RaceEngineer();
  let exitLap=0,escalation=false;
  for(const frame of frames){
    let state:RaceState={...initialState(),sessionUid:'spa-regression',sessionLinkId:2,sessionType:'Race',track:'Spa',totalLaps:11,...frame};
    state=strategy.analyze(state,frame.at);state=engineer.analyze(state,frame.at);
    if(state.strategy.lastStop)exitLap=state.strategy.lastStop.exitLap;
    const message=state.engineer.primary;
    if(message?.context?.damageAfter===23)escalation=true;
    if(message?.id.startsWith('prediction-')){
      const rival=message.id.startsWith('prediction-ahead-')?state.strategy.ahead:state.strategy.behind;
      assert.ok(rival?.gap!==null&&rival?.gap!==undefined&&rival.gap>1.2);
    }
    assert.ok(!message?.radio?.es.includes('Administrá el resultado'));
    assert.ok(!message?.radio?.es.includes('Objetivo —'));
  }
  assert.equal(exitLap,6);assert.ok(escalation);
});
