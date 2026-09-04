import type { DecisionLogEntry, EngineerCondition, EngineerMessage, RaceMode, RaceState, RaceSummary, RivalTrend } from './types.js';
import { messageFamily, scoreMessage } from './scoring.js';

type Seen={since:number;lastSeen:number};
const numberGap=(value?:string,stale?:boolean)=>!stale&&value?.startsWith('+')?Number(value.slice(1)):null;
const weight:Record<EngineerMessage['priority'],number>={critical:400,action:300,opportunity:200,info:100};
const dry=(weather:string)=>!['Light rain','Heavy rain','Storm'].includes(weather);
const rivalId=(rival?:{vehicleIndex?:number;name:string})=>String(rival?.vehicleIndex??rival?.name??'');
type DamageKey=keyof RaceState['context']['damage'];
type DamageMemory={value:number;band:number;status:EngineerCondition['status'];firstSeenLap:number;firstSeenAt:number;lastChangedLap:number};
const damageLabels:Record<DamageKey,string>={frontWing:'FRONT WING',rearWing:'REAR WING',floor:'FLOOR',diffuser:'DIFFUSER',sidepod:'SIDEPODS',gearbox:'GEARBOX',engine:'ENGINE',tyres:'TYRES',brakes:'BRAKES'};
const damageKeys:DamageKey[]=['frontWing','rearWing','floor','diffuser','sidepod','gearbox','engine','brakes'];
const damageBand=(value:number)=>value>=90?90:value>=60?60:value>=30?30:value>=10?10:0;
const immediateMessage=(id:string)=>['red-flag','safety-car','final-lap','race-finished','race-retired'].includes(id)||id.startsWith('incident-')||id.startsWith('damage-')||id.startsWith('penalty-')||id.startsWith('weather-')||id.startsWith('strategy-pit-exit-')||id.startsWith('strategy-cycle-complete-');

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
  private lastFamilyLap=new Map<string,number>();
  private damageMemory=new Map<DamageKey,DamageMemory>();
  private wasPitting=false;
  private seenIncidents=new Set<string>();
  private startPosition=0;
  private lastLapAnnounced=false;
  private finishAnnounced=false;
  private summary:RaceSummary|null=null;

  reset(){
    this.active=null;this.sessionKey='';this.lastLap=0;this.lastPosition=0;
    this.lastAheadId='';this.lastBehindId='';this.lastAheadGap=null;this.lastBehindGap=null;this.lastPassAt=-Infinity;
    this.lastWeather='';this.lastPenalties=0;this.seen.clear();this.events.clear();
    this.announcedForecasts.clear();this.drsAnnouncedAt.clear();this.predictionBands.clear();
    this.log=[];this.logged.clear();this.lastMessageLap=-1;this.lastMode='LEARNING';this.lastModeMessageLap.clear();this.lastFamilyLap.clear();
    this.damageMemory.clear();this.wasPitting=false;
    this.seenIncidents.clear();this.startPosition=0;this.lastLapAnnounced=false;this.finishAnnounced=false;this.summary=null;
  }

  analyze(state:RaceState,now=Date.now()):RaceState {
    const sessionKey=state.sessionUid+':'+state.sessionLinkId+':'+state.sessionType;
    if(this.sessionKey&&(sessionKey!==this.sessionKey||(this.lastLap&&state.lap<this.lastLap)))this.reset();
    this.sessionKey=sessionKey;this.lastLap=state.lap;
    const terminal=['FINISHED','RETIRED'].includes(state.context.lifecycle);
    if((!['CONNECTED','DEMO'].includes(state.status)&&!terminal)||state.context.category==='UNKNOWN')return {...state,sessionSummary:this.summary??state.sessionSummary,engineer:{primary:null,next:null,secondary:[],conditions:this.conditions(),log:[...this.log],metrics:{candidates:0,eligible:0,suppressed:0,lastMessageLap:this.lastMessageLap,silenceReason:state.status==='PAUSED'?'Game paused · last reliable state retained':'Waiting for identified telemetry'}}};

    const ordered=[...state.drivers].filter(d=>d.position>0).sort((a,b)=>a.position-b.position),raceSession=state.context.category==='RACE'||state.context.category==='SPRINT';
    const me=ordered.find(d=>d.position===state.player.position),ahead=ordered.find(d=>d.position===state.player.position-1),behind=ordered.find(d=>d.position===state.player.position+1);
    const aheadGap=numberGap(me?.interval,me?.intervalStale),behindGap=numberGap(behind?.interval,behind?.intervalStale),aheadId=rivalId(ahead),behindId=rivalId(behind);
    if(raceSession&&!this.startPosition&&state.player.position>0)this.startPosition=state.player.position;
    if(this.lastPosition&&state.player.position!==this.lastPosition)this.lastPassAt=now;
    this.observeDamage(state,now);
    this.observeIncidents(state,aheadId,behindId,now);
    this.observeLifecycle(state,aheadGap,behindGap,now);

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

    if(raceSession&&!terminal){
      this.predict('ahead',state.strategy.ahead,state,now);
      this.predict('behind',state.strategy.behind,state,now);
      if(state.strategy.raceMode!==this.lastMode&&state.lap>=2)this.modeEvent(state,now);
    }
    this.lastMode=state.strategy.raceMode;

    this.lastPosition=state.player.position;this.lastAheadId=aheadId;this.lastBehindId=behindId;this.lastAheadGap=aheadGap;this.lastBehindGap=behindGap;

    const raw:EngineerMessage[]=[];
    const add=(id:string,priority:EngineerMessage['priority'],title:string,evidence:string,action:string,confidence:number,ttl=8000)=>raw.push({id,priority,title,evidence,action,confidence,createdAt:now,expiresAt:now+ttl});
    for(const [key,event] of this.events){if(event.expiresAt<=now){this.events.delete(key);continue;}if(!terminal||['race-finished','race-retired'].includes(event.id))raw.push(event);}
    if(state.strategy.recommendation&&!terminal)raw.push(state.strategy.recommendation);
    if(!terminal&&state.flag==='RED')add('red-flag','critical','RED FLAG','The session is stopped.','Reduce speed and follow race control.',100,15000);
    else if(!terminal&&state.safetyCar!=='NONE')add('safety-car','critical',state.safetyCar==='VSC'?'VIRTUAL SAFETY CAR':'SAFETY CAR','Overtaking restrictions are active.','Respect the delta and reassess the pit window.',100,12000);
    const hottest=Math.max(...state.player.tyreTemps),wear=Math.max(...state.context.tyreWear);
    if(!terminal&&hottest>110)add('hot-tyres','action','TYRES OVERHEATING','Surface temperature reached '+hottest+'°C.','Reduce sliding and protect the tyres for one lap.',92);
    if(!terminal&&wear>=70)add('tyre-wear','action','TYRE LIFE CRITICAL','Maximum wear has reached '+wear+'%.','Pit at the next safe opportunity.',97,12000);
    const fuelLaps=state.player.fuelRemainingLaps;
    if(!terminal&&raceSession&&state.player.fuel>0&&fuelLaps<-.05)add('low-fuel','critical','FUEL SHORTFALL','Fuel projection is '+fuelLaps.toFixed(2)+' laps.','Lift and coast immediately.',97,12000);
    else if(!terminal&&raceSession&&state.player.fuel>0&&fuelLaps>=0&&fuelLaps<.35)add('fuel-margin','action','FUEL MARGIN LOW','Fuel projection is only +'+fuelLaps.toFixed(2)+' laps.','Use light lift and coast until the margin stabilises.',91);
    if(!terminal&&state.player.ers<15)add('low-ers','action','ERS RESERVE LOW','Battery is at '+state.player.ers+'%.','Harvest before the next attack or defence window.',88);

    if(!terminal&&!raw.some(message=>message.priority!=='info')){
      const outlook=this.paceOutlook(state,now);
      if(outlook)raw.push(outlook);
    }
    const confirmed=this.confirm(raw,now);
    for(const candidate of raw)if(!confirmed.some(x=>x.id===candidate.id))this.record(candidate,state.lap,now,'SUPPRESSED','Waiting for a stable signal');
    const candidates:EngineerMessage[]=[];
    for(const candidate of confirmed){
      const family=messageFamily(candidate.id),lastFamily=this.lastFamilyLap.get(family)??-99,cooldown=candidate.priority==='critical'?0:candidate.priority==='action'?1:candidate.priority==='opportunity'?2:3,novel=state.lap-lastFamily>=cooldown;
      const evaluation=scoreMessage(candidate,state,novel,now);
      if(!novel&&candidate.id!==this.active?.id){this.record(evaluation.message,state.lap,now,'SUPPRESSED',`Similar ${family} message emitted ${state.lap-lastFamily} lap(s) ago`);continue;}
      if(!evaluation.eligible){this.record(evaluation.message,state.lap,now,'SUPPRESSED',evaluation.reason);continue;}
      candidates.push(evaluation.message);
    }
    candidates.sort((a,b)=>(b.score??weight[b.priority]+b.confidence)-(a.score??weight[a.priority]+a.confidence));
    let best:EngineerMessage|null=candidates[0]||null;
    if(best&&best.priority!=='critical'&&!immediateMessage(best.id)&&best.id!==this.active?.id&&this.lastMessageLap===state.lap){
      this.record(best,state.lap,now,'SUPPRESSED','One non-critical message per lap limit');
      best=candidates.find(x=>x.id===this.active?.id)||null;
    }
    const currentCandidate=candidates.find(x=>x.id===this.active?.id);
    if(best&&currentCandidate&&best.id!==currentCandidate.id&&weight[best.priority]<=weight[currentCandidate.priority]&&(best.score??0)-(currentCandidate.score??0)<10)best=currentCandidate;
    const previous=this.active;
    if(!best)this.active=null;
    else if(!this.active||!candidates.some(x=>x.id===this.active?.id)||weight[best.priority]>weight[this.active.priority]||immediateMessage(best.id)||(best.score??0)-(this.active.score??0)>=10||best.id===this.active.id)this.active=best.id===this.active?.id?{...best,createdAt:this.active.createdAt}:best;
    if(previous&&!this.active)this.record(previous,state.lap,now,'RESOLVED','Message condition cleared');
    if(this.active&&this.active.id!==previous?.id){this.lastMessageLap=state.lap;this.lastFamilyLap.set(messageFamily(this.active.id),state.lap);this.record(this.active,state.lap,now,'EMITTED',`Selected as highest-value ${this.active.category?.toLowerCase()??'engineer'} message · score ${this.active.score??0}`);}
    const secondary=candidates.filter(x=>x.id!==this.active?.id).slice(0,2),next=secondary[0]??null,suppressed=Math.max(0,raw.length-candidates.length);
    const silenceReason=this.active?'Active decision remains valid':state.telemetry.score<60?'Telemetry confidence is too low for a tactical call':state.strategy.status==='LEARNING'?'Learning pace and rival trends':'No high-value change · continue current plan';
    return {...state,sessionSummary:this.summary??state.sessionSummary,engineer:{primary:this.active,next,secondary,conditions:this.conditions(),log:[...this.log],metrics:{candidates:raw.length,eligible:candidates.length,suppressed,lastMessageLap:this.lastMessageLap,silenceReason}}};
  }

  private observeLifecycle(state:RaceState,aheadGap:number|null,behindGap:number|null,now:number){
    if(state.context.lifecycle==='FINAL_LAP'&&!this.lastLapAnnounced){
      this.lastLapAnnounced=true;
      const action=behindGap!==null&&behindGap<=1.2?'Protect the exits and defend the position.':aheadGap!==null&&aheadGap<=1.5?'Use the available ERS and take the chance if it is clean.':'Avoid unnecessary risk and bring the car home.';
      this.addEvent({id:'final-lap',priority:'action',title:'FINAL LAP',evidence:`P${state.player.position}${aheadGap===null?'':` · ${aheadGap.toFixed(1)}s ahead`}${behindGap===null?'':` · ${behindGap.toFixed(1)}s behind`}.`,action,confidence:100,createdAt:now,expiresAt:now+20000,category:'STATUS'});
    }
    if(!['FINISHED','RETIRED'].includes(state.context.lifecycle)||this.finishAnnounced)return;
    this.finishAnnounced=true;
    const retired=state.context.lifecycle==='RETIRED',damage=damageKeys.filter(key=>state.context.damage[key]>=10).map(key=>damageLabels[key]);
    this.summary={status:retired?'RETIRED':'FINISHED',finalPosition:state.player.position,startPosition:this.startPosition||state.player.position,positionsGained:Math.max(-99,Math.min(99,(this.startPosition||state.player.position)-state.player.position)),bestLap:state.player.bestLap,stops:state.strategy.rules.stops,compounds:[...state.strategy.rules.compoundsUsed],incidents:(state.context.incidents??[]).filter(item=>item.kind==='COLLISION'||item.kind==='RETIREMENT').length,damage};
    const movement=this.summary.positionsGained===0?'held the starting position':this.summary.positionsGained>0?`gained ${this.summary.positionsGained} position${this.summary.positionsGained===1?'':'s'}`:`lost ${Math.abs(this.summary.positionsGained)} position${this.summary.positionsGained===-1?'':'s'}`;
    this.addEvent({id:retired?'race-retired':'race-finished',priority:retired?'critical':'action',title:retired?'RACE OVER':'CHEQUERED FLAG · P'+state.player.position,evidence:retired?'The car is recorded as retired.':`Finished P${state.player.position} · ${movement} · ${this.summary.stops} stop${this.summary.stops===1?'':'s'}.`,action:retired?'Stop safely and follow race control.':'Session complete. Good job — bring the car back.',confidence:100,createdAt:now,expiresAt:now+45000,category:'STATUS'});
  }

  private observeIncidents(state:RaceState,aheadId:string,behindId:string,now:number){
    const me=state.drivers.find(driver=>driver.position===state.player.position),meId=me?String(me.vehicleIndex??me.name):'';
    for(const incident of [...(state.context.incidents??[])].reverse()){
      if(this.seenIncidents.has(incident.id))continue;
      this.seenIncidents.add(incident.id);
      const ids=incident.vehicleIndices.map(String),playerInvolved=!!meId&&ids.includes(meId),aheadInvolved=!!aheadId&&ids.includes(aheadId),behindInvolved=!!behindId&&ids.includes(behindId);
      if(incident.kind==='COLLISION'&&(playerInvolved||aheadInvolved||behindInvolved)){
        const location=playerInvolved?'Contact involving your car':aheadInvolved?'Contact involving the car ahead':'Contact involving the car behind';
        this.addEvent({id:'incident-collision-'+incident.id,priority:playerInvolved?'critical':'action',title:playerInvolved?'CONTACT':'INCIDENT NEARBY',evidence:`${location} · ${incident.title}.`,action:playerInvolved?'Check the steering and damage before committing to the next corner.':aheadInvolved?'Expect a yellow flag and be ready to slow down.':'Keep the line predictable and focus forward.',confidence:96,createdAt:now,expiresAt:now+12000,category:'SAFETY'});
      }
      if(incident.kind==='RETIREMENT'&&!playerInvolved&&(aheadInvolved||behindInvolved))this.addEvent({id:'incident-retirement-'+incident.id,priority:'opportunity',title:'RIVAL RETIRED',evidence:`${incident.title} has retired.`,action:aheadInvolved?'Race order changed; reset the target ahead.':'The immediate rear threat is gone; settle into the current pace.',confidence:100,createdAt:now,expiresAt:now+12000,category:'BATTLE'});
    }
  }

  private observeDamage(state:RaceState,now:number){
    const pitting=state.player.pit||state.player.driverStatus===2||state.player.driverStatus===3,justExited=this.wasPitting&&!pitting;
    for(const key of damageKeys){
      const value=Math.round(state.context.damage[key]),band=damageBand(value),old=this.damageMemory.get(key);
      if(!band){if(old)this.record('damage-'+key,state.lap,now,'RESOLVED','Damage repaired or no longer reported');this.damageMemory.delete(key);continue;}
      if(!old){
        const memory:DamageMemory={value,band,status:'NEW',firstSeenLap:state.lap,firstSeenAt:now,lastChangedLap:state.lap};this.damageMemory.set(key,memory);this.addDamageEvent(key,memory,state,now);continue;
      }
      if(band>old.band||value>=old.value+10){
        const memory:DamageMemory={...old,value,band,status:'ESCALATED',lastChangedLap:state.lap};this.damageMemory.set(key,memory);this.addDamageEvent(key,memory,state,now);continue;
      }
      let status=old.status;
      if(justExited&&value>=old.value-2)status='ACCEPTED';
      else if(status==='NEW'&&(state.lap>old.firstSeenLap||now-old.firstSeenAt>=10000))status='KNOWN';
      else if(status==='ESCALATED'&&state.lap>old.lastChangedLap)status='KNOWN';
      this.damageMemory.set(key,{...old,value,band,status});
    }
    this.wasPitting=pitting;
  }

  private addDamageEvent(key:DamageKey,memory:DamageMemory,state:RaceState,now:number){
    const severe=memory.band>=60,title=memory.status==='ESCALATED'?'DAMAGE INCREASED':severe?'SEVERE CAR DAMAGE':'DAMAGE DETECTED';
    this.addEvent({id:`damage-${key}-${memory.band}-${state.lap}`,priority:severe?'critical':'action',title:`${title} · ${damageLabels[key]}`,evidence:`${damageLabels[key]} is at ${memory.value}%.`,action:severe?'Box if the car is unsafe or the pace loss is unacceptable.':'Assess the handling this lap; continuing will be treated as your decision.',confidence:severe?98:92,createdAt:now,expiresAt:now+10000,category:'CAR'});
  }

  private conditions():EngineerCondition[]{
    return [...this.damageMemory.entries()].map(([key,value])=>({id:'damage-'+key,label:damageLabels[key],value:value.value,status:value.status,severity:value.band>=60?'critical' as const:'warning' as const,firstSeenLap:value.firstSeenLap,lastChangedLap:value.lastChangedLap})).sort((a,b)=>b.value-a.value);
  }

  private paceOutlook(state:RaceState,now:number):EngineerMessage|null {
    if(state.strategy.status!=='READY'||state.telemetry.score<60||state.lap<3||state.lap-this.lastMessageLap<3)return null;
    const ahead=state.strategy.ahead,behind=state.strategy.behind,target=state.strategy.targetLapTime;
    if(behind&&behind.rate!==null&&behind.rate<-.12&&behind.catchLaps!==null&&behind.catchLaps<=6){
      const eta=Math.max(1,Math.ceil(behind.catchLaps));
      return {id:'pace-outlook-behind-'+state.lap,priority:eta<=9?'action':'info',title:'REAR THREAT BUILDING',evidence:behind.name+' is gaining '+Math.abs(behind.rate).toFixed(2)+'s/lap · projected threat in '+eta+' laps.',action:'Protect exits and keep enough ERS for the expected defence.',confidence:Math.min(94,72+behind.laps*4),createdAt:now,expiresAt:now+14000,category:'BATTLE',validUntilLap:state.lap+2};
    }
    if(ahead&&ahead.rate!==null&&ahead.rate<-.12&&ahead.catchLaps!==null&&ahead.catchLaps<=6){
      const eta=Math.max(1,Math.ceil(ahead.catchLaps));
      return {id:'pace-outlook-ahead-'+state.lap,priority:eta<=10?'opportunity':'info',title:'PACE ADVANTAGE BUILDING',evidence:'Gaining '+Math.abs(ahead.rate).toFixed(2)+'s/lap on '+ahead.name+' · projected catch in '+eta+' laps.',action:'Maintain this pace and preserve ERS for the catch.',confidence:Math.min(94,72+ahead.laps*4),createdAt:now,expiresAt:now+14000,category:'BATTLE',validUntilLap:state.lap+2};
    }
    const aheadText=ahead?.gap!==null&&ahead?ahead.name+' '+ahead.gap.toFixed(1)+'s ahead':'clear ahead',behindText=behind?.gap!==null&&behind?behind.name+' '+behind.gap.toFixed(1)+'s behind':'clear behind';
    return {id:'pace-outlook-status-'+state.lap,priority:'info',title:'RACE STATUS',evidence:aheadText+' · '+behindText+'.',action:target==='—'?'Continue the current plan for three laps.':'Hold target '+target+' and reassess in three laps.',confidence:86,createdAt:now,expiresAt:now+12000,category:'PACE',validUntilLap:state.lap+2};
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
    if(!rival||!id||rival.laps<3||rival.gap===null||rival.gap>5||rival.catchLaps===null||rival.rate===null||rival.rate>-.12||rival.catchLaps>6||rival.catchLaps>lapsLeft){this.predictionBands.delete(key);return;}
    const eta=Math.max(1,Math.ceil(rival.catchLaps)),band=eta<=2?2:eta<=4?4:6,previous=this.predictionBands.get(key);
    if(previous!==undefined&&previous<=band)return;
    this.predictionBands.set(key,band);
    const attacking=role==='ahead';
    this.addEvent({id:'prediction-'+role+'-'+id+'-'+band,priority:attacking?'opportunity':'action',title:(attacking?'CATCH IN ':'THREAT IN ')+eta+' '+(eta===1?'LAP':'LAPS'),evidence:rival.name+' · gap '+(rival.gap??0).toFixed(1)+'s · trend '+Math.abs(rival.rate).toFixed(2)+'s/lap.',action:attacking?'Keep this pace and prepare ERS for the catch.':'The car behind is closing; protect exits and prepare the defence.',confidence:Math.min(96,76+rival.laps*4),createdAt:now,expiresAt:now+12000});
  }

  private addEvent(message:EngineerMessage){this.events.set(message.id,message);}

  private record(message:EngineerMessage|string,lap:number,at:number,status:DecisionLogEntry['status'],reason:string){
    const id=typeof message==='string'?message:message.id,key=id+':'+lap+':'+status;if(this.logged.has(key))return;this.logged.add(key);
    this.log.push({id,lap,at,status,reason,...(typeof message==='string'?{}:{score:message.score,confidence:message.confidence,priority:message.priority,title:message.title,category:message.category})});this.log=this.log.slice(-120);
  }

  private confirm(candidates:EngineerMessage[],now:number){
    const immediate=new Set(['red-flag','safety-car','tyre-wear']);
    const ids=new Set(candidates.map(x=>x.id));
    for(const [id,value] of this.seen)if(!ids.has(id)&&now-value.lastSeen>750)this.seen.delete(id);
    for(const candidate of candidates){const old=this.seen.get(candidate.id);this.seen.set(candidate.id,{since:old?.since??now,lastSeen:now});}
    return candidates.filter(candidate=>{
      if(immediate.has(candidate.id)||immediateMessage(candidate.id)||this.events.has(candidate.id))return true;
      const age=now-(this.seen.get(candidate.id)?.since??now),delay=candidate.id==='hot-tyres'?3000:candidate.id==='low-ers'?5000:1500;
      return age>=delay;
    });
  }
}
