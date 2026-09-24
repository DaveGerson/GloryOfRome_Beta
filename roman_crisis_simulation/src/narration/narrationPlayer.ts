/**
 * narration/narrationPlayer.ts
 *
 * The narration voice's playback controller: a plain class (no React), so
 * hooks/useNarrationVoice.ts can drive it from effects and read it through
 * `useSyncExternalStore` without a single setState in an effect.
 *
 *  - One clip at a time. Starting another stops the current one - and
 *    cancels one still being prepared.
 *  - Per message, idle -> preparing -> playing -> idle, or -> error. Only
 *    the message that last asked has a non-idle state; every other is idle.
 *  - An in-memory LRU of WAV object URLs, keyed by message index plus a
 *    hash of the text (and the renderer variant - a Mock Mode tone must not
 *    answer for a real performance), capped at `maxCached`. A URL is
 *    revoked when it is evicted and when the player is disposed. Asking for
 *    a message already cached, or already being prepared, never renders it
 *    again - no second API call for the same narration.
 *  - Nothing is persisted: no save field, no localStorage, no eval-corpus
 *    entry. Audio lives in this object and dies with it.
 *  - A rejected `play()` (the browser's autoplay policy) is not an error:
 *    the clip simply goes back to idle and waits for a click.
 */

export type NarrationVoiceStatus = 'idle' | 'preparing' | 'playing' | 'error';

export interface NarrationPlayback {
  /** The message the voice is busy with (or failed on), or null when silent. */
  index: number | null;
  status: NarrationVoiceStatus;
}

/** Renders one narration to playable audio. Throws on failure. */
export type NarrationRenderer = (text: string) => Promise<Blob>;

export const DEFAULT_NARRATION_CACHE_SIZE = 20;

const IDLE: NarrationPlayback = { index: null, status: 'idle' };

/** FNV-1a, 32-bit - a cache key, not a security boundary. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface NarrationPlayerOptions {
  maxCached?: number;
  /** Test seam; defaults to `new Audio()`, created on first play. */
  createAudio?: () => HTMLAudioElement;
}

export class NarrationPlayer {
  private snapshot: NarrationPlayback = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly maxCached: number;
  private readonly createAudio: () => HTMLAudioElement;
  private audio: HTMLAudioElement | null = null;
  private renderer: NarrationRenderer | null = null;
  private variant = '';
  /** Bumped by every play/stop: a stale preparation must not start playing. */
  private requestId = 0;
  /** Bumped by `dispose`: a render that lands afterwards is revoked, not cached. */
  private generation = 0;
  private currentText: string | null = null;

  constructor(options: NarrationPlayerOptions = {}) {
    this.maxCached = Math.max(1, options.maxCached ?? DEFAULT_NARRATION_CACHE_SIZE);
    this.createAudio = options.createAudio ?? (() => new Audio());
  }

  /** `variant` separates cache entries rendered by different renderers (e.g. mock vs real). */
  setRenderer(renderer: NarrationRenderer, variant: string): void {
    this.renderer = renderer;
    this.variant = variant;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): NarrationPlayback => this.snapshot;

  /** The text of the message the voice is busy with, if any. */
  getCurrentText(): string | null {
    return this.snapshot.index === null ? null : this.currentText;
  }

  /** How many rendered clips are held right now. */
  get cachedCount(): number {
    return this.cache.size;
  }

  /** Play/stop in one control: stops this message if it is busy, otherwise plays it. */
  toggle(index: number, text: string): void {
    const { index: current, status } = this.snapshot;
    if (current === index && (status === 'preparing' || status === 'playing')) {
      this.stop();
      return;
    }
    void this.play(index, text);
  }

  async play(index: number, text: string, options: { auto?: boolean } = {}): Promise<void> {
    this.silenceAudio();
    const request = ++this.requestId;
    this.currentText = text;
    this.setSnapshot({ index, status: 'preparing' });

    let url: string;
    try {
      url = await this.urlFor(index, text);
    } catch (error) {
      if (request !== this.requestId) return;
      console.warn('NarrationPlayer: the narration could not be prepared', error);
      this.setSnapshot({ index, status: 'error' });
      return;
    }
    if (request !== this.requestId) return;

    const audio = this.ensureAudio();
    audio.src = url;
    this.setSnapshot({ index, status: 'playing' });
    try {
      await audio.play();
    } catch (error) {
      if (request !== this.requestId) return;
      const blockedByPolicy = error instanceof DOMException && error.name === 'NotAllowedError';
      if (!blockedByPolicy) console.warn('NarrationPlayer: playback failed', error);
      this.setSnapshot(options.auto || blockedByPolicy ? IDLE : { index, status: 'error' });
    }
  }

  stop(): void {
    this.requestId++;
    this.silenceAudio();
    this.setSnapshot(IDLE);
  }

  /** Stops, drops the audio element, and revokes every cached URL. Reusable afterwards. */
  dispose(): void {
    this.stop();
    this.generation++;
    if (this.audio) {
      this.audio.removeEventListener('ended', this.handleEnded);
      this.audio.removeEventListener('error', this.handleError);
      this.audio.removeAttribute('src');
      this.audio = null;
    }
    for (const url of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
    this.inFlight.clear();
  }

  private cacheKey(index: number, text: string): string {
    return `${this.variant}:${index}:${hashText(text)}`;
  }

  private urlFor(index: number, text: string): Promise<string> {
    const key = this.cacheKey(index, text);
    const cached = this.cache.get(key);
    if (cached) {
      // LRU touch: re-insert as most recent.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const renderer = this.renderer;
    if (!renderer) return Promise.reject(new Error('NarrationPlayer: no renderer set'));
    const generation = this.generation;
    const promise = renderer(text).then(blob => {
      const url = URL.createObjectURL(blob);
      if (generation !== this.generation) {
        URL.revokeObjectURL(url);
        throw new Error('NarrationPlayer: disposed while preparing');
      }
      this.cache.set(key, url);
      this.evict();
      return url;
    });
    this.inFlight.set(key, promise);
    const clear = () => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    };
    promise.then(clear, clear);
    return promise;
  }

  private evict(): void {
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value as string;
      const url = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (url) URL.revokeObjectURL(url);
    }
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = this.createAudio();
      this.audio.preload = 'auto';
      this.audio.addEventListener('ended', this.handleEnded);
      this.audio.addEventListener('error', this.handleError);
    }
    return this.audio;
  }

  private silenceAudio(): void {
    if (!this.audio) return;
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      // No source loaded yet - nothing to rewind.
    }
  }

  private handleEnded = (): void => {
    if (this.snapshot.status === 'playing') this.setSnapshot(IDLE);
  };

  private handleError = (): void => {
    if (this.snapshot.status === 'playing') this.setSnapshot({ index: this.snapshot.index, status: 'error' });
  };

  private setSnapshot(next: NarrationPlayback): void {
    if (next.index === this.snapshot.index && next.status === this.snapshot.status) return;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
}
