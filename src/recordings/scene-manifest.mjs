/** Versioned, portable scene/action validation. No code execution or selectors. */
const MAX_CODE = 20000;
const ACTION_TYPES = new Set(['typeText']);
export function validateSceneAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Action must be an object');
  if (!ACTION_TYPES.has(action.type)) throw new Error(`Unsupported action type: ${String(action.type)}`);
  if (action.type === 'typeText') {
    if (typeof action.text !== 'string' || !action.text.length || action.text.length > MAX_CODE) throw new Error(`typeText text must contain 1..${MAX_CODE} characters`);
    const animation = action.animation ?? {};
    if (!animation || typeof animation !== 'object' || Array.isArray(animation)) throw new Error('Invalid typeText animation');
    const mode = animation.mode ?? 'character';
    if (!['character','line'].includes(mode)) throw new Error('typeText animation mode must be character or line');
    const delay = animation.delay_ms ?? 60;
    if (!Number.isFinite(delay) || delay < 5 || delay > 2000) throw new Error('typeText delay_ms must be 5..2000');
    const start = action.start_seconds ?? 0;
    if (!Number.isFinite(start) || start < 0) throw new Error('Invalid typeText start_seconds');
    return {
      type:'typeText',
      target:'capture-overlay', // overlay, never an arbitrary external website element
      text:action.text,
      start_seconds:start,
      animation:{mode,delay_ms:delay,show_cursor:animation.show_cursor !== false}
    };
  }
}
export function validateSceneManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.version !== 1 || !Array.isArray(manifest.scenes)) throw new Error('Scene Manifest requires version 1 and scenes');
  if (!manifest.scenes.length || manifest.scenes.length > 40) throw new Error('Scene Manifest requires 1..40 scenes');
  return {version:1,scenes:manifest.scenes.map((scene,i)=>{
    if (!scene || typeof scene !== 'object') throw new Error(`Invalid scene ${i+1}`);
    const actions = scene.actions ?? [];
    if (!Array.isArray(actions) || actions.length > 30) throw new Error(`Scene ${i+1} actions must be an array of at most 30`);
    const text = scene.narration?.text ?? scene.text;
    if (typeof text !== 'string' || !text.trim() || text.length>1200) throw new Error(`Scene ${i+1} narration must be 1..1200 characters`);
    if (!Number.isFinite(scene.start_seconds) || !Number.isFinite(scene.end_seconds) || scene.start_seconds < 0 || scene.end_seconds-scene.start_seconds < .25) throw new Error(`Scene ${i+1} timestamps are invalid`);
    const duration=scene.end_seconds-scene.start_seconds;
    const validated=actions.map(validateSceneAction);
    if (validated.some(a=>a.start_seconds > duration + .001)) throw new Error(`Scene ${i+1} action exceeds scene duration`);
    return {id:typeof scene.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(scene.id)?scene.id:`scene-${i+1}`,start_seconds:scene.start_seconds,end_seconds:scene.end_seconds,narration:{text:text.trim()},actions:validated};
  })};
}
export function manifestToNarrationSteps(manifest) {
  return validateSceneManifest(manifest).scenes.map(s=>({start_seconds:s.start_seconds,end_seconds:s.end_seconds,text:s.narration.text,actions:s.actions}));
}
