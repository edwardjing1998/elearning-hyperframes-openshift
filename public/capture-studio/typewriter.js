/** Portable typewriter timing functions, shared with the canvas recording overlay. */
export function typewriterUnits(text, mode='character') {
  if (mode === 'line') return String(text).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (mode === 'character') return Array.from(String(text));
  throw new Error('Unsupported typing mode');
}
export function typewriterFrame(text,{mode='character',delay_ms=60}={},elapsedMs=0) {
  if (!Number.isFinite(delay_ms) || delay_ms <= 0) throw new Error('Invalid typing delay');
  const units=typewriterUnits(text,mode);
  const displayed=Math.min(units.length,Math.max(0,Math.floor(elapsedMs/delay_ms)+1));
  return {text:units.slice(0,displayed).join(''),done:displayed>=units.length,units:units.length,duration_ms:Math.max(0,units.length-1)*delay_ms};
}
