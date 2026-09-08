import { useState } from 'react';
export function SessionActions({id,onDeleted}:{id:string;onDeleted:()=>void}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function exportSession(){
    setBusy(true);setMessage('Exporting session…');
    try{
      const pages:BlobPart[]=['{"version":1,"frames":['];let first=true;
      for(let offset=0;;offset+=200){
        const r=await fetch(`/api/sessions/${id}/replay?limit=200&offset=${offset}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Export failed');
        const {frames}=await r.json();for(const frame of frames){pages.push((first?'':',')+JSON.stringify(frame));first=false;}
        if(frames.length<200)break;
      }
      pages.push('],"decisions":[');first=true;
      for(let offset=0;;offset+=200){const r=await fetch(`/api/sessions/${id}/decisions?limit=200&offset=${offset}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Decision export failed');const rows=await r.json();for(const row of rows){pages.push((first?'':',')+JSON.stringify(row));first=false;}if(rows.length<200)break;}
      pages.push('],"radio":[');first=true;
      for(let offset=0;;offset+=200){const r=await fetch(`/api/sessions/${id}/radio?limit=200&offset=${offset}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Radio export failed');const {events}=await r.json();for(const row of events){pages.push((first?'':',')+JSON.stringify(row));first=false;}if(events.length<200)break;}
      pages.push(']}');const url=URL.createObjectURL(new Blob(pages,{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`race-session-${id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage('Export ready');
    }catch(error){setMessage(String(error));}finally{setBusy(false);}
  }
  async function remove(){
    if(!confirm('Permanently delete this saved session and its radio history? Export it first if you need a copy.'))return;
    setBusy(true);
    try{const r=await fetch('/api/sessions/'+id,{method:'DELETE',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Could not delete session. Active sessions cannot be deleted.');onDeleted();}
    catch(error){setMessage(String(error));}finally{setBusy(false);}
  }
  return <div><button disabled={busy||!id} onClick={()=>void exportSession()}>Export session</button><button disabled={busy||!id} onClick={()=>void remove()}>Delete session</button><p role="status">{message}</p></div>;
}
