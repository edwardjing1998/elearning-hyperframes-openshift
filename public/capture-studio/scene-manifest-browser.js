/** Client-side scene manifest validation for exported editing data. Server revalidates all actions. */
export function validateSceneManifest(manifest) {
  if (manifest?.version!==1 || !Array.isArray(manifest.scenes) || !manifest.scenes.length || manifest.scenes.length>40) throw Error('Invalid Scene Manifest');
  return {version:1,scenes:manifest.scenes.map((s,i)=>{
    if (!Number.isFinite(s.start_seconds)||!Number.isFinite(s.end_seconds)||s.end_seconds-s.start_seconds<.25) throw Error(`Step ${i+1} times are invalid`);
    if(typeof s.narration?.text!=='string'||!s.narration.text.trim()) throw Error(`Step ${i+1} narration is required`);
    return {id:s.id,start_seconds:s.start_seconds,end_seconds:s.end_seconds,narration:{text:s.narration.text.trim()},actions:s.actions||[]};
  })};
}
