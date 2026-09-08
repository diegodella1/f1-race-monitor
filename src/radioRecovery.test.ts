import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioQueue } from './radioQueue';
import { initialState } from '../server/state';

test('an essential failed call retries once and exposes failure instead of READY',()=>{
  const state=initialState();state.status='CONNECTED';state.flag='RED';state.sessionUid='recovery';
  let count=0;const queue=new RadioQueue({speak:(_text,cb)=>{count++;cb.error('synthesis-failed');},cancel:()=>{},log:()=>{}});
  const message={id:'red-flag',eventId:'red-1',title:'Red flag',evidence:'',action:'Slow down',priority:'critical' as const,confidence:100,createdAt:0,expiresAt:100000};
  queue.update(message,state,'Red flag',1000);assert.equal(count,1);queue.update(message,state,'Red flag',2100);assert.equal(count,2);
  queue.update(message,state,'Red flag',4000);assert.equal(count,2);assert.equal(queue.status,'ATTENTION');
});
test('a retry and manual repeat are cancelled after the condition clears',()=>{
  const state=initialState();state.status='CONNECTED';state.flag='RED';let count=0;
  const queue=new RadioQueue({speak:(_text,cb)=>{count++;cb.error('synthesis-failed');},cancel:()=>{},log:()=>{}});
  const message={id:'red-flag',title:'Red flag',evidence:'',action:'Slow down',priority:'critical' as const,confidence:100,createdAt:0,expiresAt:100000};
  queue.update(message,state,'Red flag',1000);state.flag='GREEN';queue.update(null,state,'',2100);assert.equal(count,1);assert.equal(queue.repeat(state,2200),false);
});
test('an essential retry survives a disconnected transport',()=>{
  const state=initialState();state.status='CONNECTED';state.flag='RED';let count=0;
  const queue=new RadioQueue({speak:(_text,cb)=>{count++;if(count===1)cb.error('synthesis-failed');else cb.end();},cancel:()=>{},log:()=>{}});
  const message={id:'red-flag',title:'Red flag',evidence:'',action:'Slow down',priority:'critical' as const,confidence:100,createdAt:0,expiresAt:100000};
  queue.update(message,state,'Red flag',1000);
  state.transport={connected:false,stale:true,lastReceivedAt:1000};queue.update(message,state,'Red flag',2100);assert.equal(count,1);
  state.transport={connected:true,stale:false,lastReceivedAt:3000};queue.update(message,state,'Red flag',3000);assert.equal(count,2);
});
test('manual voice testing retains an essential pending retry',()=>{
  const state=initialState();state.status='CONNECTED';state.flag='RED';const spoken:string[]=[];
  const queue=new RadioQueue({speak:(text,cb)=>{spoken.push(text);if(spoken.length===1)cb.error('synthesis-failed');else cb.end();},cancel:()=>{},log:()=>{}});
  const message={id:'red-flag',title:'Red flag',evidence:'',action:'Slow down',priority:'critical' as const,confidence:100,createdAt:0,expiresAt:100000};
  queue.update(message,state,'Red flag',1000);queue.test(state,1500);queue.update(message,state,'Red flag',3000);
  assert.equal(spoken.length,3);assert.equal(spoken[2],'Red flag');
});
