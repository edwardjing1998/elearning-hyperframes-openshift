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
export function addNarrationAudio(html, audioDuration, { tailPaddingSeconds = 2 } = {}) {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) throw new Error('Invalid narration duration');
  if (!Number.isFinite(tailPaddingSeconds) || tailPaddingSeconds < 0) throw new Error('Invalid narration padding');
  const originalDuration = compositionDuration(html);
  // Narration determines the minimum timeline length. Never trim speech.
  const duration = Math.max(originalDuration, Math.ceil((audioDuration + tailPaddingSeconds) * 1000) / 1000);
  html = html.replace(/(data-composition-id="[^"]+"[^>]*data-duration=")[0-9.]+(")/, (_, a, b) => `${a}${duration}${b}`);
  const tag = `<audio id="azure-narration" class="clip" data-volume="1" src="./assets/narration.wav" data-start="0" data-duration="${audioDuration.toFixed(3)}" data-track-index="10"></audio>`;
  // All four checked-in templates close the root DIV immediately before </body>.
  const end = /<\/div>\s*<\/body>/i;
  if (!end.test(html)) throw new Error('Cannot locate composition root closing tag');
  return html.replace(end,`${tag}
</div></body>`);
}
