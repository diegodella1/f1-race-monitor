import type { Delivery } from './radioQueue';

const storageKey='f1-radio-deliveries-v1';
let events:Delivery[]=[];
let sending=false;
try{events=JSON.parse(localStorage.getItem(storageKey)||'[]');if(!Array.isArray(events))events=[];}catch{events=[];}
const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(events));}catch{/* Delivery continues when storage is unavailable. */}};
export function recordDelivery(event:Delivery){events.push(event);events=events.slice(-2000);persist();}
export async function flushDeliveries(){
  if(sending||!events.length)return;
  sending=true;const batch=events.slice(0,10);
  try{
    const response=await fetch('/api/radio-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),keepalive:true});
    if(!response.ok)return;
    const body=await response.json() as {acknowledged:string[]};
    const sent=new Set(body.acknowledged);events=events.filter(e=>!sent.has(e.eventId));persist();
  }catch{/* Retain the batch for the next connection. */}finally{sending=false;}
}
