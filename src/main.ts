import './style.css';
import { AudioEngine, type AudioLevels } from './audio';
import { cueAt, lastCueAt, sectionAt, sections, type Cue, type Section, type SongData, type WaveformData } from './data';
import { MMDTheatre, type StageFrame } from './stage';
import { UI } from './ui';

const EMPTY_LEVELS: AudioLevels = {
  low: 0,
  mid: 0,
  high: 0,
  energy: 0,
  beat: 0,
  beatStrength: 0,
  average: 0,
};

interface RuntimeState {
  started: boolean;
  playing: boolean;
  ended: boolean;
  freeCamera: boolean;
  section: Section;
  activeCue: Cue | null;
  lastCueShown: number | null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

function fatal(message: string): void {
  const label = document.getElementById('startLabel');
  const note = document.getElementById('startNote');
  const boot = document.getElementById('bootLine');
  const start = document.getElementById('startBtn') as HTMLButtonElement | null;
  if (label) label.textContent = 'SYSTEM FAULT';
  if (note) note.textContent = message;
  if (boot) boot.textContent = 'fatal: lyric core could not be mounted.';
  if (start) start.disabled = true;
  const loadLabel = document.getElementById('loadLabel');
  const loadDetail = document.getElementById('loadDetail');
  if (loadLabel) loadLabel.textContent = 'LOAD ERROR';
  if (loadDetail) loadDetail.textContent = message;
  console.error(message);
}

async function boot(): Promise<void> {
  const audioElement = document.getElementById('song') as HTMLAudioElement;
  const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement;

  let song: SongData;
  let waveform: WaveformData;
  try {
    [song, waveform] = await Promise.all([
      fetchJson<SongData>(`${import.meta.env.BASE_URL}data/lyrics.json`),
      fetchJson<WaveformData>(`${import.meta.env.BASE_URL}data/waveform.json`),
    ]);
  } catch (error) {
    fatal(error instanceof Error ? error.message : 'Lyric data failed to load.');
    return;
  }

  const cues = song.cues;
  const audio = new AudioEngine(audioElement);
  let stage: MMDTheatre | null = null;
  const section = sectionAt(0);
  let stageReady = false;
  let endTimeout: number | null = null;

  const state: RuntimeState = {
    started: false,
    playing: false,
    ended: false,
    freeCamera: false,
    section,
    activeCue: null,
    lastCueShown: null,
  };

  let ui: UI;

  function updateSectionUI(nextSection: Section, force = false): void {
    if (!force && nextSection.id === state.section.id && state.started) return;
    state.section = nextSection;
    ui.setSection(nextSection, force);
  }

  function triggerCue(cue: Cue, sectionForCue: Section, force = false): void {
    ui.showCue(cue, force);
    const stampWorthy = cue.keyword || cue.en === 'world.execute(me);';
    const intense = ['illegal', 'execution', 'only', 'final'].includes(sectionForCue.id);
    if (stampWorthy) {
      stage?.triggerImpact(intense ? 1.15 : 0.52);
      if (intense) {
        stage?.triggerCut(intense ? 0.95 : 0.6);
        ui.pulseImpact(0.9);
      }
    }
  }

  function updateContent(time: number, force = false): void {
    const nextSection = sectionAt(time);
    if (force || nextSection.id !== state.section.id) {
      updateSectionUI(nextSection, force);
    }

    const active = cueAt(cues, time);
    const last = lastCueAt(cues, time);
    const inLongGap = !active && (!last || time - last.end > 1.8);

    if (active) {
      if (force || active.index !== state.lastCueShown) {
        triggerCue(active, nextSection, force);
        state.lastCueShown = active.index;
      }
      state.activeCue = active;
    } else if (inLongGap) {
      state.activeCue = null;
      ui.showIdle(nextSection);
    } else {
      state.activeCue = null;
    }

    ui.updatePlayback(time, audio.duration, active);
  }

  function setPlaying(playing: boolean): void {
    state.playing = playing;
    ui.setPlaying(playing);
  }

  async function enterSimulation(): Promise<void> {
    if (!stageReady) {
      return;
    }
    if (state.started) return;
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    if (startBtn) startBtn.disabled = true;
    try {
      await audio.start();
      state.started = true;
      state.playing = true;
      state.ended = false;
      stage?.syncTo(0);
      stage?.triggerImpact(0.55);
      ui.hideIntro();
      ui.setStartReady(true);
      setPlaying(true);
      const requestedTime = Number(new URLSearchParams(window.location.search).get('t'));
      if (Number.isFinite(requestedTime) && requestedTime > 0) {
        seekTo(Math.min(requestedTime, audio.duration - 0.25));
      }
    } catch (error) {
      console.error('Playback could not start.', error);
      if (startBtn) startBtn.disabled = false;
      ui.showError('浏览器阻止了音频播放，请再次点击开始。');
    }
  }

  async function togglePlay(): Promise<void> {
    if (!state.started) {
      await enterSimulation();
      return;
    }
    if (state.ended || audioElement.ended) {
      await replay();
      return;
    }
    if (state.playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      if (state.activeCue) {
        stage?.syncTo(audio.currentTime);
      }
      setPlaying(true);
      stage?.triggerImpact(0.22);
    } catch (error) {
      console.error(error);
      ui.showError('音频无法继续播放。');
    }
  }

  function seekTo(time: number): void {
    if (!state.started) return;
    const duration = audio.duration;
    const target = Math.min(Math.max(time, 0), duration - 0.1);
    state.ended = false;
    ui.hideEnding();
    if (endTimeout !== null) {
      window.clearTimeout(endTimeout);
      endTimeout = null;
    }
    audio.seek(target);
    stage?.syncTo(target);
    state.lastCueShown = null;
    updateContent(target, true);
    setPlaying(!audioElement.paused);
  }

  async function replay(): Promise<void> {
    if (endTimeout !== null) {
      window.clearTimeout(endTimeout);
      endTimeout = null;
    }
    state.ended = false;
    ui.hideEnding();
    state.lastCueShown = null;
    audio.seek(0);
    stage?.syncTo(0);
    updateContent(0, true);
    try {
      await audio.play();
      setPlaying(true);
      stage?.triggerImpact(0.4);
    } catch (error) {
      console.error(error);
      ui.showError('无法重新开始播放。');
    }
  }

  function restart(): void {
    if (!state.started) {
      void enterSimulation();
      return;
    }
    seekTo(0);
    void audio.play();
    setPlaying(true);
  }

  function toggleCamera(): void {
    state.freeCamera = !state.freeCamera;
    stage?.setFreeCamera(state.freeCamera);
    ui.setFreeCamera(state.freeCamera);
  }

  function toggleMute(): void {
    const muted = !audio.muted;
    audio.setMuted(muted);
    ui.setMuted(muted);
  }

  function toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((error) => console.warn(error));
    } else {
      document.exitFullscreen().catch((error) => console.warn(error));
    }
  }

  ui = new UI(waveform, {
    onStart: () => void enterSimulation(),
    onTogglePlay: () => void togglePlay(),
    onSeek: (time) => seekTo(time),
    onRestart: () => restart(),
    onToggleCamera: () => toggleCamera(),
    onToggleMute: () => toggleMute(),
    onFullscreen: () => toggleFullscreen(),
    onReplay: () => void replay(),
  });

  ui.setMuted(false);
  ui.setFreeCamera(false);
  updateSectionUI(section, true);

  try {
    stage = new MMDTheatre(canvas);
    await stage.load((info) => {
      ui.setLoadProgress(info.progress, info.label, info.detail);
    });
    stageReady = stage.isReady;
    if (stageReady) {
      ui.setStartReady(true);
    } else {
      ui.setStartReady(true);
    }
  } catch (error) {
    console.error('Visual stage failed to initialize.', error);
    ui.showSceneFallback(
      error instanceof Error
        ? `${error.message} — lyric playback and controls remain available.`
        : 'WebGL 或 MMD 资源无法载入。',
    );
    ui.showError('视觉核心离线，音频与歌词控制仍可使用。');
    ui.setStartReady(true);
    stage = null;
    stageReady = true;
  }

  window.setTimeout(() => {
    const note = document.getElementById('startNote');
    if (note && !note.textContent?.includes('Playback')) {
      note.textContent = 'Playback 3:31 · lyric sync · MMD physics';
    }
  }, 2200);

  audioElement.addEventListener('ended', () => {
    if (!state.started) return;
    if (endTimeout !== null) window.clearTimeout(endTimeout);
    endTimeout = window.setTimeout(() => {
      state.ended = true;
      setPlaying(false);
      stage?.triggerImpact(1.25);
      ui.showEnding();
    }, 620);
    state.ended = true;
  });

  audioElement.addEventListener('error', () => {
    ui.showError('音频文件无法载入，请确认 public/audio/world-execute-me.m4a 存在。');
  });

  window.addEventListener('pointermove', (event) => {
    if (state.freeCamera) {
      stage?.setPointer(0, 0);
      return;
    }
    stage?.setPointer((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const credits = document.getElementById('creditsDialog') as HTMLDialogElement | null;
    if (credits?.open) return;
    if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (!state.started) return;
      seekTo(audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
    } else if (event.key.toLowerCase() === 'c') {
      if (state.started) toggleCamera();
    } else if (event.key.toLowerCase() === 'm') {
      toggleMute();
    } else if (event.key.toLowerCase() === 'f') {
      toggleFullscreen();
    }
  });

  window.addEventListener('resize', () => {
    stage?.resize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.started && !state.ended) {
      stage?.syncTo(audio.currentTime);
    }
  });

  const durationSafe = waveform.duration || 211.907;
  document.getElementById('timeTotal')!.textContent = new Date(durationSafe * 1000).toISOString().slice(14, 19);

  let lastNow = performance.now();
  function frameLoop(now: number): void {
    const dt = Math.min(0.052, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    if (!stage) {
      requestAnimationFrame(frameLoop);
      return;
    }

    if (state.started) {
      const time = audio.currentTime;
      if (!state.ended) {
        updateContent(time);
      }
      const levels = state.ended ? EMPTY_LEVELS : audio.sample(dt);
      if (levels.beat > 0 && !state.ended) {
        stage.triggerBeat(levels.beatStrength);
      }
      const frame: StageFrame = {
        time,
        dt: state.ended ? 0 : dt,
        section: state.section,
        cue: state.activeCue,
        levels,
        started: true,
        playing: state.playing && !state.ended,
      };
      stage.update(frame);
      stage.render(frame.dt);
      ui.setLevels(levels);

      if (!state.ended && (audioElement.ended || time >= audio.duration - 0.08)) {
        // The audio element's ended event handles the ending overlay.
      }
    } else {
      const introSection = sections[0];
      const levels = audio.sample(dt);
      const introFrame: StageFrame = {
        time: 0,
        dt,
        section: introSection,
        cue: null,
        levels,
        started: false,
        playing: false,
      };
      stage.update(introFrame);
      stage.render(dt);
      ui.setLevels(EMPTY_LEVELS);
      if (Math.floor(now / 240) % 2 === 0) {
        ui.updatePlayback(0, durationSafe, null);
      }
    }

    requestAnimationFrame(frameLoop);
  }

  window.__WORLD_EXECUTE_ME__ = {
    get state() {
      return {
        started: state.started,
        playing: state.playing,
        ended: state.ended,
        freeCamera: state.freeCamera,
        section: state.section.id,
        activeCue: state.activeCue?.en ?? null,
        time: audio.currentTime,
        duration: audio.duration,
        stage: stage?.getDebugState() ?? null,
      };
    },
    stage,
    ui,
    audio,
    enter: enterSimulation,
    seek: (time: number) => seekTo(time),
    pause: () => {
      audio.pause();
      setPlaying(false);
    },
    play: async () => {
      await audio.play();
      setPlaying(true);
    },
    setCamera: (free: boolean) => {
      state.freeCamera = free;
      stage?.setFreeCamera(free);
      ui.setFreeCamera(free);
    },
  };

  requestAnimationFrame(frameLoop);
}

boot().catch((error) => {
  console.error(error);
  fatal(error instanceof Error ? error.message : 'Unknown boot failure.');
});
