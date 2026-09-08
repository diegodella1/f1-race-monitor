import { parentPort, workerData } from 'node:worker_threads';
import { SessionStore } from './db.js';
const store=new SessionStore(workerData.path);
const allowed=new Set(['save','stop','close','loadSettings','saveSettings','saveRadioEvents','acknowledgedRadioEvents','radioResults','list','decisions','replay','report','radioEvents','radioReport','deleteSession']);
parentPort!.on('message',({id,method,args})=>{
  try{
    if(!allowed.has(method))throw Error('Unknown database method');
    const methods=store as unknown as Record<string,(...args:unknown[])=>unknown>;
    parentPort!.postMessage({id,result:methods[method](...args)});
  }catch(error){parentPort!.postMessage({id,error:error instanceof Error?error.message:String(error)});}
});
