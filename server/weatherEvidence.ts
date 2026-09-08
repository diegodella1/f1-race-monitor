import type { RaceState } from './types.js';
import type { TyreFamily, WeatherPhase } from './weatherTypes.js';

export const tyreFamily=(tyre:string):TyreFamily|null=>['SOFT','MEDIUM','HARD'].includes(tyre)?'SLICKS':tyre==='INTER'||tyre==='WET'?tyre:null;
export const median=(values:number[])=>{
  if(!values.length)return null;
  const ordered=[...values].sort((a,b)=>a-b),i=Math.floor(ordered.length/2);
  return ordered.length%2?ordered[i]:(ordered[i-1]+ordered[i])/2;
};
const lapSeconds=(time?:string)=>{
  const match=/^(\d+):(\d+(?:\.\d+)?)$/.exec(time??'');
  return match&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):0;
};
type Lap={lap:number;end:number;seconds:number;family:TyreFamily;phase:WeatherPhase;stint:number};
type Progress={lap:number;family:TyreFamily|null;compound:string;age:number;phase:WeatherPhase;invalid:boolean;complete:boolean;stint:number;startedAt:number;warmup:number;pit:boolean;lastSeen:number;history:Lap[]};

export class WeatherPaceEvidence {
  private cars=new Map<number,Progress>();
  private playerIndex:number|null=null;

  reset(){this.cars.clear();this.playerIndex=null;}

  observe(state:RaceState,phase:WeatherPhase,now:number){
    const player=state.player.vehicleIndex??state.drivers.find(driver=>driver.position===state.player.position)?.vehicleIndex;
    if(player===undefined)return;
    this.playerIndex=player;
    for(const driver of state.drivers){
      if(driver.vehicleIndex===undefined)continue;
      const mine=driver.vehicleIndex===player;
      const family=tyreFamily(mine?state.player.tyre:driver.tyre),lap=mine?state.lap:driver.lap;
      const compound=mine?state.player.tyre:driver.tyre,age=mine?state.player.tyreAge:driver.tyreAge;
      const pit=mine?state.player.pit:driver.pit;
      const invalid=(mine?state.context.lapInvalid:driver.lapInvalid)!==false;
      const unsafe=state.flag!=='GREEN'||state.safetyCar!=='NONE'||phase==='UNKNOWN';
      const old=this.cars.get(driver.vehicleIndex);
      const progress=old??{lap,family,compound,age,phase,invalid:true,complete:false,stint:0,startedAt:now,warmup:0,pit,lastSeen:state.sessionTime,history:[]};
      const changedCompound=compound!==progress.compound||age<progress.age;
      const gap=state.sessionTime-progress.lastSeen>5;
      if(lap>progress.lap){
        const seconds=lapSeconds(mine?state.player.lastLap:driver.lastLap);
        const usable=progress.complete&&!progress.invalid&&!gap&&!unsafe&&!changedCompound&&progress.phase===phase&&family===progress.family&&seconds>=30&&seconds<=300;
        if(usable&&progress.family){
          if(progress.warmup>0)progress.warmup--;
          else progress.history.push({lap:progress.lap,end:state.sessionTime,seconds,family:progress.family,phase:progress.phase,stint:progress.stint});
        }
        progress.history=progress.history.slice(-60);
        progress.complete=lap===progress.lap+1;progress.lap=lap;progress.startedAt=now;progress.invalid=false;progress.phase=phase;
      }
      if(changedCompound||(!progress.pit&&pit)){
        progress.stint++;progress.warmup=1;progress.invalid=true;progress.family=family;
      }
      const contact=(state.context.incidents??[]).some(event=>event.kind==='COLLISION'&&event.at>=progress.startedAt&&event.vehicleIndices.includes(driver.vehicleIndex!));
      progress.invalid||=invalid||unsafe||pit||gap||contact||phase!==progress.phase;
      progress.lastSeen=state.sessionTime;progress.pit=pit;progress.compound=compound;progress.age=age;
      this.cars.set(driver.vehicleIndex,progress);
    }
  }

  advantage(target:TyreFamily,phase:WeatherPhase){
    const own=this.playerIndex===null?undefined:this.cars.get(this.playerIndex);
    const gains:number[]=[],ownTimes:number[]=[];
    if(!own?.family)return {rivals:0,gainSeconds:null,lapSeconds:null};
    for(const [index,rival] of this.cars){
      if(index===this.playerIndex||rival.family!==target||rival.pit)continue;
      const pairs=rival.history.flatMap(lap=>{
        const playerLap=own.history.find(player=>player.lap===lap.lap&&player.stint===own.stint&&player.family===own.family&&player.phase===lap.phase&&Math.abs(player.end-lap.end)<=30);
        return playerLap?[{lap,own:playerLap,delta:lap.seconds-playerLap.seconds}]:[];
      });
      const after=pairs.filter(pair=>pair.lap.stint===rival.stint&&pair.lap.family===target&&pair.lap.phase===phase).slice(-2);
      if(after.length<2||after[1].lap.lap!==after[0].lap.lap+1||after[1].lap.lap<rival.lap-2||after[1].own.lap<own.lap-2)continue;
      const before=pairs.filter(pair=>pair.lap.stint<rival.stint&&pair.lap.family===own.family&&pair.lap.end<after[0].lap.end).slice(-3);
      if(before.length<3||before[2].lap.lap-before[0].lap.lap!==2||before[0].lap.stint!==before[2].lap.stint)continue;
      const gain=median(before.map(pair=>pair.delta))!-median(after.map(pair=>pair.delta))!;
      const ownLap=median(after.map(pair=>pair.own.seconds))!;
      if(gain>Math.max(1,ownLap*.01)){gains.push(gain);ownTimes.push(ownLap);}
    }
    return {rivals:gains.length,gainSeconds:median(gains),lapSeconds:median(ownTimes)};
  }
}
