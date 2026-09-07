import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.js';
import { radioEnglishText } from './radioCopy.js';
import type { EngineerMessage } from './types.js';

const message:EngineerMessage={id:'pace-outlook-status-20',priority:'info',title:'RACE STATUS',action:'Hold target.',evidence:'',confidence:90,createdAt:1000,expiresAt:30000};
test('English balances vary without changing rival facts or the lap target',()=>{
  const state=initialState();state.player.position=1;state.strategy.targetLapTime='1:15.403';
  state.strategy.behind={name:'VERSTAPPEN',position:2,gap:9.6,rate:0,direction:'STABLE',laps:3,catchLaps:null,tyre:'SOFT',tyreAge:5,pit:false};
  const copies=[0,1,2].map(phraseVariant=>radioEnglishText({...message,phraseVariant},state));
  assert.equal(new Set(copies).size,3);
  for(const text of copies){assert.match(text,/Verstappen/);assert.match(text,/9\.6/);assert.match(text,/1:15\.4/);assert.ok(!text.includes('RACE STATUS'));}
});
test('contact copy stays concise and an existing event keeps its frozen text',()=>{
  const copies=[0,1,2].map(phraseVariant=>radioEnglishText({...message,id:'incident-collision-3',priority:'critical',phraseVariant}));
  assert.equal(new Set(copies).size,3);assert.ok(copies.every(text=>text.split(' ').length<=12));
  assert.equal(radioEnglishText({...message,radio:{es:'',en:copies[0]},phraseVariant:2}),copies[0]);
});
