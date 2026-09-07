/** One frame in flight per client. Intermediate telemetry never accumulates. */
export class LatestStateStream<T> {
  private latest:T|undefined;
  private revision=0;
  private sentRevision=-1;
  private busy=false;
  private lastSent=-Infinity;
  private active=true;
  constructor(private send:(value:T,ack:()=>void)=>void,private intervalMs=100){}
  update(value:T){this.latest=value;this.revision++;}
  flush(now:number){
    if(!this.active||this.busy||this.latest===undefined||this.sentRevision===this.revision||now-this.lastSent<this.intervalMs)return;
    this.busy=true;this.lastSent=now;this.sentRevision=this.revision;
    let acknowledged=false;
    this.send(this.latest,()=>{if(!acknowledged){acknowledged=true;this.busy=false;}});
  }
  close(){this.active=false;this.latest=undefined;}
}
