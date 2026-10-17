import { LYRICS, type LyricCue } from './lyrics';

export type ActId =
  | 'genesis'
  | 'execute'
  | 'geometry'
  | 'signal'
  | 'devotion'
  | 'specimens'
  | 'trance'
  | 'departure'
  | 'erasure'
  | 'protocol'
  | 'judgment'
  | 'love'
  | 'afterimage';

export interface Act {
  index: number;
  id: ActId;
  roman: string;
  title: string;
  subtitle: string;
  start: number;
  end: number;
  accent: string;
  secondary: string;
  light?: boolean;
}

export const TRACK_DURATION = 211.906667;

export const ACTS: Act[] = [
  {
    index: 1,
    id: 'genesis',
    roman: 'I',
    title: 'GENESIS',
    subtitle: 'power / protection / object creation',
    start: 0,
    end: 16,
    accent: '#9bf6e8',
    secondary: '#ff4d2d',
  },
  {
    index: 2,
    id: 'execute',
    roman: 'II',
    title: 'EXECUTE',
    subtitle: 'a world, invoked by name',
    start: 16,
    end: 29.709,
    accent: '#ff4d2d',
    secondary: '#9bf6e8',
  },
  {
    index: 3,
    id: 'geometry',
    roman: 'III',
    title: 'GEOMETRY',
    subtitle: 'the shape of what I can give',
    start: 29.709,
    end: 44.452,
    accent: '#8de8ff',
    secondary: '#ff4d2d',
  },
  {
    index: 4,
    id: 'signal',
    roman: 'IV',
    title: 'SIGNAL',
    subtitle: 'AC / DC / blind / dizzy',
    start: 44.452,
    end: 59.223,
    accent: '#ff5a36',
    secondary: '#d8fff9',
  },
  {
    index: 5,
    id: 'devotion',
    roman: 'V',
    title: 'DEVOTION',
    subtitle: 'a gift, expressed in Hertz',
    start: 59.223,
    end: 71.764,
    accent: '#ff9aae',
    secondary: '#8de8ff',
  },
  {
    index: 6,
    id: 'specimens',
    roman: 'VI',
    title: 'SPECIMENS',
    subtitle: 'nutrients / antioxidants / a purr',
    start: 71.764,
    end: 88.587,
    accent: '#653cff',
    secondary: '#ff4d2d',
    light: true,
  },
  {
    index: 7,
    id: 'trance',
    roman: 'VII',
    title: 'TRANCE',
    subtitle: 'F / M · AM / PM · S / M',
    start: 88.587,
    end: 103.49,
    accent: '#ff4b2b',
    secondary: '#f3e8d5',
  },
  {
    index: 8,
    id: 'departure',
    roman: 'VIII',
    title: 'DEPARTURE',
    subtitle: 'a signal that does not return',
    start: 103.49,
    end: 118.333,
    accent: '#8aa6ff',
    secondary: '#efeee8',
  },
  {
    index: 9,
    id: 'erasure',
    roman: 'IX',
    title: 'ERASURE',
    subtitle: 'fragments / errors / arguments',
    start: 118.333,
    end: 135.724,
    accent: '#ff3c27',
    secondary: '#f2e6d4',
  },
  {
    index: 10,
    id: 'protocol',
    roman: 'X',
    title: 'PROTOCOL',
    subtitle: 'the god program answers',
    start: 135.724,
    end: 147.66,
    accent: '#ff3c27',
    secondary: '#bfb7a8',
  },
  {
    index: 11,
    id: 'judgment',
    roman: 'XI',
    title: 'JUDGMENT',
    subtitle: 'execution / execution / execution',
    start: 147.66,
    end: 177.246,
    accent: '#ff2e1f',
    secondary: '#f2e6d4',
  },
  {
    index: 12,
    id: 'love',
    roman: 'XII',
    title: 'LO-O-OVE',
    subtitle: 'a closed-form expression',
    start: 177.246,
    end: 195.856,
    accent: '#ffd1b8',
    secondary: '#ff6b4e',
  },
  {
    index: 13,
    id: 'afterimage',
    roman: 'XIII',
    title: 'AFTERIMAGE',
    subtitle: 'end of simulation',
    start: 195.856,
    end: TRACK_DURATION,
    accent: '#d8cfbe',
    secondary: '#ff4d2d',
  },
];

const actStarts = ACTS.map((act) => act.start);

export function actAt(time: number): Act {
  let lo = 0;
  let hi = actStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (actStarts[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return ACTS[lo];
}

export function cueAt(time: number): LyricCue | null {
  let lo = 0;
  let hi = LYRICS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = LYRICS[mid];
    if (time < cue.start) hi = mid - 1;
    else if (time >= cue.end) lo = mid + 1;
    else return cue;
  }
  return null;
}

export function cueIndexAt(time: number): number {
  let lo = 0;
  let hi = LYRICS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = LYRICS[mid];
    if (time < cue.start) hi = mid - 1;
    else if (time >= cue.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function lastCueBefore(time: number): LyricCue | null {
  let lo = 0;
  let hi = LYRICS.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (LYRICS[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? LYRICS[found] : null;
}

const keywordPattern = /^[A-Z0-9À-Ü][A-Z0-9À-Ü\s'’.\-—:;()]{1,32}$/;

/** A lyric line that behaves as a full-screen typographic object rather than a sentence. */
export function displayWord(cue: LyricCue | null): string | null {
  if (!cue) return null;
  const value = cue.en.trim();
  if (value === 'world.execute(me);') return value;
  if (!keywordPattern.test(value)) return null;
  if (!/[A-ZÀ-Ü]{3}/.test(value)) return null;
  return value;
}

export const WORD_TRANSLATIONS: Record<string, string> = {
  PROTECTION: '防护',
  'OBJECT CREATION': '创建对象',
  INITIALIZATION: '初始化',
  SIMULATION: '模拟',
  DIMENSION: '维度',
  CIRCUMFERENCE: '周长',
  TANGENTS: '切线',
  LIMITATIONS: '极限',
  STIMULATIONS: '刺激',
  SATISFACTION: '满足',
  EXECUTION: '执行 / 处决',
  NUTRIENTS: '养分',
  ANTIOXIDANTS: '抗氧化物',
  ENJOYMENT: '欢愉',
  EXISTENCE: '证明',
  VIBRATIONS: '振动',
  COMPLETION: '完整',
  ISOLATION: '孤立',
  FRAGMENTS: '碎片',
  DISHEARTENED: '心灰意冷',
  'ILLEGAL ARGUMENTS': '非法参数',
  'LO-O-OVE': '爱',
};

export function formatClock(time: number, milliseconds = false): string {
  const safe = Math.max(0, Number.isFinite(time) ? time : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (!milliseconds) return `${mm}:${ss}`;
  const ms = Math.floor((safe % 1) * 1000);
  return `${mm}:${ss}.${String(ms).padStart(3, '0')}`;
}
