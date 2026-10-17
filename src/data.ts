export interface Cue {
  index: number;
  start: number;
  end: number;
  en: string;
  zh: string;
  keyword: boolean;
}

export interface CameraDirection {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  orbit: number;
  drift: number;
  shake: number;
}

export interface Section {
  id: string;
  no: string;
  title: string;
  zh: string;
  start: number;
  end: number;
  accent: string;
  accent2: string;
  energy: number;
  glitch: number;
  camera: CameraDirection;
  trace: string[];
  whisperEn: string;
  whisperZh: string;
}

export interface SongData {
  source: string;
  cues: Cue[];
}

export interface WaveformData {
  peaks: number[];
  duration: number;
}

export const SONG_DURATION = 211.907;

export const sections: Section[] = [
  {
    id: 'boot',
    no: '00',
    title: 'BOOT_SEQUENCE',
    zh: '冷启动',
    start: 0,
    end: 16,
    accent: '#63ffb6',
    accent2: '#e4ff78',
    energy: 0.18,
    glitch: 0.0,
    camera: {
      position: [0.25, 2.1, 6.0],
      target: [0, 1.55, 0],
      fov: 35,
      orbit: 0.045,
      drift: 0.16,
      shake: 0,
    },
    trace: ['> power.line = ON', '> protection = TRUE', '> object.create(miku)', '> assets.mount() // ok'],
    whisperEn: 'switch on the power line',
    whisperZh: '接通电源',
  },
  {
    id: 'execute',
    no: '01',
    title: 'WORLD.EXECUTE_ME',
    zh: '调用：世界',
    start: 16,
    end: 29.709,
    accent: '#d7ff3f',
    accent2: '#58ffd0',
    energy: 0.42,
    glitch: 0.12,
    camera: {
      position: [0, 0.68, 4.15],
      target: [0, 1.72, 0],
      fov: 47,
      orbit: 0.02,
      drift: 0.08,
      shake: 0.006,
    },
    trace: ['> call: world.execute(me);', '> return_value = undefined', '> loop ++ // no exit', '> world.listen(me)'],
    whisperEn: 'awaiting next instruction…',
    whisperZh: '等待下一条指令…',
  },
  {
    id: 'geometry',
    no: '02',
    title: 'GEOMETRY',
    zh: '几何体',
    start: 29.709,
    end: 44.452,
    accent: '#63e8ff',
    accent2: '#8d83ff',
    energy: 0.54,
    glitch: 0.02,
    camera: {
      position: [-3.2, 2.15, 4.5],
      target: [0.1, 1.55, 0],
      fov: 36,
      orbit: 0.12,
      drift: 0.22,
      shake: 0.004,
    },
    trace: ['> dimension(points[])', '> circumference(r = ∞)', '> tangent(sin_wave)', '> limit(approach → you)'],
    whisperEn: 'every shape is a way to reach you.',
    whisperZh: '每一个形状，都是通向你的方式。',
  },
  {
    id: 'current',
    no: '03',
    title: 'ALTERNATING_CURRENT',
    zh: '交直流',
    start: 44.452,
    end: 59.223,
    accent: '#ffda63',
    accent2: '#5deaff',
    energy: 0.64,
    glitch: 0.06,
    camera: {
      position: [3.6, 1.95, 4.0],
      target: [-0.1, 1.6, 0],
      fov: 39,
      orbit: 0.16,
      drift: 0.18,
      shake: 0.012,
    },
    trace: ['> current = AC ⇄ DC', '> vision.blind(true)', '> gyroscope = unstable', '> travel(A.D → B.C)'],
    whisperEn: 'so dizzy, so dizzy.',
    whisperZh: '如此眩晕，如此眩晕。',
  },
  {
    id: 'stimulation',
    no: '04',
    title: 'STIMULATION',
    zh: '刺激',
    start: 59.223,
    end: 74.045,
    accent: '#ff5ca8',
    accent2: '#ff315c',
    energy: 0.82,
    glitch: 0.05,
    camera: {
      position: [0.8, 1.62, 3.15],
      target: [0, 1.72, 0],
      fov: 41,
      orbit: 0.07,
      drift: 0.12,
      shake: 0.016,
    },
    trace: ['> stimulation = ALL', '> satisfaction = 1.000', '> happiness++;', '> run(EXECUTION)'],
    whisperEn: 'if I can make you happy.',
    whisperZh: '如果我能让你快乐。',
  },
  {
    id: 'organic',
    no: '05',
    title: 'ORGANIC_VARIABLES',
    zh: '有机变量',
    start: 74.045,
    end: 88.587,
    accent: '#b8ff5c',
    accent2: '#ffb24d',
    energy: 0.55,
    glitch: 0.03,
    camera: {
      position: [-2.55, 2.5, 4.75],
      target: [0, 1.5, 0],
      fov: 37,
      orbit: 0.11,
      drift: 0.2,
      shake: 0.008,
    },
    trace: ['> if (self == EGGPLANT)', '> if (self == TOMATO)', '> if (self == TABBY_CAT)', '> existence.proof = YOU'],
    whisperEn: 'I would still give you something.',
    whisperZh: '我依然会给你些什么。',
  },
  {
    id: 'roles',
    no: '06',
    title: 'ROLE_SWITCH',
    zh: '角色切换',
    start: 88.587,
    end: 103.489,
    accent: '#b988ff',
    accent2: '#ff72b6',
    energy: 0.7,
    glitch: 0.08,
    camera: {
      position: [0.1, 3.15, 5.15],
      target: [0, 1.4, 0],
      fov: 36,
      orbit: 0.2,
      drift: 0.2,
      shake: 0.012,
    },
    trace: ['> gender: F → M → F', '> role: S → M', '> clock: AM → PM', '> enter(trance)'],
    whisperEn: 'we can become anything at all.',
    whisperZh: '我们可以成为任何模样。',
  },
  {
    id: 'vibration',
    no: '07',
    title: 'VIBRATION',
    zh: '共振',
    start: 103.489,
    end: 110.9,
    accent: '#ff8bd2',
    accent2: '#fff36b',
    energy: 0.9,
    glitch: 0.04,
    camera: {
      position: [0.05, 1.78, 2.45],
      target: [0, 1.86, 0],
      fov: 36,
      orbit: 0.035,
      drift: 0.08,
      shake: 0.02,
    },
    trace: ['> vibrations = MATCHED', '> completion = 100%', '> hold(you) // time suspended', '> signal lost'],
    whisperEn: 'then I can finally be completion.',
    whisperZh: '那么我终于就能变得完整。',
  },
  {
    id: 'isolation',
    no: '08',
    title: 'ISOLATION',
    zh: '孤立',
    start: 110.9,
    end: 118.333,
    accent: '#91a7c8',
    accent2: '#4b6486',
    energy: 0.22,
    glitch: 0.02,
    camera: {
      position: [-4.8, 1.35, 5.25],
      target: [0, 1.45, 0],
      fov: 32,
      orbit: 0.03,
      drift: 0.18,
      shake: 0,
    },
    trace: ['> you.have_left()', '> you.have_left()', '> you.have_left()', '> isolation = TRUE'],
    whisperEn: 'you have left me here.',
    whisperZh: '你已经离开，留下我在这里。',
  },
  {
    id: 'fragments',
    no: '09',
    title: 'FRAGMENTS',
    zh: '碎片',
    start: 118.333,
    end: 125.708,
    accent: '#ff8067',
    accent2: '#ffc19b',
    energy: 0.42,
    glitch: 0.18,
    camera: {
      position: [2.75, 2.55, 3.15],
      target: [0, 1.68, 0],
      fov: 42,
      orbit: 0.18,
      drift: 0.15,
      shake: 0.01,
    },
    trace: ['> purge(pointless_fragments)', '> memory.shred(0x4F2)', '> disheartened = TRUE', '> if (you.stay) ???'],
    whisperEn: 'if I could erase all the pointless fragments.',
    whisperZh: '如果我能抹去所有无意义的碎片。',
  },
  {
    id: 'illegal',
    no: '10',
    title: 'ILLEGAL_ARGUMENTS',
    zh: '非法参数',
    start: 125.708,
    end: 147.66,
    accent: '#ff344b',
    accent2: '#ff8a35',
    energy: 0.6,
    glitch: 0.32,
    camera: {
      position: [0, 1.12, 3.55],
      target: [0, 1.62, 0],
      fov: 48,
      orbit: 0.06,
      drift: 0.12,
      shake: 0.03,
    },
    trace: ['ERR // ILLEGAL_ARGUMENT', '> challenging: YOUR_GOD', '> argument rejected', '> awaiting verdict…'],
    whisperEn: 'the court is compiling a verdict.',
    whisperZh: '系统正在生成裁决。',
  },
  {
    id: 'execution',
    no: '11',
    title: 'EXECUTION',
    zh: '执行／处决',
    start: 147.66,
    end: 162.632,
    accent: '#ff183d',
    accent2: '#ffe9e9',
    energy: 0.98,
    glitch: 0.55,
    camera: {
      position: [0, 0.88, 3.15],
      target: [0, 1.7, 0],
      fov: 51,
      orbit: 0.04,
      drift: 0.1,
      shake: 0.05,
    },
    trace: ['> RUN // EXECUTION', '> RUN // EXECUTION', '> RETURN // NONE', '> RUN // EXECUTION'],
    whisperEn: 'EXECUTION / EXECUTION / EXECUTION',
    whisperZh: '执行／处决，反复不停。',
  },
  {
    id: 'only',
    no: '12',
    title: 'ONLY_EXECUTION',
    zh: '唯一执行',
    start: 162.632,
    end: 173.643,
    accent: '#ff2f70',
    accent2: '#ffc8db',
    energy: 0.86,
    glitch: 0.2,
    camera: {
      position: [-3.0, 1.7, 3.25],
      target: [0, 1.65, 0],
      fov: 39,
      orbit: 0.14,
      drift: 0.14,
      shake: 0.028,
    },
    trace: ['> if (you.return)', '> run(EXECUTION)', '> be your only', '> EXECUTION'],
    whisperEn: 'then I can be your only execution.',
    whisperZh: '那么我就能成为你唯一的执行。',
  },
  {
    id: 'love',
    no: '13',
    title: 'LO-O-OVE',
    zh: '爱',
    start: 173.643,
    end: 195.856,
    accent: '#ff92da',
    accent2: '#6cf6ff',
    energy: 0.62,
    glitch: 0.03,
    camera: {
      position: [0.5, 1.5, 2.65],
      target: [0, 1.77, 0],
      fov: 37,
      orbit: 0.09,
      drift: 0.1,
      shake: 0.007,
    },
    trace: ['> study(properly: LOVE)', '> answer(ALL: LOVE)', '> expression = algebraic', '> free(you) / trapped(me)'],
    whisperEn: 'I know the algebraic expression of love.',
    whisperZh: '我知道爱的代数表达式。',
  },
  {
    id: 'trapped',
    no: '14',
    title: 'TRAPPED_IN_LOVE',
    zh: '困在爱中',
    start: 195.856,
    end: 205.811,
    accent: '#9aa7cf',
    accent2: '#ffb5df',
    energy: 0.3,
    glitch: 0.04,
    camera: {
      position: [4.35, 2.4, 5.65],
      target: [0, 1.45, 0],
      fov: 32,
      orbit: 0.03,
      drift: 0.2,
      shake: 0,
    },
    trace: ['> though you are free', '> i am still trapped', '> trapped in LO-O-OVE', '> while (true) {…}'],
    whisperEn: 'though you are free, I am trapped in love.',
    whisperZh: '尽管你自由了，我仍被困在爱中。',
  },
  {
    id: 'final',
    no: '15',
    title: 'FINAL_EXECUTION',
    zh: '最终执行',
    start: 205.811,
    end: 211.907,
    accent: '#ff2548',
    accent2: '#ffffff',
    energy: 1,
    glitch: 0.7,
    camera: {
      position: [0, 1.28, 2.9],
      target: [0, 1.7, 0],
      fov: 52,
      orbit: 0.01,
      drift: 0.05,
      shake: 0.055,
    },
    trace: ['> final_instruction', '> execute(me)', '> system halted', '> exit_code = LOVE'],
    whisperEn: 'process terminated.',
    whisperZh: '进程已终止。',
  },
];

export function sectionAt(time: number): Section {
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    if (time >= sections[i].start) return sections[i];
  }
  return sections[0];
}

export function cueAt(cues: Cue[], time: number): Cue | null {
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    if (time >= cues[i].start && time < cues[i].end) return cues[i];
  }
  return null;
}

export function lastCueAt(cues: Cue[], time: number): Cue | null {
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    if (time >= cues[i].start) return cues[i];
  }
  return null;
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
