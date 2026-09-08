import { SessionActions } from './SessionActions';
import { useEffect, useState } from 'react';

type Session={id:number;track:string;mode:string;laps:number};
type Event={id:number;deviceId:string;messageId:string;status:string;text:string;reason:string;category:string;lap:number;clientAt:number};
type Decision={source:string;eventId:string;status:string;reason:string;category?:string;lap:number;title?:string;recordedAt:number};
type Result={events:Event[];total:number;devices:{deviceId:string}[];report:{latencies?:{deviceId:string;queueMs:number|null;speechStartupMs:number|null;totalMs:number|null}[];counts:{deviceId:string;status:string;reason:string;count:number}[];silences:{deviceId:string;durationMs:number;fromAt:number;toAt:number}[]}};
const empty:Result={events:[],total:0,devices:[],report:{latencies:[],counts:[],silences:[]}};
const labels:Record<string,string>={DEFERRED:'Deferred',SUBMITTED:'Submitted',SELECTED:'Selected',QUEUED:'Queued',STARTED:'Started',COMPLETED:'Completed',CANCELLED:'Cancelled',EXPIRED:'Expired',ERROR:'Error',EMITTED:'Selected by server',SUPPRESSED:'Suppressed by server',RESOLVED:'Resolved'};

export function RadioHistory(){
  const [sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState('');
  const [device,setDevice]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[lap,setLap]=useState(''),[offset,setOffset]=useState(0);
  const [decisionOffset,setDecisionOffset]=useState(0);
  const [result,setResult]=useState(empty),[decisions,setDecisions]=useState<Decision[]>([]),[error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    fetch('/api/sessions',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])}).then(r=>{if(!r.ok)throw Error('Could not load sessions.');return r.json();}).then((rows:Session[])=>{setSessions(rows);setSession(value=>value||String(rows[0]?.id||''));}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>abort.abort();
  },[]);
  useEffect(()=>{
    if(!session)return;
    const abort=new AbortController();
    let busy=false;
    const load=async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;
      const query=new URLSearchParams({device,status,category,lap:lap||'-1',offset:String(offset),limit:'50'});
      try{
        const responses=await Promise.all([fetch(`/api/sessions/${session}/radio?${query}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])}),fetch(`/api/sessions/${session}/decisions?limit=200&offset=${decisionOffset}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])})]);
        if(responses.some(r=>!r.ok))throw Error('Could not update history.');
        const [radio,server]=await Promise.all(responses.map(r=>r.json()));setResult(radio);setDecisions(server);setError('');
      }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load history.');}finally{busy=false;}
    };
    void load();const timer=window.setInterval(()=>void load(),5000);
    return()=>{abort.abort();window.clearInterval(timer);};
  },[session,device,status,category,lap,offset,decisionOffset]);
  const filter=(setter:(value:string)=>void)=>(value:string)=>{setter(value);setOffset(0);};
  const server=decisions.filter(d=>d.source==='engineer'&&(!lap||d.lap===Number(lap))&&(!category||d.category===category));
  const latencies=(result.report.latencies??[]).filter(row=>!device||row.deviceId===device);
  const median=(key:'queueMs'|'speechStartupMs'|'totalMs')=>{const values=latencies.map(row=>row[key]).filter((value):value is number=>value!==null).sort((a,b)=>a-b);const middle=Math.floor(values.length/2);return values.length?((values.length%2?values[middle]:(values[middle-1]+values[middle])/2)/1000).toFixed(1)+' s':'—';};
  const started=result.report.counts.filter(x=>x.status==='STARTED'&&(!device||x.deviceId===device)).reduce((sum,x)=>sum+x.count,0);
  const completed=result.report.counts.filter(x=>x.status==='COMPLETED'&&(!device||x.deviceId===device)).reduce((sum,x)=>sum+x.count,0);
  return <section className="panel radio-history" aria-label="Radio history">
    <h2>Radio history</h2><SessionActions id={session} onDeleted={()=>{setSessions(rows=>rows.filter(row=>String(row.id)!==session));setSession('');setResult(empty);setDecisions([]);}}/>
    <p>Started and completed are browser callbacks; they do not confirm audible sound.</p>
    <div className="radio-history-filters">
      <label>Session<select value={session} onChange={e=>{filter(setSession)(e.target.value);setDevice('');setDecisionOffset(0);}}>{sessions.map(s=><option key={s.id} value={s.id}>{s.track} · {s.mode} · {s.laps} laps</option>)}</select></label>
      <label>Device<select value={device} onChange={e=>filter(setDevice)(e.target.value)}><option value="">All</option>{result.devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.deviceId.slice(0,8)}</option>)}</select></label>
      <label>Status<select value={status} onChange={e=>filter(setStatus)(e.target.value)}><option value="">All</option>{['SELECTED','QUEUED','DEFERRED','SUBMITTED','STARTED','COMPLETED','CANCELLED','EXPIRED','ERROR'].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
      <label>Category<select value={category} onChange={e=>filter(setCategory)(e.target.value)}><option value="">All</option>{['SAFETY','STRATEGY','BATTLE','PACE','CAR','STATUS'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Lap<input aria-label="Filter lap" type="number" min="0" max="1000" value={lap} onChange={e=>filter(setLap)(e.target.value)}/></label>
    </div>
    {error&&<p role="alert">{error}</p>}
    <p>{started} playbacks started · {completed} completed · {result.total} matching events</p>
    <p>Median delay · queue: {median('queueMs')} · speech startup: {median('speechStartupMs')} · total since selection: {median('totalMs')}</p>
    {!result.events.length?<p>No deliveries recorded. Older sessions may only contain server decisions.</p>:<div className="radio-history-table"><table><thead><tr><th>Lap</th><th>Device</th><th>Status</th><th>Message</th><th>Reason</th></tr></thead><tbody>{result.events.map(e=><tr key={e.id}><td>{e.lap}</td><td>{e.deviceId.slice(0,8)}</td><td>{labels[e.status]||e.status}</td><td>{e.text}</td><td>{e.reason}</td></tr>)}</tbody></table></div>}
    <div className="radio-history-pagination"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous</button><span>{result.total?offset+1:0}–{Math.min(offset+50,result.total)} / {result.total}</span><button disabled={offset+50>=result.total} onClick={()=>setOffset(n=>n+50)}>Next</button></div>
    <details><summary>Server decisions ({server.length} on this page)</summary><button disabled={decisionOffset===0} onClick={()=>setDecisionOffset(n=>Math.max(0,n-200))}>Previous decisions</button><button disabled={decisions.length<200} onClick={()=>setDecisionOffset(n=>n+200)}>Next decisions</button><p>Server selection is independent of device playback.</p>{server.map((d,i)=><p key={`${d.eventId}-${d.status}-${i}`}><b>V{d.lap} · {labels[d.status]||d.status} · {d.title||d.eventId}</b><br/>{d.reason}</p>)}</details>
    <details><summary>Silences and discarded calls</summary>{result.report.silences.filter(x=>!device||x.deviceId===device).map((x,i)=><p key={i}>{x.deviceId.slice(0,8)} · {(x.durationMs/1000).toFixed(0)} seconds between speech starts</p>)}{result.report.counts.filter(x=>['ERROR','CANCELLED','EXPIRED','DEFERRED'].includes(x.status)&&(!device||x.deviceId===device)).map((x,i)=><p key={i}>{labels[x.status]} · {x.reason}: {x.count}</p>)}</details>
  </section>;
}
