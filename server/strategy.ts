import type { DecisionLogEntry, DriverState, EngineerMessage, PitOutcome, PitPlan, RaceMode, RaceState, RivalTrend, StrategyRules, StrategyState } from './types.js';

type LapQuality={invalid:boolean;pit:boolean;unsafe:boolean};
type RivalSnapshot={ahead:DriverState|null;behind:DriverState|null;aheadGap:number|null;behindGap:number|null};
type LapRecord={lap:number;timeMs:number;stintId:number;compound:string;age:number;wear:number;position:number;aheadId:string;aheadName:string;aheadGap:number|null;behindId:string;behindName:string;behindGap:number|null};
type Projection={position:number;min:number;max:number;rival:string;traffic:PitPlan['traffic'];confidence:number};
type PitEntry={gapToLeader:number|null;sessionTime:number;lap:number;position:number;projection:Projection};

const cleanQuality=():LapQuality=>({invalid:false,pit:false,unsafe:false});
const numericGap=(value?:string,stale?:boolean)=>!stale&&value?.startsWith('+')?Number(value.slice(1)):null;
const identity=(driver:DriverState|null)=>driver?String(driver.vehicleIndex??driver.name):'';
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length?sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2:null};
const lapMs=(value:string)=>{const match=/^(\d+):(\d+(?:\.\d+)?)$/.exec(value);return match?Number(match[1])*60000+Number(match[2])*1000:0};
const formatLap=(value:number|null)=>{if(!value||!Number.isFinite(value))return '—';const minutes=Math.floor(value/60000),seconds=(value-minutes*60000)/1000;return minutes+':'+seconds.toFixed(3).padStart(6,'0')};
const slope=(points:{x:number;y:number}[])=>median(points.flatMap((a,i)=>points.slice(i+1).map(b=>(b.y-a.y)/(b.x-a.x)).filter(Number.isFinite)));
const maxWear=(state:RaceState)=>state.context.tyreWear.some(Number.isFinite)?Math.max(...state.context.tyreWear):0;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const structuralDamage=(state:RaceState)=>Math.max(state.context.damage.frontWing,state.context.damage.rearWing,state.context.damage.floor,state.context.damage.diffuser,state.context.damage.sidepod,state.context.damage.gearbox,state.context.damage.engine);
const dryCompound=(value:string)=>['SOFT','MEDIUM','HARD'].includes(value);
const wetCompound=(value:string)=>['INTER','WET'].includes(value);
const estimatedPitLoss=(track:string)=>{
  const value=track.toLowerCase();
  if(value.includes('monza'))return 24;
  if(value.includes('monaco'))return 20;
  if(value.includes('bahrain'))return 23;
  if(value.includes('brazil')||value.includes('interlagos'))return 22;
  return 22;
};

export class PitwallStrategy {
  private sessionKey='';
  private currentLap=0;
  private quality=cleanQuality();
  private snapshot:RivalSnapshot={ahead:null,behind:null,aheadGap:null,behindGap:null};
  private records:LapRecord[]=[];
  private stintId=0;
  private compound='—';
  private tyreAge=0;
  private wear=0;
  private wasPitting=false;
  private pitEntry:PitEntry|null=null;
  private pitLossSamples:number[]=[];
  private activeRecommendation:EngineerMessage|null=null;
  private compoundsUsed=new Set<string>();
  private stops=0;
  private lastStop:PitOutcome|null=null;
  private recoveryAnnounced=0;
  private recoveryMessageLap=0;
  private raceMode:RaceMode='LEARNING';
  private modeChangedLap=0;
  private decisions:DecisionLogEntry[]=[];

  reset(){
    this.sessionKey='';this.currentLap=0;this.quality=cleanQuality();this.snapshot={ahead:null,behind:null,aheadGap:null,behindGap:null};
    this.records=[];this.stintId=0;this.compound='—';this.tyreAge=0;this.wear=0;this.wasPitting=false;this.pitEntry=null;
    this.pitLossSamples=[];this.activeRecommendation=null;this.compoundsUsed.clear();this.stops=0;this.lastStop=null;
    this.recoveryAnnounced=0;this.recoveryMessageLap=0;this.raceMode='LEARNING';this.modeChangedLap=0;this.decisions=[];
  }

  analyze(state:RaceState,now=Date.now()):RaceState {
    const raceSession=state.context.category==='RACE'||state.context.category==='SPRINT';
    const sessionKey=state.sessionUid+':'+state.sessionLinkId+':'+state.sessionType;
    if(this.sessionKey&&(sessionKey!==this.sessionKey||(this.currentLap&&state.lap<this.currentLap)))this.reset();
    this.sessionKey=sessionKey;
    if(!raceSession||!['CONNECTED','DEMO','PAUSED'].includes(state.status))return {...state,strategy:this.empty(state)};

    const rivals=this.rivals(state);
    if(!this.currentLap){this.currentLap=state.lap;this.beginStint(state);}
    if(state.lap>this.currentLap){
      this.finishLap(state);
      this.currentLap=state.lap;
      this.quality=cleanQuality();
    }
    if(state.player.tyre!==this.compound||state.player.tyreAge<this.tyreAge){
      this.stintId++;this.compound=state.player.tyre;
      if(dryCompound(this.compound)||wetCompound(this.compound))this.compoundsUsed.add(this.compound);
    }
    this.tyreAge=state.player.tyreAge;this.wear=maxWear(state);
    this.quality.invalid||=state.context.lapInvalid;
    this.quality.pit||=state.player.pit||state.player.driverStatus===2||state.player.driverStatus===3;
    this.quality.unsafe||=state.safetyCar!=='NONE'||state.flag!=='GREEN'||structuralDamage(state)>=30;
    const observedPitLoss=median(this.pitLossSamples.slice(-3));
    this.observePit(state,observedPitLoss??estimatedPitLoss(state.track),now);
    this.updatePitOutcome(state);
    this.snapshot=rivals;

    const ahead=this.rivalTrend(rivals.ahead,rivals.aheadGap,'ahead');
    const behind=this.rivalTrend(rivals.behind,rivals.behindGap,'behind');
    const stint=this.stint(state);
    const pitLoss=median(this.pitLossSamples.slice(-3));
    const status:StrategyState['status']=stint.cleanLaps>=3?'READY':'LEARNING';
    const rules=this.strategyRules(state,stint);
    const plan=this.pitPlan(state,ahead,stint,pitLoss);
    const recommendation=this.recommend(state,ahead,behind,stint,plan,rules,now);
    const desired=this.desiredMode(state,ahead,behind,recommendation,status);
    const raceMode=this.updateMode(desired,state,now);
    const target=this.targetLap(state,stint,raceMode);
    const modeReason=this.modeExplanation(raceMode,ahead,behind,rules,plan);
    const strategy:StrategyState={status,ahead,behind,gapHistory:this.gapHistory(rivals),stint,pitLossSeconds:pitLoss,rejoinPosition:plan.rejoinPosition,plan,rules,raceMode,modeReason,targetLapTime:formatLap(target.time),targetLapDeltaMs:target.delta,lastStop:this.lastStop,decisions:[...this.decisions],recommendation};
    return {...state,strategy};
  }

  private empty(state:RaceState):StrategyState {
    const loss=estimatedPitLoss(state.track);
    return {status:'LEARNING',ahead:null,behind:null,gapHistory:[],stint:{compound:state.player.tyre,age:state.player.tyreAge,cleanLaps:0,averageLapMs:null,degradationMs:null,paceDeltaMs:null,wear:maxWear(state)},pitLossSeconds:null,rejoinPosition:0,plan:{status:'LEARNING',pitLossSeconds:loss,pitLossSource:'TRACK_ESTIMATE',traffic:'UNKNOWN',rejoinPosition:0,rejoinMin:0,rejoinMax:0,rejoinRival:'',horizonLaps:0,freshTyreGainSeconds:null,stayOneMoreCostSeconds:null,undercutGainSeconds:null,overcutGainSeconds:null,confidence:0},rules:{mandatoryStopRequired:false,mandatoryStopComplete:true,compoundsUsed:[],stops:0,windowStart:null,recommendedPitLap:null,windowEnd:null,latestSafePitLap:null},raceMode:'LEARNING',modeReason:'Waiting for race data',targetLapTime:'—',targetLapDeltaMs:null,lastStop:null,decisions:[...this.decisions],recommendation:null};
  }

  private beginStint(state:RaceState){
    this.stintId=1;this.compound=state.player.tyre;this.tyreAge=state.player.tyreAge;this.wear=maxWear(state);
    if(dryCompound(this.compound)||wetCompound(this.compound))this.compoundsUsed.add(this.compound);
  }

  private rivals(state:RaceState):RivalSnapshot {
    const ordered=[...state.drivers].filter(d=>d.position>0).sort((a,b)=>a.position-b.position);
    const me=ordered.find(d=>d.position===state.player.position),ahead=ordered.find(d=>d.position===state.player.position-1)||null,behind=ordered.find(d=>d.position===state.player.position+1)||null;
    return {ahead,behind,aheadGap:numericGap(me?.interval,me?.intervalStale),behindGap:numericGap(behind?.interval,behind?.intervalStale)};
  }

  private finishLap(state:RaceState){
    const time=lapMs(state.player.lastLap),snap=this.snapshot;
    if(!this.quality.invalid&&!this.quality.pit&&!this.quality.unsafe&&time>=30000&&time<=300000){
      this.records.push({lap:this.currentLap,timeMs:time,stintId:this.stintId,compound:this.compound,age:this.tyreAge,wear:this.wear,position:state.player.position,aheadId:identity(snap.ahead),aheadName:snap.ahead?.name||'',aheadGap:snap.aheadGap,behindId:identity(snap.behind),behindName:snap.behind?.name||'',behindGap:snap.behindGap});
      this.records=this.records.slice(-40);
    }
  }

  private rivalTrend(driver:DriverState|null,gap:number|null,role:'ahead'|'behind'):RivalTrend|null {
    if(!driver)return null;
    const id=identity(driver),field=role==='ahead'?'aheadGap':'behindGap',idField=role==='ahead'?'aheadId':'behindId';
    const usable=this.records.filter(r=>r[idField]===id&&r[field]!==null).slice(-5),rate=usable.length>=3?slope(usable.map(r=>({x:r.lap,y:r[field]!}))):null;
    let direction:RivalTrend['direction']='LEARNING',catchLaps:number|null=null;
    if(rate!==null){direction=Math.abs(rate)<.08?'STABLE':role==='ahead'?(rate<0?'GAINING':'LOSING'):(rate<0?'LOSING':'GAINING');if(gap!==null&&rate<-.08)catchLaps=Math.max(.1,gap/Math.abs(rate));}
    return {vehicleIndex:driver.vehicleIndex,name:driver.name,position:driver.position,gap,rate,direction,laps:usable.length,catchLaps,tyre:driver.tyre,tyreAge:driver.tyreAge,pit:driver.pit};
  }

  private stint(state:RaceState){
    const all=this.records.filter(r=>r.stintId===this.stintId),centre=median(all.map(r=>r.timeMs)),limit=centre===null?0:Math.max(2500,centre*.03),clean=centre===null?[]:all.filter(r=>Math.abs(r.timeMs-centre)<=limit),recent=clean.slice(-3),average=median(recent.map(r=>r.timeMs)),degradation=clean.length>=3?slope(clean.map(r=>({x:r.age,y:r.timeMs}))):null,best=clean.length?Math.min(...clean.map(r=>r.timeMs)):null;
    return {compound:state.player.tyre,age:state.player.tyreAge,cleanLaps:clean.length,averageLapMs:average,degradationMs:degradation===null?null:Math.max(0,degradation),paceDeltaMs:average===null||best===null?null:Math.max(0,average-best),wear:maxWear(state)};
  }

  private gapHistory(live:RivalSnapshot){
    const completed=this.records.slice(-4).map(r=>({lap:r.lap,ahead:r.aheadGap,behind:r.behindGap}));
    return [...completed,{lap:this.currentLap,ahead:live.aheadGap,behind:live.behindGap}].filter((point,index,list)=>index===list.findIndex(x=>x.lap===point.lap)).slice(-5);
  }

  private fieldProjection(state:RaceState,pitLoss:number):Projection {
    const ordered=[...state.drivers].filter(d=>d.position>0),me=ordered.find(d=>d.position===state.player.position);
    const ownGap=state.player.position===1?0:numericGap(me?.gap,me?.gapStale);
    const factor=state.player.tyre==='SOFT'?.42:state.player.tyre==='HARD'?.62:.53,cycleStart=Math.max(2,Math.round(state.totalLaps*factor)-2);
    const cycleWindow=state.context.category==='RACE'&&dryCompound(state.player.tyre)&&state.totalLaps>2&&state.lap>=cycleStart;
    const likelySameCycle=(driver:DriverState)=>cycleWindow&&driver.tyre===state.player.tyre&&driver.tyreAge>=Math.max(1,state.player.tyreAge-1);
    const withGap=ordered.filter(d=>d.position!==state.player.position).map(d=>({driver:d,gap:d.position===1?0:numericGap(d.gap,d.gapStale)})).filter((x):x is {driver:DriverState;gap:number}=>x.gap!==null);
    const usable=withGap.filter(x=>!likelySameCycle(x.driver));
    if(ownGap===null||withGap.length<Math.max(3,ordered.length*.5)||usable.length<3){
      const fallback=state.context.pitRejoinPosition||state.player.position;
      return {position:fallback,min:Math.max(1,fallback-2),max:Math.min(Math.max(1,ordered.length),fallback+2),rival:'',traffic:'UNKNOWN',confidence:35};
    }
    const positionFor=(loss:number)=>1+usable.filter(x=>x.gap<ownGap+loss).length;
    const position=positionFor(pitLoss),min=positionFor(Math.max(0,pitLoss-2)),max=positionFor(pitLoss+2),projectedGap=ownGap+pitLoss;
    const nearest=[...usable].sort((a,b)=>Math.abs(a.gap-projectedGap)-Math.abs(b.gap-projectedGap))[0],distance=nearest?Math.abs(nearest.gap-projectedGap):99;
    const traffic:PitPlan['traffic']=distance<=1.5?'HEAVY':distance<=3?'MODERATE':'CLEAR';
    return {position,min:Math.min(min,max),max:Math.max(min,max),rival:nearest?.driver.name||'',traffic,confidence:Math.round(clamp(64+usable.length/Math.max(1,ordered.length)*25,0,92))};
  }

  private observePit(state:RaceState,pitLoss:number,now:number){
    const pitting=state.player.pit||state.player.driverStatus===2||state.player.driverStatus===3;
    const ordered=[...state.drivers].filter(d=>d.position>0),me=ordered.find(d=>d.position===state.player.position),gap=state.player.position===1?0:numericGap(me?.gap,me?.gapStale);
    if(pitting&&!this.wasPitting){
      const projection=this.fieldProjection(state,pitLoss);
      this.pitEntry={gapToLeader:gap,sessionTime:state.sessionTime,lap:state.lap,position:state.player.position,projection};
      this.stops++;
      this.record('pit-entry-'+state.lap,state.lap,now,'EMITTED','Entered P'+state.player.position+'; projected P'+projection.min+'–P'+projection.max);
    }
    if(!pitting&&this.wasPitting&&this.pitEntry){
      const byGap=gap!==null&&this.pitEntry.gapToLeader!==null?gap-this.pitEntry.gapToLeader:null,elapsed=state.sessionTime-this.pitEntry.sessionTime,value=byGap!==null&&byGap>=5&&byGap<=60?byGap:elapsed>=5&&elapsed<=60?elapsed:null;
      if(value!==null)this.pitLossSamples.push(value);
      this.lastStop={pitLap:this.pitEntry.lap,exitLap:state.lap,entryPosition:this.pitEntry.position,exitPosition:state.player.position,predictedMin:this.pitEntry.projection.min,predictedMax:this.pitEntry.projection.max,actualLossSeconds:value,positionsRecovered:0,cycleComplete:state.player.position<=this.pitEntry.position};
      this.record('pit-exit-'+this.pitEntry.lap,state.lap,now,'RESOLVED','Exited P'+state.player.position+' after '+(value===null?'unknown':value.toFixed(1)+'s')+' pit loss');
      this.pitEntry=null;
    }
    this.wasPitting=pitting;
  }

  private updatePitOutcome(state:RaceState){
    if(!this.lastStop)return;
    const recovered=Math.max(this.lastStop.positionsRecovered,this.lastStop.exitPosition-state.player.position);
    this.lastStop={...this.lastStop,positionsRecovered:recovered,cycleComplete:this.lastStop.cycleComplete||state.player.position<=this.lastStop.entryPosition};
  }

  private strategyRules(state:RaceState,stint:StrategyState['stint']):StrategyRules {
    const compounds=[...this.compoundsUsed],wet=compounds.some(wetCompound)||wetCompound(state.player.tyre)||/rain|storm/i.test(state.weather);
    const required=state.context.category==='RACE'&&state.totalLaps>2&&!wet,complete=!required||new Set(compounds.filter(dryCompound)).size>=2;
    if(!required)return {mandatoryStopRequired:false,mandatoryStopComplete:true,compoundsUsed:compounds,stops:this.stops,windowStart:null,recommendedPitLap:null,windowEnd:null,latestSafePitLap:null};
    const first=compounds.find(dryCompound)||state.player.tyre,factor=first==='SOFT'?.42:first==='HARD'?.62:.53;
    let ideal=Math.round(state.totalLaps*factor);
    if(stint.wear>=55||(stint.degradationMs??0)>=300)ideal--;
    ideal=Math.round(clamp(ideal,2,Math.max(2,state.totalLaps-2)));
    return {mandatoryStopRequired:true,mandatoryStopComplete:complete,compoundsUsed:compounds,stops:this.stops,windowStart:Math.max(2,ideal-2),recommendedPitLap:ideal,windowEnd:Math.min(state.totalLaps-1,ideal+1),latestSafePitLap:Math.max(2,state.totalLaps-1)};
  }

  private pitPlan(state:RaceState,ahead:RivalTrend|null,stint:StrategyState['stint'],observedPitLoss:number|null):PitPlan {
    const pitLossSeconds=observedPitLoss??estimatedPitLoss(state.track),projection=this.fieldProjection(state,pitLossSeconds);
    const lapsLeft=state.totalLaps?Math.max(0,state.totalLaps-state.lap):0,horizonLaps=Math.min(5,lapsLeft),source:PitPlan['pitLossSource']=observedPitLoss===null?'TRACK_ESTIMATE':'OBSERVED';
    const base={pitLossSeconds,pitLossSource:source,traffic:projection.traffic,rejoinPosition:projection.position,rejoinMin:projection.min,rejoinMax:projection.max,rejoinRival:projection.rival,horizonLaps,confidence:Math.round(clamp(projection.confidence+(observedPitLoss===null?0:6),0,97))};
    if(stint.cleanLaps<3||horizonLaps<2)return {status:'LEARNING',...base,freshTyreGainSeconds:null,stayOneMoreCostSeconds:null,undercutGainSeconds:null,overcutGainSeconds:null};
    const degradation=(stint.degradationMs??0)/1000,paceLoss=(stint.paceDeltaMs??0)/1000,gainPerLap=clamp(degradation+stint.wear*.006+Math.max(0,stint.age-4)*.018,.08,1.8);
    const freshTyreGainSeconds=Math.max(0,gainPerLap*Math.min(3,horizonLaps)-.65),stayOneMoreCostSeconds=Math.max(0,degradation+paceLoss*.45+Math.max(0,stint.wear-45)*.012);
    const trafficPenalty=projection.traffic==='HEAVY'?1.8:projection.traffic==='MODERATE'?.7:projection.traffic==='UNKNOWN'?.4:0;
    const undercutGainSeconds=!ahead||ahead.gap===null?null:freshTyreGainSeconds+Math.max(0,ahead.tyreAge-stint.age)*.05-Math.max(0,ahead.gap-1.2)-trafficPenalty;
    const overcutGainSeconds=ahead?.pit?1.8-stayOneMoreCostSeconds-Math.max(0,(ahead.gap??0)-1):null;
    return {status:'READY',...base,freshTyreGainSeconds,stayOneMoreCostSeconds,undercutGainSeconds,overcutGainSeconds};
  }

  private recommend(state:RaceState,ahead:RivalTrend|null,behind:RivalTrend|null,stint:StrategyState['stint'],plan:PitPlan,rules:StrategyRules,now:number){
    const pitting=state.player.pit||state.player.driverStatus===2||state.player.driverStatus===3;
    const terminal=['FINISHED','RETIRED'].includes(state.context.lifecycle);
    if(pitting||terminal)return this.setRecommendation(null,state,now,true);
    const lapsLeft=state.totalLaps?state.totalLaps-state.lap:99;
    if(lapsLeft<=0)return this.setRecommendation(null,state,now,true);
    let next:EngineerMessage|null=null;
    const make=(id:string,priority:EngineerMessage['priority'],title:string,evidence:string,action:string,confidence:number):EngineerMessage=>({id,priority,title,evidence,action,confidence,createdAt:now,expiresAt:now+12000});
    if(this.lastStop&&state.lap<=this.lastStop.exitLap+1){
      const inside=this.lastStop.exitPosition>=this.lastStop.predictedMin&&this.lastStop.exitPosition<=this.lastStop.predictedMax;
      next=make('strategy-pit-exit-'+this.lastStop.pitLap,'opportunity','PIT EXIT: P'+this.lastStop.exitPosition,'Predicted P'+this.lastStop.predictedMin+'–P'+this.lastStop.predictedMax+' · '+(inside?'inside range':'outside range')+' · '+(this.lastStop.actualLossSeconds?.toFixed(1)??'—')+'s loss.','Push for two laps while the new tyres are strongest.',94);
    }else if(this.lastStop&&this.lastStop.cycleComplete&&this.recoveryAnnounced!==this.lastStop.pitLap){
      if(!this.recoveryMessageLap)this.recoveryMessageLap=state.lap;
      if(state.lap>this.recoveryMessageLap){this.recoveryAnnounced=this.lastStop.pitLap;this.recoveryMessageLap=0;}
      else
      next=make('strategy-cycle-complete-'+this.lastStop.pitLap,'opportunity','PIT CYCLE COMPLETE','Recovered '+this.lastStop.positionsRecovered+' positions since rejoining P'+this.lastStop.exitPosition+'.','Settle into the new race mode and protect the result.',96);
    }else if(rules.mandatoryStopRequired&&!rules.mandatoryStopComplete&&rules.latestSafePitLap!==null&&state.lap>=rules.latestSafePitLap){
      next=make('strategy-box-latest','action','BOX NOW: REQUIRED STOP','A second dry compound is still required and only '+lapsLeft+' lap remains.','Box this lap to complete the mandatory tyre change.',100);
    }else if(rules.mandatoryStopRequired&&!rules.mandatoryStopComplete&&rules.recommendedPitLap!==null&&state.lap>=rules.recommendedPitLap){
      next=make('strategy-box-mandatory','action','BOX THIS LAP','Mandatory tyre change pending · own window '+rules.windowStart+'–'+rules.windowEnd+' · projected P'+plan.rejoinMin+'–P'+plan.rejoinMax+'.','Box this lap and switch to a different dry compound.',98);
    }else if(rules.mandatoryStopRequired&&!rules.mandatoryStopComplete&&rules.recommendedPitLap!==null&&state.lap===rules.recommendedPitLap-1){
      next=make('strategy-box-next','action','BOX NEXT LAP','Mandatory tyre change pending · projected cycle rejoin P'+plan.rejoinMin+'–P'+plan.rejoinMax+' near '+(plan.rejoinRival||'clear air')+'.','Push this lap, then box for a different dry compound.',97);
    }else if(rules.mandatoryStopRequired&&!rules.mandatoryStopComplete&&rules.windowStart!==null&&state.lap>=rules.windowStart){
      next=make('strategy-mandatory-window','opportunity','BOX WINDOW: L'+rules.recommendedPitLap,'A second compound is required · projected rejoin P'+plan.rejoinMin+'–P'+plan.rejoinMax+' near '+(plan.rejoinRival||'clear air')+'.','Prepare to box in '+Math.max(0,(rules.recommendedPitLap??state.lap)-state.lap)+' laps.',94);
    }else if(stint.cleanLaps>=3){
      const source=plan.pitLossSource==='OBSERVED'?'learned':'estimated';
      if(lapsLeft>1&&(stint.wear>=70||(stint.cleanLaps>=4&&stint.wear>=40&&stint.degradationMs!==null&&stint.degradationMs>=350&&stint.age>=6)))next=make('strategy-box','action','BOX THIS LAP','Tyre wear '+stint.wear+'% · degradation '+((stint.degradationMs??0)/1000).toFixed(2)+'s/lap · rejoin P'+plan.rejoinMin+'–P'+plan.rejoinMax+'.','Pit now; the current stint is losing more time than it protects.',96);
      else if(behind?.pit&&behind.gap!==null&&behind.gap<=3&&stint.wear>=40&&(plan.stayOneMoreCostSeconds??0)>=.25)next=make('strategy-cover','action','COVER THE STOP',behind.name+' stopped from '+behind.gap.toFixed(1)+'s behind · staying out costs '+(plan.stayOneMoreCostSeconds??0).toFixed(1)+'s.','Box this lap unless the projected rejoin traffic is heavy.',Math.max(90,plan.confidence));
      else if(ahead?.pit&&stint.wear<65&&(plan.overcutGainSeconds??0)>=.5)next=make('strategy-overcut','opportunity','OVERCUT: STAY OUT',ahead.name+' stopped · modeled overcut +'+(plan.overcutGainSeconds??0).toFixed(1)+'s.','Stay out one lap, push in clean air, then reassess.',plan.confidence);
      else if(ahead&&!ahead.pit&&ahead.gap!==null&&ahead.gap<=3&&stint.age>=4&&(plan.undercutGainSeconds??0)>=.6&&plan.traffic!=='HEAVY')next=make('strategy-undercut','opportunity','UNDERCUT AVAILABLE',ahead.name+' is '+ahead.gap.toFixed(1)+'s ahead · modeled gain '+(plan.undercutGainSeconds??0).toFixed(1)+'s · rejoin P'+plan.rejoinMin+'–P'+plan.rejoinMax+'.','Box before the car ahead; the model favors the undercut.',plan.confidence);
      else if(behind&&behind.gap!==null&&behind.gap>plan.pitLossSeconds+1.5&&stint.wear>=55&&(plan.freshTyreGainSeconds??0)>=1)next=make('strategy-free-stop','opportunity','FREE STOP AVAILABLE',behind.gap.toFixed(1)+'s behind versus '+plan.pitLossSeconds.toFixed(1)+'s '+source+' pit loss.','Use the gap for fresh tyres before it closes.',Math.max(88,plan.confidence));
    }
    if(next&&['strategy-overcut','strategy-undercut','strategy-cover'].includes(next.id))next.validUntilLap=state.lap+1;
    return this.setRecommendation(next,state,now);
  }

  private setRecommendation(next:EngineerMessage|null,state:RaceState,now:number,forceClear=false){
    const old=this.activeRecommendation;
    const latchable=old&&['strategy-overcut','strategy-undercut','strategy-cover'].includes(old.id)&&old.expiresAt>now&&(old.validUntilLap??state.lap)>=state.lap;
    if(!next&&!forceClear&&latchable)return old;
    if(old&&old.id!==next?.id)this.record(old.id,state.lap,now,'RESOLVED','Condition cleared or a higher-value call replaced it');
    if(!next){this.activeRecommendation=null;return null;}
    if(old?.id===next.id){next.createdAt=old.createdAt;next.expiresAt=old.expiresAt;}
    else this.record(next.id,state.lap,now,'EMITTED',next.evidence);
    this.activeRecommendation=next;
    return next;
  }

  private desiredMode(state:RaceState,ahead:RivalTrend|null,behind:RivalTrend|null,recommendation:EngineerMessage|null,status:StrategyState['status']):RaceMode {
    if(['FINISHED','RETIRED'].includes(state.context.lifecycle))return 'MANAGE';
    if(state.flag==='RED'||state.safetyCar!=='NONE')return 'SAFETY';
    if(state.player.pit||state.player.driverStatus===2||state.player.driverStatus===3||recommendation?.id.startsWith('strategy-box'))return 'BOX';
    if(this.lastStop&&state.lap<=this.lastStop.exitLap+2)return 'PUSH';
    const rearCritical=!!behind&&((behind.gap!==null&&behind.gap<=1)||(behind.catchLaps!==null&&behind.catchLaps<=2));
    const frontCritical=!!ahead&&((ahead.gap!==null&&ahead.gap<=1.2)||(ahead.catchLaps!==null&&ahead.catchLaps<=2));
    if(this.raceMode==='ATTACK'&&!rearCritical&&ahead&&((ahead.gap!==null&&ahead.gap<=2.5)||(ahead.catchLaps!==null&&ahead.catchLaps<=5)))return 'ATTACK';
    if(this.raceMode==='DEFEND'&&!frontCritical&&behind&&((behind.gap!==null&&behind.gap<=2)||(behind.catchLaps!==null&&behind.catchLaps<=4)))return 'DEFEND';
    if(behind&&((behind.gap!==null&&behind.gap<=1.5)||(behind.catchLaps!==null&&behind.catchLaps<=3)))return 'DEFEND';
    if(ahead&&((ahead.gap!==null&&ahead.gap<=2)||(ahead.catchLaps!==null&&ahead.catchLaps<=4)))return 'ATTACK';
    if(state.player.position===1&&behind&&behind.gap!==null&&behind.gap>=3)return 'MANAGE';
    return status==='READY'||this.raceMode!=='LEARNING'?'MANAGE':'LEARNING';
  }

  private updateMode(desired:RaceMode,state:RaceState,now:number){
    if(desired===this.raceMode)return this.raceMode;
    const immediate=desired==='SAFETY'||desired==='BOX'||this.raceMode==='SAFETY'||this.raceMode==='BOX';
    if(immediate||this.raceMode==='LEARNING'||state.lap-this.modeChangedLap>=2){
      const previous=this.raceMode;this.raceMode=desired;this.modeChangedLap=state.lap;
      this.record('mode-'+desired.toLowerCase()+'-'+state.lap,state.lap,now,'EMITTED',previous+' → '+desired);
    }
    return this.raceMode;
  }

  private targetLap(state:RaceState,stint:StrategyState['stint'],mode:RaceMode){
    const last=lapMs(state.player.lastLap),best=lapMs(state.player.bestLap),reliableLast=last&&(!best||last<=best+5000)?last:0;
    const baseline=stint.averageLapMs??(reliableLast||best);
    if(!baseline||['LEARNING','BOX','SAFETY'].includes(mode))return {time:null,delta:null};
    const delta=mode==='MANAGE'?600:mode==='DEFEND'?100:mode==='ATTACK'?-100:0;
    return {time:baseline+delta,delta};
  }

  private modeExplanation(mode:RaceMode,ahead:RivalTrend|null,behind:RivalTrend|null,rules:StrategyRules,plan:PitPlan){
    if(mode==='SAFETY')return 'Race control restrictions active';
    if(mode==='BOX')return 'Pit instruction is the priority';
    if(mode==='PUSH')return 'Exploit the strongest laps after the stop';
    if(mode==='DEFEND')return (behind?.name||'Car behind')+' is the immediate threat';
    if(mode==='ATTACK')return (ahead?.name||'Car ahead')+' is within the attack horizon';
    if(mode==='MANAGE')return rules.mandatoryStopRequired&&!rules.mandatoryStopComplete?'Control pace until the pit window':'Protect tyres and maintain the required gap';
    return plan.status==='LEARNING'?'Building clean-lap references':'Waiting for a stable race signal';
  }

  private record(id:string,lap:number,at:number,status:DecisionLogEntry['status'],reason:string){
    const previous=this.decisions.at(-1);
    if(previous&&previous.id===id&&previous.status===status)return;
    this.decisions.push({id,lap,at,status,reason});
    this.decisions=this.decisions.slice(-40);
  }
}
