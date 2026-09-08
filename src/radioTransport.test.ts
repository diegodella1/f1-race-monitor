import test from 'node:test';
import assert from 'node:assert/strict';
import { flushDeliveries, recordDelivery } from './radioTransport';

test('delivery retries retain event identity and only remove acknowledged events',async()=>{
  const original=globalThis.fetch,batches:string[][]=[];
  recordDelivery({eventId:'retry-1',deviceId:'phone',sessionUid:'spa',sessionLinkId:2,sessionType:'Race',messageId:'push',status:'STARTED',text:'Push',reason:'started',category:'PACE',lap:7,clientAt:1000});
  try{
    globalThis.fetch=async(_url,init)=>{batches.push(JSON.parse(String(init?.body)).events.map((x:{eventId:string})=>x.eventId));throw Error('Offline');};
    await flushDeliveries(1000);
    globalThis.fetch=async(_url,init)=>{batches.push(JSON.parse(String(init?.body)).events.map((x:{eventId:string})=>x.eventId));return new Response(JSON.stringify({acknowledged:['retry-1']}),{status:200});};
    await flushDeliveries(3000);await flushDeliveries(4000);
    assert.deepEqual(batches,[['retry-1'],['retry-1']]);
  }finally{globalThis.fetch=original;}
});
test('permanent rejection is removed while retryable events rotate behind newer history',async()=>{
  const original=globalThis.fetch,batches:string[][]=[];
  const add=(eventId:string)=>recordDelivery({eventId,deviceId:'phone',sessionUid:'spa',sessionLinkId:2,sessionType:'Race',messageId:'push',status:'STARTED',text:'Push',reason:'started',category:'PACE',lap:7,clientAt:1000});
  add('unknown-session');add('temporarily-unavailable');
  try{
    globalThis.fetch=async(_url,init)=>{batches.push(JSON.parse(String(init?.body)).events.map((x:{eventId:string})=>x.eventId));add('new-event');return new Response(JSON.stringify({results:[{eventId:'unknown-session',status:'rejected'},{eventId:'temporarily-unavailable',status:'retry'}]}),{status:200});};
    await flushDeliveries(5000);
    globalThis.fetch=async(_url,init)=>{batches.push(JSON.parse(String(init?.body)).events.map((x:{eventId:string})=>x.eventId));return new Response(JSON.stringify({acknowledged:['temporarily-unavailable','new-event']}),{status:200});};
    await flushDeliveries(6000);await flushDeliveries(7000);
    assert.deepEqual(batches,[['unknown-session','temporarily-unavailable'],['new-event','temporarily-unavailable']]);
  }finally{globalThis.fetch=original;}
});
