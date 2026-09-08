import { familyLabel } from '../server/weather';
import type { RaceState } from './types';

const actions={MAINTAIN:'STAY OUT',PREPARE:'PREPARE TYRE CHANGE',BOX:'BOX THIS LAP',INSUFFICIENT_DATA:'ASSESSING CONDITIONS'};
export function WeatherPanel({state}:{state:RaceState}){
  const weather=state.strategy.weather;
  return <article className={`panel weather-panel ${weather?.action==='BOX'?'box':''}`} aria-label="Weather strategy">
    <div className="section-title"><span>// WEATHER</span><small>{weather?.fresh?'LIVE':'AWAITING UPDATE'}</small></div>
    <div className="weather-now"><strong>{state.weather==='—'?'Conditions unavailable':state.weather}</strong><span>{state.context.trackTemp||'—'}°C TRACK</span></div>
    <div className="weather-decision" role="status" aria-live="polite">
      <b>{weather?.fresh?actions[weather.action]:'WEATHER DATA UNAVAILABLE'}</b>
      {weather?.fresh&&weather.recommendedFamily&&<span>{familyLabel(weather.recommendedFamily).toUpperCase()} · {weather.confidence} CONFIDENCE</span>}
      <p>{weather?.reason??'Waiting for current weather telemetry.'}</p>
    </div>
    {weather?.fresh&&weather.forecast.length>0?<><div className="weather-forecast">{weather.forecast.slice(0,3).map((sample,index)=><div key={`${sample.minutes}-${index}`}><b>~{Math.ceil(sample.minutes)} MIN</b><span>{sample.weather}</span><small>{sample.rainPercentage}% RAIN CHANCE</small></div>)}</div><small className="weather-accuracy">FORECAST {weather.forecastAccuracy==='PERFECT'?'GAME SET TO PERFECT':weather.forecastAccuracy==='APPROXIMATE'?'APPROXIMATE':'ACCURACY UNKNOWN'}</small></>:<p className="weather-empty">No current forecast available.</p>}
  </article>;
}
