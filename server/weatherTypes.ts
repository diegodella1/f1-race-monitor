import type { EngineerMessage, WeatherForecast } from './types.js';

export type TyreFamily='SLICKS'|'INTER'|'WET';
export type WeatherPhase='DRY'|'LIGHT_RAIN'|'HEAVY_RAIN'|'UNKNOWN';
export interface WeatherAssessment {
  epoch:number;
  observed:WeatherPhase;
  confirmed:WeatherPhase;
  fresh:boolean;
  ageMs:number|null;
  forecastAccuracy:'PERFECT'|'APPROXIMATE'|'UNKNOWN';
  forecast:WeatherForecast[];
  action:'MAINTAIN'|'PREPARE'|'BOX'|'INSUFFICIENT_DATA';
  recommendedFamily:TyreFamily|null;
  transition:boolean;
  reason:string;
  confidence:'LOW'|'MEDIUM';
  evidence:{rivals:number;gainSeconds:number|null;netGainSeconds:number|null;horizonLaps:number};
  messages:EngineerMessage[];
}
export interface WeatherMessageContext {
  epoch:number;
  kind:'FORECAST'|'CHANGE'|'BOX';
  family?:TyreFamily;
}
