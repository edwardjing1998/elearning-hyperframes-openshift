// Generic Mermaid sequenceDiagram subset parser, with legacy Kafka compiler retained.
// Supported: participant/actor, ->>, -->>, ->, --> and %% role aliases.
const escapeHtml = value => String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function parseSequenceDiagram(source) {
  const body=source.includes('```mermaid') ? source.match(/```mermaid\s*\n([\s\S]*?)\n```/i)?.[1] : source;
  if (!body) throw new Error('Missing Mermaid code fence');
  const lines=body.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if (lines.shift()!=='sequenceDiagram') throw new Error('Expected sequenceDiagram');
  const participants=[], roles={}, messages=[];
  for(const line of lines) {
    let m;
    if((m=/^(?:participant|actor)\s+([A-Za-z][\w]*)(?:\s+as\s+(.+))?$/.exec(line))) {
      if(participants.some(p=>p.id===m[1])) throw new Error(`Duplicate participant: ${m[1]}`);
      participants.push({id:m[1],label:(m[2]||m[1]).slice(0,75)});
    } else if((m=/^%%\s*role\s+([A-Za-z][\w]*):\s*(.+)$/.exec(line))) {
      roles[m[1]]=m[2].slice(0,80);
    } else if((m=/^([A-Za-z][\w]*)(-->>|->>|-->|->)([A-Za-z][\w]*):\s*(.+)$/.exec(line))) {
      messages.push({from:m[1],to:m[3],arrow:m[2],label:m[4].slice(0,130)});
    } else if (!line.startsWith('%%')) throw new Error(`Unsupported Mermaid line: ${line}`);
  }
  if(participants.length<2||participants.length>6) throw new Error('Supports 2-6 participants');
  if(messages.length<1||messages.length>12) throw new Error('Supports 1-12 messages');
  for(const m of messages) if(!participants.some(p=>p.id===m.from)||!participants.some(p=>p.id===m.to)) throw new Error(`Unknown participant in ${m.from}->${m.to}`);
  return {participants:participants.map(p=>({...p,role:roles[p.id]||''})),messages};
}
// Keep old Kafka HTML and its timing/appearance intact; validate its supported pattern.
export function compileKafkaComposition(html,markdown) {
  const parsed=parseSequenceDiagram(markdown);
  const {participants,messages}=parsed;
  if(participants.length!==3||messages.length!==3) throw new Error('Legacy Kafka template requires 3 participants and 3 messages');
  const [a,b,c]=participants.map(p=>p.id);
  const pairs=[[a,b],[b,c],[c,b]];
  messages.forEach((m,i)=>{if(m.from!==pairs[i][0]||m.to!==pairs[i][1]) throw new Error('Legacy Kafka template message direction mismatch');});
  participants.forEach((p,i)=>{
    html=html.replaceAll(`{{PARTICIPANT_${i+1}}}`,escapeHtml(p.label));
    html=html.replaceAll(`{{ROLE_${i+1}}}`,escapeHtml(p.role));
    html=html.replaceAll(`{{MESSAGE_${i+1}}}`,escapeHtml(messages[i].label));
  });
  if(/\{\{(?:PARTICIPANT|ROLE|MESSAGE)_\d+\}\}/.test(html)) throw new Error('Unresolved legacy placeholders');
  return html;
}
