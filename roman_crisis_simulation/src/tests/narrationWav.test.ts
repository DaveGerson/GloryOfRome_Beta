/**
 * tests/narrationWav.test.ts
 *
 * narration/wav.ts - the port of the owner's Python `convert_to_wav` /
 * `parse_audio_mime_type`. The header is pinned byte-for-byte against a
 * hand-built expectation of `struct.pack("<4sI4s4sIHHIIHH4sI", ...)`.
 */
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  concatBytes,
  ensureWav,
  MOCK_TONE_MIME_TYPE,
  parseAudioMimeType,
  pcmToWav,
  synthesizeMockTone,
  WAV_HEADER_BYTES,
} from '../narration/wav';

/** Little-endian helpers for building the expected header by hand. */
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

function expectedHeader(dataSize: number, rate: number, bits: number): number[] {
  const blockAlign = Math.floor(bits / 8);
  return [
    ...ascii('RIFF'), ...u32(36 + dataSize), ...ascii('WAVE'),
    ...ascii('fmt '), ...u32(16), ...u16(1), ...u16(1),
    ...u32(rate), ...u32(rate * blockAlign), ...u16(blockAlign), ...u16(bits),
    ...ascii('data'), ...u32(dataSize),
  ];
}

describe('parseAudioMimeType', () => {
  it('reads the TTS endpoint\'s own mime type', () => {
    expect(parseAudioMimeType('audio/L16;codec=pcm;rate=24000')).toEqual({ bitsPerSample: 16, rate: 24000 });
  });

  it('defaults to 16-bit / 24000 Hz when nothing is given', () => {
    expect(parseAudioMimeType('')).toEqual({ bitsPerSample: 16, rate: 24000 });
    expect(parseAudioMimeType('audio/pcm')).toEqual({ bitsPerSample: 16, rate: 24000 });
  });

  it('parses other rates and bit depths, with whitespace around parameters', () => {
    expect(parseAudioMimeType(' audio/L24 ; codec=pcm ; rate=48000 ')).toEqual({ bitsPerSample: 24, rate: 48000 });
    expect(parseAudioMimeType('audio/L8;rate=8000')).toEqual({ bitsPerSample: 8, rate: 8000 });
  });

  it('matches rate= case-insensitively but audio/L case-sensitively, like the reference', () => {
    expect(parseAudioMimeType('audio/L16;RATE=16000').rate).toBe(16000);
    expect(parseAudioMimeType('audio/l24;rate=16000').bitsPerSample).toBe(16);
  });

  it('keeps the default for unparseable values', () => {
    expect(parseAudioMimeType('audio/L16;rate=')).toEqual({ bitsPerSample: 16, rate: 24000 });
    expect(parseAudioMimeType('audio/L16;rate=fast')).toEqual({ bitsPerSample: 16, rate: 24000 });
    expect(parseAudioMimeType('audio/L16;rate=22050.5').rate).toBe(24000);
    expect(parseAudioMimeType('audio/Lx;rate=16000')).toEqual({ bitsPerSample: 16, rate: 16000 });
    expect(parseAudioMimeType('audio/L;rate=16000').bitsPerSample).toBe(16);
  });

  it('keeps the default for zero or negative values rather than writing a broken header', () => {
    expect(parseAudioMimeType('audio/L0;rate=0')).toEqual({ bitsPerSample: 16, rate: 24000 });
    expect(parseAudioMimeType('audio/L16;rate=-24000').rate).toBe(24000);
  });

  it('the last rate= wins, as in the reference loop', () => {
    expect(parseAudioMimeType('audio/L16;rate=16000;rate=32000').rate).toBe(32000);
  });
});

describe('pcmToWav', () => {
  it('writes the 44-byte header byte-for-byte, then the PCM unchanged', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const wav = pcmToWav(pcm, 'audio/L16;codec=pcm;rate=24000');
    expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length);
    expect([...wav.slice(0, WAV_HEADER_BYTES)]).toEqual(expectedHeader(6, 24000, 16));
    expect([...wav.slice(WAV_HEADER_BYTES)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('derives sizes, byte rate and block align from the parsed format', () => {
    const pcm = new Uint8Array(3000);
    const wav = pcmToWav(pcm, 'audio/L24;rate=48000');
    const view = new DataView(wav.buffer);
    expect(view.getUint32(4, true)).toBe(36 + 3000); // RIFF chunk size
    expect(view.getUint32(24, true)).toBe(48000); // sample rate
    expect(view.getUint32(28, true)).toBe(48000 * 3); // byte rate
    expect(view.getUint16(32, true)).toBe(3); // block align
    expect(view.getUint16(34, true)).toBe(24); // bits per sample
    expect(view.getUint32(40, true)).toBe(3000); // data size
    expect([...wav.slice(0, WAV_HEADER_BYTES)]).toEqual(expectedHeader(3000, 48000, 24));
  });

  it('falls back to 24000 Hz / 16-bit on an unknown mime type', () => {
    const wav = pcmToWav(new Uint8Array(0), 'application/octet-stream');
    expect([...wav]).toEqual(expectedHeader(0, 24000, 16));
  });
});

describe('ensureWav', () => {
  it('wraps raw L16 PCM in a header, as the reference does for an unknown extension', () => {
    const out = ensureWav(new Uint8Array([1, 2, 3, 4]), 'audio/L16;codec=pcm;rate=24000');
    expect(out.length).toBe(WAV_HEADER_BYTES + 4);
    expect([...out.slice(WAV_HEADER_BYTES)]).toEqual([1, 2, 3, 4]);
  });

  it('passes an existing RIFF/WAVE container through without a second header', () => {
    const wav = pcmToWav(new Uint8Array([9, 9]), 'audio/L16;rate=24000');
    expect([...ensureWav(wav, 'audio/L16;rate=24000')]).toEqual([...wav]);
  });

  it('trusts a WAV MIME label even when the header sniff cannot run', () => {
    expect([...ensureWav(new Uint8Array([7]), 'audio/wav')]).toEqual([7]);
    expect([...ensureWav(new Uint8Array([7]), 'audio/x-wav')]).toEqual([7]);
  });
});

describe('base64 and byte helpers', () => {
  it('decodes base64 (ignoring whitespace) and concatenates in order', () => {
    expect([...base64ToBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...base64ToBytes('AQ\nID')]).toEqual([1, 2, 3]);
    expect([...concatBytes([base64ToBytes('AQ=='), base64ToBytes('AgM=')])]).toEqual([1, 2, 3]);
    expect(concatBytes([]).length).toBe(0);
  });
});

describe('synthesizeMockTone', () => {
  it('is about 0.4s of quiet 16-bit mono at 24 kHz that starts and ends silent', () => {
    const pcm = synthesizeMockTone();
    expect(pcm.length).toBe(24000 * 0.4 * 2);
    const view = new DataView(pcm.buffer);
    let peak = 0;
    for (let i = 0; i < pcm.length / 2; i++) peak = Math.max(peak, Math.abs(view.getInt16(i * 2, true)));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.08 * 0x7fff + 1);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(pcm.length - 2, true)).toBe(0);
    const wav = pcmToWav(pcm, MOCK_TONE_MIME_TYPE);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(pcm.length);
  });
});
