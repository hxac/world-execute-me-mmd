/*
 * Rebuilds the derived local data:
 *   - SRT → public/data/lyrics.json
 *   - FLAC → public/audio/world-execute-me.m4a
 *   - FLAC → public/data/waveform.json
 *   - VMD  → public/data/motion.json
 *
 * Requires ffmpeg on PATH. Run with: npm run prepare:data
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const srtPath = resolve(root, 'Mili.world.execute(me).srt');
const flacPath = resolve(root, 'Mili.world.execute(me).flac');
const tempRawPath = resolve(root, '.cache-wave.raw');

if (!existsSync(srtPath) || !existsSync(flacPath)) {
  console.error('Place the source .srt and .flac files in the project root first.');
  process.exit(1);
}

mkdirSync(resolve(root, 'public/data'), { recursive: true });
mkdirSync(resolve(root, 'public/audio'), { recursive: true });

console.log('Encoding AAC preview audio…');
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    flacPath,
    '-map',
    '0:a',
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    resolve(root, 'public/audio/world-execute-me.m4a'),
  ],
  { stdio: 'inherit' },
);

console.log('Decoding low-rate audio for waveform analysis…');
try {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      flacPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '4000',
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      tempRawPath,
    ],
    { stdio: 'inherit' },
  );

  const srt = readFileSync(srtPath, 'utf8').replace(/\r/g, '');
  const raw = readFileSync(tempRawPath);

  const seconds = (time) => {
    const [h, m, rest] = time.split(':');
    const [s, ms] = rest.split(',');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };

  const cues = srt
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n');
      const index = Number(lines[0]);
      const [startText, endText] = lines[1].split('-->').map((s) => s.trim());
      const body = lines.slice(2).filter(Boolean);
      const en = body[0] ?? '';
      const zh = body.slice(1).join(' ') ?? '';
      const letters = en.replace(/[^A-Za-z]/g, '');
      const isUpper = letters.length > 1 && letters === letters.toUpperCase();
      return {
        index,
        start: Number(seconds(startText).toFixed(3)),
        end: Number(seconds(endText).toFixed(3)),
        en,
        zh,
        keyword: isUpper,
      };
    });

  writeFileSync(
    resolve(root, 'public/data/lyrics.json'),
    JSON.stringify({ source: 'Mili — world.execute(me);', cues }, null, 2),
    'utf8',
  );

  // A compact, locally generated waveform for the seek bar.
  const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const buckets = 240;
  const bucketSize = Math.floor(samples.length / buckets);
  const peaks = [];
  for (let i = 0; i < buckets; i += 1) {
    let sum = 0;
    let peak = 0;
    const offset = i * bucketSize;
    for (let j = 0; j < bucketSize; j += 1) {
      const v = Math.abs(samples[offset + j] ?? 0) / 32768;
      sum += v * v;
      peak = Math.max(peak, v);
    }
    const rms = Math.sqrt(sum / Math.max(1, bucketSize));
    peaks.push(Number(Math.min(1, (rms * 2.8 + peak * 0.35) ** 0.72).toFixed(3)));
  }
  writeFileSync(
    resolve(root, 'public/data/waveform.json'),
    JSON.stringify({ peaks, duration: 211.906667 }, null, 2),
    'utf8',
  );

  // Read the MMD metadata needed for diagnostics and animation fallback timing.
  const vmd = readFileSync(resolve(root, 'public/mmd/wavefile_v2.vmd'));
  let cursor = 30 + 20;
  const boneCount = vmd.readUInt32LE(cursor);
  cursor += 4;
  let maxFrame = 0;
  const boneNames = new Set();
  const decoder = new TextDecoder('shift-jis');
  for (let i = 0; i < boneCount; i += 1) {
    const name = decoder.decode(vmd.subarray(cursor, cursor + 15)).replace(/\0.*$/, '');
    cursor += 15;
    const frame = vmd.readUInt32LE(cursor);
    cursor += 4 + 12 + 16 + 64;
    maxFrame = Math.max(maxFrame, frame);
    boneNames.add(name);
  }
  const morphCount = vmd.readUInt32LE(cursor);
  writeFileSync(
    resolve(root, 'public/data/motion.json'),
    JSON.stringify(
      {
        boneKeyframes: boneCount,
        morphKeyframes: morphCount,
        maxFrame,
        duration: Number((maxFrame / 30).toFixed(3)),
        bones: [...boneNames],
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`cues: ${cues.length}`);
  console.log(`keywords: ${cues.filter((cue) => cue.keyword).length}`);
  console.log(`peaks: ${peaks.length}`);
  console.log(
    `motion: ${boneCount} bone keys, ${morphCount} morph keys, ${(maxFrame / 30).toFixed(2)}s`,
  );
} finally {
  rmSync(tempRawPath, { force: true });
}
