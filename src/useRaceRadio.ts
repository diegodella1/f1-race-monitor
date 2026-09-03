import { useCallback, useEffect, useRef, useState } from 'react';
import { radioEnglishText, radioText, selectRadioMessage } from './radioLogic';
import type { EngineerMessage, RaceState } from './types';

export interface RadioPreferences { volume:number; rate:number; voiceURI:string }
export interface RaceRadioController { armed:boolean;supported:boolean;language:'ES'|'EN';status:'OFF'|'READY'|'QUEUED'|'SPEAKING'|'UNSUPPORTED';lastText:string;voices:SpeechSynthesisVoice[];preferences:RadioPreferences;toggle:()=>void;test:()=>void;repeat:()=>void;update:(patch:Partial<RadioPreferences>)=>void }
type SpokenCopy={es:string;en:string};
const defaults:RadioPreferences={volume:.9,rate:1.08,voiceURI:''};
const loadPreferences=():RadioPreferences=>{try{return {...defaults,...JSON.parse(localStorage.getItem('f1-radio-preferences')||'{}')}}catch{return defaults}};
const priorityRank:Record<EngineerMessage['priority'],number>={critical:4,action:3,opportunity:2,info:1};

export function useRaceRadio(state:RaceState):RaceRadioController {
  const supported=typeof window!=='undefined'&&'speechSynthesis'in window&&'SpeechSynthesisUtterance'in window;
  const [armed,setArmed]=useState(false),[status,setStatus]=useState<RaceRadioController['status']>(supported?'OFF':'UNSUPPORTED'),[voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[preferences,setPreferences]=useState<RadioPreferences>(loadPreferences),[lastText,setLastText]=useState('');
  const timer=useRef<number|null>(null),lastSpokenAt=useRef(0),lastTextRef=useRef(''),pending=useRef<{signature:string;priority:EngineerMessage['priority']}|null>(null),audio=useRef<AudioContext|null>(null),spoken=useRef(new Map<string,number>()),stateRef=useRef(state);
  stateRef.current=state;

  useEffect(()=>{localStorage.setItem('f1-radio-preferences',JSON.stringify(preferences))},[preferences]);
  useEffect(()=>{if(!supported)return;const load=()=>setVoices(window.speechSynthesis.getVoices());load();window.speechSynthesis.addEventListener('voiceschanged',load);return()=>window.speechSynthesis.removeEventListener('voiceschanged',load)},[supported]);

  const voiceChoice=useCallback(()=>{const available=window.speechSynthesis.getVoices(),preferred=available.find(v=>v.voiceURI===preferences.voiceURI&&v.lang.toLowerCase().startsWith('es')),spanish=preferred||available.find(v=>v.lang.toLowerCase()==='es-ar')||available.find(v=>v.lang.toLowerCase().startsWith('es')),english=available.find(v=>v.lang.toLowerCase()==='en-us')||available.find(v=>v.lang.toLowerCase().startsWith('en'))||available[0]||null;return spanish?{voice:spanish,language:'ES' as const}:{voice:english,language:'EN' as const}},[preferences.voiceURI]);
  const language=voices.some(v=>v.lang.toLowerCase().startsWith('es'))?'ES':'EN';
  const beep=useCallback(()=>{try{const Context=(window.AudioContext||(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext);if(!Context)return;if(!audio.current)audio.current=new Context();const ctx=audio.current,osc=ctx.createOscillator(),gain=ctx.createGain();void ctx.resume();osc.frequency.value=720;gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.09);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.1)}catch{/* Voice still works if the tone is unavailable. */}},[]);
  const speak=useCallback((copy:SpokenCopy,interrupt=false,force=false)=>{if(!supported||(!armed&&!force))return;const synth=window.speechSynthesis;if(interrupt)synth.cancel();beep();const choice=voiceChoice(),text=choice.language==='ES'?copy.es:copy.en,utterance=new SpeechSynthesisUtterance(text);utterance.lang=choice.voice?.lang||(choice.language==='ES'?'es-AR':'en-US');if(choice.voice)utterance.voice=choice.voice;utterance.volume=preferences.volume;utterance.rate=preferences.rate;utterance.pitch=1;utterance.onstart=()=>setStatus('SPEAKING');utterance.onend=()=>setStatus(armed||force?'READY':'OFF');utterance.onerror=()=>setStatus(armed||force?'READY':'OFF');lastTextRef.current=text;setLastText(text);lastSpokenAt.current=Date.now();synth.speak(utterance)},[armed,beep,preferences.rate,preferences.volume,supported,voiceChoice]);

  const clearPending=useCallback(()=>{if(timer.current!==null)window.clearTimeout(timer.current);timer.current=null;pending.current=null},[]);
  useEffect(()=>()=>{clearPending();if(supported)window.speechSynthesis.cancel()},[clearPending,supported]);

  const message=selectRadioMessage(state),signature=message?`${message.id}:${message.createdAt}`:'';
  useEffect(()=>{
    if(!supported||!armed||!['CONNECTED','DEMO'].includes(state.status)){clearPending();if(supported)window.speechSynthesis.cancel();if(armed)setStatus('READY');return;}
    if(!message||message.expiresAt<Date.now()||spoken.current.has(signature)){if(!message)clearPending();return;}
    if(pending.current&&priorityRank[pending.current.priority]>priorityRank[message.priority])return;
    clearPending();
    const critical=message.priority==='critical',cooldown=message.priority==='action'?6000:message.priority==='opportunity'?10000:14000,delay=critical?0:Math.max(0,cooldown-(Date.now()-lastSpokenAt.current));
    pending.current={signature,priority:message.priority};setStatus(delay?'QUEUED':'READY');
    const deliver=(attempt=0)=>{
      const latest=selectRadioMessage(stateRef.current),latestSignature=latest?`${latest.id}:${latest.createdAt}`:'';
      if(!latest||latestSignature!==signature||latest.expiresAt<Date.now()){pending.current=null;setStatus('READY');return;}
      if(latest.priority==='info'&&(stateRef.current.player.brake>12||Math.abs(stateRef.current.player.steer)>.18)){if(attempt<8){timer.current=window.setTimeout(()=>deliver(attempt+1),1000);return;}pending.current=null;setStatus('READY');return;}
      spoken.current.set(signature,Date.now());for(const [key,time] of spoken.current)if(Date.now()-time>180000)spoken.current.delete(key);
      pending.current=null;speak({es:radioText(latest,stateRef.current),en:radioEnglishText(latest)},critical);
    };
    timer.current=window.setTimeout(()=>deliver(),delay);
  },[armed,clearPending,signature,speak,state.status,supported]);

  const toggle=useCallback(()=>{if(!supported)return;if(armed){clearPending();window.speechSynthesis.cancel();setArmed(false);setStatus('OFF');return;}setArmed(true);setStatus('READY');const current=selectRadioMessage(stateRef.current);if(current)spoken.current.set(`${current.id}:${current.createdAt}`,Date.now());speak({es:'Radio activada.',en:'Race radio enabled.'},false,true)},[armed,clearPending,speak,supported]);
  const test=useCallback(()=>speak({es:'Radio lista. Audio y prioridades funcionando.',en:'Race radio ready. Audio and priorities are working.'},false,true),[speak]);
  const repeat=useCallback(()=>{if(lastTextRef.current)speak({es:lastTextRef.current,en:lastTextRef.current},false,true)},[speak]);
  const update=useCallback((patch:Partial<RadioPreferences>)=>setPreferences(old=>({...old,...patch})),[]);
  return {armed,supported,language,status,lastText,voices,preferences,toggle,test,repeat,update};
}
