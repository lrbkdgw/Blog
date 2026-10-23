/**
 * Echo Cave — Zero-Shift Hybrid DOM-Mask + GPU WebGL2 Vapor Disintegration Engine (v4)
 *
 * Combines three proven open-source disintegration techniques with zero Frame-0 shift:
 * 1. Live DOM Ragged FBM Alpha-Mask Pass 1:
 *    Keeps the real browser-rendered DOM `<div data-echo-sentence>` in its exact layout position
 *    (`0.000px` displacement across every font, CJK punctuation trim rule, scrollbar width, and
 *    HiDPI zoom level) while sweeping a pre-baked multi-octave `fbm2D` ragged alpha mask across
 *    `mask-position` on the GPU compositor with zero per-frame allocations and zero startup delay.
 * 2. `uvarov-frontend/vanilla-disintegrate` (MIT) + `Burn-My-Windows` (`snap.frag` math):
 *    WebGL2 `gl.POINTS` are used only as overlapping density samples, never as visible grains.
 *    A coherent FBM wind field, Gaussian kernels, DPR-normalized expansion and energy-conserving
 *    alpha merge the samples into soft, continuous vapor instead of a pixel-particle spray.
 * 3. Google Search 2019 "Thanos Snap" (`@wellwind/thanos-snap`, MIT):
 *    28-layer spatially coherent `ImageData` vapor fallback with progressive defocus when WebGL2
 *    is absent. Adjacent layers share edge pixels so the fallback has no random pixel confetti.
 */

export interface EchoAshController {
  /** Synchronously lock onto `element` with zero pixel shift, start erosion + ash burst, and return particle count. */
  disintegrateFromElement(element: HTMLElement): number;
  /** Accelerate active bursts & immediately clear live DOM masks on rapid multi-click. */
  accelerate(): void;
  /** Clear all active bursts and clean up any active DOM mask styles immediately. */
  clear(): void;
  /** Approximate number of active airborne ash grains currently alive. */
  readonly activeCount: number;
  /** Active rendering backend identifier (`'webgl2'` or `'canvas2d-layers'`). */
  readonly backend: 'webgl2' | 'canvas2d-layers';
  /** Release GPU resources, listeners, masks, and animation frames. */
  destroy(): void;
}

/**
 * Stage handoff duration (ms): at `960ms` (`progress ≈ 0.55` of `1750ms`), 100% of the live DOM
 * text has been cleanly eroded away (`MAX_THRESHOLD = 0.48` completes at `840ms`) and the center
 * baseline is open for the next sentence's character-by-character reveal while upper-air ash wisps
 * finish floating and dissolving across `960ms..1750ms`.
 */
export const ASH_EXIT_STAGE_MS = 960;

const TOTAL_BURST_MS = 1750;
const PARTICLE_BUDGET = 96_000;
const PARTICLES_PER_BUFFER = 32_768; // Avoids Safari Metal large gl.POINTS draw glitch
const PARTICLE_STRIDE = 9; // [srcX, srcY, threshold, velX, velY, diffX, diffY, swirl, phase]
const PARTICLE_LIFE = 0.52;
const MIN_THRESHOLD = 0.002;
const MAX_THRESHOLD = 1 - PARTICLE_LIFE; // 0.48
const TRANSITION_BAND = 0.028;
const CANVAS2D_LAYERS = 28;

// Algebraically coupled `mask-size: 300% 100%` sweep constants:
// For `mask-size: 300% 100%` and `mask-position: (p * 100)% 0%`, normalized element column `c ∈ [0,1]`
// samples mask UV `u(c, p) = (c + 2 * p) / 3`.
// - At `p = 1.0` (`t = 0ms`): `u ∈ [0.6667, 1.0]` -> strictly > `MASK_EDGE_CENTER + MASK_EDGE_AMP + MASK_SOFT` (`0.664`) -> 100% opaque!
// - At `p = MASK_P_END` (`0.27`): `u ∈ [0.18, 0.5133]` -> strictly < `MASK_EDGE_CENTER - MASK_EDGE_AMP - MASK_SOFT` (`0.572`) -> 0% opaque!
const MASK_P_END = 0.27;
const MASK_P_SPAN = 1 - MASK_P_END; // 0.73
const MASK_EDGE_CENTER = 0.618;
const MASK_EDGE_AMP = 0.024;
const MASK_SOFT = 0.022;
const MASK_TEX_W = 384;
const MASK_TEX_H = 96;

const OPENING_FULLWIDTH_PUNCT = /^[“‘《〈「『（【〔〖［｛]$/;
const MIDDLE_DOT_PUNCT = /^[·•]$/;

interface GlyphRun {
  char: string;
  left: number;
  top: number;
  width: number;
  height: number;
  font: string;
  fontSize: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
}

interface SnapshotCaptureResult {
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
  texW: number;
  texH: number;
  offsetX: number; // physical px relative to canvas top-left
  offsetY: number; // physical px relative to canvas top-left
  scaleX: number;
  scaleY: number;
  darkInk: boolean;
  ashColor: [number, number, number];
}

export interface AshParticleField {
  blockSize: number;
  thresholdWidth: number;
  thresholdHeight: number;
  thresholdMap: Uint8Array;
  chunks: Array<{ data: Float32Array; count: number }>;
  particleCount: number;
}

const maskUrlCache = new WeakMap<Document, string>();

// ============================================================================
// Deterministic Fast 2D Value Noise + Multi-Octave FBM
// ============================================================================

function hash2DInt(ix: number, iy: number, seed: number): number {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2DInt(ix, iy, seed);
  const b = hash2DInt(ix + 1, iy, seed);
  const c = hash2DInt(ix, iy + 1, seed);
  const d = hash2DInt(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Smooth 2D Fractal Brownian Motion returning values in `[0, 1]`. */
export function fbm2D(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 977);
    norm += amp;
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum / norm;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstepJS(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-5), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Compute ragged fractal mask edge `u_edge(v) ∈ [0.594, 0.642]` shared by DOM mask & GPU vapor. */
function maskEdgeAtRow(vNorm: number): number {
  const n = fbm2D(3.7, vNorm * 5.2, 2067, 3);
  return MASK_EDGE_CENTER - MASK_EDGE_AMP * clamp((n - 0.5) * 2.2, -1, 1);
}

/** Broad, continuous edge undulation; deliberately no per-pixel hash/grain. */
function maskGrainAt(uNorm: number, vNorm: number): number {
  return (fbm2D(uNorm * 28, vNorm * 9, 913, 2) - 0.5) * 0.008;
}

function getFractalWipeMaskUrl(doc: Document): string {
  const cached = maskUrlCache.get(doc);
  if (cached !== undefined) return cached;

  const c = doc.createElement('canvas');
  c.width = MASK_TEX_W;
  c.height = MASK_TEX_H;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  let url = '';
  try {
    const img = ctx.createImageData(MASK_TEX_W, MASK_TEX_H);
    const data = img.data;
    for (let y = 0; y < MASK_TEX_H; y += 1) {
      const v = (y + 0.5) / MASK_TEX_H;
      const edgeBase = maskEdgeAtRow(v);
      for (let x = 0; x < MASK_TEX_W; x += 1) {
        const u = (x + 0.5) / MASK_TEX_W;
        // Low-frequency edge variation dissolves as a continuous surface, not a ragged pixel edge.
        const grain = maskGrainAt(u, v);
        const alpha = smoothstepJS(-MASK_SOFT, MASK_SOFT, u - (edgeBase + grain));
        const idx = (y * MASK_TEX_W + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    url = c.toDataURL('image/png');
  } catch {
    url = '';
  }
  c.width = 0;
  c.height = 0;
  maskUrlCache.set(doc, url);
  return url;
}

function applyDomErosionMask(el: HTMLElement, maskUrl: string, progress: number) {
  const sweepT = clamp(progress / MAX_THRESHOLD, 0, 1);
  const p = 1 - sweepT * MASK_P_SPAN;
  const pos = `${(p * 100).toFixed(3)}% 0%`;
  const st = el.style as CSSStyleDeclaration & {
    webkitMaskImage?: string;
    webkitMaskSize?: string;
    webkitMaskRepeat?: string;
    webkitMaskPosition?: string;
  };
  if (maskUrl && maskUrl.startsWith('data:image/')) {
    const imgVal = `url("${maskUrl}")`;
    if (st.maskImage !== imgVal) {
      st.webkitMaskImage = imgVal;
      st.maskImage = imgVal;
      st.webkitMaskSize = '300% 100%';
      st.maskSize = '300% 100%';
      st.webkitMaskRepeat = 'no-repeat';
      st.maskRepeat = 'no-repeat';
    }
  } else {
    // Fallback pure-CSS compositor linear-gradient mask (e.g. JSDOM without PNG encoder)
    const grad = 'linear-gradient(100deg, transparent 36%, rgba(0,0,0,0.45) 40%, #000 44%)';
    if (st.maskImage !== grad) {
      st.webkitMaskImage = grad;
      st.maskImage = grad;
      st.webkitMaskSize = '300% 100%';
      st.maskSize = '300% 100%';
      st.webkitMaskRepeat = 'no-repeat';
      st.maskRepeat = 'no-repeat';
    }
  }
  st.webkitMaskPosition = pos;
  st.maskPosition = pos;
}

function clearDomErosionMask(el: HTMLElement | null) {
  if (!el) return;
  const st = el.style as CSSStyleDeclaration & {
    webkitMaskImage?: string;
    webkitMaskSize?: string;
    webkitMaskRepeat?: string;
    webkitMaskPosition?: string;
  };
  st.webkitMaskImage = '';
  st.maskImage = '';
  st.webkitMaskSize = '';
  st.maskSize = '';
  st.webkitMaskRepeat = '';
  st.maskRepeat = '';
  st.webkitMaskPosition = '';
  st.maskPosition = '';
}

// ============================================================================
// DOM Computed Style & Exact Sub-Pixel Stroke Sampler
// ============================================================================

function readComputedStyle(el: Element): CSSStyleDeclaration | null {
  const view = el.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  return view ? view.getComputedStyle(el) : null;
}

function parseCssColor(cssColor: string): { r: number; g: number; b: number; a: number } {
  const m = cssColor.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  if (!m) return { r: 24, g: 24, b: 27, a: 1 };
  return {
    r: Math.max(0, Math.min(255, Math.round(Number(m[1])))),
    g: Math.max(0, Math.min(255, Math.round(Number(m[2])))),
    b: Math.max(0, Math.min(255, Math.round(Number(m[3])))),
    a: m[4] !== undefined ? Math.max(0, Math.min(1, Number(m[4]))) : 1,
  };
}

function collectVisibleGlyphs(root: HTMLElement): { runs: GlyphRun[]; rootRect: DOMRect } | null {
  const rawRect = root.getBoundingClientRect();
  const rootStyle = readComputedStyle(root);
  if (!rootStyle) return null;

  const fallbackWidth = rawRect.width > 0 ? rawRect.width : 360;
  const fallbackHeight = rawRect.height > 0 ? rawRect.height : 56;
  const baseBounds =
    rawRect.width > 0 && rawRect.height > 0
      ? rawRect
      : ({
          left: 200,
          top: 260,
          right: 200 + fallbackWidth,
          bottom: 260 + fallbackHeight,
          width: fallbackWidth,
          height: fallbackHeight,
          x: 200,
          y: 260,
          toJSON: () => ({}),
        } as DOMRect);

  const runs: GlyphRun[] = [];
  const rootOpacity = Number.parseFloat(rootStyle.opacity || '1');
  const effectiveRootAlpha = Number.isFinite(rootOpacity) ? rootOpacity : 1;
  const defaultSize = Number.parseFloat(rootStyle.fontSize) || 24;
  let cursorX = baseBounds.left;

  const charSpans = root.querySelectorAll<HTMLElement>('[data-char-shown]');
  charSpans.forEach((span) => {
    const ch = span.textContent ?? '';
    if (!ch || /^\s+$/.test(ch)) {
      cursorX += defaultSize * 0.45;
      return;
    }
    const st = readComputedStyle(span) ?? rootStyle;
    const computedOpacity = Number.parseFloat(st.opacity || '1');
    let spanAlpha = Number.isFinite(computedOpacity) ? computedOpacity : 1;
    if (spanAlpha <= 0 && span.dataset.charShown === 'true') {
      spanAlpha = 1;
    }
    const totalAlpha = spanAlpha * effectiveRootAlpha;
    if (totalAlpha <= 0.02) return;

    const fontSize = Number.parseFloat(st.fontSize) || defaultSize;
    const font = `${st.fontStyle || 'normal'} ${st.fontWeight || '400'} ${fontSize}px ${st.fontFamily || 'serif'}`;
    const col = parseCssColor(st.color);
    const r = span.getBoundingClientRect();
    const hasLayout = r.width > 0 && r.height > 0;
    const width = hasLayout ? r.width : fontSize;
    const height = hasLayout ? r.height : fontSize * 1.25;
    const left = hasLayout ? r.left : cursorX;
    const top = hasLayout ? r.top : baseBounds.top;
    cursorX = left + width;

    runs.push({
      char: ch,
      left,
      top,
      width,
      height,
      font,
      fontSize,
      r: col.r,
      g: col.g,
      b: col.b,
      alpha: Math.min(1, totalAlpha * col.a),
    });
  });

  // Collect exact per-character spans from `.echo-from` attribution line
  const fromEl = root.querySelector<HTMLElement>('.echo-from');
  if (fromEl) {
    const fst = readComputedStyle(fromEl) ?? rootStyle;
    let fAlpha = Number.parseFloat(fst.opacity || '1');
    if ((!Number.isFinite(fAlpha) || fAlpha <= 0) && fromEl.dataset.fromShown === 'true') {
      fAlpha = 0.85;
    }
    if (Number.isFinite(fAlpha) && fAlpha * effectiveRootAlpha > 0.02) {
      const fSize = Number.parseFloat(fst.fontSize) || 12;
      const fFont = `${fst.fontStyle || 'normal'} ${fst.fontWeight || '400'} ${fSize}px ${fst.fontFamily || 'sans-serif'}`;
      const fCol = parseCssColor(fst.color);
      const fromSpans = fromEl.querySelectorAll<HTMLElement>('[data-from-char]');
      let fCursorX = baseBounds.left + baseBounds.width * 0.35;
      const fr = fromEl.getBoundingClientRect();
      const fallbackTop = fr.height > 0 ? fr.top : baseBounds.bottom - fSize * 1.3;

      fromSpans.forEach((fSpan) => {
        const ch = fSpan.textContent ?? '';
        const sr = fSpan.getBoundingClientRect();
        const hasLayout = sr.width > 0 && sr.height > 0;
        const w = hasLayout ? sr.width : fSize * 0.8;
        const h = hasLayout ? sr.height : fSize * 1.2;
        const l = hasLayout ? sr.left : fCursorX;
        const t = hasLayout ? sr.top : fallbackTop;
        fCursorX = l + w;
        if (!ch || /^\s+$/.test(ch)) return;
        runs.push({
          char: ch,
          left: l,
          top: t,
          width: w,
          height: h,
          font: fFont,
          fontSize: fSize,
          r: fCol.r,
          g: fCol.g,
          b: fCol.b,
          alpha: Math.min(1, fAlpha * effectiveRootAlpha * fCol.a),
        });
      });
    }
  }

  return runs.length > 0 ? { runs, rootRect: baseBounds } : null;
}

function captureSnapshot(
  doc: Document,
  root: HTMLElement,
  canvasLeftCss: number,
  canvasTopCss: number,
  scaleX: number,
  scaleY: number,
): SnapshotCaptureResult | null {
  const collected = collectVisibleGlyphs(root);
  if (!collected) return null;
  const { runs, rootRect } = collected;

  let minX = rootRect.width > 0 ? rootRect.left : Infinity;
  let minY = rootRect.height > 0 ? rootRect.top : Infinity;
  let maxX = rootRect.width > 0 ? rootRect.right : -Infinity;
  let maxY = rootRect.height > 0 ? rootRect.bottom : -Infinity;
  let lumAcc = 0;

  for (const g of runs) {
    if (g.left < minX) minX = g.left;
    if (g.top < minY) minY = g.top;
    if (g.left + g.width > maxX) maxX = g.left + g.width;
    if (g.top + g.height > maxY) maxY = g.top + g.height;
    lumAcc += (0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b) / 255;
  }

  const darkInk = lumAcc / runs.length < 0.5;
  const ashColor: [number, number, number] = darkInk
    ? [86 / 255, 82 / 255, 76 / 255]
    : [224 / 255, 220 / 255, 212 / 255];

  const pixelLeft = Math.floor((minX - canvasLeftCss) * scaleX);
  const pixelTop = Math.floor((minY - canvasTopCss) * scaleY);
  const pixelRight = Math.ceil((maxX - canvasLeftCss) * scaleX);
  const pixelBottom = Math.ceil((maxY - canvasTopCss) * scaleY);

  const texW = Math.max(2, Math.min(4096, pixelRight - pixelLeft));
  const texH = Math.max(2, Math.min(2048, pixelBottom - pixelTop));

  const offscreen = doc.createElement('canvas');
  offscreen.width = texW;
  offscreen.height = texH;
  const octx = offscreen.getContext('2d', { willReadFrequently: true });
  if (!octx) return null;

  octx.clearRect(0, 0, texW, texH);
  octx.save();
  octx.scale(scaleX, scaleY);
  octx.textBaseline = 'alphabetic';

  const originCssX = pixelLeft / scaleX + canvasLeftCss;
  const originCssY = pixelTop / scaleY + canvasTopCss;

  for (const g of runs) {
    octx.font = g.font;
    octx.fillStyle = `rgba(${g.r}, ${g.g}, ${g.b}, ${g.alpha})`;
    const metrics = octx.measureText(g.char);
    // Compensate Blink/WebKit CJK fullwidth opening punctuation trimming (`text-spacing-trim`)
    let drawX = g.left - originCssX;
    if (metrics.width > g.width + 1.5) {
      if (OPENING_FULLWIDTH_PUNCT.test(g.char)) {
        drawX -= metrics.width - g.width;
      } else if (MIDDLE_DOT_PUNCT.test(g.char)) {
        drawX -= (metrics.width - g.width) * 0.5;
      }
    }
    const ascent =
      typeof metrics.fontBoundingBoxAscent === 'number' && metrics.fontBoundingBoxAscent > 0
        ? metrics.fontBoundingBoxAscent
        : g.height * 0.8 + (g.height - g.fontSize) * 0.12;
    octx.fillText(g.char, drawX, g.top - originCssY + ascent);
  }
  octx.restore();

  let pixels: Uint8ClampedArray | null = null;
  try {
    const img = octx.getImageData(0, 0, texW, texH);
    if (img && img.data && img.data.length === texW * texH * 4) {
      let hasInk = false;
      for (let i = 3; i < img.data.length; i += 16) {
        if (img.data[i] > 6) {
          hasInk = true;
          break;
        }
      }
      if (hasInk) {
        pixels = img.data;
      }
    }
  } catch {
    pixels = null;
  }

  if (!pixels) {
    pixels = new Uint8ClampedArray(texW * texH * 4);
    for (const g of runs) {
      const gx0 = clamp(Math.round((g.left - originCssX) * scaleX), 0, texW - 1);
      const gy0 = clamp(Math.round((g.top - originCssY) * scaleY), 0, texH - 1);
      const gw = Math.max(2, Math.round(g.width * scaleX * 0.75));
      const gh = Math.max(2, Math.round(g.height * scaleY * 0.75));
      const aByte = Math.round(g.alpha * 255);
      for (let s = 0; s < 28; s += 1) {
        const px = clamp(gx0 + Math.floor(hash2DInt(s, gx0, 17) * gw), 0, texW - 1);
        const py = clamp(gy0 + Math.floor(hash2DInt(s, gy0, 53) * gh), 0, texH - 1);
        const idx = (py * texW + px) * 4;
        pixels[idx] = g.r;
        pixels[idx + 1] = g.g;
        pixels[idx + 2] = g.b;
        pixels[idx + 3] = aByte;
      }
    }
    try {
      const synth = new ImageData(new Uint8ClampedArray(pixels), texW, texH);
      octx.putImageData(synth, 0, 0);
    } catch {
      // Headless environment without ImageData constructor
    }
  }

  return {
    canvas: offscreen,
    pixels,
    texW,
    texH,
    offsetX: pixelLeft,
    offsetY: pixelTop,
    scaleX,
    scaleY,
    darkInk,
    ashColor,
  };
}

// ============================================================================
// Shared Particle Field Builder (Algebraically Locked to Live DOM Mask Contour)
// ============================================================================

export function buildAshParticleField(
  pixels: Uint8ClampedArray,
  texW: number,
  texH: number,
  dpr: number,
  seed = 2026,
): AshParticleField {
  let inkPixels = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 4) inkPixels += 1;
  }

  const blockSize = inkPixels <= PARTICLE_BUDGET ? 1 : Math.max(1, Math.ceil(Math.sqrt(inkPixels / PARTICLE_BUDGET)));
  const thresholdWidth = Math.ceil(texW / blockSize);
  const thresholdHeight = Math.ceil(texH / blockSize);
  const blockCount = thresholdWidth * thresholdHeight;
  const visibleBlocks = new Uint8Array(blockCount);
  const thresholdMap = new Uint8Array(blockCount);

  let particleCount = 0;
  for (let by = 0; by < thresholdHeight; by += 1) {
    const y0 = by * blockSize;
    const bh = Math.min(blockSize, texH - y0);
    for (let bx = 0; bx < thresholdWidth; bx += 1) {
      const x0 = bx * blockSize;
      const bw = Math.min(blockSize, texW - x0);
      let vis = false;
      for (let ly = 0; ly < bh && !vis; ly += 1) {
        const rowBase = ((y0 + ly) * texW + x0) * 4 + 3;
        for (let lx = 0; lx < bw; lx += 1) {
          if (pixels[rowBase + lx * 4] > 4) {
            vis = true;
            break;
          }
        }
      }
      if (vis) {
        visibleBlocks[by * thresholdWidth + bx] = 1;
        particleCount += 1;
      }
    }
  }

  const chunkTotal = Math.max(1, Math.ceil(Math.max(1, particleCount) / PARTICLES_PER_BUFFER));
  const chunks: Array<{ data: Float32Array; count: number }> = [];
  let remaining = particleCount;
  for (let c = 0; c < chunkTotal; c += 1) {
    const count = Math.min(PARTICLES_PER_BUFFER, remaining);
    chunks.push({ data: new Float32Array(count * PARTICLE_STRIDE), count });
    remaining -= count;
  }

  let globalIdx = particleCount - 1;

  for (let by = 0; by < thresholdHeight; by += 1) {
    const y = by * blockSize;
    const row = (y + blockSize * 0.5) / texH;
    const uEdgeRow = maskEdgeAtRow(row);

    for (let bx = 0; bx < thresholdWidth; bx += 1) {
      const x = bx * blockSize;
      const col = (x + blockSize * 0.5) / texW;

      // Algebraic solution matching `applyDomErosionMask`: `(col + 2 * p) / 3 === uEdgeRow`.
      // The same continuous edge function is used on both paths; independent per-texel detachment
      // noise was removed because it made otherwise smooth text look like scattered sand.
      const microGrain = maskGrainAt(uEdgeRow, row);
      const pDetach = clamp((3 * (uEdgeRow + microGrain) - col) * 0.5, MASK_P_END, 1);
      const sweepNorm = clamp((1 - pDetach) / MASK_P_SPAN, 0, 1);
      const threshold = MIN_THRESHOLD + sweepNorm * (MAX_THRESHOLD - MIN_THRESHOLD);

      const bIdx = by * thresholdWidth + bx;
      thresholdMap[bIdx] = Math.round(threshold * 255);
      if (visibleBlocks[bIdx] === 0) continue;

      // Neighboring samples must inherit neighboring motion. These three broad FBM fields form a
      // slow, coherent wind; there are no random per-particle impulses or randomly faster motes.
      const sA = fbm2D(x * 0.011 + 11.3, y * 0.011 + 4.7, seed + 101, 3);
      const sB = fbm2D(x * 0.017 + 31.7, y * 0.017 + 9.2, seed + 211, 3);
      const sC = fbm2D(x * 0.006 + 7.1, y * 0.006 + 19.4, seed + 307, 2);
      const gust = 0.88 + sC * 0.26;
      const velX = (42 + sA * 72) * dpr * gust;
      const velY = (-16 - sB * 46) * dpr * gust;

      // Small, spatially correlated diffusion loosens the vapor without separating visible dots.
      const diffX = (sA - 0.5) * 36 * dpr;
      const diffY = (sB - 0.5) * 28 * dpr;
      const swirl = (6 + sB * 16) * dpr;
      const phase = (sA * 1.7 + sB * 0.9 + sC * 0.6) * Math.PI;

      const chunkIdx = Math.floor(globalIdx / PARTICLES_PER_BUFFER);
      const slotOffset = (globalIdx % PARTICLES_PER_BUFFER) * PARTICLE_STRIDE;
      const out = chunks[chunkIdx].data;
      out[slotOffset] = x;
      out[slotOffset + 1] = y;
      out[slotOffset + 2] = threshold;
      out[slotOffset + 3] = velX;
      out[slotOffset + 4] = velY;
      out[slotOffset + 5] = diffX;
      out[slotOffset + 6] = diffY;
      out[slotOffset + 7] = swirl;
      out[slotOffset + 8] = phase;
      globalIdx -= 1;
    }
  }

  return {
    blockSize,
    thresholdWidth,
    thresholdHeight,
    thresholdMap,
    chunks,
    particleCount,
  };
}

// ============================================================================
// WebGL2 Sub-Pixel Airborne Particle Pass
// ============================================================================

const PARTICLE_VERTEX_GLSL = `#version 300 es
layout(location = 0) in vec2 a_origin;
layout(location = 1) in float a_threshold;
layout(location = 2) in vec2 a_velocity;
layout(location = 3) in vec2 a_diffusion;
layout(location = 4) in float a_swirl;
layout(location = 5) in float a_phase;

uniform vec2 u_canvas_size;
uniform vec2 u_source_offset;
uniform vec2 u_source_size;
uniform float u_block_size;
uniform float u_dpr;
uniform float u_progress;
uniform float u_transition;
uniform float u_life;

out vec2 v_uv_origin;
out vec2 v_uv_size;
out float v_alpha;
out float v_local;
out float v_softness;

void main() {
  float activation = smoothstep(a_threshold - u_transition, a_threshold + u_transition, u_progress);
  float raw_local = (u_progress - a_threshold) / u_life;
  if (activation <= 0.002 || raw_local >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    v_alpha = 0.0;
    v_local = 1.0;
    v_softness = 1.0;
    v_uv_origin = vec2(0.0);
    v_uv_size = vec2(0.0);
    return;
  }

  float local = clamp(raw_local, 0.0, 1.0);
  float travel_t = mix(smoothstep(0.0, 1.0, local), 1.0 - pow(1.0 - local, 1.45), 0.68);
  float spread_t = local * local;
  float env = sin(local * 3.141593) * 0.72;
  float w1 = sin(local * 4.8 + a_phase);
  float w2 = cos(local * 8.4 + a_phase * 1.31);

  vec2 perp = vec2(-a_velocity.y, a_velocity.x) / max(length(a_velocity), 0.001);
  vec2 drift = a_velocity * travel_t
             + perp * (w1 * a_swirl + w2 * a_swirl * 0.18) * env
             + a_diffusion * spread_t
             + vec2(0.0, -16.0 * u_dpr * local * local);

  // Each sample expands into its neighbors. Normalizing alpha by kernel area and DPR conserves
  // density, so this reads as a thinning volume of vapor rather than brighter/larger particles.
  float softness = smoothstep(0.0, 0.75, local);
  float point_scale = mix(2.2, 18.0, softness);
  vec2 center = u_source_offset + a_origin + vec2(u_block_size * 0.5) + drift;
  vec2 clip = center / u_canvas_size * 2.0 - 1.0;

  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = max(1.0, max(u_block_size, u_dpr) * point_scale);

  v_uv_origin = a_origin / u_source_size;
  v_uv_size = vec2(u_block_size) / u_source_size;
  float fade = 1.0 - smoothstep(0.10, 1.0, local);
  float energy_norm = 3.2 / (point_scale * point_scale * u_dpr * u_dpr);
  float ribbon_wave = 0.5 + 0.5 * sin(a_phase * 2.2 + local * 2.6);
  float ribbon = mix(1.0, smoothstep(0.18, 0.82, ribbon_wave), smoothstep(0.22, 0.85, local));
  v_alpha = activation * fade * energy_norm * ribbon;
  v_local = local;
  v_softness = softness;
}
`;

const PARTICLE_FRAGMENT_GLSL = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec3 u_ash_color;

in vec2 v_uv_origin;
in vec2 v_uv_size;
in float v_alpha;
in float v_local;
in float v_softness;
out vec4 out_color;

void main() {
  if (v_alpha <= 0.002) {
    out_color = vec4(0.0);
    return;
  }
  vec2 centered = gl_PointCoord - vec2(0.5);
  float dist = length(centered);
  // A Gaussian at every age (including detachment) avoids the hard square/point sprites that made
  // the old pass feel granular. The soft cutoff only prevents a visible circular sprite boundary.
  float falloff = mix(18.0, 10.0, v_softness);
  float radial = exp(-dot(centered, centered) * falloff);
  float mask = radial * (1.0 - smoothstep(0.34, 0.5, dist));
  if (mask <= 0.002) {
    out_color = vec4(0.0);
    return;
  }

  vec2 uv = clamp(v_uv_origin + gl_PointCoord * v_uv_size, v_uv_origin, v_uv_origin + v_uv_size * 0.999);
  vec4 tex = texture(u_source, uv);
  if (tex.a <= 0.002) {
    out_color = vec4(0.0);
    return;
  }

  vec3 straight_rgb = tex.rgb / max(tex.a, 0.0001);
  float ash_mix = mix(0.12, 0.78, smoothstep(0.0, 0.72, v_local));
  vec3 tinted = mix(straight_rgb, u_ash_color, ash_mix);
  float final_a = v_alpha * mask;
  out_color = vec4(tinted * tex.a, tex.a) * final_a;
}
`;

interface WebGLBurst {
  sourceTex: WebGLTexture;
  vaos: WebGLVertexArrayObject[];
  buffers: WebGLBuffer[];
  counts: number[];
  totalParticles: number;
  texW: number;
  texH: number;
  offsetX: number;
  offsetY: number;
  blockSize: number;
  dpr: number;
  ashColor: [number, number, number];
  domElement: HTMLElement | null;
  elapsedMs: number;
  speedScale: number;
}

function compileGLProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// ============================================================================
// Secondary Fallback Renderer: Spatially Coherent 28-Layer Canvas2D Vapor
// ============================================================================

interface Canvas2DLayerBurst {
  layers: Array<{
    canvas: HTMLCanvasElement;
    delayNorm: number;
    dx: number;
    dy: number;
    rot: number;
  }>;
  offsetX: number;
  offsetY: number;
  texW: number;
  texH: number;
  dpr: number;
  particleCount: number;
  domElement: HTMLElement | null;
  elapsedMs: number;
  speedScale: number;
}

function createCanvas2DLayerBurst(
  doc: Document,
  snap: SnapshotCaptureResult,
  domElement: HTMLElement,
  seed: number,
): Canvas2DLayerBurst {
  const { pixels, texW, texH, offsetX, offsetY, scaleX, ashColor } = snap;
  const layerArrays = Array.from({ length: CANVAS2D_LAYERS }, () => new Uint8ClampedArray(texW * texH * 4));

  let particleCount = 0;
  for (let y = 0; y < texH; y += 1) {
    const rowOffset = y * texW;
    for (let x = 0; x < texW; x += 1) {
      const pIdx = (rowOffset + x) * 4;
      const a = pixels[pIdx + 3];
      if (a <= 4) continue;
      particleCount += 1;

      const col = x / texW;
      const organic = fbm2D(x * 0.012, y * 0.016, seed + 37, 3);
      const weighted = clamp((2 * col + organic * 0.9) / 2.9, 0, 0.9999);
      const layerPos = weighted * (CANVAS2D_LAYERS - 1);
      const lower = Math.floor(layerPos);
      const upper = Math.min(CANVAS2D_LAYERS - 1, lower + 1);
      const upperWeight = layerPos - lower;

      // Split only across adjacent time layers. Broad FBM regions remain intact and the shared
      // edge pixels prevent the random salt-and-pepper holes produced by the old two-bucket hash.
      for (const [bucket, weight] of [
        [lower, 1 - upperWeight],
        [upper, upperWeight],
      ] as const) {
        if (weight <= 0) continue;
        const dst = layerArrays[bucket];
        dst[pIdx] = Math.round(pixels[pIdx] * 0.68 + ashColor[0] * 255 * 0.32);
        dst[pIdx + 1] = Math.round(pixels[pIdx + 1] * 0.68 + ashColor[1] * 255 * 0.32);
        dst[pIdx + 2] = Math.round(pixels[pIdx + 2] * 0.68 + ashColor[2] * 255 * 0.32);
        dst[pIdx + 3] = Math.round(a * weight * 0.68);
      }
    }
  }

  const layers = layerArrays.map((arr, i) => {
    const c = doc.createElement('canvas');
    c.width = texW;
    c.height = texH;
    const lctx = c.getContext('2d');
    if (lctx) {
      try {
        const img = lctx.createImageData(texW, texH);
        img.data.set(arr);
        lctx.putImageData(img, 0, 0);
      } catch {
        // Ignore mock contexts without createImageData
      }
    }
    const rA = hash2DInt(i, 11, seed + 71);
    const rB = hash2DInt(i, 29, seed + 193);
    const layerT = i / (CANVAS2D_LAYERS - 1);
    const angle = -0.62 + (rA - 0.5) * 0.16;
    const dist = (48 + layerT * 48 + rB * 22) * scaleX;
    return {
      canvas: c,
      delayNorm: layerT * MAX_THRESHOLD,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 12 * scaleX,
      rot: ((rA - 0.5) * 2.4 * Math.PI) / 180,
    };
  });

  return {
    layers,
    offsetX,
    offsetY,
    texW,
    texH,
    dpr: scaleX,
    particleCount,
    domElement,
    elapsedMs: 0,
    speedScale: 1,
  };
}

// ============================================================================
// Public Attachment Entry Point
// ============================================================================

export function attachEchoAshCanvas(canvas: HTMLCanvasElement): EchoAshController {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView ?? window;
  const fractalMaskUrl = getFractalWipeMaskUrl(doc);

  let destroyed = false;
  let rafId: number | null = null;
  let lastFrameMs = 0;
  let seedCounter = 2026;
  let canvasLeftCss = 0;
  let canvasTopCss = 0;
  let scaleX = 1;
  let scaleY = 1;
  let physW = 1;
  let physH = 1;

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
  } catch {
    gl = null;
  }

  let partProg: WebGLProgram | null = null;
  if (gl) {
    partProg = compileGLProgram(gl, PARTICLE_VERTEX_GLSL, PARTICLE_FRAGMENT_GLSL);
    if (!partProg) {
      gl = null;
    } else {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  const ctx2d = gl ? null : canvas.getContext('2d');
  const backendName: 'webgl2' | 'canvas2d-layers' = gl ? 'webgl2' : 'canvas2d-layers';
  canvas.dataset.ashBackend = backendName;

  const glBursts: WebGLBurst[] = [];
  const c2dBursts: Canvas2DLayerBurst[] = [];

  const syncSize = () => {
    const rawDpr = Math.min(2, Math.max(1, win.devicePixelRatio || 1));
    const cRect = canvas.getBoundingClientRect();
    canvasLeftCss = cRect.width > 0 ? cRect.left : 0;
    canvasTopCss = cRect.height > 0 ? cRect.top : 0;
    const cssW = Math.max(1, cRect.width > 0 ? cRect.width : win.innerWidth || 1024);
    const cssH = Math.max(1, cRect.height > 0 ? cRect.height : win.innerHeight || 768);
    const nextW = Math.max(1, Math.round(cssW * rawDpr));
    const nextH = Math.max(1, Math.round(cssH * rawDpr));
    if (physW !== nextW || physH !== nextH || canvas.width !== nextW || canvas.height !== nextH) {
      physW = nextW;
      physH = nextH;
      canvas.width = physW;
      canvas.height = physH;
    }
    scaleX = physW / cssW;
    scaleY = physH / cssH;
  };

  syncSize();
  win.addEventListener('resize', syncSize, { passive: true });

  const disposeGLBurst = (b: WebGLBurst) => {
    clearDomErosionMask(b.domElement);
    b.domElement = null;
    if (!gl) return;
    gl.deleteTexture(b.sourceTex);
    for (const v of b.vaos) gl.deleteVertexArray(v);
    for (const buf of b.buffers) gl.deleteBuffer(buf);
  };

  const countActiveParticles = (): number => {
    let total = 0;
    for (const b of glBursts) {
      const rem = clamp(1 - b.elapsedMs / TOTAL_BURST_MS, 0, 1);
      total += Math.max(1, Math.round(b.totalParticles * rem));
    }
    for (const b of c2dBursts) {
      const rem = clamp(1 - b.elapsedMs / TOTAL_BURST_MS, 0, 1);
      total += Math.max(1, Math.round(b.particleCount * rem));
    }
    return total;
  };

  const syncDataset = () => {
    const n = countActiveParticles();
    canvas.dataset.ashActive = n > 0 ? 'true' : 'false';
    canvas.dataset.ashParticles = String(n);
  };
  syncDataset();

  const stopLoop = () => {
    if (rafId !== null) {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const renderFrame = (now: number) => {
    if (destroyed) return;
    rafId = null;

    const rawDt = lastFrameMs > 0 ? now - lastFrameMs : 0;
    lastFrameMs = now;
    const dtMs = clamp(rawDt, 0, 50);

    if (gl && partProg) {
      gl.viewport(0, 0, physW, physH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(partProg);
      gl.uniform2f(gl.getUniformLocation(partProg, 'u_canvas_size'), physW, physH);
      gl.uniform1f(gl.getUniformLocation(partProg, 'u_transition'), TRANSITION_BAND);
      gl.uniform1f(gl.getUniformLocation(partProg, 'u_life'), PARTICLE_LIFE);
      gl.uniform1i(gl.getUniformLocation(partProg, 'u_source'), 0);

      for (let i = glBursts.length - 1; i >= 0; i -= 1) {
        const b = glBursts[i];
        b.elapsedMs += dtMs * b.speedScale;
        const progress = clamp(b.elapsedMs / TOTAL_BURST_MS, 0, 1);
        if (progress >= 1) {
          disposeGLBurst(b);
          glBursts.splice(i, 1);
          continue;
        }

        // Update Pass 1 live DOM ragged erosion mask in exact lockstep with GPU particles
        if (b.domElement && b.domElement.isConnected) {
          applyDomErosionMask(b.domElement, fractalMaskUrl, progress);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, b.sourceTex);
        gl.uniform2f(gl.getUniformLocation(partProg, 'u_source_offset'), b.offsetX, b.offsetY);
        gl.uniform2f(gl.getUniformLocation(partProg, 'u_source_size'), b.texW, b.texH);
        gl.uniform1f(gl.getUniformLocation(partProg, 'u_block_size'), b.blockSize);
        gl.uniform1f(gl.getUniformLocation(partProg, 'u_dpr'), b.dpr);
        gl.uniform1f(gl.getUniformLocation(partProg, 'u_progress'), progress);
        gl.uniform3f(gl.getUniformLocation(partProg, 'u_ash_color'), b.ashColor[0], b.ashColor[1], b.ashColor[2]);

        for (let c = 0; c < b.vaos.length; c += 1) {
          gl.bindVertexArray(b.vaos[c]);
          gl.drawArrays(gl.POINTS, 0, b.counts[c]);
        }
      }
      gl.bindVertexArray(null);
    } else if (ctx2d) {
      ctx2d.clearRect(0, 0, physW, physH);

      for (let i = c2dBursts.length - 1; i >= 0; i -= 1) {
        const b = c2dBursts[i];
        b.elapsedMs += dtMs * b.speedScale;
        const progress = clamp(b.elapsedMs / TOTAL_BURST_MS, 0, 1);
        if (progress >= 1) {
          clearDomErosionMask(b.domElement);
          b.domElement = null;
          c2dBursts.splice(i, 1);
          continue;
        }

        if (b.domElement && b.domElement.isConnected) {
          applyDomErosionMask(b.domElement, fractalMaskUrl, progress);
        }

        const cx = b.offsetX + b.texW * 0.5;
        const cy = b.offsetY + b.texH * 0.5;
        for (const layer of b.layers) {
          if (progress < layer.delayNorm) continue;
          const local = clamp((progress - layer.delayNorm) / PARTICLE_LIFE, 0, 1);
          const alpha =
            (1 - smoothstepJS(0.12, 1, local)) * smoothstepJS(0, 0.12, local) * 0.9;
          if (alpha <= 0.005) continue;
          const ease = 1 - Math.pow(1 - local, 1.45);
          const spread = 1 + local * 0.045;
          ctx2d.save();
          ctx2d.globalAlpha = alpha;
          ctx2d.filter = `blur(${((0.25 + local * 2.4) * b.dpr).toFixed(2)}px)`;
          ctx2d.translate(cx + layer.dx * ease, cy + layer.dy * ease);
          ctx2d.rotate(layer.rot * ease);
          ctx2d.scale(spread, spread);
          ctx2d.drawImage(layer.canvas, -b.texW * 0.5, -b.texH * 0.5);
          ctx2d.restore();
        }
      }
    }

    syncDataset();
    if (glBursts.length > 0 || c2dBursts.length > 0) {
      rafId = win.requestAnimationFrame(renderFrame);
    } else {
      lastFrameMs = 0;
    }
  };

  return {
    backend: backendName,

    disintegrateFromElement(element: HTMLElement): number {
      if (destroyed) return 0;
      syncSize();
      seedCounter += 137;

      const snap = captureSnapshot(doc, element, canvasLeftCss, canvasTopCss, scaleX, scaleY);
      if (!snap) return 0;

      let spawnedCount = 0;

      if (gl && partProg) {
        const field = buildAshParticleField(snap.pixels, snap.texW, snap.texH, snap.scaleX, seedCounter);
        if (field.particleCount === 0) return 0;

        const sourceTex = gl.createTexture();
        if (!sourceTex) return 0;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snap.canvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

        const vaos: WebGLVertexArrayObject[] = [];
        const buffers: WebGLBuffer[] = [];
        const counts: number[] = [];
        const byteStride = PARTICLE_STRIDE * 4;

        for (const chunk of field.chunks) {
          const vao = gl.createVertexArray();
          const buf = gl.createBuffer();
          if (!vao || !buf) continue;
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, chunk.data, gl.STATIC_DRAW);

          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, byteStride, 0);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 1, gl.FLOAT, false, byteStride, 8);
          gl.enableVertexAttribArray(2);
          gl.vertexAttribPointer(2, 2, gl.FLOAT, false, byteStride, 12);
          gl.enableVertexAttribArray(3);
          gl.vertexAttribPointer(3, 2, gl.FLOAT, false, byteStride, 20);
          gl.enableVertexAttribArray(4);
          gl.vertexAttribPointer(4, 1, gl.FLOAT, false, byteStride, 28);
          gl.enableVertexAttribArray(5);
          gl.vertexAttribPointer(5, 1, gl.FLOAT, false, byteStride, 32);

          vaos.push(vao);
          buffers.push(buf);
          counts.push(chunk.count);
        }
        gl.bindVertexArray(null);

        spawnedCount = field.particleCount;
        glBursts.push({
          sourceTex,
          vaos,
          buffers,
          counts,
          totalParticles: field.particleCount,
          texW: snap.texW,
          texH: snap.texH,
          offsetX: snap.offsetX,
          offsetY: snap.offsetY,
          blockSize: field.blockSize,
          dpr: snap.scaleX,
          ashColor: snap.ashColor,
          domElement: element,
          elapsedMs: 0,
          speedScale: 1,
        });
      } else if (ctx2d) {
        const layerBurst = createCanvas2DLayerBurst(doc, snap, element, seedCounter);
        if (layerBurst.particleCount === 0) return 0;
        spawnedCount = layerBurst.particleCount;
        c2dBursts.push(layerBurst);
      } else {
        return 0;
      }

      snap.canvas.width = 0;
      snap.canvas.height = 0;

      // Render Frame 0 synchronously at `progress === 0` (`maskPosition === '100.000% 0%'`, zero displacement!)
      const now0 = win.performance.now();
      if (rafId === null) {
        lastFrameMs = now0;
      }
      stopLoop();
      renderFrame(now0);
      return spawnedCount;
    },

    accelerate() {
      for (const b of glBursts) {
        clearDomErosionMask(b.domElement);
        b.domElement = null;
        b.speedScale = Math.max(b.speedScale, 2.8);
      }
      for (const b of c2dBursts) {
        clearDomErosionMask(b.domElement);
        b.domElement = null;
        b.speedScale = Math.max(b.speedScale, 2.8);
      }
    },

    clear() {
      for (const b of glBursts) disposeGLBurst(b);
      glBursts.length = 0;
      for (const b of c2dBursts) clearDomErosionMask(b.domElement);
      c2dBursts.length = 0;
      stopLoop();
      if (gl) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else if (ctx2d) {
        ctx2d.clearRect(0, 0, physW, physH);
      }
      syncDataset();
    },

    get activeCount() {
      return countActiveParticles();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      win.removeEventListener('resize', syncSize);
      for (const b of glBursts) disposeGLBurst(b);
      glBursts.length = 0;
      for (const b of c2dBursts) clearDomErosionMask(b.domElement);
      c2dBursts.length = 0;
      if (gl) {
        if (partProg) gl.deleteProgram(partProg);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    },
  };
}
