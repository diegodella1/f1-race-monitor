import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RaceEngineer } from '../server/intelligence.js';
import { initialState } from '../server/state.js';
import type { RaceIncident } from '../server/types.js';
import { selectRadioMessage } from './radioLogic';
import { RadioQueue } from './radioQueue';

test('Bahrain lap-one penalty reaches browser completion despite recorded contacts',()=>{
  const frames=JSON.parse(readFileSync(new URL('../server/fixtures/bahrain-control-observations.json',import.meta.url),'utf8')) as {
    at:number;sessionTime:number;lap:number;penalties:number;warnings:number;incidents:RaceIncident[];
  }[];
  const engineer=new RaceEngineer(),events:{id:string;status:string;at:number;text:string}[]=[];
  let now=0,completeAt=Infinity,complete=()=>{};
  const queue=new RadioQueue({
    speak:(_text,callbacks)=>{callbacks.start();complete=callbacks.end;completeAt=now+1800;},
    cancel:()=>{completeAt=Infinity;},
    log:(call,status)=>events.push({id:call.message.id,status,at:now,text:call.text}),
  });
  let snapshot=initialState();
  for(const [index,frame] of frames.entries()){
    const state=initialState();state.sessionUid='bahrain-regression';state.sessionLinkId=9;
    state.sessionType='Race';state.track='Bahrain';state.status='CONNECTED';state.totalLaps=3;
    state.lap=frame.lap;state.sessionTime=frame.sessionTime;state.updatedAt=frame.at;
    state.context={...state.context,category:'RACE',lifecycle:'ACTIVE',penalties:frame.penalties,warnings:frame.warnings,incidents:frame.incidents};
    state.player.position=1;state.player.ers=100;
    state.drivers=[{vehicleIndex:21,position:1,name:'PLAYER',team:'TEST',lap:frame.lap,sector:1,gap:'LEADER',interval:'—',tyre:'MEDIUM',tyreAge:0,pit:false}];
    snapshot=engineer.analyze(state,frame.at);
    const until=frames[index+1]?.at??frame.at+3000;
    for(now=frame.at;now<until;now+=100){
      if(now>=completeAt){completeAt=Infinity;complete();}
      const message=selectRadioMessage(snapshot);
      queue.update(message,snapshot,message?.radio?.en??'',now);
    }
  }
  const sanctions=events.filter(event=>event.status==='COMPLETED'&&/2-second penalty/i.test(event.text));
  assert.equal(sanctions.length,1);
  const firstPenalty=frames.find(frame=>frame.penalties===2)!;
  assert.ok(sanctions[0].at>=firstPenalty.at);
  assert.ok(sanctions[0].at-firstPenalty.at<10000,'A contact must not hold the penalty until its 30-second expiry');
  assert.ok(events.some(event=>event.status==='STARTED'&&event.id.startsWith('incident-collision-')));
  assert.equal(snapshot.engineer.log.filter(event=>event.id.startsWith('control-')&&event.status==='EMITTED').length,1);
});
