import type { Express, Request } from 'express';
import type { Server } from 'socket.io';
import { DeviceAuth, RateLimit, SESSION_MS, sessionCookie } from './auth.js';

export function installAccess(app:Express,io:Server,auth:DeviceAuth,origin:string){
  const limits=new RateLimit();
  const loopback=(address?:string)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address??'');
  const secure=(req:Request)=>req.secure||(loopback(req.socket.remoteAddress)&&req.headers['x-forwarded-proto']==='https');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'Permissions-Policy':'camera=(), microphone=(), geolocation=(), screen-wake-lock=(self)'});
    if(req.path.startsWith('/api'))res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:'Origin not allowed'});
    if(req.path==='/api/health'&&loopback(req.socket.remoteAddress))return res.json({status:'ok'});
    if(!req.path.startsWith('/api'))return next();
    if(!secure(req))return res.status(403).json({error:'Use the configured HTTPS dashboard'});
    if(req.path==='/api/auth/redeem')return next();
    const device=auth.device(sessionCookie(req.headers.cookie));
    if(!device)return res.status(401).json({error:'Device pairing required'});
    if(!limits.allow(device.id,240))return res.status(429).json({error:'Too many requests'});
    res.locals.device=device;next();
  });
  app.post('/api/auth/redeem',(req,res)=>{
    const address=loopback(req.socket.remoteAddress)?String(req.headers['cf-connecting-ip']??req.socket.remoteAddress):req.socket.remoteAddress??'unknown';
    if(!limits.allow('pair:'+address,5))return res.status(429).json({error:'Try pairing again in a minute'});
    const {token,name}=req.body??{};
    if(typeof token!=='string'||token.length!==43||typeof name!=='string'||!name.trim()||name.length>60)return res.status(400).json({error:'Invalid pairing request'});
    const result=auth.redeem(token,name.trim());
    if(!result)return res.status(401).json({error:'Pairing link expired or already used'});
    res.setHeader('Set-Cookie',`f1_session=${result.secret}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS/1000}`);
    res.json({id:result.id});
  });
  app.get('/api/auth/me',(_req,res)=>res.json(res.locals.device));
  app.get('/api/auth/devices',(_req,res)=>res.json(auth.list()));
  app.post('/api/auth/pair',(_req,res)=>res.json({url:`${origin}/#pair=${auth.pair()}`,expiresIn:600}));
  app.delete('/api/auth/devices/:id',(req,res)=>{
    auth.revoke(String(req.params.id));
    for(const socket of io.sockets.sockets.values())if(socket.data.deviceId===req.params.id)socket.disconnect(true);
    res.json({ok:true});
  });
  io.use((socket,next)=>{
    if(socket.handshake.headers.origin!==origin)return next(new Error('Origin not allowed'));
    const device=auth.device(sessionCookie(socket.handshake.headers.cookie));
    if(!device)return next(new Error('Device pairing required'));
    const count=[...io.sockets.sockets.values()].filter(s=>s.data.deviceId===device.id).length;
    if(count>=3||io.sockets.sockets.size>=12)return next(new Error('Connection limit reached'));
    socket.data.deviceId=device.id;
    const timer=setInterval(()=>{if(!auth.device(sessionCookie(socket.handshake.headers.cookie)))socket.disconnect(true);},60000);
    socket.on('disconnect',()=>clearInterval(timer));next();
  });
}
