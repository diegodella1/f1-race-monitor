import express from 'express';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { writeFile, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { z } from 'zod';
import { AsyncStore } from './asyncStore.js';
import { DeviceAuth } from './auth.js';
import { installAccess } from './access.js';
import { LatestStateStream } from './stateStream.js';
import { initialState,demoState } from './state.js';
import { parsePacket,packetEventCode } from './parser.js';
import { PacketGate,packetSupport } from './packetGate.js';
import { RaceEngineer } from './intelligence.js';
import { DrivingCoach } from './coach.js';
import { PitwallStrategy } from './strategy.js';
import { TelemetryMonitor } from './telemetry.js';
import { radioEventSchema,radioQuerySchema } from './radio-events.js';
import type { RaceState,Settings } from './types.js';

const origin=process.env.APP_ORIGIN??'https://f12025.diegodella.ar';
const app=express(),http=createServer(app),io=new Server(http,{maxHttpBufferSize:16384});
app.disable('x-powered-by');app.use(express.json({limit:'128kb'}));
const auth=new DeviceAuth(path.resolve('data/devices.sqlite'));
installAccess(app,io,auth,origin);
const store=new AsyncStore(path.resolve('data/f1-monitor.sqlite'));
let settings:Settings=await store.loadSettings({udpPort:Number(process.env.UDP_PORT)||20777,demoMode:false,autoSave:true,demoSession:'RACE'});
let state=initialState(),udp:dgram.Socket|null=null,demoTimer:ReturnType<typeof setInterval>|null=null;
let lastPacket=0,tick=0,sourceError='',diagnosticError='',changing=false,dirty=false,lastBroadcast=0;
const engineer=new RaceEngineer(),coach=new DrivingCoach(),strategy=new PitwallStrategy(),telemetry=new TelemetryMonitor();
const gate=new PacketGate(process.env.TELEMETRY_SOURCE_IP??'');
const streams=new Map<string,LatestStateStream<RaceState>>();
const counters={valid:0,invalid:0,unsupported:0,discarded:0};
const lag=monitorEventLoopDelay({resolution:20});lag.enable();
function live(snapshot=state):RaceState{
  return {...snapshot,streamVersion:2,serverTime:Date.now(),telemetry:telemetry.quality(snapshot),engineer:{...snapshot.engineer,log:[]},strategy:{...snapshot.strategy,decisions:[]},coach:{...snapshot.coach,analysis:{...snapshot.coach.analysis,current:[],reference:[]}}};
}
function publish(){
  state={...state,telemetry:telemetry.quality(state)};
  state=strategy.analyze(state);state=coach.analyze(state);state=engineer.analyze(state);
  dirty=true;if(settings.autoSave&&state.status!=='WAITING')store.save(state);
}
function packet(msg:Buffer,address:string){
  const support=packetSupport(msg);
  if(support!=='valid'){counters[support]++;if(support==='invalid')telemetry.observe(msg,false,address);return;}
  if(!gate.accept(msg,address)){counters.discarded++;return;}
  const parsed=parsePacket(msg,state);
  telemetry.observe(msg,!!parsed,address);
  if(!parsed){counters.invalid++;return;}
  counters.valid++;lastPacket=Date.now();state=parsed;
  if(packetEventCode(msg)==='FLBK'){engineer.reset();coach.reset();strategy.reset();state={...state,alerts:[],sessionSummary:null,context:{...state.context,lifecycle:'ACTIVE',incidents:[]}};}
  publish();
}
async function bind(port:number){
  const socket=dgram.createSocket('udp4');
  await new Promise<void>((resolve,reject)=>{
    const failed=(error:Error)=>{socket.close();reject(error);};
    socket.once('error',failed);socket.bind(port,'0.0.0.0',()=>{socket.off('error',failed);resolve();});
  });
  socket.on('error',error=>{sourceError=error.message;});
  socket.on('message',(msg,remote)=>{if(socket===udp)packet(msg,remote.address);});
  return socket;
}
function stopSources(){if(udp){udp.close();udp=null;}if(demoTimer){clearInterval(demoTimer);demoTimer=null;}}
async function changeSettings(next:Settings){
  if(changing)throw Error('A settings update is already in progress');changing=true;
  let candidate:dgram.Socket|null=null,persisted=false;
  try{
    const restart=next.udpPort!==settings.udpPort||next.demoMode!==settings.demoMode||(next.demoMode&&next.demoSession!==settings.demoSession);
    if(restart&&!next.demoMode&&(next.udpPort!==settings.udpPort||!udp))candidate=await bind(next.udpPort);
    await store.saveSettings(next);persisted=true;
    if(restart){
      await store.stop();stopSources();state=initialState();engineer.reset();coach.reset();strategy.reset();telemetry.reset();gate.reset();lastPacket=0;tick=0;
      if(next.demoMode)demoTimer=setInterval(()=>{state=demoState(tick++,state,next.demoSession);publish();},500);
      else {udp=candidate;candidate=null;}
      sourceError='';publish();
    }
    settings=next;
  }catch(error){
    if(persisted)await store.saveSettings(settings);
    throw error;
  }finally{candidate?.close();changing=false;}
}
const settingsSchema=z.object({udpPort:z.number().int().min(1024).max(65535),demoMode:z.boolean(),autoSave:z.boolean(),demoSession:z.enum(['RACE','PRACTICE','QUALIFYING'])}).strict();
const pageSchema=z.object({limit:z.coerce.number().int().min(1).max(1000).default(200),offset:z.coerce.number().int().min(0).max(1000000).default(0)});
app.get('/api/info',async(_req,res)=>{
  const ips=Object.values(os.networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal&&!x.address.startsWith('169.254.')).map(x=>x!.address);
  res.json({settings,ips,mobileUrl:origin,qr:await QRCode.toDataURL(origin,{margin:1,width:256})});
});
app.put('/api/settings',async(req,res)=>{const parsed=settingsSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid settings'});await changeSettings(parsed.data);res.json({settings});});
app.get('/api/state',(_req,res)=>res.json(live()));
app.get('/api/analysis',(_req,res)=>res.json({sessionUid:state.sessionUid,sessionLinkId:state.sessionLinkId,coach:state.coach}));
app.get('/api/quality',(_req,res)=>res.json(telemetry.quality(state)));
app.get('/api/operations',(_req,res)=>res.json({source:gate.lockedSource,counters,sourceError,diagnosticError,persistence:store.health,eventLoopP95Ms:lag.percentile(95)/1e6,connections:streams.size}));
app.get('/api/diagnostics',(_req,res)=>res.json({source:gate.lockedSource,counters,quality:telemetry.quality(state)}));
app.get('/api/sessions',async(_req,res)=>res.json(await store.call('list')));
app.param('id',(req,res,next)=>{if(!req.path.startsWith('/api/sessions/'))return next();if(!Number.isSafeInteger(Number(req.params.id))||Number(req.params.id)<1)return res.status(400).json({error:'Invalid session id'});next();});
app.get('/api/sessions/:id/decisions',async(req,res)=>{const q=pageSchema.safeParse(req.query);if(!q.success)return res.status(400).json({error:'Invalid page'});res.json(await store.call('decisions',Number(req.params.id),q.data.limit,q.data.offset,true));});
app.get('/api/sessions/:id/replay',async(req,res)=>{const q=pageSchema.safeParse(req.query);if(!q.success)return res.status(400).json({error:'Invalid page'});res.json({frames:await store.call('replay',Number(req.params.id),q.data.limit,q.data.offset)});});
app.get('/api/sessions/:id/report',async(req,res)=>{const report=await store.call('report',Number(req.params.id));res.status(report?200:404).json(report??{error:'Session not found'});});
app.delete('/api/sessions/:id',async(req,res)=>{await store.call('deleteSession',Number(req.params.id));res.json({ok:true});});
const reportCache=new Map<number,{at:number;value:unknown}>();
app.get('/api/sessions/:id/radio',async(req,res)=>{
  const q=radioQuerySchema.safeParse(req.query);if(!q.success)return res.status(400).json({error:'Invalid radio query'});
  const id=Number(req.params.id);let cached=reportCache.get(id);
  if(!cached||Date.now()-cached.at>30000){cached={at:Date.now(),value:await store.call('radioReport',id)};if(reportCache.size>=20)reportCache.delete(reportCache.keys().next().value!);reportCache.set(id,cached);}
  res.json({...await store.call('radioEvents',id,q.data),report:cached.value});
});
app.post('/api/radio-events',async(req,res)=>{
  if(!Array.isArray(req.body?.events)||req.body.events.length<1||req.body.events.length>50)return res.status(400).json({error:'Invalid radio batch'});
  const valid=[],rejected=[];
  for(const event of req.body.events){const parsed=radioEventSchema.safeParse(event);if(parsed.success)valid.push({...parsed.data,deviceId:res.locals.device.id});else if(typeof event?.eventId==='string')rejected.push({eventId:event.eventId,status:'rejected',reason:'Invalid event'});}
  await store.saveRadioEvents(valid);
  const results=[...await store.call('radioResults',valid),...rejected];
  res.json({results,acknowledged:results.filter(x=>x.status==='accepted').map(x=>x.eventId)});
});
io.on('connection',socket=>{
  let stream:LatestStateStream<RaceState>|undefined;
  socket.emit('raceState',live());
  socket.on('raceStreamReady',()=>{
    if(stream)return;
    stream=new LatestStateStream<RaceState>((value,ack)=>socket.emit('raceState',value,ack),100,()=>socket.emit('streamReset'));
    streams.set(socket.id,stream);stream.update(live());stream.flush(Date.now());
  });
  socket.on('disconnect',()=>{stream?.close();streams.delete(socket.id);});
});
const streamTimer=setInterval(()=>{
  if(lastPacket&&Date.now()-lastPacket>2500&&state.status==='CONNECTED'){state={...state,status:'PAUSED'};publish();}
  if(dirty||Date.now()-lastBroadcast>=1000){lastBroadcast=Date.now();const value=live();for(const stream of streams.values())stream.update(value);dirty=false;}
  for(const stream of streams.values())stream.flush(Date.now());
},100);
let writing=false;
const diagnosticsTimer=setInterval(async()=>{
  if(writing)return;writing=true;
  try{await writeFile('data/telemetry-diagnostics.json.tmp',JSON.stringify({at:Date.now(),counters,source:gate.lockedSource,quality:telemetry.quality(state)}));await rename('data/telemetry-diagnostics.json.tmp','data/telemetry-diagnostics.json');diagnosticError='';}
  catch(error){diagnosticError=String(error);}finally{writing=false;}
},5000);
app.use(express.static(path.resolve('dist')));
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api')&&!req.path.startsWith('/socket.io'))res.sendFile(path.resolve('dist/index.html'));else next();});
app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{console.error(error.message);res.status(503).json({error:'Operation unavailable. Retry shortly.'});});
http.listen(Number(process.env.PORT)||3000,'0.0.0.0',async()=>{
  try{if(settings.demoMode)demoTimer=setInterval(()=>{state=demoState(tick++,state,settings.demoSession);publish();},500);else udp=await bind(settings.udpPort);console.log('Race Monitor ready; UDP port '+settings.udpPort);}
  catch(error){sourceError=String(error);console.error(sourceError);}
});
async function shutdown(){clearInterval(streamTimer);clearInterval(diagnosticsTimer);lag.disable();stopSources();io.close();http.close();try{await store.close();auth.close();}finally{process.exit(0);}}
process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
