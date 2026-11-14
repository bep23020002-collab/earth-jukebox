// AI-assisted (Anthropic Claude).
// Builds the "Lightning" track from NASA SVS 5011 (Lightning Events Detected from the ISS, 2017–2023, an EIC resource).
// The Science On a Sphere movie (4096x2048, equirectangular) shows a 10-day window of lightning as yellow dots.
// We sample one frame about every 10 days and, for each 2° cell and year, record the share of windows with lightning.
//   assets/lightning/cube.bin         values 0..1 per year (share of 10-day windows with lightning seen)
//   assets/lightning/frames/<y>.jpg   all lightning dots seen that year, laid over NASA's own background
// labels.txt gives the date of every frame; after "31 Dec 2022" it says "2003", which must mean 2023
// (the movie ends in July 2023), so 2003 is read as 2023.
// The ISS orbit only lets the sensor see between about 55°N and 55°S. Rows of cells where no lightning
// was seen in the whole movie are outside that band, so they are stored as "no data" (0), not as "no lightning".
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname, raw = root + 'data/raw/lightning/';
const labels = readFileSync(raw + 'labels.txt', 'utf8').trim().split('\n');
const yearOf = n => { const y = +labels[Math.min(n, labels.length - 1)].split(/\s+/)[2]; return y === 2003 ? 2023 : y; };
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023];
const STEP = 26;                 // frames between samples (about 10 days)
const W = 1440, H = 720, GW = 180, GH = 90, bx = W / GW, by = H / GH;
const isLightning = (r, g, b) => r > 140 && g > 120 && b < 100 && r - b > 80; // yellow dots

const counts = YEARS.map(() => new Uint16Array(GW * GH)), windows = YEARS.map(() => 0);
const composite = YEARS.map(() => null);
const frameBytes = W * H * 3;
// dilation keeps tiny dots visible after shrinking 4096x2048 to 1440x720
const ff = spawn('ffmpeg', ['-v', 'error', '-i', raw + 'iss_lightning_sos_yearly_07312023_2048p60.mp4',
  '-vf', `select='not(mod(n\\,${STEP}))',format=gbrp,dilation,scale=${W}:${H}:flags=area`, '-fps_mode', 'passthrough',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
let buf = Buffer.alloc(0), k = 0;
ff.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= frameBytes) {
    const f = buf.subarray(0, frameBytes); buf = buf.subarray(frameBytes);
    const yi = YEARS.indexOf(yearOf(k * STEP)); k++;
    if (yi < 0) continue;
    windows[yi]++;
    const seen = new Uint8Array(GW * GH);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 3;
      if (isLightning(f[p], f[p + 1], f[p + 2])) seen[Math.floor(y / by) * GW + Math.floor(x / bx)] = 1;
    }
    for (let i = 0; i < seen.length; i++) counts[yi][i] += seen[i];
    if (!composite[yi]) composite[yi] = Buffer.from(f);
    else { const c = composite[yi]; for (let i = 0; i < frameBytes; i++) if (f[i] > c[i]) c[i] = f[i]; }
  }
});
ff.on('close', () => {
  mkdirSync(root + 'assets/lightning/frames', { recursive: true });
  const cube = new Uint8Array(YEARS.length * GW * GH);
  const observedRow = Array.from({ length: GH }, (_, cy) => counts.some(c => c.subarray(cy * GW, (cy + 1) * GW).some(n => n > 0)));
  const rows = observedRow.flatMap((o, cy) => (o ? [cy] : []));
  const band = [90 - rows[0] * 2, 90 - (rows[rows.length - 1] + 1) * 2];
  YEARS.forEach((y, yi) => {
    for (let i = 0; i < GW * GH; i++) cube[yi * GW * GH + i] = observedRow[Math.floor(i / GW)] ? 1 + Math.round(counts[yi][i] / Math.max(1, windows[yi]) * 254) : 0;
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-', '-q:v', '3', `${root}assets/lightning/frames/${y}.jpg`], { input: composite[yi] });
  });
  writeFileSync(root + 'assets/lightning/cube.bin', cube);
  writeFileSync(root + 'assets/lightning/track.json', JSON.stringify({
    id: 'lightning', kind: 'lightning', eic: 'Lightning Events Detected from the ISS',
    title: 'Lightning seen from the Space Station',
    subtitle: 'How often NASA\'s Lightning Imaging Sensor on the ISS saw lightning, March 2017 to July 2023',
    unit: '', min: 0, max: 1, years: YEARS, grid: { width: GW, height: GH, cellDegrees: 2 },
    windows: Object.fromEntries(YEARS.map((y, i) => [y, windows[i]])),
    observedLatitudes: band, // [north, south] edge of the band the sensor could see; outside it is "no data"
    credit: 'NASA Scientific Visualization Studio, "Lightning Events Detected from the International Space Station (ISS) 2017-2023" (LIS on ISS)',
    sourceUrl: 'https://svs.gsfc.nasa.gov/5011/',
    stops: [{ rgb: [20, 20, 20], value: 0 }, { rgb: [120, 110, 20], value: 0.4 }, { rgb: [255, 230, 0], value: 1 }],
  }));
  console.log('windows per year', windows.join(', '), '| observed latitudes', band.join(' to '));
});
