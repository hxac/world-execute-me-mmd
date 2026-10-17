import type { Levels } from './audio';
import type { Act } from './data';
import type { LyricCue } from './lyrics';
import { WORD_TRANSLATIONS, displayWord, formatClock } from './data';
import {
  TAU,
  clamp,
  drawCross,
  drawGrid,
  drawHeartLine,
  drawTracked,
  easeOutCubic,
  easeOutExpo,
  fitFontSize,
  heartPoint,
  heartPoints,
  hexToRgba,
  invLerp,
  lerp,
  measureTracked,
  mulberry32,
  polar,
  roundRect,
  setFont,
  smoothstep,
} from './gfx';

export interface StageFrame {
  time: number;
  now: number;
  act: Act;
  cue: LyricCue | null;
  levels: Levels;
  started: boolean;
  reduced: boolean;
}

interface Dust {
  x: number;
  y: number;
  z: number;
  phase: number;
  drift: number;
  size: number;
  warm: boolean;
}

interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
}

const INK = '#070706';
const PAPER = '#f1e9da';
const LIGHT_PAPER = '#e9e1d1';
const CJK_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

const round = (value: number): number => Math.round(value);

export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private pointerX = 0.5;
  private pointerY = 0.5;
  private smoothPointerX = 0.5;
  private smoothPointerY = 0.5;
  private readonly dust: Dust[];
  private readonly cube: { x: number; y: number; z: number }[];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = context;

    const random = mulberry32(21042024);
    this.dust = Array.from({ length: 170 }, () => ({
      x: random(),
      y: random(),
      z: 0.2 + random() * 0.8,
      phase: random() * TAU,
      drift: 0.2 + random() * 0.9,
      size: 0.5 + random() * 1.7,
      warm: random() > 0.82,
    }));

    const cube: { x: number; y: number; z: number }[] = [];
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        for (let z = 0; z < 6; z += 1) {
          cube.push({
            x: x / 5 - 0.5,
            y: y / 5 - 0.5,
            z: z / 5 - 0.5,
          });
        }
      }
    }
    this.cube = cube;

    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
  }

  setPointer(x: number, y: number): void {
    this.pointerX = clamp(x);
    this.pointerY = clamp(y);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, rect.width);
    this.height = Math.max(320, rect.height);
    const nativeDpr = window.devicePixelRatio || 1;
    const area = this.width * this.height;
    // Keep the drawing buffer under ~2 MP. The HUD stays sharp because it is
    // DOM; this budget only governs the moving image and keeps 60 fps within
    // reach on high-density screens and software-rendered canvases.
    const budgetDpr = Math.sqrt(1_950_000 / area);
    this.dpr = Math.min(nativeDpr, 2, Math.max(0.5, budgetDpr));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  get w(): number {
    return this.width;
  }

  get h(): number {
    return this.height;
  }

  get unit(): number {
    return Math.min(this.width, this.height);
  }

  get ui(): number {
    return clamp(this.width / 1440, 0.68, 1.28);
  }

  render(frame: StageFrame): void {
    const ctx = this.ctx;
    this.smoothPointerX += (this.pointerX - this.smoothPointerX) * 0.045;
    this.smoothPointerY += (this.pointerY - this.smoothPointerY) * 0.045;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';

    if (!frame.started) {
      this.drawIdle(frame);
    } else {
      switch (frame.act.id) {
        case 'genesis':
          this.drawGenesis(frame);
          break;
        case 'execute':
          this.drawExecute(frame);
          break;
        case 'geometry':
          this.drawGeometry(frame);
          break;
        case 'signal':
          this.drawSignal(frame);
          break;
        case 'devotion':
          this.drawDevotion(frame);
          break;
        case 'specimens':
          this.drawSpecimens(frame);
          break;
        case 'trance':
          this.drawTrance(frame);
          break;
        case 'departure':
          this.drawDeparture(frame);
          break;
        case 'erasure':
          this.drawErasure(frame);
          break;
        case 'protocol':
          this.drawProtocol(frame);
          break;
        case 'judgment':
          this.drawJudgment(frame);
          break;
        case 'love':
          this.drawLove(frame);
          break;
        case 'afterimage':
          this.drawAfterimage(frame);
          break;
      }
    }

    this.drawExit(frame);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Shared atmosphere
  // ────────────────────────────────────────────────────────────────────────────

  private fill(color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  private glow(
    x: number,
    y: number,
    radius: number,
    color: string,
    opacity: number,
  ): void {
    if (radius <= 0 || opacity <= 0) return;
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, hexToRgba(color, opacity));
    gradient.addColorStop(0.35, hexToRgba(color, opacity * 0.42));
    gradient.addColorStop(1, hexToRgba(color, 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  private dustField(
    time: number,
    color: string,
    alpha: number,
    speed = 1,
    seedOffset = 0,
  ): void {
    const ctx = this.ctx;
    const pX = (this.smoothPointerX - 0.5) * 18;
    const pY = (this.smoothPointerY - 0.5) * 12;
    ctx.save();
    for (let i = 0; i < this.dust.length; i += 1) {
      const mote = this.dust[i];
      const drift = (time * 0.004 * speed * mote.drift + mote.x + seedOffset * 0.013) % 1;
      const y = (mote.y + Math.sin(time * mote.drift * 0.35 + mote.phase) * 0.012) % 1;
      const x = (drift + 1) % 1;
      const flicker = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 1.3 + mote.phase));
      ctx.globalAlpha = alpha * (0.3 + mote.z * 0.7) * flicker;
      ctx.fillStyle = mote.warm ? '#ff7252' : color;
      ctx.fillRect(
        round(x * this.w + pX * mote.z),
        round(y * this.h + pY * mote.z),
        mote.size,
        mote.size,
      );
    }
    ctx.restore();
  }

  private mono(
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 1,
    align: 'left' | 'center' | 'right' = 'left',
    tracking = 0,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    setFont(ctx, size, 'mono', 400);
    ctx.fillStyle = color;
    ctx.globalAlpha *= alpha;
    ctx.textAlign = 'left';
    if (tracking) {
      drawTracked(ctx, text, x, y, { tracking, align, color, alpha });
    } else {
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  private cjk(
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 1,
    align: CanvasTextAlign = 'left',
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `400 ${size}px ${CJK_STACK}`;
    ctx.fillStyle = color;
    ctx.globalAlpha *= alpha;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private hairline(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    alpha = 1,
    width = 1,
    dash: number[] = [],
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha *= alpha;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  private bracket(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    alpha: number,
    corner = Math.min(width, height) * 0.16,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha *= alpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + corner);
    ctx.lineTo(x, y);
    ctx.lineTo(x + corner, y);
    ctx.moveTo(x + width - corner, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + corner);
    ctx.moveTo(x + width, y + height - corner);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + width - corner, y + height);
    ctx.moveTo(x + corner, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height - corner);
    ctx.stroke();
    ctx.restore();
  }

  private drawBigWord(
    word: string,
    x: number,
    y: number,
    maxWidth: number,
    maxSize: number,
    color: string,
    accent: string,
    reveal = 1,
    glitch = 0,
    align: 'left' | 'center' | 'right' = 'center',
    alpha = 1,
    outline = false,
    trackingEm = -0.025,
  ): number {
    if (!word || reveal <= 0 || alpha <= 0) return 0;
    const ctx = this.ctx;
    const size = fitFontSize(ctx, word, 'display', maxWidth, maxSize, 400, false, trackingEm);
    setFont(ctx, size, 'display', 400);
    const tracking = size * trackingEm;
    const width = measureTracked(ctx, word, tracking);
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    const used = clamp(reveal);
    const clipWidth = width * used;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - size * 0.12, y - size * 1.05, clipWidth + size * 0.35, size * 1.35);
    ctx.clip();

    if (glitch > 0.01) {
      const shift = glitch * size * 0.035;
      ctx.globalAlpha = alpha * 0.6;
      drawTracked(ctx, word, left + shift, y, {
        tracking,
        color: accent,
        alpha: 0.6,
        align: 'left',
      });
      ctx.globalAlpha = alpha * 0.6;
      drawTracked(ctx, word, left - shift, y - shift * 0.35, {
        tracking,
        color: '#8df7ef',
        alpha: 0.4,
        align: 'left',
      });
    }

    ctx.globalAlpha = alpha;
    drawTracked(ctx, word, left, y, {
      tracking,
      color,
      alpha: outline ? 0.9 : 1,
      stroke: outline,
      strokeWidth: Math.max(1, size * 0.011),
      align: 'left',
    });

    if (used < 1) {
      const cursorX = left + clipWidth;
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = accent;
      ctx.fillRect(cursorX + 4, y - size * 0.7, Math.max(2, size * 0.018), size * 0.7);
    }
    ctx.restore();
    return width;
  }

  private drawWordLabel(
    word: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 0.55,
  ): void {
    const translation = WORD_TRANSLATIONS[word];
    if (!translation) return;
    this.cjk(translation, x, y, size, color, alpha, 'center');
  }

  private drawSerifWord(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    maxSize: number,
    color: string,
    alpha = 1,
    align: 'left' | 'center' | 'right' = 'center',
    italic = true,
    trackingEm = -0.02,
  ): number {
    if (!text || alpha <= 0) return 0;
    const ctx = this.ctx;
    const size = fitFontSize(ctx, text, 'serif', maxWidth, maxSize, 400, italic, trackingEm);
    setFont(ctx, size, 'serif', 400, italic);
    drawTracked(ctx, text, x, y, {
      tracking: size * trackingEm,
      align,
      color,
      alpha,
    });
    return size;
  }

  private drawHazard(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    alpha: number,
    gap = 26,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(3, gap * 0.28);
    for (let i = -height; i < width + height; i += gap) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + height);
      ctx.lineTo(x + i + height, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStamp(
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha: number,
    rotation: number,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, size * 0.08);
    const width = text.length * size * 0.64 + size * 1.2;
    roundRect(ctx, -width / 2, -size * 0.85, width, size * 1.7, size * 0.12);
    ctx.stroke();
    ctx.font = `600 ${size}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.06);
    ctx.restore();
  }

  private vignette(color = 'rgba(0,0,0,0.6)'): void {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(
      this.w / 2,
      this.h * 0.48,
      this.unit * 0.18,
      this.w / 2,
      this.h * 0.48,
      Math.max(this.w, this.h) * 0.7,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,0.08)');
    gradient.addColorStop(1, color);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  private drawExit(frame: StageFrame): void {
    if (!frame.started) return;
    const ctx = this.ctx;
    const t = frame.time;
    const act = frame.act;

    if (act.id === 'execute' && t < 16.38) {
      const fade = 1 - invLerp(16, 16.38, t);
      ctx.fillStyle = `rgba(255, 245, 230, ${0.62 * fade})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (act.id === 'judgment' && t > 162.55 && t < 162.82) {
      const a = 1 - invLerp(162.55, 162.82, t);
      ctx.fillStyle = `rgba(247, 237, 222, ${0.75 * a})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (act.id === 'afterimage' && t > 209.9) {
      const a = smoothstep(invLerp(209.9, 211.6, t));
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Idle / start screen atmosphere
  // ────────────────────────────────────────────────────────────────────────────

  private drawIdle(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.now / 1000;
    this.fill('#060606');
    this.glow(w * 0.54, h * 0.45, this.unit * 0.48, '#7dece0', 0.08);
    drawGrid(ctx, w, h, 72, '#d9d3c7', 0.035, 0, t * 2);
    this.dustField(t * 0.7, '#a9f5ea', 0.36, 0.35);

    const cx = w * 0.54;
    const cy = h * 0.48;
    const radius = this.unit * 0.36;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.018);
    for (let i = 0; i < 5; i += 1) {
      const r = radius * (0.36 + i * 0.14);
      ctx.strokeStyle = i === 2 ? 'rgba(255,77,45,0.42)' : 'rgba(228,223,211,0.11)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r, i * 0.8, i * 0.8 + Math.PI * (1.15 + i * 0.08));
      ctx.stroke();
    }
    ctx.restore();

    drawCross(ctx, cx, cy, radius * 0.68, '#eee8da', 0.24);
    this.hairline(w * 0.06, h * 0.8, w * 0.94, h * 0.8, '#e8e0d2', 0.11);
    this.hairline(w * 0.06, h * 0.8, w * 0.06 + w * 0.2, h * 0.8, '#ff4d2d', 0.4);
    this.mono('STANDBY / AWAITING OPERATOR', w * 0.06, h * 0.84, 10 * this.ui, '#f0e9dc', 0.4, 'left', 1.8);

    const phrase = 'no characters · two dimensions · one attempt at love';
    this.mono(phrase.toUpperCase(), w * 0.94, h * 0.84, 9 * this.ui, '#d8d0c1', 0.34, 'right', 1.3);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // I. GENESIS
  // ────────────────────────────────────────────────────────────────────────────

  private drawGenesis(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const word = displayWord(frame.cue);
    const cueLocal = frame.cue ? t - frame.cue.start : 0;

    this.fill('#060707');
    this.glow(w * 0.5, h * 0.43, this.unit * 0.5, accent, 0.07 + levels.level * 0.05);
    this.glow(w * 0.5, h * 0.43, this.unit * 0.19, accent, 0.045 + levels.bass * 0.04);

    const gridOffset = local * 3;
    drawGrid(ctx, w, h, 48, '#e8e3d8', 0.027, gridOffset, 0);
    this.dustField(t, accent, 0.42, 0.55);

    const cx = w * 0.5 + (this.smoothPointerX - 0.5) * 20;
    const cy = h * 0.43 + (this.smoothPointerY - 0.5) * 12;
    const baseRadius = this.unit * 0.185;
    const radius = baseRadius * (1 + levels.bass * 0.055 + (word ? 0.12 : 0));
    const clock = t * 0.09 + local * 0.045;

    // Peripheral orbital marks.
    ctx.save();
    ctx.translate(cx, cy);
    for (let ring = 0; ring < 3; ring += 1) {
      const rr = radius * (1.34 + ring * 0.31);
      ctx.strokeStyle = ring === 0 ? hexToRgba(accent, 0.2) : 'rgba(235,229,216,0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash(ring === 1 ? [2, 12] : []);
      ctx.beginPath();
      ctx.arc(0, 0, rr, clock * (ring % 2 === 0 ? 1 : -1) + ring, clock * (ring % 2 === 0 ? 1 : -1) + Math.PI * (1.1 + ring * 0.4));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Tick ring.
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * TAU + clock * 0.22;
      const long = i % 4 === 0;
      const inner = radius * (long ? 1.16 : 1.19);
      const outer = radius * (long ? 1.28 : 1.23);
      const a = polar(0, 0, inner, angle);
      const b = polar(0, 0, outer, angle);
      ctx.strokeStyle = long ? hexToRgba(accent, 0.55) : 'rgba(232,227,216,0.18)';
      ctx.lineWidth = long ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Orbit focus points.
    for (let i = 0; i < 3; i += 1) {
      const a = -clock * (0.6 + i * 0.2) + i * 2.2;
      const rr = radius * (1.34 + i * 0.31);
      const p = polar(0, 0, rr, a);
      ctx.fillStyle = i === 0 ? accent : '#f0e8d8';
      ctx.globalAlpha = 0.7 - i * 0.16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 2.6 : 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Crosshair inside the core.
    const inner = radius * 0.72;
    drawCross(ctx, cx, cy, inner, '#eee7d9', 0.22);
    this.hairline(cx - radius * 0.88, cy, cx - radius * 0.32, cy, accent, 0.22);
    this.hairline(cx + radius * 0.32, cy, cx + radius * 0.88, cy, accent, 0.22);

    // Centre glyph / rotating square.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-clock * 0.4);
    const square = radius * 0.31;
    ctx.strokeStyle = hexToRgba(accent, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(-square / 2, -square / 2, square, square);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = 'rgba(240,233,219,0.18)';
    ctx.strokeRect(-square * 0.72, -square * 0.72, square * 1.44, square * 1.44);
    ctx.restore();

    // Little telemetry around the dial.
    this.mono('LAT 00.0000', cx - radius * 1.72, cy - radius * 0.52, 8.5 * this.ui, '#e9e2d4', 0.3, 'right', 0.8);
    this.mono('LON 00.0000', cx - radius * 1.72, cy - radius * 0.28, 8.5 * this.ui, '#e9e2d4', 0.3, 'right', 0.8);
    this.mono('θ ' + (clock * 12).toFixed(2).padStart(6, '0'), cx + radius * 1.7, cy - radius * 0.52, 8.5 * this.ui, hexToRgba(accent, 0.52), 1, 'left', 0.8);
    this.mono('SIGNAL ' + (62 + levels.level * 37).toFixed(1) + '%', cx + radius * 1.7, cy - radius * 0.28, 8.5 * this.ui, '#e9e2d4', 0.3, 'left', 0.8);

    // Boot ledger, revealed with the song.
    const bootLog: { at: number; text: string }[] = [
      { at: 0.05, text: 'POWER LINE .................... ON' },
      { at: 1.72, text: 'SAFETY PROTOCOL ............... ARMED' },
      { at: 3.91, text: 'PIECES .................... 1,024 / 1,024' },
      { at: 6.41, text: 'OBJECT CREATION .............. START' },
      { at: 7.47, text: 'DATA PARAMETERS .............. FILL' },
      { at: 10.13, text: 'INITIALIZATION ............... 100%' },
      { at: 11.12, text: 'NEW WORLD ..................... SET' },
      { at: 13.91, text: 'SIMULATION .................... RUN' },
    ];
    const lx = w * 0.065;
    const ly = h * 0.29;
    this.mono('BOOT / TRACE', lx, ly - h * 0.055, 9 * this.ui, accent, 0.8, 'left', 2);
    this.hairline(lx, ly - h * 0.045, lx + w * 0.2, ly - h * 0.045, '#ddd4c4', 0.22);
    for (let i = 0; i < bootLog.length; i += 1) {
      const entry = bootLog[i];
      if (t < entry.at) continue;
      const age = t - entry.at;
      const visible = Math.min(1, age * 2.8);
      const typed = Math.min(entry.text.length, Math.floor(age * 80));
      this.mono(`0${i + 1}`, lx, ly + i * (14 * this.ui), 8.5 * this.ui, accent, 0.52 * visible, 'left', 0.5);
      this.mono(entry.text.slice(0, typed), lx + w * 0.038, ly + i * (14 * this.ui), 8.5 * this.ui, '#e4dccd', (i === bootLog.length - 1 ? 0.78 : 0.4) * visible, 'left', 0.45);
    }

    // Right-hand big act number.
    ctx.save();
    setFont(ctx, this.unit * 0.4, 'display');
    ctx.fillStyle = 'rgba(241,233,218,0.028)';
    ctx.textAlign = 'right';
    ctx.fillText('01', w * 0.955, h * 0.8);
    ctx.restore();

    this.drawHorizontalPulse(cx, cy, radius, t, accent, levels);

    if (word) {
      const reveal = easeOutExpo(cueLocal / 0.36);
      const glitch = Math.max(0, 0.8 - cueLocal * 2.5) + (levels.beat > 0.6 ? 0.12 : 0);
      const size = this.drawBigWord(
        word,
        w * 0.5,
        cy + this.unit * 0.055,
        w * 0.8,
        this.unit * 0.18,
        PAPER,
        accent,
        reveal,
        glitch,
        'center',
        1 - smoothstep(invLerp(frame.cue ? frame.cue.end - 0.14 : 99, frame.cue ? frame.cue.end : 100, t)),
      );
      if (size > 0) {
        this.drawWordLabel(word, w * 0.5, cy + this.unit * 0.055 + size * 0.38, 11 * this.ui, '#e7dfd0', 0.5);
        const lineWidth = w * 0.12 * reveal;
        this.hairline(w * 0.5 - lineWidth / 2, cy + this.unit * 0.1, w * 0.5 + lineWidth / 2, cy + this.unit * 0.1, accent, 0.58, 1);
      }
    } else {
      const script = ['switch on the power line', 'remember to put on', 'lay down your pieces', "and let's begin", 'fill in my data parameters', 'set up our new world', "and let's begin the"][Math.min(6, Math.floor(local / 2.2))];
      this.mono(script, w * 0.5, cy + this.unit * 0.065, 9.5 * this.ui, '#f0e9dc', 0.33, 'center', 1.25);
    }

    if (local > 14.2) {
      const incoming = invLerp(14.2, 16, local);
      this.hairline(w * 0.5, h * 0.43 - this.unit * 0.24 * incoming, w * 0.5, h * 0.43 + this.unit * 0.24 * incoming, accent, 0.34 * incoming, 1);
      this.glow(cx, cy, this.unit * 0.1 * incoming, accent, 0.4 * incoming);
    }

    this.vignette('rgba(0,0,0,0.63)');
  }

  private drawHorizontalPulse(
    cx: number,
    cy: number,
    radius: number,
    time: number,
    color: string,
    levels: Levels,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.22 + levels.level * 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 60; i += 1) {
      const x = cx - radius * 1.75 + (i / 60) * radius * 3.5;
      const envelope = Math.sin((i / 60) * Math.PI);
      const amp = radius * 0.024 * envelope * (0.3 + levels.level);
      const y = cy + Math.sin(i * 0.7 + time * 3.3) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // II. EXECUTE
  // ────────────────────────────────────────────────────────────────────────────

  private drawExecute(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const phase = invLerp(20.5, 29.709, t);

    this.fill('#070504');
    this.glow(w * 0.5, h * 0.45, this.unit * 0.62, accent, 0.09 + levels.bass * 0.05);
    this.glow(w * 0.5, h * 0.5, this.unit * 0.22, '#f4e9d6', 0.03 + levels.mid * 0.035);
    drawGrid(ctx, w, h, 82, '#f4e8d6', 0.025, 0, Math.sin(local * 0.15) * 12);
    this.dustField(t, accent, 0.4, 0.9);

    const cx = w * 0.5;
    const cy = h * 0.48;
    const radius = this.unit * 0.32;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.035);
    ctx.setLineDash([1, 8]);
    ctx.strokeStyle = 'rgba(242,232,217,0.15)';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i += 1) {
      ctx.save();
      ctx.rotate((i / 4) * TAU + t * 0.08);
      ctx.strokeStyle = i === 0 ? hexToRgba(accent, 0.28) : 'rgba(241,232,218,0.09)';
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * (1.25 + i * 0.13), radius * (0.26 + i * 0.05), 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    const shot = easeOutExpo(local / 0.65);
    const settle = 1 - 0.06 * smoothstep(phase);
    const px = (this.smoothPointerX - 0.5) * 10;
    const py = (this.smoothPointerY - 0.5) * 7;

    const titleFade = 1 - smoothstep(invLerp(4.15, 5.65, local));
    const worldY = h * 0.255;
    const executeY = h * 0.575;
    const worldX = w * 0.105;

    ctx.save();
    ctx.translate(px, py);

    // The invocation is set like a poster: serif, display, then a machine's mark.
    const serifSize = fitFontSize(ctx, 'world.', 'serif', w * 0.36, this.unit * 0.135, 400, true, -0.04);
    setFont(ctx, serifSize * (0.92 + shot * 0.08) * settle, 'serif', 400, true);
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = smoothstep(local / 0.5) * titleFade;
    ctx.textAlign = 'left';
    ctx.fillText('world', worldX, worldY);
    const wordWidth = ctx.measureText('world').width;
    ctx.fillStyle = accent;
    ctx.fillText('.', worldX + wordWidth, worldY);
    const underline = ctx.measureText('world.').width;
    ctx.strokeStyle = hexToRgba(accent, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(worldX, worldY + this.unit * 0.018);
    ctx.lineTo(worldX + underline * shot, worldY + this.unit * 0.018);
    ctx.stroke();

    const displaySize = fitFontSize(ctx, 'execute', 'display', w * 0.84, this.unit * 0.31, 400, false, -0.035);
    setFont(ctx, displaySize * (1.04 - shot * 0.04), 'display');
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = smoothstep(local / 0.4) * titleFade;
    ctx.textAlign = 'center';
    ctx.fillText('execute', cx + shot * 4, executeY);
    ctx.restore();

    // Small print around the invocation.
    this.mono('INVOCATION / 02', w * 0.065, h * 0.12, 9 * this.ui, accent, 0.7, 'left', 2.2);
    this.hairline(w * 0.065, h * 0.133, w * 0.24, h * 0.133, '#f0e7d7', 0.18);
    this.mono('A WORLD, CALLED BY ITS NAME', w * 0.065, h * 0.15, 8.5 * this.ui, '#e6ddce', 0.35, 'left', 0.8);
    this.mono('NO CHARACTERS / 2D ONLY', w * 0.935, h * 0.165, 8.5 * this.ui, '#e6ddce', 0.36, 'right', 1.2);
    this.mono('EXECUTION ' + String(Math.round(clamp(phase) * 100)).padStart(3, '0') + '%', w * 0.935, h * 0.205, 8.5 * this.ui, accent, 0.7, 'right', 1.2);

    const meSize = this.unit * 0.06;
    setFont(ctx, meSize, 'mono', 500);
    ctx.save();
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.globalAlpha = smoothstep(local / 0.45) * titleFade;
    ctx.fillText('(me);', w * 0.91, h * 0.665);
    ctx.restore();
    this.mono('RETURN VALUE: UNKNOWN', w * 0.91, h * 0.69, 8 * this.ui, '#e6ddce', 0.36 * titleFade, 'right', 0.9);

    // Orbiting debris / code rain.
    for (let i = 0; i < 26; i += 1) {
      const seed = i * 7.31;
      const angle = t * (0.12 + (i % 5) * 0.02) + seed;
      const orbit = radius * (0.9 + ((i * 13) % 9) * 0.055);
      const p = polar(cx, cy, orbit, angle);
      const alpha = 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.7 + i));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle * 0.7);
      ctx.fillStyle = i % 7 === 0 ? accent : '#ede4d4';
      ctx.globalAlpha = alpha;
      ctx.fillRect(-2, -0.5, 4 + (i % 4) * 2, 1);
      ctx.restore();
    }

    // The post-invocation build.
    if (local > 4.5) {
      const p = easeOutCubic(phase);
      const gaugeR = this.unit * 0.26;
      const start = -Math.PI / 2;
      this.glow(cx, cy, gaugeR * 1.05, accent, 0.055 + levels.mid * 0.035);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.03);
      ctx.strokeStyle = 'rgba(243,234,219,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, gaugeR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([1, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, gaugeR * 0.76, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = hexToRgba(accent, 0.82);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, gaugeR, start, start + TAU * p);
      ctx.stroke();
      for (let i = 0; i < 90; i += 1) {
        const a = start + (i / 90) * TAU;
        const r1 = gaugeR + 5;
        const r2 = gaugeR + (i % 5 === 0 ? 14 : 8);
        const p1 = polar(0, 0, r1, a);
        const p2 = polar(0, 0, r2, a);
        ctx.strokeStyle = i / 90 <= p ? accent : 'rgba(238,228,211,0.18)';
        ctx.globalAlpha = i / 90 <= p ? 0.72 : 0.2;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      const hand = polar(0, 0, gaugeR * 0.94, start + TAU * p);
      ctx.strokeStyle = hexToRgba(accent, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 2.2, 0, TAU);
      ctx.fill();
      ctx.restore();

      setFont(ctx, this.unit * 0.135, 'display');
      ctx.save();
      ctx.fillStyle = PAPER;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.84;
      ctx.fillText(String(Math.round(p * 100)).padStart(3, '0'), cx, cy + this.unit * 0.035);
      ctx.restore();

      this.mono('SIMULATION RUNNING', cx, cy + this.unit * 0.24, 9 * this.ui, accent, 0.82, 'center', 2.4);
      this.mono('WORLD / 01 — ME / 01', cx, cy + this.unit * 0.27, 8 * this.ui, '#e8dfd0', 0.45, 'center', 1.1);
      this.hairline(cx - this.unit * 0.16, cy + this.unit * 0.295, cx + this.unit * 0.16, cy + this.unit * 0.295, '#e8dfd0', 0.2);

      // A visible countdown of machinery, tucked into the edges.
      const messages = [
        'SPAWNING HORIZON',
        'MEASURING DISTANCE',
        'ENCODING DESIRE',
        'COMPILING AFFECTION',
        'WAITING FOR INPUT',
      ];
      const messageIndex = Math.min(messages.length - 1, Math.floor(phase * messages.length));
      this.mono('PROCESS ' + messages[messageIndex], w * 0.065, h * 0.72, 8.5 * this.ui, '#e8dfd0', 0.45, 'left', 0.8);
      this.mono('T+' + formatClock(local, true), w * 0.935, h * 0.72, 8.5 * this.ui, accent, 0.55, 'right', 0.8);
    }

    if (local > 12.6) {
      const collapse = invLerp(12.6, 13.702, local);
      const white = clamp(collapse * collapse);
      ctx.fillStyle = `rgba(255,248,235,${white * 0.9})`;
      ctx.fillRect(0, 0, w, h);
      this.glow(cx, cy, this.unit * 0.32 * (1 - collapse * 0.5), accent, 0.22 * collapse);
    }

    this.vignette('rgba(0,0,0,0.63)');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // III. GEOMETRY
  // ────────────────────────────────────────────────────────────────────────────

  private drawGeometry(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const cue = frame.cue;
    const word = displayWord(cue);
    const cueLocal = cue ? t - cue.start : 0;
    const sub =
      local < 3.703 ? 'points' : local < 7.358 ? 'circle' : local < 10.997 ? 'sine' : 'limit';
    const labels = {
      points: 'DIMENSION',
      circle: 'CIRCUMFERENCE',
      sine: 'TANGENTS',
      limit: 'LIMITATIONS',
    } as const;
    const activeWord = word ?? labels[sub];

    this.fill('#05090b');
    this.glow(w * 0.54, h * 0.52, this.unit * 0.52, accent, 0.065 + levels.mid * 0.035);
    drawGrid(ctx, w, h, 54, accent, 0.062, local * 1.7, 0);
    this.dustField(t, accent, 0.32, 0.36);
    this.hairline(w * 0.055, h * 0.205, w * 0.945, h * 0.205, accent, 0.22);
    this.hairline(w * 0.055, h * 0.82, w * 0.945, h * 0.82, accent, 0.16);

    // A drafting axis runs through the whole frame.
    this.hairline(w * 0.055, h * 0.565, w * 0.945, h * 0.565, accent, 0.12);
    this.hairline(w * 0.545, h * 0.25, w * 0.545, h * 0.78, accent, 0.09);
    for (let i = 0; i < 18; i += 1) {
      const x = w * 0.055 + i * ((w * 0.89) / 18);
      this.hairline(x, h * 0.559, x, h * 0.571, accent, i % 3 === 0 ? 0.18 : 0.08);
    }
    for (let i = 0; i < 8; i += 1) {
      const y = h * 0.25 + i * ((h * 0.53) / 8);
      this.hairline(w * 0.539, y, w * 0.551, y, accent, i % 2 === 0 ? 0.16 : 0.07);
    }

    this.mono('GEOMETRY OF A GIFT', w * 0.055, h * 0.18, 9 * this.ui, accent, 0.7, 'left', 2.2);
    this.mono('FIG. ' + (['I', 'II', 'III', 'IV'] as const)[['points', 'circle', 'sine', 'limit'].indexOf(sub)], w * 0.945, h * 0.18, 9 * this.ui, '#e9e5dc', 0.42, 'right', 1.7);
    this.mono('X / Y', w * 0.055, h * 0.79, 8 * this.ui, accent, 0.35, 'left', 1.4);
    this.mono('MEASURED IN YOU', w * 0.945, h * 0.79, 8 * this.ui, '#e9e5dc', 0.3, 'right', 1.4);

    // Ghost typography changes with the geometry.
    const ghost =
      sub === 'points' ? 'DIMENSION' : sub === 'circle' ? 'CIRCUMFERENCE' : sub === 'sine' ? 'TANGENTS' : 'LIMITATIONS';
    const active = word === ghost;
    const reveal = active ? easeOutExpo(cueLocal / 0.42) : 1;
    this.drawBigWord(
      ghost,
      w * 0.5,
      h * 0.325,
      w * 0.88,
      this.unit * 0.18,
      PAPER,
      accent,
      reveal,
      active ? Math.max(0, 0.8 - cueLocal * 2.8) : 0,
      'center',
      active ? 0.96 : 0.64,
      !active,
      -0.028,
    );
    if (active) {
      this.drawWordLabel(activeWord, w * 0.5, h * 0.325 + this.unit * 0.04, 10 * this.ui, accent, 0.7);
    }

    if (sub === 'points') this.drawPointDimension(local, accent, levels);
    else if (sub === 'circle') this.drawCircleStudy(local, accent, levels);
    else if (sub === 'sine') this.drawSineStudy(local, accent, levels);
    else this.drawLimitStudy(local, accent, levels);

    this.vignette('rgba(0,0,0,0.68)');
  }

  private drawPointDimension(local: number, accent: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w * 0.56;
    const cy = h * 0.575;
    const radius = this.unit * 0.225;
    const angle = local * 0.23 + (this.smoothPointerX - 0.5) * 0.45;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tilt = 0.54;
    const project = (p: { x: number; y: number; z: number }): ProjectedPoint => {
      const x = p.x * cos - p.z * sin;
      const z = p.x * sin + p.z * cos;
      return {
        x: cx + x * radius * 1.5,
        y: cy + (p.y - z * tilt) * radius * 1.35,
        z,
      };
    };

    // Wire frame cube corners.
    const corners = [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ] as const;
    const projected = corners.map(([x, y, z]) => project({ x, y, z }));
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    ctx.save();
    ctx.strokeStyle = hexToRgba(accent, 0.28);
    ctx.lineWidth = 1;
    for (const [a, b] of edges) {
      ctx.beginPath();
      ctx.moveTo(projected[a].x, projected[a].y);
      ctx.lineTo(projected[b].x, projected[b].y);
      ctx.stroke();
    }
    ctx.restore();

    // Point cloud cube.
    for (const p of this.cube) {
      const q = project(p);
      const flicker = 0.42 + 0.5 * (0.5 + 0.5 * Math.sin(local * 2.2 + p.x * 8 + p.y * 5));
      ctx.fillStyle = q.z > 0.1 ? accent : '#e9e3d8';
      ctx.globalAlpha = 0.3 + (q.z + 0.7) * 0.38 * flicker;
      const s = 1.1 + (q.z + 0.5) * 1.4;
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // Axis arrows and measurement brackets.
    const origin = project({ x: -0.5, y: 0.5, z: -0.5 });
    const xEnd = project({ x: 0.5, y: 0.5, z: -0.5 });
    const yEnd = project({ x: -0.5, y: -0.5, z: -0.5 });
    const zEnd = project({ x: -0.5, y: 0.5, z: 0.5 });
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexToRgba(accent, 0.62);
    for (const e of [xEnd, yEnd, zEnd]) {
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(e.x, e.y, 2.2, 0, TAU);
      ctx.fillStyle = accent;
      ctx.fill();
    }
    ctx.restore();
    this.mono('x', xEnd.x + 8, xEnd.y, 9 * this.ui, accent, 0.8);
    this.mono('y', yEnd.x + 8, yEnd.y, 9 * this.ui, accent, 0.8);
    this.mono('z', zEnd.x + 8, zEnd.y, 9 * this.ui, accent, 0.8);

    const bracketY = cy + radius * 1.4;
    this.hairline(cx - radius * 1.4, bracketY, cx + radius * 1.4, bracketY, '#ede6d9', 0.35);
    this.hairline(cx - radius * 1.4, bracketY - 5, cx - radius * 1.4, bracketY + 5, '#ede6d9', 0.35);
    this.hairline(cx + radius * 1.4, bracketY - 5, cx + radius * 1.4, bracketY + 5, '#ede6d9', 0.35);
    this.mono('Δx = ' + (3.0 + levels.mid * 0.14).toFixed(3), cx, bracketY + 18 * this.ui, 8 * this.ui, '#ede6d9', 0.42, 'center', 0.8);
    if (w > 760) {
      this.mono('A SET OF POINTS / 216', cx - radius * 1.55, cy - radius * 1.12, 8 * this.ui, accent, 0.46, 'right', 1.1);
      this.mono('THEY BECOME A DIMENSION', cx + radius * 1.55, cy - radius * 1.12, 8 * this.ui, '#ede6d9', 0.35, 'left', 0.8);
    }
  }

  private drawCircleStudy(local: number, accent: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w * 0.56;
    const cy = h * 0.575;
    const radius = this.unit * 0.205;
    const progress = (local * 0.45) % 1;
    const sweep = -Math.PI / 2 + easeOutCubic(progress) * TAU;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(235,227,215,0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.18, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, radius, -Math.PI / 2, sweep);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Radius and moving point.
    const point = polar(0, 0, radius, sweep);
    ctx.strokeStyle = 'rgba(242,234,221,0.58)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.5 + levels.beat * 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f1e9db';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, TAU);
    ctx.fill();

    // Radius arrow label.
    const mid = polar(0, 0, radius * 0.55, sweep);
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(sweep);
    this.mono('r', 0, -8, 10 * this.ui, accent, 1, 'center');
    ctx.restore();

    // Inner construction circles.
    for (let i = 1; i <= 3; i += 1) {
      ctx.strokeStyle = `rgba(235,227,215,${0.09 - i * 0.018})`;
      ctx.beginPath();
      ctx.arc(0, 0, radius * (1 + i * 0.15), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    // Crosshair labels.
    drawCross(ctx, cx, cy, radius * 1.35, '#f0e8da', 0.2);
    this.hairline(cx - radius * 1.3, cy + radius * 1.5, cx + radius * 1.3, cy + radius * 1.5, '#eee6d7', 0.28);
    this.hairline(cx - radius * 1.3, cy + radius * 1.5 - 4, cx - radius * 1.3, cy + radius * 1.5 + 4, '#eee6d7', 0.28);
    this.hairline(cx + radius * 1.3, cy + radius * 1.5 - 4, cx + radius * 1.3, cy + radius * 1.5 + 4, '#eee6d7', 0.28);
    this.mono('C = 2πr', cx, cy + radius * 1.5 + 18 * this.ui, 9 * this.ui, accent, 0.58, 'center', 1.3);
    if (w > 760) {
      this.mono('A LINE, TRACED AROUND YOU', cx - radius * 1.55, cy - radius * 1.18, 8 * this.ui, '#eee6d7', 0.36, 'right', 0.8);
      this.mono((2 * Math.PI).toFixed(4) + ' × r', cx + radius * 1.55, cy - radius * 1.18, 8 * this.ui, accent, 0.46, 'left', 1.1);
    }
    this.mono('ANGLE ' + (((sweep + Math.PI / 2) / TAU) * 360).toFixed(1).padStart(6, '0') + '°', cx, cy - radius * 1.35, 8 * this.ui, '#eee6d7', 0.4, 'center', 1.1);
  }

  private drawSineStudy(local: number, accent: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w * 0.55;
    const cy = h * 0.575;
    const amp = Math.min(this.unit * 0.135, h * 0.13);
    const half = Math.min(w * 0.36, this.unit * 0.37);
    const phase = local * 1.5;
    const px = clamp(((local * 0.32) % 1) * 2 - 1, -1, 1);
    const pointX = cx + px * half;
    const pointY = cy + Math.sin(px * 3.4 + phase) * amp;
    const slope = 3.4 * Math.cos(px * 3.4 + phase);

    ctx.save();
    ctx.strokeStyle = 'rgba(238,230,218,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy);
    ctx.lineTo(cx + half, cy);
    ctx.stroke();
    for (let i = -4; i <= 4; i += 1) {
      const x = cx + (i / 4) * half;
      ctx.beginPath();
      ctx.moveTo(x, cy - 4);
      ctx.lineTo(x, cy + 4);
      ctx.stroke();
      this.mono(String(i), x, cy + 18 * this.ui, 7 * this.ui, '#eee6d7', 0.26, 'center');
    }

    // Main wave.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i <= 220; i += 1) {
      const p = (i / 220) * 2 - 1;
      const x = cx + p * half;
      const y = cy + Math.sin(p * 3.4 + phase) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Ghosted complement.
    ctx.strokeStyle = 'rgba(239,232,220,0.16)';
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    for (let i = 0; i <= 180; i += 1) {
      const p = (i / 180) * 2 - 1;
      const x = cx + p * half;
      const y = cy + Math.sin(p * 3.4 + phase + Math.PI) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Tangent line through the moving point.
    const tangentLength = amp * 1.8;
    const dx = 1;
    const dy = slope;
    const len = Math.hypot(dx, dy);
    const tx = (dx / len) * tangentLength;
    const ty = (dy / len) * tangentLength;
    ctx.strokeStyle = '#f2e8d8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pointX - tx, pointY - ty);
    ctx.lineTo(pointX + tx, pointY + ty);
    ctx.stroke();
    this.hairline(pointX, pointY, pointX, cy, '#f2e8d8', 0.25, 1, [3, 4]);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(pointX, pointY, 3.8 + levels.beat * 2, 0, TAU);
    ctx.fill();

    // Curvature decoration.
    const rad = Math.abs(1 / (1 + slope * slope)) * amp;
    ctx.strokeStyle = 'rgba(242,232,216,0.2)';
    ctx.beginPath();
    ctx.arc(pointX, pointY + (slope >= 0 ? rad : -rad), rad, 0, TAU);
    ctx.stroke();
    ctx.restore();

    this.mono('y = sin(x)', cx - half, cy - amp - 24 * this.ui, 9 * this.ui, accent, 0.58, 'left', 1.1);
    this.mono("dy/dx = cos(x)", cx + half, cy - amp - 24 * this.ui, 8.5 * this.ui, '#eee6d7', 0.4, 'right', 0.9);
    this.mono('TANGENT AT x = ' + px.toFixed(3), pointX, pointY - 18 * this.ui, 8 * this.ui, '#f2e8d8', 0.55, 'center', 0.9);
    this.hairline(cx - half, cy + amp + 22 * this.ui, cx + half, cy + amp + 22 * this.ui, '#eee6d7', 0.22);
    this.mono('RIDE EVERY TANGENT, STAY ON THE CURVE', cx, cy + amp + 40 * this.ui, 8 * this.ui, '#eee6d7', 0.32, 'center', 0.7);
  }

  private drawLimitStudy(local: number, accent: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w * 0.56;
    const cy = h * 0.575;
    const scale = Math.min(w * 0.29, this.unit * 0.325);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(239,231,218,0.17)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-scale * 1.4, 0);
    ctx.lineTo(scale * 1.4, 0);
    ctx.moveTo(0, -scale);
    ctx.lineTo(0, scale);
    ctx.stroke();
    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = hexToRgba(accent, 0.4);
    ctx.beginPath();
    ctx.moveTo(0, -scale);
    ctx.lineTo(0, scale);
    ctx.moveTo(-scale * 1.4, 0);
    ctx.lineTo(scale * 1.4, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    const offset = scale * 0.42;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= 100; i += 1) {
        const u = 0.015 + (i / 100) * 1.1;
        const x = side * (offset + u * scale * 0.75);
        const y = side * (scale * 0.34) / u;
        if (Math.abs(y) > scale * 1.15) continue;
        if (i === 0 || Math.abs(scale * 0.34 / u) > scale * 1.15) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // A luminous point sliding toward the asymptote.
    const t = (local * 0.22) % 1;
    const u = lerp(0.9, 0.06, easeOutCubic(t));
    const x = offset + u * scale * 0.75;
    const y = scale * 0.34 / u;
    if (Math.abs(y) < scale) {
      ctx.fillStyle = '#f3eadb';
      ctx.beginPath();
      ctx.arc(x, y, 2.8 + levels.mid * 2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(243,234,219,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, 12 + Math.sin(local * 2) * 4, 0, TAU);
      ctx.stroke();
    }

    // Infinity mark.
    setFont(ctx, this.unit * 0.09, 'serif', 400, true);
    ctx.fillStyle = hexToRgba(accent, 0.3);
    ctx.textAlign = 'center';
    ctx.fillText('∞', 0, -scale * 0.72);
    ctx.restore();

    this.mono('lim  f(x) = you', cx - scale * 1.4, cy - scale - 20 * this.ui, 9 * this.ui, accent, 0.6, 'left', 1.1);
    if (w > 760) {
      this.mono('x → ∞', cx + scale * 1.4, cy - scale - 20 * this.ui, 9 * this.ui, '#eee7d9', 0.45, 'right', 0.9);
      this.mono('LIMIT ' + (1 - t * 0.001).toFixed(6), cx + scale * 1.4, cy + scale * 0.42, 8 * this.ui, accent, 0.48, 'right', 1);
    }
    this.mono('APPROACHING / NEVER ARRIVING', cx, cy + scale + 32 * this.ui, 8 * this.ui, '#eee7d9', 0.35, 'center', 0.8);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // IV. SIGNAL
  // ────────────────────────────────────────────────────────────────────────────

  private drawSignal(frame: StageFrame): void {
    const local = frame.time - frame.act.start;

    if (local < 6.911) {
      this.drawCurrentAndBlind(frame, local);
      return;
    }

    this.drawTimeTravel(frame, local - 6.911);
    this.vignette('rgba(0,0,0,0.66)');
  }

  private drawCurrentAndBlind(frame: StageFrame, local: number): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const currentLocal = local;
    const blind = local > 3.22;
    const dizzy = local > 5.082;

    this.fill(blind ? '#070607' : '#080604');
    this.glow(w * 0.5, h * 0.5, this.unit * 0.5, accent, blind ? 0.065 : 0.075 + levels.bass * 0.04);
    drawGrid(ctx, w, h, 62, blind ? '#ff5a36' : '#efe5d5', blind ? 0.03 : 0.04, t * 2, 0);
    this.dustField(t, accent, blind ? 0.25 : 0.35, 0.9);

    if (!blind) {
      const switchP = smoothstep(invLerp(1.35, 3.02, currentLocal));
      const cx = w * 0.5;
      const cy = h * 0.54;
      const half = Math.min(w * 0.33, this.unit * 0.36);
      const amp = this.unit * 0.115 * (1 - switchP * 0.82);

      // Oscilloscope chassis.
      this.bracket(w * 0.085, h * 0.25, w * 0.83, h * 0.48, '#f0e7d8', 0.24);
      this.mono('CH A / VOLTAGE', w * 0.1, h * 0.3, 9 * this.ui, accent, 0.7, 'left', 1.6);
      this.mono(switchP > 0.55 ? 'DIRECT CURRENT' : 'ALTERNATING CURRENT', w * 0.1, h * 0.325, 8 * this.ui, '#eee5d6', 0.35, 'left', 1);
      this.mono('50 / 60 Hz', w * 0.9, h * 0.3, 8 * this.ui, accent, 0.5, 'right', 1);
      this.mono('GAIN +12 dB', w * 0.9, h * 0.325, 8 * this.ui, '#eee5d6', 0.3, 'right', 1);

      // Time grid inside oscilloscope.
      for (let i = 1; i < 8; i += 1) {
        const x = w * 0.085 + (i / 8) * w * 0.83;
        this.hairline(x, h * 0.27, x, h * 0.69, '#efe7d8', 0.07);
      }
      for (let i = 1; i < 4; i += 1) {
        const y = h * 0.27 + (i / 4) * h * 0.42;
        this.hairline(w * 0.085, y, w * 0.915, y, '#efe7d8', 0.07);
      }

      // Three phase-locked traces.
      for (let layer = 0; layer < 3; layer += 1) {
        const layerAmp = amp * (1 - layer * 0.21);
        const offset = layer * 0.55;
        ctx.save();
        ctx.strokeStyle =
          layer === 0 ? accent : layer === 1 ? '#f0e8da' : 'rgba(141,232,255,0.6)';
        ctx.globalAlpha = layer === 0 ? 0.9 : 0.3;
        ctx.lineWidth = layer === 0 ? 1.7 : 1;
        ctx.beginPath();
        for (let i = 0; i <= 320; i += 1) {
          const p = i / 320;
          const x = cx - half + p * half * 2;
          const dc = (p - 0.5) * amp * 0.28;
          const blend = Math.sin(p * TAU * 3.2 + currentLocal * 5.2 + offset) * (1 - switchP) + dc * switchP;
          const clipFade = smoothstep(invLerp(0.91, 1, Math.abs(p - 0.5) * 2));
          const y = cy + blend * layerAmp * 0.6 * (0.32 + 0.68 * (1 - clipFade * 0.2));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Polarities. They start stacked and tear apart.
      const split = easeOutCubic(invLerp(1.22, 2.7, currentLocal));
      const acX = lerp(cx, w * 0.31, split);
      const dcX = lerp(cx, w * 0.69, split);
      const acAlpha = 0.2 + (switchP < 0.5 ? 0.8 : 0.25) * (0.6 + 0.4 * split);
      const dcAlpha = 0.2 + (switchP >= 0.5 ? 0.8 : 0.25) * (0.6 + 0.4 * split);
      this.drawBigWord('AC', acX, cy + this.unit * 0.065, w * 0.34, this.unit * 0.27, accent, '#f0e7d8', split, 0.2, 'center', acAlpha, switchP >= 0.5);
      this.drawBigWord('DC', dcX, cy + this.unit * 0.065, w * 0.34, this.unit * 0.27, PAPER, accent, split, 0.2, 'center', dcAlpha, switchP < 0.5);
      this.mono('ALTERNATING', acX, cy + this.unit * 0.095, 8 * this.ui, '#eee5d6', 0.32 * split, 'center', 1.4);
      this.mono('DIRECT', dcX, cy + this.unit * 0.095, 8 * this.ui, '#eee5d6', 0.32 * split, 'center', 1.4);

      // The wire and mechanical switch.
      const wireY = cy + this.unit * 0.16;
      this.hairline(cx - half * 0.8, wireY, cx + half * 0.8, wireY, '#efe6d6', 0.32);
      const switchX = lerp(cx - half * 0.28, cx + half * 0.28, switchP);
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(switchX, wireY, 4, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(switchX, wireY);
      ctx.lineTo(switchX + 28, wireY - 14 + switchP * 8);
      ctx.stroke();
      ctx.restore();
      this.mono('SWITCH MY CURRENT', cx, wireY + 26 * this.ui, 8 * this.ui, '#f0e7d8', 0.34, 'center', 1.5);

      // Level meter on the right edge.
      for (let i = 0; i < 18; i += 1) {
        const activeBars = levels.level * 18;
        this.hairline(w * 0.93, h * 0.38 + i * 10, w * 0.95, h * 0.38 + i * 10, i < activeBars ? accent : '#efe7d8', i < activeBars ? 0.5 : 0.1, 2);
      }

      if (currentLocal > 1.35) {
        this.mono('POLARITY SHIFT IN PROGRESS', w * 0.1, h * 0.95 - 66 * this.ui, 8 * this.ui, accent, 0.42, 'left', 1);
      }
    } else {
      const cx = w * 0.5;
      const cy = h * 0.49;
      const radius = this.unit * 0.27;

      if (!dizzy) {
        const closeP = smoothstep(invLerp(3.22, 3.95, currentLocal));
        const reopen = 1 - smoothstep(invLerp(4.68, 5.08, currentLocal));
        const openness = clamp(1 - closeP) * 0.92 + reopen * 0.1;
        this.drawAperture(cx, cy, radius, openness, accent, currentLocal);
        this.mono('VISUAL INPUT / CUT', w * 0.5, cy + radius * 1.4, 8.5 * this.ui, accent, 0.68, 'center', 2);
        this.mono('IRIS ' + String(Math.round(openness * 100)).padStart(3, '0') + '%', w * 0.5, cy + radius * 1.4 + 18 * this.ui, 8 * this.ui, '#eae2d3', 0.36, 'center', 1.2);
      } else {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.sin(t * 1.3) * 0.018);
        const petals = 9;
        for (let i = 0; i < 80; i += 1) {
          const angle = i * 0.112 + t * 0.25;
          const r = radius * 0.04 + i * (radius / 88);
          const wobble = Math.sin(t * 2 + i * 0.22) * radius * 0.014;
          ctx.strokeStyle = i % 13 === 0 ? accent : `rgba(239,231,218,${0.18 - i * 0.0016})`;
          ctx.lineWidth = i % 13 === 0 ? 1.4 : 1;
          ctx.beginPath();
          for (let j = 0; j <= petals; j += 1) {
            const a = angle + (j / petals) * TAU;
            const rr = r + wobble;
            if (j === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        for (let i = 0; i < 18; i += 1) {
          const a = (i / 18) * TAU + t * 0.12;
          const p = polar(0, 0, radius * (1.08 + (i % 3) * 0.1), a);
          ctx.fillStyle = i % 3 === 0 ? accent : '#eee6d7';
          ctx.globalAlpha = 0.26 + (i % 5) * 0.08;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        setFont(ctx, fitFontSize(ctx, 'so dizzy', 'serif', w * 0.72, this.unit * 0.19, 400, true, -0.03), 'serif', 400, true);
        ctx.fillStyle = PAPER;
        ctx.textAlign = 'center';
        ctx.fillText('so dizzy', cx, cy + this.unit * 0.045);
        this.mono('VESTIBULAR SIGNAL LOST', w * 0.5, h * 0.79, 8.5 * this.ui, accent, 0.55, 'center', 1.8);
      }

      // Blindness vignette.
      const blindFade = smoothstep(invLerp(3.35, 4.1, currentLocal));
      const black = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.7);
      black.addColorStop(0, `rgba(0,0,0,${0.03 * blindFade})`);
      black.addColorStop(0.5, `rgba(0,0,0,${0.3 * blindFade})`);
      black.addColorStop(1, `rgba(0,0,0,${0.86 * blindFade})`);
      ctx.fillStyle = black;
      ctx.fillRect(0, 0, w, h);
    }

    if (dizzy) {
      this.drawNoiseSlices(t, accent, 0.7, 18);
    }

    this.vignette('rgba(0,0,0,0.68)');
  }

  private drawAperture(
    cx: number,
    cy: number,
    radius: number,
    openness: number,
    accent: string,
    time: number,
  ): void {
    const ctx = this.ctx;
    const blades = 12;
    const rotation = time * 0.06;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // Outer casing.
    ctx.strokeStyle = 'rgba(239,231,218,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.05, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * TAU;
      const p1 = polar(0, 0, radius * 1.05, a);
      const p2 = polar(0, 0, radius * (i % 3 === 0 ? 1.1 : 1.075), a);
      ctx.strokeStyle = i % 3 === 0 ? hexToRgba(accent, 0.5) : 'rgba(239,231,218,0.18)';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Aperture blades as dark overlapping petals.
    const hole = radius * (0.05 + openness * 0.68);
    for (let i = 0; i < blades; i += 1) {
      const a0 = (i / blades) * TAU;
      const a1 = ((i + 1) / blades) * TAU;
      const outer = polar(0, 0, radius, a0);
      const outer2 = polar(0, 0, radius, a1);
      const inner = polar(0, 0, hole, a1 + 0.2);
      const inner2 = polar(0, 0, hole * 1.02, a0 + 0.18);
      const grad = ctx.createLinearGradient(outer.x, outer.y, inner.x, inner.y);
      grad.addColorStop(0, 'rgba(4,4,4,0.98)');
      grad.addColorStop(0.7, `rgba(10,8,8,${0.92 - openness * 0.05})`);
      grad.addColorStop(1, 'rgba(28,22,20,0.7)');
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(240,230,215,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(outer.x, outer.y);
      ctx.lineTo(inner.x, inner.y);
      ctx.lineTo(inner2.x, inner2.y);
      ctx.lineTo(outer2.x, outer2.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Light leaking in at the centre.
    const leak = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, hole));
    leak.addColorStop(0, hexToRgba(accent, 0.28 + openness * 0.35));
    leak.addColorStop(0.55, hexToRgba(accent, 0.06));
    leak.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = leak;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, hole), 0, TAU);
    ctx.fill();

    ctx.fillStyle = hexToRgba(accent, 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.2, hole * 0.035), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawTimeTravel(frame: StageFrame, local: number): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const merge = smoothstep(invLerp(0, 3.72, local));
    const afterMerge = smoothstep(invLerp(3.72, 5.9, local));

    this.fill('#060508');
    this.glow(w * 0.5, h * 0.5, this.unit * 0.54, '#8de8ff', 0.035);
    this.glow(lerp(w * 0.28, w * 0.5, merge), h * 0.54, this.unit * 0.22, accent, 0.08 + afterMerge * 0.08);
    drawGrid(ctx, w, h, 66, '#f0e7d8', 0.026, t * 1.4, 0);
    this.dustField(t, accent, 0.34, 0.7);

    this.mono('TEMPORAL DRIFT / A.D. ↔ B.C.', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.7, 'left', 2.1);
    this.mono('CLOCK RATE × 10⁹', w * 0.94, h * 0.22, 8 * this.ui, '#eee6d8', 0.35, 'right', 1.2);

    // Two giant temporal poles.
    const adAlpha = 0.4 + (1 - merge) * 0.34;
    const bcAlpha = 0.4 + (1 - merge) * 0.34;
    this.drawBigWord('A.D.', w * 0.255, h * 0.42, w * 0.3, this.unit * 0.17, PAPER, accent, 1, 0.08, 'center', adAlpha, true);
    this.drawBigWord('B.C.', w * 0.745, h * 0.42, w * 0.3, this.unit * 0.17, PAPER, accent, 1, 0.08, 'center', bcAlpha, true);
    this.mono('ANNO DOMINI', w * 0.255, h * 0.45, 8 * this.ui, '#eee6d8', 0.35 * (1 - merge), 'center', 1.7);
    this.mono('BEFORE CHRIST', w * 0.745, h * 0.45, 8 * this.ui, '#eee6d8', 0.35 * (1 - merge), 'center', 1.7);

    // Timeline.
    const axisY = h * 0.63;
    this.hairline(w * 0.06, axisY, w * 0.94, axisY, '#eee6d8', 0.24);
    const scroll = t * 38;
    for (let i = -22; i <= 22; i += 1) {
      const x = w * 0.5 + i * 46 - (scroll % 46);
      if (x < w * 0.06 || x > w * 0.94) continue;
      const major = i % 4 === 0;
      this.hairline(x, axisY - (major ? 8 : 4), x, axisY + (major ? 8 : 4), major ? accent : '#eee6d8', major ? 0.5 : 0.2);
      if (major && Math.abs(i) > 1) {
        this.mono(String(2024 + i * 12), x, axisY + 16 * this.ui, 7 * this.ui, '#eee6d8', 0.28, 'center');
      }
    }

    // Two swarms crossing the timeline, then becoming a single core.
    const centerX = w * 0.5;
    const centerY = h * 0.53;
    for (let i = 0; i < 94; i += 1) {
      const isLeft = i < 47;
      const idx = isLeft ? i : i - 47;
      const angle = t * (0.14 + idx * 0.002) + idx * 2.39;
      const spread = this.unit * (0.035 + (idx % 11) * 0.006);
      const baseX = isLeft ? w * 0.27 : w * 0.73;
      const orbitX = Math.cos(angle) * spread;
      const orbitY = Math.sin(angle * 1.27) * spread * 0.7;
      const x = lerp(baseX + orbitX, centerX + orbitX * 0.32, merge);
      const y = lerp(h * 0.52 + orbitY, centerY + orbitY * 0.32, merge);
      ctx.fillStyle = i % 5 === 0 ? accent : isLeft ? '#f1e9da' : 'rgba(141,232,255,0.85)';
      ctx.globalAlpha = 0.34 + (idx % 7) * 0.07;
      const size = 1.7 + (idx % 3) * 0.8;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;

    if (merge > 0.2) {
      this.glow(centerX, centerY, this.unit * (0.1 + merge * 0.08), accent, 0.04 + merge * 0.06);
      for (let i = 0; i < 3; i += 1) {
        ctx.strokeStyle = hexToRgba(i === 0 ? accent : '#f1e9da', (0.22 - i * 0.05) * merge);
        ctx.lineWidth = i === 0 ? 1.4 : 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, this.unit * (0.028 + i * 0.025 + merge * 0.03), -Math.PI * 0.25, TAU - Math.PI * 0.35);
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.75 * merge;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 2.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (afterMerge > 0) {
      for (let i = 0; i < 6; i += 1) {
        const radius = this.unit * (0.03 + i * 0.045 + afterMerge * i * 0.008);
        ctx.strokeStyle = hexToRgba(accent, 0.28 - i * 0.032);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI * 0.15 + i, TAU - Math.PI * 0.3 + i);
        ctx.stroke();
      }
      this.glow(centerX, centerY, this.unit * 0.08, accent, 0.35 * afterMerge);
      setFont(ctx, fitFontSize(ctx, 'so deeply', 'serif', w * 0.4, this.unit * 0.1, 400, true, -0.02), 'serif', 400, true);
      ctx.fillStyle = PAPER;
      ctx.globalAlpha = 0.66 * afterMerge;
      ctx.textAlign = 'center';
      ctx.fillText('so deeply', centerX, centerY + this.unit * 0.085);
      ctx.globalAlpha = 1;
      this.mono('ENTANGLED / ' + String(Math.round(74 + levels.bass * 25)).padStart(3, '0') + '.9%', centerX, centerY + this.unit * 0.11, 8 * this.ui, '#eee6d8', 0.4, 'center', 1);
    } else {
      this.mono('TRAVEL / ' + (merge * 100).toFixed(1) + '%', w * 0.5, h * 0.76, 8 * this.ui, accent, 0.45, 'center', 1.2);
    }

    this.vignette('rgba(0,0,0,0.7)');
  }

  private drawNoiseSlices(time: number, color: string, intensity: number, count: number): void {
    const ctx = this.ctx;
    ctx.save();
    for (let i = 0; i < count; i += 1) {
      const seed = Math.sin(i * 13.7 + Math.floor(time * 7) * 31.1) * 43758.5453;
      const r = seed - Math.floor(seed);
      if (r > intensity) continue;
      const y = ((i * 79 + Math.sin(time * 9 + i) * 30) % this.h + this.h) % this.h;
      const height = 1 + (i % 4);
      ctx.fillStyle = i % 3 === 0 ? color : PAPER;
      ctx.globalAlpha = 0.05 + (i % 5) * 0.018;
      ctx.fillRect(0, y, this.w, height);
    }
    ctx.restore();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // V. DEVOTION
  // ────────────────────────────────────────────────────────────────────────────

  private drawDevotion(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const secondary = frame.act.secondary;
    const levels = frame.levels;
    const cue = frame.cue;
    const word = displayWord(cue);
    const cueLocal = cue ? t - cue.start : 0;
    const late = local > 7.378;

    this.fill('#080506');
    this.glow(w * 0.5, h * 0.47, this.unit * 0.5, accent, 0.065 + levels.bass * 0.06);
    drawGrid(ctx, w, h, 60, '#f0e6d6', 0.028, 0, t * 2.4);
    this.dustField(t, accent, 0.38, 0.75);

    this.mono('V / DEVOTION', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.7, 'left', 2.1);
    this.mono('A GIFT, EXPRESSED IN HERTZ', w * 0.94, h * 0.22, 8 * this.ui, '#eee5d6', 0.35, 'right', 1.1);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, '#eee5d6', 0.13);

    const cx = w * 0.5;
    const cy = h * 0.52;
    const radius = this.unit * (late ? 0.18 * (1 - smoothstep(invLerp(9.5, 12.3, local)) * 0.35) : 0.2);
    const pulse = 1 + levels.beat * 0.025 + levels.bass * 0.04;

    // Orb and frequency architecture.
    this.glow(cx, cy, radius * 1.6, accent, 0.06 + levels.mid * 0.07);
    ctx.save();
    ctx.translate(cx, cy);
    const arcCount = 40;
    for (let i = 0; i < arcCount; i += 1) {
      const angle = (i / arcCount) * TAU;
      const activeLevel = i / arcCount < 0.25 + levels.high * 0.7;
      const inner = radius * (0.44 + (i % 3) * 0.03);
      const outer = radius * (0.72 + (activeLevel ? 0.24 + levels.level * 0.22 : 0.03));
      const p1 = polar(0, 0, inner, angle);
      const p2 = polar(0, 0, outer, angle);
      ctx.strokeStyle = activeLevel ? (i % 5 === 0 ? accent : '#f2e8d8') : 'rgba(240,232,217,0.12)';
      ctx.lineWidth = i % 5 === 0 ? 1.3 : 0.8;
      ctx.globalAlpha = activeLevel ? 0.6 : 0.25;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i += 1) {
      const r = radius * (0.48 + i * 0.22) * pulse;
      ctx.strokeStyle = i === 0 ? hexToRgba(accent, 0.8) : 'rgba(240,232,217,0.16)';
      ctx.lineWidth = i === 0 ? 1.4 : 1;
      ctx.setLineDash(i === 1 ? [2, 8] : []);
      ctx.beginPath();
      ctx.arc(0, 0, r, t * (i % 2 === 0 ? 0.12 : -0.08) + i, t * (i % 2 === 0 ? 0.12 : -0.08) + TAU - i * 0.4);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Spectrum bars behind the orb.
    for (let i = 0; i < 34; i += 1) {
      const value = 0.08 + (0.5 + 0.5 * Math.sin(t * 2.1 + i * 0.6)) * 0.12 + levels.mid * 0.3;
      const x = cx - this.unit * 0.3 + (i / 34) * this.unit * 0.6;
      const height = value * this.unit * 0.35;
      this.hairline(x, h * 0.79, x, h * 0.79 - height, i % 6 === 0 ? accent : '#efe7d8', 0.17 + levels.level * 0.2, 1);
    }

    if (!late) {
      setFont(ctx, fitFontSize(ctx, 'if I can', 'serif', w * 0.4, this.unit * 0.085, 400, true, -0.02), 'serif', 400, true);
      ctx.fillStyle = PAPER;
      ctx.globalAlpha = 0.52;
      ctx.textAlign = 'center';
      ctx.fillText('if I can', w * 0.5, h * 0.77);
      ctx.globalAlpha = 1;
      this.mono('CONDITION 0' + (local < 3.37 ? '1' : '2') + ' / PENDING', w * 0.06, h * 0.79, 8 * this.ui, '#eee5d6', 0.34, 'left', 1.1);
    }

    if (word) {
      const reveal = easeOutExpo(clamp(cueLocal / 0.33));
      const glitch = Math.max(0, 0.7 - cueLocal * 2.4);
      const y = h * (word === 'EXECUTION' ? 0.45 : 0.39);
      this.drawBigWord(word, w * 0.5, y, w * 0.78, this.unit * 0.19, PAPER, secondary, reveal, glitch, 'center', 0.96, false, -0.03);
      this.drawWordLabel(word, w * 0.5, y + this.unit * 0.035, 10 * this.ui, accent, 0.55);
      if (word === 'STIMULATIONS') {
        for (let i = 0; i < 40; i += 1) {
          const a = i * 2.399 + t;
          const r = this.unit * (0.24 + (i % 8) * 0.018) * (1 + levels.beat * 0.15);
          const p = polar(cx, cy, r, a);
          ctx.fillStyle = i % 4 === 0 ? secondary : accent;
          ctx.globalAlpha = 0.2 + (i % 6) * 0.08;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.4 + (i % 3), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    } else if (late) {
      this.drawLateDevotion(local, accent, levels);
    }

    // Golden centre for the happy conditional.
    if (local > 7.38 && local < 9.9) {
      this.glow(cx, cy, radius * 1.2, '#ffd8a1', 0.1 + levels.level * 0.12);
    }

    if (local > 9.3) {
      const cut = invLerp(9.3, 10.2, local);
      const lineY = cy + radius * (1 - cut) * 2.1;
      this.hairline(w * 0.18, lineY, w * 0.82, lineY, secondary, 0.7 * cut, 1.5);
      if (local > 10.0) {
        const box = easeOutCubic(invLerp(10.0, 12.541, local));
        const boxW = this.unit * 0.27 * (1 - box * 0.48);
        const boxH = this.unit * 0.18 * (1 - box * 0.32);
        ctx.strokeStyle = 'rgba(255,90,54,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
        for (let i = 0; i < 6; i += 1) {
          const yLine = cy - boxH / 2 + (i / 5) * boxH;
          this.hairline(cx - boxW / 2, yLine, cx + boxW / 2, yLine, accent, 0.1);
        }
        this.mono('TRAPPED / SIMULATION', cx, cy + boxH / 2 + 18 * this.ui, 8 * this.ui, secondary, 0.5, 'center', 1.3);
      }
    }

    this.drawNoiseSlices(t, secondary, local > 8.7 && local < 10.8 ? 0.35 : 0.08, 10);
    this.vignette('rgba(0,0,0,0.7)');
  }

  private drawLateDevotion(local: number, accent: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const phase = invLerp(9.3, 12.541, local);
    const text = phase < 0.25 ? 'only you' : phase < 0.55 ? 'only one' : 'trapped';
    setFont(ctx, fitFontSize(ctx, text, 'serif', w * 0.46, this.unit * 0.105, 400, true, -0.02), 'serif', 400, true);
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.58;
    ctx.textAlign = 'center';
    ctx.fillText(text, w * 0.5, h * 0.39);
    ctx.globalAlpha = 1;
    this.mono('CONDITION RESOLVED / ' + (65 + levels.level * 22).toFixed(1), w * 0.5, h * 0.42, 8 * this.ui, accent, 0.42, 'center', 1);
  }
  // ────────────────────────────────────────────────────────────────────────────
  // VI. SPECIMENS
  // ────────────────────────────────────────────────────────────────────────────

  private drawSpecimens(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const levels = frame.levels;
    const cue = frame.cue;
    const word = displayWord(cue);
    const cueLocal = cue ? t - cue.start : 0;
    const accent = frame.act.accent;
    const ink = '#18130e';
    const red = '#df3f25';
    const purple = '#653cff';
    const amber = '#d8862f';
    const green = '#2f6b45';

    interface Specimen {
      at: number;
      kind: 'seed' | 'eggplant' | 'tomato' | 'purr' | 'god';
      index: string;
      latin: string;
      cn: string;
      theme: string;
      data: string;
    }
    const specimens: Specimen[] = [
      { at: 0, kind: 'seed', index: '00', latin: 'simulacrum', cn: '模拟体', theme: 'SIMULATION', data: 'UNRESOLVED / WAITING' },
      { at: 2.281, kind: 'eggplant', index: '01', latin: 'Solanum melongena', cn: '茄子', theme: 'NUTRIENTS', data: 'ANTHOCYANIN / 25 kcal' },
      { at: 5.812, kind: 'tomato', index: '02', latin: 'Solanum lycopersicum', cn: '番茄', theme: 'ANTIOXIDANTS', data: 'LYCOPENE / 18 kcal' },
      { at: 9.587, kind: 'purr', index: '03', latin: 'Felis catus, abstracted', cn: '虎斑猫（抽象）', theme: 'ENJOYMENT', data: 'PURR / 25–150 Hz' },
      { at: 13.314, kind: 'god', index: '04', latin: 'Deus, self-declared', cn: '唯一的神', theme: 'EXISTENCE', data: 'PROOF / LOAD-BEARING' },
    ];

    let current = specimens[0];
    for (const specimen of specimens) if (local >= specimen.at) current = specimen;
    const previous = specimens[Math.max(0, specimens.indexOf(current) - 1)];
    const transition = smoothstep(invLerp(0, 0.75, local - current.at));
    const headline = current.theme;

    this.fill(LIGHT_PAPER);
    // Printed paper dots.
    ctx.save();
    ctx.fillStyle = 'rgba(24,19,14,0.035)';
    for (let y = 0; y < h; y += 18) {
      for (let x = (y / 18) % 2 === 0 ? 0 : 9; x < w; x += 18) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();

    drawGrid(ctx, w, h, 72, '#241c12', 0.038, 0, local * 1.1);
    this.hairline(w * 0.06, h * 0.2, w * 0.94, h * 0.2, ink, 0.32);
    this.hairline(w * 0.06, h * 0.82, w * 0.94, h * 0.82, ink, 0.22);
    this.mono('VI / SPECIMENS', w * 0.06, h * 0.165, 9 * this.ui, ink, 0.68, 'left', 2.1);
    this.mono('A SMALL INDEX OF OFFERINGS', w * 0.94, h * 0.165, 8 * this.ui, ink, 0.42, 'right', 1.1);
    this.mono('NO CHARACTERS WERE HARMED', w * 0.06, h * 0.865, 8 * this.ui, ink, 0.38, 'left', 1.2);
    this.mono('CATALOGUE / ' + current.index + ' OF 04', w * 0.94, h * 0.865, 8 * this.ui, ink, 0.38, 'right', 1.1);

    // Field-guide frame.
    this.hairline(w * 0.535, h * 0.24, w * 0.535, h * 0.8, ink, 0.12, 1, [2, 8]);
    this.bracket(w * 0.06, h * 0.24, w * 0.42, h * 0.52, ink, 0.24);
    this.bracket(w * 0.585, h * 0.24, w * 0.355, h * 0.52, ink, 0.16);

    const objectX = w * 0.755;
    const objectY = h * 0.515;
    const objectRadius = this.unit * 0.2;
    this.glow(objectX, objectY, objectRadius * 1.7, '#d0b98e', 0.1);
    ctx.save();
    ctx.strokeStyle = 'rgba(24,19,14,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(objectX, objectY, objectRadius * 1.12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = 'rgba(24,19,14,0.22)';
    ctx.beginPath();
    ctx.arc(objectX, objectY, objectRadius * 1.28, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 48; i += 1) {
      const a = (i / 48) * TAU + local * 0.02;
      const p1 = polar(objectX, objectY, objectRadius * 1.28, a);
      const p2 = polar(objectX, objectY, objectRadius * (i % 4 === 0 ? 1.36 : 1.32), a);
      ctx.strokeStyle = i % 4 === 0 ? accent : 'rgba(24,19,14,0.28)';
      ctx.globalAlpha = i % 4 === 0 ? 0.55 : 0.25;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Halftone bloom.
    for (let i = 0; i < 190; i += 1) {
      const angle = i * 2.399;
      const r = objectRadius * 1.5 * Math.sqrt(i / 190);
      const x = objectX + Math.cos(angle) * r;
      const y = objectY + Math.sin(angle) * r * 0.72;
      const size = 0.6 + ((i * 7) % 5) * 0.32;
      ctx.fillStyle = i % 9 === 0 ? purple : 'rgba(24,19,14,0.13)';
      ctx.globalAlpha = 0.2 + (i % 7) * 0.045;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;

    // The specimen itself.
    ctx.save();
    ctx.beginPath();
    ctx.arc(objectX, objectY, objectRadius * 1.1, 0, TAU);
    ctx.clip();
    if (previous !== current && transition < 1) {
      ctx.globalAlpha = 0.3 * (1 - transition);
      this.drawSpecimenObject(previous.kind, objectX, objectY, objectRadius, local, ink, purple, red, amber, green, levels);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 0.35 + 0.65 * transition;
    this.drawSpecimenObject(current.kind, objectX, objectY, objectRadius, local, ink, purple, red, amber, green, levels);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();

    // Giant specimen word.
    const activeWord = word === current.theme || word === 'SIMULATION';
    const reveal = activeWord ? easeOutExpo(cueLocal / 0.38) : 1;
    this.drawBigWord(
      headline,
      w * 0.085,
      h * 0.43,
      w * 0.43,
      this.unit * 0.16,
      ink,
      activeWord ? red : purple,
      reveal,
      activeWord ? Math.max(0, 0.85 - cueLocal * 3) : 0.16,
      'left',
      0.94,
      false,
      -0.018,
    );
    const translation = WORD_TRANSLATIONS[headline];
    if (translation) {
      this.cjk(translation, w * 0.085, h * 0.465, 12 * this.ui, ink, 0.56, 'left');
    }

    this.drawSerifWord(current.latin, w * 0.085, h * 0.57, w * 0.38, this.unit * 0.076, ink, 0.82, 'left', true, -0.018);
    this.cjk(current.cn, w * 0.085, h * 0.6, 11 * this.ui, ink, 0.42, 'left');
    this.hairline(w * 0.085, h * 0.635, w * 0.44, h * 0.635, ink, 0.25);
    this.mono(current.data, w * 0.085, h * 0.665, 8.5 * this.ui, ink, 0.54, 'left', 1.2);
    if (w > 760) {
      this.mono('OFFERING / ' + String(specimens.indexOf(current)).padStart(2, '0'), w * 0.44, h * 0.665, 8 * this.ui, accent, 0.8, 'right', 1);
    }

    if (current.kind === 'god') {
      this.drawStamp('PROOF', w * 0.62, h * 0.71, this.unit * 0.028, red, 0.72, -0.13);
      this.mono('THEN YOU ARE THE PROOF OF MY', w * 0.085, h * 0.723, 8 * this.ui, ink, 0.42, 'left', 1.15);
    } else if (current.kind === 'purr') {
      this.drawStamp('PURR', w * 0.615, h * 0.71, this.unit * 0.026, amber, 0.72, 0.08);
    }

    this.mono('FIG. ' + current.index, w * 0.605, h * 0.3, 8.5 * this.ui, ink, 0.5, 'left', 1.3);
    this.mono('MAGNIFICATION × 1.00', w * 0.605, h * 0.33, 7.5 * this.ui, ink, 0.34, 'left', 1);
    this.mono('SCALE 1 : 1', w * 0.92, h * 0.69, 7.5 * this.ui, ink, 0.34, 'right', 0.8);
    this.hairline(w * 0.885, h * 0.7, w * 0.92, h * 0.7, ink, 0.4);
    this.hairline(w * 0.885, h * 0.696, w * 0.885, h * 0.704, ink, 0.4);
    this.hairline(w * 0.92, h * 0.696, w * 0.92, h * 0.704, ink, 0.4);

    // Barcode.
    const barX = w * 0.84;
    const barY = h * 0.78;
    for (let i = 0; i < 28; i += 1) {
      const bw = i % 5 === 0 ? 3 : 1;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.42;
      ctx.fillRect(barX + i * 4, barY - ((i * 7) % 12), bw, 22);
    }
    ctx.globalAlpha = 1;
    this.mono('0' + current.index + ' 000 210 924', barX, barY + 34 * this.ui, 7.5 * this.ui, ink, 0.36, 'left', 0.8);

    if (levels.level > 0.02) {
      this.glow(objectX, objectY, objectRadius * (1.3 + levels.bass * 0.4), accent, 0.025 + levels.bass * 0.04);
    }
    this.drawNoiseSlices(t, accent, 0.03, 5);
    this.vignette('rgba(57,44,27,0.2)');
  }

  private drawSpecimenObject(
    kind: 'seed' | 'eggplant' | 'tomato' | 'purr' | 'god',
    x: number,
    y: number,
    radius: number,
    time: number,
    ink: string,
    purple: string,
    red: string,
    amber: string,
    green: string,
    levels: Levels,
  ): void {
    const ctx = this.ctx;
    const breathe = 1 + Math.sin(time * 1.3) * 0.018 + levels.bass * 0.03;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(breathe, breathe);

    if (kind === 'seed') {
      ctx.strokeStyle = 'rgba(24,19,14,0.44)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        ctx.arc(0, 0, radius * (0.2 + i * 0.11), -0.5 + i, TAU - 0.7);
        ctx.stroke();
      }
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.085, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = purple;
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.1);
      ctx.bezierCurveTo(radius * 0.16, -radius * 0.2, radius * 0.12, -radius * 0.36, radius * 0.02, -radius * 0.37);
      ctx.stroke();
      ctx.fillStyle = green;
      ctx.beginPath();
      ctx.ellipse(radius * 0.07, -radius * 0.37, radius * 0.09, radius * 0.035, -0.4, 0, TAU);
      ctx.fill();
    } else if (kind === 'eggplant') {
      const tilt = -0.28 + Math.sin(time * 0.8) * 0.025;
      ctx.rotate(tilt);
      ctx.save();
      ctx.translate(-radius * 0.04, radius * 0.035);
      this.eggplantBody(ctx, radius, purple, 0.65);
      ctx.restore();
      this.eggplantBody(ctx, radius, purple, 1);
      ctx.fillStyle = green;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.02, -radius * 0.56);
      ctx.quadraticCurveTo(radius * 0.22, -radius * 0.58, radius * 0.14, -radius * 0.38);
      ctx.quadraticCurveTo(radius * 0.08, -radius * 0.31, 0, -radius * 0.38);
      ctx.quadraticCurveTo(-radius * 0.12, -radius * 0.34, -radius * 0.18, -radius * 0.46);
      ctx.quadraticCurveTo(-radius * 0.2, -radius * 0.58, -radius * 0.02, -radius * 0.56);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.55);
      ctx.quadraticCurveTo(radius * 0.04, -radius * 0.7, radius * 0.0, -radius * 0.83);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(247,236,220,0.65)';
      ctx.lineWidth = radius * 0.025;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.23, -radius * 0.21);
      ctx.quadraticCurveTo(-radius * 0.38, radius * 0.18, -radius * 0.22, radius * 0.53);
      ctx.stroke();
      ctx.fillStyle = ink;
      for (let i = 0; i < 34; i += 1) {
        const a = 0.2 + (i / 34) * Math.PI * 0.7;
        const r = radius * (0.52 + (i % 4) * 0.022);
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r + radius * 0.17, Math.sin(a) * r * 0.83, 1.2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (kind === 'tomato') {
      ctx.rotate(0.12 + Math.sin(time * 0.6) * 0.025);
      ctx.fillStyle = 'rgba(223,63,37,0.35)';
      ctx.beginPath();
      ctx.arc(-radius * 0.04, radius * 0.04, radius * 0.58, 0, TAU);
      ctx.fill();
      const tomatoGradient = ctx.createRadialGradient(-radius * 0.2, -radius * 0.22, radius * 0.08, 0, 0, radius * 0.62);
      tomatoGradient.addColorStop(0, '#ff6040');
      tomatoGradient.addColorStop(0.7, red);
      tomatoGradient.addColorStop(1, '#b92716');
      ctx.fillStyle = tomatoGradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.57, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = radius * 0.012;
      ctx.stroke();
      ctx.fillStyle = green;
      for (let i = 0; i < 5; i += 1) {
        ctx.save();
        ctx.rotate((i / 5) * TAU + Math.sin(time * 0.5) * 0.03);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(radius * 0.12, -radius * 0.16, radius * 0.18, -radius * 0.55);
        ctx.quadraticCurveTo(radius * 0.03, -radius * 0.22, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.04, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(247,236,220,0.7)';
      ctx.lineWidth = radius * 0.025;
      ctx.beginPath();
      ctx.arc(-radius * 0.15, -radius * 0.2, radius * 0.25, Math.PI * 1.05, Math.PI * 1.55);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,232,195,0.36)';
      for (let i = 0; i < 18; i += 1) {
        const a = i * 2.4;
        const r = radius * (0.15 + (i % 6) * 0.055);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.4, 0, TAU);
        ctx.fill();
      }
    } else if (kind === 'purr') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.64, 0, TAU);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.62, 0, TAU);
      ctx.clip();
      for (let i = 0; i < 11; i += 1) {
        ctx.strokeStyle = i % 3 === 0 ? ink : amber;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = radius * (i % 3 === 0 ? 0.035 : 0.018);
        ctx.beginPath();
        for (let j = 0; j <= 80; j += 1) {
          const x = -radius * 0.66 + (j / 80) * radius * 1.32;
          const y = -radius * 0.4 + i * radius * 0.079 + Math.sin(j * 0.3 + time * 2.2 + i) * radius * 0.025;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = purple;
      for (let i = 0; i < 3; i += 1) {
        const rr = radius * (0.72 + i * 0.11) + Math.sin(time * 2 + i) * 2;
        ctx.globalAlpha = 0.35 - i * 0.08;
        ctx.beginPath();
        ctx.arc(0, 0, rr, -0.7 + i * 0.2, 1.2 + i * 0.2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(24,19,14,0.48)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.8, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `400 ${this.unit * 0.012}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.48;
      ctx.textAlign = 'center';
      ctx.fillText('NO ANIMAL SHOWN', 0, radius * 0.92);
      ctx.globalAlpha = 1;
    } else {
      const pulse = 1 + Math.sin(time * 1.1) * 0.03 + levels.bass * 0.05;
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.72);
      gradient.addColorStop(0, 'rgba(255,248,219,1)');
      gradient.addColorStop(0.2, 'rgba(255,235,162,0.9)');
      gradient.addColorStop(0.55, 'rgba(216,134,47,0.28)');
      gradient.addColorStop(1, 'rgba(216,134,47,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.72 * pulse, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 36; i += 1) {
        const a = (i / 36) * TAU + time * 0.04;
        const len = radius * (i % 3 === 0 ? 0.78 : 0.53) * pulse;
        const p = polar(0, 0, len, a);
        ctx.strokeStyle = i % 4 === 0 ? purple : '#b77b27';
        ctx.globalAlpha = i % 4 === 0 ? 0.46 : 0.25;
        ctx.lineWidth = i % 4 === 0 ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * radius * 0.22, Math.sin(a) * radius * 0.22);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i += 1) {
        ctx.strokeStyle = i === 0 ? ink : i === 1 ? purple : 'rgba(24,19,14,0.3)';
        ctx.lineWidth = i === 0 ? 1.4 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, radius * (0.26 + i * 0.1) * pulse, i * 0.4, TAU - i * 0.3);
        ctx.stroke();
      }
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.055, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.34, 0);
      ctx.lineTo(radius * 0.34, 0);
      ctx.moveTo(0, -radius * 0.34);
      ctx.lineTo(0, radius * 0.34);
      ctx.stroke();
      ctx.font = `400 ${this.unit * 0.012}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.48;
      ctx.textAlign = 'center';
      ctx.fillText('PROOF', 0, radius * 0.95);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private eggplantBody(
    ctx: CanvasRenderingContext2D,
    radius: number,
    color: string,
    alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.55);
    ctx.bezierCurveTo(radius * 0.36, -radius * 0.5, radius * 0.44, radius * 0.06, radius * 0.27, radius * 0.54);
    ctx.bezierCurveTo(radius * 0.12, radius * 0.82, -radius * 0.24, radius * 0.8, -radius * 0.35, radius * 0.42);
    ctx.bezierCurveTo(-radius * 0.46, -radius * 0.01, -radius * 0.3, -radius * 0.53, 0, -radius * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(24,19,14,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // ────────────────────────────────────────────────────────────────────────────
  // VII. TRANCE
  // ────────────────────────────────────────────────────────────────────────────

  private drawTrance(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const secondary = frame.act.secondary;
    const levels = frame.levels;
    const phase = local < 5.366 ? 'fm' : local < 9.152 ? 'ampm' : local < 10.762 ? 'sm' : 'trance';

    this.fill('#070505');
    const direction = phase === 'sm' ? -1 : 1;
    this.glow(w * 0.5, h * 0.5, this.unit * 0.6, accent, 0.06 + levels.bass * 0.035);
    drawGrid(ctx, w, h, 58, '#f0e8d9', 0.026, t * 2.2 * direction, 0);
    this.dustField(t, accent, 0.34, 0.8);

    this.mono('VII / TRANCE', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.7, 'left', 2.1);
    this.mono('ROLE / 00' + (phase === 'fm' ? '1' : phase === 'ampm' ? '2' : phase === 'sm' ? '3' : '4'), w * 0.94, h * 0.22, 8 * this.ui, '#eee6d7', 0.4, 'right', 1.1);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, '#eee6d7', 0.12);

    if (phase === 'fm') this.drawDuality(local, 'F', 'M', 'FEMININE', 'MASCULINE', accent, secondary, levels);
    else if (phase === 'ampm') this.drawDayNight(local, accent, secondary, levels);
    else if (phase === 'sm') this.drawDuality(local, 'S', 'M', 'DOMINANT', 'SUBMISSIVE', accent, secondary, levels);
    else this.drawTranceTunnel(local, accent, secondary, levels);

    this.mono('FROM ' + (phase === 'fm' ? 'F TO M' : phase === 'ampm' ? 'AM TO PM' : phase === 'sm' ? 'S TO M' : 'TRANCE TO TRANCE'), w * 0.06, h * 0.865, 8 * this.ui, '#eee6d7', 0.4, 'left', 1.4);
    this.mono('NO CHARACTERS / ONLY FORCES', w * 0.94, h * 0.865, 8 * this.ui, accent, 0.38, 'right', 1.1);
    this.vignette('rgba(0,0,0,0.69)');
  }

  private drawDuality(
    local: number,
    left: string,
    right: string,
    leftLabel: string,
    rightLabel: string,
    accent: string,
    secondary: string,
    levels: Levels,
  ): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const size = Math.min(this.unit * 0.42, w * 0.295);
    const swap = (Math.sin(local * 1.5) + 1) / 2;
    const drift = 8 + levels.bass * 18;

    this.glow(cx, cy, this.unit * 0.34, accent, 0.035 + levels.bass * 0.025);
    ctx.save();
    ctx.strokeStyle = 'rgba(240,232,217,0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.94, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([2, 9]);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 1.15, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * TAU;
      const p1 = polar(cx, cy, size * 0.94, a);
      const p2 = polar(cx, cy, size * (i % 4 === 0 ? 1.04 : 0.985), a);
      ctx.strokeStyle = i % 4 === 0 ? accent : 'rgba(240,232,217,0.24)';
      ctx.lineWidth = i % 4 === 0 ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();

    const xL = cx - this.unit * 0.225 - drift;
    const yL = cy + this.unit * 0.055;
    const xR = cx + this.unit * 0.225 + drift;
    const yR = cy + this.unit * 0.055;
    ctx.save();
    setFont(ctx, size, 'serif', 400, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.48 + (1 - swap) * 0.52;
    ctx.fillText(left, xL, yL);
    ctx.strokeStyle = secondary;
    ctx.lineWidth = 1.7;
    ctx.globalAlpha = 0.42 + swap * 0.58;
    ctx.strokeText(right, xR, yR);
    // Misregistered print echo.
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = secondary;
    ctx.fillText(left, xL + 5, yL - 4);
    ctx.restore();

    for (let i = 0; i < 18; i += 1) {
      const angle = local * (0.2 + i * 0.008) + i * 2.2;
      const r = size * (1.18 + (i % 3) * 0.08);
      const p = polar(cx, cy, r, angle);
      const pMirror = polar(cx, cy, r, Math.PI - angle);
      ctx.fillStyle = i % 4 === 0 ? accent : '#efe6d8';
      ctx.globalAlpha = 0.2 + (i % 6) * 0.08;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1 + (i % 3), 0, TAU);
      ctx.arc(pMirror.x, pMirror.y, 1 + (i % 3), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.hairline(cx, cy - size * 0.1, cx, cy + size * 0.16, accent, 0.46);
    const knob = polar(cx, cy, 4, -Math.PI / 2 + swap * Math.PI);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, 3 + levels.beat * 2, 0, TAU);
    ctx.fill();
    this.mono('TO', cx, cy + size * 0.22, 9 * this.ui, accent, 0.8, 'center', 2);
    this.mono(leftLabel, xL, cy + size * 0.34, 8 * this.ui, '#eee6d7', 0.4, 'center', 1.3);
    this.mono(rightLabel, xR, cy + size * 0.34, 8 * this.ui, '#eee6d7', 0.4, 'center', 1.3);
    this.mono('SWITCH / 0' + (left === 'F' ? '1' : '3'), w * 0.5, h * 0.76, 8 * this.ui, '#eee6d7', 0.32, 'center', 1.2);
  }

  private drawDayNight(local: number, accent: string, secondary: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = Math.min(this.unit * 0.24, w * 0.19);
    const spin = local * 0.18;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = secondary;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();

    setFont(ctx, radius * 0.45, 'serif', 400, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.fillText('AM', radius * 0.42, 0);
    ctx.fillStyle = '#070505';
    ctx.fillText('PM', -radius * 0.42, 0);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    const size = Math.min(this.unit * 0.16, w * 0.13);
    ctx.save();
    setFont(ctx, size, 'serif', 400, true);
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.8;
    ctx.textAlign = 'center';
    ctx.fillText('AM', w * 0.17, h * 0.52);
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.strokeText('PM', w * 0.83, h * 0.52);
    ctx.restore();

    this.drawBigWord('AM / PM', w * 0.5, h * 0.3, w * 0.74, this.unit * 0.13, PAPER, accent, 1, 0.08, 'center', 0.7, true);
    this.mono('CLOCKWISE INTO NOON', w * 0.06, h * 0.75, 8 * this.ui, '#eee6d7', 0.34, 'left', 1.3);
    this.mono('COUNTERCLOCKWISE INTO NIGHT', w * 0.94, h * 0.75, 8 * this.ui, '#eee6d7', 0.34, 'right', 1.3);
    this.hairline(w * 0.06, h * 0.72, w * 0.94, h * 0.72, '#eee6d7', 0.16);

    for (let i = 0; i < 3; i += 1) {
      const p1 = polar(cx, cy, radius * (1.2 + i * 0.09), spin + i);
      const p2 = polar(cx, cy, radius * (1.2 + i * 0.09), spin + i + Math.PI);
      ctx.fillStyle = i === 0 ? accent : 'rgba(240,232,217,0.6)';
      ctx.globalAlpha = 0.4 + levels.beat * 0.2;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 2, 0, TAU);
      ctx.arc(p2.x, p2.y, 2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawTranceTunnel(local: number, accent: string, secondary: string, levels: Levels): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = local;
    const cx = w * 0.5;
    const cy = h * 0.49;
    const count = 26;
    const rotation = t * 0.18;

    for (let i = count - 1; i >= 0; i -= 1) {
      const p = (i / count + t * 0.055) % 1;
      const scale = 0.12 + p * 0.72;
      const size = this.unit * 0.74 * scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation + i * 0.09 + p * 1.2);
      ctx.strokeStyle = i % 4 === 0 ? accent : 'rgba(240,232,217,0.3)';
      ctx.globalAlpha = (1 - p) * (0.2 + levels.level * 0.2);
      ctx.lineWidth = 1 + (1 - p) * 1.2;
      ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.1);
    for (let i = 0; i < 11; i += 1) {
      const r = this.unit * (0.03 + i * 0.036);
      ctx.strokeStyle = i % 3 === 0 ? accent : 'rgba(240,232,217,0.24)';
      ctx.globalAlpha = 0.5 + levels.level * 0.2;
      ctx.lineWidth = i % 3 === 0 ? 1.8 : 1;
      ctx.beginPath();
      ctx.arc(0, 0, r, i * 0.6, TAU - i * 0.25);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * TAU + t * 0.1;
      const p1 = polar(0, 0, this.unit * 0.035, a);
      const p2 = polar(0, 0, this.unit * (0.26 + (i % 3) * 0.04), a);
      ctx.strokeStyle = i % 6 === 0 ? hexToRgba(accent, 0.55) : 'rgba(240,232,217,0.12)';
      ctx.lineWidth = i % 6 === 0 ? 1.1 : 0.7;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();

    const size = this.unit * 0.17;
    ctx.save();
    setFont(ctx, size, 'display');
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.16 + levels.bass * 0.08;
    ctx.fillStyle = accent;
    ctx.fillText('TRANCE', cx, cy - size * 0.2);
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = secondary;
    ctx.lineWidth = 1;
    ctx.strokeText('TRANCE', cx, cy + size * 0.92);
    ctx.restore();

    this.drawBigWord('TRANCE', cx, cy + size * 0.4, w * 0.82, this.unit * 0.25, PAPER, accent, 1, 0.15 + levels.beat * 0.2, 'center', 0.9, false, -0.02);
    this.mono('ENTER / DO NOT EXIT', w * 0.5, cy + this.unit * 0.3, 8 * this.ui, accent, 0.5, 'center', 1.7);
    this.mono('RECURSION DEPTH ' + String(Math.round(3 + local * 3)).padStart(3, '0'), w * 0.94, h * 0.8, 8 * this.ui, '#eee6d7', 0.3, 'right', 0.9);
  }
  // ────────────────────────────────────────────────────────────────────────────
  // VIII. DEPARTURE
  // ────────────────────────────────────────────────────────────────────────────

  private drawDeparture(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const cue = frame.cue;
    const word = displayWord(cue);
    const cueLocal = cue ? t - cue.start : 0;
    const vibrationPhase = t < 110.9;
    const isolation = t >= 117.274;
    const leftTimes = [110.9, 112.22, 113.1, 114.18, 114.92, 115.78];
    const leftCount = leftTimes.filter((time) => t >= time).length;

    this.fill('#05070b');
    this.glow(w * 0.5, h * 0.49, this.unit * 0.48, accent, isolation ? 0.035 : 0.055 + levels.mid * 0.03);
    this.dustField(t, accent, isolation ? 0.16 : 0.28, 0.32);
    drawGrid(ctx, w, h, 92, '#e8e8e4', 0.02, t * 0.7, 0);

    this.mono('VIII / DEPARTURE', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.66, 'left', 2.1);
    this.mono('RETURN PATH / ' + (isolation ? 'LOST' : 'OPEN'), w * 0.94, h * 0.22, 8 * this.ui, '#e9e8e2', 0.36, 'right', 1.1);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, '#e9e8e2', 0.1);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = this.unit * 0.17;

    // A signal line, still trying to make contact.
    const lineY = h * 0.65;
    const lineAlpha = isolation ? 0.12 : 0.28;
    this.hairline(w * 0.16, lineY, w * 0.84, lineY, '#e9e8e2', lineAlpha);
    if (!isolation) {
      ctx.save();
      ctx.strokeStyle = hexToRgba(accent, 0.52);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= 180; i += 1) {
        const p = i / 180;
        const x = w * 0.16 + p * w * 0.68;
        const envelope = Math.sin(p * Math.PI);
        const spike = Math.sin(p * 53 + t * 3.2) * Math.sin(p * 7.2 + t);
        const y = lineY - spike * this.unit * 0.024 * envelope * (0.4 + levels.level * 1.5) * (1 - leftCount * 0.12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (vibrationPhase) {
      // The closing of a circuit, the completion of a shape.
      ctx.save();
      ctx.translate(cx, cy);
      const completion = t > 107.903;
      const arcs = 6;
      for (let i = 0; i < arcs; i += 1) {
        const p = (i / arcs + t * 0.05) % 1;
        ctx.strokeStyle = i === 0 ? accent : 'rgba(233,232,226,0.17)';
        ctx.globalAlpha = 0.4 + levels.level * 0.2;
        ctx.lineWidth = i === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, radius * (0.6 + i * 0.16), p * TAU, p * TAU + Math.PI * (0.4 + i * 0.08));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = completion ? accent : 'rgba(233,232,226,0.2)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.08, -Math.PI / 2, -Math.PI / 2 + TAU * (completion ? 1 : (local / 7.4) % 1));
      ctx.stroke();
      if (completion) {
        ctx.globalAlpha = 0.16 + levels.beat * 0.18;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.02, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = PAPER;
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, TAU);
        ctx.fill();
      }
      // Vibrations as concentric dotted arcs.
      for (let i = 0; i < 5; i += 1) {
        const rr = radius * (0.35 + i * 0.13) + Math.sin(t * 3.5 + i) * 2;
        ctx.strokeStyle = i === 0 ? accent : 'rgba(233,232,226,0.18)';
        ctx.setLineDash([1, 7 + i * 2]);
        ctx.globalAlpha = 0.6 - i * 0.09;
        ctx.beginPath();
        ctx.arc(0, 0, rr, i * 0.9, TAU - i * 0.7);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      if (word) {
        const reveal = easeOutExpo(cueLocal / 0.36);
        const y = h * 0.34;
        this.drawBigWord(word, w * 0.5, y, w * 0.76, this.unit * 0.16, PAPER, accent, reveal, Math.max(0, 0.7 - cueLocal * 2.6), 'center', 0.9, false, -0.03);
        this.drawWordLabel(word, w * 0.5, y + this.unit * 0.035, 10 * this.ui, accent, 0.48);
      } else {
        this.drawSerifWord('if I can feel your', w * 0.5, h * 0.34, w * 0.5, this.unit * 0.09, PAPER, 0.42, 'center', true);
      }
      this.mono('SIGNAL / ' + String(Math.round(46 + levels.mid * 42)).padStart(2, '0') + ' Hz', w * 0.5, cy + radius * 1.45, 8 * this.ui, accent, 0.42, 'center', 1.1);
    } else {
      // A ring with pieces missing; each "left" makes a larger absence.
      const startedAt = 110.9;
      const age = t - startedAt;
      const brokenAngle = Math.PI * 0.18 + Math.min(1, age / 6) * Math.PI * 0.42;
      ctx.save();
      ctx.translate(cx, cy);
      const segments = 34;
      for (let i = 0; i < segments; i += 1) {
        const missing = i < leftCount * 2.2 || isolation;
        if (missing) continue;
        const a0 = (i / segments) * TAU + Math.PI * 0.2;
        const a1 = a0 + (TAU / segments) * 0.58;
        ctx.strokeStyle = i % 3 === 0 ? accent : 'rgba(233,232,226,0.32)';
        ctx.lineWidth = i % 3 === 0 ? 1.4 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, radius, a0, a1);
        ctx.stroke();
      }
      ctx.setLineDash([1, 10]);
      ctx.strokeStyle = 'rgba(233,232,226,0.16)';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.25, brokenAngle, TAU - 0.4);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!isolation) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, 2.2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Fragments falling away on each repetition.
      for (let i = 0; i < leftCount * 3; i += 1) {
        const cueIndex = Math.floor(i / 3);
        const fragmentAge = t - leftTimes[Math.min(cueIndex, leftTimes.length - 1)];
        if (fragmentAge < 0) continue;
        const angle = Math.PI * 0.2 + i * 1.73;
        const p = polar(cx, cy, radius * (1 + (i % 3) * 0.17), angle);
        const falling = fragmentAge * (18 + (i % 4) * 8);
        const x = p.x + Math.cos(angle) * falling * 0.4;
        const y = p.y + falling;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle + fragmentAge * 0.6);
        ctx.strokeStyle = i % 4 === 0 ? accent : 'rgba(233,232,226,0.5)';
        ctx.globalAlpha = Math.max(0, 0.65 - fragmentAge * 0.17);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-5 - (i % 4) * 3, 0);
        ctx.lineTo(5 + (i % 4) * 4, 0);
        ctx.stroke();
        ctx.restore();
      }

      if (word) {
        const reveal = easeOutExpo(cueLocal / 0.5);
        this.drawBigWord(word, w * 0.5, h * 0.35, w * 0.8, this.unit * 0.15, PAPER, accent, reveal, Math.max(0, 0.7 - cueLocal * 2), 'center', isolation ? 0.32 : 0.82, isolation, -0.04);
        this.drawWordLabel(word, w * 0.5, h * 0.385, 10 * this.ui, accent, isolation ? 0.3 : 0.46);
      }

      // Repeated, fading "left" echoes near the ring.
      if (!isolation) {
        for (let i = 0; i < leftCount; i += 1) {
          const echoAge = t - leftTimes[i];
          if (echoAge < 0) continue;
          const alpha = Math.max(0, 0.34 - echoAge * 0.13);
          this.drawSerifWord('left', cx + (i - 2) * this.unit * 0.06, cy + radius * 0.32 + i * this.unit * 0.022, this.unit * 0.13, this.unit * 0.055, accent, alpha, 'center', true, -0.02);
        }
      } else {
        this.glow(cx, cy, this.unit * 0.035, PAPER, 0.2 + levels.beat * 0.12);
      }
    }

    this.mono(isolation ? '> return; // NO RESPONSE' : '> waiting for return signal', w * 0.06, h * 0.77, 8 * this.ui, isolation ? '#e9e8e2' : accent, isolation ? 0.22 : 0.4, 'left', 0.9);
    this.mono(isolation ? 'STATE / ISOLATED' : 'STATE / HOLDING ON', w * 0.94, h * 0.77, 8 * this.ui, '#e9e8e2', 0.3, 'right', 0.9);
    this.vignette('rgba(0,0,0,0.73)');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // IX. ERASURE
  // ────────────────────────────────────────────────────────────────────────────

  private drawErasure(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const cue = frame.cue;
    const word = displayWord(cue);
    const cueLocal = cue ? t - cue.start : 0;
    const illegal = local >= 12.891;
    const god = local >= 7.375 && local < 10.328;

    this.fill(illegal ? '#0c0807' : '#070606');
    this.glow(w * 0.5, h * 0.5, this.unit * 0.56, accent, illegal ? 0.12 + levels.bass * 0.06 : 0.045);
    drawGrid(ctx, w, h, 58, '#ecdfcf', 0.03, 0, t * 2.2);
    this.dustField(t, accent, illegal ? 0.4 : 0.27, 1.1);

    this.mono('IX / ERASURE', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.7, 'left', 2.1);
    this.mono(illegal ? 'FATAL / UNCAUGHT' : 'MEMORY / EDIT', w * 0.94, h * 0.22, 8 * this.ui, '#eadfd0', illegal ? 0.9 : 0.35, 'right', 1.1);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, accent, illegal ? 0.4 : 0.13);

    if (!illegal) {
      const cx = w * 0.5;
      const cy = h * 0.53;
      const fragmentCount = 42;

      if (god) {
        // A halo of accusation.
        const pulse = 1 + levels.bass * 0.08;
        for (let i = 0; i < 42; i += 1) {
          const a = (i / 42) * TAU + t * 0.03;
          const len = this.unit * (0.18 + (i % 7) * 0.022) * pulse;
          const p1 = polar(cx, cy, this.unit * 0.06, a);
          const p2 = polar(cx, cy, len, a);
          ctx.strokeStyle = i % 5 === 0 ? accent : 'rgba(236,225,212,0.15)';
          ctx.lineWidth = i % 5 === 0 ? 1.2 : 0.8;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        for (let i = 0; i < 5; i += 1) {
          ctx.strokeStyle = i === 0 ? accent : 'rgba(236,225,212,0.2)';
          ctx.lineWidth = i === 0 ? 1.4 : 1;
          ctx.beginPath();
          ctx.arc(cx, cy, this.unit * (0.09 + i * 0.045), i * 0.6 + t * 0.04, TAU - i * 0.4);
          ctx.stroke();
        }
        setFont(ctx, fitFontSize(ctx, 'challenging', 'serif', w * 0.56, this.unit * 0.11, 400, true, -0.02), 'serif', 400, true);
        ctx.fillStyle = PAPER;
        ctx.globalAlpha = 0.8;
        ctx.textAlign = 'center';
        ctx.fillText('challenging', cx, h * 0.41);
        setFont(ctx, fitFontSize(ctx, 'your god', 'serif', w * 0.56, this.unit * 0.11, 400, true, -0.02), 'serif', 400, true);
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.fillText('your god', cx, h * 0.45);
        this.mono('AUTHORIZATION / REVOKED', w * 0.5, h * 0.71, 8 * this.ui, accent, 0.5, 'center', 1.5);
      } else {
        // Fragmented typography, an eraser passing through memory.
        const eraserX = w * (0.16 + ((local * 0.12) % 0.7));
        for (let i = 0; i < fragmentCount; i += 1) {
          const angle = i * 2.399 + t * 0.04;
          const spread = this.unit * (0.08 + ((i * 37) % 100) * 0.0062);
          const x = cx + Math.cos(angle) * spread * 1.75;
          const y = cy + Math.sin(angle) * spread;
          const size = 2.2 + (i % 9) * 1.6;
          ctx.fillStyle = i % 11 === 0 ? accent : 'rgba(239,228,214,0.68)';
          ctx.globalAlpha = 0.26 + (i % 8) * 0.06;
          ctx.fillRect(x, y, size * (i % 3 === 0 ? 2.4 : 1), size * 0.55);
          if (i % 7 === 0) {
            this.mono('0x' + ((i * 73) % 255).toString(16).toUpperCase().padStart(2, '0'), x + 9, y + 2, 6.5 * this.ui, '#e9dfd0', 0.27, 'left', 0.5);
          }
        }
        ctx.globalAlpha = 1;

        // A fragmented heart, being disassembled by the eraser.
        const split = smoothstep(invLerp(6.45, 8.1, local));
        if (local > 2.9) {
          const appear = smoothstep(invLerp(2.9, 4.2, local));
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w / 2 - split * w * 0.025, h);
          ctx.clip();
          drawHeartLine(ctx, cx, cy + this.unit * 0.02, this.unit * 0.14, accent, 1, 0.42 * appear * (1 - split * 0.35), 1.1, split * 0.08);
          ctx.restore();
          ctx.save();
          ctx.beginPath();
          ctx.rect(w / 2 + split * w * 0.025, 0, w, h);
          ctx.clip();
          drawHeartLine(ctx, cx, cy + this.unit * 0.02, this.unit * 0.14, '#eadfd0', 1, 0.28 * appear * (1 - split * 0.35), 1, -split * 0.1);
          ctx.restore();
          const points = heartPoints(90);
          for (let i = 0; i < points.length; i += 2) {
            if (i / points.length > appear) continue;
            const p = points[i];
            const side = p.x < 0 ? -1 : 1;
            const x = cx + p.x * this.unit * 0.14 + side * split * w * 0.025;
            const y = cy + this.unit * 0.02 + p.y * this.unit * 0.14 + (i % 5) * 1.2;
            ctx.fillStyle = i % 6 === 0 ? accent : 'rgba(239,228,214,0.6)';
            ctx.globalAlpha = 0.22 + (i % 4) * 0.05;
            ctx.fillRect(x, y, 2.4, 1);
          }
          ctx.globalAlpha = 1;
        }

        // The word "fragments", being deleted left to right.
        if (word === 'FRAGMENTS' || word === 'DISHEARTENED') {
          const reveal = easeOutExpo(cueLocal / 0.35);
          const erase = word === 'FRAGMENTS' ? clamp(cueLocal / 1.2) : 0;
          this.drawBigWord(
            word,
            w * 0.5,
            h * 0.37,
            w * 0.8,
            this.unit * (word === 'DISHEARTENED' ? 0.13 : 0.17),
            PAPER,
            accent,
            reveal * (1 - erase),
            Math.max(0, 0.8 - cueLocal * 2.5),
            'center',
            0.94,
            false,
            -0.025,
          );
          this.drawWordLabel(word, w * 0.5, h * 0.405, 10 * this.ui, accent, 0.45);
        } else {
          this.drawSerifWord('if I can erase', w * 0.5, h * 0.315, w * 0.55, this.unit * 0.09, PAPER, 0.4, 'center', true);
        }

        this.hairline(eraserX, h * 0.25, eraserX, h * 0.73, accent, 0.62, 1.5);
        this.hairline(eraserX - 10, h * 0.25, eraserX + 10, h * 0.25, accent, 0.55, 1);
        this.hairline(eraserX - 10, h * 0.73, eraserX + 10, h * 0.73, accent, 0.55, 1);
        this.mono('ERASE / ' + String(Math.round(clamp(local / 7.375) * 100)).padStart(3, '0') + '%', eraserX + 8, h * 0.25, 7.5 * this.ui, accent, 0.6, 'left', 0.9);
        this.mono('FRAGMENT TABLE / ' + String(fragmentCount).padStart(2, '0') + ' ENTRIES', w * 0.06, h * 0.75, 8 * this.ui, '#e9dfd0', 0.38, 'left', 1);
      }
    } else {
      // A terminal-level error. Full red, black hazard bands, words too big to fit.
      const flash = 1 - smoothstep(invLerp(12.891, 13.24, t));
      const redBg = '#e53720';
      if (local < 14.9) {
        this.fill(redBg);
        this.glow(w * 0.5, h * 0.5, this.unit * 0.46, '#2b0b05', 0.28);
        this.drawHazard(0, 0, w, h * 0.055, '#1a0c08', 0.8, 42);
        this.drawHazard(0, h * 0.945, w, h * 0.055, '#1a0c08', 0.8, 42);
        this.mono('FATAL ERROR', w * 0.06, h * 0.17, 9 * this.ui, '#1a0c08', 0.9, 'left', 2.4);
        this.mono('PROCESS 0x2104 TERMINATED', w * 0.94, h * 0.17, 8 * this.ui, '#1a0c08', 0.7, 'right', 1.2);
        this.drawBigWord('ILLEGAL', w * 0.5, h * 0.43, w * 0.86, this.unit * 0.25, '#160a07', '#ffd9ca', 1, 0.18, 'center', 0.96, false, -0.035);
        this.drawBigWord('ARGUMENTS', w * 0.5, h * 0.62, w * 0.86, this.unit * 0.19, '#160a07', '#ffd9ca', 1, 0.18, 'center', 0.85, false, -0.035);
        this.mono('THROW new GodError("INVALID INPUT: EXECUTION REQUESTED")', w * 0.5, h * 0.72, 8.5 * this.ui, '#2b0b05', 0.7, 'center', 0.2);
        this.mono('AT WORLD.EXECUTE(ME) [SIMULATION:1:1]', w * 0.5, h * 0.75, 8 * this.ui, '#2b0b05', 0.45, 'center', 0.4);
        this.mono('NO ARGUMENT CAN JUSTIFY LEAVING', w * 0.5, h * 0.85, 9 * this.ui, '#1a0c08', 0.7, 'center', 1.2);
        this.hairline(w * 0.24, h * 0.81, w * 0.76, h * 0.81, '#1a0c08', 0.4);
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,244,221,${flash * 0.7})`;
          ctx.fillRect(0, 0, w, h);
        }
        this.drawNoiseSlices(t, '#1a0c08', 0.26, 16);
      } else {
        // The screen falls back into black, then the countdown begins.
        const fade = smoothstep(invLerp(14.9, 16.2, local));
        ctx.fillStyle = `rgba(3,3,3,${fade})`;
        ctx.fillRect(0, 0, w, h);
        this.mono('> execution protocol accepted', w * 0.5, h * 0.5, 8 * this.ui, accent, 0.42 * fade, 'center', 1.1);
      }
    }

    this.vignette('rgba(0,0,0,0.72)');
  }
  // ────────────────────────────────────────────────────────────────────────────
  // X. PROTOCOL
  // ────────────────────────────────────────────────────────────────────────────

  private drawProtocol(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const duration = frame.act.end - frame.act.start;
    const progress = clamp(local / duration);
    const remaining = Math.max(0, frame.act.end - t);
    const cx = w * 0.5;
    const cy = h * 0.48;
    const radius = Math.min(this.unit * 0.225, w * 0.17);

    this.fill('#050303');
    this.glow(cx, cy, this.unit * 0.46, accent, 0.06 + levels.bass * 0.05);
    drawGrid(ctx, w, h, 66, '#eee2d2', 0.022, 0, local * 1.3);
    this.dustField(t, accent, 0.19, 0.45);

    this.mono('X / PROTOCOL', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.7, 'left', 2.1);
    this.mono('APPEAL / IN PROGRESS', w * 0.94, h * 0.22, 8 * this.ui, '#e9dfd0', 0.38, 'right', 1.2);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, accent, 0.2);

    // The blade: a single line falling toward the centre for twelve seconds.
    const bladeProgress = Math.pow(progress, 1.7);
    const bladeY = lerp(-h * 0.04, cy, bladeProgress);
    const bladeAlpha = 0.24 + bladeProgress * 0.62;
    this.hairline(w * 0.12, bladeY, w * 0.88, bladeY, accent, bladeAlpha, 1 + bladeProgress);
    this.glow(w * 0.5, bladeY, this.unit * 0.09, accent, 0.1 + bladeProgress * 0.15);
    this.mono('BLADE / DESCENDING', w * 0.88, bladeY - 7, 7.5 * this.ui, accent, 0.4 + bladeProgress * 0.3, 'right', 1);
    this.mono(String(Math.round(bladeProgress * 100)).padStart(3, '0') + '%', w * 0.12, bladeY - 7, 7.5 * this.ui, accent, 0.4 + bladeProgress * 0.3, 'left', 1);

    // Background typographic slab.
    ctx.save();
    setFont(ctx, this.unit * 0.24, 'display');
    ctx.fillStyle = 'rgba(238,225,209,0.055)';
    ctx.textAlign = 'center';
    ctx.fillText('EXECUTION', cx, cy + this.unit * 0.078);
    ctx.restore();

    // The room listens: fine radial spikes around the dial.
    for (let i = 0; i < 120; i += 1) {
      const a = (i / 120) * TAU - Math.PI / 2 + local * 0.005;
      const energy = levels.mid * 0.06 + levels.bass * ((i % 6) / 6) * 0.05;
      const len = 5 + energy * this.unit * 0.3;
      const p1 = polar(cx, cy, radius * 1.24, a);
      const p2 = polar(cx, cy, radius * 1.24 + len, a);
      ctx.strokeStyle = i % 10 === 0 ? hexToRgba(accent, 0.32) : 'rgba(238,225,209,0.1)';
      ctx.lineWidth = i % 10 === 0 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-local * 0.12);
    ctx.strokeStyle = 'rgba(238,225,209,0.11)';
    ctx.lineWidth = 1;
    ctx.setLineDash([28, 20, 2, 20]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.42, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Circular countdown.
    ctx.save();
    ctx.translate(cx, cy);
    const segments = 60;
    for (let i = 0; i < segments; i += 1) {
      const a = -Math.PI / 2 + (i / segments) * TAU;
      const p1 = polar(0, 0, radius * 1.0, a);
      const p2 = polar(0, 0, radius * (i % 5 === 0 ? 1.11 : 1.06), a);
      const passed = i / segments <= progress;
      ctx.strokeStyle = passed ? accent : 'rgba(237,225,211,0.16)';
      ctx.globalAlpha = passed ? 0.56 : 0.28;
      ctx.lineWidth = i % 5 === 0 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(237,225,211,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.94, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(accent, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.94, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
    ctx.stroke();

    // Radar arm.
    const radarAngle = -Math.PI / 2 + local * 0.7;
    const radar = polar(0, 0, radius * 0.92, radarAngle);
    ctx.strokeStyle = hexToRgba(accent, 0.28);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radar.x, radar.y);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(radar.x, radar.y, 2, 0, TAU);
    ctx.fill();

    // Tiny crosshair marks.
    for (let i = 0; i < 4; i += 1) {
      const p = polar(0, 0, radius * 0.76, (i / 4) * TAU + Math.PI / 4);
      drawCross(ctx, p.x, p.y, radius * 0.035, '#eee1d0', 0.4);
    }
    setFont(ctx, radius * 0.22, 'mono', 400);
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.15;
    ctx.textAlign = 'center';
    ctx.fillText('T−', 0, -radius * 0.09);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = accent;
    setFont(ctx, radius * 0.14, 'mono', 400);
    ctx.fillText(remaining.toFixed(3), 0, radius * 0.09);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = PAPER;
    setFont(ctx, radius * 0.035, 'mono', 400);
    ctx.fillText('SECONDS REMAIN', 0, radius * 0.19);
    ctx.globalAlpha = 1;
    ctx.restore();

    // Protocol receipts, typed in at a slow terminal pace.
    const logs = [
      { at: 0.4, text: '> EXECUTION PROTOCOL / v.9.9' },
      { at: 2.4, text: '  TARGET .............. WORLD' },
      { at: 4.6, text: '  OFFENCE ............. ILLEGAL ARGUMENTS' },
      { at: 6.7, text: '  APPEAL .............. DENIED' },
      { at: 8.5, text: '  MERCY MODULE ........ NOT FOUND' },
      { at: 10.2, text: '  GOODBYE, WORLD ....... TRUE' },
    ];
    const logX = w * 0.065;
    const logY = h * 0.36;
    this.mono('// RECEIPTS', logX, logY - 24 * this.ui, 8 * this.ui, accent, 0.5, 'left', 1.4);
    for (let i = 0; i < logs.length; i += 1) {
      if (local < logs[i].at) continue;
      const age = local - logs[i].at;
      const typed = Math.min(logs[i].text.length, Math.floor(age * 58));
      this.mono(logs[i].text.slice(0, typed), logX, logY + i * 17 * this.ui, 7.5 * this.ui, i === logs.length - 1 ? accent : '#e7dccd', i === logs.length - 1 ? 0.8 : 0.4, 'left', 0.32);
    }

    // Side readouts.
    this.mono('APPEAL RATE / 0.00', w * 0.94, h * 0.36, 7.5 * this.ui, '#e7dccd', 0.32, 'right', 0.8);
    this.mono('MERCY / NULL', w * 0.94, h * 0.385, 7.5 * this.ui, '#e7dccd', 0.28, 'right', 0.8);
    this.mono('TIME / ' + formatClock(t, true), w * 0.94, h * 0.41, 7.5 * this.ui, accent, 0.4, 'right', 0.8);

    // The last two seconds overexpose in slow pulses.
    if (remaining < 2.4) {
      const urgency = 1 - remaining / 2.4;
      ctx.save();
      ctx.strokeStyle = `rgba(255,62,38,${0.16 + urgency * 0.25})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i += 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (0.15 + i * 0.12) * (1 + Math.sin(t * 4 + i) * 0.01), 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
      this.hairline(w * 0.06, h * 0.68, w * 0.94, h * 0.68, accent, 0.12 + urgency * 0.3);
      this.mono('THE WORLD HAS NO MORE ARGUMENTS.', w * 0.5, h * 0.76, 8 * this.ui, accent, 0.36 + urgency * 0.34, 'center', 1.2);
    }

    // Incoming flash as the blade arrives.
    if (remaining < 0.42) {
      const f = 1 - remaining / 0.42;
      ctx.fillStyle = `rgba(255,241,222,${f * 0.55})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.drawNoiseSlices(t, accent, 0.06 + progress * 0.22, 14);
    this.vignette('rgba(0,0,0,0.74)');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // XI. JUDGMENT
  // ────────────────────────────────────────────────────────────────────────────

  private drawJudgment(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const levels = frame.levels;
    const cue = frame.cue;
    const word = displayWord(cue);
    const hitTimes = [0, 0.94, 1.86, 2.88, 3.86, 4.62, 5.5, 6.32, 7.54, 8.42, 9.38, 10.34];
    const numberCues = [
      { at: 11.24, word: 'EIN', number: '01', zh: '一' },
      { at: 11.661, word: 'DOS', number: '02', zh: '二' },
      { at: 11.997, word: 'TROIS', number: '03', zh: '三' },
      { at: 12.584, word: 'NE', number: '04', zh: '四' },
      { at: 13.033, word: 'FEM', number: '05', zh: '五' },
      { at: 13.464, word: 'LIU', number: '06', zh: '六' },
    ];
    const french = local >= 11.24 && local < 13.924;
    const finalExecution = local >= 13.924 && local < 14.972;
    const aftermath = local >= 14.972;

    this.fill('#060404');
    this.glow(w * 0.5, h * 0.5, this.unit * 0.55, accent, aftermath ? 0.035 : 0.08 + levels.bass * 0.06);
    drawGrid(ctx, w, h, 62, '#efe2d1', 0.02, 0, local * 1.8);
    this.dustField(t, accent, aftermath ? 0.22 : 0.34, 0.9);

    this.mono('XI / JUDGMENT', w * 0.06, h * 0.22, 9 * this.ui, accent, 0.7, 'left', 2.1);
    this.mono(aftermath ? 'RESIDUE / 0.999' : 'EXECUTION / ACTIVE', w * 0.94, h * 0.22, 8 * this.ui, '#eee2d0', 0.4, 'right', 1.2);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, accent, 0.22);

    if (!aftermath) {
      const lastHitIndex = [...hitTimes].reverse().findIndex((hit) => local >= hit);
      const hitIndex = lastHitIndex === -1 ? -1 : hitTimes.length - 1 - lastHitIndex;
      const lastHit = hitIndex >= 0 ? hitTimes[hitIndex] : 0;
      const sinceHit = Math.max(0, local - lastHit);
      const decay = Math.exp(-sinceHit * 6.4);
      const shake = frame.reduced ? 0 : decay * 7;
      const shakeX = Math.sin(local * 92) * shake;
      const shakeY = Math.cos(local * 71) * shake;
      const hitCount = hitTimes.filter((hit) => local >= hit).length;
      const isLastHit = hitIndex === hitTimes.length - 1;

      // Shockwaves from each recent execution.
      for (let i = Math.max(0, hitCount - 4); i < hitCount; i += 1) {
        const age = local - hitTimes[i];
        if (age < 0 || age > 1.9) continue;
        const p = smoothstep(age / 1.9);
        const rr = this.unit * (0.08 + p * 0.52);
        ctx.save();
        ctx.strokeStyle = hexToRgba(i % 3 === 0 ? '#f3e9d9' : accent, (1 - p) * 0.35);
        ctx.lineWidth = 1 + (1 - p) * 2;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.52, rr, 0, TAU);
        ctx.stroke();
        if (i === hitCount - 1) {
          ctx.strokeStyle = hexToRgba(accent, (1 - p) * 0.2);
          ctx.beginPath();
          ctx.arc(w * 0.5, h * 0.52, rr * 1.15, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.translate(shakeX, shakeY);
      // Seal wheel, draws as the 12 executions land.
      const cx = w * 0.5;
      const cy = h * 0.5;
      const seal = this.unit * 0.26;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(local * 0.03 + (hitIndex % 2 === 0 ? 0.03 : -0.03));
      for (let i = 0; i < 12; i += 1) {
        const a0 = (i / 12) * TAU - Math.PI / 2;
        const a1 = ((i + 1) / 12) * TAU - Math.PI / 2;
        ctx.strokeStyle = i < hitCount ? hexToRgba(accent, 0.55) : 'rgba(238,226,208,0.12)';
        ctx.lineWidth = i < hitCount ? 2 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, seal, a0 + 0.03, a1 - 0.03);
        ctx.stroke();
        if (i < hitCount) {
          const p = polar(0, 0, seal * 1.07, a0 + 0.08);
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.7, 0, TAU);
          ctx.fill();
        }
      }
      ctx.strokeStyle = 'rgba(238,226,208,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, seal * 0.62, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Giant central word: the execution is the composition.
      if (french) {
        const active = numberCues.filter((n) => local >= n.at).at(-1) ?? numberCues[0];
        const activeIndex = numberCues.indexOf(active);
        const since = local - active.at;
        const reveal = easeOutExpo(clamp(since / 0.12));
        const pulse = Math.exp(-since * 5);
        this.drawBigWord(active.number, w * 0.5, h * 0.41, w * 0.76, this.unit * 0.31, hexToRgba(PAPER, 0.13), accent, 1, 0, 'center', 0.5, true, -0.04);
        this.drawBigWord(active.word, w * 0.5, h * 0.5, w * 0.8, this.unit * 0.25 * (1 + pulse * 0.035), PAPER, accent, reveal, 0.3 + pulse * 0.45, 'center', 1, false, -0.035);
        this.cjk(active.zh, w * 0.5, h * 0.545, 13 * this.ui, accent, 0.7, 'center');
        this.mono('COUNTDOWN / 0' + (6 - activeIndex) + ' REMAINING', w * 0.5, h * 0.72, 8 * this.ui, accent, 0.42, 'center', 1.5);
        for (let i = 0; i < 6; i += 1) {
          const x = w * 0.5 + (i - 2.5) * 24;
          this.hairline(x, h * 0.75, x, h * 0.75 + (i <= activeIndex ? 14 : 5), i <= activeIndex ? accent : '#eee2d0', i <= activeIndex ? 0.7 : 0.2, i === activeIndex ? 2 : 1);
        }
      } else if (finalExecution) {
        this.drawBigWord('EXECUTION', w * 0.5, h * 0.5, w * 0.9, this.unit * 0.28, PAPER, accent, 1, 0.4 + Math.exp(-(local - 13.924) * 5) * 0.4, 'center', 0.95, false, -0.04);
        this.mono('FINAL / FINAL / FINAL', w * 0.5, h * 0.72, 8 * this.ui, accent, 0.52, 'center', 1.8);
      } else {
        const reveal = hitIndex < 0 ? 0 : easeOutExpo(clamp(sinceHit / 0.18));
        const rotation = (hitIndex % 2 === 0 ? 1 : -1) * (0.022 + decay * 0.02);
        ctx.save();
        ctx.translate(w * 0.5, h * 0.5);
        ctx.rotate(rotation);
        this.drawBigWord('EXECUTION', 0, 0, w * 0.86, this.unit * 0.235, PAPER, accent, reveal, 0.2 + decay * 0.5, 'center', 0.96, false, -0.04);
        ctx.restore();
        this.mono('IMPACT / ' + String(Math.max(1, hitCount)).padStart(2, '0') + ' OF 12', w * 0.5, h * 0.73, 8 * this.ui, accent, 0.55, 'center', 1.6);
        this.hairline(w * 0.37, h * 0.75, w * 0.63, h * 0.75, accent, 0.3);
      }
      ctx.restore();

      // Side telemetry.
      this.mono('SEAL COMPLETE / ' + String(Math.round((hitCount / 12) * 100)).padStart(3, '0') + '%', w * 0.06, h * 0.79, 8 * this.ui, accent, 0.42, 'left', 1.1);
      this.mono('MERCY / 0.000000', w * 0.94, h * 0.79, 8 * this.ui, '#eee2d0', 0.3, 'right', 1);
      for (let i = 0; i < 12; i += 1) {
        const x = w * 0.065 + i * 12;
        this.hairline(x, h * 0.83, x, h * 0.83 - (i < hitCount ? 11 : 4), i < hitCount ? accent : '#eee2d0', i < hitCount ? 0.62 : 0.16, i === hitCount - 1 ? 2 : 1);
      }

      // Hit flash, deliberately contained to one per beat.
      if (decay > 0.02 && !frame.reduced) {
        ctx.fillStyle = `rgba(255,242,226,${decay * 0.2})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (isLastHit && hitCount === 12) {
        this.mono('ALL APPEALS DENIED', w * 0.5, h * 0.62, 8 * this.ui, accent, 0.3, 'center', 2);
      }
    } else {
      // After the sentence: ash, attempts at return, another trap.
      const after = local - 14.972;
      const converge =
        t >= 169.824 && t < 174.975
          ? smoothstep(invLerp(169.824, 171.868, t))
          : 0;
      const trapped = t >= 173.643;
      const squeeze = smoothstep(invLerp(173.643, 177.246, t));
      const warmth = smoothstep(invLerp(176.3, 177.246, t));

      if (warmth > 0) {
        this.glow(w * 0.5, h * 0.5, this.unit * 0.3 * warmth, '#ffd5c0', 0.14 * warmth);
      }

      // The seal stays open after the verdict.
      const sealRadius = this.unit * 0.245;
      ctx.save();
      ctx.translate(w * 0.5, h * 0.5);
      for (let i = 0; i < 12; i += 1) {
        const a0 = (i / 12) * TAU - Math.PI / 2;
        const a1 = ((i + 1) / 12) * TAU - Math.PI / 2;
        ctx.strokeStyle = hexToRgba(accent, 0.07 + (i % 3) * 0.02);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, sealRadius, a0 + 0.045, a1 - 0.045);
        ctx.stroke();
        const mark = polar(0, 0, sealRadius * 1.05, a0 + 0.07);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(mark.x - 1, mark.y - 1, 2, 2);
      }
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = PAPER;
      ctx.beginPath();
      ctx.moveTo(-sealRadius * 1.3, 0);
      ctx.lineTo(sealRadius * 1.3, 0);
      ctx.moveTo(0, -sealRadius * 1.16);
      ctx.lineTo(0, sealRadius * 1.16);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      this.hairline(w * 0.12, h * 0.5, w * 0.88, h * 0.5, accent, 0.11);
      this.mono('SEAL / 12 OF 12 — COMPLETE', w * 0.94, h * 0.77, 7.5 * this.ui, accent, 0.25, 'right', 1);

      // Ash keeps falling in the dark.
      for (let i = 0; i < 76; i += 1) {
        const seed = i * 7.17;
        const x = w * 0.14 + ((i * 53) % 100) * (w * 0.0072);
        const y = h * 0.18 + ((i * 37) % 100) * (h * 0.006) + Math.sin(t * 0.7 + seed) * 9;
        const size = 0.7 + (i % 4) * 0.55;
        ctx.fillStyle = i % 7 === 0 ? '#ff8b6f' : '#d5c5b2';
        ctx.globalAlpha = 0.08 + (i % 6) * 0.028;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;

      if (trapped) {
        const boxW = this.unit * 0.33 * (1 - squeeze * 0.58);
        const boxH = this.unit * 0.2 * (1 - squeeze * 0.42);
        ctx.save();
        ctx.strokeStyle = hexToRgba(accent, 0.48 + squeeze * 0.28);
        ctx.lineWidth = 1.4;
        ctx.strokeRect(w * 0.5 - boxW / 2, h * 0.5 - boxH / 2, boxW, boxH);
        for (let i = 1; i < 9; i += 1) {
          const y = h * 0.5 - boxH / 2 + (i / 9) * boxH;
          this.hairline(w * 0.5 - boxW / 2, y, w * 0.5 + boxW / 2, y, accent, 0.12);
        }
        for (let i = 1; i < 6; i += 1) {
          const x = w * 0.5 - boxW / 2 + (i / 6) * boxW;
          this.hairline(x, h * 0.5 - boxH / 2, x, h * 0.5 + boxH / 2, accent, 0.08);
        }
        for (let i = 0; i < 32; i += 1) {
          const a = i * 2.31 + t * 0.1;
          const x = w * 0.5 + Math.cos(a) * boxW * (0.12 + (i % 5) * 0.07);
          const y = h * 0.5 + Math.sin(a) * boxH * (0.12 + (i % 4) * 0.07);
          ctx.fillStyle = i % 4 === 0 ? accent : '#eee2d0';
          ctx.globalAlpha = 0.22 + (i % 6) * 0.06;
          ctx.fillRect(x, y, 1.4, 1.4);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        this.drawSerifWord('still here', w * 0.5, h * 0.34, w * 0.42, this.unit * 0.085, PAPER, 0.35 + squeeze * 0.2, 'center', true);
        this.mono('CONTAINMENT / ' + Math.round(56 + squeeze * 42) + '%', w * 0.5, h * 0.69, 8 * this.ui, accent, 0.5, 'center', 1.2);
      }

      // Reassembling particles for "If I can have you back".
      if (converge > 0 && !trapped) {
        for (let i = 0; i < 92; i += 1) {
          const angle = i * 2.399 + t * 0.12;
          const spread = this.unit * (0.3 + (i % 9) * 0.025) * (1 - converge * 0.92);
          const x = w * 0.5 + Math.cos(angle) * spread;
          const y = h * 0.52 + Math.sin(angle) * spread * 0.72;
          if (i % 5 === 0) {
            ctx.strokeStyle = hexToRgba(accent, (1 - converge) * 0.1);
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(w * 0.5, h * 0.52);
            ctx.stroke();
          }
          ctx.fillStyle = i % 6 === 0 ? accent : '#efe2d0';
          ctx.globalAlpha = 0.3 + (i % 5) * 0.11;
          ctx.fillRect(x, y, 1.8 + (i % 3), 1.8 + (i % 3));
        }
        ctx.globalAlpha = 1;
        this.glow(w * 0.5, h * 0.52, this.unit * (0.03 + converge * 0.12), accent, 0.28 * converge);
        ctx.strokeStyle = hexToRgba(accent, 0.22 * converge);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.52, this.unit * (0.035 + converge * 0.06), 0, TAU);
        ctx.stroke();
      } else if (!trapped) {
        for (let i = 0; i < 64; i += 1) {
          const x = w * (0.15 + Math.sin(i * 2.1 + after * 0.1) * 0.35);
          const y = h * (0.24 + ((i * 37) % 100) * 0.0046) + Math.sin(t + i) * 8;
          ctx.fillStyle = i % 7 === 0 ? '#ff9a7d' : '#d7c8b6';
          ctx.globalAlpha = 0.1 + (i % 5) * 0.04;
          ctx.fillRect(x, y, 1.5 + (i % 2), 1.5 + (i % 2));
        }
        ctx.globalAlpha = 1;
      }

      if (word === 'EXECUTION') {
        const localCue = cue ? t - cue.start : 0;
        const reveal = easeOutExpo(localCue / 0.3);
        this.drawBigWord(
          'EXECUTION',
          w * 0.5,
          h * 0.355,
          w * 0.78,
          this.unit * 0.16,
          PAPER,
          accent,
          reveal,
          0.24,
          'center',
          0.78,
          false,
          -0.03,
        );
        this.hairline(w * 0.5 - this.unit * 0.24, h * 0.385, w * 0.5 + this.unit * 0.24, h * 0.385, accent, 0.32);
      }

      // A low after-shock spectrum keeps the world physically present.
      const spectrumBase = h * 0.76;
      const spectrumWidth = w * 0.62;
      for (let i = 0; i < 64; i += 1) {
        const x = w * 0.5 - spectrumWidth / 2 + (i / 63) * spectrumWidth;
        const envelope = Math.sin((i / 63) * Math.PI);
        const value =
          0.03 +
          Math.abs(Math.sin(i * 0.61 + t * 1.1)) * 0.035 +
          levels.mid * envelope * 0.14 +
          levels.level * envelope * (i % 5 === 0 ? 0.12 : 0.04);
        this.hairline(x, spectrumBase, x, spectrumBase - value * this.unit, i % 8 === 0 ? accent : '#d8c9b5', 0.12 + (i % 5) * 0.035, 1);
      }
      this.mono('AFTERSHOCK / ' + (12 + Math.floor(levels.level * 8)).toFixed(0) + ' Hz', w * 0.5, h * 0.79, 7 * this.ui, '#efe2d0', 0.26, 'center', 1.3);

      if (after < 2) {
        this.mono('RESIDUE / AFTER THE VERDICT', w * 0.06, h * 0.77, 8 * this.ui, '#efe2d0', 0.32, 'left', 1);
      } else if (trapped) {
        this.mono('> still here', w * 0.06, h * 0.77, 8 * this.ui, accent, 0.34, 'left', 1);
      } else {
        this.mono('> if I can have you back', w * 0.06, h * 0.77, 8 * this.ui, '#efe2d0', 0.3, 'left', 0.7);
      }
      this.drawNoiseSlices(t, accent, 0.05, 7);
    }

    this.vignette('rgba(0,0,0,0.72)');
  }
  // ────────────────────────────────────────────────────────────────────────────
  // XII. LO-O-OVE
  // ────────────────────────────────────────────────────────────────────────────

  private drawLove(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const secondary = frame.act.secondary;
    const levels = frame.levels;
    const cue = frame.cue;
    const cueLocal = cue ? t - cue.start : 0;
    const activeLove = cue?.en.includes('LO-O-OVE') ?? false;
    const endFade = 1 - smoothstep(invLerp(17.45, 18.61, local));
    const cx = w * 0.5 + (this.smoothPointerX - 0.5) * 13;
    const cy = h * 0.5 + (this.smoothPointerY - 0.5) * 8;
    const heartScale = Math.min(this.unit * 0.24, w * 0.155);
    const heartProgress = easeOutCubic(invLerp(0.15, 6.7, local));
    const question = local > 3.611 && local < 7.294;
    const free = local > 11.237;
    const trapped = local > 12.5;
    const trapProgress = smoothstep(invLerp(12.5, 14.1, local));
    const fadeIn = smoothstep(invLerp(0, 0.7, local));

    this.fill('#080505');
    this.glow(cx, cy, this.unit * 0.58, '#ffb28e', (0.045 + levels.level * 0.05) * fadeIn * endFade);
    this.glow(cx, cy, this.unit * 0.24, secondary, (0.035 + levels.bass * 0.03) * endFade);
    drawGrid(ctx, w, h, 76, '#f1e4d4', 0.017, 0, t * 1.2);
    this.dustField(t, accent, 0.3 * endFade, 0.35);

    this.mono('XII / LO-O-OVE', w * 0.06, h * 0.22, 9 * this.ui, '#f1e5d6', 0.58, 'left', 2.1);
    this.mono('A CLOSED-FORM EXPRESSION', w * 0.94, h * 0.22, 8 * this.ui, accent, 0.38, 'right', 1.2);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, '#f1e5d6', 0.1);

    // Fine coordinate system.
    this.hairline(w * 0.05, cy, w * 0.38, cy, accent, 0.09);
    this.hairline(cx, h * 0.26, cx, h * 0.74, accent, 0.06);
    for (let i = 0; i < 10; i += 1) {
      const x = w * 0.06 + i * (w * 0.032);
      this.hairline(x, cy - 3, x, cy + 3, accent, 0.16);
    }
    this.mono('-1', w * 0.06, cy + 16 * this.ui, 7 * this.ui, '#ece1d2', 0.28, 'left');
    this.mono('0', cx, cy + 16 * this.ui, 7 * this.ui, '#ece1d2', 0.28, 'center');
    this.mono('+1', w * 0.38, cy + 16 * this.ui, 7 * this.ui, '#ece1d2', 0.28, 'right');

    // A ghost of the word, then the word itself inside the heart.
    const ghostAlpha = (0.045 + (activeLove ? 0.03 : 0)) * fadeIn * endFade;
    this.drawSerifWord('LO-O-OVE', cx, cy + this.unit * 0.015, w * 0.92, this.unit * 0.24, accent, ghostAlpha, 'center', true, -0.045);

    // Heart line, a slow construction.
    if (heartProgress > 0) {
      ctx.save();
      ctx.shadowColor = hexToRgba(secondary, 0.55);
      ctx.shadowBlur = this.unit * (0.022 + levels.bass * 0.014);
      drawHeartLine(ctx, cx, cy, heartScale, secondary, heartProgress, 0.28 * endFade, 5.5);
      ctx.shadowBlur = this.unit * 0.012;
      drawHeartLine(ctx, cx, cy, heartScale, accent, heartProgress, 0.9 * endFade, 1.7);
      ctx.shadowBlur = 0;
      drawHeartLine(ctx, cx, cy, heartScale, '#fff1e2', heartProgress, 0.75 * endFade, 0.7);
      ctx.restore();
    }

    // Parametric sample points along the line.
    if (heartProgress > 0.15) {
      const boundary = heartPoints(64);
      for (let i = 0; i < boundary.length; i += 1) {
        const p = boundary[i];
        const flicker = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.5);
        const alpha = (0.08 + flicker * 0.2) * endFade;
        const x = cx + p.x * heartScale * (1 + Math.sin(t * 0.8 + i) * 0.018);
        const y = cy + p.y * heartScale * (1 + Math.cos(t * 0.9 + i) * 0.018);
        ctx.fillStyle = i % 8 === 0 ? '#fff0df' : accent;
        ctx.globalAlpha = alpha;
        ctx.fillRect(x, y, i % 8 === 0 ? 1.8 : 1, i % 8 === 0 ? 1.8 : 1);
      }
      ctx.globalAlpha = 1;
    }

    // Escaping particles when you are free; later a trap around the heart.
    if (free) {
      const freeP = smoothstep(invLerp(11.237, 15.5, local));
      for (let i = 0; i < 34; i += 1) {
        const angle = i * 2.399;
        const p = heartPoint(angle);
        const distance = (freeP * (0.25 + (i % 9) * 0.055) + Math.sin(t * 0.6 + i) * 0.006) * this.unit;
        const x = cx + p.x * heartScale + Math.cos(angle) * distance;
        const y = cy + p.y * heartScale + Math.sin(angle) * distance - freeP * (10 + (i % 7) * 6);
        ctx.fillStyle = i % 5 === 0 ? '#fff1df' : i % 3 === 0 ? secondary : accent;
        ctx.globalAlpha = Math.max(0, 0.42 - freeP * 0.28) * endFade;
        ctx.fillRect(x, y, 1.4 + (i % 3), 1.4 + (i % 3));
      }
      ctx.globalAlpha = 1;
    }

    if (trapped) {
      const rings = 4;
      for (let i = 0; i < rings; i += 1) {
        const scale = heartScale * (1 + i * 0.035 + trapProgress * (0.08 + i * 0.02));
        drawHeartLine(
          ctx,
          cx,
          cy,
          scale,
          i % 2 === 0 ? secondary : accent,
          1,
          (0.17 - i * 0.03) * endFade,
          0.7,
          Math.sin(t * 0.22 + i) * 0.012,
        );
      }
      // A thread that orbits the heart and does not escape.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.1);
      ctx.strokeStyle = hexToRgba(secondary, 0.3 * endFade);
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      for (let i = 0; i <= 180; i += 1) {
        const p = i / 180;
        const a = p * TAU * 2.2;
        const r = heartScale * (0.34 + p * 0.58);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.82;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      this.mono('TRAPPED / ' + String(Math.round(trapProgress * 100)).padStart(3, '0') + '%', w * 0.94, h * 0.66, 7.5 * this.ui, secondary, 0.32 * endFade, 'right', 1);
    }

    // The word, nested in the geometry.
    const loveText = 'LO-O-OVE';
    const loveAlpha = (activeLove ? 0.94 : 0.32) * fadeIn * endFade;
    const activeReveal = activeLove ? easeOutExpo(cueLocal / 0.35) : 1;
    const loveSize = fitFontSize(ctx, loveText, 'serif', w * 0.47, this.unit * 0.125, 400, true, -0.03);
    setFont(ctx, loveSize * (activeLove ? 1 + levels.beat * 0.006 : 1), 'serif', 400, true);
    const loveWidth = measureTracked(ctx, loveText, loveSize * -0.03);
    const loveLeft = cx - loveWidth / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(loveLeft - this.unit * 0.03, cy - this.unit * 0.09, (loveWidth + this.unit * 0.06) * activeReveal, this.unit * 0.18);
    ctx.clip();
    if (activeLove) {
      ctx.globalAlpha = loveAlpha * 0.36;
      drawTracked(ctx, loveText, loveLeft + this.unit * 0.007, cy + this.unit * 0.007, { tracking: loveSize * -0.03, color: secondary, alpha: 0.75 });
      ctx.globalAlpha = 1;
    }
    drawTracked(ctx, loveText, loveLeft, cy + this.unit * 0.003, {
      tracking: loveSize * -0.03,
      color: '#f6eadc',
      alpha: loveAlpha,
    });
    ctx.restore();

    if (activeLove) {
      this.hairline(cx - loveWidth * 0.46, cy + this.unit * 0.038, cx + loveWidth * 0.46, cy + this.unit * 0.038, accent, 0.4);
    }

    // The algebraic annotation arrives with the lyric.
    if (local > 7.294) {
      const ap = smoothstep(invLerp(7.294, 8.2, local));
      const fx = w * 0.86;
      const fy = h * 0.35;
      this.mono('THE ALGEBRAIC EXPRESSION OF', fx, fy, 7.5 * this.ui, accent, 0.58 * ap, 'right', 1.2);
      this.mono('x = 16 sin³t', fx, fy + 19 * this.ui, 10 * this.ui, '#f2e7d8', 0.76 * ap, 'right', 0.6);
      this.mono('y = 13 cos t − 5 cos 2t', fx, fy + 36 * this.ui, 10 * this.ui, '#f2e7d8', 0.76 * ap, 'right', 0.6);
      this.mono('    − 2 cos 3t − cos 4t', fx, fy + 53 * this.ui, 10 * this.ui, '#f2e7d8', 0.76 * ap, 'right', 0.6);
      this.hairline(fx - w * 0.18, fy + 64 * this.ui, fx, fy + 64 * this.ui, accent, 0.32 * ap);
      this.mono('DOMAIN / EVERYWHERE', fx, fy + 78 * this.ui, 7 * this.ui, '#e8dccd', 0.42 * ap, 'right', 0.8);
      this.mono('SOLUTION / YOU', fx, fy + 93 * this.ui, 7 * this.ui, accent, 0.56 * ap, 'right', 0.8);
    }

    // Questions in orbit.
    if (question) {
      for (let i = 0; i < 8; i += 1) {
        const a = t * 0.3 + i * 1.8;
        const p = heartPoint(a);
        const x = cx + p.x * heartScale * 1.36;
        const y = cy + p.y * heartScale * 1.3;
        ctx.save();
        setFont(ctx, (10 + (i % 3) * 5) * this.ui, 'serif', 400, true);
        ctx.fillStyle = i % 2 === 0 ? accent : '#f2e7d8';
        ctx.globalAlpha = 0.26 + (i % 4) * 0.1;
        ctx.textAlign = 'center';
        ctx.fillText('?', x, y);
        ctx.restore();
      }
      this.mono('Q / CAN YOU ANSWER ALL?', w * 0.06, h * 0.77, 8 * this.ui, accent, 0.36, 'left', 1.1);
    }

    if (local > 8.4) {
      const age = local - 8.4;
      this.mono('SOLVED / ' + (12 + Math.min(5, Math.floor(age))) + ' ITERATIONS', w * 0.06, h * 0.77, 8 * this.ui, '#eee2d3', 0.3 * endFade, 'left', 1);
    }

    // A soft heartbeat halo at the very centre.
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.3);
    this.glow(cx, cy, this.unit * 0.08 * (0.7 + pulse * 0.3 + levels.bass * 0.4), secondary, 0.04 * endFade);
    ctx.fillStyle = '#fff4e6';
    ctx.globalAlpha = 0.55 * endFade;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (local > 16.9) {
      const fade = smoothstep(invLerp(16.9, 18.61, local));
      ctx.fillStyle = `rgba(0,0,0,${fade * 0.36})`;
      ctx.fillRect(0, 0, w, h);
    }

    this.mono('NO CHARACTERS / 1 SIMULATION / ∞', w * 0.94, h * 0.865, 7.5 * this.ui, '#e8ddcf', 0.25 * endFade, 'right', 1.1);
    this.vignette('rgba(0,0,0,0.72)');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // XIII. AFTERIMAGE
  // ────────────────────────────────────────────────────────────────────────────

  private drawAfterimage(frame: StageFrame): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const t = frame.time;
    const local = t - frame.act.start;
    const accent = frame.act.accent;
    const cue = frame.cue;
    const finalExec = displayWord(cue) === 'EXECUTION';
    const cueLocal = cue ? t - cue.start : 0;
    const post = clamp(local / (frame.act.end - frame.act.start));
    const fade = 1 - smoothstep(invLerp(0.1, 9.8, local)) * 0.75;

    this.fill('#040404');
    this.glow(w * 0.5, h * 0.46, this.unit * 0.34, '#ffc6a7', 0.025 * fade);
    this.dustField(t, accent, 0.16 * fade, 0.22);

    this.mono('XIII / AFTERIMAGE', w * 0.06, h * 0.22, 9 * this.ui, '#e9dfd0', 0.42, 'left', 2.1);
    this.mono('END OF SIMULATION', w * 0.94, h * 0.22, 8 * this.ui, '#e9dfd0', 0.24, 'right', 1.2);
    this.hairline(w * 0.06, h * 0.24, w * 0.94, h * 0.24, '#e9dfd0', 0.08);

    // The residue of the heart: points giving up their shape.
    const cx = w * 0.5;
    const cy = h * 0.49;
    const scale = Math.min(this.unit * 0.2, w * 0.13);
    const collapse = smoothstep(invLerp(0, 9.7, local));
    const lineProgress = clamp(1 - post * 1.2);
    if (lineProgress > 0) {
      const points = heartPoints(120);
      ctx.save();
      for (let i = 0; i < points.length; i += 1) {
        if (i / points.length > lineProgress) continue;
        const p = points[i];
        const drift = Math.sin(t * 0.4 + i) * 0.006 * collapse;
        const y = lerp(cy + p.y * scale, cy + h * 0.07, collapse * (0.4 + (i % 7) * 0.06));
        ctx.fillStyle = i % 9 === 0 ? '#fff0df' : accent;
        ctx.globalAlpha = 0.12 * fade;
        ctx.fillRect(cx + p.x * scale, y + drift * this.unit, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // A final horizontal carrier wave.
    const carrierAlpha = 0.08 * fade;
    this.hairline(w * 0.15, cy + h * 0.07, w * 0.85, cy + h * 0.07, '#e9dfd0', carrierAlpha);
    if (local < 5) {
      this.mono('return 0;', w * 0.5, h * 0.73, 8 * this.ui, '#e9dfd0', (1 - local / 5) * 0.3, 'center', 0.6);
    }

    if (finalExec) {
      const reveal = easeOutExpo(cueLocal / 0.5);
      const death = smoothstep(invLerp(4.0, 4.55, cueLocal));
      const finalAlpha = (1 - death) * 0.9;
      if (cueLocal < 4.6) {
        const lineW = this.unit * 0.24 * reveal;
        this.hairline(w * 0.5 - lineW, h * 0.42, w * 0.5 + lineW, h * 0.42, accent, 0.26 * (1 - death));
        this.drawBigWord('EXECUTION', w * 0.5, h * 0.5, w * 0.78, this.unit * 0.17, '#f2e5d5', accent, reveal, 0.18, 'center', finalAlpha, false, -0.04);
        this.hairline(w * 0.5 - lineW, h * 0.53, w * 0.5 + lineW, h * 0.53, accent, 0.2 * (1 - death));
      }
    }

    if (cueLocal > 4.65 || local > 14.5) {
      const tail = smoothstep(invLerp(14.5, 15.2, local));
      this.mono('world.execute(me);', w * 0.5, h * 0.53, 9 * this.ui, '#e9dfd0', 0.18 * tail, 'center', 0.7);
      const blink = Math.sin(t * 3.2) > 0 ? 0.25 : 0.06;
      ctx.fillStyle = accent;
      ctx.globalAlpha = blink * tail;
      ctx.fillRect(w * 0.5 + this.unit * 0.065, h * 0.505, 1.4, 10);
      ctx.globalAlpha = 1;
    }

    if (local > 10 && !finalExec) {
      const tail = smoothstep(invLerp(10, 12, local));
      this.mono('...', w * 0.5, h * 0.53, 12 * this.ui, accent, 0.3 * tail, 'center');
    }

    this.mono('MMD—02 / A CHARACTER-FREE 2D MOTION PICTURE', w * 0.5, h * 0.75, 7.5 * this.ui, '#e9dfd0', 0.16 * fade, 'center', 1.2);
    this.mono('lo-o-ove / 0x000000', w * 0.94, h * 0.865, 7 * this.ui, '#e9dfd0', 0.15 * fade, 'right', 0.9);
    this.vignette('rgba(0,0,0,0.82)');
  }
}
