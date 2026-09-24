/**
 * narration/wav.ts
 *
 * The narration voice's audio plumbing, and nothing else: decode the TTS
 * endpoint's base64 PCM, read its sample format out of the mime type, and
 * wrap it in a WAV header a browser `<audio>` element can play.
 *
 * `parseAudioMimeType` and `pcmToWav` are a faithful port of the owner's
 * Python reference (`parse_audio_mime_type` / `convert_to_wav`): RIFF,
 * PCM format 1, mono, little-endian, bits and rate parsed from a mime type
 * such as `audio/L16;codec=pcm;rate=24000`, defaulting to 16-bit / 24000 Hz.
 * One deliberate difference: a rate or bit depth that parses but is not a
 * positive integer keeps the default, where Python would go on to fail in
 * `struct.pack` - a malformed header is worse than a default one.
 *
 * Pure: no DOM beyond `atob`, no storage. Audio is never persisted - not in
 * the save (persistence/saveGame.ts) and not in the eval-corpus export.
 */

export interface AudioFormat {
  bitsPerSample: number;
  rate: number;
}

export const DEFAULT_BITS_PER_SAMPLE = 16;
export const DEFAULT_SAMPLE_RATE = 24000;
/** The size of the canonical 44-byte PCM WAV header `pcmToWav` writes. */
export const WAV_HEADER_BYTES = 44;

/** Python `int(s)` for the plain-decimal cases the reference can meet. */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\+?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Bits per sample and sample rate from an audio mime type. Mirrors the
 * reference exactly: split on `;`, strip each parameter, `rate=` matched
 * case-insensitively, the `audio/L<bits>` token matched case-sensitively,
 * and any unparseable value silently keeps its default.
 */
export function parseAudioMimeType(mimeType: string): AudioFormat {
  let bitsPerSample = DEFAULT_BITS_PER_SAMPLE;
  let rate = DEFAULT_SAMPLE_RATE;
  for (const rawParam of mimeType.split(';')) {
    const param = rawParam.trim();
    if (param.toLowerCase().startsWith('rate=')) {
      const parsed = parsePositiveInt(param.slice(param.indexOf('=') + 1));
      if (parsed !== null) rate = parsed;
    } else if (param.startsWith('audio/L')) {
      const parsed = parsePositiveInt(param.slice('audio/L'.length));
      if (parsed !== null) bitsPerSample = parsed;
    }
  }
  return { bitsPerSample, rate };
}

/**
 * Prepends a 44-byte RIFF/WAVE header to raw little-endian PCM. Mono;
 * `bytes_per_sample = bits // 8` exactly as the reference computes it.
 */
export function pcmToWav(pcm: Uint8Array, mimeType: string): Uint8Array<ArrayBuffer> {
  const { bitsPerSample, rate } = parseAudioMimeType(mimeType);
  const numChannels = 1;
  const dataSize = pcm.length;
  const bytesPerSample = Math.floor(bitsPerSample / 8);
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = rate * blockAlign;
  const chunkSize = 36 + dataSize;

  const wav = new Uint8Array(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  // struct.pack("<4sI4s4sIHHIIHH4sI", ...)
  ascii(0, 'RIFF');
  view.setUint32(4, chunkSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

/**
 * The reference only builds a header when the returned MIME type has no
 * known file extension (raw `audio/L16` PCM); a response that is already a
 * WAV container is saved as-is. Mirrors that: bytes already carrying a
 * RIFF/WAVE header, or labelled as WAV, pass through untouched instead of
 * gaining a second header that would make them unplayable.
 */
export function ensureWav(audio: Uint8Array, mimeType: string): Uint8Array<ArrayBuffer> {
  const isRiffWave = audio.length >= 12
    && String.fromCharCode(...audio.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...audio.subarray(8, 12)) === 'WAVE';
  const labelledWav = /^audio\/(x-)?wav(e)?\b/i.test(mimeType.trim());
  if (isRiffWave || labelledWav) return new Uint8Array(audio);
  return pcmToWav(audio, mimeType);
}

/** Decodes standard base64 (as the SDK returns `inlineData.data`) to bytes. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Concatenates byte chunks in order into one fresh buffer. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export const MOCK_TONE_MIME_TYPE = `audio/L16;codec=pcm;rate=${DEFAULT_SAMPLE_RATE}`;

/**
 * Mock Mode's stand-in for a performance: a short, quiet 16-bit mono sine
 * (~0.4s at 24 kHz, about -22 dBFS) with a soft fade at both ends so it
 * does not click. Generated in code so offline play and the test suites
 * exercise the whole decode -> WAV -> playback path with no network.
 */
export function synthesizeMockTone(durationSeconds = 0.4, frequencyHz = 220): Uint8Array<ArrayBuffer> {
  const sampleCount = Math.round(DEFAULT_SAMPLE_RATE * durationSeconds);
  const pcm = new Uint8Array(sampleCount * 2);
  const view = new DataView(pcm.buffer);
  const amplitude = 0.08 * 0x7fff;
  const fadeSamples = Math.min(Math.round(DEFAULT_SAMPLE_RATE * 0.05), Math.floor(sampleCount / 2));
  for (let i = 0; i < sampleCount; i++) {
    const fade = Math.min(1, i / Math.max(1, fadeSamples), (sampleCount - 1 - i) / Math.max(1, fadeSamples));
    const sample = Math.round(amplitude * fade * Math.sin((2 * Math.PI * frequencyHz * i) / DEFAULT_SAMPLE_RATE));
    view.setInt16(i * 2, sample, true);
  }
  return pcm;
}
