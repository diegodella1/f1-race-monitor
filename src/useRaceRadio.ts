import { selectEnglishVoice } from './englishVoice';
import { RadioQueue } from './radioQueue';
import { recordDelivery, flushDeliveries } from './radioTransport';
import { useCallback, useEffect, useRef, useState } from 'react';
import { radioEnglishText, radioText, selectRadioMessage } from './radioLogic';
import type { EngineerMessage, RaceState } from './types';

export interface RadioPreferences { volume:number; rate:number; voiceURI:string }
export interface RaceRadioController { armed:boolean;supported:boolean;language:'ES'|'EN';status:'OFF'|'READY'|'QUEUED'|'SPEAKING'|'UNSUPPORTED';lastText:string;voices:SpeechSynthesisVoice[];preferences:RadioPreferences;toggle:()=>void;test:()=>void;repeat:()=>void;update:(patch:Partial<RadioPreferences>)=>void }
type SpokenCopy={es:string;en:string};
const defaults:RadioPreferences={volume:.9,rate:1.08,voiceURI:''};
const loadPreferences=():RadioPreferences=>{try{return {...defaults,...JSON.parse(localStorage.getItem('f1-radio-preferences')||'{}')}}catch{return defaults}};

export function useRaceRadio(state:RaceState):RaceRadioController {
  const supported=typeof window!=='undefined'&&'speechSynthesis'in window&&'SpeechSynthesisUtterance'in window;
  const [armed,setArmed]=useState(false),[status,setStatus]=useState<RaceRadioController['status']>(supported?'OFF':'UNSUPPORTED'),[voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[preferences,setPreferences]=useState<RadioPreferences>(loadPreferences),[lastText,setLastText]=useState('');
  const lastTextRef=useRef(''),audio=useRef<AudioContext|null>(null),stateRef=useRef(state);
  stateRef.current=state;

  useEffect(()=>{localStorage.setItem('f1-radio-preferences',JSON.stringify(preferences))},[preferences]);
  useEffect(()=>{if(!supported)return;const load=()=>setVoices(window.speechSynthesis.getVoices());load();window.speechSynthesis.addEventListener('voiceschanged',load);return()=>window.speechSynthesis.removeEventListener('voiceschanged',load)},[supported]);

  const voiceChoice=useCallback(()=>({voice:selectEnglishVoice(window.speechSynthesis.getVoices(),preferences.voiceURI),language:'EN' as const}),[preferences.voiceURI]);
  const language='EN' as const;
  const beep=useCallback(()=>{try{const Context=(window.AudioContext||(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext);if(!Context)return;if(!audio.current)audio.current=new Context();const ctx=audio.current,osc=ctx.createOscillator(),gain=ctx.createGain();void ctx.resume();osc.frequency.value=720;gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.09);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.1)}catch{/* Voice still works if the tone is unavailable. */}},[]);
  const speak=useCallback((copy:SpokenCopy,interrupt=false,force=false)=>{if(!supported||(!armed&&!force))return;const synth=window.speechSynthesis;if(interrupt)synth.cancel();beep();const choice=voiceChoice(),text=copy.en,utterance=new SpeechSynthesisUtterance(text);utterance.lang=choice.voice?.lang||('en-US');if(choice.voice)utterance.voice=choice.voice;utterance.volume=preferences.volume;utterance.rate=preferences.rate;utterance.pitch=1;utterance.onstart=()=>setStatus('SPEAKING');utterance.onend=()=>setStatus(armed||force?'READY':'OFF');utterance.onerror=()=>setStatus(armed||force?'READY':'OFF');lastTextRef.current=text;setLastText(text);synth.speak(utterance)},[armed,beep,preferences.rate,preferences.volume,supported,voiceChoice]);

  const queue=useRef<RadioQueue|null>(null);
  const device=useRef('');
  if(!device.current){try{device.current=localStorage.getItem('f1-radio-device')||crypto.randomUUID();localStorage.setItem('f1-radio-device',device.current);}catch{device.current=crypto.randomUUID();}}
  const outputRef=useRef({armed,preferences,voiceChoice,beep});outputRef.current={armed,preferences,voiceChoice,beep};
  useEffect(()=>{
    if(!supported)return;
    const current=new RadioQueue({
      speak:(text,callbacks)=>{
        const options=outputRef.current,choice=options.voiceChoice(),utterance=new SpeechSynthesisUtterance(text);
        utterance.lang=choice.voice?.lang||('en-US');
        if(choice.voice)utterance.voice=choice.voice;
        utterance.volume=options.preferences.volume;utterance.rate=options.preferences.rate;
        utterance.onstart=callbacks.start;utterance.onend=callbacks.end;utterance.onerror=e=>callbacks.error(e.error);
        lastTextRef.current=text;setLastText(text);options.beep();window.speechSynthesis.speak(utterance);
      },
      cancel:()=>window.speechSynthesis.cancel(),
      log:(call,status,reason)=>{
        const voice=status==='SUBMITTED'?outputRef.current.voiceChoice().voice:null;
        const location=voice?.localService===true?'local':voice?.localService===false?'remote':'system';
        const detail=status==='SUBMITTED'?`${reason} · ${voice?.name??'English default'} · ${location}`:reason;
        recordDelivery({eventId:crypto.randomUUID(),deviceId:device.current,sessionUid:call.state.sessionUid,sessionLinkId:call.state.sessionLinkId,sessionType:call.state.sessionType,messageId:call.key,status,text:call.text,reason:detail.slice(0,200),category:call.message.category??'STATUS',lap:call.state.lap,clientAt:Date.now()});
      },
    });
    queue.current=current;
    const poll=window.setInterval(()=>{
      if(!outputRef.current.armed)return;
      const latest=stateRef.current,message=selectRadioMessage(latest),choice=outputRef.current.voiceChoice();
      current.update(message,latest,message?radioEnglishText(message,latest):'',Date.now());
      setStatus(current.status);
    },100);
    const flush=window.setInterval(()=>void flushDeliveries(),2000);
    const onHide=()=>void flushDeliveries();window.addEventListener('pagehide',onHide);
    return()=>{window.clearInterval(poll);window.clearInterval(flush);window.removeEventListener('pagehide',onHide);current.clear('Radio unmounted');queue.current=null;void flushDeliveries();};
  },[supported]);

  const toggle=useCallback(()=>{if(!supported)return;if(armed){queue.current?.clear();window.speechSynthesis.cancel();setArmed(false);setStatus('OFF');return;}setArmed(true);setStatus('READY');},[armed,supported]);
  const test=useCallback(()=>{queue.current?.clear('Manual voice test');speak({es:'Radio lista. Audio y prioridades funcionando.',en:'Race radio ready. Audio and priorities are working.'},false,true)},[speak]);
  const repeat=useCallback(()=>{if(lastTextRef.current){queue.current?.clear('Manual repeat');speak({es:lastTextRef.current,en:lastTextRef.current},false,true)}},[speak]);
  const update=useCallback((patch:Partial<RadioPreferences>)=>setPreferences(old=>({...old,...patch})),[]);
  return {armed,supported,language,status,lastText,voices,preferences,toggle,test,repeat,update};
}
