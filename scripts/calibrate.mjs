// AI-assisted (Anthropic Claude).
// 1. Reads the color legend printed on NASA's labeled map (Map_HD_2025.png, -4..+4 °C).
// 2. The equirectangular video has no legend, so we check which range its colors use by
//    comparing each year's area-weighted mean against GISTEMP's published global means.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { sampleLine, stopsFromSamples, createLegend, rescaleStops } from '../src/legend.js';

const root = new URL('..', import.meta.url).pathname;
function readRGB(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).stdout.toString().trim().split(',').map(Number);
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }).stdout;
  return { width: probe[0], height: probe[1], data: raw };
}

// Legend bar on Map_HD_2025.png: -4 °C at x=660, +4 °C at x=1260, centre row y=1013.
const map = readRGB(root + 'data/raw/Map_HD_2025.png');
const colors = sampleLine(map.data, map.width, map.height, 663, 1013, 1257, 1013, 256, 3, 6);
const x2v = x => (x - 960) / 75;
const stops = stopsFromSamples(colors, x2v(663), x2v(1257));
mkdirSync(root + 'data/legends', { recursive: true });
writeFileSync(root + 'data/legends/gistemp-vik.json', JSON.stringify({
  source: 'Legend bar of NASA SVS 5603 Map_HD_2025.png (labelled -4 °C to +4 °C)', unit: '°C', stops,
}));

// Published GISTEMP v4 global annual means (°C vs 1951-1980), rounded; used only as a check.
const known = { 1880: -0.17, 1909: -0.48, 1944: 0.13, 1976: -0.10, 1998: 0.61, 2016: 1.01, 2020: 1.01, 2023: 1.17, 2024: 1.28 };
const unit = createLegend(rescaleStops(stops, -1, 1), { tolerance: 12 }); // normalised -1..+1
console.log('year  coverage  meanNorm  known  impliedHalfRange');
const ratios = [];
for (const y of Object.keys(known)) {
  const img = readRGB(`${root}data/frames/${y}.png`);
  let sw = 0, sv = 0, cw = 0;
  for (let j = 0; j < img.height; j++) {
    const w = Math.cos(((j + 0.5) / img.height * 180 - 90) * Math.PI / 180);
    for (let i = 0; i < img.width; i++) {
      const p = (j * img.width + i) * 3, hit = unit.lookup(img.data[p], img.data[p + 1], img.data[p + 2]);
      cw += w; if (hit) { sw += w; sv += w * hit.value; }
    }
  }
  const mean = sv / sw, ratio = known[y] / mean;
  if (Math.abs(known[y]) > 0.5) ratios.push(ratio);
  console.log(y, (sw / cw * 100).toFixed(1) + '%', mean.toFixed(3), known[y], ratio.toFixed(2));
}
console.log('implied half-range from recent warm years:', ratios.map(r => r.toFixed(2)).join(', '));
