import { useEffect, useState } from 'react';

type Session={id:number;track:string;mode:string;laps:number};
type Event={id:number;deviceId:string;messageId:string;status:string;text:string;reason:string;category:string;lap:number;clientAt:number};
type Decision={source:string;eventId:string;status:string;reason:string;category?:string;lap:number;title?:string;recordedAt:number};
type Result={events:Event[];total:number;devices:{deviceId:string}[];report:{latencies?:{deviceId:string;queueMs:number|null;speechStartupMs:number|null;totalMs:number|null}[];counts:{deviceId:string;status:string;reason:string;count:number}[];silences:{deviceId:string;durationMs:number;fromAt:number;toAt:number}[]}};
const empty:Result={events:[],total:0,devices:[],report:{latencies:[],counts:[],silences:[]}};
const labels:Record<string,string>={DEFERRED:'En espera',SUBMITTED:'Enviado al sintetizador',SELECTED:'Seleccionado',QUEUED:'En cola',STARTED:'Iniciado',COMPLETED:'Completado',CANCELLED:'Cancelado',EXPIRED:'Vencido',ERROR:'Error',EMITTED:'Seleccionado por servidor',SUPPRESSED:'Descartado por servidor',RESOLVED:'Resuelto'};

export function RadioHistory(){
  const [sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState('');
  const [device,setDevice]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[lap,setLap]=useState(''),[offset,setOffset]=useState(0);
  const [result,setResult]=useState(empty),[decisions,setDecisions]=useState<Decision[]>([]),[error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    fetch('/api/sessions',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('No se pudieron cargar las sesiones.');return r.json();}).then((rows:Session[])=>{setSessions(rows);setSession(value=>value||String(rows[0]?.id||''));}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>abort.abort();
  },[]);
  useEffect(()=>{
    if(!session)return;
    const abort=new AbortController();
    const load=async()=>{
      const query=new URLSearchParams({device,status,category,lap:lap||'-1',offset:String(offset),limit:'50'});
      try{
        const responses=await Promise.all([fetch(`/api/sessions/${session}/radio?${query}`,{signal:abort.signal}),fetch(`/api/sessions/${session}/decisions`,{signal:abort.signal})]);
        if(responses.some(r=>!r.ok))throw Error('No se pudo actualizar el historial.');
        const [radio,server]=await Promise.all(responses.map(r=>r.json()));setResult(radio);setDecisions(server);setError('');
      }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Error al cargar historial.');}
    };
    void load();const timer=window.setInterval(()=>void load(),5000);
    return()=>{abort.abort();window.clearInterval(timer);};
  },[session,device,status,category,lap,offset]);
  const filter=(setter:(value:string)=>void)=>(value:string)=>{setter(value);setOffset(0);};
  const server=decisions.filter(d=>d.source==='engineer'&&(!lap||d.lap===Number(lap))&&(!category||d.category===category));
  const latencies=(result.report.latencies??[]).filter(row=>!device||row.deviceId===device);
  const median=(key:'queueMs'|'speechStartupMs'|'totalMs')=>{const values=latencies.map(row=>row[key]).filter((value):value is number=>value!==null).sort((a,b)=>a-b);const middle=Math.floor(values.length/2);return values.length?((values.length%2?values[middle]:(values[middle-1]+values[middle])/2)/1000).toFixed(1)+' s':'—';};
  const started=result.report.counts.filter(x=>x.status==='STARTED'&&(!device||x.deviceId===device)).reduce((sum,x)=>sum+x.count,0);
  const completed=result.report.counts.filter(x=>x.status==='COMPLETED'&&(!device||x.deviceId===device)).reduce((sum,x)=>sum+x.count,0);
  return <section className="panel radio-history" aria-label="Historial de radio">
    <h2>Historial de radio</h2>
    <p>Iniciado y completado son estados reportados por el navegador; no confirman que hayas oído el audio.</p>
    <div className="radio-history-filters">
      <label>Sesión<select value={session} onChange={e=>{filter(setSession)(e.target.value);setDevice('');}}>{sessions.map(s=><option key={s.id} value={s.id}>{s.track} · {s.mode} · {s.laps} vueltas</option>)}</select></label>
      <label>Dispositivo<select value={device} onChange={e=>filter(setDevice)(e.target.value)}><option value="">Todos</option>{result.devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.deviceId.slice(0,8)}</option>)}</select></label>
      <label>Estado<select value={status} onChange={e=>filter(setStatus)(e.target.value)}><option value="">Todos</option>{['SELECTED','QUEUED','DEFERRED','SUBMITTED','STARTED','COMPLETED','CANCELLED','EXPIRED','ERROR'].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
      <label>Categoría<select value={category} onChange={e=>filter(setCategory)(e.target.value)}><option value="">Todas</option>{['SAFETY','STRATEGY','BATTLE','PACE','CAR','STATUS'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Vuelta<input aria-label="Filtrar vuelta" type="number" min="0" max="1000" value={lap} onChange={e=>filter(setLap)(e.target.value)}/></label>
    </div>
    {error&&<p role="alert">{error}</p>}
    <p>{started} reproducciones iniciadas · {completed} completadas · {result.total} eventos con estos filtros</p>
    <p>Demora mediana · cola: {median('queueMs')} · arranque de voz: {median('speechStartupMs')} · total desde selección: {median('totalMs')}</p>
    {!result.events.length?<p>Sin entregas registradas. Las sesiones anteriores a esta actualización solo tienen decisiones del servidor.</p>:<div className="radio-history-table"><table><thead><tr><th>Vuelta</th><th>Dispositivo</th><th>Estado</th><th>Mensaje</th><th>Motivo</th></tr></thead><tbody>{result.events.map(e=><tr key={e.id}><td>{e.lap}</td><td>{e.deviceId.slice(0,8)}</td><td>{labels[e.status]||e.status}</td><td>{e.text}</td><td>{e.reason}</td></tr>)}</tbody></table></div>}
    <div className="radio-history-pagination"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Anterior</button><span>{result.total?offset+1:0}–{Math.min(offset+50,result.total)} / {result.total}</span><button disabled={offset+50>=result.total} onClick={()=>setOffset(n=>n+50)}>Siguiente</button></div>
    <details><summary>Decisiones del servidor ({server.length})</summary><p>Selección independiente del dispositivo y de la reproducción de voz.</p>{server.map((d,i)=><p key={`${d.eventId}-${d.status}-${i}`}><b>V{d.lap} · {labels[d.status]||d.status} · {d.title||d.eventId}</b><br/>{d.reason}</p>)}</details>
    <details><summary>Intervalos sin voz y descartes</summary>{result.report.silences.filter(x=>!device||x.deviceId===device).map((x,i)=><p key={i}>{x.deviceId.slice(0,8)} · {(x.durationMs/1000).toFixed(0)} segundos entre inicios de voz</p>)}{result.report.counts.filter(x=>['ERROR','CANCELLED','EXPIRED','DEFERRED'].includes(x.status)&&(!device||x.deviceId===device)).map((x,i)=><p key={i}>{labels[x.status]} · {x.reason}: {x.count}</p>)}</details>
  </section>;
}
