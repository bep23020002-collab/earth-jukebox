// AI-assisted (Anthropic Claude).
// Validity check: are the temperatures we read from the colors of NASA's map close to NASA's own numbers?
// Compares assets/temperature/cube.bin (what Earth Jukebox plays) with NASA GISS GISTEMP v4 tables:
//   data/gistemp/GLB.Ts+dSST.csv    yearly global mean (J-D column)
//   data/gistemp/ZonAnn.Ts+dSST.csv yearly means for 8 latitude bands
// Writes assets/validation/temperature.json and assets/validation/temperature.svg (chart for the website).
// Run: node scripts/validate.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const track = JSON.parse(readFileSync(root + 'assets/temperature/track.json', 'utf8'));
const cube = new Uint8Array(readFileSync(root + 'assets/temperature/cube.bin'));
const { width: W, height: H, cellDegrees: D } = track.grid;
const { min, max, years } = track;
const decode = c => (c ? min + (c - 1) / 254 * (max - min) : null);

// --- NASA tables ---
const csv = f => readFileSync(root + 'data/gistemp/' + f, 'utf8').trim().split('\n').map(l => l.split(','));
const num = s => (s === '***' || s === undefined ? null : +s);
const glbRows = csv('GLB.Ts+dSST.csv').slice(2);
const nasaGlobal = new Map(glbRows.map(r => [+r[0], num(r[13])])); // J-D
const zon = csv('ZonAnn.Ts+dSST.csv');
const zonHead = zon[0];
const BANDS = [['64N-90N', 64, 90], ['44N-64N', 44, 64], ['24N-44N', 24, 44], ['EQU-24N', 0, 24], ['24S-EQU', -24, 0], ['44S-24S', -44, -24], ['64S-44S', -64, -44], ['90S-64S', -90, -64]];
const nasaBand = new Map(zon.slice(1).map(r => [+r[0], Object.fromEntries(BANDS.map(([name]) => [name, num(r[zonHead.indexOf(name)])]))]));

// --- what we read from the map: area-weighted means over cells that have data ---
function mapMeans(yi) {
  let s = 0, w = 0, clipped = 0, cells = 0;
  const band = Object.fromEntries(BANDS.map(([n]) => [n, [0, 0]]));
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * D, cw = Math.cos(lat * Math.PI / 180);
    const b = BANDS.find(([, lo, hi]) => lat >= lo && lat < hi)?.[0];
    for (let x = 0; x < W; x++) {
      const code = cube[yi * W * H + y * W + x], v = decode(code);
      if (v == null) continue;
      cells++; if (code === 1 || code === 255) clipped++;
      s += v * cw; w += cw;
      if (b) { band[b][0] += v * cw; band[b][1] += cw; }
    }
  }
  return { global: w ? s / w : null, coverage: cells / (W * H), clipped: cells ? clipped / cells : 0,
    bands: Object.fromEntries(BANDS.map(([n]) => [n, band[n][1] ? band[n][0] / band[n][1] : null])) };
}

const rows = years.map((yr, yi) => ({ year: yr, ...mapMeans(yi), nasa: nasaGlobal.get(yr), nasaBands: nasaBand.get(yr) }));
const stats = (pairs) => {
  const p = pairs.filter(([a, b]) => a != null && b != null), n = p.length;
  const d = p.map(([a, b]) => a - b), mae = d.reduce((s, x) => s + Math.abs(x), 0) / n;
  const rmse = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / n), bias = d.reduce((s, x) => s + x, 0) / n;
  const ma = p.reduce((s, [a]) => s + a, 0) / n, mb = p.reduce((s, [, b]) => s + b, 0) / n;
  const cov = p.reduce((s, [a, b]) => s + (a - ma) * (b - mb), 0), va = p.reduce((s, [a]) => s + (a - ma) ** 2, 0), vb = p.reduce((s, [, b]) => s + (b - mb) ** 2, 0);
  return { n, mae: +mae.toFixed(3), rmse: +rmse.toFixed(3), bias: +bias.toFixed(3), maxAbs: +Math.max(...d.map(Math.abs)).toFixed(3), r: +(cov / Math.sqrt(va * vb)).toFixed(4) };
};
const avgYears = (key, a, b) => { const v = rows.filter(r => r.year >= a && r.year <= b && r[key] != null).map(r => r[key]); return v.reduce((s, x) => s + x, 0) / v.length; };
const warming = (key) => +(avgYears(key, 2015, 2024) - avgYears(key, 1880, 1899)).toFixed(2);

// 5-year centred running mean of NASA, to test whether the map is smoothed
const nasa5 = rows.map((r, i) => { const w = rows.slice(Math.max(0, i - 2), i + 3).map(x => x.nasa).filter(v => v != null); return w.length === 5 ? w.reduce((s, x) => s + x, 0) / 5 : null; });

const summary = {
  source: 'NASA GISS GISTEMP v4, GLB.Ts+dSST.csv (J-D) and ZonAnn.Ts+dSST.csv, downloaded ' + new Date().toISOString().slice(0, 10),
  method: 'Area-weighted (cos latitude) mean of every 2° cell that has data in the Earth Jukebox temperature cube, compared with NASA\'s published mean for the same year.',
  global: stats(rows.map(r => [r.global, r.nasa])),
  globalVsNasa5yr: stats(rows.map((r, i) => [r.global, nasa5[i]])),
  warming1880sTo2015s: { ours: warming('global'), nasa: warming('nasa') },
  bands: Object.fromEntries(BANDS.map(([n]) => [n, stats(rows.map(r => [r.bands[n], r.nasaBands?.[n]]))])),
  clippedShare2025: +rows[rows.length - 1].clipped.toFixed(3),
  years: rows.map(r => ({ year: r.year, ours: r.global == null ? null : +r.global.toFixed(3), nasa: r.nasa, coverage: +r.coverage.toFixed(3), clipped: +r.clipped.toFixed(3) })),
};
mkdirSync(root + 'assets/validation', { recursive: true });
writeFileSync(root + 'assets/validation/temperature.json', JSON.stringify(summary, null, 1));

// --- chart (Braun style: ink for NASA, orange for Earth Jukebox) ---
const CW = 760, CH = 300, L = 46, R = 16, T = 18, B = 34;
const yMin = -0.6, yMax = 1.4;
const X = yr => L + (yr - 1880) / (2025 - 1880) * (CW - L - R), Y = v => T + (yMax - v) / (yMax - yMin) * (CH - T - B);
const path = key => rows.filter(r => r[key] != null).map((r, i) => `${i ? 'L' : 'M'}${X(r.year).toFixed(1)} ${Y(r[key]).toFixed(1)}`).join(' ');
const grid = [-0.5, 0, 0.5, 1].map(v => `<line x1="${L}" x2="${CW - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? '#5C5C5C' : '#C6C1B8'}" stroke-width="1"${v === 0 ? ' stroke-dasharray="4 4"' : ''}/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}</text>`).join('');
const xt = [1880, 1900, 1920, 1940, 1960, 1980, 2000, 2025].map(y => `<text x="${X(y)}" y="${CH - 12}" text-anchor="middle">${y}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" font-family="ui-monospace, Menlo, monospace" font-size="12" fill="#5C5C5C">
<rect width="${CW}" height="${CH}" fill="#EFEDE8"/>${grid}${xt}
<text x="${L}" y="12">°C compared with 1951–1980</text>
<path d="${path('nasa')}" fill="none" stroke="#191919" stroke-width="2.4"/>
<path d="${path('global')}" fill="none" stroke="#E96A26" stroke-width="1.6"/>
<g transform="translate(${L + 12},${T + 18})"><rect width="12" height="3" y="-2" fill="#191919"/><text x="18" y="2" fill="#191919">NASA GISTEMP v4 (published numbers)</text>
<rect width="12" height="3" y="16" fill="#E96A26"/><text x="18" y="20" fill="#191919">Earth Jukebox (read from the map colors)</text></g>
</svg>`;
writeFileSync(root + 'assets/validation/temperature.svg', svg);

console.log(JSON.stringify({ global: summary.global, globalVsNasa5yr: summary.globalVsNasa5yr, warming: summary.warming1880sTo2015s, clipped2025: summary.clippedShare2025 }, null, 1));
console.table(Object.fromEntries(Object.entries(summary.bands).map(([k, v]) => [k, { mae: v.mae, bias: v.bias, r: v.r }])));
