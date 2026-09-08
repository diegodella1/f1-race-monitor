import { useEffect,useState } from 'react';
export function Operations(){
  const [error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();let busy=false;
    const load=async()=>{if(busy)return;busy=true;try{const r=await fetch('/api/operations',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});if(r.status===401){window.dispatchEvent(new Event('pairing-required'));return;}if(!r.ok)throw Error('Server health unavailable');const data=await r.json();setError([data.sourceError,data.diagnosticError,data.persistence.error].filter(Boolean).join(' · '));}catch(e){if(!abort.signal.aborted)setError(String(e));}finally{busy=false;}};
    void load();const timer=setInterval(()=>void load(),5000);return()=>{clearInterval(timer);abort.abort();};
  },[]);
  return error?<p className="operational-error" role="alert">Attention: {error}</p>:null;
}
