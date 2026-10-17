import type { AudioLevels } from './audio';
import type { Cue, Section, WaveformData } from './data';
import { formatTime, sections } from './data';

export interface UICallbacks {
  onStart: () => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onRestart: () => void;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
  onReplay: () => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export class UI {
  private readonly callbacks: UICallbacks;
  private readonly intro = byId<HTMLElement>('intro');
  private readonly ending = byId<HTMLElement>('ending');
  private readonly startBtn = byId<HTMLButtonElement>('startBtn');
  private readonly startLabel = byId<HTMLElement>('startLabel');
  private readonly startNote = byId<HTMLElement>('startNote');
  private readonly bootLine = byId<HTMLElement>('bootLine');
  private readonly loadLabel = byId<HTMLElement>('loadLabel');
  private readonly loadPercent = byId<HTMLElement>('loadPercent');
  private readonly loadBar = byId<HTMLElement>('loadBar');
  private readonly loadDetail = byId<HTMLElement>('loadDetail');
  private readonly loadPanel = byId<HTMLElement>('loadPanel');
  private readonly phaseNo = byId<HTMLElement>('phaseNo');
  private readonly phaseTitle = byId<HTMLElement>('phaseTitle');
  private readonly phaseZh = byId<HTMLElement>('phaseZh');
  private readonly phaseClock = byId<HTMLElement>('phaseClock');
  private readonly phaseProgress = byId<HTMLElement>('phaseProgress');
  private readonly traceList = byId<HTMLOListElement>('traceList');
  private readonly lyricEn = byId<HTMLElement>('lyricEn');
  private readonly lyricZh = byId<HTMLElement>('lyricZh');
  private readonly lyricProgress = byId<HTMLElement>('lyricProgress');
  private readonly cueCounter = byId<HTMLElement>('cueCounter');
  private readonly stampLayer = byId<HTMLElement>('stampLayer');
  private readonly stampText = byId<HTMLElement>('stampText');
  private readonly stampZh = byId<HTMLElement>('stampZh');
  private readonly playBtn = byId<HTMLButtonElement>('playBtn');
  private readonly timeCurrent = byId<HTMLElement>('timeCurrent');
  private readonly timeTotal = byId<HTMLElement>('timeTotal');
  private readonly timeline = byId<HTMLElement>('timeline');
  private readonly waveformBase = byId<HTMLElement>('waveformBase');
  private readonly waveformActive = byId<HTMLElement>('waveformActive');
  private readonly timelineChapters = byId<HTMLElement>('timelineChapters');
  private readonly timelineHead = byId<HTMLElement>('timelineHead');
  private readonly camBtn = byId<HTMLButtonElement>('camBtn');
  private readonly camLabel = this.camBtn.querySelector('span') as HTMLElement;
  private readonly muteBtn = byId<HTMLButtonElement>('muteBtn');
  private readonly muteLabel = this.muteBtn.querySelector('span') as HTMLElement;
  private readonly fsBtn = byId<HTMLButtonElement>('fsBtn');
  private readonly statusText = byId<HTMLElement>('statusText');
  private readonly systemClock = byId<HTMLElement>('systemClock');
  private readonly miniMeterBars = Array.from(byId<HTMLElement>('miniMeter').children) as HTMLElement[];
  private readonly signalBars = Array.from(byId<HTMLElement>('signalBars').children) as HTMLElement[];
  private readonly signalValue = byId<HTMLElement>('signalValue');
  private readonly creditsDialog = byId<HTMLDialogElement>('creditsDialog');
  private readonly closeCredits = byId<HTMLButtonElement>('closeCredits');
  private readonly infoBtn = byId<HTMLButtonElement>('infoBtn');
  private readonly sceneFallback = byId<HTMLElement>('sceneFallback');
  private readonly notes = new WeakMap<Element, string>();

  private readonly songDuration: number;
  private readonly waveform: WaveformData;
  private lastSectionId = '';
  private lastCueKey = '';
  private lastStamp = '';
  private scrambleTimer: number | null = null;
  private stampTimer: number | null = null;
  private lyricEnterTimer: number | null = null;
  private draggingTimeline = false;
  private impactTimeout: number | null = null;
  private started = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private audioPhase = 0;
  private lastMeterUpdate = 0;

  constructor(waveform: WaveformData, callbacks: UICallbacks) {
    this.waveform = waveform;
    this.callbacks = callbacks;
    this.songDuration = waveform.duration || 211.907;
    this.timeTotal.textContent = formatTime(this.songDuration);
    this.buildWaveform();
    this.buildChapters();
    this.bindControls();
    this.makeGrain();
    this.setSection(sections[0], true);
    this.setStartReady(false);
  }

  private buildWaveform(): void {
    const peaks = this.waveform.peaks.length > 0 ? this.waveform.peaks : new Array(160).fill(0.2);
    const fragment = document.createDocumentFragment();
    const fragmentActive = document.createDocumentFragment();
    const visiblePeaks = peaks.filter((_, index) => index % 1 === 0);
    for (const peak of visiblePeaks) {
      const height = Math.max(5, Math.min(100, Math.round((0.14 + peak * 0.86) * 100)));
      const bar = document.createElement('span');
      bar.style.setProperty('--h', `${height}%`);
      const activeBar = document.createElement('span');
      activeBar.style.setProperty('--h', `${height}%`);
      fragment.appendChild(bar);
      fragmentActive.appendChild(activeBar);
    }
    this.waveformBase.replaceChildren(fragment);
    this.waveformActive.replaceChildren(fragmentActive);
    this.timeline.style.setProperty('--played', '0%');
  }

  private buildChapters(): void {
    const fragment = document.createDocumentFragment();
    sections.forEach((section, index) => {
      const mark = document.createElement('i');
      if (index % 4 === 0) mark.classList.add('is-major');
      mark.style.left = `${(section.start / this.songDuration) * 100}%`;
      fragment.appendChild(mark);
    });
    this.timelineChapters.replaceChildren(fragment);
  }

  private bindControls(): void {
    this.startBtn.addEventListener('click', () => {
      if (!this.startBtn.disabled) this.callbacks.onStart();
    });
    this.playBtn.addEventListener('click', () => this.callbacks.onTogglePlay());
    this.camBtn.addEventListener('click', () => this.callbacks.onToggleCamera());
    this.muteBtn.addEventListener('click', () => this.callbacks.onToggleMute());
    this.fsBtn.addEventListener('click', () => this.callbacks.onFullscreen());
    this.infoBtn.addEventListener('click', () => this.creditsDialog.showModal());
    byId<HTMLButtonElement>('introCreditsBtn').addEventListener('click', () => this.creditsDialog.showModal());
    byId<HTMLButtonElement>('infoBtnMobile').addEventListener('click', () => this.creditsDialog.showModal());
    this.closeCredits.addEventListener('click', () => this.creditsDialog.close());
    this.creditsDialog.addEventListener('click', (event) => {
      if (event.target === this.creditsDialog) this.creditsDialog.close();
    });
    byId<HTMLButtonElement>('restartBtn').addEventListener('click', () => this.callbacks.onRestart());
    byId<HTMLButtonElement>('replayBtn').addEventListener('click', () => this.callbacks.onReplay());

    this.timeline.addEventListener('pointerdown', (event) => {
      if (!this.started) return;
      this.draggingTimeline = true;
      this.timeline.setPointerCapture(event.pointerId);
      this.seekFromPointer(event);
    });
    this.timeline.addEventListener('pointermove', (event) => {
      if (!this.draggingTimeline) return;
      this.seekFromPointer(event);
    });
    const endDrag = (event: PointerEvent) => {
      if (!this.draggingTimeline) return;
      this.draggingTimeline = false;
      if (this.timeline.hasPointerCapture(event.pointerId)) this.timeline.releasePointerCapture(event.pointerId);
    };
    this.timeline.addEventListener('pointerup', endDrag);
    this.timeline.addEventListener('pointercancel', endDrag);
    this.timeline.addEventListener('keydown', (event) => {
      if (!this.started) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const current = Number(this.timeline.getAttribute('aria-valuenow')) || 0;
        this.callbacks.onSeek(current + direction * 5);
      }
    });
    document.addEventListener('fullscreenchange', () => {
      this.setFullscreen(Boolean(document.fullscreenElement));
    });
  }

  private seekFromPointer(event: PointerEvent): void {
    const rect = this.timeline.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.callbacks.onSeek(ratio * this.songDuration);
  }

  private makeGrain(): void {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const shade = Math.floor(110 + Math.random() * 145);
      image.data[i] = shade;
      image.data[i + 1] = shade;
      image.data[i + 2] = shade;
      image.data[i + 3] = Math.floor(Math.random() * 105);
    }
    context.putImageData(image, 0, 0);
    const url = `url(${canvas.toDataURL('image/png')})`;
    const grain = document.getElementById('grain');
    if (grain) grain.style.backgroundImage = url;
    const introNoise = this.intro.querySelector<HTMLElement>('.intro-noise');
    if (introNoise) introNoise.style.backgroundImage = url;
  }

  setStartReady(ready: boolean): void {
    this.startBtn.disabled = !ready;
    if (ready) {
      this.startLabel.textContent = 'EXECUTE SIMULATION';
      this.startNote.textContent = 'Playback 3:31 · live MMD render · typed-media sync';
      this.bootLine.textContent = 'system ready. awaiting input.';
      this.loadLabel.textContent = 'SYSTEM READY';
      this.loadPercent.textContent = '100%';
      this.loadBar.style.width = '100%';
      this.loadDetail.textContent = 'MMD skeleton mounted · dance buffer loaded · audio ready';
      this.intro.classList.add('ready');
    } else {
      this.startLabel.textContent = 'LOADING SIMULATION';
      this.startNote.textContent = 'MMD skeleton / dance data / audio';
      this.intro.classList.remove('ready');
    }
  }

  setLoadProgress(progress: number, label?: string, detail?: string): void {
    const percent = Math.min(100, Math.max(0, Math.round(progress)));
    this.loadPercent.textContent = `${String(percent).padStart(2, '0')}%`;
    this.loadBar.style.width = `${percent}%`;
    if (label) this.loadLabel.textContent = label;
    if (detail) this.loadDetail.textContent = detail;
  }

  showSceneFallback(message: string): void {
    this.sceneFallback.hidden = false;
    const paragraph = this.sceneFallback.querySelector('p');
    if (paragraph) paragraph.textContent = message;
  }

  hideIntro(): void {
    this.started = true;
    this.intro.classList.add('is-hidden');
    this.intro.setAttribute('aria-hidden', 'true');
    document.body.classList.add('is-live');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.statusText.textContent = 'SIM.ONLINE';
  }

  setPlaying(playing: boolean): void {
    document.body.classList.toggle('is-playing', playing);
    this.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    this.statusText.textContent = playing ? 'SIM.ONLINE' : 'SIM.PAUSED';
  }

  setFreeCamera(enabled: boolean): void {
    this.camBtn.setAttribute('aria-pressed', String(enabled));
    this.camLabel.textContent = enabled ? 'FREE CAM' : 'AUTO CAM';
    document.body.classList.toggle('is-free-camera', enabled);
  }

  setMuted(muted: boolean): void {
    document.body.classList.toggle('is-muted', muted);
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    this.muteBtn.setAttribute('aria-label', muted ? '取消静音' : '静音');
    this.muteLabel.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }

  setFullscreen(fullscreen: boolean): void {
    const label = this.fsBtn.querySelector('span');
    if (label) label.textContent = fullscreen ? 'EXIT FULL' : 'FULL';
    this.fsBtn.setAttribute('aria-label', fullscreen ? '退出全屏' : '全屏');
  }

  setSection(section: Section, force = false): void {
    if (!force && section.id === this.lastSectionId) return;
    const first = this.lastSectionId === '';
    this.lastSectionId = section.id;
    const root = document.documentElement;
    root.style.setProperty('--accent', section.accent);
    root.style.setProperty('--accent-2', section.accent2);
    this.phaseNo.textContent = section.no;
    this.phaseTitle.textContent = section.title;
    this.phaseZh.textContent = section.zh;
    this.phaseClock.textContent = formatTime(section.start);
    this.traceList.replaceChildren();
    const lines = [...section.trace, '> awaiting next frame…'];
    lines.forEach((line, index) => {
      const item = document.createElement('li');
      item.textContent = line;
      if (index === lines.length - 1) item.classList.add('is-new');
      this.traceList.appendChild(item);
    });
    if (!first && !this.reducedMotion) {
      this.phaseTitle.animate(
        [
          { opacity: 0, transform: 'translateY(6px)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
    }
  }

  updatePlayback(time: number, duration: number, cue: Cue | null): void {
    const safeDuration = duration > 0 ? duration : this.songDuration;
    const ratio = Math.min(1, Math.max(0, time / safeDuration));
    this.timeCurrent.textContent = formatTime(time);
    this.timeline.setAttribute('aria-valuenow', String(Math.floor(time)));
    this.timeline.setAttribute('aria-valuemax', String(Math.floor(safeDuration)));
    this.timeline.style.setProperty('--played', `${ratio * 100}%`);
    this.timelineHead.style.left = `${ratio * 100}%`;
    this.systemClock.textContent = formatTime(time);

    if (cue) {
      const progress = Math.min(1, Math.max(0, (time - cue.start) / Math.max(0.01, cue.end - cue.start)));
      this.lyricProgress.style.width = `${progress * 100}%`;
    } else {
      this.lyricProgress.style.width = '0%';
    }

    const activeSection =
      sections.find((section) => time >= section.start && time < section.end) ?? sections[sections.length - 1];
    const sectionProgress = Math.min(
      1,
      Math.max(0, (time - activeSection.start) / Math.max(0.01, activeSection.end - activeSection.start)),
    );
    this.phaseProgress.style.width = `${sectionProgress * 100}%`;
    this.phaseClock.textContent = formatTime(time);
  }

  showCue(cue: Cue, force = false): void {
    const key = `${cue.index}:${cue.en}`;
    if (!force && key === this.lastCueKey) {
      this.updateStamp(cue);
      return;
    }
    this.lastCueKey = key;
    const isTitle = cue.en === 'world.execute(me);';
    this.cueCounter.textContent = `CUE // ${String(cue.index).padStart(3, '0')} / 129`;
    this.lyricEn.classList.remove('is-idle', 'is-entering');
    this.lyricEn.classList.toggle('is-keyword', cue.keyword);
    this.lyricZh.classList.toggle('is-keyword', cue.keyword);
    this.lyricZh.textContent = cue.zh;
    this.setLyricText(cue.en, !isTitle && !cue.keyword);
    if (this.lyricEnterTimer !== null) window.clearTimeout(this.lyricEnterTimer);
    void this.lyricEn.offsetWidth;
    this.lyricEn.classList.add('is-entering');
    this.lyricEnterTimer = window.setTimeout(() => {
      this.lyricEn.classList.remove('is-entering');
      this.lyricEnterTimer = null;
    }, 620);
    this.updateStamp(cue, isTitle);
  }

  showIdle(section: Section): void {
    const key = `idle:${section.id}`;
    if (this.lastCueKey === key) return;
    this.lastCueKey = key;
    if (this.scrambleTimer !== null) {
      window.clearInterval(this.scrambleTimer);
      this.scrambleTimer = null;
    }
    this.cueCounter.textContent = 'CUE // --- / 129';
    this.lyricEn.classList.remove('is-keyword', 'is-entering');
    this.lyricEn.classList.add('is-idle');
    this.lyricZh.classList.remove('is-keyword');
    this.lyricEn.textContent = `// ${section.whisperEn}`;
    this.lyricZh.textContent = section.whisperZh;
    this.lyricProgress.style.width = '0%';
    this.hideStamp();
  }

  private updateStamp(cue: Cue, isTitle = false): void {
    const shouldShow = cue.keyword || isTitle;
    if (!shouldShow) {
      this.hideStamp();
      return;
    }
    const text = cue.en;
    const sameAsBefore = this.lastStamp === text;
    this.lastStamp = text;
    this.stampText.textContent = text;
    this.stampText.dataset.text = text;
    this.stampText.classList.toggle('is-long', text.length > 10);
    this.stampText.classList.toggle('is-title', isTitle);
    this.stampZh.textContent = isTitle ? '世界，执行我；' : cue.zh;
    this.stampLayer.classList.add('is-visible');
    this.stampLayer.classList.remove('is-glitching');
    if (this.stampTimer !== null) window.clearTimeout(this.stampTimer);
    if (!sameAsBefore || !this.reducedMotion) {
      void this.stampText.offsetWidth;
      this.stampLayer.classList.add('is-glitching');
      this.stampTimer = window.setTimeout(() => {
        this.stampLayer.classList.remove('is-glitching');
        this.stampTimer = null;
      }, 340);
    }
  }

  private hideStamp(): void {
    this.stampLayer.classList.remove('is-visible', 'is-glitching');
    if (this.stampTimer !== null) {
      window.clearTimeout(this.stampTimer);
      this.stampTimer = null;
    }
    this.lastStamp = '';
  }

  private setLyricText(text: string, allowScramble: boolean): void {
    if (this.scrambleTimer !== null) {
      window.clearInterval(this.scrambleTimer);
      this.scrambleTimer = null;
    }
    this.lyricEn.dataset.text = text;
    if (!allowScramble || this.reducedMotion || text.length < 8) {
      this.lyricEn.textContent = text;
      return;
    }
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+<>/';
    let frame = 0;
    this.lyricEn.textContent = text;
    this.scrambleTimer = window.setInterval(() => {
      frame += 1;
      if (frame >= 7) {
        this.lyricEn.textContent = text;
        if (this.scrambleTimer !== null) window.clearInterval(this.scrambleTimer);
        this.scrambleTimer = null;
        return;
      }
      let next = '';
      for (let i = 0; i < text.length; i += 1) {
        const character = text[i];
        if (character === ' ' || /[.,;:!?'()\-]/.test(character) || i < frame * 2) {
          next += character;
        } else {
          next += glyphs[Math.floor(Math.random() * glyphs.length)];
        }
      }
      this.lyricEn.textContent = next;
    }, 26);
  }

  setLevels(levels: AudioLevels): void {
    const now = performance.now();
    if (now - this.lastMeterUpdate < 48) return;
    this.lastMeterUpdate = now;
    this.audioPhase += 0.09;
    this.miniMeterBars.forEach((bar, index) => {
      const wave = Math.abs(Math.sin(this.audioPhase + index * 0.7));
      const height = 2 + (levels.energy * 7 + wave * 2.5) * (index / this.miniMeterBars.length);
      bar.style.height = `${Math.max(2, Math.min(11, height))}px`;
    });
    this.signalBars.forEach((bar, index) => {
      const frequencyShape = Math.sin((index / this.signalBars.length) * Math.PI);
      const jitter = 0.75 + Math.abs(Math.sin(this.audioPhase * 1.4 + index * 0.51)) * 0.35;
      const height = 2 + (2 + levels.energy * 15) * frequencyShape * jitter;
      bar.style.height = `${Math.max(2, Math.min(18, height))}px`;
      bar.style.opacity = `${0.3 + levels.energy * 0.65}`;
    });
    this.signalValue.textContent = (levels.energy * 100).toFixed(1).padStart(4, '0');
  }

  pulseImpact(strength = 1): void {
    if (this.reducedMotion) return;
    if (this.impactTimeout !== null) window.clearTimeout(this.impactTimeout);
    document.body.classList.add('is-impact');
    document.body.style.setProperty('--impact', String(strength));
    this.impactTimeout = window.setTimeout(() => {
      document.body.classList.remove('is-impact');
      this.impactTimeout = null;
    }, 170);
  }

  showEnding(): void {
    this.ending.classList.add('is-visible');
    this.ending.setAttribute('aria-hidden', 'false');
    this.setPlaying(false);
    document.body.classList.add('is-ended');
  }

  hideEnding(): void {
    this.ending.classList.remove('is-visible');
    this.ending.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-ended');
  }

  showError(message: string): void {
    this.loadLabel.textContent = 'LOAD ERROR';
    this.loadDetail.textContent = message;
    this.startNote.textContent = message;
    this.bootLine.textContent = 'fatal: visual core unavailable.';
  }
}
