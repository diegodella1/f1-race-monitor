import type { Delivery } from './radioQueue';

const storageKey='f1-radio-deliveries-v1';
let events:Delivery[]=[];
let sending=false;
let nextRetryAt=0,failures=0;
let persistTimer:ReturnType<typeof setTimeout>|undefined;
try{events=JSON.parse(localStorage.getItem(storageKey)||'[]');if(!Array.isArray(events))events=[];}catch{events=[];}
const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(events));}catch{/* Delivery continues when storage is unavailable. */}};
export function recordDelivery(event:Delivery){events.push(event);events=events.slice(-2000);if(!persistTimer)persistTimer=setTimeout(()=>{persistTimer=undefined;persist();},250);}
export async function flushDeliveries(now=Date.now()){
  if(sending||!events.length||now<nextRetryAt)return;
  persist();
  sending=true;const batch=events.slice(0,10);
  try{
    const response=await fetch('/api/radio-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),keepalive:true,signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Delivery unavailable');
    const body=await response.json() as {acknowledged?:string[];results?:{eventId:string;status:string}[]};
    const sent=new Set([...(body.acknowledged??[]),...(body.results??[]).filter(r=>r.status==='accepted'||r.status==='rejected').map(r=>r.eventId)]);
    const batchKeys=new Set(batch.map(e=>e.eventId));
    events=[...events.filter(e=>!batchKeys.has(e.eventId)),...batch.filter(e=>!sent.has(e.eventId))];
    failures=0;nextRetryAt=0;persist();
  }catch{nextRetryAt=now+Math.min(30000,1000*2**Math.min(failures++,5));}finally{sending=false;}
}
