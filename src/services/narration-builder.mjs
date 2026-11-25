// Generate a concise optional narration from the same resolved document used for visuals.
import { parseReviewMarkdown } from '../loaders/markdown-loader.mjs';
import { parseSequenceDiagram } from '../loaders/diagram-loader.mjs';

export const MAX_NARRATION_LENGTH = 600;
export function makeNarration({type,markdown}) {
  if (type === 'static') return 'Review this Java method. The repository returns an optional user. The method may return null. Check whether all callers handle an absent user safely.';
  if (type === 'review') {
    const data=parseReviewMarkdown(markdown);
    const phrases=data.findings.map(f=>f.title.replace(/[.!?]+$/,'')).slice(0,6);
    return `Code review of ${data.sourceFile}. ${phrases.join('. ')}.`.slice(0,MAX_NARRATION_LENGTH);
  }
  if (type === 'kafka'||type === 'sequence') {
    const data=parseSequenceDiagram(markdown);
    const labels=data.messages.slice(0,5).map(m=>m.label.replace(/^[0-9]+[. ]+/,''));
    return `Sequence diagram walkthrough. ${labels.join('. ')}.`.slice(0,MAX_NARRATION_LENGTH);
  }
  throw new Error(`Unsupported narration type: ${type}`);
}
export function validateNarrationRequest(value) {
  if (value === undefined) return {enabled:false};
  if (!value||typeof value!=='object'||Array.isArray(value)) throw new Error('narration must be an object');
  if (typeof value.enabled!=='boolean') throw new Error('narration.enabled must be a boolean');
  if (!value.enabled) return {enabled:false};
  if (value.provider!==undefined&&value.provider!=='azure') throw new Error('Only Azure narration is supported');
  if (value.text!==undefined&&(typeof value.text!=='string'||!value.text.trim()||value.text.length>MAX_NARRATION_LENGTH)) throw new Error(`narration.text must be a non-empty string up to ${MAX_NARRATION_LENGTH} chars`);
  return {enabled:true,text:value.text?.trim()};
}
