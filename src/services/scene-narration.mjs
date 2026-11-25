/** Scene-aligned narration. The same lesson data supplies both spoken text and visual steps. */
import fs from 'node:fs';
import path from 'node:path';
import { parseReviewMarkdown } from '../loaders/markdown-loader.mjs';
import { parseSequenceDiagram } from '../loaders/diagram-loader.mjs';

export const SCENE_GAP_SECONDS = 0.65;
export const TAIL_SECONDS = 1;
const MAX_SCENE_TEXT = 1200;

export function buildNarrationScenes({template, documentId, reviewDir, diagramDir}) {
  let texts;
  if (template === 'markdown-review') {
    if ((documentId || 'java-code-review') !== 'java-code-review') throw new Error('Unsupported review document');
    const data = parseReviewMarkdown(fs.readFileSync(path.join(reviewDir, 'java-code-review.md'), 'utf8'));
    texts = data.findings.map(f => `${f.title}. ${f.description}`);
    texts.push(data.diagramMarkdown
      ? 'Review the related call sequence and check how the service and repository exchange values.'
      : 'Code review complete. Verify each finding against the surrounding code and the application contract.');
  } else if (template === 'sequence-diagram' || template === 'kafka-sequence') {
    const doc = template === 'kafka-sequence' ? 'kafka-sequence' : (documentId || 'spring-boot-sequence');
    if (!['kafka-sequence', 'spring-boot-sequence'].includes(doc)) throw new Error('Unsupported diagram document');
    const parsed = parseSequenceDiagram(fs.readFileSync(path.join(diagramDir, `${doc}.md`), 'utf8'));
    if (template === 'kafka-sequence') {
      // This template has four visible states: prepare, publish, consume, complete.
      texts = [
        'The producer prepares an event that represents a business change.',
        `The producer publishes the event. ${parsed.messages[0].label}.`,
        `The consumer receives and processes the event. ${parsed.messages[1].label}.`,
        `The flow finishes. ${parsed.messages[2].label}. Acknowledgment behavior depends on the consumer design.`
      ];
    } else {
      texts = parsed.messages.map((m, i) => `Step ${i + 1}. ${m.label}.`);
    }
  } else if (template === 'code-review') {
    texts = [
      'Start with the method signature. Understand what the callers expect.',
      'The repository find by ID method returns an Optional user.',
      'The method can return null. This is a potential risk that requires review.',
      'Inspect callers and choose a clear contract for absent users.'
    ];
  } else {
    throw new Error('Unsupported narration template');
  }
  return texts.map((text, i) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_SCENE_TEXT) throw new Error(`Invalid narration in scene ${i + 1}`);
    return { id: `scene-${i + 1}`, text: trimmed };
  });
}

export function makeSceneTiming(durations, {gapSeconds = SCENE_GAP_SECONDS, tailSeconds = TAIL_SECONDS, minimumDuration = 0} = {}) {
  if (!Array.isArray(durations) || durations.length === 0 || durations.some(d => !Number.isFinite(d) || d <= 0)) throw new Error('Scene durations must be positive');
  if (![gapSeconds,tailSeconds,minimumDuration].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid timing options');
  const scenes=[];
  let cursor=0;
  durations.forEach((duration, i) => {
    const start=Number(cursor.toFixed(3));
    scenes.push({index:i,start,duration:Number(duration.toFixed(3)),end:Number((cursor+duration).toFixed(3))});
    cursor += duration+gapSeconds;
  });
  const finalEnd=scenes.at(-1).end;
  return { scenes, duration:Number(Math.max(minimumDuration, finalEnd+tailSeconds).toFixed(3)) };
}

export function injectSceneTiming(html, timing) {
  if (!html.includes('</head>')) throw new Error('Template head closing tag missing');
  if (!timing || !Array.isArray(timing.scenes)) throw new Error('Invalid scene timing');
  return html.replace('</head>', `<script>window.__sceneTiming=${JSON.stringify(timing).replace(/</g, '\\u003c')};</script></head>`);
}
