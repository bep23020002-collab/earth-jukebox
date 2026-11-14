// AI-assisted (Anthropic Claude).
// Reads a visualization's color legend and turns any pixel color into a data value.
// Works in the browser and in Node (pure functions on RGB arrays).

// sRGB (0-255) -> CIE Lab (D65). Distances in Lab track perceived color difference.
export function rgbToLab(r, g, b) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Average the colors along a straight line drawn over the legend.
// data: RGBA (4 channels) or RGB (3 channels) bytes; returns n samples [[r,g,b], ...].
export function sampleLine(data, width, height, x0, y0, x1, y1, n = 256, channels = 4, halfThick = 2) {
  const out = [];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len; // normal, to average across the bar's thickness
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    let r = 0, g = 0, b = 0, k = 0;
    for (let d = -halfThick; d <= halfThick; d++) {
      const x = Math.round(cx + nx * d), y = Math.round(cy + ny * d);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const p = (y * width + x) * channels;
      r += data[p]; g += data[p + 1]; b += data[p + 2]; k++;
    }
    out.push(k ? [Math.round(r / k), Math.round(g / k), Math.round(b / k)] : [0, 0, 0]);
  }
  return out;
}

// Build a legend from colors sampled evenly between two known values (a linear color bar).
export function stopsFromSamples(colors, vmin, vmax) {
  const n = colors.length;
  return colors.map((rgb, i) => ({ rgb, value: vmin + (vmax - vmin) * (n === 1 ? 0.5 : i / (n - 1)) }));
}

// A legend answers: "what value does this color mean?" Colors that are not on the legend
// (missing-data gray, coastlines, labels) come back as null instead of a made-up number.
export function createLegend(stops, { tolerance = 12 } = {}) {
  const labs = stops.map(s => rgbToLab(...s.rgb));
  const values = stops.map(s => s.value);
  const min = Math.min(...values), max = Math.max(...values);
  const cache = new Map();
  function nearest(r, g, b) {
    const [L, A, B] = rgbToLab(r, g, b);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < labs.length; i++) {
      const l = labs[i], d = (l[0] - L) ** 2 + (l[1] - A) ** 2 + (l[2] - B) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return [best, Math.sqrt(bestD)];
  }
  function lookup(r, g, b) {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2); // 6 bits per channel
    let hit = cache.get(key);
    if (!hit) { hit = nearest((r & ~3) + 2, (g & ~3) + 2, (b & ~3) + 2); cache.set(key, hit); }
    const [i, dist] = hit;
    if (dist > tolerance) return null;
    return { value: values[i], t: (values[i] - min) / (max - min || 1), dist };
  }
  return { stops, min, max, lookup };
}

// Rescale a legend's values, e.g. when the same colormap is used with a different range.
export function rescaleStops(stops, vmin, vmax) {
  const a = stops[0].value, b = stops[stops.length - 1].value;
  return stops.map(s => ({ rgb: s.rgb, value: vmin + (s.value - a) / (b - a) * (vmax - vmin) }));
}
