import { validateSceneAction } from './scene-manifest.mjs';
/** Validated, deterministic plan for narrated clips of a recorded screen. */
export function makeActionPlan(scenes, videoDuration, speechDurations, {tailSeconds = 0.5} = {}) {
  if (!Number.isFinite(videoDuration) || videoDuration < 1) throw new Error('Recording duration must be at least 1 second');
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 40 || scenes.length !== speechDurations.length) {
    throw new Error('Provide 1..40 narration steps');
  }
  if (!Number.isFinite(tailSeconds) || tailSeconds < 0 || tailSeconds > 5) throw new Error('Invalid tailSeconds');
  let lastEnd=0;
  const planned = scenes.map((scene,index)=>{
    if (!scene || typeof scene !== 'object') throw new Error(`Invalid step ${index+1}`);
    const start=Number(scene.start_seconds), end=Number(scene.end_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end-start < 0.25 || end > videoDuration + 0.05 || start < lastEnd - 0.001) {
      throw new Error(`Step ${index+1} must have a nonoverlapping, valid time range inside the recording`);
    }
    const text=scene.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error(`Step ${index+1} narration must be 1..1200 characters`);
    const speech=Number(speechDurations[index]);
    if (!Number.isFinite(speech) || speech <= 0) throw new Error(`Step ${index+1} has invalid WAV duration`);
    const footageDuration=end-start;
    const duration=Math.max(footageDuration,speech+tailSeconds);
    lastEnd=end;
    const actions=(scene.actions ?? []).map(validateSceneAction);
    if (actions.length>30 || actions.some(a=>a.start_seconds>footageDuration+.001)) throw new Error(`Step ${index+1} action timing is invalid`);
    return {index, start_seconds:start, end_seconds:end, footage_seconds:footageDuration, speech_seconds:speech, hold_seconds:Math.max(0,duration-footageDuration), output_seconds:duration,text:text.trim(),actions};
  });
  return {scenes:planned,duration_seconds:planned.reduce((a,s)=>a+s.output_seconds,0)};
}

export function validateNarrationSteps(scenes) {
  if (!Array.isArray(scenes) || !scenes.length || scenes.length>40) throw new Error('Provide 1..40 narration steps');
  return scenes.map((s,i)=>{
    if (!s || typeof s.text !== 'string' || !s.text.trim() || s.text.length>1200) throw new Error(`Step ${i+1} narration must be 1..1200 characters`);
    if (typeof s.start_seconds !== 'number' || typeof s.end_seconds !== 'number') throw new Error(`Step ${i+1} timestamps must be numbers`);
    if (s.actions !== undefined && (!Array.isArray(s.actions) || s.actions.length>30)) throw new Error(`Step ${i+1} invalid actions`);
    const actions=(s.actions ?? []).map(validateSceneAction);
    if (actions.some(a=>a.start_seconds > s.end_seconds-s.start_seconds+.001)) throw new Error(`Step ${i+1} action exceeds duration`);
    return { start_seconds:s.start_seconds, end_seconds:s.end_seconds, text:s.text.trim(), actions };
  });
}
