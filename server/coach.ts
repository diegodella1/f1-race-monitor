import type { EngineerMessage, LapInsight, LapTracePoint, RaceState } from './types.js';

type Point={distance:number;speed:number;brake:number;throttle:number;steer:number};
type Corner={centerDistance:number;brakeAt:number;throttleAt:number;minSpeed:number;peakSteer:number};
type Issue={key:string;score:number;turn:number;distance:number;title:string;evidence:string;action:string};
type Confirmation={count:number;lastLap:number;issue:Issue};

export class DrivingCoach {
  private lap=0;
  private sessionKey='';
  private points:Point[]=[];
  private reference:Corner[]=[];
  private referencePoints:Point[]=[];
  private referenceLapMs=Number.POSITIVE_INFINITY;
  private referenceLap=0;
  private lapsLearned=0;
  private message:EngineerMessage|null=null;
  private lastSample=0;
  private quality={invalid:false,pit:false,unsafe:false};
  private confirmations=new Map<string,Confirmation>();
  private lastMessageKey='';
  private lastMessageLap=0;
  private insights:LapInsight[]=[];

  reset(){this.lap=0;this.sessionKey='';this.points=[];this.reference=[];this.referencePoints=[];this.referenceLapMs=Number.POSITIVE_INFINITY;this.referenceLap=0;this.lapsLearned=0;this.message=null;this.lastSample=0;this.quality={invalid:false,pit:false,unsafe:false};this.confirmations.clear();this.lastMessageKey='';this.lastMessageLap=0;this.insights=[];}

  analyze(state:RaceState,now=Date.now()):RaceState {
    const key=`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`;
    if(this.sessionKey&&(key!==this.sessionKey||(this.lap&&state.lap<this.lap)))this.reset();
    this.sessionKey=key;
    if(this.message&&this.message.expiresAt<now)this.message=null;
    if(!['CONNECTED','DEMO'].includes(state.status)||state.context.category==='UNKNOWN')return this.withCoach(state);

    if(this.lap&&state.lap>this.lap){
      if(this.points.length>=30&&!this.quality.invalid&&!this.quality.pit&&!this.quality.unsafe)this.finishLap(now,this.lap,parseLapMs(state.player.lastLap));
      this.points=[];
      this.quality={invalid:false,pit:false,unsafe:false};
    }
    if(state.lap!==this.lap){this.lap=state.lap;this.points=[];}

    this.quality.invalid||=state.context.lapInvalid;
    this.quality.pit||=state.player.pit||state.player.driverStatus===2||state.player.driverStatus===3;
    const structuralDamage=Math.max(state.context.damage.frontWing,state.context.damage.rearWing,state.context.damage.floor,state.context.damage.diffuser,state.context.damage.sidepod,state.context.damage.gearbox,state.context.damage.engine,state.context.damage.brakes);
    this.quality.unsafe||=structuralDamage>=30||state.safetyCar!=='NONE'||state.flag!=='GREEN';
    if(now-this.lastSample>=100&&state.player.speed>20&&Number.isFinite(state.player.lapDistance)){
      this.lastSample=now;
      this.points.push({distance:state.player.lapDistance,speed:state.player.speed,brake:state.player.brake,throttle:state.player.throttle,steer:Math.abs(state.player.steer)});
    }
    return this.withCoach(state);
  }

  private withCoach(state:RaceState):RaceState {return {...state,coach:{status:this.reference.length?'ACTIVE':'LEARNING',lapsLearned:this.lapsLearned,cornersLearned:this.reference.length,message:this.message,analysis:{currentLap:this.lap,referenceLap:this.referenceLap||null,referenceLapTime:Number.isFinite(this.referenceLapMs)?formatLapMs(this.referenceLapMs):'—',current:this.trace(this.points),reference:this.trace(this.referencePoints),corners:this.reference.map(x=>Math.round(x.centerDistance)),insights:this.insights,quality:{...this.quality}}}};}

  private finishLap(now:number,lap:number,lapMs:number){
    const corners=this.corners(this.points);
    if(corners.length<3)return;
    this.lapsLearned++;
    if(!this.reference.length){this.reference=corners;this.referencePoints=[...this.points];this.referenceLapMs=lapMs||Number.POSITIVE_INFINITY;this.referenceLap=lap;this.insights=[];return;}
    if(lapMs>0&&lapMs<this.referenceLapMs-150){this.reference=corners;this.referencePoints=[...this.points];this.referenceLapMs=lapMs;this.referenceLap=lap;this.confirmations.clear();this.insights=[];return;}

    const issues:Issue[]=[];
    for(const corner of corners){
      const nearest=this.reference.map((value,index)=>({value,index,distance:Math.abs(value.centerDistance-corner.centerDistance)})).sort((a,b)=>a.distance-b.distance)[0];
      if(!nearest||nearest.distance>Math.max(220,this.points.at(-1)?.distance?Math.abs(this.points.at(-1)!.distance)*.06:220))continue;
      const base=nearest.value,turn=nearest.index+1,early=(base.brakeAt-corner.brakeAt)*.1,lateThrottle=(corner.throttleAt-base.throttleAt)*.1,speedLoss=base.minSpeed-corner.minSpeed,steerExcess=corner.peakSteer-base.peakSteer;
      if(speedLoss>8)issues.push({key:`speed-${turn}`,score:speedLoss,turn,distance:corner.centerDistance,title:`CARRY MORE SPEED · CORNER ${turn}`,evidence:`Minimum speed was ${Math.round(speedLoss)} km/h below your clean reference.`,action:'Release the brake more progressively and keep the car balanced.'});
      if(early>.35)issues.push({key:`brake-${turn}`,score:early*18,turn,distance:corner.centerDistance,title:`BRAKE LATER · CORNER ${turn}`,evidence:`You started braking about ${early.toFixed(1)}s earlier than your clean reference.`,action:'Move the braking point later in one small, controlled step.'});
      if(lateThrottle>.4)issues.push({key:`throttle-${turn}`,score:lateThrottle*16,turn,distance:corner.centerDistance,title:`EARLIER THROTTLE · CORNER ${turn}`,evidence:`Full throttle came ${lateThrottle.toFixed(1)}s later than your clean reference.`,action:'Prioritise rotation and a cleaner exit.'});
      if(steerExcess>.18)issues.push({key:`steer-${turn}`,score:steerExcess*45,turn,distance:corner.centerDistance,title:`REDUCE STEERING · CORNER ${turn}`,evidence:'Steering input was significantly higher than your clean reference.',action:'Open the entry and avoid adding steering at the apex.'});
    }

    const strongest=new Map<string,Issue>();
    for(const issue of issues.filter(x=>x.score>7)){const old=strongest.get(issue.key);if(!old||issue.score>old.score)strongest.set(issue.key,issue);}
    this.insights=[...strongest.values()].sort((a,b)=>b.score-a.score).slice(0,3).map(x=>({lap,turn:x.turn,distance:Math.round(x.distance),title:x.title,evidence:x.evidence,action:x.action,score:Math.round(x.score)}));
    const seen=new Set(strongest.keys());
    for(const [key,value] of this.confirmations)if(!seen.has(key)&&value.lastLap<lap)this.confirmations.delete(key);
    for(const [key,issue] of strongest){const old=this.confirmations.get(key),count=old&&old.lastLap===lap-1?old.count+1:1;this.confirmations.set(key,{count,lastLap:lap,issue});}
    const confirmed=[...this.confirmations.entries()].filter(([,x])=>x.count>=2&&x.lastLap===lap).sort((a,b)=>b[1].issue.score-a[1].issue.score)[0];
    if(!confirmed)return;
    const [key,value]=confirmed;
    if(key===this.lastMessageKey&&lap-this.lastMessageLap<3)return;
    this.lastMessageKey=key;this.lastMessageLap=lap;
    this.message={id:`coach-${key}-${lap}`,priority:'info',title:value.issue.title,evidence:`Repeated on ${value.count} clean laps. ${value.issue.evidence}`,action:value.issue.action,confidence:Math.min(94,Math.round(74+value.issue.score+value.count*2)),createdAt:now,expiresAt:now+18000};
  }

  private corners(points:Point[]){
    const groups:[number,number][]=[];let start=-1,lastTurn=-1;
    for(let i=0;i<=points.length;i++){
      const turning=i<points.length&&points[i].steer>.16;
      if(turning){if(start<0)start=i;lastTurn=i;}
      if(start>=0&&((!turning&&i-lastTurn>=10)||i===points.length)){if(lastTurn-start>=3){const previous=groups.at(-1);if(previous&&start-previous[1]<15)previous[1]=lastTurn;else groups.push([start,lastTurn]);}start=-1;lastTurn=-1;}
    }
    return groups.slice(0,24).map(([entry,exit])=>{const from=Math.max(0,entry-10),slice=points.slice(from,Math.min(points.length,exit+10)),brake=slice.findIndex(p=>p.brake>15),throttle=slice.findIndex(p=>p.throttle>85),turnPoints=points.slice(entry,exit+1);return {centerDistance:turnPoints.reduce((sum,p)=>sum+p.distance,0)/turnPoints.length,brakeAt:from+(brake<0?0:brake),throttleAt:from+(throttle<0?slice.length:throttle),minSpeed:Math.min(...slice.map(p=>p.speed)),peakSteer:Math.max(...slice.map(p=>p.steer))};});
  }

  private trace(points:Point[]):LapTracePoint[]{const valid=points.filter(p=>p.distance>=0),step=Math.max(1,Math.ceil(valid.length/140));return valid.filter((_,i)=>i%step===0||i===valid.length-1).map(p=>({distance:Math.round(p.distance),speed:p.speed,throttle:p.throttle,brake:p.brake}));}
}

function parseLapMs(value:string){const match=/^(\d+):(\d+(?:\.\d+)?)$/.exec(value);return match?Number(match[1])*60000+Number(match[2])*1000:0;}
function formatLapMs(ms:number){const minutes=Math.floor(ms/60000),seconds=(ms%60000/1000).toFixed(3).padStart(6,'0');return `${minutes}:${seconds}`;}
