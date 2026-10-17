import '@fontsource/anton/latin-400.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/ibm-plex-mono/latin-300.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './style.css';

import { AudioEngine, type Levels } from './audio';
import {
  ACTS,
  TRACK_DURATION,
  actAt,
  cueAt,
  cueIndexAt,
  displayWord,
  formatClock,
} from './data';
import { LYRICS } from './lyrics';
import { Stage, type StageFrame } from './stage';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const canvas = $<HTMLCanvasElement>('stage');
const startScreen = $<HTMLElement>('start');
const startButton = $<HTMLButtonElement>('startButton');
const loadStatus = $<HTMLElement>('loadStatus');
const loadStatusText = $<HTMLElement>('loadStatusText');
const topbar = $<HTMLElement>('topbar');
const transport = $<HTMLElement>('transport');
const lyric = $<HTMLElement>('lyric');
const lyricBody = $<HTMLElement>('lyricBody');
const lyricEn = $<HTMLElement>('lyricEn');
const lyricZh = $<HTMLElement>('lyricZh');
const lyricIndex = $<HTMLElement>('lyricIndex');
const actRoman = $<HTMLElement>('actRoman');
const actTitle = $<HTMLElement>('actTitle');
const actSub = $<HTMLElement>('actSub');
const chapter = $<HTMLElement>('chapter');
const timecode = $<HTMLElement>('timecode');
const currentTime = $<HTMLElement>('currentTime');
const totalTime = $<HTMLElement>('totalTime');
const globalProgress = $<HTMLElement>('globalProgress');
const seek = $<HTMLInputElement>('seek');
const seekMarks = $<HTMLElement>('seekMarks');
const playButton = $<HTMLButtonElement>('playButton');
const muteButton = $<HTMLButtonElement>('muteButton');
const muteLabel = $<HTMLElement>('muteLabel');
const motionButton = $<HTMLButtonElement>('motionButton');
const motionLabel = $<HTMLElement>('motionLabel');
const fullscreenButton = $<HTMLButtonElement>('fullscreenButton');
const endScreen = $<HTMLElement>('end');
const replayButton = $<HTMLButtonElement>('replayButton');
const reviewButton = $<HTMLButtonElement>('reviewButton');
const toast = $<HTMLElement>('toast');

const stage = new Stage(canvas);
const audio = new AudioEngine('./media/world-execute-me.mp3');
audio.element.id = 'audio';
audio.element.setAttribute('aria-hidden', 'true');
audio.element.style.display = 'none';
document.body.appendChild(audio.element);

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const savedMotion = (() => {
  try {
    return window.localStorage.getItem('mmd-02-motion');
  } catch {
    return null;
  }
})();

let reducedMotion = savedMotion === 'soft' ? true : savedMotion === 'full' ? false : motionPreference.matches;
let started = false;
let starting = false;
let ended = false;
let endOpen = false;
let currentCue = -2;
let currentActId = '';
let lastFastUi = 0;
let lastTimecode = '';
let mockLevels: Levels | null = null;
let toastTimer = 0;
let endCloseTimer = 0;
let loadState: 'loading' | 'ready' | 'error' = 'loading';
let lastMarksAct = -1;

const emptyLevels: Levels = {
  level: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beat: 0,
  wave: new Uint8Array(0),
};

function setInert(target: HTMLElement, inert: boolean): void {
  if (inert) target.setAttribute('inert', '');
  else target.removeAttribute('inert');
}

function formatTimecode(time: number): string {
  const safe = Math.max(0, Number.isFinite(time) ? time : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const milliseconds = Math.floor((safe % 1) * 1000);
  return `00:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function setLoadState(state: 'loading' | 'ready' | 'error'): void {
  loadState = state;
  loadStatus.classList.toggle('is-ready', state === 'ready');
  loadStatus.classList.toggle('is-error', state === 'error');
  if (state === 'ready') {
    loadStatusText.textContent = `SIGNAL READY / ${formatClock(audio.duration || TRACK_DURATION)}`;
  } else if (state === 'error') {
    loadStatusText.textContent = 'SIGNAL LOST / CHECK AUDIO';
  } else {
    loadStatusText.textContent = 'LOADING SIGNAL';
  }
}

function showToast(message: string, duration = 3200): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), duration);
}

function syncDuration(): void {
  const duration = audio.duration || TRACK_DURATION;
  seek.max = String(duration);
  totalTime.textContent = formatClock(duration);
  buildSeekMarks(duration);
}

function buildSeekMarks(duration: number): void {
  seekMarks.replaceChildren();
  for (const act of ACTS) {
    const mark = document.createElement('span');
    mark.style.left = `${(act.start / duration) * 100}%`;
    mark.title = `${act.roman} / ${act.title}`;
    seekMarks.append(mark);
  }
}

function markActiveAct(time: number): void {
  const active = actAt(time);
  if (active.index === lastMarksAct) return;
  lastMarksAct = active.index;
  const children = seekMarks.children;
  for (let i = 0; i < children.length; i += 1) {
    children[i].classList.toggle('is-passed', i < active.index - 1);
  }
}

function syncPlayState(): void {
  const isPlaying = started && !audio.paused && !audio.element.ended;
  document.body.classList.toggle('is-playing', isPlaying);
  playButton.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
}

function applyAct(): void {
  if (!started) return;
  const act = actAt(audio.currentTime);
  if (act.id === currentActId) return;
  currentActId = act.id;
  actRoman.textContent = act.roman;
  actTitle.textContent = act.title;
  actSub.textContent = act.subtitle;
  chapter.animate(
    [
      { opacity: 0, transform: 'translateY(5px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: reducedMotion ? 1 : 420, easing: 'cubic-bezier(.16,1,.3,1)' },
  );
  const root = document.documentElement;
  root.style.setProperty('--accent', act.accent);
  root.style.setProperty('--accent-2', act.secondary);
  root.dataset.theme = act.light ? 'light' : 'dark';
  document.body.dataset.act = act.id;
  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = act.light ? '#e9e1d1' : '#070706';
}

function renderCaptionWord(target: HTMLElement, text: string, keywordOnly: boolean): void {
  target.replaceChildren();
  if (keywordOnly) {
    target.textContent = text;
    return;
  }
  const tokens = text.split(/(\s+)/);
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      target.append(document.createTextNode(token));
      continue;
    }
    const match = token.match(/^([^A-Za-z0-9À-Ü]*)([A-Z0-9À-Ü][A-Z0-9À-Ü'’\-]*)(.*)$/);
    if (match && match[2].length >= 2 && /[A-ZÀ-Ü]{2}/.test(match[2])) {
      if (match[1]) target.append(document.createTextNode(match[1]));
      const emphasis = document.createElement('em');
      emphasis.textContent = match[2];
      target.append(emphasis);
      if (match[3]) target.append(document.createTextNode(match[3]));
    } else {
      target.append(document.createTextNode(token));
    }
  }
}

function syncCaption(time: number, force = false): void {
  if (!started) return;
  const index = cueIndexAt(time);
  if (!force && index === currentCue) return;
  currentCue = index;

  if (index < 0) {
    lyric.classList.add('is-empty');
    lyric.classList.remove('is-entering');
    return;
  }

  const cue = LYRICS[index];
  const word = displayWord(cue);
  const keywordOnly = word !== null && word === cue.en.trim() && word !== 'world.execute(me);';
  lyricIndex.textContent = String(cue.i).padStart(3, '0');
  lyric.classList.toggle('is-keyword', keywordOnly);
  renderCaptionWord(lyricEn, cue.en, keywordOnly);
  lyricZh.textContent = cue.zh;
  lyric.classList.remove('is-empty', 'is-entering');
  // Force a new animation when the same cue is revisited after a seek.
  void lyricBody.offsetWidth;
  lyric.classList.add('is-entering');
}

function syncTransport(time: number, now: number, force = false): void {
  if (!force && now - lastFastUi < 46) return;
  lastFastUi = now;
  const duration = audio.duration || TRACK_DURATION;
  const safe = Math.max(0, Math.min(time, duration));
  const percentage = duration > 0 ? (safe / duration) * 100 : 0;
  currentTime.textContent = formatClock(safe);
  seek.style.setProperty('--seek-progress', `${percentage}%`);
  document.documentElement.style.setProperty('--progress', String(percentage / 100));
  if (!dragging) seek.value = String(safe);
  const stamp = formatTimecode(safe);
  if (stamp !== lastTimecode) {
    timecode.textContent = stamp;
    lastTimecode = stamp;
  }
  markActiveAct(safe);
  globalProgress.style.transform = `scaleX(${percentage / 100})`;
}

let dragging = false;

function hideEnd(_instant = false): void {
  if (!endOpen) return;
  endOpen = false;
  window.clearTimeout(endCloseTimer);
  endScreen.classList.remove('is-open');
  endCloseTimer = window.setTimeout(() => {
    endScreen.hidden = true;
    setInert(transport, false);
  }, 700);
}

function showEnd(): void {
  if (!started || endOpen) return;
  ended = true;
  endOpen = true;
  syncPlayState();
  window.clearTimeout(endCloseTimer);
  endScreen.hidden = false;
  setInert(transport, true);
  requestAnimationFrame(() => endScreen.classList.add('is-open'));
  window.setTimeout(() => replayButton.focus({ preventScroll: true }), 500);
}

async function beginFilm(): Promise<void> {
  if (starting || started) return;
  starting = true;
  startButton.classList.add('is-loading');
  startButton.setAttribute('aria-busy', 'true');
  const ctaLabel = startButton.querySelector<HTMLElement>('.start__cta-copy strong');
  const ctaHint = startButton.querySelector<HTMLElement>('.start__cta-copy small');
  if (ctaLabel) ctaLabel.textContent = 'BUFFERING';
  if (ctaHint) ctaHint.textContent = '载入信号 / INITIALIZING';

  try {
    audio.seek(0);
    await audio.play();
    started = true;
    starting = false;
    ended = false;
    currentCue = -2;
    currentActId = '';
    lastMarksAct = -1;
    lyric.classList.add('is-empty');
    setInert(topbar, false);
    setInert(transport, false);
    setInert(lyric, false);
    document.body.classList.add('is-running');
    startScreen.classList.add('is-leaving');
    window.setTimeout(() => {
      startScreen.hidden = true;
    }, 420);
    syncDuration();
    syncPlayState();
    const firstAct = actAt(0);
    if (firstAct.id === currentActId) currentActId = '';
    applyAct();
    syncCaption(0, true);
  } catch (error) {
    starting = false;
    startButton.classList.remove('is-loading');
    startButton.removeAttribute('aria-busy');
    if (ctaLabel) ctaLabel.textContent = 'EXECUTE';
    if (ctaHint) ctaHint.textContent = '开始执行 / CLICK TO RUN';
    console.error(error);
    showToast('播放失败 / PLAYBACK WAS BLOCKED — 再次点击 EXECUTE', 4200);
    setLoadState(loadState === 'error' ? 'error' : loadState);
  }
}

async function togglePlayback(): Promise<void> {
  if (!started) {
    await beginFilm();
    return;
  }
  if (audio.paused) {
    if (ended || endOpen) {
      ended = false;
      hideEnd();
      audio.seek(0);
      currentCue = -2;
    }
    try {
      await audio.play();
      syncPlayState();
    } catch {
      showToast('PLAYBACK FAILED / 播放失败');
    }
  } else {
    audio.pause();
    syncPlayState();
  }
}

function seekTo(time: number): void {
  if (!started) return;
  const duration = audio.duration || TRACK_DURATION;
  const target = Math.max(0, Math.min(time, Math.max(0, duration - 0.04)));
  audio.seek(target);
  if (ended || endOpen) {
    ended = false;
    hideEnd();
  }
  currentCue = -2;
  syncCaption(target, true);
  syncTransport(target, performance.now(), true);
  lastMarksAct = -1;
  markActiveAct(target);
}

function applyMotionPreference(): void {
  document.body.classList.toggle('soft-motion', reducedMotion);
  motionButton.classList.toggle('is-off', reducedMotion);
  motionLabel.textContent = reducedMotion ? 'FX SOFT' : 'FX FULL';
  motionButton.setAttribute('aria-pressed', String(reducedMotion));
  motionButton.setAttribute('aria-label', reducedMotion ? '减少动效已开启' : '完整动效');
}

function toggleMotion(): void {
  reducedMotion = !reducedMotion;
  try {
    window.localStorage.setItem('mmd-02-motion', reducedMotion ? 'soft' : 'full');
  } catch {
    // Storage is a convenience, never a requirement.
  }
  applyMotionPreference();
  showToast(reducedMotion ? 'SOFT MOTION / 动效已减弱' : 'FULL MOTION / 动效已恢复', 1900);
}

function toggleMute(): void {
  audio.setMuted(!audio.isMuted);
  muteButton.classList.toggle('is-off', audio.isMuted);
  muteButton.setAttribute('aria-label', audio.isMuted ? '取消静音' : '静音');
  muteButton.setAttribute('aria-pressed', String(audio.isMuted));
  muteLabel.textContent = audio.isMuted ? 'MUTED' : 'SOUND';
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    showToast('FULLSCREEN UNAVAILABLE / 无法进入全屏');
  }
}

function buildFrame(now: number): StageFrame {
  const time = started ? audio.currentTime : 0;
  const levels = mockLevels ?? (started ? audio.sample(now / 1000) : emptyLevels);
  return {
    time,
    now,
    act: actAt(started ? time : 0),
    cue: started ? cueAt(time) : null,
    levels,
    started,
    reduced: reducedMotion,
  };
}

function loop(now: number): void {
  window.requestAnimationFrame(loop);
  const frame = buildFrame(now);
  stage.render(frame);
  if (!started) return;
  applyAct();
  syncTransport(frame.time, now);
  syncCaption(frame.time);
}

function onLoadedMetadata(): void {
  syncDuration();
  if (audio.duration > 0 && loadState !== 'error') setLoadState('ready');
}

audio.element.addEventListener('loadedmetadata', onLoadedMetadata);
audio.element.addEventListener('durationchange', onLoadedMetadata);
audio.element.addEventListener('canplaythrough', () => {
  if (audio.duration > 0 && loadState !== 'error') setLoadState('ready');
});
audio.element.addEventListener('play', syncPlayState);
audio.element.addEventListener('pause', syncPlayState);
audio.element.addEventListener('ended', () => {
  ended = true;
  syncPlayState();
  syncCaption(audio.currentTime, true);
  showEnd();
});
audio.element.addEventListener('error', () => {
  setLoadState('error');
  if (started) showToast('SIGNAL LOST / 音频信号丢失');
});

startButton.addEventListener('click', () => {
  void beginFilm();
});
playButton.addEventListener('click', () => {
  void togglePlayback();
});
muteButton.addEventListener('click', toggleMute);
motionButton.addEventListener('click', toggleMotion);
fullscreenButton.addEventListener('click', () => {
  void toggleFullscreen();
});

seek.addEventListener('pointerdown', () => {
  dragging = true;
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
window.addEventListener('pointercancel', () => {
  dragging = false;
});
seek.addEventListener('input', () => {
  if (!started) return;
  const target = Number(seek.value);
  audio.seek(target);
  if (ended || endOpen) {
    ended = false;
    hideEnd();
  }
  currentCue = -2;
  syncCaption(target, true);
  syncTransport(target, performance.now(), true);
  markActiveAct(target);
});

replayButton.addEventListener('click', () => {
  hideEnd();
  ended = false;
  currentCue = -2;
  audio.seek(0);
  void audio.play().catch(() => {
    showToast('PLAYBACK FAILED / 播放失败');
  });
  syncPlayState();
  window.setTimeout(() => {
    playButton.focus({ preventScroll: true });
  }, 100);
});

reviewButton.addEventListener('click', () => {
  hideEnd();
  window.setTimeout(() => {
    playButton.focus({ preventScroll: true });
  }, 100);
});

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName.toLowerCase() ?? '';
  const inFormControl = tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button';
  if (event.key === ' ' && !inFormControl) {
    event.preventDefault();
    if (!started) void beginFilm();
    else void togglePlayback();
  } else if (event.key === 'ArrowRight' && tag !== 'input') {
    event.preventDefault();
    seekTo(audio.currentTime + 5);
  } else if (event.key === 'ArrowLeft' && tag !== 'input') {
    event.preventDefault();
    seekTo(audio.currentTime - 5);
  } else if ((event.key === 'm' || event.key === 'M') && !inFormControl) {
    toggleMute();
  } else if ((event.key === 'f' || event.key === 'F') && !inFormControl) {
    void toggleFullscreen();
  } else if (event.key === 'Escape' && endOpen) {
    hideEnd();
  }
});

window.addEventListener('pointermove', (event) => {
  stage.setPointer(event.clientX / window.innerWidth, event.clientY / window.innerHeight);
}, { passive: true });

window.addEventListener('beforeunload', () => {
  audio.pause();
});

document.addEventListener('fullscreenchange', () => {
  const isFull = Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute('aria-pressed', String(isFull));
  fullscreenButton.setAttribute(
    'aria-label',
    isFull ? '退出全屏' : '全屏',
  );
});

applyMotionPreference();
setInert(topbar, true);
setInert(transport, true);
setInert(lyric, true);
lyric.classList.add('is-empty');
syncDuration();
buildSeekMarks(TRACK_DURATION);
setLoadState('loading');
if (audio.isMuted) {
  muteLabel.textContent = 'MUTED';
  muteButton.classList.add('is-off');
}

void audio.loadTimeline().then(() => {
  if (audio.element.error) {
    setLoadState('error');
    return;
  }
  syncDuration();
  if (audio.duration > 0) setLoadState('ready');
  else setLoadState('loading');
});

window.requestAnimationFrame(loop);

// A small, deliberately hidden hook used for still-frame capture and review.
declare global {
  interface Window {
    __MMD__: {
      start: () => Promise<void>;
      seek: (time: number) => void;
      pause: () => void;
      play: () => Promise<void>;
      mock: (value: number | null) => void;
      time: () => number;
      duration: () => number;
    };
  }
}

window.__MMD__ = {
  start: async () => {
    await beginFilm();
  },
  seek: (time: number) => {
    seekTo(time);
  },
  pause: () => {
    audio.pause();
    syncPlayState();
  },
  play: async () => {
    await audio.play();
    syncPlayState();
  },
  mock: (value: number | null) => {
    if (value === null) {
      mockLevels = null;
      return;
    }
    const level = Math.max(0, Math.min(1, value));
    const wave = new Uint8Array(1024);
    for (let i = 0; i < wave.length; i += 1) {
      wave[i] = 128 + Math.round(Math.sin(i * 0.18) * 110 * level * Math.sin(i * 0.011));
    }
    mockLevels = {
      level,
      bass: Math.min(1, level * 1.1),
      mid: level * 0.7,
      high: level * 0.48,
      beat: level > 0.42 ? 0.9 : 0.2,
      wave,
    };
  },
  time: () => audio.currentTime,
  duration: () => audio.duration || TRACK_DURATION,
};
