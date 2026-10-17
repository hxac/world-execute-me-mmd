export interface AudioLevels {
  low: number;
  mid: number;
  high: number;
  energy: number;
  beat: number;
  beatStrength: number;
  average: number;
}

export class AudioEngine {
  readonly element: HTMLAudioElement;

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private frequencies: Uint8Array<ArrayBuffer> | null = null;
  private started = false;
  private lastBeatAt = -10;
  private levels: AudioLevels = {
    low: 0,
    mid: 0,
    high: 0,
    energy: 0,
    beat: 0,
    beatStrength: 0,
    average: 0,
  };
  private smoothedAverage = 0;
  private now = 0;

  constructor(element: HTMLAudioElement) {
    this.element = element;
    this.element.preload = 'auto';
  }

  get isPlaying(): boolean {
    return !this.element.paused && !this.element.ended && this.element.readyState > 2;
  }

  get currentTime(): number {
    return this.element.currentTime || 0;
  }

  get duration(): number {
    return Number.isFinite(this.element.duration) ? this.element.duration : 211.907;
  }

  get hasStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    this.ensureAnalyser();
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
    this.started = true;
    await this.element.play();
  }

  async play(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
    this.started = true;
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  async toggle(): Promise<void> {
    if (this.element.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  seek(time: number): void {
    const clamped = Math.min(Math.max(time, 0), this.duration - 0.04);
    this.element.currentTime = clamped;
    this.smoothedAverage = 0;
    this.levels = {
      low: 0,
      mid: 0,
      high: 0,
      energy: 0,
      beat: 0,
      beatStrength: 0,
      average: 0,
    };
  }

  setMuted(muted: boolean): void {
    this.element.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 0.9;
  }

  get muted(): boolean {
    return this.element.muted;
  }

  private ensureAnalyser(): void {
    if (this.context) return;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      this.context = new AudioContextClass();
      const source = this.context.createMediaElementSource(this.element);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.9;
      source.connect(this.analyser);
      this.analyser.connect(this.gain);
      this.gain.connect(this.context.destination);
      this.frequencies = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (error) {
      console.warn('Visual audio analysis is unavailable; playback will continue.', error);
      this.context = null;
      this.analyser = null;
    }
  }

  sample(dt: number): AudioLevels {
    this.now += Math.max(0, dt);
    const result: AudioLevels = { ...this.levels };
    result.beat = 0;
    result.beatStrength = 0;

    if (!this.analyser || !this.frequencies || this.element.paused) {
      this.levels.low *= 0.94;
      this.levels.mid *= 0.94;
      this.levels.high *= 0.94;
      this.levels.energy *= 0.94;
      return result;
    }

    this.analyser.getByteFrequencyData(this.frequencies);
    const binHz = this.context!.sampleRate / this.analyser.fftSize;
    const band = (from: number, to: number): number => {
      const start = Math.max(0, Math.floor(from / binHz));
      const end = Math.min(this.frequencies!.length - 1, Math.ceil(to / binHz));
      let sum = 0;
      for (let i = start; i <= end; i += 1) sum += this.frequencies![i];
      return sum / Math.max(1, end - start + 1) / 255;
    };

    const low = Math.min(1, band(28, 160) * 1.55);
    const mid = Math.min(1, band(160, 2400) * 1.45);
    const high = Math.min(1, band(2400, 10500) * 1.9);
    const energy = Math.min(1, low * 0.5 + mid * 0.36 + high * 0.14);

    const smoothing = 1 - Math.exp(-dt * 13);
    this.levels.low += (low - this.levels.low) * smoothing;
    this.levels.mid += (mid - this.levels.mid) * smoothing;
    this.levels.high += (high - this.levels.high) * smoothing;
    this.levels.energy += (energy - this.levels.energy) * smoothing;

    this.smoothedAverage += (this.levels.energy - this.smoothedAverage) * (1 - Math.exp(-dt * 1.4));
    this.levels.average = this.smoothedAverage;

    const transient = this.levels.low - this.smoothedAverage;
    if (transient > 0.13 && this.levels.low > 0.22 && this.now - this.lastBeatAt > 0.19) {
      this.lastBeatAt = this.now;
      this.levels.beat = 1;
      this.levels.beatStrength = Math.min(1, 0.45 + transient * 2.4);
      result.beat = 1;
      result.beatStrength = this.levels.beatStrength;
    }

    return { ...this.levels };
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
