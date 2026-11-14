// AI-assisted (Anthropic Claude).
// Builds the "Ocean" track from NASA SVS 3912 (Global Sea Surface Currents and Temperature, an EIC resource):
//   frame:  flat_global_ecco2_2028x1024.25000.jpg  (2007-06-19, equirectangular)
//   legend: sst_ecco2_cbar.png                      (Sea Surface Temp, 0 to 32 °C)
// The flow lines are shaded, so colors are matched by hue (lightness ignored); gray land and black gaps are skipped.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { sampleLine, stopsFromSamples, createLegend } from '../src/legend.js';

const root = new URL('..', import.meta.url).pathname, raw = root + 'data/raw/ocean/';
function readRGB(file, w, h) {
  const args = ['-v', 'error', '-i', file]; if (w) args.push('-vf', `scale=${w}:${h}:flags=neighbor`);
  return spawnSync('ffmpeg', [...args, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }).stdout;
}

// Legend: inner bar of the 310x95 color bar runs from x≈13 (0 °C) to x≈292 (32 °C), centre row y≈48.
const cb = readRGB(raw + 'sst_ecco2_cbar.png');
const X0 = 12.7, X1 = 292.7, x2v = x => (x - X0) / (X1 - X0) * 32;
const colors = sampleLine(cb, 310, 95, 16, 48, 289, 48, 128, 3, 3);
const stops = stopsFromSamples(colors, x2v(16), x2v(289));
const legend = createLegend(stops, { matchHue: true, tolerance: 10, minChroma: 18 });

// Read the frame at full size (2048x1024) so thin flow lines keep their real color.
const W = 2048, H = 1024, frame = readRGB(raw + 'flat_global_ecco2_2028x1024.25000.jpg');
const GW = 180, GH = 90, bx = W / GW, by = H / GH;
const cube = new Uint8Array(GW * GH);
let filled = 0;
for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
  let s = 0, n = 0;
  for (let j = Math.floor(cy * by); j < Math.floor((cy + 1) * by); j++) for (let i = Math.floor(cx * bx); i < Math.floor((cx + 1) * bx); i++) {
    const p = (j * W + i) * 3, hit = legend.lookup(frame[p], frame[p + 1], frame[p + 2]);
    if (hit) { s += hit.value; n++; }
  }
  if (n >= 6) { cube[cy * GW + cx] = 1 + Math.round(Math.max(0, Math.min(32, s / n)) / 32 * 254); filled++; }
}
mkdirSync(root + 'assets/ocean/frames', { recursive: true });
writeFileSync(root + 'assets/ocean/cube.bin', cube);
spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw + 'flat_global_ecco2_2028x1024.25000.jpg', '-vf', 'scale=1440:720', '-q:v', '3', root + 'assets/ocean/frames/2007.jpg']);
writeFileSync(root + 'assets/ocean/track.json', JSON.stringify({
  id: 'ocean', kind: 'ocean',
  title: 'Ocean currents and temperature',
  subtitle: 'Sea surface currents colored by water temperature, 19 June 2007',
  unit: '°C', min: 0, max: 32, years: [2007], grid: { width: GW, height: GH, cellDegrees: 2 },
  legendSource: 'Color bar sst_ecco2_cbar.png (Sea Surface Temp, 0 to 32 °C), matched by hue',
  credit: 'NASA Scientific Visualization Studio, "Global Sea Surface Currents and Temperature" (ECCO2 model, MIT/JPL)',
  sourceUrl: 'https://svs.gsfc.nasa.gov/3912/',
  stops: stops.filter((_, i) => i % 4 === 0 || i === stops.length - 1),
}));
console.log('ocean cells with data:', filled, 'of', GW * GH);
