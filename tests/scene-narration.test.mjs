import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSequenceDiagram } from '../src/loaders/diagram-loader.mjs';
import { buildNarrationScenes, makeSceneTiming, injectSceneTiming } from '../src/services/scene-narration.mjs';
import { addSceneAudioClips, compositionDuration } from '../src/services/audio-composition.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = {reviewDir:path.join(root,'composition/documents/reviews'), diagramDir:path.join(root,'composition/documents/diagrams')};
const templates = {
 'code-review':'index.html', 'markdown-review':'markdown-review.html',
 'kafka-sequence':'kafka-sequence.html', 'sequence-diagram':'sequence-diagram.html'
};
for (const [template, filename] of Object.entries(templates)) {
 test(`${template}: scene count equals visual steps and clips start together`,()=>{
   const scenes=buildNarrationScenes({template,...dirs});
   assert.equal(scenes.length, template==='markdown-review'?5:template==='sequence-diagram'?parseSequenceDiagram(fs.readFileSync(path.join(dirs.diagramDir,'spring-boot-sequence.md'),'utf8')).messages.length:4);
   const timings=makeSceneTiming(scenes.map((_,i)=>3+i));
   assert.equal(timings.scenes[0].start,0);
   timings.scenes.forEach((scene,i)=>{
     if(i) assert.ok(Math.abs(scene.start-timings.scenes[i-1].end-0.65)<0.002);
   });
   let html=fs.readFileSync(path.join(root,'composition/templates',filename),'utf8');
   html=injectSceneTiming(html,timings);
   const clips=scenes.map((_,i)=>({file:`./assets/narration-${String(i+1).padStart(3,'0')}.wav`,duration:timings.scenes[i].duration}));
   html=addSceneAudioClips(html,clips,timings);
   assert.equal((html.match(/<audio /g)||[]).length,scenes.length);
   assert.equal(compositionDuration(html),Math.max(compositionDuration(fs.readFileSync(path.join(root,'composition/templates',filename),'utf8')),timings.duration));
   for(const s of timings.scenes) assert.ok(html.includes(`data-start="${s.start.toFixed(3)}"`));
   assert.ok(html.includes('window.__sceneTiming='));
 });
}
test('timing accepts a long narration without a 16s limit',()=>{
  const timing=makeSceneTiming([15.94,44.75,81.2]);
  assert.ok(timing.duration>140);
  assert.equal(timing.scenes[1].start,16.59);
});
test('empty and invalid duration vectors are rejected',()=>{
  assert.throws(()=>makeSceneTiming([]));
  assert.throws(()=>makeSceneTiming([1,-2]));
});
