import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioQueue } from './radioQueue';
import { initialState } from '../server/state.js';
import { controlMessages, observeControlCounters } from '../server/raceControl.js';
import type { EngineerMessage, RaceState } from './types';

function setup(){
  const s=initialState();s.status='CONNECTED';s.sessionUid='weather';s.sessionLinkId=1;s.sessionType='Race';s.lap=3;
  s.context.category='RACE';s.context.lifecycle='ACTIVE';s.player.tyre='MEDIUM';s.context.weatherObservedAt=0;
  const message:EngineerMessage={id:'weather-box',eventId:'weather-box-1',title:'BOX FOR INTERMEDIATES',evidence:'Pace evidence',action:'Box',confidence:75,priority:'action',createdAt:0,expiresAt:Number.MAX_SAFE_INTEGER,weather:{epoch:1,kind:'BOX',family:'INTER'},radio:{en:'Box for intermediates.',es:'Box for intermediates.'}};
  s.strategy.weather={epoch:1,observed:'LIGHT_RAIN',confirmed:'LIGHT_RAIN',fresh:true,ageMs:0,forecastAccuracy:'PERFECT',forecast:[],action:'BOX',recommendedFamily:'INTER',transition:true,reason:'Confirmed advantage.',confidence:'MEDIUM',evidence:{rivals:2,gainSeconds:5,netGainSeconds:12,horizonLaps:7},messages:[message]};
  s.engineer.weather=[message];
  const spoken:string[]=[],log:string[]=[];let finish=()=>{};
  const queue=new RadioQueue({speak:(text,callbacks)=>{spoken.push(text);callbacks.start();finish=callbacks.end;},cancel:()=>{},log:(call,status)=>log.push(`${call.message.id}:${status}`)});
  return {s,message,queue,spoken,log,finish:()=>finish()};
}

test('weather boxes survive 30 seconds behind speech, after sanctions and warnings',()=>{
  const {s,queue,spoken,finish}=setup();
  const controlState={...s,updatedAt:0};s.raceControl=observeControlCounters(controlState,2,1);s.context.penalties=2;s.context.warnings=1;s.engineer.control=controlMessages(s,2000);
  queue.update({id:'contact',priority:'critical',title:'Contact',evidence:'',action:'',confidence:99,createdAt:0,expiresAt:60000},s,'Contact',0);
  s.context.weatherObservedAt=35000;queue.update(null,s,'',35000);finish();
  queue.update(null,s,'',35100);assert.match(spoken[1],/penalty/i);finish();
  queue.update(null,s,'',35200);assert.match(spoken[2],/warning/i);finish();
  queue.update(null,s,'',35300);assert.equal(spoken[3],'Box for intermediates.');finish();
  queue.update(null,s,'',35400);assert.equal(spoken.length,4);
});

test('fitting tyres, stale telemetry and finish discard the weather call',()=>{
  for(const change of [(s:RaceState)=>{s.player.tyre='INTER';},(s:RaceState)=>{s.context.weatherObservedAt=-10000;},(s:RaceState)=>{s.context.lifecycle='FINISHED';}]){
    const {s,queue,spoken,log}=setup();change(s);queue.update(null,s,'',1000);assert.equal(spoken.length,0);assert.ok(log.some(entry=>entry.endsWith(':EXPIRED')));
  }
});

test('updated forecast replaces the queued old forecast and descriptive notices expire',()=>{
  const {s,message,queue,spoken,finish}=setup();message.weather!.kind='FORECAST';message.expiresAt=60000;
  queue.update({id:'contact',priority:'critical',title:'Contact',evidence:'',action:'',confidence:99,createdAt:0,expiresAt:60000},s,'Contact',0);
  const newer={...message,id:'forecast-new',eventId:'forecast-new',radio:{en:'Rain in five minutes, 70 percent chance.',es:''}};
  s.engineer.weather=[newer];s.strategy.weather!.messages=[newer];queue.update(null,s,'',1000);finish();queue.update(null,s,'',2000);
  assert.deepEqual(spoken,['Contact',newer.radio.en]);
  finish();s.context.weatherObservedAt=61000;queue.update(null,s,'',61000);assert.equal(spoken.length,2);
});

test('a changed weather assessment cancels speech already in progress',()=>{
  const {s,queue,log}=setup();queue.update(null,s,'',0);
  s.player.tyre='INTER';queue.update(null,s,'',1000);assert.ok(log.some(event=>event==='weather-box:CANCELLED'));
});
