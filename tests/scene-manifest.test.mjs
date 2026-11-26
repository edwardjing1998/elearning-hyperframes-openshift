import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneAction,validateSceneManifest,manifestToNarrationSteps} from '../src/recordings/scene-manifest.mjs';
import {validateNarrationSteps,makeActionPlan} from '../src/recordings/action-plan.mjs';

test('typeText manifest validates and becomes backward-compatible narration steps',()=>{
  const manifest={version:1,scenes:[{id:'sql',start_seconds:0,end_seconds:8,narration:{text:'Create a table'},actions:[{type:'typeText',text:'SELECT 1;',start_seconds:2,animation:{mode:'character',delay_ms:80}}]}]};
  const output=validateSceneManifest(manifest);
  const steps=manifestToNarrationSteps(output);
  assert.equal(steps[0].text,'Create a table');
  assert.equal(steps[0].actions[0].target,'capture-overlay');
  assert.equal(makeActionPlan(steps,8,[4]).scenes[0].actions[0].text,'SELECT 1;');
});
test('old narration-only steps still validate',()=>{
  const old=validateNarrationSteps([{start_seconds:0,end_seconds:3,text:'Welcome'}]);
  assert.deepEqual(old[0].actions,[]);
});
test('rejects unsupported action types, invalid animation and offsets',()=>{
  assert.throws(()=>validateSceneAction({type:'runShell',text:'echo hi'}),/Unsupported action/);
  assert.throws(()=>validateSceneAction({type:'typeText',text:'abc',animation:{mode:'word'}}),/mode/);
  assert.throws(()=>validateSceneAction({type:'typeText',text:'abc',animation:{delay_ms:0}}),/delay_ms/);
  assert.throws(()=>validateSceneManifest({version:1,scenes:[{start_seconds:0,end_seconds:2,narration:{text:'Test'},actions:[{type:'typeText',text:'abc',start_seconds:3}]}]}),/exceeds scene/);
});
