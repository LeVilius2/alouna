import type { SonarCommand } from '@alouna/core';
import type { Haptics } from '../sensors/types';

export interface Sonar {
  /** Must be called from a user tap handler on iOS Safari to unlock audio and start the silent loop. */
  unlockFromTap(): Promise<void>;
  /** Updates the continuous sonar loop parameters. */
  update(command: SonarCommand): void;
  /** Plays a one-shot arrival chime. */
  playArrivalChime(): void;
  /** Plays a single preview ping (for settings test button). */
  playTestPing(pan?: number, alignment?: SonarCommand['alignment']): void;
  /** Sets master sonar volume in [0, 1]. */
  setVolume(volume: number): void;
  /** Stops all sonar oscillators and the silent audio loop. */
  stop(): void;
}

// A tiny 44-byte header + 16-bit mono 8 kHz silent WAV data URI for iOS Safari's
// "playback" audio session trick so the hardware silent switch does not mute Web Audio.
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class WebAudioSonar implements Sonar {
  private ctx: AudioContext | null = null;
  private silentAudio: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentCommand: SonarCommand | null = null;
  private volume = 0.7;
  private lastHazardBuzzMs = 0;
  private readonly haptics?: Haptics;

  constructor(options: { volume?: number; haptics?: Haptics } = {}) {
    if (typeof options.volume === 'number' && Number.isFinite(options.volume)) {
      this.volume = Math.max(0, Math.min(1, options.volume));
    }
    this.haptics = options.haptics;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  async unlockFromTap(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
    if (typeof document !== 'undefined' && typeof Audio !== 'undefined') {
      try {
        if (!this.silentAudio) {
          const el = new Audio(SILENT_WAV_DATA_URI);
          el.loop = true;
          el.volume = 0.01;
          el.setAttribute('playsinline', 'true');
          this.silentAudio = el;
        }
        await this.silentAudio.play();
      } catch {
        /* Headless browsers or strict autoplay environments may reject; WebAudio still runs. */
      }
    }
  }

  setVolume(volume: number): void {
    if (Number.isFinite(volume)) {
      this.volume = Math.max(0, Math.min(1, volume));
    }
  }

  private connectPannedGain(ctx: AudioContext, pan: number): { input: AudioNode; gain: GainNode } {
    const gain = ctx.createGain();
    if (typeof ctx.createStereoPanner === 'function') {
      try {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);
        gain.connect(panner);
        panner.connect(ctx.destination);
        return { input: gain, gain };
      } catch {
        /* fallback to direct destination */
      }
    }
    gain.connect(ctx.destination);
    return { input: gain, gain };
  }

  private emitPing(pan: number, alignment: SonarCommand['alignment']): void {
    const ctx = this.ensureContext();
    if (!ctx || this.volume <= 0) return;
    const now = ctx.currentTime;
    const peakGain = Math.max(0.001, this.volume * 0.35);

    if (alignment === 'aligned') {
      // Bright high ping (880 Hz) + short "tick-tick" confirmation (1320 Hz, 1760 Hz)
      const { gain } = this.connectPannedGain(ctx, pan);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.12);

      // Tick-tick confirmation
      for (const [offset, freq] of [
        [0.13, 1320],
        [0.18, 1760],
      ] as const) {
        const tick = this.connectPannedGain(ctx, pan);
        const tickOsc = ctx.createOscillator();
        tickOsc.type = 'triangle';
        tickOsc.frequency.setValueAtTime(freq, now + offset);
        tick.gain.gain.setValueAtTime(0.0001, now + offset);
        tick.gain.gain.exponentialRampToValueAtTime(peakGain * 0.65, now + offset + 0.008);
        tick.gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.038);
        tickOsc.connect(tick.gain);
        tickOsc.start(now + offset);
        tickOsc.stop(now + offset + 0.042);
      }
      this.haptics?.pulse('aligned');
    } else if (alignment === 'behind') {
      // Low "whoop" (220 Hz -> 360 Hz -> 190 Hz) indicating target is behind (> 135°)
      const { gain } = this.connectPannedGain(ctx, pan);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(360, now + 0.11);
      osc.frequency.linearRampToValueAtTime(190, now + 0.24);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.27);
    } else {
      // Off-course: lower, duller ping (480 Hz) panned toward target direction
      const { gain } = this.connectPannedGain(ctx, pan);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peakGain * 0.85, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  }

  private emitHazardBuzz(pan: number): void {
    const ctx = this.ensureContext();
    if (!ctx || this.volume <= 0) return;
    const now = ctx.currentTime;
    const peakGain = Math.max(0.001, this.volume * 0.3);
    const { gain } = this.connectPannedGain(ctx, pan);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.setValueAtTime(125, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.2);
    this.haptics?.pulse('hazard');
  }

  playTestPing(pan = 0, alignment: SonarCommand['alignment'] = 'aligned'): void {
    this.emitPing(pan, alignment);
  }

  playArrivalChime(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.volume <= 0) return;
    const now = ctx.currentTime;
    const peakGain = Math.max(0.001, this.volume * 0.35);
    // Ascending major triad chime: C5 (523 Hz) -> E5 (659 Hz) -> G5 (784 Hz) -> C6 (1046 Hz)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.11;
      const { gain } = this.connectPannedGain(ctx, 0);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + 0.26);
    });
    this.haptics?.pulse('arrived');
  }

  private scheduleTick(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const cmd = this.currentCommand;
    if (!cmd || !cmd.active) return;

    this.emitPing(cmd.pan, cmd.alignment);
    if (cmd.hazard) {
      const nowMs = Date.now();
      if (nowMs - this.lastHazardBuzzMs >= 1400) {
        this.lastHazardBuzzMs = nowMs;
        const hazardPan = Math.max(
          -1,
          Math.min(1, Math.sin((cmd.hazard.relativeDegrees * Math.PI) / 180)),
        );
        this.emitHazardBuzz(hazardPan);
      }
    }

    const delayMs = Math.max(250, Math.min(2000, cmd.pingIntervalMs));
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.currentCommand?.active) {
        this.scheduleTick();
      }
    }, delayMs);
  }

  update(command: SonarCommand): void {
    const wasActive = this.currentCommand?.active ?? false;
    this.currentCommand = command;
    if (!command.active) {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (!wasActive && this.timer === null) {
      this.scheduleTick();
    }
  }

  stop(): void {
    this.currentCommand = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.silentAudio) {
      try {
        this.silentAudio.pause();
      } catch {
        /* ignore */
      }
    }
  }
}
