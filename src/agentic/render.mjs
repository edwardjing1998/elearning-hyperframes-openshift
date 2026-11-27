/** Reuse Azure Speech and FFmpeg to turn verified captures into a narrated MP4. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {synthesizeWav} from '../speech/azure-speech.mjs';
import {wavDuration} from '../services/audio-composition.mjs';

async function ffmpeg(args,log=()=>{}){
  return new Promise((resolve,reject)=>{
    const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args],{stdio:['ignore','ignore','pipe']});
    let err='';child.stderr.on('data',chunk=>{err=(err+chunk.toString()).slice(-4000);});
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`FFmpeg exited ${code}: ${err}`)));
  });
}
export async function renderCaptures(captures,jobDir,log=()=>{}){
  const clips=[];const evidence=[];
  for(let i=0;i<captures.length;i++){
    const s=captures[i];const wav=path.join(jobDir,`audio-${i}.wav`), clip=path.join(jobDir,`clip-${i}.mp4`);
    log(`Synthesizing narration for scene ${i+1}`);
    await synthesizeWav(s.narration,wav);
    const speechDuration=await wavDuration(wav);
    const duration=Math.max(s.duration_seconds,speechDuration+0.5);
    await ffmpeg(['-loop','1','-framerate','30','-i',s.file,'-i',wav,'-t',duration.toFixed(3),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p','-c:v','libx264','-preset','veryfast','-r','30','-c:a','aac','-ar','48000','-ac','2','-af',`apad=whole_dur=${duration.toFixed(3)}`,'-movflags','+faststart',clip],log);
    clips.push(clip);
    evidence.push({scene:i+1,source:s.actual_url,captured_at:s.captured_at,planned_duration:s.duration_seconds,speech_duration:speechDuration,rendered_duration:duration});
  }
  // Concat file references are internal generated paths, not user-controlled.
  const concat=path.join(jobDir,'concat.txt');
  await fs.writeFile(concat,clips.map(f=>`file '${path.basename(f)}'`).join('\n')+'\n');
  const output=path.join(jobDir,'final.mp4');
  await ffmpeg(['-f','concat','-safe','1','-i',concat,'-c','copy','-movflags','+faststart',output],log);
  await fs.writeFile(path.join(jobDir,'evidence.json'),JSON.stringify({scenes:evidence},null,2));
  return output;
}
