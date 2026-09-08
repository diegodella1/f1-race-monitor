import type { EngineerMessage, PitPlan, RaceState, WeatherForecast } from './types.js';
import type { TyreFamily, WeatherAssessment, WeatherPhase } from './weatherTypes.js';
import { tyreFamily, WeatherPaceEvidence } from './weatherEvidence.js';

export const WEATHER_LIMITS={sessionAgeMs:7000,confirmationMs:10000,forecastProbability:60,forecastMinutes:15,noticeMs:60000,minRivals:2,minGainSeconds:1,minGainFraction:.01,pitMarginSeconds:2} as const;
export const weatherPhase=(weather:string):WeatherPhase=>{
  if(['Clear','Light cloud','Overcast'].includes(weather)||weather.startsWith('Dry'))return 'DRY';
  if(weather==='Light rain')return 'LIGHT_RAIN';
  if(['Heavy rain','Storm'].includes(weather))return 'HEAVY_RAIN';
  return 'UNKNOWN';
};
const familyFor=(phase:WeatherPhase):TyreFamily|null=>phase==='DRY'?'SLICKS':phase==='LIGHT_RAIN'?'INTER':phase==='HEAVY_RAIN'?'WET':null;
export const familyLabel=(family:TyreFamily)=>({SLICKS:'slicks',INTER:'intermediates',WET:'full wets'}[family]);
type WeatherState=Pick<RaceState,'context'|'telemetry'|'updatedAt'>;
export function weatherDataAge(state:WeatherState,now:number):number|null {
  if(state.context.weatherObservedAt!==undefined)return Math.max(0,now-state.context.weatherObservedAt);
  const packet=state.telemetry.packets.find(packet=>packet.id===1);
  return packet?.ageMs!=null?Math.max(0,packet.ageMs+now-state.updatedAt):null;
}
const inactive=(state:RaceState)=>!['CONNECTED','DEMO'].includes(state.status)||state.context.gamePaused||['FINISHED','RETIRED'].includes(state.context.lifecycle);

export class WeatherStrategy {
  private key='';
  private epoch=0;
  private sequence=0;
  private lastTime=-Infinity;
  private confirmed:WeatherPhase='UNKNOWN';
  private candidate:WeatherPhase='UNKNOWN';
  private candidateSince=0;
  private blocked=false;
  private evidence=new WeatherPaceEvidence();
  private forecastKey='';
  private forecastMessage:EngineerMessage|null=null;
  private changeMessage:EngineerMessage|null=null;
  private boxMessage:EngineerMessage|null=null;

  reset(){
    this.key='';this.epoch++;this.sequence=0;this.lastTime=-Infinity;this.confirmed='UNKNOWN';this.candidate='UNKNOWN';
    this.candidateSince=0;this.blocked=false;this.evidence.reset();this.forecastKey='';
    this.forecastMessage=null;this.changeMessage=null;this.boxMessage=null;
  }

  analyze(state:RaceState,plan:PitPlan,now=Date.now()):WeatherAssessment {
    const key=`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}:${state.raceControl?.generation??0}`;
    if(this.key&&(this.key!==key||state.sessionTime<this.lastTime))this.reset();
    this.key=key;this.lastTime=state.sessionTime;
    const ageMs=weatherDataAge(state,now),observed=weatherPhase(state.weather);
    const fresh=ageMs!==null&&ageMs<=WEATHER_LIMITS.sessionAgeMs&&observed!=='UNKNOWN'&&!inactive(state);
    const assessment:WeatherAssessment={epoch:this.epoch,observed,confirmed:this.confirmed,fresh,ageMs,
      forecastAccuracy:state.context.forecastAccuracy??'UNKNOWN',forecast:this.forecast(state),action:'INSUFFICIENT_DATA',
      recommendedFamily:null,transition:false,reason:'Current weather telemetry is unavailable.',confidence:'LOW',
      evidence:{rivals:0,gainSeconds:null,netGainSeconds:null,horizonLaps:0},messages:[]};
    if(!fresh){
      if(!this.blocked){this.epoch++;this.evidence.reset();this.forecastKey='';this.forecastMessage=null;this.changeMessage=null;this.boxMessage=null;}
      this.blocked=true;this.candidate='UNKNOWN';assessment.epoch=this.epoch;return assessment;
    }
    this.blocked=false;
    this.observePhase(state,observed,now);
    this.evidence.observe(state,observed,now);
    assessment.epoch=this.epoch;assessment.confirmed=this.confirmed;
    this.assessTyres(state,plan,assessment);
    this.updateMessages(state,assessment,now);
    return assessment;
  }

  private forecast(state:RaceState):WeatherForecast[]{
    const elapsed=Math.max(0,state.sessionTime-(state.context.weatherSessionTime??state.sessionTime))/60;
    return state.context.weatherForecast.map(sample=>({...sample,minutes:sample.minutes-elapsed}))
      .filter(sample=>sample.minutes>0&&sample.minutes<=WEATHER_LIMITS.forecastMinutes&&weatherPhase(sample.weather)!=='UNKNOWN')
      .sort((a,b)=>a.minutes-b.minutes);
  }

  private observePhase(state:RaceState,observed:WeatherPhase,now:number){
    if(observed!==this.candidate){this.candidate=observed;this.candidateSince=now;}
    if(observed===this.confirmed||now-this.candidateSince<WEATHER_LIMITS.confirmationMs)return;
    const before=this.confirmed;this.confirmed=observed;this.epoch++;
    this.changeMessage=null;this.forecastMessage=null;this.forecastKey='';this.boxMessage=null;
    if(before==='UNKNOWN'&&observed==='DRY')return;
    const text=observed==='DRY'?'Rain has stopped. The track may still be wet. Wait for tyre pace evidence.':observed==='HEAVY_RAIN'?'Heavy rain confirmed. Assess full wets; we are checking the pace.':'Rain confirmed. Prepare intermediates; we are checking the pace.';
    this.changeMessage=this.message(state,'CHANGE',text,now);
  }

  private assessTyres(state:RaceState,plan:PitPlan,result:WeatherAssessment){
    const current=tyreFamily(state.player.tyre),target=familyFor(this.confirmed);
    result.transition=this.candidate!==this.confirmed||(target!==null&&current!==null&&target!==current);
    if(!current||!target||this.candidate!==this.confirmed){result.reason='Confirming conditions before assessing tyre choice.';return;}
    if(current===target){
      const change=result.forecast.find(sample=>familyFor(weatherPhase(sample.weather))!==current&&(weatherPhase(sample.weather)==='DRY'||sample.rainPercentage>=WEATHER_LIMITS.forecastProbability));
      result.action=change?'PREPARE':'MAINTAIN';result.recommendedFamily=change?familyFor(weatherPhase(change.weather)):current;
      result.reason=change?'A weather change is forecast. Prepare the tyre change; stay on the current tyres for now.':'Current tyre family matches the observed conditions.';
      return;
    }
    result.recommendedFamily=target;result.action='PREPARE';
    if(state.flag!=='GREEN'||state.safetyCar!=='NONE'){
      result.reason='Race neutralized. Wait for green conditions before confirming a weather stop.';return;
    }
    const pace=this.evidence.advantage(target,this.confirmed);
    result.evidence.rivals=pace.rivals;result.evidence.gainSeconds=pace.gainSeconds;
    if(state.player.pit){result.reason='In the pits. Reassess once the fitted tyre is confirmed.';return;}
    const freshPace=[2,7].every(id=>state.telemetry.packets.some(packet=>packet.id===id&&packet.healthy&&packet.ageMs!==null&&packet.ageMs<=(id===2?1800:3500)));
    if(!freshPace){result.reason='Waiting for fresh lap and tyre telemetry.';return;}
    if(pace.rivals<WEATHER_LIMITS.minRivals||pace.gainSeconds===null||pace.lapSeconds===null){
      result.reason=`Waiting for two comparable rivals: ${pace.rivals}/2 confirmed. Each needs three reference laps and two laps after changing tyres.`;return;
    }
    const threshold=Math.max(WEATHER_LIMITS.minGainSeconds,pace.lapSeconds*WEATHER_LIMITS.minGainFraction);
    if(pace.gainSeconds<=threshold){result.action='MAINTAIN';result.recommendedFamily=current;result.reason='The alternative tyre has not shown a sufficient pace advantage.';return;}
    const reversal=result.forecast.find(sample=>familyFor(weatherPhase(sample.weather))!==target&&(weatherPhase(sample.weather)==='DRY'||sample.rainPercentage>=WEATHER_LIMITS.forecastProbability));
    let horizon=Math.max(0,state.totalLaps-state.lap);
    if(state.context.timeLeft>0)horizon=Math.min(horizon,Math.floor(state.context.timeLeft/pace.lapSeconds));
    if(reversal)horizon=Math.min(horizon,Math.floor(reversal.minutes*60/pace.lapSeconds));
    const net=pace.gainSeconds*horizon-plan.pitLossSeconds;
    result.evidence.horizonLaps=horizon;result.evidence.netGainSeconds=net;
    if(!Number.isFinite(plan.pitLossSeconds)||plan.pitLossSeconds<=0){result.reason='Pit loss is unknown. Cannot confirm the benefit of stopping.';return;}
    if(net<=WEATHER_LIMITS.pitMarginSeconds){result.action='MAINTAIN';result.recommendedFamily=current;result.reason='The estimated gain does not recover the pit stop before the finish or next weather change.';return;}
    result.action='BOX';result.confidence='MEDIUM';
    result.reason=`${pace.rivals} comparable rivals show ${pace.gainSeconds.toFixed(1)}s per lap advantage. Estimated net gain ${net.toFixed(1)}s after the stop.`;
  }

  private updateMessages(state:RaceState,result:WeatherAssessment,now:number){
    const rain=result.forecast.find(sample=>sample.rainPercentage>=WEATHER_LIMITS.forecastProbability&&weatherPhase(sample.weather)!=='DRY');
    const key=this.confirmed==='DRY'&&rain?`${weatherPhase(rain.weather)}:${rain.minutes<=5?'soon':'later'}`:'';
    if(key!==this.forecastKey){
      this.forecastKey=key;this.forecastMessage=key&&rain?this.message(state,'FORECAST',`Rain forecast in about ${Math.ceil(rain.minutes)} minutes, ${rain.rainPercentage} percent chance. ${result.forecastAccuracy==='APPROXIMATE'?'Timing is approximate. ':''}Prepare for ${familyLabel(familyFor(weatherPhase(rain.weather))!)}; stay out for now.`,now):null;
    }
    if(result.action!=='BOX')this.boxMessage=null;
    else if(!this.boxMessage)this.boxMessage=this.message(state,'BOX',`Box this lap for ${familyLabel(result.recommendedFamily!)}. Comparable cars confirm a pace advantage.`,now,result.recommendedFamily!);
    result.messages=[this.changeMessage,this.forecastMessage,this.boxMessage].filter((message):message is EngineerMessage=>!!message&&message.expiresAt>now&&message.weather?.epoch===this.epoch);
  }

  private message(state:RaceState,kind:'CHANGE'|'FORECAST'|'BOX',text:string,now:number,family?:TyreFamily):EngineerMessage {
    const id=`weather-${kind.toLowerCase()}-${this.epoch}-${++this.sequence}`;
    return {id,eventId:`${this.key}:${id}`,sessionKey:`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`,
      priority:'action',category:kind==='BOX'?'STRATEGY':'STATUS',title:kind==='BOX'?`BOX FOR ${familyLabel(family!).toUpperCase()}`:kind==='FORECAST'?'RAIN FORECAST':'WEATHER UPDATE',
      evidence:text,action:text,confidence:kind==='BOX'?75:90,createdAt:now,expiresAt:kind==='BOX'?Number.MAX_SAFE_INTEGER:now+WEATHER_LIMITS.noticeMs,
      weather:{epoch:this.epoch,kind,family},radio:{en:text,es:text}};
  }
}
