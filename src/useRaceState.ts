import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { RaceState } from './types';
const strategy:RaceState['strategy']={status:'LEARNING',ahead:null,behind:null,gapHistory:[],stint:{compound:'—',age:0,cleanLaps:0,averageLapMs:null,degradationMs:null,paceDeltaMs:null,wear:0},pitLossSeconds:null,rejoinPosition:0,plan:{status:'LEARNING',pitLossSeconds:22,pitLossSource:'TRACK_ESTIMATE',traffic:'UNKNOWN',rejoinPosition:0,rejoinMin:0,rejoinMax:0,rejoinRival:'',horizonLaps:0,freshTyreGainSeconds:null,stayOneMoreCostSeconds:null,undercutGainSeconds:null,overcutGainSeconds:null,confidence:0},rules:{mandatoryStopRequired:false,mandatoryStopComplete:true,compoundsUsed:[],stops:0,windowStart:null,recommendedPitLap:null,windowEnd:null,latestSafePitLap:null},raceMode:'LEARNING',modeReason:'Waiting for race data',targetLapTime:'—',targetLapDeltaMs:null,lastStop:null,decisions:[],recommendation:null};
const empty:RaceState={status:'WAITING',sessionUid:'',sessionLinkId:0,sessionTime:0,sessionType:'Unknown',track:'Waiting for F1 25',weather:'—',lap:0,totalLaps:0,safetyCar:'NONE',flag:'GREEN',context:{category:'UNKNOWN',lifecycle:'PRE_RACE',timeLeft:0,trackLength:0,trackTemp:0,airTemp:0,gamePaused:false,weatherForecast:[],pitWindowIdeal:0,pitWindowLatest:0,pitRejoinPosition:0,currentLapTime:'—',sector1:'—',sector2:'—',lapInvalid:false,penalties:0,warnings:0,gridPosition:0,tyreWear:[0,0,0,0],damage:{frontWing:0,rearWing:0,floor:0,diffuser:0,sidepod:0,gearbox:0,engine:0,tyres:0,brakes:0},incidents:[]},player:{position:0,driver:'PLAYER',team:'—',speed:0,gear:0,rpm:0,throttle:0,brake:0,steer:0,lapDistance:0,drs:false,fuel:0,fuelRemainingLaps:0,ers:0,tyre:'—',tyreAge:0,tyreTemps:[0,0,0,0],brakeTemps:[0,0,0,0],frontWing:0,damage:0,pit:false,driverStatus:0,lastLap:'—',bestLap:'—'},drivers:[],alerts:[],sessionSummary:null,telemetry:{score:0,confidence:'NONE',packetsPerSecond:0,ageMs:null,validPackets:0,invalidPackets:0,source:null,packets:[],missing:[1,2,4,6,7],warnings:['Waiting for telemetry'],replayReady:false},engineer:{primary:null,next:null,secondary:[],conditions:[],log:[],metrics:{candidates:0,eligible:0,suppressed:0,lastMessageLap:0,silenceReason:'Waiting for telemetry'}},coach:{status:'LEARNING',lapsLearned:0,cornersLearned:0,message:null,analysis:{currentLap:0,referenceLap:null,referenceLapTime:'—',current:[],reference:[],corners:[],insights:[],quality:{invalid:false,pit:false,unsafe:false}}},strategy,updatedAt:Date.now(),packetCount:0};
export function useRaceState(){
  const [state,setState]=useState(empty);
  useEffect(()=>{
    const abort=new AbortController();let receivedStream=false,lastReceivedAt=Date.now(),snapshot=empty,analysisBusy=false;let analysis:RaceState['coach']|null=null;
    const update=()=>{const elapsed=Date.now()-lastReceivedAt;setState({...snapshot,coach:location.pathname==='/analysis'&&analysis?analysis:snapshot.coach,transport:{connected:socket.connected,stale:elapsed>2500,lastReceivedAt,clockOffsetMs:snapshot.serverTime===undefined?0:snapshot.serverTime-lastReceivedAt},telemetry:{...snapshot.telemetry,ageMs:snapshot.telemetry.ageMs===null?null:snapshot.telemetry.ageMs+elapsed}});};
    fetch('/api/state',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])}).then(r=>r.json()).then(value=>{if(!receivedStream&&!abort.signal.aborted&&value.sessionUid!==undefined){lastReceivedAt=Date.now();applySnapshot(value);}}).catch(()=>{});
    const socket=io({transports:['websocket']});
    function applySnapshot(value:RaceState){if(value.sessionUid!==snapshot.sessionUid||value.sessionLinkId!==snapshot.sessionLinkId)analysis=null;snapshot=value;update();}
    socket.on('streamReset',()=>{socket.disconnect();socket.connect();});
    socket.on('connect_error',()=>{void fetch('/api/auth/me').then(r=>{if(r.status===401)window.dispatchEvent(new Event('pairing-required'));}).catch(()=>{});});
    socket.on('connect',()=>{update();socket.emit('raceStreamReady');});
    socket.on('raceState',(snapshot:RaceState,ack?:()=>void)=>{
      receivedStream=true;lastReceivedAt=Date.now();applySnapshot(snapshot);if(typeof ack==='function')ack();
    });
    socket.on('disconnect',()=>setState(previous=>({...previous,status:'PAUSED'})));
    const timer=setInterval(()=>{
      update();
      if(location.pathname!=='/analysis'||document.visibilityState!=='visible'||analysisBusy)return;
      analysisBusy=true;
      void fetch('/api/analysis',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])}).then(r=>r.ok?r.json():null).then(data=>{if(data&&data.sessionUid===snapshot.sessionUid&&data.sessionLinkId===snapshot.sessionLinkId){analysis=data.coach;update();}}).catch(()=>{}).finally(()=>{analysisBusy=false;});
    },1000);
    return()=>{clearInterval(timer);abort.abort();socket.disconnect();};
  },[]);
  return state;
}
