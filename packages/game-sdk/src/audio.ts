export interface ToneOptions {
  freq: number;
  endFreq?: number;
  /** AudioContext time to start at; defaults to now. */
  time?: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
}

export interface NoiseOptions {
  time?: number;
  duration?: number;
  gain?: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
}

export interface AudioKit {
  /** Create the AudioContext and resume it from a user gesture. */
  unlock(): void;
  /** Current AudioContext time (0 before the first unlock). */
  readonly now: number;
  /** Combined baseLatency + outputLatency, for aligning visuals with heard audio. */
  readonly latencyOffset: number;
  suspend(): void;
  resume(): void;
  tone(options: ToneOptions): void;
  noise(options: NoiseOptions): void;
  destroy(): void;
}

/**
 * Lazily creates a shared AudioContext and exposes a tiny synth layer
 * (oscillator tones + shaped noise bursts) so games can synthesize all
 * of their sound effects without shipping audio assets.
 */
export function createAudioKit(options: { masterGain?: number } = {}): AudioKit {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;

  const ensure = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!context) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = options.masterGain ?? 0.5;
      master.connect(context.destination);
    }
    return context;
  };

  const connect = (): { context: AudioContext; master: GainNode } | null => {
    const active = ensure();
    if (!active || !master) return null;
    return { context: active, master };
  };

  return {
    unlock() {
      const active = ensure();
      if (active && active.state === "suspended") void active.resume();
    },
    get now() {
      return ensure()?.currentTime ?? 0;
    },
    get latencyOffset() {
      const active = ensure();
      if (!active) return 0;
      return (active.baseLatency ?? 0) + (active.outputLatency ?? 0);
    },
    suspend() {
      if (context && context.state === "running") void context.suspend();
    },
    resume() {
      if (context && context.state === "suspended") void context.resume();
    },
    tone(toneOptions: ToneOptions) {
      const graph = connect();
      if (!graph) return;
      const { context: active, master: out } = graph;
      const t0 = toneOptions.time ?? active.currentTime;
      const duration = toneOptions.duration ?? 0.2;
      const osc = active.createOscillator();
      const gain = active.createGain();
      osc.type = toneOptions.type ?? "sine";
      osc.frequency.setValueAtTime(Math.max(toneOptions.freq, 1), t0);
      if (toneOptions.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(toneOptions.endFreq, 1), t0 + duration);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(toneOptions.gain ?? 0.3, t0 + (toneOptions.attack ?? 0.005));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    },
    noise(noiseOptions: NoiseOptions) {
      const graph = connect();
      if (!graph) return;
      const { context: active, master: out } = graph;
      const t0 = noiseOptions.time ?? active.currentTime;
      const duration = noiseOptions.duration ?? 0.15;
      const frames = Math.max(1, Math.floor(active.sampleRate * duration));
      const buffer = active.createBuffer(1, frames, active.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < frames; index += 1) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
      }
      const source = active.createBufferSource();
      source.buffer = buffer;
      const filter = active.createBiquadFilter();
      filter.type = noiseOptions.type ?? "bandpass";
      filter.frequency.value = noiseOptions.freq ?? 2000;
      filter.Q.value = noiseOptions.q ?? 1;
      const gain = active.createGain();
      gain.gain.value = noiseOptions.gain ?? 0.25;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      source.start(t0);
    },
    destroy() {
      if (context) void context.close();
      context = null;
      master = null;
    },
  };
}
