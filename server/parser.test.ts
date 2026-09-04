import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { packetEventCode,parsePacket } from './parser.js';

function packet(id:number,size:number,uid=123n){const buffer=Buffer.alloc(size);buffer.writeUInt16LE(2026,0);buffer.writeUInt8(25,2);buffer.writeUInt8(1,3);buffer.writeUInt8(24,4);buffer.writeUInt8(1,5);buffer.writeUInt8(id,6);buffer.writeBigUInt64LE(uid,7);buffer.writeFloatLE(10,15);buffer.writeUInt8(1,27);buffer.writeUInt8(255,28);return buffer;}

test('session packet resets volatile state and exposes phase, forecast and pause data',()=>{
  const old=initialState();old.status='CONNECTED';old.sessionUid='123';old.sessionLinkId=7;old.sessionType='Qualifying 3';old.context.category='QUALIFYING';old.flag='CHEQUERED';old.alerts=[{id:'old',level:'info',title:'Old',detail:'Old phase',timestamp:1}];
  const buffer=packet(1,926),base=29;buffer.writeUInt8(1,base);buffer.writeInt8(36,base+1);buffer.writeInt8(24,base+2);buffer.writeUInt8(19,base+3);buffer.writeUInt16LE(5793,base+4);buffer.writeUInt8(15,base+6);buffer.writeInt8(11,base+7);buffer.writeUInt16LE(3000,base+9);buffer.writeUInt8(1,base+14);buffer.writeUInt8(1,base+126);buffer.writeUInt8(15,base+127);buffer.writeUInt8(5,base+128);buffer.writeUInt8(3,base+129);buffer.writeInt8(30,base+130);buffer.writeInt8(22,base+132);buffer.writeUInt8(70,base+134);buffer.writeUInt32LE(8,base+649);buffer.writeUInt8(8,base+653);buffer.writeUInt8(12,base+654);
  const result=parsePacket(buffer,old)!;
  assert.equal(result.sessionType,'Race');assert.equal(result.sessionLinkId,8);assert.equal(result.status,'PAUSED');assert.equal(result.flag,'GREEN');assert.deepEqual(result.alerts,[]);assert.equal(result.context.trackLength,5793);assert.equal(result.context.weatherForecast[0].minutes,5);assert.equal(result.context.weatherForecast[0].rainPercentage,70);
});

test('lap packet parses distance and keeps the last reliable impossible interval',()=>{
  const state=initialState();state.status='CONNECTED';state.sessionUid='123';state.sessionLinkId=8;state.sessionType='Race';state.context.category='RACE';state.totalLaps=19;state.player.position=2;state.drivers=[{vehicleIndex:0,position:1,name:'LEADER',team:'Ferrari',lap:2,sector:1,gap:'LEADER',interval:'—',tyre:'HARD',tyreAge:2,pit:false},{vehicleIndex:1,position:2,name:'PLAYER',team:'Alpine',lap:2,sector:1,gap:'+11.900',interval:'+0.500',tyre:'MEDIUM',tyreAge:2,pit:false}];
  const buffer=packet(2,1399),base=29,size=57;for(let i=0;i<2;i++){const o=base+i*size;buffer.writeUInt8(i+1,o+32);buffer.writeUInt8(3,o+33);buffer.writeUInt8(1,o+36);buffer.writeUInt8(4,o+44);}const me=base+size;buffer.writeUInt32LE(91234,me);buffer.writeUInt16LE(65519,me+14);buffer.writeUInt16LE(12095,me+17);buffer.writeFloatLE(2345.5,me+20);
  const result=parsePacket(buffer,state)!;
  assert.equal(result.player.lapDistance,2345.5);assert.equal(result.drivers[1].gap,'+12.095');assert.equal(result.drivers[1].interval,'+0.500');assert.equal(result.drivers[1].intervalStale,true);
});

test('car status packet parses fuel projection',()=>{const state=initialState();state.sessionUid='123';const buffer=packet(7,1445),o=29+59;buffer.writeFloatLE(14.9,o+5);buffer.writeFloatLE(-0.27,o+13);buffer.writeUInt8(17,o+26);buffer.writeFloatLE(2000000,o+37);const result=parsePacket(buffer,state)!;assert.equal(result.player.tyre,'MEDIUM');assert.ok(Math.abs(result.player.fuelRemainingLaps+.27)<.001);assert.equal(result.player.ers,50);});

test('event code identifies session end and flashback packets',()=>{const end=packet(3,45);end.write('SEND',29,'ascii');const flashback=packet(3,45);flashback.write('FLBK',29,'ascii');assert.equal(packetEventCode(end),'SEND');assert.equal(packetEventCode(flashback),'FLBK');});

test('event packets expose final lifecycle and normalized nearby incidents',()=>{
  const state=initialState();state.status='CONNECTED';state.sessionUid='123';state.sessionLinkId=8;state.sessionType='Race';state.context.category='RACE';state.context.lifecycle='ACTIVE';state.lap=8;state.drivers=[{vehicleIndex:0,position:1,name:'NORRIS',team:'McLaren',lap:8,sector:1,gap:'LEADER',interval:'—',tyre:'MEDIUM',tyreAge:8,pit:false},{vehicleIndex:1,position:2,name:'PLAYER',team:'Ferrari',lap:8,sector:1,gap:'+1.000',interval:'+1.000',tyre:'SOFT',tyreAge:8,pit:false}];
  const collision=packet(3,45);collision.write('COLL',29,'ascii');collision.writeUInt8(0,33);collision.writeUInt8(1,34);
  const afterCollision=parsePacket(collision,state)!;assert.equal(afterCollision.context.incidents[0].kind,'COLLISION');assert.match(afterCollision.alerts[0].detail,/NORRIS/);
  const end=packet(3,45);end.write('SEND',29,'ascii');const finished=parsePacket(end,afterCollision)!;assert.equal(finished.context.lifecycle,'FINISHED');assert.equal(finished.flag,'CHEQUERED');
});
