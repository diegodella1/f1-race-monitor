import type { EngineerCategory, EngineerMessage, RaceState } from './types.js';

const baseScore:Record<EngineerMessage['priority'],number>={critical:88,action:68,opportunity:55,info:38};
const thresholds:Record<EngineerMessage['priority'],number>={critical:0,action:62,opportunity:55,info:46};

export function messageFamily(id:string){
  if(id.startsWith('damage-'))return id.split('-').slice(0,2).join('-');
  if(id.startsWith('prediction-ahead-'))return 'prediction-ahead';
  if(id.startsWith('prediction-behind-'))return 'prediction-behind';
  if(id.startsWith('drs-attack-'))return 'drs-attack';
  if(id.startsWith('drs-defend-'))return 'drs-defend';
  if(id.startsWith('mode-'))return 'race-mode';
  if(id.startsWith('pace-outlook-'))return 'pace-outlook';
  if(id.startsWith('weather-')||id.startsWith('rain-forecast-'))return 'weather';
  if(id.startsWith('strategy-box'))return 'strategy-box';
  if(id.startsWith('strategy-'))return id;
  return id.replace(/-\d+$/,'');
}

export function messageCategory(id:string):EngineerCategory {
  if(['red-flag','safety-car'].includes(id))return 'SAFETY';
  if(id.startsWith('strategy-')||id==='pit-window'||id==='ahead-pitting')return 'STRATEGY';
  if(id.startsWith('prediction-')||id.startsWith('drs-')||id.includes('defend')||id.includes('ahead'))return 'BATTLE';
  if(id.startsWith('mode-')||id.startsWith('pace-outlook-'))return 'PACE';
  if(id.includes('damage')||id.includes('tyre')||id.includes('fuel')||id.includes('ers'))return 'CAR';
  return 'STATUS';
}

export function scoreMessage(message:EngineerMessage,state:RaceState,novel=true,now=Date.now()){
  const category=message.category??messageCategory(message.id),ttl=Math.max(0,message.expiresAt-now);
  let score=baseScore[message.priority]+(message.confidence-50)*.22;
  if(ttl<=5000)score+=6;else if(ttl<=10000)score+=3;
  if(category==='SAFETY')score+=10;
  if(category==='STRATEGY'&&state.context.category==='RACE')score+=7;
  if(category==='BATTLE'&&state.strategy.status==='READY')score+=6;
  if(!novel)score-=18;
  if(state.packetCount>0&&state.telemetry.score<60&&!['SAFETY','CAR'].includes(category))score-=16;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const enriched:EngineerMessage={...message,score,category,dedupeKey:message.dedupeKey??messageFamily(message.id),validUntilLap:message.validUntilLap??state.lap+1};
  return {message:enriched,eligible:score>=thresholds[message.priority],threshold:thresholds[message.priority],reason:score>=thresholds[message.priority]?'Decision value above threshold':`Decision score ${score} below ${thresholds[message.priority]} threshold`};
}
