import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function wavDuration(file) {
  const {stdout} = await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{timeout:20000});
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration<=0) throw new Error('Could not determine WAV duration');
  return duration;
}
export function compositionDuration(html) {
  const match = html.match(/data-composition-id="[^"]+"[^>]*data-duration="([0-9.]+)"/);
  if (!match) throw new Error('Composition root duration missing');
  return Number(match[1]);
}
export function addNarrationAudio(html, audioDuration) {
  const duration = compositionDuration(html);
  // First version intentionally preserves ALL existing animation timing.
  // Refuse to truncate narration; request shorter text or expand timeline in a later version.
  if (audioDuration > duration - 0.25) {
    throw new Error(`Narration ${audioDuration.toFixed(2)}s exceeds the ${duration}s composition; shorten narration.text (no audio trimming performed)`);
  }
  const tag = `<audio id="azure-narration" class="clip" data-volume="1" src="./assets/narration.wav" data-start="0" data-duration="${audioDuration.toFixed(3)}" data-track-index="10"></audio>`;
  // All four checked-in templates close the root DIV immediately before </body>.
  const end = /<\/div>\s*<\/body>/i;
  if (!end.test(html)) throw new Error('Cannot locate composition root closing tag');
  return html.replace(end,`${tag}
</div></body>`);
}
