import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReviewMarkdown } from '../src/loaders/markdown-loader.mjs';
import { parseSequenceDiagram,compileKafkaComposition } from '../src/loaders/diagram-loader.mjs';
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('review extracts code, findings and optional Mermaid',()=>{
 const r=parseReviewMarkdown(file('../composition/documents/reviews/java-code-review.md'));
 assert.equal(r.language,'java');assert.equal(r.lines.length,4);assert.equal(r.findings.length,4);assert.ok(r.diagramMarkdown);
});
test('generic sequence accepts five participants and eight messages',()=>{
 const r=parseSequenceDiagram(file('../composition/documents/diagrams/spring-boot-sequence.md'));
 assert.equal(r.participants.length,5);assert.equal(r.messages.length,8);
});
test('legacy Kafka compiler still works',()=>{
 const result=compileKafkaComposition('Hi {{PARTICIPANT_1}} and {{MESSAGE_1}}',file('../composition/documents/diagrams/kafka-sequence.md'));
 assert.match(result,/Order Service/);assert.match(result,/Publish OrderCreated/);
});
test('unsafe HTML is kept as content',()=>{
 const r=parseReviewMarkdown('# Hi\n\n```java\nString x = "<script>";\n```\n\n### Finding [lines: 1]\nReview <script> tags.');
 assert.match(r.lines[0],/<script>/);
});
