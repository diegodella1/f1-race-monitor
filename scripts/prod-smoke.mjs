import {DeviceAuth} from '../dist-server/auth.js';
import {io} from 'socket.io-client';

const origin=process.env.APP_ORIGIN??'https://f12025.diegodella.ar';
const base=process.env.SMOKE_BASE_URL??'http://127.0.0.1:3469';
const auth=new DeviceAuth('data/devices.sqlite');
const device=auth.redeem(auth.pair(),'Release verification');
const headers={origin,'x-forwarded-proto':'https',cookie:`f1_session=${device.secret}`};
let socket;
try{
  const anonymous=await fetch(base+'/api/state',{headers:{'x-forwarded-proto':'https'},signal:AbortSignal.timeout(10000)});
  if(anonymous.status!==401)throw Error('Unauthenticated state was not rejected');
  const read=async path=>{const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json();};
  const state=await read('/api/state'),operations=await read('/api/operations'),sessions=await read('/api/sessions');
  if(operations.persistence.error||operations.sourceError)throw Error('Unhealthy capture/persistence: '+JSON.stringify(operations));
  if(sessions[0])await read(`/api/sessions/${sessions[0].id}/radio?limit=1`);
  let frames=0;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Live stream timed out')),10000);
    socket=io(base,{transports:['websocket'],extraHeaders:headers,reconnection:false});
    socket.on('connect',()=>socket.emit('raceStreamReady'));
    socket.on('connect_error',error=>{clearTimeout(timer);reject(error);});
    socket.on('raceState',(value,ack)=>{if(typeof ack==='function')ack();if(value.streamVersion!==2){clearTimeout(timer);reject(Error('Wrong stream version'));}else if(++frames>=2){clearTimeout(timer);resolve();}});
  });
  console.log(JSON.stringify({status:state.status,sessions:sessions.length,frames,unauthorized:401,persistence:operations.persistence,sourceError:operations.sourceError}));
}finally{socket?.close();auth.revoke(device.id);auth.close();}
