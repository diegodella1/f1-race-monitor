import { useEffect,useState } from 'react';
import type { RaceState } from './types';
import type { RaceRadioController } from './useRaceRadio';
import { WeatherPanel } from './WeatherPanel';
export function DrivingMode({state,radio}:{state:RaceState;radio:RaceRadioController}){
  const [wake,setWake]=useState('Requesting screen lock…');
  useEffect(()=>{
    let stopped=false,lock:WakeLockSentinel|undefined;
    const acquire=async()=>{
      if(document.visibilityState!=='visible'||lock&&!lock.released)return;
      try{if(!navigator.wakeLock)throw Error('Screen lock unavailable');const next=await navigator.wakeLock.request('screen');if(stopped){void next.release();return;}lock=next;setWake('Screen stays on');next.addEventListener('release',()=>setWake('Screen lock released — keep the app visible'));}
      catch{setWake('Screen lock unavailable — extend Android screen timeout');}
    };
    void acquire();document.addEventListener('visibilitychange',acquire);
    return()=>{stopped=true;void lock?.release();document.removeEventListener('visibilitychange',acquire);};
  },[]);
  const critical=state.engineer.primary?.priority==='critical'?state.engineer.primary:null;
  const action=critical??state.engineer.control?.find(m=>m.control?.kind==='PENALTY')??state.engineer.weather?.find(m=>m.weather?.kind==='BOX')??state.engineer.primary;
  const stale=state.transport?.stale||state.transport?.connected===false||!['CONNECTED','DEMO'].includes(state.status);
  return <div className="driving-grid"><article className="panel driving-action" aria-live="polite"><small>{stale?'LIVE DATA UNAVAILABLE':state.strategy.raceMode}</small><h2>{stale?'Waiting for current telemetry':action?.title??'Maintain your pace'}</h2><p>{stale?'Radio instructions are suspended.':action?.action??state.strategy.modeReason}</p><p>P{state.player.position} · LAP {state.lap}/{state.totalLaps}</p></article><article className="panel"><h2>Rivals</h2><p>Ahead: {state.strategy.ahead?.name??'—'} · {state.strategy.ahead?.gap??'—'}s</p><p>Behind: {state.strategy.behind?.name??'—'} · {state.strategy.behind?.gap??'—'}s</p><p>Penalties: {state.context.penalties}s · Warnings: {state.context.warnings}</p></article><WeatherPanel state={state}/><article className="panel"><h2>Race radio</h2><p role="status">{radio.status.replaceAll('_',' ')}</p><p>{radio.lastText||'Test audio before driving.'}</p><button onClick={radio.test}>Test local voice</button><p>{wake}</p></article></div>;
}
