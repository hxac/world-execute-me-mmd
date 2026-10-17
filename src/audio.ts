export interface Levels {
  level: number;
  bass: number;
  mid: number;
  high: number;
  beat: number;
  wave: Uint8Array;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const approach = (current: number, target: number, speed: number) =>
  current + (target - current) * speed;

/**
 * The sound half of the piece. The analyser is routed through a gain node so
 * muting the room never mutes the geometry.
 */
export class AudioEngine {
  readonly element: HTMLAudioElement;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private frequency = new Uint8Array(0);
  private waveform = new Uint8Array(0);
  private smoothBass = 0;
  private smoothMid = 0;
  private smoothHigh = 0;
  private smoothLevel = 0;
  private bassAverage = 0.08;
  private lastBeatAt = -10;
  private beat = 0;
  private muted = false;
  private armed = false;

  constructor(source: string) {
    this.element = new Audio(source);
    this.element.preload = 'auto';
    this.element.crossOrigin = 'anonymous';
    this.element.setAttribute('playsinline', '');
    this.element.volume = 1;
  }

  get duration(): number {
    return Number.isFinite(this.element.duration) ? this.element.duration : 0;
  }

  get currentTime(): number {
    return Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0;
  }

  get paused(): boolean {
    return this.element.paused;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  async arm(): Promise<void> {
    if (this.armed) {
      await this.context?.resume();
      return;
    }

    this.armed = true;
    try {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;

      const gain = context.createGain();
      gain.gain.value = 0;

      const source = context.createMediaElementSource(this.element);
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);

      this.context = context;
      this.analyser = analyser;
      this.gain = gain;
      this.frequency = new Uint8Array(analyser.frequencyBinCount);
      this.waveform = new Uint8Array(analyser.fftSize);
      await context.resume();
    } catch {
      // A locked Web Audio context should never take the film down with it.
      this.analyser = null;
      this.context = null;
      this.gain = null;
    }
  }

  async play(): Promise<void> {
    await this.arm();
    await this.context?.resume();
    if (this.gain && this.context) {
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.muted ? 0 : 0.0001, now);
      if (!this.muted) {
        this.gain.gain.exponentialRampToValueAtTime(0.88, now + 0.65);
      }
    }
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
    if (this.gain && this.context) {
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setTargetAtTime(0, now, 0.045);
    }
  }

  async toggle(): Promise<void> {
    if (this.element.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  seek(time: number): void {
    const target = clamp(time, 0, this.duration || 211.906);
    try {
      this.element.currentTime = target;
    } catch {
      // Some browsers refuse a seek before metadata has arrived.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain && this.context) {
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setTargetAtTime(muted ? 0 : 0.88, now, 0.04);
    }
  }

  async loadTimeline(): Promise<void> {
    if (this.element.readyState >= 1) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        this.element.removeEventListener('loadedmetadata', finish);
        this.element.removeEventListener('error', finish);
        resolve();
      };
      this.element.addEventListener('loadedmetadata', finish, { once: true });
      this.element.addEventListener('error', finish, { once: true });
      this.element.load();
    });
  }

  sample(nowSeconds: number): Levels {
    let targetBass = 0;
    let targetMid = 0;
    let targetHigh = 0;

    if (this.analyser && !this.element.paused && !this.element.ended) {
      this.analyser.getByteFrequencyData(this.frequency);
      this.analyser.getByteTimeDomainData(this.waveform);

      const binHz = (this.context?.sampleRate ?? 44100) / (this.analyser.fftSize * 2);
      const lowEnd = Math.max(2, Math.round(30 / binHz));
      const lowSplit = Math.max(lowEnd + 2, Math.round(180 / binHz));
      const midEnd = Math.max(lowSplit + 4, Math.round(2400 / binHz));
      const highEnd = Math.min(this.frequency.length - 1, Math.round(11000 / binHz));

      let lowSum = 0;
      let midSum = 0;
      let highSum = 0;
      for (let i = 1; i < lowEnd; i += 1) lowSum += this.frequency[i];
      for (let i = lowEnd; i < lowSplit; i += 1) lowSum += this.frequency[i];
      for (let i = lowSplit; i < midEnd; i += 1) midSum += this.frequency[i];
      for (let i = midEnd; i < highEnd; i += 1) highSum += this.frequency[i];

      const lowCount = lowSplit - 1;
      const midCount = midEnd - lowSplit;
      const highCount = highEnd - midEnd;

      targetBass = Math.pow(lowSum / Math.max(1, lowCount) / 255, 1.35);
      targetMid = Math.pow(midSum / Math.max(1, midCount) / 255, 1.25);
      targetHigh = Math.pow(highSum / Math.max(1, highCount) / 255, 1.15);
    } else {
      // Let the envelope fall away when the transport is paused.
      targetBass = 0;
      targetMid = 0;
      targetHigh = 0;
    }

    this.smoothBass = approach(this.smoothBass, targetBass, 0.34);
    this.smoothMid = approach(this.smoothMid, targetMid, 0.2);
    this.smoothHigh = approach(this.smoothHigh, targetHigh, 0.25);
    this.smoothLevel = approach(
      this.smoothLevel,
      clamp(this.smoothBass * 0.58 + this.smoothMid * 0.3 + this.smoothHigh * 0.12),
      0.12,
    );
    this.bassAverage += (this.smoothBass - this.bassAverage) * 0.035;

    const energeticEnough = this.smoothBass > Math.max(0.14, this.bassAverage * 1.42);
    if (energeticEnough && nowSeconds - this.lastBeatAt > 0.16) {
      this.beat = 1;
      this.lastBeatAt = nowSeconds;
    } else {
      this.beat *= 0.9;
    }

    return {
      level: this.smoothLevel,
      bass: this.smoothBass,
      mid: this.smoothMid,
      high: this.smoothHigh,
      beat: this.beat,
      wave: this.waveform,
    };
  }
}
