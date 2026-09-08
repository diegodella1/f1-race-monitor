import type { EngineerMessage, RaceState } from './types.js';
import { weatherDataAge, WEATHER_LIMITS } from './weather.js';
import { tyreFamily } from './weatherEvidence.js';
type Context=Pick<RaceState,'raceControl'|'strategy'|'player'|'context'|'lap'|'sessionUid'|'sessionLinkId'|'sessionType'|'telemetry'|'updatedAt'|'status'> & {safetyCar:string;flag:string;drivers:{position:number;name:string;vehicleIndex?:number}[]};

export function messageIsCurrent(message:EngineerMessage,state:Context,now:number){
  if(message.expiresAt<=now||(message.validUntilLap??state.lap)<state.lap)return false;
  if(message.sessionKey&&message.sessionKey!==`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`)return false;
  if(message.weather){
    const weather=state.strategy.weather,age=weatherDataAge(state,now);
    if(!weather?.fresh||age===null||age>WEATHER_LIMITS.sessionAgeMs||state.context.gamePaused||!['CONNECTED','DEMO'].includes(state.status))return false;
    if(['FINISHED','RETIRED'].includes(state.context.lifecycle)||weather.epoch!==message.weather.epoch)return false;
    if(!weather.messages.some(current=>current.eventId===message.eventId))return false;
    return message.weather.kind!=='BOX'||(weather.action==='BOX'&&state.flag==='GREEN'&&state.safetyCar==='NONE'&&!state.player.pit&&tyreFamily(state.player.tyre)!==message.weather.family);
  }
  if(message.control){
    if(message.control.generation!==(state.raceControl?.generation??0))return false;
    if(message.control.kind==='SUMMARY')return message.control.penalties===state.context.penalties&&message.control.warnings===state.context.warnings;
    if(message.control.kind==='WARNING'&&['FINISHED','RETIRED'].includes(state.context.lifecycle))return false;
    return !!state.raceControl?.events.some(event=>event.id===message.control!.eventId&&event.active);
  }
  const id=(position:number)=>{const d=state.drivers.find(d=>d.position===position);return String(d?.vehicleIndex??d?.name??'');};
  const m=message;
  if(state.strategy.weather?.transition&&(m.id.startsWith('coach-')||m.id.startsWith('pace-outlook-')||m.id.startsWith('mode-push-')))return false;
  if(['FINISHED','RETIRED'].includes(state.context.lifecycle)&&!['race-finished','race-retired'].includes(m.id))return false;
  if(m.id==='hot-tyres')return Math.max(...state.player.tyreTemps)>110;
  if(m.id==='low-ers')return state.player.ers<15;
  if(m.id==='low-fuel')return state.player.fuel>0&&state.player.fuelRemainingLaps<-.05;
  if(m.id==='fuel-margin')return state.player.fuel>0&&state.player.fuelRemainingLaps>=0&&state.player.fuelRemainingLaps<.35;
  if(m.id==='safety-car')return state.safetyCar!=='NONE';
  if(m.id==='red-flag')return state.flag==='RED';
  if(m.id.startsWith('damage-')){const key=m.id.split('-')[1] as keyof RaceState['context']['damage'];return (state.context.damage[key]??0)>=10;}

  if(m.id==='final-lap')return state.context.lifecycle==='FINAL_LAP';
  if(m.id==='race-finished')return state.context.lifecycle==='FINISHED';
  if(m.id==='race-retired')return state.context.lifecycle==='RETIRED';
  if(m.id.startsWith('prediction-')){
    const ahead=m.id.startsWith('prediction-ahead-'),rival=ahead?state.strategy.ahead:state.strategy.behind;
    const expected=ahead?m.context?.aheadId:m.context?.behindId;
    return !!rival&&!rival.pit&&rival.gap!==null&&rival.gap>1.2&&(!expected||expected===id(state.player.position+(ahead?-1:1)));
  }
  if(m.id.startsWith('drs-')){
    const ahead=m.id.startsWith('drs-attack-'),expected=ahead?m.context?.aheadId:m.context?.behindId;
    return !expected||expected===id(state.player.position+(ahead?-1:1));
  }
  if(m.id.startsWith('mode-')||m.id.startsWith('pace-outlook-')||m.id.startsWith('strategy-pit-exit-'))return !m.context?.mode||m.context.mode===state.strategy.raceMode;
  if(m.id.startsWith('strategy-box'))return !state.player.pit&&(!state.strategy.recommendation||state.strategy.recommendation.id===m.id);
  if(['strategy-overcut','strategy-undercut','strategy-cover'].includes(m.id))return state.strategy.recommendation?.id===m.id;
  return true;
}
