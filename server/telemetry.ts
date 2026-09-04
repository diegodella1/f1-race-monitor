import type { RaceState, TelemetryQuality } from './types.js';

type PacketObservation={count:number;lastSeen:number};
const packetLabels:Record<number,string>={1:'SESSION',2:'LAP',4:'PARTICIPANTS',6:'TELEMETRY',7:'STATUS',10:'DAMAGE'};
const required=[1,2,4,6,7];
const freshness:Record<number,number>={1:7000,2:1800,4:12000,6:1200,7:3500,10:5000};

export class TelemetryMonitor {
  private packets=new Map<number,PacketObservation>();
  private arrivals:number[]=[];
  private lastPacketAt=0;
  private validPackets=0;
  private invalidPackets=0;
  private source:string|null=null;

  reset(){this.packets.clear();this.arrivals=[];this.lastPacketAt=0;this.validPackets=0;this.invalidPackets=0;this.source=null;}

  observe(buffer:Buffer,valid:boolean,source:string,now=Date.now()){
    this.source=source;this.lastPacketAt=now;this.arrivals.push(now);this.arrivals=this.arrivals.filter(at=>now-at<=5000);
    if(valid)this.validPackets++;else this.invalidPackets++;
    if(buffer.length>6){const id=buffer.readUInt8(6),old=this.packets.get(id);this.packets.set(id,{count:(old?.count??0)+1,lastSeen:now});}
  }

  quality(state:RaceState,now=Date.now()):TelemetryQuality {
    if(state.status==='DEMO')return {score:100,confidence:'HIGH',packetsPerSecond:2,ageMs:0,validPackets:state.packetCount,invalidPackets:0,source:'demo',packets:[],missing:[],warnings:[],replayReady:true};
    const paused=state.status==='PAUSED'||state.context.gamePaused,ageMs=this.lastPacketAt?Math.max(0,now-this.lastPacketAt):null;
    const packets=Object.entries(packetLabels).map(([rawId,label])=>{const id=Number(rawId),seen=this.packets.get(id),packetAge=seen?Math.max(0,now-seen.lastSeen):null;return {id,label,count:seen?.count??0,ageMs:packetAge,healthy:!!seen&&(paused||packetAge!<=freshness[id])};});
    const missing=required.filter(id=>!this.packets.has(id));
    let score=100-missing.length*16;
    const staleRequired=packets.filter(packet=>required.includes(packet.id)&&packet.count>0&&!packet.healthy);
    score-=staleRequired.length*12;
    const total=this.validPackets+this.invalidPackets,invalidRate=total?this.invalidPackets/total:0;
    if(invalidRate>.05)score-=Math.min(20,Math.round(invalidRate*100));
    if(!state.sessionUid||state.context.category==='UNKNOWN')score=Math.min(score,35);
    if(ageMs!==null&&!paused&&ageMs>2500)score-=25;
    score=Math.max(0,Math.min(100,score));
    if(this.lastPacketAt&&score===0)score=5;
    const warnings:string[]=[];
    if(missing.length)warnings.push('Missing '+missing.map(id=>packetLabels[id]??`PACKET ${id}`).join(', '));
    if(staleRequired.length)warnings.push('Stale '+staleRequired.map(packet=>packet.label).join(', '));
    if(invalidRate>.05)warnings.push(Math.round(invalidRate*100)+'% invalid packets');
    if(paused)warnings.push('Game paused · last reliable state retained');
    if(!this.lastPacketAt)warnings.push('Waiting for telemetry');
    const confidence=score>=85?'HIGH':score>=60?'MEDIUM':score>0?'LOW':'NONE';
    return {score,confidence,packetsPerSecond:Math.round(this.arrivals.length/5*10)/10,ageMs,validPackets:this.validPackets,invalidPackets:this.invalidPackets,source:this.source,packets,missing,warnings,replayReady:!!state.sessionUid&&!!state.sessionLinkId&&state.packetCount>=20};
  }
}
