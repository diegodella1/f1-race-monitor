import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { DeviceAuth } from './auth.js';
import { installAccess } from './access.js';

test('HTTP and WebSocket require a paired device; foreign origin and revocation are enforced',async()=>{
  const auth=new DeviceAuth(':memory:'),app=express(),server=createServer(app),io=new Server(server),origin='https://pitwall.test';
  app.use(express.json());installAccess(app,io,auth,origin);app.get('/api/state',(_req,res)=>res.json({ok:true}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const headers={'x-forwarded-proto':'https',origin};
  const sockets:ReturnType<typeof connect>[]=[];
  try{
    assert.equal((await fetch(base+'/api/state',{headers})).status,401);
    const paired=await fetch(base+'/api/auth/redeem',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({token:auth.pair(),name:'Test tablet'})});
    assert.equal(paired.status,200);const cookie=paired.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);
    const identity=await paired.json() as {id:string};
    assert.equal((await fetch(base+'/api/state',{headers:{...headers,cookie}})).status,200);
    assert.equal((await fetch(base+'/api/auth/pair',{method:'POST',headers:{...headers,cookie,origin:'https://evil.test'}})).status,403);
    const socket=connect(base,{transports:['websocket'],extraHeaders:{...headers,cookie},reconnection:false});sockets.push(socket);
    await new Promise<void>((resolve,reject)=>{socket.on('connect',resolve);socket.on('connect_error',reject);});
    const disconnected=new Promise<void>(resolve=>socket.on('disconnect',()=>resolve()));
    assert.equal((await fetch(base+'/api/auth/devices/'+identity.id,{method:'DELETE',headers:{...headers,cookie}})).status,200);
    await disconnected;
    assert.equal((await fetch(base+'/api/state',{headers:{...headers,cookie}})).status,401);
    const anonymous=connect(base,{transports:['websocket'],extraHeaders:headers,reconnection:false});sockets.push(anonymous);
    await new Promise<void>((resolve,reject)=>{anonymous.on('connect',()=>reject(Error('Anonymous socket accepted')));anonymous.on('connect_error',()=>resolve());});
  }finally{for(const socket of sockets)socket.close();await new Promise<void>(resolve=>io.close(()=>resolve()));auth.close();}
});
