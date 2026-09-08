import { io } from 'socket.io-client';
import dgram from 'node:dgram';
import { writeFileSync } from 'node:fs';
import { DeviceAuth } from '../work/redteam-release/dist-server/auth.js';

// Isolated acceptance environment only. Never sends telemetry to the game port.
const base='http://127.0.0.1:3479',origin='https://127.0.0.1:3480',udpPort=20888;
const auth=new DeviceAuth('work/redteam-sandbox/data/devices.sqlite');
const device=auth.redeem(auth.pair(),'Soak test');auth.close();
const headers={origin,'x-forwarded-proto':'https',cookie:`f1_session=${device.secret}`};
const duration=Number(process.env.SOAK_SECONDS??1800),start=performance.now();
const udp=dgram.createSocket('udp4'),sockets=[];
let frame=0,received=0,resets=0,errors=[],samples=[],maxQueue=0,historyBusy=false;
const packet=(id,size)=>{const b=Buffer.alloc(size);b.writeUInt16LE(2026);b[5]=1;b[6]=id;b.writeBigUInt64LE(900029n,7);b.writeFloatLE(frame/60,15);b.writeUInt32LE(frame,19);b[28]=255;return b;};
const send=b=>udp.send(b,udpPort,'127.0.0.1');
for(let i=0;i<2;i++){
  const socket=io(base,{transports:['websocket'],extraHeaders:headers});sockets.push(socket);let drop=i===0;
  socket.on('connect',()=>socket.emit('raceStreamReady'));
  socket.on('streamReset',()=>{resets++;socket.disconnect().connect();});
  socket.on('raceState',(_state,ack)=>{received++;if(ack){if(drop){drop=false;return;}ack();}});
  socket.on('connect_error',error=>errors.push(error.message));
}
async function request(path){const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json();}
function tick(){
  const seconds=frame/60,lap=Math.floor(seconds/90)+1;
  if(frame%60===0){
    const session=packet(1,926);session[32]=60;session.writeUInt16LE(5000,33);session[35]=15;session[36]=0;session.writeUInt16LE(Math.max(0,5400-seconds),38);session.writeUInt32LE(29,678);send(session);
    const drivers=packet(4,1470);drivers[29]=24;for(let i=0;i<24;i++)drivers.write('TEST '+i,30+i*60+10);send(drivers);
  }
  const laps=packet(2,1399),status=packet(7,1445),telemetry=packet(6,1448);
  for(let i=0;i<24;i++){
    const o=29+i*57;laps.writeUInt32LE(90000+i*50,o);laps.writeUInt32LE((seconds%90)*1000,o+4);laps.writeFloatLE((seconds%90)/90*5000,o+20);laps[o+32]=i+1;laps[o+33]=lap;laps[o+44]=4;laps.writeUInt16LE(i?2000:0,o+14);laps.writeUInt16LE(i*2000,o+17);
    const st=29+i*59;status.writeFloatLE(35,st+5);status.writeFloatLE(2,st+13);status[st+26]=17;status[st+27]=lap;status.writeFloatLE(2000000,st+37);
  }
  telemetry.writeUInt16LE(250,29);telemetry.writeFloatLE(.8,31);telemetry.writeFloatLE(Math.sin(seconds)*.1,35);telemetry[44]=6;for(let i=0;i<4;i++)telemetry[59+i]=95;
  send(laps);send(status);send(telemetry);frame++;
  if(performance.now()-start<duration*1000)setTimeout(tick,Math.max(0,start+frame*1000/60-performance.now()));else void finish();
}
const monitor=setInterval(async()=>{
  if(historyBusy)return;historyBusy=true;
  try{
    const health=await request('/api/operations');maxQueue=Math.max(maxQueue,health.persistence.queue);
    const sessions=await request('/api/sessions');if(sessions[0])await request(`/api/sessions/${sessions[0].id}/radio?limit=50`);
    await request('/api/analysis');samples.push({seconds:Math.round((performance.now()-start)/1000),p95:health.eventLoopP95Ms,queue:health.persistence.queue});
    if(health.persistence.error)errors.push(health.persistence.error);
  }catch(error){errors.push(String(error));}finally{historyBusy=false;}
},5000);
const progress=setInterval(()=>console.log(JSON.stringify({elapsed:Math.round((performance.now()-start)/1000),frame,received,maxQueue,last:samples.at(-1),errors:errors.length})),60000);
async function finish(){
  clearInterval(monitor);clearInterval(progress);udp.close();for(const socket of sockets)socket.close();
  const elapsed=(performance.now()-start)/1000,last=samples.at(-1);
  const result={durationSeconds:elapsed,inputFrames:frame,rateHz:frame/elapsed,received,resets,maxQueue,eventLoopP95Ms:last?.p95,errors,samples};
  writeFileSync('work/redteam-soak-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,samples:undefined}));
  process.exitCode=errors.length||!resets||!last||last.p95>=50||maxQueue>=128?1:0;
}
tick();
