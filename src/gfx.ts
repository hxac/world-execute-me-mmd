export type Ctx = CanvasRenderingContext2D;

export const TAU = Math.PI * 2;

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

export const invLerp = (from: number, to: number, value: number): number =>
  from === to ? 0 : clamp((value - from) / (to - from));

export const smoothstep = (value: number): number => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

export const easeOutCubic = (value: number): number => 1 - Math.pow(1 - clamp(value), 3);

export const easeOutExpo = (value: number): number =>
  clamp(value) === 1 ? 1 : 1 - Math.pow(2, -10 * clamp(value));

export const easeInOutCubic = (value: number): number => {
  const x = clamp(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash01(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function hexToRgba(hex: string, alpha = 1): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha)})`;
}

export function mixHex(from: string, to: string, amount: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '');
    const value = Number.parseInt(clean, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = parse(from);
  const b = parse(to);
  const t = clamp(amount);
  return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(
    lerp(a[1], b[1], t),
  )}, ${Math.round(lerp(a[2], b[2], t))})`;
}

export function setFont(
  ctx: Ctx,
  size: number,
  family: 'display' | 'serif' | 'mono',
  weight: 300 | 400 | 500 = 400,
  italic = false,
): void {
  const stack =
    family === 'display'
      ? 'Anton, Impact, sans-serif'
      : family === 'serif'
        ? '"Instrument Serif", Georgia, serif'
        : '"IBM Plex Mono", Consolas, monospace';
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.max(1, size)}px ${stack}`;
}

export function measureTracked(ctx: Ctx, text: string, trackingPx: number): number {
  let width = 0;
  for (const char of text) width += ctx.measureText(char).width;
  return width + Math.max(0, text.length - 1) * trackingPx;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TrackedTextOptions {
  tracking?: number;
  align?: TextAlign;
  alpha?: number;
  color?: string;
  stroke?: boolean;
  strokeWidth?: number;
}

/** Draws glyph by glyph, preserving full control over tracking. */
export function drawTracked(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  options: TrackedTextOptions = {},
): number {
  const tracking = options.tracking ?? 0;
  const align = options.align ?? 'left';
  const width = measureTracked(ctx, text, tracking);
  let cursor =
    align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;

  ctx.save();
  ctx.globalAlpha *= options.alpha ?? 1;
  if (options.color) {
    if (options.stroke) ctx.strokeStyle = options.color;
    else ctx.fillStyle = options.color;
  }
  ctx.textAlign = 'left';
  if (options.stroke) ctx.lineWidth = options.strokeWidth ?? 1;

  for (const char of text) {
    if (char !== ' ') {
      if (options.stroke) ctx.strokeText(char, cursor, y);
      else ctx.fillText(char, cursor, y);
    }
    cursor += ctx.measureText(char).width + tracking;
  }
  ctx.restore();
  return width;
}

export function fitFontSize(
  ctx: Ctx,
  text: string,
  family: 'display' | 'serif' | 'mono',
  maxWidth: number,
  maxSize: number,
  weight: 300 | 400 | 500 = 400,
  italic = false,
  trackingEm = 0,
): number {
  setFont(ctx, maxSize, family, weight, italic);
  const width = measureTracked(ctx, text, trackingEm * maxSize);
  if (width <= maxWidth || width === 0) return maxSize;
  return maxSize * (maxWidth / width);
}

export function fitFittedText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  family: 'display' | 'serif' | 'mono',
  weight: 300 | 400 | 500 = 400,
  italic = false,
  trackingEm = 0,
  align: TextAlign = 'center',
  color = '#f2eadc',
  alpha = 1,
  stroke = false,
): number {
  const size = fitFontSize(ctx, text, family, maxWidth, maxSize, weight, italic, trackingEm);
  setFont(ctx, size, family, weight, italic);
  drawTracked(ctx, text, x, y, {
    tracking: trackingEm * size,
    align,
    color,
    alpha,
    stroke,
    strokeWidth: Math.max(1, size * 0.012),
  });
  return size;
}

export function drawCross(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
  weight = 1,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x - size * 0.28, y);
  ctx.moveTo(x + size * 0.28, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y - size * 0.28);
  ctx.moveTo(x, y + size * 0.28);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

export function drawGrid(
  ctx: Ctx,
  width: number,
  height: number,
  gap: number,
  color: string,
  alpha: number,
  offsetX = 0,
  offsetY = 0,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startX = ((offsetX % gap) + gap) % gap;
  const startY = ((offsetY % gap) + gap) % gap;
  for (let x = startX; x < width; x += gap) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = startY; y < height; y += gap) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

export interface HeartPoint {
  x: number;
  y: number;
}

export function heartPoint(t: number): HeartPoint {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x: x / 18, y: -y / 18 };
}

export function heartPoints(count: number, phase = 0): HeartPoint[] {
  return Array.from({ length: count }, (_, i) => heartPoint((i / count) * TAU + phase));
}

export function drawHeartLine(
  ctx: Ctx,
  centerX: number,
  centerY: number,
  scale: number,
  color: string,
  progress = 1,
  alpha = 1,
  lineWidth = 1,
  rotation = 0,
): void {
  const count = 220;
  const steps = Math.max(2, Math.floor(count * clamp(progress)));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const point = heartPoint((i / count) * TAU - Math.PI / 2);
    const x = point.x * scale;
    const y = point.y * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function polar(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  };
}

export function line(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
