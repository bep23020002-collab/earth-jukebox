// AI-assisted (Anthropic Claude).
// "Your own map": any picture with a color bar. The user marks the two ends of the bar and
// types their values; from then on every pixel can be read as a number and played.
import { sampleLine, stopsFromSamples, createLegend } from './legend.js';

export class ImageSource {
  constructor() { this.img = null; this.data = null; this.legend = null; this.loadedAt = 0; }

  // Accepts a File/Blob (from a file picker, drag and drop, or paste).
  async load(blob, maxWidth = 1600) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not a picture the browser can open.')); i.src = url; });
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      Object.assign(this, { canvas: c, width: w, height: h, data: g.getImageData(0, 0, w, h).data, legend: null, line: null, loadedAt: performance.now(), name: blob.name || 'pasted picture' });
    } finally { URL.revokeObjectURL(url); }
  }

  // p0, p1 in image pixels: low end and high end of the color bar.
  calibrate(p0, p1, vmin, vmax, unit) {
    const colors = sampleLine(this.data, this.width, this.height, p0.x, p0.y, p1.x, p1.y, 256, 4, 2);
    const stops = stopsFromSamples(colors, vmin, vmax);
    this.legend = createLegend(stops, { tolerance: 12 });
    this.unit = unit; this.line = { p0, p1 };
    // Leave the color bar itself (and the arrow caps at its ends) out of the readings and statistics.
    const pad = Math.max(18, 0.1 * Math.hypot(p1.x - p0.x, p1.y - p0.y));
    this.exclude = { x0: Math.min(p0.x, p1.x) - pad, x1: Math.max(p0.x, p1.x) + pad, y0: Math.min(p0.y, p1.y) - pad, y1: Math.max(p0.y, p1.y) + pad };
    this.readyAt = performance.now();
    return this.legend;
  }

  inLegendArea(x, y) { const e = this.exclude; return e && x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1; }

  // Value under a point (u, v in 0..1), averaging a small 3x3 patch; null when off the legend.
  valueAt(u, v) {
    if (!this.legend) return null;
    const cx = Math.round(u * (this.width - 1)), cy = Math.round(v * (this.height - 1));
    if (this.inLegendArea(cx, cy)) return null;
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      const p = (y * this.width + x) * 4, hit = this.legend.lookup(this.data[p], this.data[p + 1], this.data[p + 2]);
      if (hit) { s += hit.value; n++; }
    }
    return n >= 5 ? s / n : null;
  }

  stats() {
    let s = 0, n = 0, all = 0, hi = -Infinity, lo = Infinity, hiAt = null, loAt = null;
    const step = Math.max(1, Math.floor(this.width / 300));
    for (let y = 0; y < this.height; y += step) for (let x = 0; x < this.width; x += step) {
      if (this.inLegendArea(x, y)) continue;
      all++;
      const p = (y * this.width + x) * 4, hit = this.legend.lookup(this.data[p], this.data[p + 1], this.data[p + 2]);
      if (!hit) continue;
      s += hit.value; n++;
      if (hit.value > hi) { hi = hit.value; hiAt = { u: x / this.width, v: y / this.height }; }
      if (hit.value < lo) { lo = hit.value; loAt = { u: x / this.width, v: y / this.height }; }
    }
    return { mean: n ? s / n : null, coverage: all ? n / all : 0, hi, lo, hiAt, loAt };
  }
}

// Describe a spot on an arbitrary picture without knowing its map projection.
export function describeSpot(u, v) {
  const col = u < 1 / 3 ? 'left' : u < 2 / 3 ? 'middle' : 'right';
  const row = v < 1 / 3 ? 'top' : v < 2 / 3 ? 'center' : 'bottom';
  return row === 'center' && col === 'middle' ? 'the center' : `${row} ${col}`.replace('center ', '');
}
