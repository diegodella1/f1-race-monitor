import { createHash } from 'node:crypto';
export const packetSizes:Record<number,number>={1:926,2:1399,3:45,4:1470,6:1448,7:1445,10:1133,11:1460};
export function packetSupport(buffer:Buffer):'valid'|'invalid'|'unsupported'{
  if(buffer.length<29)return 'invalid';
  if(buffer.readUInt16LE(0)!==2026||packetSizes[buffer[6]]===undefined)return 'unsupported';
  if(buffer.length!==packetSizes[buffer[6]]||buffer[5]!==1||buffer[27]>=24)return 'invalid';
  if(!Number.isFinite(buffer.readFloatLE(15)))return 'invalid';
  const id=buffer[6],player=buffer[27],base=29;
  const floats=id===6?[base+player*59+2,base+player*59+6,base+player*59+10]:id===7?[base+player*59+5,base+player*59+13,base+player*59+37]:id===2?[base+player*57+20]:id===10?[0,4,8,12].map(x=>base+player*46+x):[];
  if(floats.some(offset=>!Number.isFinite(buffer.readFloatLE(offset))))return 'invalid';
  if(id===3&&buffer.subarray(29,33).toString()==='FLBK'&&!Number.isFinite(buffer.readFloatLE(37)))return 'invalid';
  if(id===4&&buffer[29]>24)return 'invalid';
  return 'valid';
}

export class PacketGate {
  private source='';
  private session='';
  private frames=new Map<number,number>();
  private eventKeys=new Set<string>();
  private flashbackBarrier=0;
  constructor(private configuredSource=''){}
  reset(){this.source='';this.session='';this.frames.clear();this.eventKeys.clear();this.flashbackBarrier=0;}
  get lockedSource(){return this.configuredSource||this.source;}
  accept(buffer:Buffer,address:string){
    if(packetSupport(buffer)!=='valid')return false;
    if((this.configuredSource||this.source)&&(this.configuredSource||this.source)!==address)return false;
    this.source=address;
    const session=buffer.readBigUInt64LE(7).toString(),id=buffer[6],frame=buffer.readUInt32LE(19);
    if(this.session!==session){this.session=session;this.frames.clear();this.eventKeys.clear();this.flashbackBarrier=0;}
    const overall=buffer.readUInt32LE(23);
    if(overall>0&&this.flashbackBarrier>0&&((overall-this.flashbackBarrier)>>>0)>=0x80000000)return false;
    if(id===3){
      const key=createHash('sha256').update(buffer).digest('hex');if(this.eventKeys.has(key))return false;
      this.eventKeys.add(key);if(this.eventKeys.size>4096)this.eventKeys.delete(this.eventKeys.values().next().value!);
      if(buffer.subarray(29,33).toString()==='FLBK'){this.frames.clear();this.flashbackBarrier=overall;}
      return true;
    }
    const previous=this.frames.get(id);
    if(previous!==undefined&&((frame-previous)>>>0)>=0x80000000)return false;
    if(previous===frame)return false;
    this.frames.set(id,frame);return true;
  }
}
