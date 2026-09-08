import type { EngineerMessage, RaceState } from './types.js';

export interface ControlEvent {
  id:string;
  kind:'PENALTY'|'WARNING';
  source:'EVENT'|'COUNTER';
  at:number;
  sessionTime:number;
  lap:number;
  units:number;
  matchedUnits:number;
  counterEnd?:number;
  penaltyType?:number;
  infringementType?:number;
  packetKeys:string[];
  active:boolean;
}
export interface RaceControlState {
  generation:number;
  events:ControlEvent[];
  awaitingBaseline?:boolean;
  servedPacketKeys?:string[];
}
type ControlState=Pick<RaceState,'raceControl'|'context'|'sessionUid'|'sessionLinkId'|'sessionType'|'sessionTime'|'lap'|'updatedAt'>;
const reconciliationSeconds=2;
const counterGraceMs=1000;
const terminal=(state:ControlState)=>['FINISHED','RETIRED'].includes(state.context.lifecycle);
const identity=(state:ControlState)=>`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}:${state.raceControl?.generation??0}`;
const emptyControl=():RaceControlState=>({generation:0,events:[]});
const recent=(event:ControlEvent,state:ControlState)=>event.active&&Math.abs(event.sessionTime-state.sessionTime)<=reconciliationSeconds;

export function resetRaceControl(state:ControlState):RaceControlState {
  return {generation:(state.raceControl?.generation??0)+1,events:[],awaitingBaseline:true};
}

export function serveControlPenalty(state:ControlState,penaltyType:0|1,packetKey:string):RaceControlState {
  const control=state.raceControl??emptyControl();
  if(control.servedPacketKeys?.includes(packetKey))return control;
  const served=control.events.find(event=>event.active&&event.penaltyType===penaltyType);
  return {...control,servedPacketKeys:[...(control.servedPacketKeys??[]),packetKey],events:control.events.map(event=>event===served?{...event,active:false}:event)};
}

export function observeControlCounters(state:ControlState,penalties:number,warnings:number,lap=state.lap):RaceControlState {
  const control=state.raceControl??emptyControl();
  if(control.awaitingBaseline)return {...control,awaitingBaseline:false,events:control.events.map(event=>({
    ...event,matchedUnits:event.units,counterEnd:event.units?event.kind==='WARNING'?warnings:penalties:undefined,
  }))};
  let events=control.events;
  for(const [kind,before,after] of [['PENALTY',state.context.penalties,penalties],['WARNING',state.context.warnings,warnings]] as const){
    if(after<before){
      events=events.map(event=>event.kind===kind&&event.counterEnd!==undefined&&event.counterEnd>after?{...event,active:false}:event);
      continue;
    }
    let remaining=after-before;
    if(remaining<=0)continue;
    events=events.map(event=>{
      if(!remaining||event.kind!==kind||event.source!=='EVENT'||!recent(event,state))return event;
      const covered=Math.min(remaining,event.units-event.matchedUnits);
      if(covered<=0)return event;
      remaining-=covered;
      return {...event,matchedUnits:event.matchedUnits+covered,counterEnd:after-remaining};
    });
    if(remaining)events=[...events,{
      id:`control-${identity(state)}-${kind.toLowerCase()}-${state.sessionTime}-${events.length}`,
      kind,source:'COUNTER',at:state.updatedAt,sessionTime:state.sessionTime,lap,
      units:remaining,matchedUnits:0,counterEnd:after,packetKeys:[],active:true,
    }];
  }
  return {...control,events};
}

export function observePenaltyPacket(state:ControlState,buffer:Buffer):RaceControlState {
  const control=state.raceControl??emptyControl();
  const penaltyType=buffer.readUInt8(33),infringementType=buffer.readUInt8(34);
  const kind=penaltyType===5?'WARNING':'PENALTY';
  const units=kind==='WARNING'?1:penaltyType===4?buffer.readUInt8(37):0;
  const packetKey=`${buffer.readUInt32LE(19)}:${buffer.readUInt32LE(23)}:${state.sessionTime}:${buffer.subarray(33,40).toString('hex')}`;
  if(control.events.some(event=>event.packetKeys.includes(packetKey)))return control;
  const counterpart=units>0?control.events.find(event=>event.kind===kind&&event.source==='COUNTER'&&recent(event,state)&&event.units-event.matchedUnits>=units):undefined;
  if(counterpart){
    const exact=counterpart.units===units;
    return {...control,events:control.events.map(event=>event.id===counterpart.id?{
      ...event,matchedUnits:event.matchedUnits+units,packetKeys:[...event.packetKeys,packetKey],
      ...(exact?{penaltyType,infringementType}:{}),
    }:event)};
  }
  const event:ControlEvent={
    id:`control-${identity(state)}-event-${packetKey}`,kind,source:'EVENT',
    at:state.updatedAt,sessionTime:state.sessionTime,lap:buffer.readUInt8(38),units,matchedUnits:0,
    penaltyType,infringementType,packetKeys:[packetKey],active:true,
  };
  return {...control,events:[...control.events,event]};
}

// EA's PENA payload separates the sanction type from its cause. Unknown codes stay factual.
const penaltyLabels:Record<number,string>={
  0:'Drive-through penalty',1:'Stop-go penalty',2:'Grid penalty',3:'Penalty reminder',
  6:'Disqualified',7:'Removed from formation lap',8:'Stopped-car timer',9:'Tyre rules violation',
  10:'Lap invalidated',11:'Current and next laps invalidated',12:'Lap invalidated',
  13:'Current and next laps invalidated',14:'Current and previous laps invalidated',
  15:'Current and previous laps invalidated',16:'Retired',17:'Black flag timer',
};
const reasons:Record<number,string>={
  0:'Impeding traffic at low speed',1:'Impeding traffic while driving the wrong way',2:'Reversing at the start',
  3:'Contact',4:'Contact',7:'Time gained off track',8:'Overtaking off track',9:'Overtaking off track',
  5:'Position not returned after contact',6:'Positions not returned after contact',
  10:'Crossing the pit exit line',11:'Blue flags ignored',12:'Yellow flags ignored',
  17:'Speeding in the pit lane',19:'Tyre rules',21:'Repeated warnings',
  13:'Drive-through not served',14:'Repeated drive-through sanctions',15:'Drive-through service reminder',
  16:'Drive-through must be served this lap',18:'Stationary for too long',20:'Repeated sanctions',
  22:'Disqualification risk',23:'Required tyre selection',24:'Required tyre selection',
  25:'Cutting a corner',26:'Running wide',27:'Time gained off track',28:'Time gained off track',
  29:'Time gained off track',34:'Jump start',35:'Contact with the safety car',
  36:'Passing under the safety car',37:'Safety car delta exceeded',38:'Virtual safety car delta exceeded',
  30:'Using the wall to gain time',31:'Flashback',32:'Reset to track',33:'Obstructing the pit lane',
  39:'Formation lap pace too low',40:'Stopping during formation',41:'Mechanical failure',42:'Terminal car damage',
  43:'Gap to the safety car too large',44:'Black flag countdown',45:'Stop-go not served',46:'Drive-through not served',
  47:'Power unit replacement',48:'Gearbox replacement',49:'Setup changed under parc fermé',50:'League grid sanction',
  51:'Retry sanction',52:'Time gained illegally',53:'Required pit stop',54:'Assigned attribute',
};

export function controlTitle(event:ControlEvent):string {
  if(event.kind==='WARNING')return event.units>1?`${event.units} race control warnings`:'Race control warning';
  if(event.penaltyType===4||event.source==='COUNTER')return event.units?`${event.units}-second penalty`:'Time penalty';
  return penaltyLabels[event.penaltyType??-1]??'Race control penalty';
}

export function controlDetail(event:ControlEvent):string {
  return reasons[event.infringementType??-1]??'Reported by race control.';
}

function controlCopy(event:ControlEvent,finished:boolean):string {
  const title=controlTitle(event),reason=reasons[event.infringementType??-1];
  return `${finished?'Session ended. ':''}${title}.${reason?` ${reason}.`:''}`;
}

export function controlMessages(state:ControlState,now:number):EngineerMessage[] {
  return (state.raceControl?.events??[])
    .filter(event=>event.active&&(!terminal(state)||event.kind==='PENALTY')&&(event.source==='EVENT'||now-event.at>=counterGraceMs))
    .map(event=>({
      id:event.id,eventId:event.id,sessionKey:`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`,
      priority:'action',category:'STATUS',title:controlTitle(event),evidence:reasons[event.infringementType??-1]??'Reported by race control.',
      action:'Follow race control instructions.',confidence:100,createdAt:event.at,expiresAt:Number.MAX_SAFE_INTEGER,
      radio:{en:controlCopy(event,terminal(state)),es:controlCopy(event,terminal(state))},
      control:{kind:event.kind,generation:state.raceControl?.generation??0,eventId:event.id},
    }));
}

export function controlSummary(state:ControlState,now:number):EngineerMessage|null {
  const otherPenalties=[...new Set((state.raceControl?.events??[]).filter(event=>event.active&&event.source==='EVENT'&&event.units===0).map(controlTitle))];
  if(!state.context.penalties&&!state.context.warnings&&!otherPenalties.length)return null;
  const text=`${terminal(state)?'Session ended. ':''}Race control status. ${state.context.penalties} seconds in time penalties. ${state.context.warnings} warnings.${otherPenalties.length?' '+otherPenalties.join('. ')+'.':''}`;
  const id=`control-summary-${identity(state)}-${now}`;
  return {id,eventId:id,priority:'action',category:'STATUS',title:'Race control status',evidence:text,action:'',confidence:100,
    createdAt:now,expiresAt:Number.MAX_SAFE_INTEGER,radio:{en:text,es:text},
    sessionKey:`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`,
    control:{kind:'SUMMARY',generation:state.raceControl?.generation??0,penalties:state.context.penalties,warnings:state.context.warnings},
  };
}
