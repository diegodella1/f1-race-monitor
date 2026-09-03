import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingCoach } from './coach.js';
import { initialState } from './state.js';

function coachState(){const state=initialState();state.status='CONNECTED';state.sessionUid='coach';state.sessionLinkId=1;state.sessionType='Practice 1';state.track='Monza';state.context.category='PRACTICE';state.context.trackLength=6000;state.player.driverStatus=4;return state;}
function sampleLap(coach:DrivingCoach,state:ReturnType<typeof coachState>,lap:number,start:number,earlySecond=false,invalid=false){state.lap=lap;state.context.lapInvalid=invalid;for(let i=0;i<120;i++){const inCorner=[20,55,90].some(x=>i>=x&&i<=x+8),brakePoints=[15,earlySecond?45:50,85];state.player.lapDistance=i*50;state.player.steer=inCorner?.32:0;state.player.brake=brakePoints.some(x=>i>=x&&i<=x+7)?70:0;state.player.throttle=state.player.brake?0:100;state.player.speed=inCorner?120:250;coach.analyze(state,start+i*100);}state.context.lapInvalid=false;}

test('coach exposes lap traces, ignores invalid laps and waits for a repeated issue',()=>{
  const coach=new DrivingCoach(),state=coachState();sampleLap(coach,state,1,1000);state.player.lastLap='1:30.000';let result=coach.analyze({...state,lap:2},14000);assert.equal(result.coach.lapsLearned,1);assert.equal(result.coach.analysis.referenceLap,1);assert.ok(result.coach.analysis.reference.length>=30);
  sampleLap(coach,state,2,15000,true,true);state.player.lastLap='1:31.000';result=coach.analyze({...state,lap:3},28000);assert.equal(result.coach.lapsLearned,1);assert.equal(result.coach.message,null);
  sampleLap(coach,state,3,29000,true);state.player.lastLap='1:31.000';result=coach.analyze({...state,lap:4},42000);assert.equal(result.coach.message,null);assert.ok(result.coach.analysis.insights.some(x=>/CORNER 2/.test(x.title)));
  sampleLap(coach,state,4,43000,true);state.player.lastLap='1:31.000';result=coach.analyze({...state,lap:5},56000);assert.match(result.coach.message?.title||'',/CORNER 2/);assert.match(result.coach.message?.evidence||'',/Repeated on 2 clean laps/);assert.ok(result.coach.analysis.corners.length>=3);
});

test('normal tyre damage does not block a clean lap reference',()=>{const coach=new DrivingCoach(),state=coachState();state.context.damage.tyres=25;sampleLap(coach,state,1,1000);state.player.lastLap='1:30.000';const result=coach.analyze({...state,lap:2},14000);assert.equal(result.coach.analysis.referenceLap,1);assert.equal(result.coach.lapsLearned,1)});
