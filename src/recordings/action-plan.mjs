/** Validated, deterministic plan for narrated clips of a recorded screen. */
export function validateStepRanges(scenes, videoDuration) {
  if (!Number.isFinite(videoDuration) || videoDuration < 1) {
    throw new Error('Recording duration must be at least 1 second');
  }
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 40) {
    throw new Error('Provide 1..40 narration steps');
  }
  let lastEnd = 0;
  for (const [index, scene] of scenes.entries()) {
    if (!scene || typeof scene !== 'object') throw new Error(`Invalid step ${index + 1}`);
    const start = Number(scene.start_seconds);
    const end = Number(scene.end_seconds);
    const problems = [];
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      problems.push('start/end must be finite numbers');
    } else {
      if (start < 0) problems.push(`start ${start.toFixed(3)}s is negative`);
      if (end - start < 0.25) problems.push(`duration ${(end - start).toFixed(3)}s is below 0.250s`);
      if (start < lastEnd - 0.001) problems.push(`start ${start.toFixed(3)}s overlaps previous end ${lastEnd.toFixed(3)}s`);
      if (end > videoDuration + 0.05) problems.push(`end ${end.toFixed(3)}s exceeds recording duration ${videoDuration.toFixed(3)}s`);
    }
    if (problems.length) throw new Error(`Step ${index + 1} invalid: ${problems.join('; ')}`);
    lastEnd = end;
  }
}

export function makeActionPlan(scenes, videoDuration, speechDurations, {tailSeconds = 0.5} = {}) {
  if (!Number.isFinite(videoDuration) || videoDuration < 1) throw new Error('Recording duration must be at least 1 second');
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 40 || scenes.length !== speechDurations.length) {
    throw new Error('Provide 1..40 narration steps');
  }
  if (!Number.isFinite(tailSeconds) || tailSeconds < 0 || tailSeconds > 5) throw new Error('Invalid tailSeconds');
  validateStepRanges(scenes, videoDuration);
  const planned = scenes.map((scene,index)=>{
    if (!scene || typeof scene !== 'object') throw new Error(`Invalid step ${index+1}`);
    const start=Number(scene.start_seconds), end=Number(scene.end_seconds);
    const text=scene.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error(`Step ${index+1} narration must be 1..1200 characters`);
    const speech=Number(speechDurations[index]);
    if (!Number.isFinite(speech) || speech <= 0) throw new Error(`Step ${index+1} has invalid WAV duration`);
    const footageDuration=end-start;
    const duration=Math.max(footageDuration,speech+tailSeconds);
    return {index, start_seconds:start, end_seconds:end, footage_seconds:footageDuration, speech_seconds:speech, hold_seconds:Math.max(0,duration-footageDuration), output_seconds:duration,text:text.trim()};
  });
  return {scenes:planned,duration_seconds:planned.reduce((a,s)=>a+s.output_seconds,0)};
}

export function validateNarrationSteps(scenes) {
  if (!Array.isArray(scenes) || !scenes.length || scenes.length>40) throw new Error('Provide 1..40 narration steps');
  return scenes.map((s,i)=>{
    if (!s || typeof s.text !== 'string' || !s.text.trim() || s.text.length>1200) throw new Error(`Step ${i+1} narration must be 1..1200 characters`);
    if (typeof s.start_seconds !== 'number' || typeof s.end_seconds !== 'number') throw new Error(`Step ${i+1} timestamps must be numbers`);
    return { start_seconds:s.start_seconds, end_seconds:s.end_seconds, text:s.text.trim() };
  });
}
