// AI-assisted (Anthropic Claude). Renders the 30-second Earth Jukebox demo video.
// Every globe frame and every note comes from the same NASA data the website uses (../assets).
// Usage: node render.mjs [out.mp4]   |   node render.mjs --samples   (writes a few PNG frames)
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { KINDS } from '../src/tracks.js';

const HERE = path.dirname(new URL(import.meta.url).pathname), A = path.join(HERE, '../assets/');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(HERE, 'out/earth-jukebox-demo.mp4');
const SAMPLES = process.argv.includes('--samples');
const W = 1920, H = 1080, FPS = 30, DUR = 30, SR = 44100;
const FONT = '"Avenir Next", "Helvetica Neue", sans-serif';
const C = { ink: '#F2F4FA', muted: '#A8AEC8', warm: '#F09A55', ice: '#8CC2EE', card: 'rgba(20,22,52,0.86)', line: 'rgba(255,255,255,0.14)' };

// ---------- NASA data ----------
const loadTrack = id => { const t = JSON.parse(fs.readFileSync(A + id + '/track.json')); t.cube = fs.readFileSync(A + id + '/cube.bin'); return t; };
const TT = { temperature: loadTrack('temperature'), ocean: loadTrack('ocean'), lightning: loadTrack('lightning') };
const N = 180 * 90;
const cellIdx = (lat, lon) => Math.max(0, Math.min(89, Math.floor((90 - lat) / 2))) * 180 + ((Math.floor((lon + 180) / 2) % 180) + 180) % 180;
const decode = (T, c) => (c ? T.min + (c - 1) / 254 * (T.max - T.min) : null);
function boxMean(T, yi, lat, lon, r = 4) {
  let s = 0, w = 0;
  for (let la = lat - r + 1; la <= lat + r; la += 2) for (let lo = lon - r + 1; lo <= lon + r; lo += 2) {
    const v = decode(T, T.cube[yi * N + cellIdx(la, lo)]); if (v == null) continue;
    const k = Math.cos(la * Math.PI / 180); s += v * k; w += k;
  }
  return w ? s / w : null;
}
function globalMean(T, yi) {
  let s = 0, w = 0;
  for (let cy = 0; cy < 90; cy++) { const k = Math.cos((90 - (cy + 0.5) * 2) * Math.PI / 180); for (let cx = 0; cx < 180; cx++) { const v = decode(T, T.cube[yi * N + cy * 180 + cx]); if (v != null) { s += v * k; w += k; } } }
  return s / w;
}
const TEMP = TT.temperature, YEARS = TEMP.years, yIdx = y => YEARS.indexOf(y);
const tOf = (T, v) => (v - T.min) / (T.max - T.min);
const fmtT = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C`;

// ---------- textures ----------
const texCache = new Map();
async function texture(id, y) {
  const key = id + y; if (texCache.has(key)) return texCache.get(key);
  const img = await loadImage(`${A}${id}/frames/${y}.jpg`);
  const c = createCanvas(720, 360), g = c.getContext('2d'); g.drawImage(img, 0, 0, 720, 360);
  const t = { data: g.getImageData(0, 0, 720, 360).data, img }; texCache.set(key, t); return t;
}

// ---------- drawing helpers ----------
const cv = createCanvas(W, H), g = cv.getContext('2d');
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const out3 = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const D2R = Math.PI / 180;
function rrect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function text(s, x, y, size, color = C.ink, weight = 600, align = 'left', alpha = 1) {
  g.save(); g.globalAlpha *= alpha; g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); g.restore();
}
function card(x, y, w, h, alpha = 1, glow = 'rgba(140,110,255,0.35)') {
  g.save(); g.globalAlpha *= alpha; g.shadowColor = glow; g.shadowBlur = 50; g.fillStyle = C.card; rrect(x, y, w, h, 26); g.fill();
  g.shadowBlur = 0; g.strokeStyle = C.line; g.lineWidth = 2; g.stroke(); g.restore();
}
function typed(s, t0, cps, t) { const n = Math.max(0, Math.min(s.length, Math.floor((t - t0) * cps))); return s.slice(0, n); }
function cursor(x, y, h, t, alpha = 1) { if (Math.floor(t * 2.4) % 2) return; g.save(); g.globalAlpha *= alpha; g.fillStyle = C.ink; g.fillRect(x + 6, y - h / 2, 4, h); g.restore(); }
function background(t) {
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#080A1E'); gr.addColorStop(0.55, '#14103A'); gr.addColorStop(1, '#2A1458');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.5, H * 1.05, 50, W * 0.5, H * 1.05, W * 0.6);
  glow.addColorStop(0, 'rgba(150,90,255,0.35)'); glow.addColorStop(1, 'rgba(150,90,255,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  // drifting stars (fixed seed)
  for (let i = 0; i < 90; i++) {
    const x = (i * 397 % W + t * (6 + i % 5)) % W, y = (i * 211) % H, a = 0.25 + 0.5 * ((i * 37) % 10) / 10;
    g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, 2, 2);
  }
}
function caption(s, alpha) {
  if (!s || alpha <= 0) return;
  g.save(); g.globalAlpha = alpha; g.font = `500 34px ${FONT}`; const w = g.measureText(s).width + 70;
  g.fillStyle = 'rgba(5,6,18,0.72)'; rrect((W - w) / 2, H - 128, w, 64, 32); g.fill(); g.restore();
  text(s, W / 2, H - 96, 34, '#FFFFFF', 500, 'center', alpha);
}

// orthographic globe from an equirectangular NASA frame
const globeBuf = new Map();
function globeBasis(lat0, lon0) { const p = lat0 * D2R, l = lon0 * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l); return { out: [cp * cl, cp * sl, sp], east: [-sl, cl, 0], north: [-sp * cl, -sp * sl, cp] }; }
function project(lat, lon, cx, cy, R, lat0, lon0) {
  const b = globeBasis(lat0, lon0), p = lat * D2R, l = lon * D2R, w = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)], d = v => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  return { x: cx + d(b.east) * R, y: cy - d(b.north) * R, visible: d(b.out) > 0 };
}
function drawGlobe(tex, cx, cy, R, lat0, lon0, alpha = 1) {
  const S = Math.ceil(R * 2);
  if (!globeBuf.has(S)) { const c = createCanvas(S, S); globeBuf.set(S, { c, ctx: c.getContext('2d'), img: c.getContext('2d').createImageData(S, S) }); }
  const { c, ctx, img } = globeBuf.get(S), o = img.data, td = tex.data, b = globeBasis(lat0, lon0);
  o.fill(0);
  const L = [-0.45, 0.55, 0.7], ln = Math.hypot(...L); L.forEach((v, i) => { L[i] = v / ln; });
  for (let py = 0; py < S; py++) {
    const Y = (R - py - 0.5) / R; if (Y > 1 || Y < -1) continue;
    for (let px = 0; px < S; px++) {
      const X = (px + 0.5 - R) / R, r2 = X * X + Y * Y; if (r2 > 1) continue;
      const Z = Math.sqrt(1 - r2);
      const wx = X * b.east[0] + Y * b.north[0] + Z * b.out[0], wy = X * b.east[1] + Y * b.north[1] + Z * b.out[1], wz = X * b.east[2] + Y * b.north[2] + Z * b.out[2];
      let tx = Math.floor((Math.atan2(wy, wx) + Math.PI) / (2 * Math.PI) * 720); if (tx >= 720) tx -= 720;
      const ty = Math.min(359, Math.floor((Math.PI / 2 - Math.asin(wz)) / Math.PI * 360));
      const ti = (ty * 720 + tx) * 4, oi = (py * S + px) * 4, light = 0.7 + 0.3 * Math.max(0, X * L[0] + Y * L[1] + Z * L[2]);
      o[oi] = td[ti] * light; o[oi + 1] = td[ti + 1] * light; o[oi + 2] = td[ti + 2] * light; o[oi + 3] = r2 > 0.97 ? 255 * (1 - r2) / 0.03 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  g.save(); g.globalAlpha = alpha;
  const atm = g.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.14); atm.addColorStop(0, 'rgba(140,194,238,0.45)'); atm.addColorStop(1, 'rgba(140,194,238,0)');
  g.fillStyle = atm; g.beginPath(); g.arc(cx, cy, R * 1.14, 0, Math.PI * 2); g.fill();
  g.drawImage(c, cx - R, cy - R); g.restore();
}
function ripple(x, y, k, R) { g.save(); g.strokeStyle = `rgba(255,255,255,${0.95 * (1 - k)})`; g.lineWidth = 5 * (1 - k) + 1; g.beginPath(); g.arc(x, y, 14 + k * R * 0.28, 0, Math.PI * 2); g.stroke(); g.restore(); }
function marker(x, y) { g.save(); g.lineWidth = 7; g.strokeStyle = '#05080F'; g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke(); g.lineWidth = 3.5; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.restore(); }

// ---------- audio score (same rules as the website) ----------
const FREQ = [130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
const noteIdx = t => Math.round(Math.max(0, Math.min(1, t)) * 10);
const ev = []; // {t, kind, ...}
const note = (t, val, o = {}) => ev.push({ t, kind: o.inst || 'note', f: FREQ[noteIdx(val)], val, dur: o.dur ?? 0.3, gain: o.gain ?? 0.5, pan: o.pan ?? 0 });
const pad = (t0, t1, vals, gain = 0.08) => ev.push({ t: t0, kind: 'pad', t1, fs: vals.map(v => FREQ[noteIdx(v)] / 2), gain });

// ---------- scenes ----------
const SIBU = { name: 'Sibu, Sarawak', lat: 2.3, lon: 111.8 }, ARCTIC = { name: 'the Arctic', lat: 80, lon: 100 };
const Y2025 = YEARS.length - 1;
const cellVal = (T, yi, lat, lon) => decode(T, T.cube[yi * N + cellIdx(lat, lon)]);
const sibu25 = cellVal(TEMP, Y2025, SIBU.lat, SIBU.lon) ?? boxMean(TEMP, Y2025, SIBU.lat, SIBU.lon, 3), arc25 = cellVal(TEMP, Y2025, ARCTIC.lat, ARCTIC.lon) ?? boxMean(TEMP, Y2025, ARCTIC.lat, ARCTIC.lon, 4);
const story = [{ y: 1950, name: 'Fuzhou', lat: 26.07, lon: 119.3, label: 'Grandpa is born' }, { y: 1970, name: 'Sibu', lat: 2.3, lon: 111.8, label: 'He moves to Sibu' }, { y: 2006, name: 'Kuching', lat: 1.6, lon: 110.3, label: 'I am born' }]
  .map(m => ({ ...m, v: boxMean(TEMP, yIdx(m.y), m.lat, m.lon, 6) }));
const means = YEARS.map((_, i) => globalMean(TEMP, i));

// scene times (seconds)
const S = { intro: [0, 3.4], hero: [3.4, 9.6], tap: [9.6, 14.6], tracks: [14.6, 19.6], song: [19.6, 24.6], access: [24.6, 27.4], end: [27.4, 30] };
const win = (t, [a, b], f = 0.35) => ease((t - a) / f) * (1 - ease((t - (b - f)) / f));

// score
pad(0.3, 3.5, [0.3, 0.5], 0.06);
for (let i = 0; i < YEARS.length; i += 3) { const t = 3.9 + (i / (YEARS.length - 1)) * 5.2, v = tOf(TEMP, means[i]); note(t, v, { dur: 0.16, gain: 0.42 }); if (v > 0.7 && i % 6 === 0) ev.push({ t, kind: 'kick', gain: 0.4 }); }
note(9.15, tOf(TEMP, means[Y2025]), { dur: 1.2, gain: 0.45 }); pad(9.1, 10.6, [tOf(TEMP, means[Y2025]), tOf(TEMP, means[Y2025]) + 0.3], 0.07);
note(10.6, tOf(TEMP, sibu25), { inst: 'tap', gain: 0.6 }); note(12.3, tOf(TEMP, arc25), { inst: 'tap', gain: 0.6 });
[0, 0.2, 0.4, 0.6].forEach((d, i) => note(14.9 + d, [0.45, 0.6, 0.75, 0.9][i], { inst: 'tap', gain: 0.45 }));
[0, 0.22, 0.44].forEach((d, i) => note(16.1 + d, [0.55, 0.7, 0.85][i], { inst: 'harp', gain: 0.45 }));
[0, 0.09, 0.18, 0.27, 0.6, 0.69].forEach(d => ev.push({ t: 17.3 + d, kind: 'drum', gain: 0.55 }));
story.forEach((m, k) => {
  const t0 = 21.3 + k * 1.05, c = noteIdx(tOf(TEMP, m.v)) / 10;
  pad(t0, t0 + 1.05, [c, c + 0.3], 0.07);
  [0, 0.26, 0.52, 0.78].forEach((d, i) => note(t0 + d, Math.max(0, Math.min(1, c + [0, 0.2, 0.1, 0.3][i])), { dur: 0.22, gain: 0.4 }));
  [0, 0.52].forEach(d => ev.push({ t: t0 + d, kind: 'kick', gain: 0.45 })); [0.26, 0.78].forEach(d => ev.push({ t: t0 + d, kind: 'hat', gain: 0.06 }));
});
[25.0, 25.5, 26.0].forEach((t, i) => note(t, [0.5, 0.6, 0.7][i], { dur: 0.25, gain: 0.35 }));
pad(27.5, 30, [0.5, 0.8], 0.09); note(27.6, 0.5, { dur: 1.6, gain: 0.35 }); note(28.0, 0.8, { inst: 'harp', gain: 0.3 });

async function drawFrame(t) {
  background(t);
  // 1. intro
  let a = win(t, S.intro);
  if (a > 0) {
    text('Team Happy Squad   ·   NASA Space Apps Challenge 2026   ·   The Earth Information Jukebox', W / 2, 150, 28, C.muted, 500, 'center', a);
    const l1 = 'NASA maps show our changing planet.', l2 = 'But not everyone can see them.';
    const s1 = typed(l1, 0.3, 30, t), s2 = typed(l2, 1.75, 30, t);
    g.font = `700 76px ${FONT}`;
    text(s1, W / 2 - g.measureText(l1).width / 2, 470, 76, C.ink, 700, 'left', a);
    text(s2, W / 2 - g.measureText(l2).width / 2, 580, 76, C.warm, 700, 'left', a);
    const cur = t < 1.75 ? [W / 2 - g.measureText(l1).width / 2 + g.measureText(s1).width, 470] : [W / 2 - g.measureText(l2).width / 2 + g.measureText(s2).width, 580];
    cursor(cur[0], cur[1], 80, t, a);
  }
  // 2. hero: 1880 -> 2025
  a = win(t, S.hero);
  if (a > 0) {
    const k = Math.max(0, Math.min(1, (t - 3.9) / 5.2)), yi = Math.round(k * (YEARS.length - 1));
    const lon0 = 70 + (t - 3.4) * 9, R = 380 + 10 * ease((t - 3.4) / 1.2);
    drawGlobe(await texture('temperature', YEARS[yi]), 640, 560, R, 18, lon0, a);
    text('Earth Jukebox', 1150, 330, 92, C.ink, 700, 'left', a * ease((t - 3.5) / 0.6));
    text('Hear our changing planet.', 1152, 410, 42, C.muted, 500, 'left', a * ease((t - 3.8) / 0.6));
    text(String(YEARS[yi]), 1150, 590, 190, C.warm, 700, 'left', a);
    text(`World average: ${fmtT(means[yi])}`, 1156, 720, 38, C.ink, 500, 'left', a);
    caption('Every year plays a note. Warmer sings higher.', a * ease((t - 4.2) / 0.4));
  }
  // 3. tap the Earth
  a = win(t, S.tap);
  if (a > 0) {
    const lat0 = t < 11.6 ? 12 : 12 + 40 * ease((t - 11.6) / 0.8), lon0 = 108 + (t - 9.6) * 1.5;
    const R = 400; drawGlobe(await texture('temperature', 2025), 640, 560, R, lat0, lon0, a);
    const first = t < 12.2, P = first ? SIBU : ARCTIC, v = first ? sibu25 : arc25, tapT = first ? 10.6 : 12.3;
    const p = project(P.lat, P.lon, 640, 560, R, lat0, lon0);
    if (p.visible && t > tapT - 0.6) { marker(p.x, p.y); const kk = (t - tapT) / 0.9; if (kk > 0 && kk < 1) ripple(p.x, p.y, kk, R); }
    if (p.visible && t < tapT && t > tapT - 0.6) { const kk = (tapT - t) / 0.6; g.save(); g.globalAlpha = a; g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(p.x + 40 * kk, p.y + 60 * kk, 16, 0, Math.PI * 2); g.fill(); g.restore(); }
    const ca = a * out3((t - 10.7) / 0.5), x = 1130 + 60 * (1 - ca);
    card(x, 360, 620, 330, ca);
    text(P.name, x + 50, 440, 40, C.muted, 600, 'left', ca);
    text(KINDS.temperature.words(v), x + 50, 530, 64, C.ink, 700, 'left', ca);
    text(`${fmtT(v)} compared with normal`, x + 50, 615, 34, C.warm, 500, 'left', ca);
    caption('Tap anywhere on the Earth. Every place has a note.', a * ease((t - 9.9) / 0.4));
  }
  // 4. three NASA EIC tracks, three instruments
  a = win(t, S.tracks);
  if (a > 0) {
    const items = [['temperature', 2025, 'Temperature', 'marimba', 14.8], ['ocean', 2007, 'Ocean', 'harp', 16.0], ['lightning', 2020, 'Lightning', 'drums', 17.2]];
    text('Pick a NASA Earth Information Center visualization', W / 2, 190, 50, C.ink, 700, 'center', a);
    for (const [k, [id, y, name, inst, t0]] of items.entries()) {
      const ca = a * out3((t - t0) / 0.5), x = 150 + k * 560, yy = 330 + 50 * (1 - ca);
      card(x, yy, 500, 440, ca, k === 0 ? 'rgba(240,154,85,0.35)' : k === 1 ? 'rgba(140,194,238,0.35)' : 'rgba(255,230,90,0.3)');
      const tex = await texture(id, y);
      g.save(); g.globalAlpha = ca; rrect(x + 30, yy + 30, 440, 220, 16); g.clip(); g.drawImage(tex.img, x + 30, yy + 30, 440, 220); g.restore();
      text(name, x + 40, yy + 310, 46, C.ink, 700, 'left', ca);
      text(`plays ${inst}`, x + 40, yy + 370, 34, C.muted, 500, 'left', ca);
    }
    caption('Three NASA visualizations. Three instruments.', a * ease((t - 15) / 0.4));
  }
  // 5. My Earth song
  a = win(t, S.song);
  if (a > 0) {
    const storyText = 'Grandpa was born in Fuzhou in 1950. He moved to Sibu in 1970. I was born in Kuching in 2006.';
    card(150, 220, 820, 260, a);
    text('Tell your story', 200, 280, 34, C.muted, 600, 'left', a);
    const st = typed(storyText, 19.8, 70, t);
    g.font = `500 36px ${FONT}`; const lines = [''];
    for (const w of st.split(' ')) { const tryLine = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w; if (g.measureText(tryLine).width > 720 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = tryLine; }
    lines.slice(0, 3).forEach((ln, i) => text(ln, 200, 340 + i * 50, 36, C.ink, 500, 'left', a));
    story.forEach((m, k) => {
      const t0 = 21.3 + k * 1.05, ca = a * out3((t - t0 + 0.2) / 0.4), y = 540 + k * 130, on = t >= t0 && t < t0 + 1.05;
      card(150, y, 820, 104, ca, on ? 'rgba(240,154,85,0.55)' : 'rgba(140,110,255,0.25)');
      text(`${m.y}`, 190, y + 52, 44, C.warm, 700, 'left', ca);
      text(`${m.name}: ${m.label}`, 330, y + 40, 34, C.ink, 600, 'left', ca);
      text(KINDS.temperature.words(m.v), 330, y + 78, 28, C.muted, 500, 'left', ca);
    });
    const k = Math.max(0, Math.min(2, Math.floor((t - 21.3) / 1.05))), m = story[k];
    const lon0 = 115 + (m.lon - 115) * 0.3, lat0 = 12;
    drawGlobe(await texture('temperature', m.y), 1420, 560, 330, lat0, lon0, a);
    const p = project(m.lat, m.lon, 1420, 560, 330, lat0, lon0); if (p.visible && t > 21.1) marker(p.x, p.y);
    text(String(t > 21.1 ? m.y : 1950), 1420, 170, 64, C.warm, 700, 'center', a);
    caption('Your family story becomes your Earth song.', a * ease((t - 19.9) / 0.4));
  }
  // 6. accessible
  a = win(t, S.access);
  if (a > 0) {
    text('Made to be heard, not only seen', W / 2, 250, 64, C.ink, 700, 'center', a);
    const keys = ['←', '→', '↑', '↓', 'Enter', 'Space'];
    keys.forEach((kname, i) => {
      const x = W / 2 - 520 + i * 180, pressed = Math.floor((t - 24.9) / 0.5) === i % 3 + Math.floor(i / 3) * 3;
      card(x, 400 + (pressed ? 8 : 0), 150, 120, a, pressed ? 'rgba(240,154,85,0.6)' : 'rgba(140,110,255,0.25)');
      text(kname, x + 75, 460 + (pressed ? 8 : 0), kname.length > 1 ? 34 : 54, C.ink, 700, 'center', a);
    });
    card(W / 2 - 450, 600, 900, 120, a);
    text('“Sibu, Sarawak. Warmer than normal.”', W / 2, 660, 42, C.ice, 600, 'center', a);
    caption('Keyboard, voice and screen readers. No screen needed.', a * ease((t - 24.9) / 0.4));
  }
  // 7. end card
  a = ease((t - S.end[0]) / 0.5) * (1 - ease((t - 29.4) / 0.6));
  if (a > 0) {
    text('Earth Jukebox', W / 2, 400, 130, C.ink, 700, 'center', a);
    text('Every NASA Earth map, made audible.', W / 2, 520, 50, C.warm, 600, 'center', a);
    text('bep23020002-collab.github.io/earth-jukebox', W / 2, 640, 38, C.ink, 500, 'center', a);
    text('Data: NASA Earth Information Center (SVS 5603, 3912, 5011)   ·   Team Happy Squad, Sibu', W / 2, 720, 28, C.muted, 500, 'center', a);
  }
  // watermarks: AI-assistance notice (Space Apps rule) and brand
  text('Made with AI assistance', 48, H - 40, 22, 'rgba(255,255,255,0.6)', 500, 'left');
  text('Earth Jukebox', W - 48, H - 40, 26, 'rgba(255,255,255,0.7)', 700, 'right');
}

// ---------- audio rendering ----------
function renderAudio(file) {
  const n = DUR * SR, L = new Float32Array(n), Rr = new Float32Array(n);
  const put = (i, v, pan) => { const a = (pan + 1) * Math.PI / 4; L[i] += v * Math.cos(a); Rr[i] += v * Math.sin(a); };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1;
  for (const e of ev) {
    const s0 = Math.floor(e.t * SR);
    if (e.kind === 'pad') {
      const s1 = Math.min(n, Math.floor(e.t1 * SR));
      for (let i = s0; i < s1; i++) { const tt = (i - s0) / SR, env = Math.min(1, tt / 0.5, (s1 - i) / SR / 0.5); let v = 0; for (const f of e.fs) { v += Math.sin(2 * Math.PI * f * tt) + 0.4 * Math.sin(2 * Math.PI * f * 2.003 * tt); } put(i, e.gain * env * v / e.fs.length, 0); }
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
  // gentle room reverb (feedback delays)
  for (const [d, fb] of [[0.043, 0.3], [0.061, 0.25], [0.089, 0.2]]) { const ds = Math.floor(d * SR); for (let i = ds; i < n; i++) { L[i] += L[i - ds] * fb * 0.5; Rr[i] += Rr[i - ds] * fb * 0.5; } }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
  const gain = 0.9 / peak, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const fo = Math.min(1, (n - i) / (SR * 0.6)); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain * fo)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, Rr[i] * gain * fo)) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, buf);
}

// ---------- main ----------
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (SAMPLES) {
  for (const t of [2.6, 6.5, 11.2, 13.4, 18.4, 22.6, 26.0, 28.8]) { await drawFrame(t); fs.writeFileSync(path.join(HERE, 'out', `s_${String(t).replace('.', '_')}.png`), await cv.encode('png')); }
  console.log('samples written');
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
