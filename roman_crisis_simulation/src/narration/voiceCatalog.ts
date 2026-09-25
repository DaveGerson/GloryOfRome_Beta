/**
 * narration/voiceCatalog.ts
 *
 * Every prebuilt voice Gemini TTS offers - the casting palette of the voice
 * cast (narration/voiceCast.ts) - with the one-word character Google
 * publishes for each, and the register the voice is BELIEVED to have.
 *
 * REGISTER IS UNVERIFIED. Google publishes the one-word descriptors, not a
 * sex or register. The `register` here is community-observed and has not
 * been checked against this game's TTS model (gemini-3.8-flash-tts); treat
 * it as a hint for casting, never a fact. Audition any voice before relying
 * on it:
 *
 *   GEMINI_API_KEY=... GOR_NARRATOR_AUDIO=1 GOR_NARRATOR_VOICE=Gacrux npm run narrator:tune
 *
 * If a voice turns out to read the other way, fix its register here; the
 * casting agent's prompt and the deterministic fallback both read it.
 *
 * `Brio` is the owner's reference voice for gemini-3.8-flash-tts (the first
 * narration voice, B13). It is allowed, but its register is unknown, so the
 * deterministic fallback never picks it for a register-aware slot.
 *
 * tests/voiceCast.test.ts pins this list, so a typo cannot ship: a voice id
 * the endpoint does not know would fail every clip voiced in it.
 */

export type VoiceRegister = 'feminine' | 'masculine' | 'unknown';

export interface CatalogVoice {
  /** The prebuilt voice name the TTS endpoint takes. */
  id: string;
  /** Google's published one-word character for the voice. */
  descriptor: string;
  /** Believed register: community-observed, unverified; audition with narrator:tune. */
  register: VoiceRegister;
}

/** The thirty Gemini TTS prebuilt voices, in Google's published order, then Brio. */
export const VOICE_CATALOG: readonly CatalogVoice[] = [
  { id: 'Zephyr', descriptor: 'Bright', register: 'feminine' },
  { id: 'Puck', descriptor: 'Upbeat', register: 'masculine' },
  { id: 'Charon', descriptor: 'Informative', register: 'masculine' },
  { id: 'Kore', descriptor: 'Firm', register: 'feminine' },
  { id: 'Fenrir', descriptor: 'Excitable', register: 'masculine' },
  { id: 'Leda', descriptor: 'Youthful', register: 'feminine' },
  { id: 'Orus', descriptor: 'Firm', register: 'masculine' },
  { id: 'Aoede', descriptor: 'Breezy', register: 'feminine' },
  { id: 'Callirrhoe', descriptor: 'Easy-going', register: 'feminine' },
  { id: 'Autonoe', descriptor: 'Bright', register: 'feminine' },
  { id: 'Enceladus', descriptor: 'Breathy', register: 'masculine' },
  { id: 'Iapetus', descriptor: 'Clear', register: 'masculine' },
  { id: 'Umbriel', descriptor: 'Easy-going', register: 'masculine' },
  { id: 'Algieba', descriptor: 'Smooth', register: 'masculine' },
  { id: 'Despina', descriptor: 'Smooth', register: 'feminine' },
  { id: 'Erinome', descriptor: 'Clear', register: 'feminine' },
  { id: 'Algenib', descriptor: 'Gravelly', register: 'masculine' },
  { id: 'Rasalgethi', descriptor: 'Informative', register: 'masculine' },
  { id: 'Laomedeia', descriptor: 'Upbeat', register: 'feminine' },
  { id: 'Achernar', descriptor: 'Soft', register: 'feminine' },
  { id: 'Alnilam', descriptor: 'Firm', register: 'masculine' },
  { id: 'Schedar', descriptor: 'Even', register: 'masculine' },
  { id: 'Gacrux', descriptor: 'Mature', register: 'feminine' },
  { id: 'Pulcherrima', descriptor: 'Forward', register: 'feminine' },
  { id: 'Achird', descriptor: 'Friendly', register: 'masculine' },
  { id: 'Zubenelgenubi', descriptor: 'Casual', register: 'masculine' },
  { id: 'Vindemiatrix', descriptor: 'Gentle', register: 'feminine' },
  { id: 'Sadachbia', descriptor: 'Lively', register: 'masculine' },
  { id: 'Sadaltager', descriptor: 'Knowledgeable', register: 'masculine' },
  { id: 'Sulafat', descriptor: 'Warm', register: 'feminine' },
  { id: 'Brio', descriptor: 'Reference', register: 'unknown' },
];

/** The thirty Google-published voices: the palette uniqueness is counted against (Brio aside). */
export const CASTING_VOICES: readonly CatalogVoice[] = VOICE_CATALOG.filter(v => v.register !== 'unknown');

const BY_ID = new Map(VOICE_CATALOG.map(v => [v.id, v]));

export function isCatalogVoice(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

export function catalogVoice(id: string | null | undefined): CatalogVoice | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** "Gacrux — Mature": how a voice is named in a picker. */
export function catalogVoiceLabel(id: string): string {
  const voice = BY_ID.get(id);
  return voice ? `${voice.id} — ${voice.descriptor}` : id;
}
