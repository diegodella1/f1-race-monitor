import { messageIsCurrent } from '../server/messagePolicy';
import type { EngineerMessage, RaceState } from './types';

export type DeliveryStatus='SELECTED'|'QUEUED'|'DEFERRED'|'SUBMITTED'|'STARTED'|'COMPLETED'|'CANCELLED'|'EXPIRED'|'ERROR';
export type Delivery={eventId:string;deviceId:string;sessionUid:string;sessionLinkId:number;sessionType:string;messageId:string;status:DeliveryStatus;text:string;reason:string;category:string;lap:number;clientAt:number};
type Call={message:EngineerMessage;state:RaceState;text:string;key:string;queuedAt:number;safeSince:number|null;deferredReason?:string;submittedAt?:number;started?:boolean};
type Output={speak:(text:string,callbacks:{start:()=>void;end:()=>void;error:(reason:string)=>void})=>void;cancel:()=>void;log:(call:Call,status:DeliveryStatus,reason:string)=>void};
const rank={critical:4,action:3,opportunity:2,info:1};
export const messageKey=(m:EngineerMessage,s:RaceState)=>m.eventId??`${s.sessionUid}:${s.sessionLinkId}:${s.sessionType}:${m.id}:${m.createdAt}`;
const exceptional=(m:EngineerMessage)=>m.priority==='critical'||['final-lap','race-finished','race-retired','strategy-box-mandatory','strategy-box-latest','strategy-box'].includes(m.id)||m.context?.damageBefore!==undefined;

export class RadioQueue {
  private pending:Call|null=null;
  private playing:Call|null=null;
  private seen=new Set<string>();
  private lastAt=-Infinity;
  private lap=-1;
  private count=0;
  private session='';
  constructor(private output:Output){}

  update(message:EngineerMessage|null,state:RaceState,text:string,now:number){
    const playing=this.playing;
    if(playing&&playing.submittedAt!==undefined&&now-playing.submittedAt>(playing.started?45000:10000)){
      this.playing=null;this.output.log(playing,'ERROR',playing.started?'Speech completion timed out':'Speech did not start within 10 seconds');this.output.cancel();
    }
    const session=`${state.sessionUid}:${state.sessionLinkId}:${state.sessionType}`;
    if(this.session!==session||state.lap<this.lap){this.clear('Session changed');this.seen.clear();this.count=0;this.lastAt=-Infinity;}
    this.session=session;
    if(this.lap!==state.lap){this.lap=state.lap;this.count=0;}
    const terminal=['FINISHED','RETIRED'].includes(state.context.lifecycle);
    if((!['CONNECTED','DEMO'].includes(state.status)&&!terminal)||(state.context.gamePaused&&!terminal)){this.clear('Paused or disconnected');return;}
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
          if(message.priority==='critical'&&this.playing){const playing=this.playing;this.playing=null;this.output.log(playing,'CANCELLED','Interrupted by critical event');this.output.cancel();}
        }
      }
    }
    this.deliver(state,now);
  }

  private valid(call:Call,state:RaceState,now:number){
    return messageIsCurrent(call.message,state,now);
  }

  private deliver(state:RaceState,now:number){
    const call=this.pending;if(!call)return;
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
    this.pending=null;this.playing=call;
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
    if(this.playing){const call=this.playing;this.playing=null;this.output.log(call,'CANCELLED',reason);this.output.cancel();}
  }
  get status(){return this.playing?'SPEAKING':this.pending?'QUEUED':'READY';}
}
