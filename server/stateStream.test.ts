import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestStateStream } from './stateStream.js';

test('a slow client receives the latest frame rather than a telemetry backlog',()=>{
  const values:number[]=[];let acknowledge=()=>{};
  const stream=new LatestStateStream<number>((value,ack)=>{values.push(value);acknowledge=ack;});
  stream.update(0);stream.flush(0);
  for(let i=1;i<=175;i++){stream.update(i);stream.flush(i*6);}
  assert.deepEqual(values,[0]);acknowledge();stream.flush(1100);
  assert.deepEqual(values,[0,175]);
});
test('a fast client cannot exceed ten frames per second',()=>{
  const values:number[]=[];const stream=new LatestStateStream<number>((value,ack)=>{values.push(value);ack();});
  for(let now=0;now<1000;now++){stream.update(now);stream.flush(now);}
  assert.equal(values.length,10);stream.close();stream.update(1000);stream.flush(1000);assert.equal(values.length,10);
});
