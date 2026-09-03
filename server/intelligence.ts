import type { DecisionLogEntry, EngineerMessage, RaceMode, RaceState, RivalTrend } from './types.js';

type Seen={since:number;lastSeen:number};
const numberGap=(value?:string,stale?:boolean)=>!stale&&value?.startsWith('+')?Number(value.slice(1)):null;
const weight:Record<EngineerMessage['priority'],number>={critical:400,action:300,opportunity:200,info:100};
const dry=(weather:string)=>!['Light rain','Heavy rain','Storm'].includes(weather);
const rivalId=(rival?:{vehicleIndex?:number;name:string})=>String(rival?.vehicleIndex??rival?.name??'');
const structuralDamage=(state:RaceState)=>Math.max(state.context.damage.frontWing,state.context.damage.rearWing,state.context.damage.floor,state.context.damage.diffuser,state.context.damage.sidepod,state.context.damage.gearbox,state.context.damage.engine);

export class RaceEngineer {
  private active:EngineerMessage|null=null;
  private sessionKey='';
  private lastLap=0;
  private lastPosition=0;
  private lastAheadId='';
  private lastBehindId='';
  private lastAheadGap:number|null=null;
  private lastBehindGap:number|null=null;
  private lastPassAt=-Infinity;
  private lastWeather='';
  private lastPenalties=0;
  private seen=new Map<string,Seen>();
  private events=new Map<string,EngineerMessage>();
  private announcedForecasts=new Set<string>();
  private drsAnnouncedAt=new Map<string,number>();
  private predictionBands=new Map<string,number>();
  private log:DecisionLogEntry[]=[];
  private logged=new Set<string>();
  private lastMessageLap=-1;
  private lastMode:RaceMode='LEARNING';
  private lastModeMessageLap=new Map<RaceMode,number>();

  reset(){
    this.active=null;this.sessionKey='';this.lastLap=0;this.lastPosition=0;
    this.lastAheadId='';this.lastBehindId='';this.lastAheadGap=null;this.lastBehindGap=null;this.lastPassAt=-Infinity;
    this.lastWeather='';this.lastPenalties=0;this.seen.clear();this.events.clear();
    this.announcedForecasts.clear();this.drsAnnouncedAt.clear();this.predictionBands.clear();
    this.log=[];this.logged.clear();this.lastMessageLap=-1;this.lastMode='LEARNING';this.lastModeMessageLap.clear();
  }

  analyze(state:RaceState,now=Date.now()):RaceState {
    const sessionKey=state.sessionUid+':'+state.sessionLinkId+':'+state.sessionType;
    if(this.sessionKey&&(sessionKey!==this.sessionKey||(this.lastLap&&state.lap<this.lastLap)))this.reset();
    this.sessionKey=sessionKey;this.lastLap=state.lap;
    if(!['CONNECTED','DEMO'].includes(state.status)||state.context.category==='UNKNOWN')return {...state,engineer:{primary:null,secondary:[],log:[...this.log]}};

    const ordered=[...state.drivers].filter(d=>d.position>0).sort((a,b)=>a.position-b.position),raceSession=state.context.category==='RACE'||state.context.category==='SPRINT';
    const me=ordered.find(d=>d.position===state.player.position),ahead=ordered.find(d=>d.position===state.player.position-1),behind=ordered.find(d=>d.position===state.player.position+1);
    const aheadGap=numberGap(me?.interval,me?.intervalStale),behindGap=numberGap(behind?.interval,behind?.intervalStale),aheadId=rivalId(ahead),behindId=rivalId(behind);
    if(this.lastPosition&&state.player.position<this.lastPosition)this.lastPassAt=now;

    if(state.context.penalties>this.lastPenalties)this.addEvent({id:'penalty-'+state.context.penalties,priority:'action',title:state.context.penalties+'s PENALTY',evidence:'Race control increased the total penalty to '+state.context.penalties+' seconds.',action:'Build a safe margin to the car behind.',confidence:100,createdAt:now,expiresAt:now+12000});
    this.lastPenalties=state.context.penalties;
    if(this.lastWeather&&state.weather!==this.lastWeather)this.addEvent({id:'weather-'+state.weather,priority:'action',title:'CONDITIONS CHANGING',evidence:'Weather changed from '+this.lastWeather+' to '+state.weather+'.',action:'Reassess grip and tyre temperatures this lap.',confidence:94,createdAt:now,expiresAt:now+12000});
    if(state.weather!=='—'&&state.weather!=='Unknown')this.lastWeather=state.weather;
    const rain=state.context.weatherForecast.find(x=>x.minutes>0&&x.minutes<=15&&(x.rainPercentage>=40||!dry(x.weather)));
    if(rain&&dry(state.weather)){const bucket=Math.ceil(rain.minutes/5),key=rain.weather+'-'+bucket;if(!this.announcedForecasts.has(key)){this.announcedForecasts.add(key);this.addEvent({id:'rain-forecast-'+key,priority:rain.minutes<=5?'action':'opportunity',title:'RAIN APPROACHING',evidence:rain.weather+' forecast in about '+rain.minutes+' min · '+rain.rainPercentage+'% rain.',action:'Watch the crossover and keep tyre temperatures under control.',confidence:88,createdAt:now,expiresAt:now+15000});}}

    if(raceSession&&ahead&&aheadId===this.lastAheadId&&this.lastAheadGap!==null&&this.lastAheadGap>1.25&&aheadGap!==null&&aheadGap<=1.05&&now-this.lastPassAt>=12000&&now-(this.drsAnnouncedAt.get('ahead:'+aheadId)??-Infinity)>=55000){
      this.drsAnnouncedAt.set('ahead:'+aheadId,now);
      this.addEvent({id:'drs-attack-'+aheadId+'-'+state.lap,priority:'opportunity',title:'DRS RANGE REACHED',evidence:ahead.name+' is '+aheadGap.toFixed(2)+'s ahead · '+ahead.tyre+' '+ahead.tyreAge+'L.',action:'Protect ERS and prepare the attack on the main straight.',confidence:96,createdAt:now,expiresAt:now+9000});
    }
    if(raceSession&&behind&&behindId===this.lastBehindId&&this.lastBehindGap!==null&&this.lastBehindGap>1.25&&behindGap!==null&&behindGap<=1.05&&now-this.lastPassAt>=12000&&now-(this.drsAnnouncedAt.get('behind:'+behindId)??-Infinity)>=55000){
      this.drsAnnouncedAt.set('behind:'+behindId,now);
      this.addEvent({id:'drs-defend-'+behindId+'-'+state.lap,priority:'action',title:'THREAT ENTERED DRS',evidence:behind.name+' is '+behindGap.toFixed(2)+'s behind · '+behind.tyre+' '+behind.tyreAge+'L.',action:'Prioritise exit speed before the next DRS zone.',confidence:96,createdAt:now,expiresAt:now+9000});
    }

    if(raceSession){
      this.predict('ahead',state.strategy.ahead,state,now);
      this.predict('behind',state.strategy.behind,state,now);
      if(state.strategy.raceMode!==this.lastMode&&state.lap>=2)this.modeEvent(state,now);
    }
    this.lastMode=state.strategy.raceMode;

    this.lastPosition=state.player.position;this.lastAheadId=aheadId;this.lastBehindId=behindId;this.lastAheadGap=aheadGap;this.lastBehindGap=behindGap;

    const raw:EngineerMessage[]=[];
    const add=(id:string,priority:EngineerMessage['priority'],title:string,evidence:string,action:string,confidence:number,ttl=8000)=>raw.push({id,priority,title,evidence,action,confidence,createdAt:now,expiresAt:now+ttl});
    for(const [key,event] of this.events){if(event.expiresAt>now)raw.push(event);else this.events.delete(key);}
    if(state.strategy.recommendation)raw.push(state.strategy.recommendation);
    const maxDamage=structuralDamage(state);
    if(state.flag==='RED')add('red-flag','critical','RED FLAG','The session is stopped.','Reduce speed and follow race control.',100,15000);
    else if(state.safetyCar!=='NONE')add('safety-car','critical',state.safetyCar==='VSC'?'VIRTUAL SAFETY CAR':'SAFETY CAR','Overtaking restrictions are active.','Respect the delta and reassess the pit window.',100,12000);
    if(maxDamage>=60)add('severe-damage','critical','SEVERE CAR DAMAGE','Maximum structural damage is '+maxDamage+'%.','Box this lap if the car remains controllable.',98,12000);
    else if(maxDamage>=30)add('car-damage','action','DAMAGE AFFECTING PACE','Maximum structural damage is '+maxDamage+'%.','Monitor handling and compare the next clean lap before deciding to pit.',91);
    const hottest=Math.max(...state.player.tyreTemps),wear=Math.max(...state.context.tyreWear);
    if(hottest>110)add('hot-tyres','action','TYRES OVERHEATING','Surface temperature reached '+hottest+'°C.','Reduce sliding and protect the tyres for one lap.',92);
    if(wear>=70)add('tyre-wear','action','TYRE LIFE CRITICAL','Maximum wear has reached '+wear+'%.','Pit at the next safe opportunity.',97,12000);
    const fuelLaps=state.player.fuelRemainingLaps;
    if(raceSession&&state.player.fuel>0&&fuelLaps<-.05)add('low-fuel','critical','FUEL SHORTFALL','Fuel projection is '+fuelLaps.toFixed(2)+' laps.','Lift and coast immediately.',97,12000);
    else if(raceSession&&state.player.fuel>0&&fuelLaps>=0&&fuelLaps<.35)add('fuel-margin','action','FUEL MARGIN LOW','Fuel projection is only +'+fuelLaps.toFixed(2)+' laps.','Use light lift and coast until the margin stabilises.',91);
    if(state.player.ers<15)add('low-ers','action','ERS RESERVE LOW','Battery is at '+state.player.ers+'%.','Harvest before the next attack or defence window.',88);

    const confirmed=this.confirm(raw,now);
    for(const candidate of raw)if(!confirmed.some(x=>x.id===candidate.id))this.record(candidate.id,state.lap,now,'SUPPRESSED','Waiting for a stable signal');
    const candidates=confirmed.sort((a,b)=>(weight[b.priority]+b.confidence)-(weight[a.priority]+a.confidence));
    let best:EngineerMessage|null=candidates[0]||null;
    if(best&&best.priority!=='critical'&&best.id!==this.active?.id&&this.lastMessageLap===state.lap){
      this.record(best.id,state.lap,now,'SUPPRESSED','One non-critical message per lap limit');
      best=candidates.find(x=>x.id===this.active?.id)||null;
    }
    const previous=this.active;
    if(!best)this.active=null;
    else if(!this.active||!candidates.some(x=>x.id===this.active?.id)||weight[best.priority]>weight[this.active.priority]||best.id===this.active.id)this.active=best.id===this.active?.id?{...best,createdAt:this.active.createdAt}:best;
    if(previous&&!this.active)this.record(previous.id,state.lap,now,'RESOLVED','Message condition cleared');
    if(this.active&&this.active.id!==previous?.id){this.lastMessageLap=state.lap;this.record(this.active.id,state.lap,now,'EMITTED','Selected as the highest-value message');}
    return {...state,engineer:{primary:this.active,secondary:candidates.filter(x=>x.id!==this.active?.id).slice(0,2),log:[...this.log]}};
  }

  private modeEvent(state:RaceState,now:number){
    const mode=state.strategy.raceMode,target=state.strategy.targetLapTime;
    if((this.lastModeMessageLap.get(mode)??-99)>=state.lap-3)return;
    const data:Partial<Record<RaceMode,{priority:EngineerMessage['priority'];title:string;action:string}>>={
      MANAGE:{priority:'info',title:'RACE UNDER CONTROL',action:target==='—'?'Protect tyres and maintain the gap.':'Target '+target+' and protect the tyres.'},
      PUSH:{priority:'opportunity',title:'PUSH PHASE',action:target==='—'?'Push for two laps.':'Target '+target+' for two laps.'},
      ATTACK:{priority:'opportunity',title:'ATTACK MODE',action:'Use ERS where it creates an overtaking chance.'},
      DEFEND:{priority:'action',title:'DEFEND MODE',action:'Prioritise exits and preserve ERS for defence.'}
    };
    const message=data[mode];if(!message)return;this.lastModeMessageLap.set(mode,state.lap);
    this.addEvent({id:'mode-'+mode.toLowerCase()+'-'+state.lap,priority:message.priority,title:message.title,evidence:state.strategy.modeReason,action:message.action,confidence:88,createdAt:now,expiresAt:now+10000});
  }

  private predict(role:'ahead'|'behind',rival:RivalTrend|null,state:RaceState,now:number){
    const id=rivalId(rival||undefined),key=role+':'+id,lapsLeft=state.totalLaps?state.totalLaps-state.lap:99;
    if(!rival||!id||rival.laps<3||rival.catchLaps===null||rival.rate===null||rival.rate>-.12||rival.catchLaps>7||rival.catchLaps>lapsLeft){this.predictionBands.delete(key);return;}
    const eta=Math.max(1,Math.ceil(rival.catchLaps)),band=eta<=2?2:eta<=4?4:7,previous=this.predictionBands.get(key);
    if(previous!==undefined&&previous<=band)return;
    this.predictionBands.set(key,band);
    const attacking=role==='ahead';
    this.addEvent({id:'prediction-'+role+'-'+id+'-'+band,priority:attacking?'opportunity':'action',title:(attacking?'CATCH IN ':'THREAT IN ')+eta+' LAPS',evidence:rival.name+' · gap '+(rival.gap??0).toFixed(1)+'s · trend '+Math.abs(rival.rate).toFixed(2)+'s/lap.',action:attacking?'Keep this pace and prepare ERS for the catch.':'The car behind is closing; protect exits and prepare the defence.',confidence:Math.min(96,76+rival.laps*4),createdAt:now,expiresAt:now+12000});
  }

  private addEvent(message:EngineerMessage){this.events.set(message.id,message);}

  private record(id:string,lap:number,at:number,status:DecisionLogEntry['status'],reason:string){
    const key=id+':'+lap+':'+status;if(this.logged.has(key))return;this.logged.add(key);
    this.log.push({id,lap,at,status,reason});this.log=this.log.slice(-60);
  }

  private confirm(candidates:EngineerMessage[],now:number){
    const immediate=new Set(['red-flag','safety-car','severe-damage','car-damage','tyre-wear']);
    const ids=new Set(candidates.map(x=>x.id));
    for(const [id,value] of this.seen)if(!ids.has(id)&&now-value.lastSeen>750)this.seen.delete(id);
    for(const candidate of candidates){const old=this.seen.get(candidate.id);this.seen.set(candidate.id,{since:old?.since??now,lastSeen:now});}
    return candidates.filter(candidate=>{
      if(immediate.has(candidate.id)||this.events.has(candidate.id))return true;
      const age=now-(this.seen.get(candidate.id)?.since??now),delay=candidate.id==='hot-tyres'?3000:candidate.id==='low-ers'?5000:1500;
      return age>=delay;
    });
  }
}
