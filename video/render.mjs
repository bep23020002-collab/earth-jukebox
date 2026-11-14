// AI-assisted (Anthropic Claude). Renders the 30-second Earth Jukebox demo video.
// Product-demo style in the website's hardware look (Dieter Rams / Braun recipe).
// Every globe frame, every note and every number comes from the same NASA data the website uses (../assets).
// Usage: node render.mjs [out.mp4]   |   node render.mjs --samples [seconds…]   (writes PNG frames to out/)
// Options: --ssb out/ssb.json   put the SSB Sibu tester clip where the family-story section is (see SSB below)
//          --wm quiet|pill      AI-assistance watermark style (default quiet)
//          --look night|concrete|orange   colours around the device (default night, with twinkling stars)
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { KINDS } from '../src/tracks.js';
import { drawScore } from '../src/score.js';
import { composeSong } from '../src/song.js';

const HERE = path.dirname(new URL(import.meta.url).pathname), A = path.join(HERE, '../assets/');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, 'out/earth-jukebox-demo.mp4');
const SAMPLES = process.argv.includes('--samples');
const argOf = name => { const i = process.argv.indexOf(name); return i > 1 ? process.argv[i + 1] : null; };
const WM = argOf('--wm') || 'quiet';
const W = 1920, H = 1080, FPS = 30, DUR = 30, SR = 44100;
for (const f of ['/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Menlo.ttc']) if (fs.existsSync(f)) GlobalFonts.registerFromPath(f);
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif', MONO = 'Menlo, Monaco, monospace';
const K = {
  bg: '#D3CFC7', body: '#E4E1DC', plate: '#EFEDE8', paper: '#F8F7F3', key: '#D4D0C8', line: '#C6C1B8', line2: '#B3AEA4',
  ink: '#191919', gray: '#5C5C5C', orange: '#E96A26', screen: '#171716', sInk: '#E6E3DD', sDim: '#9D9A93', lcd: '#232B25', lInk: '#D6F0C4', lDim: '#9CC48A',
};
// stage look: the colours around the device and of the full-screen scenes (the device and NASA's maps never change)
const LOOKS = {
  concrete: { bg: '#D3CFC7', fill: '#E4E1DC', ink: '#191919', dim: '#5C5C5C', num: '#191919', plate: '#EFEDE8', line: '#C6C1B8', line2: '#B3AEA4', led: '#E96A26' },
  night: { bg: '#0B0B0D', fill: '#0B0B0D', ink: '#F4F1EB', dim: '#A6A39C', num: '#FF7A2F', plate: '#1A1A18', line: '#2C2B28', line2: '#4A4843', led: '#FF6B1A', stars: true },
  orange: { bg: '#E96A26', fill: '#E96A26', ink: '#141414', dim: '#3F1C08', num: '#FFFFFF', plate: '#F8F7F3', line: '#C9561C', line2: '#A9470F', led: '#141414' },
};
const ST = LOOKS[argOf('--look') || 'night'] || LOOKS.night;

// ---------- NASA data ----------
const loadTrack = id => { const t = JSON.parse(fs.readFileSync(A + id + '/track.json')); t.cube = fs.readFileSync(A + id + '/cube.bin'); return t; };
const TEMP = loadTrack('temperature'), OCEAN = loadTrack('ocean'), LIGHT = loadTrack('lightning');
const N = 180 * 90, YEARS = TEMP.years, yIdx = (y, T = TEMP) => Math.max(0, T.years.indexOf(y));
const cellIdx = (lat, lon) => Math.max(0, Math.min(89, Math.floor((90 - lat) / 2))) * 180 + ((Math.floor((lon + 180) / 2) % 180) + 180) % 180;
const decode = (T, c) => (c ? T.min + (c - 1) / 254 * (T.max - T.min) : null);
const cellVal = (T, yi, lat, lon) => decode(T, T.cube[yi * N + cellIdx(lat, lon)]);
function boxMean(T, yi, lat, lon, r = 4) {
  let s = 0, w = 0;
  for (let la = lat - r + 1; la <= lat + r; la += 2) for (let lo = lon - r + 1; lo <= lon + r; lo += 2) {
    const v = decode(T, T.cube[yi * N + cellIdx(la, lo)]); if (v == null) continue;
    const k = Math.cos(la * Math.PI / 180); s += v * k; w += k;
  }
  return w ? s / w : null;
}
function globalMean(yi) {
  let s = 0, w = 0;
  for (let cy = 0; cy < 90; cy++) { const k = Math.cos((90 - (cy + 0.5) * 2) * Math.PI / 180); for (let cx = 0; cx < 180; cx++) { const v = decode(TEMP, TEMP.cube[yi * N + cy * 180 + cx]); if (v != null) { s += v * k; w += k; } } }
  return s / w;
}
const tOf = (T, v) => (v - T.min) / (T.max - T.min);
const stepOf = (T, v) => (v == null ? null : Math.round(Math.max(0, Math.min(1, tOf(T, v))) * 10));
const fmtT = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C`;
const means = YEARS.map((_, i) => globalMean(i));
const VALID = JSON.parse(fs.readFileSync(A + 'validation/temperature.json'));

// the tune: three places NASA measured in both 1880 and 2025 (none of them hits the map's ±2 °C color limit)
const TUNE = [
  { name: 'Sibu, Sarawak', short: 'Sibu', lat: 2.3, lon: 111.8 },
  { name: 'Delhi, India', short: 'Delhi', lat: 28.6, lon: 77.2 },
  { name: 'Perth, Australia', short: 'Perth', lat: -31.9, lon: 115.9 },
].map(p => ({ ...p, v1880: cellVal(TEMP, yIdx(1880), p.lat, p.lon), v2025: cellVal(TEMP, yIdx(2025), p.lat, p.lon) }));
const pairs = TUNE.map(p => [boxMean(TEMP, yIdx(1880), p.lat, p.lon, 4), boxMean(TEMP, yIdx(2025), p.lat, p.lon, 4)]).filter(([a, b]) => a != null && b != null);
const WARMER = pairs.reduce((s, [a, b]) => s + b - a, 0) / pairs.length; // same rule as the website's guide
const SIBU = TUNE[0];
// Ask the Earth: "Is Sibu warmer now than in 1960?" (same rule as the website: box mean, radius 3)
const ASK = { a: boxMean(TEMP, yIdx(1960), SIBU.lat, SIBU.lon, 3), b: boxMean(TEMP, yIdx(2025), SIBU.lat, SIBU.lon, 3) };
// three tracks at places near Borneo
const SEA = { name: 'South China Sea', lat: 6, lon: 112 }, oceanV = boxMean(OCEAN, 0, SEA.lat, SEA.lon, 4);
const lightV = boxMean(LIGHT, yIdx(2020, LIGHT), SIBU.lat, SIBU.lon, 4);
// NASA GISTEMP v4 monthly data (same files and rules as the website's src/monthly.js), for a moment with a month
const MMETA = JSON.parse(fs.readFileSync(A + 'temperature/monthly/meta.json')), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthBin = new Map(), monthYear = y => { if (!monthBin.has(y)) monthBin.set(y, fs.readFileSync(`${A}temperature/monthly/${y}.bin`)); return monthBin.get(y); };
const monthValue = (y, mo, lat, lon) => { const c = monthYear(y)[(mo - 1) * 16200 + cellIdx(lat, lon)]; return c ? MMETA.encoding.offset + (c - 1) * MMETA.encoding.step : null; };
function monthBoxMean(y, mo, lat, lon, r = 6) {
  let s = 0, w = 0;
  for (let la = lat - r + 1; la <= lat + r; la += 2) for (let lo = lon - r + 1; lo <= lon + r; lo += 2) {
    const v = monthValue(y, mo, Math.max(-89, Math.min(89, la)), lo); if (v == null) continue;
    const k = Math.cos(la * Math.PI / 180); s += v * k; w += k;
  }
  return w ? s / w : null;
}
const dateText = m => [m.month && m.day ? m.day : '', m.month ? MON[m.month - 1] : '', m.year].filter(Boolean).join(' '); // "15 Mar 2006"
// My Earth song, composed by the website's own composer; the birthday uses that month's NASA data (judges asked for dates)
const STORY = [{ year: 1950, name: 'Fuzhou', lat: 26.07, lon: 119.3 }, { year: 1970, name: 'Sibu', lat: 2.3, lon: 111.8 }, { year: 2006, month: 3, day: 15, name: 'Kuching', lat: 1.55, lon: 110.35 }];
const SONG = composeSong(STORY, {
  yearIndexOf: y => yIdx(y), tOf: v => tOf(TEMP, v),
  localMean: (yi, lat, lon, m) => (m.month ? monthBoxMean(m.year, m.month, lat, lon, 6) : boxMean(TEMP, yi, lat, lon, 6)),
  valueAt: (yi, lat, lon, m) => (m.month ? monthValue(m.year, m.month, lat, lon) ?? monthBoxMean(m.year, m.month, lat, lon, 4) : cellVal(TEMP, yi, lat, lon) ?? boxMean(TEMP, yi, lat, lon, 4)),
});

// ---------- textures ----------
const texCache = new Map();
async function texture(id, y) {
  const key = id + y; if (texCache.has(key)) return texCache.get(key);
  const img = await loadImage(`${A}${id}/frames/${y}.jpg`);
  const c = createCanvas(720, 360), cg = c.getContext('2d'); cg.drawImage(img, 0, 0, 720, 360);
  const t = { data: cg.getImageData(0, 0, 720, 360).data, img }; texCache.set(key, t); return t;
}
const AIRGLOW = await loadImage(A + 'background/airglow.jpg');

// ---------- drawing helpers ----------
const cv = createCanvas(W, H), g = cv.getContext('2d');
const clamp01 = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const out3 = x => 1 - Math.pow(1 - clamp01(x), 3);
const D2R = Math.PI / 180;
function rrect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function box(x, y, w, h, r, fill, stroke, lw = 2) { rrect(x, y, w, h, r); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } }
function text(s, x, y, size, color = K.ink, { weight = 400, align = 'left', font = SANS, alpha = 1 } = {}) {
  if (!s || alpha <= 0) return 0;
  g.save(); g.globalAlpha *= alpha; g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
  const w = g.measureText(s).width; g.restore(); return w;
}
const measure = (s, size, weight = 400, font = SANS) => { g.save(); g.font = `${weight} ${size}px ${font}`; const w = g.measureText(s).width; g.restore(); return w; };
function led(x, y, r = 7, color = K.orange) { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function grille(x, y, w, h, step = 13, r = 2.6, color = K.line2) { g.fillStyle = color; for (let yy = y + step / 2; yy < y + h; yy += step) for (let xx = x + step / 2; xx < x + w; xx += step) { g.beginPath(); g.arc(xx, yy, r, 0, Math.PI * 2); g.fill(); } }
// twinkling stars for the night look (decorative, drawn in screen space so the device moves in front of a still sky)
const STARS = (() => { let q = 11; const r = () => (q = (q * 16807) % 2147483647) / 2147483647; return Array.from({ length: 440 }, (_, i) => ({ x: r() * W, y: r() * H, rad: i < 22 ? 1.6 + r() * 0.9 : 0.55 + r() ** 3 * 1.5, a: i < 22 ? 0.9 : 0.22 + r() * 0.55, ph: r() * 6.283, sp: 0.5 + r() * 1.6, big: i < 22 })); })();
function stars(t, alpha) {
  if (!ST.stars || alpha <= 0) return;
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#FFFFFF'; g.strokeStyle = '#FFFFFF';
  for (const st of STARS) {
    const tw = 0.5 + 0.5 * Math.sin(t * st.sp * 2.4 + st.ph); g.globalAlpha = alpha * st.a * (0.35 + 0.65 * tw);
    g.beginPath(); g.arc(st.x, st.y, st.rad, 0, 6.283); g.fill();
    if (st.big && tw > 0.6) { const L = 4 + 9 * (tw - 0.6) / 0.4; g.lineWidth = 1; g.globalAlpha = alpha * 0.55 * tw; g.beginPath(); g.moveTo(st.x - L, st.y); g.lineTo(st.x + L, st.y); g.moveTo(st.x, st.y - L); g.lineTo(st.x, st.y + L); g.stroke(); }
  }
  g.restore();
}
const typed = (s, t0, cps, t) => s.slice(0, Math.max(0, Math.min(s.length, Math.floor((t - t0) * cps))));
function wrap(s, size, maxW, weight = 400) { const lines = ['']; for (const w of s.split(' ')) { const tryL = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w; if (measure(tryL, size, weight) > maxW && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = tryL; } return lines; }
function toneFor(v, T = TEMP) {
  if (v == null) return '#6F8299';
  const t = clamp01(tOf(T, v)), stops = [[0, [110, 166, 214]], [0.5, [233, 227, 214]], [0.75, [232, 131, 74]], [1, [196, 71, 31]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (t - a) / (b - a); return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`; }
  return 'rgb(196,71,31)';
}

// ---------- camera: the app is laid out on a 1920x1080 "device"; the camera moves over it ----------
const CAM = {
  hook: { s: 1.92, ax: 580, ay: 590, sx: 960, sy: 616 },
  side: { s: 0.6, ax: 960, ay: 540, sx: 1340, sy: 600 },
  full: { s: 0.84, ax: 960, ay: 540, sx: 960, sy: 602 },
  score: { s: 1.45, ax: 1480, ay: 640, sx: 1010, sy: 620 },
};
const CAMKEYS = [[0, CAM.hook], [2.9, CAM.hook], [3.7, CAM.side], [5.6, CAM.side], [6.25, CAM.full], [12.3, CAM.full], [13.0, CAM.score], [15.0, CAM.score], [15.6, CAM.full]];
function camAt(t) {
  if (t <= CAMKEYS[0][0]) return CAMKEYS[0][1];
  for (let i = 0; i < CAMKEYS.length - 1; i++) {
    const [t0, a] = CAMKEYS[i], [t1, b] = CAMKEYS[i + 1];
    if (t <= t1) { const k = a === b ? 0 : ease((t - t0) / (t1 - t0)); const m = (p, q) => p + (q - p) * k; return { s: m(a.s, b.s), ax: m(a.ax, b.ax), ay: m(a.ay, b.ay), sx: m(a.sx, b.sx), sy: m(a.sy, b.sy) }; }
  }
  return CAMKEYS[CAMKEYS.length - 1][1];
}
let cam = CAM.full;
const applyCam = () => g.setTransform(cam.s, 0, 0, cam.s, cam.sx - cam.ax * cam.s, cam.sy - cam.ay * cam.s);
const toScreen = (x, y) => [cam.sx + (x - cam.ax) * cam.s, cam.sy + (y - cam.ay) * cam.s];

// ---------- globe (orthographic, from an equirectangular NASA frame), drawn at screen resolution ----------
const globeBuf = new Map();
function basis(lat0, lon0) { const p = lat0 * D2R, l = lon0 * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l); return { out: [cp * cl, cp * sl, sp], east: [-sl, cl, 0], north: [-sp * cl, -sp * sl, cp] }; }
function project(lat, lon, v) {
  const b = basis(v.lat0, v.lon0), p = lat * D2R, l = lon * D2R, w = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)], d = u => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  return { x: v.cx + d(b.east) * v.R, y: v.cy - d(b.north) * v.R, visible: d(b.out) > 0 };
}
function drawGlobe(tex, v) { // v in app coordinates
  const [cx, cy] = toScreen(v.cx, v.cy), R = v.R * cam.s, S = Math.ceil(R * 2);
  if (!globeBuf.has(S)) { const c = createCanvas(S, S); globeBuf.set(S, { c, ctx: c.getContext('2d'), img: c.getContext('2d').createImageData(S, S) }); }
  const { c, ctx, img } = globeBuf.get(S), o = img.data, td = tex.data, b = basis(v.lat0, v.lon0);
  o.fill(0);
  const L = [-0.45, 0.55, 0.7], ln = Math.hypot(...L); L.forEach((q, i) => { L[i] = q / ln; });
  for (let py = 0; py < S; py++) {
    const Y = (R - py - 0.5) / R; if (Y > 1 || Y < -1) continue;
    for (let px = 0; px < S; px++) {
      const X = (px + 0.5 - R) / R, r2 = X * X + Y * Y; if (r2 > 1) continue;
      const Z = Math.sqrt(1 - r2);
      const wx = X * b.east[0] + Y * b.north[0] + Z * b.out[0], wy = X * b.east[1] + Y * b.north[1] + Z * b.out[1], wz = X * b.east[2] + Y * b.north[2] + Z * b.out[2];
      let tx = Math.floor((Math.atan2(wy, wx) + Math.PI) / (2 * Math.PI) * 720); if (tx >= 720) tx -= 720;
      const ty = Math.min(359, Math.floor((Math.PI / 2 - Math.asin(wz)) / Math.PI * 360));
      const ti = (ty * 720 + tx) * 4, oi = (py * S + px) * 4, light = 0.72 + 0.28 * Math.max(0, X * L[0] + Y * L[1] + Z * L[2]);
      o[oi] = td[ti] * light; o[oi + 1] = td[ti + 1] * light; o[oi + 2] = td[ti + 2] * light; o[oi + 3] = r2 > 0.96 ? 255 * (1 - r2) / 0.04 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  const atm = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.1); atm.addColorStop(0, 'rgba(140,194,238,0.35)'); atm.addColorStop(1, 'rgba(140,194,238,0)');
  g.fillStyle = atm; g.beginPath(); g.arc(cx, cy, R * 1.1, 0, Math.PI * 2); g.fill();
  g.drawImage(c, cx - R, cy - R); g.restore();
}
function ripple(x, y, k) { g.save(); g.strokeStyle = `rgba(255,255,255,${0.95 * (1 - k)})`; g.lineWidth = 5 * (1 - k) + 1.5; g.beginPath(); g.arc(x, y, 16 + k * 110, 0, Math.PI * 2); g.stroke(); g.restore(); }
function marker(x, y) { g.save(); g.lineWidth = 7; g.strokeStyle = '#0A0F18'; g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke(); g.lineWidth = 3.5; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.restore(); }

// ---------- SSB Sibu tester clip (optional) ----------
// Real camera footage of an adult tester, used only with recorded consent. It replaces the family-story section.
// Keep the clip and its JSON in video/out/ (gitignored), so no tester's face, voice or name is committed. JSON fields:
//   clip (path, relative to the JSON), start (s, default 0), len (s, 3–4 is best; longer is cut at 4),
//   quote (English subtitle: the tester's own words, translated if needed), lang (e.g. "Malay", if translated),
//   who (attribution the tester agreed to, e.g. "Tester, Sarawak Society for the Blind, Sibu"),
//   stat (optional, from the record sheet, e.g. ["4 of 5", "found the warmer place by ear"]), statNote (optional),
//   adult: true and consent: true (both required: no one under 18, and the tester agreed to appear in the video)
const SSB = (() => {
  const file = argOf('--ssb'); if (!file) return null;
  const cfg = JSON.parse(fs.readFileSync(path.resolve(file)));
  if (cfg.adult !== true || cfg.consent !== true) throw new Error('ssb.json: set "adult": true and "consent": true only after checking both on the consent sheet');
  const dir = path.join(HERE, 'out/ssb_frames'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const src = path.resolve(path.dirname(path.resolve(file)), cfg.clip), len = Math.min(4, cfg.len ?? 4), ss = String(cfg.start ?? 0);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', ss, '-t', String(len), '-i', src, '-vf', 'fps=30,scale=1280:1280:force_original_aspect_ratio=decrease', '-q:v', '3', path.join(dir, '%04d.jpg')]);
  let voice = null;
  try { const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', ss, '-t', String(len), '-i', src, '-vn', '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }); voice = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4); } catch { voice = null; }
  const frames = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
  if (!frames) throw new Error('ssb: no frames read from ' + src);
  return { ...cfg, dir, frames, dur: Math.max(3, Math.min(4, frames / FPS)), voice };
})();

// ---------- timeline of what is on the device ----------
const T_TAP = [6.6, 7.7, 8.8], T_1880 = [10.95, 11.45, 11.95], T_2025 = [12.95, 13.45, 13.95], T_DONE = 14.35;
const T_OCEAN = 15.95, T_LIGHT = 16.95, T_TEMP = 17.95, T_TAB_ASK = 18.75, T_ASKBTN = 20.0, T_ANS_A = 20.2, T_ANS_B = 20.75, T_TAB_SONG = 22.3, T_SONGBTN = 23.35, T_SONG0 = 23.55, SEC = 0.75;
const T_CLIP = T_TAB_SONG; // the SSB clip takes the family-story slot
const T_VALID = SSB ? T_CLIP + SSB.dur : 25.9, T_END = SSB ? T_VALID + (30 - T_VALID) * 0.57 : 28.25;
const DEV_END = SSB ? T_CLIP : T_VALID; // when the device leaves the screen
function yearOnGlobe(t) {
  if (t < 0.6) return 1880;
  if (t < 2.9) return YEARS[Math.round(ease((t - 0.6) / 2.3) * (YEARS.length - 1))];
  if (t >= 10.65 && t < 12.65) return 1880;
  if (t >= T_ANS_A && t < T_ANS_B) return 1960;
  if (!SSB && t >= T_SONG0 - 0.2 && t < T_VALID) return STORY[Math.max(0, Math.min(2, Math.floor((t - T_SONG0) / SEC)))].year;
  return 2025;
}
function trackAt(t) { return t >= T_OCEAN && t < T_LIGHT ? 'ocean' : t >= T_LIGHT && t < T_TEMP ? 'lightning' : 'temperature'; }
function modeAt(t) { return t >= T_TAB_SONG && !SSB ? 'song' : t >= T_TAB_ASK ? 'ask' : 'play'; }
function globeView(t) {
  let lat0 = 15, lon0 = 72 + Math.min(t, 3) * 6, R = 205;
  if (t > 2.9) { const k = ease((t - 2.9) / 0.9); R = 205 + 175 * k; }
  if (t > 3.0) { const k = ease((t - 3.0) / 2.2); lat0 = 15 - 10 * k; lon0 = 90 + 10 * k; }
  if (t > T_TAB_ASK) { const k = ease((t - T_TAB_ASK) / 0.8); lat0 += (SIBU.lat + 8 - lat0) * k; lon0 += (SIBU.lon - lon0) * k; }
  if (!SSB && t > T_SONG0 - 0.3) { const k = ease((t - T_SONG0 + 0.3) / 0.8); lat0 += (13 - lat0) * k; lon0 += (115 - lon0) * k; }
  return { cx: 580, cy: 590, R, lat0, lon0 };
}
// cursor waypoints (app coordinates), clicked at their time
const TABS = ['Play', 'My Earth song', 'Ask the Earth', 'Use any NASA map'];
const tabRects = (() => { let x = 1846; const out = []; for (let i = TABS.length - 1; i >= 0; i--) { const w = measure(TABS[i], 24, 500) + 64; x -= w; out[i] = { x, w }; x -= 6; } return out; })();
const KEYS = [{ id: 'temperature', num: '01', name: 'Temperature', inst: 'marimba', y: 2025 }, { id: 'ocean', num: '02', name: 'Ocean', inst: 'harp', y: 2007 }, { id: 'lightning', num: '03', name: 'Lightning', inst: 'drums', y: 2020 }];
const keyX = i => 1120 + i * 244;
const at = (lat, lon, t) => { const p = project(lat, lon, globeView(t)); return [p.x, p.y]; };
const WAY = [
  [5.9, [760, 980], false], ...TUNE.map((p, i) => [T_TAP[i], at(p.lat, p.lon, T_TAP[i]), true]),
  [10.65, [1300, 990], true], [12.65, [1300, 990], true],
  [T_OCEAN, [keyX(1) + 116, 190], true], [T_LIGHT, [keyX(2) + 116, 190], true], [T_TEMP, [keyX(0) + 116, 190], true],
  [T_TAB_ASK, [tabRects[2].x + tabRects[2].w / 2, 74], true], [T_ASKBTN, [1772, 262], true],
  ...(SSB ? [[DEV_END - 0.3, [1790, 300], false]] : [[T_TAB_SONG, [tabRects[1].x + tabRects[1].w / 2, 74], true], [T_SONGBTN, [1300, 395], true], [T_VALID - 0.3, [1250, 560], false]]),
];
function cursorAt(t) {
  if (t < WAY[0][0] - 0.2 || t > DEV_END - 0.3) return null;
  let i = 0; while (i < WAY.length - 1 && t > WAY[i + 1][0]) i++;
  const [t0, p0] = WAY[i], [t1, p1, click1] = WAY[Math.min(i + 1, WAY.length - 1)];
  const dur = Math.min(0.75, 0.8 * (t1 - t0)), k = t1 === t0 ? 1 : ease((t - (t1 - dur)) / Math.max(0.01, dur)); // rest, then move just before the click
  const last = WAY.reduce((best, w) => (w[2] && w[0] <= t && t - w[0] < 0.5 ? w : best), null);
  return { x: p0[0] + (p1[0] - p0[0]) * k, y: p0[1] + (p1[1] - p0[1]) * k, down: last && t - last[0] < 0.12, ring: last ? (t - last[0]) / 0.5 : -1 };
}
const pressed = (t, t0) => t >= t0 && t < t0 + 0.14;

// ---------- the device ----------
const scoreBuf = new Map();
function scoreLCD(x, y, w, h, { title, legend = [], view, axis, note, alpha = 1 }) {
  g.save(); g.globalAlpha *= alpha;
  box(x, y, w, h, 18, K.key); box(x + 8, y + 8, w - 16, h - 16, 12, K.lcd);
  text(title, x + 30, y + 40, 22, K.lDim, { font: MONO });
  let lx = x + w - 30;
  for (let i = legend.length - 1; i >= 0; i--) { const [name, color] = legend[i]; const tw = measure(name, 22, 400, MONO); text(name, lx, y + 40, 22, K.lDim, { font: MONO, align: 'right' }); lx -= tw + 12; g.fillStyle = color; g.fillRect(lx - 14, y + 33, 14, 14); lx -= 34; }
  const rx = x + 26, ry = y + 64, rw = w - 52, rh = h - 64 - (note ? 70 : 22), f = 1.85, lw = rw / f, lh = rh / f, pr = 2;
  const key = `${rw}x${rh}`; if (!scoreBuf.has(key)) scoreBuf.set(key, createCanvas(Math.round(rw * pr), Math.round(rh * pr)));
  const off = scoreBuf.get(key), og = off.getContext('2d'); og.setTransform(f * pr, 0, 0, f * pr, 0, 0);
  drawScore(og, lw, lh, view, axis, MONO);
  g.drawImage(off, rx, ry, rw, rh);
  if (note) text(note, x + 30, y + h - 44, 30, K.lInk, { weight: 500 });
  g.restore();
}
function nowLCD(x, y, w, h, place, words, detail, tone, alpha = 1) {
  g.save(); g.globalAlpha *= alpha;
  box(x, y, w, h, 18, K.key); box(x + 8, y + 8, w - 16, h - 16, 12, K.lcd);
  led(x + 38, y + 44, 8, tone); text(place, x + 58, y + 44, 22, K.lDim, { font: MONO });
  text(words, x + 30, y + 100, 46, K.lInk, { weight: 500 });
  text(detail, x + 30, y + 148, 22, K.lDim, { font: MONO });
  g.restore();
}
function plate(x, y, w, h, alpha = 1) { g.save(); g.globalAlpha *= alpha; box(x, y, w, h, 16, K.plate, K.line, 2); g.restore(); }
function keyBtn(x, y, w, h, label, { primary = false, down = false, size = 24 } = {}) {
  const dy = down ? 2 : 0;
  if (!down) box(x, y + 3, w, h, 10, primary ? '#B9531B' : '#B7B2A8');
  box(x, y + dy, w, h, 10, primary ? K.orange : K.key);
  text(label, x + w / 2, y + dy + h / 2, size, K.ink, { weight: 500, align: 'center' });
}

async function drawDevice(t) {
  const mode = modeAt(t), track = trackAt(t);
  // body
  box(30, 20, 1860, 1040, 40, K.body, K.line2, 2);
  // header: brand, grille, function keys with an LED on the active one
  led(88, 66, 8); text('Earth Jukebox', 108, 66, 34, K.ink, { weight: 500 });
  text('NASA Earth data, played as sound', 108, 100, 18, K.gray, { font: MONO });
  const tabStart = tabRects[0].x - 10; box(tabStart, 40, 1856 - tabStart, 68, 14, K.key);
  grille(520, 46, tabStart - 560, 56);
  const activeTab = mode === 'ask' ? 2 : mode === 'song' ? 1 : 0;
  TABS.forEach((name, i) => {
    const r = tabRects[i], on = i === activeTab;
    if (on) box(r.x, 46, r.w, 56, 10, K.paper);
    led(r.x + 24, 74, 6, on ? K.orange : K.line2);
    text(name, r.x + 40, 74, 24, on ? K.ink : K.gray, { weight: 500 });
  });
  // screen with the NASA globe over NASA's night-horizon photo
  g.save(); rrect(80, 130, 1000, 900, 24); g.clip();
  g.fillStyle = K.screen; g.fillRect(80, 130, 1000, 900);
  g.globalAlpha = 0.55; g.drawImage(AIRGLOW, 80, 690, 1000, 340); g.globalAlpha = 1;
  const fade = g.createLinearGradient(0, 690, 0, 880); fade.addColorStop(0, K.screen); fade.addColorStop(1, 'rgba(23,23,22,0)'); g.fillStyle = fade; g.fillRect(80, 690, 1000, 200);
  stars(t, 1 - ease((t - 2.9) / 0.8)); // the opening's sky; the stage's own stars take over as the camera pulls back
  const v = globeView(t), y = yearOnGlobe(t);
  const tex = track === 'ocean' ? await texture('ocean', 2007) : track === 'lightning' ? await texture('lightning', 2020) : await texture('temperature', y);
  drawGlobe(tex, v);
  // taps on the globe
  const taps = [...TUNE.map((p, i) => [T_TAP[i], p]), ...TUNE.map((p, i) => [T_1880[i], p]), ...TUNE.map((p, i) => [T_2025[i], p]),
    [T_OCEAN + 0.25, SEA], [T_LIGHT + 0.25, SIBU], [T_TEMP + 0.25, SIBU], [T_ANS_A, SIBU], [T_ANS_B, SIBU],
    ...(SSB ? [] : SONG.sections.map((s, k) => [T_SONG0 + k * SEC, s.moment]))];
  let mk = null;
  for (const [t0, p] of taps) { if (t < t0) continue; const q = project(p.lat, p.lon, v); if (!q.visible) continue; mk = q; const k = (t - t0) / 0.9; if (k < 1) ripple(q.x, q.y, k); }
  if (mk && t > T_TAP[0]) marker(mk.x, mk.y);
  text(String(y), 120, 196, 66, K.sInk, { font: MONO, weight: 500, alpha: track === 'temperature' ? 1 : 0 });
  if (track !== 'temperature') text(track === 'ocean' ? '19 Jun 2007' : '2017–2023', 120, 196, 40, K.sInk, { font: MONO });
  if (t > 5.6 && t < T_TAP[0]) { const hw = measure('Tap, or draw a line, to play.', 22, 400, MONO) + 36; box(580 - hw / 2, 880, hw, 48, 8, 'rgba(23,23,22,0.85)', 'rgba(230,227,221,0.25)'); text('Tap, or draw a line, to play.', 580, 904, 22, K.sInk, { font: MONO, align: 'center' }); }
  g.restore();
  // timeline bar pinned to the bottom of the screen (as on the website)
  if (mode === 'play') {
    box(100, 950, 960, 64, 14, K.plate, K.line2, 2);
    keyBtn(112, 959, 250, 46, 'Play 1880 → 2025', { primary: true, size: 22 });
    g.fillStyle = K.line2; g.fillRect(390, 980, 520, 5);
    const yk = (y - 1880) / 145; g.fillStyle = K.ink; g.beginPath(); g.arc(390 + 520 * yk, 982, 13, 0, Math.PI * 2); g.fill();
    box(940, 962, 104, 40, 8, K.lcd); text(String(y), 992, 982, 24, K.lInk, { font: MONO, weight: 500, align: 'center' });
  }

  // right column
  const RX = 1120, RW = 720;
  if (mode === 'play') {
    KEYS.forEach((k, i) => {
      const on = k.id === track, x = keyX(i), down = pressed(t, [T_TEMP, T_OCEAN, T_LIGHT][i]);
      if (!down) box(x, 133, 232, 118, 12, on ? '#B9531B' : '#B7B2A8');
      box(x, 130 + (down ? 3 : 0), 232, 118, 12, on ? K.orange : K.key);
      const yy = 130 + (down ? 3 : 0);
      text(k.num, x + 18, yy + 26, 18, on ? '#3A1806' : K.gray, { font: MONO });
      g.save(); rrect(x + 150, yy + 14, 66, 38, 4); g.clip(); g.drawImage(texCache.get(k.id + k.y)?.img || AIRGLOW, x + 150, yy + 14, 66, 38); g.restore();
      text(k.name, x + 18, yy + 76, 27, K.ink, { weight: 500 });
      text(k.inst, x + 18, yy + 100, 18, on ? '#3A1806' : K.gray, { font: MONO });
    });
    // now hearing
    let now = null;
    const tapI = T_TAP.filter(x => t >= x).length;
    if (tapI) now = TUNE[tapI - 1];
    if (t >= T_1880[0]) { const i = Math.max(0, (t >= T_2025[0] ? T_2025 : T_1880).filter(x => t >= x).length - 1); now = TUNE[i]; }
    let place = '', words = '', detail = '', tone = K.orange, show = now != null;
    if (now) {
      const val = t >= T_1880[0] && t < 12.65 ? now.v1880 : now.v2025;
      place = now.name; words = val == null ? 'No data' : KINDS.temperature.words(val); detail = val == null ? 'NASA has no measurement here' : `${fmtT(val)} compared with normal`; tone = toneFor(val);
    }
    if (t >= T_OCEAN + 0.25 && t < T_LIGHT + 0.25) { place = SEA.name; words = KINDS.ocean.words(oceanV); detail = `Sea surface ${oceanV.toFixed(0)} °C`; tone = toneFor(oceanV, OCEAN); }
    if (t >= T_LIGHT + 0.25 && t < T_TEMP + 0.25) { place = SIBU.name; words = KINDS.lightning.words(lightV); detail = KINDS.lightning.detail(lightV); tone = toneFor(lightV, LIGHT); }
    nowLCD(RX, 275, RW, 182, place, words, detail, tone, show ? out3((t - T_TAP[0]) / 0.3) : 0);
    // score display
    let view = null, title = 'What you hear', legend = [], note = '', axis = { high: 'hotter', mid: 'normal', low: 'colder' };
    if (t >= T_TAP[0]) view = { type: 'live', notes: TUNE.slice(0, tapI).map(p => ({ step: stepOf(TEMP, p.v2025), label: p.short })) };
    if (t >= T_1880[0]) {
      const n1 = T_1880.filter(x => t >= x).length, n2 = T_2025.filter(x => t >= x).length;
      const take1 = { name: '1880', length: 3, notes: TUNE.slice(0, n1).map(p => ({ step: stepOf(TEMP, p.v1880), label: p.short })) };
      const take2 = { name: '2025', length: 3, notes: TUNE.slice(0, n2).map(p => ({ step: stepOf(TEMP, p.v2025), label: p.short })) };
      view = { type: 'takes', takes: n2 ? [take1, take2] : [take1] };
      title = n2 ? 'Same tune, two years' : 'Your tune'; legend = n2 ? [['1880', '#8A9A86'], ['2025', K.orange]] : [['1880', K.orange]];
      if (t >= T_DONE) note = `Your places: about ${WARMER.toFixed(1)} °C warmer than in 1880`;
    }
    if (t >= T_OCEAN) {
      const extra = []; // switching track clears the score display, as on the website
      if (track === 'ocean' && t >= T_OCEAN + 0.25) extra.push({ step: stepOf(OCEAN, oceanV), label: SEA.name });
      if (track === 'lightning' && t >= T_LIGHT + 0.25) extra.push({ step: stepOf(LIGHT, lightV), label: 'Sibu' });
      if (track === 'temperature' && t >= T_TEMP + 0.25) extra.push({ step: stepOf(TEMP, SIBU.v2025), label: 'Sibu' });
      view = { type: 'live', notes: extra }; title = 'What you hear'; legend = []; note = '';
      axis = track === 'ocean' ? { high: 'warm', low: 'cold' } : track === 'lightning' ? { high: 'more', low: 'less' } : axis;
    }
    scoreLCD(RX, 482, RW, 322, { title, legend, view, axis, note, alpha: t >= T_TAP[0] ? out3((t - T_TAP[0]) / 0.3) : 0 });
    // guide
    plate(RX, 828, RW, 202);
    let step = 'Step 1 of 3', gt = 'Tap the Earth, or draw a line on it', btn = null;
    if (t >= T_TAP[0]) gt = T_TAP.filter(x => t >= x).length === 1 ? 'Nice! Tap 2 more places' : 'Tap 1 more place';
    if (t >= T_TAP[2] + 0.4) { step = 'Step 2 of 3'; gt = 'Now go back in time'; btn = 'Play my tune in 1880'; }
    if (t >= 10.65) gt = 'Playing your tune in 1880…', btn = 'Play my tune in 1880';
    if (t >= 12.2) { step = 'Step 3 of 3'; gt = 'Now hear it today'; btn = 'Play my tune in 2025'; }
    if (t >= 12.65) gt = 'Playing your tune in 2025…';
    if (t >= T_DONE) { step = 'You did it'; gt = 'Did you hear it go higher?'; btn = null; }
    if (t >= T_OCEAN - 0.4) { step = 'Ocean, 2007'; gt = 'Tap or draw across the ocean'; btn = null; }
    if (t >= T_LIGHT) { step = 'Lightning, 2017–2023'; gt = 'Tap or draw anywhere'; }
    if (t >= T_TEMP) { step = 'Temperature, 1880–2025'; gt = 'Tap or draw on the Earth'; }
    led(RX + 32, 866, 6); text(step, RX + 50, 866, 20, K.gray, { font: MONO });
    text(gt, RX + 30, 912, 36, K.ink, { weight: 500 });
    if (btn) keyBtn(RX + 30, 950, 330, 58, btn, { primary: true, down: pressed(t, 10.65) || pressed(t, 12.65) });
  } else if (mode === 'ask') {
    plate(RX, 130, RW, 210);
    text('Ask the Earth', RX + 30, 172, 34, K.ink, { weight: 500 });
    box(RX + 26, 222, RW - 52, 80, 12, K.paper, K.line2, 2);
    const q = 'Is Sibu warmer now than in 1960?', qt = typed(q, T_TAB_ASK + 0.3, 40, t);
    text(qt, RX + 48, 262, 28, K.ink);
    if (t < T_ASKBTN && Math.floor(t * 2.4) % 2 === 0) { g.fillStyle = K.ink; g.fillRect(RX + 50 + measure(qt, 28), 244, 3, 36); }
    keyBtn(RX + RW - 140, 232, 100, 60, 'Ask', { primary: true, down: pressed(t, T_ASKBTN) });
    const ans = t >= T_ANS_B + 0.3, thinking = t >= T_ASKBTN && !ans;
    g.save(); g.globalAlpha = t >= T_ASKBTN ? out3((t - T_ASKBTN) / 0.3) : 0;
    box(RX, 362, RW, 190, 18, K.key); box(RX + 8, 370, RW - 16, 174, 12, K.lcd);
    if (thinking) text(t < T_ANS_A ? 'Reading your question…' : 'Playing the answer…', RX + 30, 456, 30, K.lInk, { weight: 500 });
    if (ans) {
      const lines = [`Sibu, 1960: ${KINDS.temperature.words(ASK.a).toLowerCase()} (${fmtT(ASK.a)})`, `Sibu, 2025: ${KINDS.temperature.words(ASK.b).toLowerCase()} (${fmtT(ASK.b)})`];
      lines.forEach((ln, i) => text(ln, RX + 30, 428 + i * 60, 34, K.lInk, { weight: 500, alpha: out3((t - T_ANS_B - 0.3 - i * 0.12) / 0.3) }));
    }
    g.restore();
    const n = [T_ANS_A, T_ANS_B].filter(x => t >= x).length;
    const view = n ? { type: 'takes', takes: [{ name: '1960', length: 1, notes: [{ step: stepOf(TEMP, ASK.a), label: 'Sibu' }] }, ...(n > 1 ? [{ name: '2025', length: 1, notes: [{ step: stepOf(TEMP, ASK.b), label: 'Sibu' }] }] : [])] } : null;
    scoreLCD(RX, 574, RW, 320, { title: 'One place, two years', legend: n > 1 ? [['1960', '#8A9A86'], ['2025', K.orange]] : [['1960', K.orange]], view, axis: { high: 'hotter', mid: 'normal', low: 'colder' }, note: ans ? `${Math.abs(ASK.b - ASK.a).toFixed(1)} °C warmer in 2025 than in 1960` : '', alpha: n ? 1 : 0.0001 });
    text('AI only reads your question.', RX + 4, 940, 26, K.gray);
    text('Every number comes from NASA data.', RX + 4, 978, 26, K.gray);
  } else {
    plate(RX, 130, RW, 300);
    text('My Earth song', RX + 30, 172, 34, K.ink, { weight: 500 });
    text('Tell your story, in any language', RX + 30, 214, 22, K.gray, { font: MONO });
    box(RX + 26, 236, RW - 52, 118, 12, K.paper, K.line2, 2);
    const story = 'Grandpa was born in Fuzhou in 1950. He moved to Sibu in 1970. I was born in Kuching on 15 March 2006.';
    wrap(typed(story, T_TAB_SONG + 0.15, 125, t), 25, RW - 100).slice(0, 3).forEach((ln, i) => text(ln, RX + 46, 268 + i * 34, 25, K.ink));
    keyBtn(RX + 30, 368, 300, 48, 'Make my song from this', { primary: true, size: 21, down: pressed(t, T_SONGBTN) });
    const playing = t >= T_SONG0, hits = new Set(); let section = -1;
    SONG.sections.forEach((s, k) => s.notes.forEach((nn, i) => { if (t >= T_SONG0 + k * SEC + nn.beat / 8 * SEC) { hits.add(`${k}:${i}`); section = k; } }));
    const view = playing ? { type: 'song', sections: SONG.sections.map(s => ({ label: dateText(s.moment), notes: s.notes.map(nn => nn.step) })), hits, section } : null;
    scoreLCD(RX, 452, RW, 320, { title: 'Your Earth song', view, axis: { high: 'hotter', mid: 'normal', low: 'colder' }, alpha: playing ? out3((t - T_SONG0 + 0.2) / 0.3) : 0.0001 });
    SONG.sections.forEach((s, k) => { // the moments appear once the story has been read (after the button)
      const yy = 794 + k * 78, on = section === k; g.save(); g.globalAlpha *= out3((t - T_SONGBTN - 0.05 - k * 0.06) / 0.3);
      box(RX, yy, RW, 66, 12, K.body, on ? K.orange : K.line, on ? 3 : 2);
      text(dateText(s.moment), RX + 24, yy + 33, 28, K.ink, { weight: 500, font: MONO });
      text(s.moment.name, RX + 250, yy + 33, 28, K.ink, { weight: 500 });
      text(s.mean == null ? 'No data' : KINDS.temperature.words(s.mean), RX + RW - 24, yy + 33, 22, K.gray, { align: 'right' }); g.restore();
    });
  }
  // cursor
  const c = cursorAt(t);
  if (c) {
    if (c.ring >= 0 && c.ring < 1) { g.save(); g.strokeStyle = `rgba(233,106,38,${1 - c.ring})`; g.lineWidth = 4; g.beginPath(); g.arc(c.x, c.y, 10 + c.ring * 40, 0, Math.PI * 2); g.stroke(); g.restore(); }
    g.save(); g.translate(c.x, c.y); g.scale(c.down ? 0.85 : 1, c.down ? 0.85 : 1);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 44); g.lineTo(11, 33); g.lineTo(19, 51); g.lineTo(27, 47); g.lineTo(19, 30); g.lineTo(34, 30); g.closePath();
    g.fillStyle = K.ink; g.fill(); g.strokeStyle = '#FFFFFF'; g.lineWidth = 3; g.stroke(); g.restore();
  }
}

// ---------- scenes drawn in screen space ----------
const HEADLINES = [
  [6.05, 10.3, 'Tap the Earth. Warmer places play higher notes.'],
  [10.4, 15.4, 'Same tune in 1880, then 2025. Hear the warming. See it.'],
  [15.6, 18.65, 'Three NASA Earth Information Center maps. Three instruments.'],
  [18.75, 22.25, 'Ask in any language. Every number comes from NASA.'],
  ...(SSB ? [] : [[22.3, 25.9, 'Your story becomes a song from NASA data, down to the month.']]),
];
function headlineText(s, al) {
  const w = measure(s, 46, 500);
  g.save(); g.globalAlpha *= al; led(W / 2 - w / 2 - 26, 82, 9, ST.led); g.restore();
  text(s, W / 2, 82, 46, ST.ink, { weight: 500, align: 'center', alpha: al });
}
function headline(t) {
  for (const [a, b, s] of HEADLINES) {
    const al = ease((t - a) / 0.3) * (1 - ease((t - (b - 0.25)) / 0.25)); if (al > 0) headlineText(s, al);
  }
}
function speaker(x, y, s, color) { // loudspeaker icon, centred on (x, y)
  g.save(); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = s * 0.1; g.lineCap = 'round'; x -= s * 0.45;
  g.beginPath(); g.moveTo(x, y - s * 0.18); g.lineTo(x + s * 0.2, y - s * 0.18); g.lineTo(x + s * 0.45, y - s * 0.42); g.lineTo(x + s * 0.45, y + s * 0.42); g.lineTo(x + s * 0.2, y + s * 0.18); g.lineTo(x, y + s * 0.18); g.closePath(); g.fill();
  for (const r of [0.22, 0.42]) { g.beginPath(); g.arc(x + s * 0.5, y, s * r, -0.85, 0.85); g.stroke(); }
  g.restore();
}
function hookOverlay(t) {
  const a = 1 - ease((t - 2.85) / 0.35); if (a <= 0) return;
  // who we are and which challenge (official demo template: team first), and a sound cue for anyone watching muted
  text('Team Happy Squad · Sibu, Sarawak', 60, 42, 22, K.sDim, { font: MONO, alpha: a });
  text('NASA Space Apps 2026 · The Earth Information Jukebox', W - 60, 42, 22, K.sDim, { font: MONO, align: 'right', alpha: a });
  { const s = 'Sound on', sw = measure(s, 26, 500, MONO) + 92, x0 = W / 2 - sw / 2, al = a * ease(t / 0.25);
    g.save(); g.globalAlpha *= al; box(x0, 966, sw, 56, 28, 'rgba(23,23,22,0.7)', 'rgba(230,227,221,0.35)', 2); speaker(x0 + 36, 994, 30, K.orange); g.restore();
    text(s, x0 + 66, 995, 26, K.sInk, { font: MONO, weight: 500, alpha: al }); }
  const q = 'What does climate change sound like?', qt = typed(q, 0.05, 44, t);
  const w = measure(q, 76, 500);
  text(qt, W / 2 - w / 2, 120, 76, K.sInk, { weight: 500, alpha: a });
  if (t < 1.0 && Math.floor(t * 2.6) % 2 === 0) { g.fillStyle = K.sInk; g.fillRect(W / 2 - w / 2 + measure(qt, 76, 500) + 6, 82, 5, 76); }
  const y = yearOnGlobe(t), yi = yIdx(y), al = a * ease((t - 0.45) / 0.3);
  text(String(y), 1480, 560, 150, K.orange, { weight: 500, font: MONO, alpha: al });
  text('year', 1484, 660, 26, K.sDim, { font: MONO, alpha: al });
  text('World average', 150, 520, 28, K.sDim, { font: MONO, alpha: al });
  text(fmtT(means[yi]), 150, 590, 84, K.sInk, { weight: 500, font: MONO, alpha: al });
  text('compared with 1951–1980', 150, 660, 24, K.sDim, { font: MONO, alpha: al });
}
function impactOverlay(t) {
  const a = ease((t - 3.45) / 0.3) * (1 - ease((t - 5.75) / 0.35)); if (a <= 0) return;
  const f = (t0) => a * out3((t - t0) / 0.35), dx = t0 => 30 * (1 - out3((t - t0) / 0.35));
  text('43 million', 110 + dx(3.5), 380, 150, ST.num, { weight: 500, alpha: f(3.5) });
  text('people are blind.', 116 + dx(3.65), 490, 64, ST.ink, { weight: 500, alpha: f(3.65) });
  text("NASA's Earth maps are", 116 + dx(4.2), 590, 40, ST.dim, { alpha: f(4.2) });
  text('made to be seen.', 116 + dx(4.2), 640, 40, ST.dim, { alpha: f(4.2) });
  g.save(); g.globalAlpha = f(4.8); led(126 + dx(4.8), 742, 9, ST.led); g.restore();
  text('Earth Jukebox makes', 150 + dx(4.8), 742, 44, ST.ink, { weight: 500, alpha: f(4.8) });
  text('them heard.', 150 + dx(4.8), 796, 44, ST.ink, { weight: 500, alpha: f(4.8) });
  text('Lancet Global Health, 2021', 116, 900, 20, ST.dim, { font: MONO, alpha: f(3.6) });
}
function validityScene(t, a) {
  g.save(); g.globalAlpha = a;
  g.fillStyle = ST.fill; g.fillRect(0, 0, W, H); stars(t, a);
  const f = t0 => out3((t - t0) / 0.35);
  led(122, 150, 9, ST.led); text('Checked against NASA’s own numbers', 144, 150, 30, ST.dim, { font: MONO });
  const V = T_VALID;
  text(`${VALID.global.mae.toFixed(2)} °C`, 110, 310, 170, ST.num, { weight: 500, alpha: f(V + 0.25) });
  text('average gap from NASA GISTEMP v4,', 116, 430, 38, ST.ink, { alpha: f(V + 0.4) });
  text('every year from 1880 to 2025', 116, 478, 38, ST.ink, { alpha: f(V + 0.4) });
  text(`Warming you hear: +${VALID.warming1880sTo2015s.ours.toFixed(2)} °C   NASA: +${VALID.warming1880sTo2015s.nasa.toFixed(2)} °C`, 116, 560, 28, ST.dim, { font: MONO, alpha: f(V + 0.55) });
  // chart
  const cx = 1010, cy = 150, cw = 800, ch = 440, yMin = -0.6, yMax = 1.4;
  box(cx, cy, cw, ch, 16, ST.plate, ST.line, 2);
  const X = yr => cx + 50 + (yr - 1880) / 145 * (cw - 80), Y = v => cy + 30 + (yMax - v) / (yMax - yMin) * (ch - 80);
  g.strokeStyle = ST.line2; g.lineWidth = 1.5; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(cx + 40, Y(0)); g.lineTo(cx + cw - 24, Y(0)); g.stroke(); g.setLineDash([]);
  text('normal', cx + cw - 30, Y(0) - 16, 18, ST.dim, { font: MONO, align: 'right' });
  [1880, 1950, 2025].forEach(yr => text(String(yr), X(yr), cy + ch - 26, 20, ST.dim, { font: MONO, align: 'center' }));
  const prog = clamp01((t - V - 0.3) / 1.2), last = 1880 + 145 * prog;
  for (const [key, color, lw] of [['nasa', ST.ink, 4], ['ours', K.orange, 2.6]]) {
    g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); let pen = false;
    for (const r of VALID.years) { if (r.year > last || r[key] == null) continue; const px = X(r.year), py = Y(r[key]); if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; } }
    g.stroke();
  }
  g.fillStyle = ST.ink; g.fillRect(cx + 50, cy + 44, 26, 5); text('NASA', cx + 86, cy + 47, 22, ST.ink, { font: MONO });
  g.fillStyle = K.orange; g.fillRect(cx + 190, cy + 44, 26, 5); text('Earth Jukebox', cx + 226, cy + 47, 22, ST.ink, { font: MONO });
  // made for everyone
  text('Made for everyone', 116, 720, 30, ST.dim, { font: MONO, alpha: f(V + 0.8) });
  const chips = ['Arrow keys', 'Screen reader', 'Voice guide', 'Score display', 'Any phone, no app'];
  let x = 110;
  chips.forEach((c, i) => { const w = measure(c, 30, 500) + 56, al = f(V + 0.9 + i * 0.1); g.save(); g.globalAlpha *= al; keyBtn(x, 760, w, 74, c, { size: 30 }); g.restore(); x += w + 18; });
  g.restore();
}
// the SSB tester clip: real footage, an English subtitle with the tester's own words, and the attribution they agreed to
const clipImg = { i: -1, img: null };
async function clipFrame(i) { if (clipImg.i !== i) { clipImg.img = await loadImage(path.join(SSB.dir, `${String(i + 1).padStart(4, '0')}.jpg`)); clipImg.i = i; } return clipImg.img; }
async function clipScene(t, a) {
  g.save(); g.globalAlpha = a;
  g.fillStyle = ST.bg; g.fillRect(0, 0, W, H); stars(t, a);
  headlineText(SSB.headline || 'Tested by blind and low-vision adults in Sibu.', 1);
  const img = await clipFrame(Math.max(0, Math.min(SSB.frames - 1, Math.floor((t - T_CLIP) * FPS))));
  const ar = img.width / img.height, MX = 110, MY = 178, MW = 1180, MH = 800;
  let pw = MW, ph = pw / ar; if (ph > MH) { ph = MH; pw = ph * ar; }
  const px = MX, py = MY, wide = pw >= 900, f = t0 => out3((t - T_CLIP - t0) / 0.35);
  box(px - 12, py - 12, pw + 24, ph + 24, 28, K.key);
  g.save(); rrect(px, py, pw, ph, 18); g.clip(); g.fillStyle = '#000'; g.fillRect(px, py, pw, ph); g.drawImage(img, px, py, pw, ph);
  if (wide && SSB.quote) { // subtitle burned onto the clip
    const lines = wrap(SSB.quote, 44, pw - 120, 500).slice(0, 2), bh = 30 + lines.length * 56;
    g.fillStyle = 'rgba(10,10,10,0.72)'; g.fillRect(px, py + ph - bh - 24, pw, bh);
    lines.forEach((ln, i) => text(ln, px + pw / 2, py + ph - bh - 24 + 43 + i * 56, 44, '#FFFFFF', { weight: 500, align: 'center', alpha: f(0.15) }));
  }
  g.restore();
  // right column: the quote (if the clip is narrow), the result from the record sheet, and who said it
  const RX = px + pw + 64, RW = W - 110 - RX; let y = MY + 20;
  if (!wide && SSB.quote) {
    const lines = wrap(`“${SSB.quote}”`, 56, RW, 500).slice(0, 4);
    lines.forEach((ln, i) => text(ln, RX, y + 30 + i * 70, 56, ST.ink, { weight: 500, alpha: f(0.15) })); y += lines.length * 70 + 60;
  }
  if (SSB.stat) {
    text(SSB.stat[0], RX - 4, y + 70, 120, ST.num, { weight: 500, alpha: f(0.3) });
    wrap(SSB.stat[1], 34, RW).slice(0, 3).forEach((ln, i) => text(ln, RX, y + 175 + i * 44, 34, ST.ink, { alpha: f(0.4) }));
    y += 175 + Math.min(3, wrap(SSB.stat[1], 34, RW).length) * 44 + 20;
    if (SSB.statNote) { wrap(SSB.statNote, 22, RW, 400).slice(0, 2).forEach((ln, i) => text(ln, RX, y + i * 30, 22, ST.dim, { font: MONO, alpha: f(0.4) })); y += 80; }
  }
  const credit = [SSB.who, SSB.lang ? `Subtitle translated from ${SSB.lang}` : ''].filter(Boolean);
  if (wide) credit.forEach((c, i) => text(c, px + 4, py + ph + 52 + i * 34, 24, ST.dim, { font: MONO, alpha: f(0.2) }));
  else credit.forEach((c, i) => wrap(c, 24, RW).forEach((ln, j) => text(ln, RX, Math.max(y, MY + ph - 70) + i * 40 + j * 32, 24, ST.dim, { font: MONO, alpha: f(0.2) })));
  g.restore();
}

const FUTURE = 'Next: every NASA Earth map, for everyone who can’t see it.';
function endScene(t, a) {
  g.save(); g.globalAlpha = a;
  g.fillStyle = ST.fill; g.fillRect(0, 0, W, H); stars(t, a);
  const w = measure('Earth Jukebox', 150, 500);
  led(W / 2 - w / 2 - 40, 300, 16, ST.led); text('Earth Jukebox', W / 2 + 10, 300, 150, ST.ink, { weight: 500, align: 'center' });
  text('Hear our changing planet.', W / 2, 415, 56, ST.dim, { align: 'center' });
  // look into the future (official demo template, 0:20–0:30)
  text(FUTURE, W / 2, 520, 40, ST.ink, { weight: 500, align: 'center' });
  const url = 'bep23020002-collab.github.io/earth-jukebox', uw = measure(url, 34, 500, MONO) + 60;
  box(W / 2 - uw / 2, 600, uw, 76, 12, K.lcd); text(url, W / 2, 638, 34, K.lInk, { weight: 500, font: MONO, align: 'center' });
  text('Data: NASA Earth Information Center · SVS 5603 · 3912 · 5011', W / 2, 750, 26, ST.dim, { font: MONO, align: 'center' });
  text('Team Happy Squad · Sibu, Sarawak · NASA Space Apps Challenge 2026', W / 2, 796, 26, ST.dim, { align: 'center' });
  grille(W / 2 - 300, 870, 600, 52, 13, 2.6, ST.line2);
  g.restore();
}

async function drawFrame(t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const inHook = t < 3.0;
  g.fillStyle = inHook ? K.screen : ST.bg; g.fillRect(0, 0, W, H);
  if (!inHook && t < 3.8) { g.save(); g.globalAlpha = 1 - ease((t - 3.0) / 0.8); g.fillStyle = K.screen; g.fillRect(0, 0, W, H); g.restore(); }
  if (!inHook) stars(t, 1);
  const devA = 1 - ease((t - (DEV_END - 0.05)) / 0.35);
  if (devA > 0) {
    cam = camAt(t); applyCam();
    g.save(); g.globalAlpha = devA; await drawDevice(t); g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (t > 5.9 && t < DEV_END + 0.3) { g.save(); g.globalAlpha = devA * ease((t - 5.9) / 0.4); g.fillStyle = ST.bg; g.fillRect(0, 0, W, 142); rrect(0, 0, W, 142, 0); g.clip(); stars(t, 1); g.restore(); headline(t); }
  }
  hookOverlay(t); impactOverlay(t);
  if (SSB) { const ca = ease((t - (T_CLIP - 0.05)) / 0.35) * (1 - ease((t - (T_VALID - 0.05)) / 0.35)); if (ca > 0) await clipScene(t, ca); }
  const va = ease((t - (T_VALID - 0.05)) / 0.35) * (1 - ease((t - (T_END - 0.05)) / 0.3));
  if (va > 0) validityScene(t, va);
  const ea = ease((t - T_END) / 0.4); // the end card holds to the last frame
  if (ea > 0) endScene(t, ea);
  // watermarks: AI-assistance notice (Space Apps rule: visible watermark on SI-generated images and video)
  if (WM === 'quiet') { // smaller, one corner only, still readable on dark and light frames
    const s = 'Made with AI assistance', w = measure(s, 18, 500) + 22; box(24, H - 42, w, 28, 6, 'rgba(228,225,220,0.82)'); text(s, 35, H - 28, 18, '#333333', { weight: 500 });
  } else {
    const wm = (s, x, align) => { const w = measure(s, 22, 500) + 28, x0 = align === 'right' ? x - w : x; box(x0, H - 46, w, 36, 8, 'rgba(228,225,220,0.88)'); text(s, x0 + 14, H - 28, 22, K.ink, { weight: 500 }); };
    wm('Made with AI assistance', 30, 'left'); wm('Earth Jukebox', W - 30, 'right');
  }
}

// ---------- sound (same rules as the website) ----------
const FREQ = [130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
const ev = [];
const note = (t, step, o = {}) => { if (step == null) return; ev.push({ t, kind: o.inst || 'note', f: FREQ[Math.max(0, Math.min(10, step))], dur: o.dur ?? 0.3, gain: o.gain ?? 0.5, pan: o.pan ?? 0 }); };
const pad = (t0, t1, steps, gain = 0.08) => ev.push({ t: t0, kind: 'pad', t1, fs: steps.map(s => FREQ[Math.max(0, Math.min(10, s))] / 2), gain });
// hook: every third year of the world average, rising
for (let i = 0; i < YEARS.length; i += 3) { const t = 0.6 + ease(i / (YEARS.length - 1)) * 2.3; note(t, stepOf(TEMP, means[i]), { dur: 0.14, gain: 0.42 }); }
note(2.95, stepOf(TEMP, means[YEARS.length - 1]), { dur: 1.4, gain: 0.5 }); pad(2.9, 5.7, [stepOf(TEMP, means[YEARS.length - 1]), stepOf(TEMP, means[YEARS.length - 1]) + 3], 0.06);
// taps
TUNE.forEach((p, i) => note(T_TAP[i], stepOf(TEMP, p.v2025), { inst: 'tap', gain: 0.62, pan: [-0.1, -0.4, 0.2][i] }));
TUNE.forEach((p, i) => { note(T_1880[i], stepOf(TEMP, p.v1880), { inst: 'tap', gain: 0.6 }); note(T_2025[i], stepOf(TEMP, p.v2025), { inst: 'tap', gain: 0.62 }); });
pad(T_DONE, 15.5, [stepOf(TEMP, SIBU.v2025), stepOf(TEMP, SIBU.v2025) + 2], 0.07);
// three instruments
note(T_OCEAN + 0.25, stepOf(OCEAN, oceanV), { inst: 'harp', gain: 0.5 }); note(T_OCEAN + 0.5, stepOf(OCEAN, oceanV) - 1, { inst: 'harp', gain: 0.4 }); note(T_OCEAN + 0.75, stepOf(OCEAN, oceanV) + 1, { inst: 'harp', gain: 0.4 });
const hits = lightV < 0.02 ? 0 : lightV < 0.15 ? 1 : lightV < 0.4 ? 2 : lightV < 0.7 ? 3 : 4;
for (let r = 0; r < 2; r++) for (let i = 0; i < hits; i++) ev.push({ t: T_LIGHT + 0.25 + r * 0.45 + i * 0.09, kind: 'drum', gain: 0.6 * (1 - i * 0.12) });
note(T_TEMP + 0.25, stepOf(TEMP, SIBU.v2025), { inst: 'tap', gain: 0.6 });
// ask
note(T_ANS_A, stepOf(TEMP, ASK.a), { inst: 'tap', gain: 0.6 }); note(T_ANS_B, stepOf(TEMP, ASK.b), { inst: 'tap', gain: 0.6 });
// song (the website's composer, played faster for the video); with the SSB clip, a quiet pad sits under the tester's voice
if (SSB) pad(T_CLIP, T_VALID, [5, 7], 0.035);
if (!SSB) SONG.sections.forEach((s, k) => {
  const t0 = T_SONG0 + k * SEC;
  if (s.centre != null) pad(t0, t0 + SEC, [s.centre, s.centre + 2], 0.07);
  s.notes.forEach(nn => note(t0 + nn.beat / 8 * SEC, nn.step, { dur: 0.16, gain: 0.42 }));
  [0, 0.5].forEach(b => ev.push({ t: t0 + b * SEC, kind: 'kick', gain: 0.45 })); [0.25, 0.75].forEach(b => ev.push({ t: t0 + b * SEC, kind: 'hat', gain: 0.06 }));
});
// validity and end
pad(T_VALID + 0.1, T_END, [5, 7], 0.05); pad(T_END - 0.05, 30, [5, 9], 0.08); note(T_END + 0.1, 5, { dur: 1.6, gain: 0.35 }); note(T_END + 0.45, 9, { inst: 'harp', gain: 0.3 });

function renderAudio(file) {
  const n = DUR * SR, L = new Float32Array(n), Rr = new Float32Array(n);
  const put = (i, v, p) => { const a = (p + 1) * Math.PI / 4; L[i] += v * Math.cos(a); Rr[i] += v * Math.sin(a); };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1;
  for (const e of ev) {
    const s0 = Math.floor(e.t * SR);
    if (e.kind === 'pad') {
      const s1 = Math.min(n, Math.floor(e.t1 * SR));
      for (let i = s0; i < s1; i++) { const tt = (i - s0) / SR, env = Math.min(1, tt / 0.5, (s1 - i) / SR / 0.5); let v = 0; for (const f of e.fs) v += Math.sin(2 * Math.PI * f * tt) + 0.4 * Math.sin(2 * Math.PI * f * 2.003 * tt); put(i, e.gain * env * v / e.fs.length, 0); }
      continue;
    }
    if (e.kind === 'kick') { for (let k = 0; k < SR * 0.3 && s0 + k < n; k++) { const tt = k / SR, f = 42 + 90 * Math.exp(-tt * 18); put(s0 + k, e.gain * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 9), 0); } continue; }
    if (e.kind === 'hat' || e.kind === 'drum') {
      if (e.kind === 'drum') for (let k = 0; k < SR * 0.25 && s0 + k < n; k++) { const tt = k / SR, f = 70 + 110 * Math.exp(-tt * 14); put(s0 + k, e.gain * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 10), 0.1); }
      let prev = 0; for (let k = 0; k < SR * 0.05 && s0 + k < n; k++) { const r = rnd(), v = (r - prev) * Math.exp(-k / (SR * 0.01)); prev = r; put(s0 + k, (e.kind === 'hat' ? e.gain : 0.12) * v, 0.2); }
      continue;
    }
    const partials = e.kind === 'tap' ? [[1, 1, 0.9], [4, 0.28, 0.12], [9.2, 0.08, 0.04]] : e.kind === 'harp' ? [[1, 1, 1.3], [2, 0.35, 0.8], [3, 0.2, 0.5]] : [[1, 1, e.dur + 0.25], [0.5, 0.35, e.dur + 0.25], [2, 0.15, e.dur]];
    const len = Math.floor(SR * (Math.max(...partials.map(p => p[2])) + 0.1));
    for (let k = 0; k < len && s0 + k < n; k++) {
      const tt = k / SR, att = Math.min(1, tt / 0.008); let v = 0;
      for (const [m, amp, dec] of partials) v += amp * Math.sin(2 * Math.PI * e.f * m * tt) * Math.exp(-tt * 3 / dec);
      put(s0 + k, e.gain * att * v * 0.5, e.pan);
    }
  }
  for (const [d, fb] of [[0.043, 0.3], [0.061, 0.25], [0.089, 0.2]]) { const ds = Math.floor(d * SR); for (let i = ds; i < n; i++) { L[i] += L[i - ds] * fb * 0.5; Rr[i] += Rr[i - ds] * fb * 0.5; } }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
  if (SSB?.voice) { // the tester's own voice, dry (no echo), a little louder on average than the demo's music, with short fades
    const v = SSB.voice, m = Math.min(v.length / 2, Math.floor(SSB.dur * SR)), s0 = Math.floor(T_CLIP * SR); let vp = 0, vs = 0, ms = 0;
    for (let i = 0; i < m * 2; i++) { vp = Math.max(vp, Math.abs(v[i])); vs += v[i] * v[i]; }
    const a0 = Math.floor(6 * SR), a1 = Math.floor(T_CLIP * SR); for (let i = a0; i < a1; i++) ms += L[i] * L[i] + Rr[i] * Rr[i];
    const vRms = Math.sqrt(vs / (2 * m)), mRms = Math.sqrt(ms / (2 * (a1 - a0)));
    const k = vp ? Math.min(1.2 * peak / vp, vRms ? 1.6 * mRms / vRms : Infinity) : 0, fade = 0.08 * SR;
    for (let i = 0; i < m && s0 + i < n; i++) { const env = Math.min(1, i / fade, (m - i) / fade); L[s0 + i] += v[2 * i] * k * env; Rr[s0 + i] += v[2 * i + 1] * k * env; }
    peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
  }
  const gain = 0.9 / peak, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const fo = Math.min(1, (n - i) / (SR * 0.6)); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain * fo)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, Rr[i] * gain * fo)) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, buf);
}

// ---------- main ----------
for (const k of KEYS) await texture(k.id, k.y); // key thumbnails
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (SAMPLES) {
  const times = process.argv.filter(a => /^\d+(\.\d+)?$/.test(a)).map(Number);
  for (const t of times.length ? times : [0.4, 1.8, 2.95, 4.9, 7.9, 11.6, 14.8, 16.5, 17.5, 21.6, 24.2, 27.4, 29.0]) {
    await drawFrame(t); fs.writeFileSync(path.join(HERE, 'out', `s_${String(t).replace('.', '_')}.png`), await cv.encode('png'));
  }
  console.log('samples written', { song: SONG.sections.map(s => `${dateText(s.moment)} ${s.moment.name} ${s.mean?.toFixed(2)}`), warmer: WARMER.toFixed(2), ask: [ASK.a.toFixed(2), ASK.b.toFixed(2)], oceanV: oceanV.toFixed(1), lightV: lightV.toFixed(2) });
} else {
  const wav = path.join(HERE, 'out/audio.wav'); renderAudio(wav);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    '-metadata', 'comment=Made with AI assistance (Anthropic Claude). Data: NASA Earth Information Center / SVS.', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < DUR * FPS; f++) {
    await drawFrame(f / FPS);
    const d = g.getImageData(0, 0, W, H).data;
    if (!ff.stdin.write(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); ff.on('close', code => console.log('video', code === 0 ? 'written' : 'failed', OUT));
}
