import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { WeatherStrategy } from './weather.js';
import { PitwallStrategy } from './strategy.js';
import type { RaceState } from './types.js';

function frame(now:number,weather='Clear'){
  const s=initialState();s.status='CONNECTED';s.sessionUid='weather-test';s.sessionLinkId=1;s.sessionType='Race';
  s.context.category='RACE';s.context.lifecycle='ACTIVE';s.context.weatherObservedAt=now;s.context.weatherSessionTime=now/1000;s.context.forecastAccuracy='PERFECT';
  s.weather=weather;s.updatedAt=now;s.sessionTime=now/1000;s.lap=1;s.totalLaps=20;
  s.player.vehicleIndex=0;s.player.position=1;s.player.tyre='MEDIUM';s.player.ers=80;s.player.fuelRemainingLaps=2;
  s.telemetry.packets=[1,2,7].map(id=>({id,label:'TEST',ageMs:0,healthy:true,count:10}));
  return s;
}
const analyze=(model:WeatherStrategy,s:RaceState,now=s.updatedAt)=>model.analyze(s,{...s.strategy.plan,pitLossSeconds:23},now);

test('weather confirms meaningful changes for ten seconds and ignores cloud changes',()=>{
  const m=new WeatherStrategy();analyze(m,frame(0));let result=analyze(m,frame(10000));assert.equal(result.confirmed,'DRY');assert.equal(result.messages.length,0);
  result=analyze(m,frame(11000,'Overcast'));assert.equal(result.messages.length,0);
  result=analyze(m,frame(12000,'Light rain'));assert.notEqual(result.confirmed,'LIGHT_RAIN');
  result=analyze(m,frame(22000,'Light rain'));assert.equal(result.action,'PREPARE');assert.equal(result.recommendedFamily,'INTER');assert.match(result.messages[0].radio!.en,/Rain confirmed/);
  result=analyze(m,frame(23000,'Heavy rain'));result=analyze(m,frame(33000,'Heavy rain'));assert.equal(result.recommendedFamily,'WET');
  result=analyze(m,frame(34000));result=analyze(m,frame(44000));assert.ok(result.messages.some(x=>x.radio!.en.includes('still be wet')));
});

test('forecast announces timing and probability once, updates at five minutes and retracts',()=>{
  const m=new WeatherStrategy();analyze(m,frame(0));analyze(m,frame(10000));
  const s=frame(11000);s.context.forecastAccuracy='APPROXIMATE';s.context.weatherForecast=[{minutes:10,weather:'Light rain',rainPercentage:70,trackTemperature:20,airTemperature:18}];
  let result=analyze(m,s);const first=result.messages.find(x=>x.weather?.kind==='FORECAST')!;
  assert.match(first.radio!.en,/10 minutes, 70 percent/);assert.match(first.radio!.en,/approximate/);assert.equal(result.action,'PREPARE');
  s.updatedAt=12000;s.context.weatherObservedAt=12000;result=analyze(m,s);assert.equal(result.messages.find(x=>x.weather?.kind==='FORECAST')!.eventId,first.eventId);
  s.context.weatherForecast[0].minutes=5;result=analyze(m,s);assert.notEqual(result.messages.find(x=>x.weather?.kind==='FORECAST')!.eventId,first.eventId);
  s.context.weatherForecast[0].rainPercentage=40;result=analyze(m,s);assert.ok(!result.messages.some(x=>x.weather?.kind==='FORECAST'));
});

test('stale session data, pause and flashback cancel actionable weather notices',()=>{
  const m=new WeatherStrategy();analyze(m,frame(0,'Light rain'));let s=frame(10000,'Light rain');const before=analyze(m,s);
  s.context.weatherObservedAt=0;const stale=analyze(m,s);assert.equal(stale.fresh,false);assert.deepEqual(stale.messages,[]);
  s=frame(11000,'Light rain');s.status='PAUSED';assert.deepEqual(analyze(m,s).messages,[]);
  s=frame(12000,'Light rain');assert.notEqual(analyze(m,s).epoch,before.epoch);
  s=frame(5000,'Light rain');assert.notEqual(analyze(m,s).epoch,before.epoch);
});

function wetRace(options:{rivals?:number;totalLaps?:number;invalid?:boolean;gain?:number;reversal?:boolean;initialWeather?:string;nextWeather?:string;currentTyre?:RaceState["drivers"][number]["tyre"];targetTyre?:RaceState["drivers"][number]["tyre"];pitwall?:PitwallStrategy}={}){
  const model=new WeatherStrategy();let result=analyze(model,frame(0));let s=frame(0);
  for(let second=0;second<=Math.min(990,((options.totalLaps??20)-1)*90);second++){
    const lap=Math.floor(second/90)+1,wet=lap>=6;
    s=frame(second*1000,wet?(options.nextWeather??'Light rain'):(options.initialWeather??'Clear'));s.lap=lap;s.totalLaps=options.totalLaps??20;
    s.player.tyre=options.currentTyre??'MEDIUM';
    s.player.lastLap=wet?'1:40.000':'1:30.000';s.player.tyreAge=lap;
    s.drivers=Array.from({length:3},(_,i)=>({vehicleIndex:i,position:i+1,name:'CAR '+i,team:'TEST',lap,sector:1,gap:i?'+'+i:'LEADER',interval:i?'+'+i:'—',
      tyre:i>0&&i<=(options.rivals??2)&&wet?(options.targetTyre??'INTER'):(options.currentTyre??'MEDIUM'),tyreAge:wet?lap-5:lap,pit:false,lapInvalid:i>0&&!!options.invalid,
      lastLap:i===0?s.player.lastLap:wet?`1:${(41-(options.gain??5)).toFixed(3)}`:'1:31.000'}));
    if(options.reversal&&wet)s.context.weatherForecast=[{minutes:1,weather:'Clear',rainPercentage:0,trackTemperature:20,airTemperature:20}];
    result=analyze(model,s);
    if(options.pitwall)s=options.pitwall.analyze(s,s.updatedAt);
  }
  return {result,s,model};
}

test('two comparable rivals confirm a profitable stop for intermediates',()=>{
  const {result}=wetRace();assert.equal(result.action,'BOX',JSON.stringify(result));assert.equal(result.evidence.rivals,2);assert.equal(result.evidence.gainSeconds,5);
  assert.ok(result.evidence.netGainSeconds!>2);assert.match(result.messages.find(m=>m.weather?.kind==='BOX')!.radio!.en,/Box this lap for intermediates/);
});

test('one rival, invalid laps, marginal gain or insufficient remaining time cannot trigger boxes',()=>{
  for(const options of [{rivals:1},{invalid:true},{gain:.5},{totalLaps:10},{reversal:true}])assert.notEqual(wetRace(options).result.action,'BOX',JSON.stringify(options));
});

test('fitting the recommended family and finishing both cancel the box notice',()=>{
  const {s,model}=wetRace();s.player.tyre='INTER';let result=analyze(model,s);assert.equal(result.action,'MAINTAIN');assert.ok(!result.messages.some(m=>m.weather?.kind==='BOX'));
  s.context.lifecycle='FINISHED';result=analyze(model,s);assert.deepEqual(result.messages,[]);
});

test('pace evidence supports heavier rain, easing rain and drying track transitions',()=>{
  for(const options of [
    {initialWeather:'Light rain',nextWeather:'Heavy rain',currentTyre:'INTER',targetTyre:'WET'},
    {initialWeather:'Heavy rain',nextWeather:'Light rain',currentTyre:'WET',targetTyre:'INTER'},
    {initialWeather:'Light rain',nextWeather:'Clear',currentTyre:'INTER',targetTyre:'MEDIUM'},
    {initialWeather:'Heavy rain',nextWeather:'Clear',currentTyre:'WET',targetTyre:'MEDIUM'},
  ] as const){
    const {result}=wetRace(options);
    assert.equal(result.action,'BOX',JSON.stringify({options,result}));
    assert.equal(result.recommendedFamily,options.targetTyre==='MEDIUM'?'SLICKS':options.targetTyre);
  }
});

test('neutralization cancels a previously justified weather stop',()=>{
  const {s,model,result}=wetRace();assert.equal(result.action,'BOX');
  s.safetyCar='FULL';
  const neutralized=analyze(model,s);assert.notEqual(neutralized.action,'BOX');
  assert.ok(!neutralized.messages.some(message=>message.weather?.kind==='BOX'));
});

test('pitwall gives a confirmed weather stop priority and clears obsolete pace targets',()=>{
  const {s}=wetRace({pitwall:new PitwallStrategy()});
  assert.equal(s.strategy.weather?.action,'BOX');
  assert.equal(s.strategy.recommendation?.weather?.kind,'BOX');
  assert.equal(s.strategy.raceMode,'BOX');
  assert.equal(s.strategy.targetLapTime,'—');
});

test('rain alone never marks the mandatory dry-compound change as complete',()=>{
  const m=new PitwallStrategy();const s=frame(10000,'Light rain');
  assert.equal(m.analyze(s,10000).strategy.rules.mandatoryStopRequired,true);
  s.player.tyre='INTER';assert.equal(m.analyze(s,11000).strategy.rules.mandatoryStopRequired,false);
});
