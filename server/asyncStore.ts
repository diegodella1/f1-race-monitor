import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { RaceState, Settings } from './types.js';
import type { RadioEvent } from './radio-events.js';

export class AsyncStore {
  private worker:Worker;
  private sequence=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private saving=false;
  private snapshots:RaceState[]=[];
  private lastSample=0;
  private lastDecision='';
  private stopped=false;
  health={error:'',queue:0,lastWriteAt:0};
  constructor(path:string){
    const compiled=new URL('./db-worker.js',import.meta.url);
    this.worker=existsSync(compiled)
      ?new Worker(compiled,{workerData:{path},execArgv:process.execArgv.filter(arg=>!arg.startsWith('--input-type'))})
      :new Worker(`import('tsx/esm/api').then(({register})=>{register();return import(${JSON.stringify(new URL('./db-worker.ts',import.meta.url).href)});})`,{eval:true,workerData:{path}});
    this.worker.on('message',({id,result,error})=>{
      const call=this.pending.get(id);if(!call)return;
      clearTimeout(call.timer);this.pending.delete(id);this.health.queue=this.pending.size;
      if(error){this.health.error=error;call.reject(Error(error));}else call.resolve(result);
    });
    this.worker.on('error',error=>this.fail(error));
    this.worker.on('exit',code=>{if(!this.stopped)this.fail(Error('Database worker stopped: '+code));});
  }
  private fail(error:Error){
    this.stopped=true;this.health.error=error.message;
    for(const call of this.pending.values()){clearTimeout(call.timer);call.reject(error);}
    this.pending.clear();this.health.queue=0;
  }
  call(method:string,...args:unknown[]):Promise<any>{
    if(this.stopped||this.pending.size>=128)return Promise.reject(Error('Persistence unavailable or overloaded'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.health.queue=this.pending.size;this.health.error='Database request timed out';reject(Error(this.health.error));},10000);
      this.pending.set(id,{resolve,reject,timer});this.health.queue=this.pending.size;
      this.worker.postMessage({id,method,args});
    });
  }
  save(state:RaceState){
    const decision=JSON.stringify([state.sessionUid,state.sessionLinkId,state.strategy.decisions.at(-1),state.engineer.log.at(-1),state.context.lifecycle]);
    if(state.updatedAt-this.lastSample<2000&&decision===this.lastDecision)return;
    this.lastDecision=decision;this.lastSample=state.updatedAt;
    const latest=this.snapshots.at(-1);
    if(latest&&latest.sessionUid===state.sessionUid&&latest.sessionLinkId===state.sessionLinkId&&latest.sessionType===state.sessionType){
      const merge=(a:RaceState['engineer']['log'],b:RaceState['engineer']['log'])=>[...new Map([...a,...b].map(x=>[`${x.id}:${x.lap}:${x.status}`,x])).values()];
      const log=merge(latest.engineer.log,state.engineer.log),decisions=merge(latest.strategy.decisions,state.strategy.decisions);
      if(log.length+decisions.length>2000){this.health.error='Persistence backlog full; some history could not be retained';return;}
      this.snapshots[this.snapshots.length-1]={...state,engineer:{...state.engineer,log},strategy:{...state.strategy,decisions}};
    }else{
      if(this.snapshots.length>=8){this.health.error='Persistence backlog full; some history could not be retained';return;}
      this.snapshots.push(state);
    }
    void this.drain();
  }
  private async drain(){
    if(this.saving)return;this.saving=true;
    try{while(this.snapshots.length){const state=this.snapshots.shift()!;await this.call('save',state);this.health.lastWriteAt=Date.now();this.health.error='';}}
    catch(error){this.health.error=String(error);}finally{this.saving=false;}
  }
  async stop(at=Date.now()){
    while(this.saving)await new Promise(resolve=>setTimeout(resolve,10));
    await this.call('stop',at);this.lastSample=0;this.lastDecision='';
  }
  async close(){try{if(!this.stopped){await this.stop();await this.call('close');}}finally{this.stopped=true;await this.worker.terminate();}}
  loadSettings(defaults:Settings):Promise<Settings>{return this.call('loadSettings',defaults);}
  saveSettings(settings:Settings){return this.call('saveSettings',settings);}
  saveRadioEvents(events:RadioEvent[]){return this.call('saveRadioEvents',events);}
}
