import { selectEnglishVoice } from './englishVoice';
import { RadioQueue } from './radioQueue';
import { recordDelivery, flushDeliveries } from './radioTransport';
import { useCallback, useEffect, useRef, useState } from 'react';
import { radioEnglishText, selectRadioMessage } from './radioLogic';
import type { RaceState } from './types';

export interface RadioPreferences { volume:number; rate:number; voiceURI:string }
export interface RaceRadioController { armed:boolean;supported:boolean;language:'ES'|'EN';status:'OFF'|'READY'|'QUEUED'|'SPEAKING'|'UNSUPPORTED'|'ATTENTION'|'NO_LOCAL_VOICE'|'IN_USE';lastText:string;voices:SpeechSynthesisVoice[];preferences:RadioPreferences;toggle:()=>void;test:()=>void;repeat:()=>void;update:(patch:Partial<RadioPreferences>)=>void }
const defaults:RadioPreferences={volume:.9,rate:1.08,voiceURI:''};
const loadPreferences=():RadioPreferences=>{try{const value=JSON.parse(localStorage.getItem('f1-radio-preferences')||'{}');return {volume:typeof value.volume==='number'&&Number.isFinite(value.volume)?Math.max(0,Math.min(1,value.volume)):defaults.volume,rate:typeof value.rate==='number'&&Number.isFinite(value.rate)?Math.max(.75,Math.min(1.35,value.rate)):defaults.rate,voiceURI:typeof value.voiceURI==='string'?value.voiceURI:''};}catch{return defaults}};

export function useRaceRadio(state:RaceState):RaceRadioController {
  const supported=typeof window!=='undefined'&&'speechSynthesis'in window&&'SpeechSynthesisUtterance'in window;
  const [armed,setArmed]=useState(false),[status,setStatus]=useState<RaceRadioController['status']>(supported?'OFF':'UNSUPPORTED'),[voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[preferences,setPreferences]=useState<RadioPreferences>(loadPreferences),[lastText,setLastText]=useState('');
  const stateRef=useRef(state);
  stateRef.current=state;

  useEffect(()=>{try{localStorage.setItem('f1-radio-preferences',JSON.stringify(preferences));}catch{}},[preferences]);
  useEffect(()=>{if(!supported)return;const load=()=>setVoices(window.speechSynthesis.getVoices());load();window.speechSynthesis.addEventListener('voiceschanged',load);return()=>window.speechSynthesis.removeEventListener('voiceschanged',load)},[supported]);

  const voiceChoice=useCallback(()=>({voice:selectEnglishVoice(window.speechSynthesis.getVoices(),preferences.voiceURI),language:'EN' as const}),[preferences.voiceURI]);
  const language='EN' as const;

  const queue=useRef<RadioQueue|null>(null);
  const releaseLock=useRef<(()=>void)|null>(null),lockPending=useRef(false);
  const device=useRef('');
  if(!device.current){try{device.current=localStorage.getItem('f1-radio-device')||crypto.randomUUID();localStorage.setItem('f1-radio-device',device.current);}catch{device.current=crypto.randomUUID();}}
  const outputRef=useRef({armed,preferences,voiceChoice});outputRef.current={armed,preferences,voiceChoice};
  useEffect(()=>{
    if(!supported)return;
    const current=new RadioQueue({
      speak:(text,callbacks)=>{
        const options=outputRef.current,choice=options.voiceChoice(),utterance=new SpeechSynthesisUtterance(text);
        if(!choice.voice){callbacks.error('No local English voice installed');return;}
        utterance.lang=choice.voice?.lang||('en-US');
        if(choice.voice)utterance.voice=choice.voice;
        utterance.volume=options.preferences.volume;utterance.rate=options.preferences.rate;
        utterance.onstart=callbacks.start;utterance.onend=callbacks.end;utterance.onerror=e=>callbacks.error(e.error);
        setLastText(text);window.speechSynthesis.speak(utterance);
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
      const latest=stateRef.current,message=selectRadioMessage(latest);
      current.update(message,latest,message?radioEnglishText(message,latest):'',Date.now()+(latest.transport?.clockOffsetMs??0));
      setStatus(current.status);
    },100);
    const flush=window.setInterval(()=>{if(outputRef.current.armed)void flushDeliveries();},2000);
    const onHide=()=>{if(outputRef.current.armed)void flushDeliveries();};window.addEventListener('pagehide',onHide);
    return()=>{window.clearInterval(poll);window.clearInterval(flush);window.removeEventListener('pagehide',onHide);current.clear('Radio unmounted');releaseLock.current?.();releaseLock.current=null;queue.current=null;void flushDeliveries();};
  },[supported]);

  const start=useCallback((testVoice=false)=>{
    if(!supported)return;
    if(!voiceChoice().voice){setStatus('NO_LOCAL_VOICE');return;}
    const activate=()=>{const now=Date.now()+(stateRef.current.transport?.clockOffsetMs??0);queue.current?.activate(stateRef.current,now);setArmed(true);setStatus('READY');if(testVoice)queue.current?.test(stateRef.current,now);};
    if(releaseLock.current){activate();return;}
    if(lockPending.current)return;
    if(!navigator.locks){setStatus('ATTENTION');return;}
    lockPending.current=true;
    void navigator.locks.request('f1-race-radio',{ifAvailable:true},async lock=>{
      lockPending.current=false;if(!queue.current)return;if(!lock){setStatus('IN_USE');return;}
      await new Promise<void>(resolve=>{releaseLock.current=resolve;activate();});
      releaseLock.current=null;
    }).catch(()=>{lockPending.current=false;setStatus('ATTENTION');});
  },[supported,voiceChoice]);
  const toggle=useCallback(()=>{if(armed){queue.current?.clear();releaseLock.current?.();releaseLock.current=null;setArmed(false);setStatus('OFF');}else start();},[armed,start]);
  const test=useCallback(()=>start(true),[start]);
  const repeat=useCallback(()=>{if(!armed||!queue.current?.repeat(stateRef.current,Date.now()+(stateRef.current.transport?.clockOffsetMs??0)))setStatus('ATTENTION');},[armed]);
  const update=useCallback((patch:Partial<RadioPreferences>)=>setPreferences(old=>({...old,...patch,volume:Math.max(0,Math.min(1,patch.volume??old.volume)),rate:Math.max(.75,Math.min(1.35,patch.rate??old.rate))})),[]);
  return {armed,supported,language,status,lastText,voices,preferences,toggle,test,repeat,update};
}
