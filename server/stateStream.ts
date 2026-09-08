/** One frame in flight per client. Intermediate telemetry never accumulates. */
export class LatestStateStream<T> {
  private latest:T|undefined;
  private revision=0;
  private sentRevision=-1;
  private busy=false;
  private lastSent=-Infinity;
  private active=true;
  private generation=0;
  constructor(private send:(value:T,ack:()=>void)=>void,private intervalMs=100,private onTimeout=()=>{}){}
  update(value:T){this.latest=value;this.revision++;}
  flush(now:number){
    if(this.busy&&now-this.lastSent>=2000){this.busy=false;this.generation++;this.onTimeout();}
    if(!this.active||this.busy||this.latest===undefined||this.sentRevision===this.revision||now-this.lastSent<this.intervalMs)return;
    this.busy=true;this.lastSent=now;this.sentRevision=this.revision;
    const generation=++this.generation;let acknowledged=false;
    this.send(this.latest,()=>{if(!acknowledged&&generation===this.generation){acknowledged=true;this.busy=false;}});
  }
  close(){this.active=false;this.latest=undefined;}
}
