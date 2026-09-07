import test from 'node:test';
import assert from 'node:assert/strict';
import { flushDeliveries, recordDelivery } from './radioTransport';

test('delivery retries retain event identity and only remove acknowledged events',async()=>{
  const original=globalThis.fetch,batches:string[][]=[];
  recordDelivery({eventId:'retry-1',deviceId:'phone',sessionUid:'spa',sessionLinkId:2,sessionType:'Race',messageId:'push',status:'STARTED',text:'Push',reason:'started',category:'PACE',lap:7,clientAt:1000});
  try{
    globalThis.fetch=async(_url,init)=>{batches.push(JSON.parse(String(init?.body)).events.map((x:{eventId:string})=>x.eventId));throw Error('Offline');};
    await flushDeliveries();
    globalThis.fetch=async(_url,init)=>{batches.push(JSON.parse(String(init?.body)).events.map((x:{eventId:string})=>x.eventId));return new Response(JSON.stringify({acknowledged:['retry-1']}),{status:200});};
    await flushDeliveries();await flushDeliveries();
    assert.deepEqual(batches,[['retry-1'],['retry-1']]);
  }finally{globalThis.fetch=original;}
});
