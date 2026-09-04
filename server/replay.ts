import path from 'node:path';
import { SessionStore } from './db.js';
import { DrivingCoach } from './coach.js';
import { RaceEngineer } from './intelligence.js';
import { PitwallStrategy } from './strategy.js';
import { initialState } from './state.js';

const args=process.argv.slice(2),sessionFlag=args.indexOf('--session'),requested=sessionFlag>=0?Number(args[sessionFlag+1]):0;
const store=new SessionStore(path.resolve('data/f1-monitor.sqlite'));
const sessions=store.list() as {id:number;track:string;mode:string;laps:number}[];
const sessionId=requested||sessions[0]?.id;
if(!sessionId){console.error('No saved session found. Run a telemetry or demo session first.');store.close();process.exit(1);}
const frames=store.replay(sessionId,10000),report=store.report(sessionId);
const coach=new DrivingCoach(),strategy=new PitwallStrategy(),engineer=new RaceEngineer(),messages:{lap:number;at:number;id:string;title:string;score:number;confidence:number;action:string}[]=[];
let previousId='';
for(const frame of frames){
  const defaults=initialState();
  let state=coach.analyze({...frame.state,telemetry:frame.state.telemetry??defaults.telemetry,engineer:frame.state.engineer?.metrics?frame.state.engineer:defaults.engineer});
  state=strategy.analyze(state,frame.recordedAt);
  state=engineer.analyze(state,frame.recordedAt);
  const message=state.engineer.primary;
  if(message&&message.id!==previousId)messages.push({lap:state.lap,at:frame.recordedAt,id:message.id,title:message.title,score:message.score??0,confidence:message.confidence,action:message.action});
  previousId=message?.id??'';
}
console.log(JSON.stringify({sessionId,frames:frames.length,report,messages},null,2));
store.close();
