import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEnglishVoice } from './englishVoice';
test('English remains selected with Spanish installed and prefers a local voice',()=>{
  const voices=[{lang:'es-AR',voiceURI:'old-spanish',localService:true},{lang:'en-US',voiceURI:'remote',localService:false},{lang:'en-GB',voiceURI:'local',localService:true}];
  assert.equal(selectEnglishVoice(voices,'old-spanish')?.voiceURI,'local');
  assert.equal(selectEnglishVoice(voices,'remote')?.voiceURI,'local');
  assert.equal(selectEnglishVoice(voices.slice(0,1),'old-spanish'),null);
});
