
/**
 * Azure Speech synthesis for elearning-hyperframes-openshift.
 *
 * Compatible with elementary_math_practice_v2 configuration:
 *
 * SPEECH_MODE=azure
 * SPEECH_KEY=<Azure Speech subscription key>
 * SPEECH_ENDPOINT=https://eastus.api.cognitive.microsoft.com/
 * SPEECH_VOICE=en-US-JennyNeural
 *
 * Audio format: 24 kHz, 16-bit, mono PCM WAV.
 *
 * Uses fromSubscription() instead of fromEndpoint()
 * for standard Azure regional Cognitive Services endpoints.
 */

import fs from 'node:fs/promises';

const SPEECH_TIMEOUT_MS = 60_000;

function resolveSpeechRegion(endpoint) {
  let url;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('SPEECH_ENDPOINT must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('SPEECH_ENDPOINT must use HTTPS');
  }

  // Supported standard Azure Cognitive Services regional hostname.
  // Example:
  // https://eastus.api.cognitive.microsoft.com/
  // -> eastus
  const match = url.hostname.match(
    /^([a-z0-9-]+)\.api\.cognitive\.microsoft\.com$/
  );

  if (!match || url.pathname !== '/' ||
      url.search || url.hash) {
    throw new Error(
      'Cannot determine Azure Speech region from SPEECH_ENDPOINT. ' +
      'Expected a standard regional Cognitive Services root URL.'
    );
  }

  return match[1];
}

export async function synthesizeWav(text, outputFile) {
  if (process.env.SPEECH_MODE !== 'azure') {
    throw new Error('SPEECH_MODE must be azure');
  }

  const key = process.env.SPEECH_KEY;
  const endpoint = process.env.SPEECH_ENDPOINT;
  const voice = process.env.SPEECH_VOICE || 'en-US-JennyNeural';

  if (!key || !endpoint) {
    throw new Error(
      'SPEECH_KEY and SPEECH_ENDPOINT are required'
    );
  }

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > 1200
  ) {
    throw new Error(
      'Narration must be 1..1200 characters'
    );
  }

  const region = resolveSpeechRegion(endpoint);

  let sdk;

  try {
    sdk = await import(
      'microsoft-cognitiveservices-speech-sdk'
    );
  } catch (error) {
    throw new Error(
      `Azure Speech SDK unavailable: ${error.message}`
    );
  }

  // This initialization was verified successfully
  // inside the OpenShift renderer Pod using region eastus.
  const config = sdk.SpeechConfig.fromSubscription(
    key,
    region
  );

  config.speechSynthesisVoiceName = voice;

  config.speechSynthesisOutputFormat =
    sdk.SpeechSynthesisOutputFormat
      .Riff24Khz16BitMonoPcm;

  const synthesizer = new sdk.SpeechSynthesizer(
    config,
    null
  );

  const startedAt = Date.now();

  console.log(
    `[speech] Starting Azure Speech synthesis: ` +
    `${text.length} characters, region=${region}, voice=${voice}`
  );

  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;

        settled = true;

        reject(
          new Error(
            `Azure Speech synthesis timed out after ` +
            `${SPEECH_TIMEOUT_MS}ms`
          )
        );
      }, SPEECH_TIMEOUT_MS);

      const succeed = value => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const fail = error => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);

        reject(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
      };

      try {
        synthesizer.speakTextAsync(
          text,
          succeed,
          fail
        );
      } catch (error) {
        fail(error);
      }
    });

    if (
      result.reason !==
      sdk.ResultReason.SynthesizingAudioCompleted
    ) {
      throw new Error(
        `Speech synthesis failed: ` +
        `${result.errorDetails || result.reason}`
      );
    }

    const audio = Buffer.from(result.audioData);

    if (
      audio.length < 44 ||
      audio.toString('ascii', 0, 4) !== 'RIFF' ||
      audio.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new Error(
        'Azure Speech did not return WAV audio'
      );
    }

    await fs.writeFile(outputFile, audio);

    console.log(
      `[speech] Synthesis completed: ` +
      `${audio.length} bytes, ` +
      `${Date.now() - startedAt}ms`
    );

    return outputFile;

  } catch (error) {
    console.error(
      `[speech] Synthesis failed after ` +
      `${Date.now() - startedAt}ms: ` +
      `${error.message}`
    );

    throw error;

  } finally {
    synthesizer.close();
  }
}
