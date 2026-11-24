// Shared, bounded Markdown reader for source-code reviews and Mermaid sequence diagrams.
// Never executes Markdown or treats it as HTML.
import fs from 'node:fs';
export function extractFences(markdown) {
  const fences=[];
  const re=/^```([A-Za-z0-9_-]*)\s*\r?\n([\s\S]*?)^```\s*$/gm;
  let m;
  while ((m=re.exec(markdown))) fences.push({language:m[1].toLowerCase(),content:m[2].replace(/\r/g,''),start:m.index,end:re.lastIndex});
  return fences;
}
export function parseReviewMarkdown(markdown) {
  if (typeof markdown !== 'string' || markdown.length > 200000) throw new Error('Markdown too large');
  const fences=extractFences(markdown);
  const code=fences.find(f=>['java','python','javascript','typescript','js','ts','sql','text'].includes(f.language));
  if (!code) throw new Error('Expected a fenced source-code block (java/python/js/ts/sql/text)');
  const title=(markdown.match(/^#\s+(.+)$/m)?.[1]||'Source Code Review').trim().slice(0,120);
  const sourceFile=(markdown.match(/^##\s+Source File\s*\r?\n\s*`([^`]+)`/mi)?.[1]||'Source file').trim().slice(0,180);
  const lines=code.content.replace(/\n$/,'').split('\n');
  if (lines.length>20 || lines.some(l=>l.length>160)) throw new Error('Demo supports <=20 code lines and <=160 characters per line');
  const raw=markdown.replace(/```[\s\S]*?```/g,'');
  const findings=[];
  const re=/^###\s+(.+?)\s+\[lines?:\s*(\d+)(?:\s*-\s*(\d+))?\]\s*\r?\n([\s\S]*?)(?=^###\s|^##\s|$\s*$)/gm;
  let m;
  while((m=re.exec(raw))) {
    const start=Number(m[2]),end=Number(m[3]||m[2]);
    if (start<1||end<start||end>lines.length) throw new Error(`Invalid finding line range: ${start}-${end}`);
    const description=m[4].trim().replace(/\s+/g,' ').slice(0,400);
    findings.push({title:m[1].trim().slice(0,100),startLine:start,endLine:end,description});
  }
  if (!findings.length) throw new Error('Expected at least one ### Finding title [lines: N-M]');
  if (findings.length>8) throw new Error('Demo supports at most eight findings');
  return {title,sourceFile,language:code.language,lines,findings,diagramMarkdown:fences.find(f=>f.language==='mermaid')?.content||null};
}
export function readReviewMarkdown(file) { return parseReviewMarkdown(fs.readFileSync(file,'utf8')); }
