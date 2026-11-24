// Mirrors elementary_math_practice_v2/app/services/speech.py:
// SPEECH_MODE=azure, SPEECH_KEY, SPEECH_ENDPOINT, SPEECH_VOICE and 24kHz PCM WAV.
import fs from 'node:fs/promises';

export async function synthesizeWav(text, outputFile) {
  if (process.env.SPEECH_MODE !== 'azure') throw new Error('SPEECH_MODE must be azure');
  const key = process.env.SPEECH_KEY;
  const endpoint = process.env.SPEECH_ENDPOINT;
  const voice = process.env.SPEECH_VOICE || 'en-US-JennyNeural';
  if (!key || !endpoint) throw new Error('SPEECH_KEY and SPEECH_ENDPOINT are required');
  if (!text || !text.trim() || text.length > 1200) throw new Error('Narration must be 1..1200 characters');
  let sdk;
  try { sdk = await import('microsoft-cognitiveservices-speech-sdk'); }
  catch (e) { throw new Error(`Azure Speech SDK unavailable: ${e.message}`); }
  // Match the Python SDK's endpoint+subscription authentication.
  const config = sdk.SpeechConfig.fromEndpoint(new URL(endpoint), key);
  config.speechSynthesisVoiceName = voice;
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
  const synthesizer = new sdk.SpeechSynthesizer(config, null);
  try {
    const result = await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(text, resolve, reject);
    });
    if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
      throw new Error(`Speech synthesis failed: ${result.errorDetails || result.reason}`);
    }
    const audio = Buffer.from(result.audioData);
    if (audio.length < 44 || audio.toString('ascii',0,4)!=='RIFF' || audio.toString('ascii',8,12)!=='WAVE') {
      throw new Error('Azure Speech did not return WAV audio');
    }
    await fs.writeFile(outputFile, audio);
    return outputFile;
  } finally { synthesizer.close(); }
}
