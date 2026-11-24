// Generate short, template-specific narration from the same trusted Markdown inputs.
import fs from 'node:fs';
import path from 'node:path';
import { parseReviewMarkdown } from '../loaders/markdown-loader.mjs';
import { parseSequenceDiagram } from '../loaders/diagram-loader.mjs';

export const MAX_NARRATION_LENGTH = 600;
export function makeNarration({template,documentId,reviewDir,diagramDir}) {
  if (template === 'code-review') {
    return 'Review this Java method. The repository returns an optional user. The method may return null. Check whether all callers handle an absent user safely.';
  }
  if (template === 'markdown-review') {
    if ((documentId || 'java-code-review') !== 'java-code-review') throw new Error('Unsupported review document');
    const data = parseReviewMarkdown(fs.readFileSync(path.join(reviewDir,'java-code-review.md'),'utf8'));
    const phrases = data.findings.map(f=>f.title.replace(/[.!?]+$/,'')).slice(0,6);
    return `Code review of ${data.sourceFile}. ${phrases.join('. ')}.`.slice(0,MAX_NARRATION_LENGTH);
  }
  if (template === 'kafka-sequence' || template === 'sequence-diagram') {
    const doc = template==='kafka-sequence' ? 'kafka-sequence' : (documentId || 'spring-boot-sequence');
    const filename = ({'kafka-sequence':'kafka-sequence.md','spring-boot-sequence':'spring-boot-sequence.md'})[doc];
    if (!filename) throw new Error('Unsupported diagram document');
    const data = parseSequenceDiagram(fs.readFileSync(path.join(diagramDir,filename),'utf8'));
    const labels = data.messages.slice(0,5).map(m=>m.label.replace(/^[0-9]+[. ]+/,''));
    return `Sequence diagram walkthrough. ${labels.join('. ')}.`.slice(0,MAX_NARRATION_LENGTH);
  }
  throw new Error('Unsupported template');
}
export function validateNarrationRequest(value) {
  if (value === undefined) return {enabled:false}; // preserves original behavior
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('narration must be an object');
  if (typeof value.enabled !== 'boolean') throw new Error('narration.enabled must be a boolean');
  if (!value.enabled) return {enabled:false};
  if (value.provider !== undefined && value.provider !== 'azure') throw new Error('Only Azure narration is supported');
  if (value.text !== undefined && (typeof value.text !== 'string' || !value.text.trim() || value.text.length>MAX_NARRATION_LENGTH)) throw new Error(`narration.text must be a non-empty string up to ${MAX_NARRATION_LENGTH} chars`);
  return {enabled:true,text:value.text?.trim()};
}
