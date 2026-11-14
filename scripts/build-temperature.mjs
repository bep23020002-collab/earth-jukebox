// AI-assisted (Anthropic Claude).
// Builds the "Global temperature" track from NASA SVS 5603 yearly frames:
//   assets/temperature/frames/<year>.jpg  - pictures shown on screen
//   assets/temperature/cube.bin            - values on a 2° grid for every year (read by the app)
// Every value comes from reading frame colors with the legend in data/legends/gistemp-vik.json.
// The equirectangular video uses the same "vik" colors over -2..+2 °C (see scripts/calibrate.mjs).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createLegend, rescaleStops } from '../src/legend.js';

const root = new URL('..', import.meta.url).pathname;
const RANGE = 2; // °C, half-range of the equirectangular video's color scale
const GW = 180, GH = 90; // 2° cells
const legendFile = JSON.parse(readFileSync(root + 'data/legends/gistemp-vik.json', 'utf8'));
const legend = createLegend(rescaleStops(legendFile.stops, -RANGE, RANGE), { tolerance: 12 });
const years = readFileSync(root + 'data/frames/year_frame.txt', 'utf8').trim().split('\n').map(l => +l.split(' ')[0]);

mkdirSync(root + 'assets/temperature/frames', { recursive: true });
const cube = new Uint8Array(years.length * GW * GH); // 0 = no data, 1..255 = -RANGE..+RANGE
for (const [k, y] of years.entries()) {
  const src = `${root}data/frames/${y}.png`;
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', `${root}data/frames_px/${y}.png`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
  const W = 1440, H = 720, bx = W / GW, by = H / GH; // pure-color (nearest-neighbour) frames
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
    // Pixels that are not on the legend are either gray "no data" or dark coastline/border lines.
    // Lines are skipped; a cell is "no data" only when gray outweighs real colors.
    let s = 0, n = 0, gray = 0;
    for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
      const p = ((cy * by + j) * W + cx * bx + i) * 3, r = raw[p], g = raw[p + 1], b = raw[p + 2];
      const hit = legend.lookup(r, g, b);
      if (hit) { s += hit.value; n++; } else if (Math.max(r, g, b) - Math.min(r, g, b) < 18 && r > 90 && r < 190) gray++;
    }
    cube[k * GW * GH + cy * GW + cx] = n > 0 && gray < n ? 1 + Math.round((s / n + RANGE) / (2 * RANGE) * 254) : 0;
  }
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-q:v', '3', `${root}assets/temperature/frames/${y}.jpg`]);
}
writeFileSync(root + 'assets/temperature/cube.bin', cube);
writeFileSync(root + 'assets/temperature/track.json', JSON.stringify({
  id: 'temperature',
  title: 'Global temperature, 1880–2025',
  subtitle: 'Surface temperature anomaly, 12-month average, relative to 1951–1980',
  unit: '°C', min: -RANGE, max: RANGE, years, grid: { width: GW, height: GH, cellDegrees: 2 },
  legendSource: legendFile.source + '; this video uses the same colors over -2 to +2 °C',
  credit: 'NASA Scientific Visualization Studio, data by Robert B. Schmunk (NASA/GSFC GISS), GISTEMP v4',
  sourceUrl: 'https://svs.gsfc.nasa.gov/5603/',
  stops: rescaleStops(legendFile.stops, -RANGE, RANGE).filter((_, i) => i % 8 === 0 || i === 255),
}));
console.log('years', years.length, 'cube bytes', cube.length);
