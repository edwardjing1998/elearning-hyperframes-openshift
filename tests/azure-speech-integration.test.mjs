import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNarrationRequest, makeNarration } from '../src/services/narration-builder.mjs';
import { compositionDuration, addNarrationAudio } from '../src/services/audio-composition.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reviewDir=path.join(root,'composition/documents/reviews');
const diagramDir=path.join(root,'composition/documents/diagrams');
test('narration is opt-in so legacy requests remain unchanged',()=>assert.deepEqual(validateNarrationRequest(undefined),{enabled:false}));
test('reject invalid narration',()=>assert.throws(()=>validateNarrationRequest({enabled:true,text:'x'.repeat(601)})));
test('review narration derived from actual Markdown',()=>{
 const result=makeNarration({template:'markdown-review',documentId:'java-code-review',reviewDir,diagramDir});
 assert.match(result,/method contract/i);
});
test('all four template compositions can accept WAV without losing root',async()=>{
 const fs=await import('node:fs');
 for (const filename of ['index.html','kafka-sequence.html','markdown-review.html','sequence-diagram.html']) {
 const html=fs.readFileSync(path.join(root,'composition/templates',filename),'utf8');
 const duration=compositionDuration(html);
 const result=addNarrationAudio(html,2);
 assert.match(result,/assets\/narration.wav/);
 assert.equal((result.match(/data-composition-id=/g)||[]).length,1);
 const longer=addNarrationAudio(html,duration+4);
 assert.equal(compositionDuration(longer),duration+6);
 assert.match(longer,/data-duration=\"[0-9.]+\" data-track-index=\"10\"/);
 }
});
