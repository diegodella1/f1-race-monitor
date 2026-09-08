import { messageIsCurrent } from '../server/messagePolicy';
import { controlSummary } from '../server/raceControl';
import type { EngineerMessage, RaceState } from './types';

export type DeliveryStatus='SELECTED'|'QUEUED'|'DEFERRED'|'SUBMITTED'|'STARTED'|'COMPLETED'|'CANCELLED'|'EXPIRED'|'ERROR';
export type Delivery={eventId:string;deviceId:string;sessionUid:string;sessionLinkId:number;sessionType:string;messageId:string;status:DeliveryStatus;text:string;reason:string;category:string;lap:number;clientAt:number};
type Call={message:EngineerMessage;state:RaceState;text:string;key:string;queuedAt:number;safeSince:number|null;deferredReason?:string;submittedAt?:number;started?:boolean};
type Output={speak:(text:string,callbacks:{start:()=>void;end:()=>void;error:(reason:string)=>void})=>void;cancel:()=>void;log:(call:Call,status:DeliveryStatus,reason:string)=>void};
const rank={critical:4,action:3,opportunity:2,info:1};
export const messageKey=(m:EngineerMessage,s:RaceState)=>m.eventId??`${s.sessionUid}:${s.sessionLinkId}:${s.sessionType}:${m.id}:${m.createdAt}`;
const exceptional=(m:EngineerMessage)=>!!m.control||!!m.weather||m.priority==='critical'||['final-lap','race-finished','race-retired','strategy-box-mandatory','strategy-box-latest','strategy-box'].includes(m.id)||m.context?.damageBefore!==undefined;
const sessionIdentity=(s:RaceState)=>`${s.sessionUid}:${s.sessionLinkId}:${s.sessionType}:${s.raceControl?.generation??0}`;

export class RadioQueue {
  private pending:Call|null=null;
  private notices:Call[]=[];
  private playing:Call|null=null;
  private seen=new Set<string>();
  private lastAt=-Infinity;
  private lap=-1;
  private count=0;
  private session='';
  constructor(private output:Output){}

  activate(state:RaceState,now:number){
    this.clear('Radio activated');this.session=sessionIdentity(state);this.lap=state.lap;
    for(const event of state.raceControl?.events??[])this.seen.add(event.id);
    for(const message of state.engineer.control??[])this.seen.add(messageKey(message,state));
    const summary=controlSummary(state,now);
    if(summary)this.enqueueNotice(summary,state,now);
  }

  private enqueueNotice(message:EngineerMessage,state:RaceState,now:number){
    const key=messageKey(message,state);
    if(this.seen.has(key))return;
    this.seen.add(key);
    const call:Call={message,state,text:message.radio?.en??message.title,key,queuedAt:now,safeSince:null};
    this.output.log(call,'SELECTED',message.weather?'Selected from weather queue':'Selected from race control queue');
    if(!this.valid(call,state,now)){this.output.log(call,'EXPIRED','Notice no longer relevant');return;}
    this.notices.push(call);this.output.log(call,'QUEUED','Notice retained while relevant until delivery');
  }

  private refreshNotices(state:RaceState,now:number){
    this.notices=this.notices.filter(call=>{
      if(!this.valid(call,state,now)){this.output.log(call,'EXPIRED','Notice cleared or no longer relevant');return false;}
      const message=[...(state.engineer.control??[]),...(state.engineer.weather??[])].find(message=>messageKey(message,state)===call.key);
      if(message){call.message=message;call.text=message.radio?.en??message.title;}
      return true;
    });
    for(const message of [...(state.engineer.control??[]),...(state.engineer.weather??[])])this.enqueueNotice(message,state,now);
    const order=(call:Call)=>call.message.control?(call.message.control.kind==='WARNING'?1:0):call.message.weather?.kind==='BOX'?2:3;
    this.notices.sort((a,b)=>order(a)-order(b)||a.queuedAt-b.queuedAt);
  }

  private interruptPlaying(reason:string,retainControl:boolean){
    const call=this.playing;if(!call)return;
    this.playing=null;this.output.log(call,'CANCELLED',reason);this.output.cancel();
    if(retainControl&&(call.message.control||call.message.weather)){
      this.notices.unshift({...call,submittedAt:undefined,started:false,deferredReason:undefined});
      this.output.log(call,'QUEUED','Interrupted notice retained for retry');
    }
  }

  update(message:EngineerMessage|null,state:RaceState,text:string,now:number){
    const playing=this.playing;
    if(playing&&playing.submittedAt!==undefined&&now-playing.submittedAt>(playing.started?45000:10000)){
      this.playing=null;this.output.log(playing,'ERROR',playing.started?'Speech completion timed out':'Speech did not start within 10 seconds');this.output.cancel();
    }
    const session=sessionIdentity(state);
    if(this.session!==session||state.lap<this.lap){this.clear('Session changed');this.seen.clear();this.count=0;this.lastAt=-Infinity;}
    this.session=session;
    if(this.lap!==state.lap){this.lap=state.lap;this.count=0;}
    const terminal=['FINISHED','RETIRED'].includes(state.context.lifecycle);
    this.refreshNotices(state,now);
    if(this.playing?.message.weather&&!this.valid(this.playing,state,now))this.interruptPlaying('Weather recommendation no longer current',false);
    if((!['CONNECTED','DEMO'].includes(state.status)&&!terminal)||(state.context.gamePaused&&!terminal)){
      this.drop('CANCELLED','Paused or disconnected');this.interruptPlaying('Paused or disconnected',true);
      for(const call of this.notices)if(call.deferredReason!=='Paused or disconnected'){call.deferredReason='Paused or disconnected';this.output.log(call,'DEFERRED',call.deferredReason);}
      return;
    }
    if(this.pending&&!this.valid(this.pending,state,now))this.drop('EXPIRED','Context changed or message expired');
    if(message){
      const key=messageKey(message,state);
      if(!this.seen.has(key)){
        this.seen.add(key);
        const call:Call={message,state,text,key,queuedAt:now,safeSince:null};
        this.output.log(call,'SELECTED','Selected by client');
        if(!this.valid(call,state,now))this.output.log(call,'EXPIRED','Context changed or message expired');
        else if(this.pending&&rank[this.pending.message.priority]>rank[message.priority])this.output.log(call,'CANCELLED','Higher priority pending');
        else{
          if(this.pending)this.drop('CANCELLED','Replaced by newer decision');
          this.pending=call;this.output.log(call,'QUEUED','Waiting for delivery');
          if(message.priority==='critical')this.interruptPlaying('Interrupted by critical event',true);
        }
      }
    }
    this.deliver(state,now);
  }

  private valid(call:Call,state:RaceState,now:number){
    return messageIsCurrent(call.message,state,now);
  }

  private deliver(state:RaceState,now:number){
    const call=this.pending?.message.priority==='critical'?this.pending:this.notices[0]??this.pending;if(!call)return;
    const defer=(reason:string)=>{if(call.deferredReason!==reason){call.deferredReason=reason;this.output.log(call,'DEFERRED',reason);}};
    if(this.playing){defer('Another message is speaking');return;}
    if(!exceptional(call.message)&&this.count>=3){defer('Three ordinary messages per lap');return;}
    const spacing=call.message.priority==='action'?3000:call.message.priority==='opportunity'?6000:15000;
    if(!exceptional(call.message)&&now-this.lastAt<spacing){defer('Minimum interval between messages');return;}
    if(call.message.priority==='info'){
      const safe=state.player.brake<=12&&Math.abs(state.player.steer)<=.18;
      call.safeSince=safe?(call.safeSince??now):null;
      if(call.safeSince===null||now-call.safeSince<500){defer('Waiting for a safe speaking window');if(now-call.queuedAt>=10000)this.drop('EXPIRED','No safe speaking window');return;}
    }
    if(call===this.pending)this.pending=null;
    else this.notices=this.notices.filter(item=>item!==call);
    this.playing=call;
    call.submittedAt=now;this.output.log(call,'SUBMITTED','Sent to browser speech engine');
    this.lastAt=now;if(!exceptional(call.message))this.count++;
    try{this.output.speak(call.text,{
      start:()=>{if(this.playing===call){call.started=true;this.output.log(call,'STARTED','Browser started speech');}},
      end:()=>{if(this.playing===call){this.output.log(call,'COMPLETED','Browser completed speech');this.playing=null;}},
      error:reason=>{if(this.playing===call){this.output.log(call,'ERROR',reason);this.playing=null;}},
    });}catch(error){this.output.log(call,'ERROR',String(error));this.playing=null;}
  }

  private drop(status:DeliveryStatus,reason:string){if(this.pending)this.output.log(this.pending,status,reason);this.pending=null;}
  clear(reason='Radio disabled'){
    this.drop('CANCELLED',reason);
    for(const call of this.notices)this.output.log(call,'CANCELLED',reason);
    this.notices=[];
    if(this.playing){const call=this.playing;this.playing=null;this.output.log(call,'CANCELLED',reason);this.output.cancel();}
  }
  get status(){return this.playing?'SPEAKING':this.pending||this.notices.length?'QUEUED':'READY';}
}
