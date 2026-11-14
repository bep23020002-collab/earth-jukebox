// AI-assisted (Anthropic Claude).
// Lightning by month, for "pick a month" in Play. Same source and method as build-lightning.mjs
// (NASA SVS 5011 Science On a Sphere movie: each frame shows the lightning the ISS sensor saw in a 10-day window),
// but the frames are grouped by the calendar month of their date label instead of by year.
//   assets/lightning/monthly/m01..m12.bin  for each calendar month: 7 years (2017 first) x 90 rows x 180 columns, 1 byte per cell
//   assets/lightning/monthly/meta.json     months covered and encoding
// Byte 0 = no data (outside the sensor's band, or a month the movie does not cover); otherwise share = (byte - 1) / 254
// of the sampled 10-day windows dated in that month in which lightning was seen in the cell.
// Run: node scripts/build-lightning-monthly.mjs   (needs data/raw/lightning/ and assets/lightning/cube.bin)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname, raw = root + 'data/raw/lightning/';
const labels = readFileSync(raw + 'labels.txt', 'utf8').trim().split('\n');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = n => { const [, mon, y] = labels[Math.min(n, labels.length - 1)].split(/\s+/); return { year: +y === 2003 ? 2023 : +y, month: MON.indexOf(mon) + 1 }; };
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023];
const STEP = 8;                  // frames between samples (about 3 days)
const W = 1440, H = 720, GW = 180, GH = 90, bx = W / GW, by = H / GH;
const isLightning = (r, g, b) => r > 140 && g > 120 && b < 100 && r - b > 80; // yellow dots, as in build-lightning.mjs

// rows the sensor can see: the same rows that have data in the yearly lightning cube
const yearly = readFileSync(root + 'assets/lightning/cube.bin');
const observedRow = Array.from({ length: GH }, (_, cy) => yearly.subarray(cy * GW, (cy + 1) * GW).some(c => c > 0));

const counts = new Map(), windows = new Map(); // "year-month" -> Uint16Array / number
const frameBytes = W * H * 3;
const ff = spawn('ffmpeg', ['-v', 'error', '-i', raw + 'iss_lightning_sos_yearly_07312023_2048p60.mp4',
  '-vf', `select='not(mod(n\\,${STEP}))',format=gbrp,dilation,scale=${W}:${H}:flags=area`, '-fps_mode', 'passthrough',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
let buf = Buffer.alloc(0), k = 0, lastLabel = '';
ff.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= frameBytes) {
    const f = buf.subarray(0, frameBytes); buf = buf.subarray(frameBytes);
    const n = k * STEP; k++;
    const label = labels[Math.min(n, labels.length - 1)];
    if (label === lastLabel) continue; // the movie holds its first frame; count each window once
    lastLabel = label;
    const { year, month } = dateOf(n), key = `${year}-${month}`;
    if (!YEARS.includes(year) || month < 1) continue;
    if (!counts.has(key)) { counts.set(key, new Uint16Array(GW * GH)); windows.set(key, 0); }
    windows.set(key, windows.get(key) + 1);
    const seen = new Uint8Array(GW * GH), c = counts.get(key);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 3;
      if (isLightning(f[p], f[p + 1], f[p + 2])) seen[Math.floor(y / by) * GW + Math.floor(x / bx)] = 1;
    }
    for (let i = 0; i < seen.length; i++) c[i] += seen[i];
  }
});
ff.on('close', () => {
  const dir = root + 'assets/lightning/monthly/';
  mkdirSync(dir, { recursive: true });
  const months = {};
  for (let m = 1; m <= 12; m++) {
    const out = new Uint8Array(YEARS.length * GW * GH);
    YEARS.forEach((y, yi) => {
      const key = `${y}-${m}`, c = counts.get(key), nw = windows.get(key);
      if (!c || !nw) return;
      (months[y] ||= []).push(m);
      for (let i = 0; i < GW * GH; i++) if (observedRow[Math.floor(i / GW)]) out[yi * GW * GH + i] = 1 + Math.round(c[i] / nw * 254);
    });
    writeFileSync(dir + `m${String(m).padStart(2, '0')}.bin`, out);
  }
  Object.values(months).forEach(a => a.sort((p, q) => p - q));
  const meta = { source: 'NASA SVS 5011, Lightning Events Detected from the ISS (frames grouped by the month of their date label)', firstYear: YEARS[0], lastYear: YEARS[YEARS.length - 1], months,
    windowsPerMonth: Object.fromEntries([...windows].sort()), encoding: { type: 'share', noData: 0, note: 'share = (byte - 1) / 254' } };
  writeFileSync(dir + 'meta.json', JSON.stringify(meta, null, 1));
  console.log('months covered:', JSON.stringify(months), 'windows per month (min/max):', Math.min(...windows.values()), Math.max(...windows.values()));
});
