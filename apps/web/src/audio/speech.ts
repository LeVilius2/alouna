export type VoiceLocale = 'en-US' | 'en-GB';

export interface Speech {
  speak(text: string, options?: { interrupt?: boolean }): void;
  stop(): void;
  setConfig(config: { locale?: VoiceLocale; rate?: number }): void;
}

export class BrowserSpeech implements Speech {
  private locale: VoiceLocale;
  private rate: number;

  constructor(config: { locale?: VoiceLocale; rate?: number } = {}) {
    this.locale = config.locale ?? 'en-US';
    this.rate = config.rate ?? 1.0;
  }

  setConfig(config: { locale?: VoiceLocale; rate?: number }): void {
    if (config.locale) this.locale = config.locale;
    if (typeof config.rate === 'number' && Number.isFinite(config.rate)) {
      this.rate = Math.max(0.6, Math.min(1.6, config.rate));
    }
  }

  speak(text: string, options: { interrupt?: boolean } = {}): void {
    if (typeof globalThis === 'undefined' || !('speechSynthesis' in globalThis)) return;
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      if (options.interrupt !== false) {
        synth.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.locale;
      utterance.rate = this.rate;
      const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
      const matching =
        voices.find((v) => v.lang.toLowerCase() === this.locale.toLowerCase()) ??
        voices.find((v) => v.lang.toLowerCase().startsWith('en'));
      if (matching) utterance.voice = matching;
      synth.speak(utterance);
    } catch {
      /* Graceful fallback if SpeechSynthesis is blocked in headless/non-interactive browsers. */
    }
  }

  stop(): void {
    if (typeof globalThis === 'undefined' || !('speechSynthesis' in globalThis)) return;
    try {
      globalThis.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }
}
