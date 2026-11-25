import test from 'node:test';
import assert from 'node:assert/strict';
import { makeActionPlan, validateNarrationSteps } from '../src/recordings/action-plan.mjs';

test('WAV duration extends short footage and preserves non-overlapping scenes',()=>{
  const plan=makeActionPlan([
    {start_seconds:0,end_seconds:3,text:'Open container'},
    {start_seconds:3,end_seconds:6,text:'Upload sample'}
  ],6,[5,1]);
  assert.equal(plan.scenes[0].hold_seconds,2.5);
  assert.equal(plan.scenes[0].output_seconds,5.5);
  assert.equal(plan.scenes[1].output_seconds,3);
  assert.equal(plan.duration_seconds,8.5);
});
test('does not impose maximum 16-second video duration',()=>{
  const plan=makeActionPlan([{start_seconds:0,end_seconds:100,text:'Long screen recording'}],100,[180]);
  assert.equal(plan.duration_seconds,180.5);
});
test('rejects invalid overlaps, missing narration, and out-of-range marks',()=>{
  assert.throws(()=>makeActionPlan([{start_seconds:0,end_seconds:10,text:'a'},{start_seconds:5,end_seconds:20,text:'b'}],20,[4,4]),/Step 2/);
  assert.throws(()=>makeActionPlan([{start_seconds:0,end_seconds:25,text:'a'}],20,[1]),/Step 1/);
  assert.throws(()=>validateNarrationSteps([{start_seconds:0,end_seconds:1,text:''}]),/narration/);
});
