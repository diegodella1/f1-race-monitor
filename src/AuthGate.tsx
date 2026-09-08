import { useEffect, useState, type ReactNode } from 'react';
export function AuthGate({children}:{children:ReactNode}){
  const [ready,setReady]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [name,setName]=useState('Android tablet');
  const [token]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('pair')??'');
  useEffect(()=>{
    if(token)history.replaceState(null,'',location.pathname);
    const abort=new AbortController();
    if(token)setLoading(false);
    else fetch('/api/auth/me',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])}).then(r=>{if(abort.signal.aborted)return;setReady(r.ok);if(!r.ok&&r.status!==401)setError('Open the configured HTTPS dashboard.');}).catch(()=>{if(!abort.signal.aborted)setError('Server unavailable. Check your connection.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    const expired=()=>setReady(false);window.addEventListener('pairing-required',expired);
    return()=>{abort.abort();window.removeEventListener('pairing-required',expired);};
  },[token]);
  async function pair(){
    setLoading(true);setError('');
    try{const r=await fetch('/api/auth/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,name}),signal:AbortSignal.timeout(10000)});const body=await r.json();if(!r.ok)throw Error(body.error);setReady(true);}
    catch(error){setError(String(error));}finally{setLoading(false);}
  }
  if(ready)return children;
  return <main className="pairing-screen panel"><h1>Private race pitwall</h1><p>Use a one-time pairing link from an authorized device or the server.</p>{token&&<><label>Device name<input maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={loading||!name.trim()} onClick={()=>void pair()}>Pair this device</button></>}{loading&&<p>Connecting…</p>}{error&&<p role="alert">{error}</p>}</main>;
}
