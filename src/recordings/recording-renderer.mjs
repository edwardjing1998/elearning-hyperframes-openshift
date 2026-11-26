/** Create narrated video scenes, holding the last image when the audio is longer. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { synthesizeWav } from '../speech/azure-speech.mjs';
import { wavDuration } from '../services/audio-composition.mjs';
import { openCaptureBlob } from '../capture/capture-storage.mjs';
import { makeActionPlan, validateNarrationSteps } from './action-plan.mjs';

export function runProcess(command,args,{cwd,log,timeoutMs=600000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']});
    let settled=false;let timer;
    const stop=(err)=>{if(settled)return;settled=true;clearTimeout(timer);reject(err);};
    if(log){child.stdout.on('data',x=>log(x.toString()));child.stderr.on('data',x=>log(x.toString()));}
    timer=setTimeout(()=>{child.kill('SIGKILL');stop(new Error(`${command} exceeded its rendering watchdog (${Math.ceil(timeoutMs/1000)}s)`));},timeoutMs);
    child.on('error',stop);
    child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);code===0?resolve():reject(new Error(`${command} exited with code ${code}`));});
  });
}
export async function probeDuration(file, runner = runProcess) {
  let output = '';

  // First: try reading container metadata.
  await runner(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file
    ],
    {
      log: text => { output += text; },
      timeoutMs: 30000
    }
  );

  const duration = Number(output.trim());

  if (Number.isFinite(duration) && duration >= 1) {
    return duration;
  }

  // Fallback: decode video frames to determine duration.
  let progress = '';

  await runner(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-v', 'error',
      '-i', file,
      '-map', '0:v:0',
      '-an',
      '-f', 'null',
      '-progress', 'pipe:1',
      '-'
    ],
    {
      log: text => { progress += text; },
      timeoutMs: 120000
    }
  );

  const matches = [
    ...progress.matchAll(/^out_time_us=(\d+)$/gm)
  ];

  const last = matches.at(-1);

  const decodedSeconds = last
    ? Number(last[1]) / 1_000_000
    : NaN;

  if (
    !Number.isFinite(decodedSeconds) ||
    decodedSeconds < 1
  ) {
    throw new Error(
      'Unable to determine recording duration from WebM metadata or decoded frames'
    );
  }

  return decodedSeconds;
}
export async function createNarratedRecording({blobName,scenes,jobDir,log=()=>{},speech=synthesizeWav,run=runProcess,load=openCaptureBlob,probe=probeDuration}) {
  const requested=validateNarrationSteps(scenes);
  await fs.mkdir(jobDir,{recursive:true});
  const source=path.join(jobDir,'source.webm');
  const streamResult=await load(blobName);
  if (streamResult.mime!=='video/webm') throw new Error('Selected capture is not a WebM recording');
  await pipeline(streamResult.stream, (await import('node:fs')).createWriteStream(source,{mode:0o600}));
  log('[capture] Recording downloaded');
  const sourceSeconds=await probe(source,run);
  const wavs=[],durations=[];
  for (let i=0;i<requested.length;i++) {
    const filename=path.join(jobDir,`speech-${String(i+1).padStart(3,'0')}.wav`);
    log(`[speech] Step ${i+1}/${requested.length} starting`);
    await speech(requested[i].text,filename);
    const duration=await wavDuration(filename);
    wavs.push(filename);durations.push(duration);
    log(`[speech] Step ${i+1} ready (${duration.toFixed(2)} seconds)`);
  }
  const plan=makeActionPlan(requested,sourceSeconds,durations);
  await fs.writeFile(path.join(jobDir,'action-plan.json'),JSON.stringify(plan,null,2));
  const mp4s=[];
  for (const s of plan.scenes) {
    const target=path.join(jobDir,`part-${String(s.index+1).padStart(3,'0')}.mp4`);
    // No video-length cap: rendering watchdog depends on expected work and is operational only.
    const watchdog=Math.max(600000,Math.ceil(s.output_seconds*30*1000));
    const filter=`[0:v]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=${s.hold_seconds.toFixed(3)},trim=duration=${s.output_seconds.toFixed(3)},setpts=PTS-STARTPTS[v];[1:a]apad,atrim=duration=${s.output_seconds.toFixed(3)},asetpts=PTS-STARTPTS[a]`;
    log(`[render] Step ${s.index+1}/${plan.scenes.length}: ${s.output_seconds.toFixed(2)} seconds (hold ${s.hold_seconds.toFixed(2)}s)`);
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y',
      '-ss',String(s.start_seconds),'-t',String(s.footage_seconds),'-i',source,
      '-i',wavs[s.index],'-filter_complex',filter,'-map','[v]','-map','[a]',
      '-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-r','30',
      '-c:a','aac','-ar','24000','-ac','1','-b:a','96k','-movflags','+faststart',target],{log,timeoutMs:watchdog});
    mp4s.push(target);
  }
  const list=path.join(jobDir,'parts.txt');
  await fs.writeFile(list,mp4s.map(f=>`file '${path.basename(f)}'`).join('\n')+'\n');
  const output=path.join(jobDir,'final.mp4');
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',output],{cwd:jobDir,log,timeoutMs:Math.max(120000,plan.duration_seconds*2000)});
  log('[render] Narrated recording assembled');
  return {output,plan};
}
