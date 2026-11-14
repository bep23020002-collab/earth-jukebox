// AI-assisted (Anthropic Claude).
// Earth Jukebox: explore a NASA visualization by ear.
// Two modes share one interface:
//   track - a prepared NASA time series (Global temperature 1880–2025)
//   image - any NASA picture with a color bar, calibrated on the spot
import { Sound, noteIndex } from './audio.js';
import { Score } from './score.js';
import { JUMPS, placeName, formatCoord, PLACE_NAMES, findPlace } from './places.js';
import { ImageSource, describeSpot } from './image-source.js';
import { Globe } from './globe.js';
import { composeSong, scheduleSong, BPM, BEATS_PER_MOMENT } from './song.js';
import { KINDS } from './tracks.js';
import { aiReady, aiSong, aiAsk, storyWithoutAI } from './ai.js';
import { loadMeta, hasMonth, loadYear, yearLoaded, monthValue, monthBoxMean, monthCell, dateText, MON, MONTHS, latestMonth } from './monthly.js';

const $ = s => document.querySelector(s);
const sound = new Sound();
const src = new ImageSource();
const globe = new Globe($('#globe'));
const score = new Score({ box: $('#scoreBox'), canvas: $('#score'), title: $('#scoreTitle'), legend: $('#scoreLegend'), note: $('#scoreNote') });
const state = {
  mode: 'track', track: null, cube: null, yi: 0, lat: 2.3, lon: 111.8,
  u: 0.5, v: 0.5, cal: { step: 0, p0: null, p1: null },
  voice: false, ref: false, playing: false, busy: false, lang: 'en', hist: null, images: new Map(), lastCell: -1,
  texYear: null, taps: [], lastTapAt: 0, replaying: false, tracks: {}, monthLabel: null, month: null,
};

// ---------- track data ----------
async function loadTrack(id) {
  if (state.tracks[id]) return state.tracks[id];
  const res = await fetch(`assets/${id}/track.json`);
  if (!res.ok) return null;
  const track = await res.json();
  track.cube = new Uint8Array(await (await fetch(`assets/${id}/cube.bin`)).arrayBuffer());
  track.kind = track.kind || id;
  state.tracks[id] = track;
  return track;
}
const temp = () => state.tracks.temperature;
function useTrack(id) {
  const track = state.tracks[id]; if (!track) return;
  Object.assign(state, { track, cube: track.cube, yi: track.years.length - 1, texYear: null });
  state.month = null;
  const yr = $('#year'); yr.max = hasMonths(track) ? track.years.length * 12 - 1 : track.years.length - 1; yr.value = sliderValue();
  setPlayingUI(false);
  document.querySelectorAll('[data-track]').forEach(b => b.setAttribute('aria-pressed', b.dataset.track === id));
}
const kind = () => KINDS[state.track?.kind] || KINDS.temperature;
const grid = (T = state.track) => T.grid;
function cellIndex(lat, lon, T = state.track) {
  const { width: W, height: H, cellDegrees: d } = grid(T);
  const cx = ((Math.floor((lon + 180) / d) % W) + W) % W;
  const cy = Math.max(0, Math.min(H - 1, Math.floor((90 - lat) / d)));
  return cy * W + cx;
}
function decode(code, T = state.track) {
  if (!code) return null;
  const { min, max } = T;
  return min + (code - 1) / 254 * (max - min);
}
// The year bar moves month by month. state.month: null = the whole year (NASA's yearly map, as published),
// 1-12 = that month (temperature: NASA GISTEMP monthly numbers; lightning: NASA's 10-day frames dated in that month).
const dataId = (T = state.track) => T?.dataId || T?.id; // "All three" reads the temperature data
const hasMonths = (T = state.track) => !!T && (dataId(T) === 'temperature' || dataId(T) === 'lightning');
const monthOn = (T = state.track) => state.mode === 'track' && state.month != null && hasMonths(T);
let lightningByCell = null, lightningMeta = null;
async function loadLightningMonths() {
  lightningMeta ||= await fetch('assets/lightning/monthly/meta.json').then(r => r.json());
  lightningByCell ||= new Uint8Array(await (await fetch('assets/lightning/monthly/by-cell.bin')).arrayBuffer());
}
async function ensureMonthData(T = state.track) { // load what the current month needs (one year file, or the lightning months)
  if (!monthOn(T)) return;
  if (dataId(T) === 'temperature') { await loadMeta(); await loadYear(T.years[state.yi]); }
  if (dataId(T) === 'lightning' || T.kind === 'combo') await loadLightningMonths();
}
function monthCovered(yi = state.yi, T = state.track) { // does NASA's data cover this month of this year?
  if (!monthOn(T)) return true;
  const y = T.years[yi];
  if (dataId(T) === 'temperature') return hasMonth(y, state.month);
  return !!lightningMeta && (lightningMeta.months[y] || []).includes(state.month);
}
function cellValue(yi, idx, T = state.track) {
  if (monthOn(T)) {
    const y = T.years[yi];
    if (dataId(T) === 'temperature') return yearLoaded(y) ? monthCell(y, state.month, idx) : null;
    if (!lightningByCell) return null;
    const N = lightningMeta.monthsPerCell, k = (y - lightningMeta.firstYear) * 12 + (state.month - lightningMeta.firstMonth);
    if (k < 0 || k >= N) return null;
    const c = lightningByCell[idx * N + k]; return c ? (c - 1) / 254 : null;
  }
  const { width: W, height: H } = grid(T); return decode(T.cube[yi * W * H + idx], T);
}
function trackValue(yi, lat, lon, T = state.track) { return cellValue(yi, cellIndex(lat, lon, T), T); }
// the year as shown, with the month when the year bar is on a month: "Mar 1950"
const when = (yi = state.yi, T = state.track) => (monthOn(T) ? `${MON[state.month - 1]} ${T.years[yi]}` : String(T.years[yi]));
// the year bar: 12 steps per year for tracks with months
const sliderValue = () => (hasMonths() ? state.yi * 12 + (state.month ? state.month - 1 : 11) : state.yi);
function boxMean(yi, lat, lon, r = 6, T = state.track) { // area-weighted average around a point
  const d = grid(T).cellDegrees;
  let s = 0, w = 0;
  for (let la = lat - r + d / 2; la <= lat + r; la += d) {
    if (la < -90 || la > 90) continue;
    const k = Math.cos(la * Math.PI / 180);
    for (let lo = lon - r + d / 2; lo <= lon + r; lo += d) { const v = trackValue(yi, la, lo, T); if (v != null) { s += v * k; w += k; } }
  }
  return w ? s / w : null;
}
const BANDS = [['the Arctic', 66, 90], ['the northern mid-latitudes', 30, 66], ['the tropics', -30, 30], ['the southern mid-latitudes', -66, -30], ['Antarctica', -90, -66]];
function yearStats(yi) {
  const { width: W, height: H, cellDegrees: d } = grid();
  const bands = BANDS.map(([name, lo, hi]) => ({ name, lo, hi, s: 0, w: 0 }));
  let s = 0, w = 0, all = 0;
  for (let cy = 0; cy < H; cy++) {
    const lat = 90 - (cy + 0.5) * d, k = Math.cos(lat * Math.PI / 180);
    for (let cx = 0; cx < W; cx++) {
      all += k;
      const v = cellValue(yi, cy * W + cx);
      if (v == null) continue;
      s += v * k; w += k;
      const b = bands.find(b => lat >= b.lo && lat < b.hi) || bands[0]; b.s += v * k; b.w += k;
    }
  }
  return { mean: s / w, coverage: w / all, bands: bands.filter(b => b.w > 0).map(b => ({ name: b.name, mean: b.s / b.w })) };
}

// ---------- what the cursor is on, in either mode ----------
const isImage = () => state.mode === 'image';
function scale() {
  if (isImage()) return src.legend ? { min: src.legend.min, max: src.legend.max, unit: src.unit } : null;
  return { min: state.track.min, max: state.track.max, unit: state.track.unit };
}
const tOf = v => { const s = scale(); return (v - s.min) / (s.max - s.min); };
// for the score display: the note (0-10) a value plays, and a short place name to print under it
const stepOf = v => (v == null ? null : noteIndex(tOf(v)));
const shortPlace = name => String(name || '').replace(/^near (the )?/, '').split(',')[0];
function scoreAxis() {
  const k = isImage() ? null : state.mode === 'song' || state.track?.kind === 'combo' ? 'temperature' : state.track?.kind;
  return k === 'temperature' ? { high: 'hotter', mid: 'normal', low: 'colder' } : k === 'ocean' ? { high: 'warm', low: 'cold' }
    : k === 'lightning' ? { high: 'more', low: 'less' } : { high: 'high', low: 'low' };
}
function currentValue() { return isImage() ? src.valueAt(state.u, state.v) : trackValue(state.yi, state.lat, state.lon); }
function currentPlace() { return isImage() ? describeSpot(state.u, state.v) : placeName(state.lat, state.lon); }
// Left of the screen plays in the left ear.
const panFor = (lat, lon) => { const p = globe.project(lat, lon); return Math.max(-1, Math.min(1, (p.x / globe.size - 0.5) * 2.2)); };
const currentPan = () => (isImage() ? state.u * 2 - 1 : panFor(state.lat, state.lon));
const year = () => state.track.years[state.yi];

// ---------- words ----------
function nice(x) { // decimals follow the size of the color scale
  const s = scale(), span = s ? s.max - s.min : 10;
  return x.toFixed(span <= 2 ? 2 : span <= 40 ? 1 : 0);
}
function fmt(v) {
  if (v == null) return 'no data';
  const { min, max, unit } = scale();
  const signed = min < 0 && max > 0;
  const mag = nice(Math.abs(v)), zero = Number(mag) === 0; // no "−0.0"
  const s = `${signed ? (v >= 0 || zero ? '+' : '−') : (v < 0 && !zero ? '−' : '')}${mag} ${unit}`.trim();
  const span = max - min;
  if (monthOn() && state.track.kind === 'temperature') return s; // NASA's monthly numbers are exact, not read from capped colors
  if (v >= max - span * 0.008) return `${s} or more`;
  if (v <= min + span * 0.008) return `${s} or less`;
  return s;
}
function say(v) {
  if (v == null) return 'no data here';
  const { min, max, unit } = scale(), span = max - min;
  const unitWord = unit === '°C' ? 'degrees' : unit;
  let s = `${v < 0 ? 'minus ' : (min < 0 ? 'plus ' : '')}${nice(Math.abs(v))} ${unitWord}`;
  if (v >= max - span * 0.008) s += ' or more'; else if (v <= min + span * 0.008) s += ' or less';
  return s;
}
function describe() {
  if (isImage()) {
    if (!src.legend) return 'Mark the color bar first.';
    const st = src.stats();
    if (st.mean == null) return 'None of the colors match the color bar. Try marking the bar again, a little closer to its middle.';
    return `The highest values are at the ${describeSpot(st.hiAt.u, st.hiAt.v)} (${fmt(st.hi)}). The lowest are at the ${describeSpot(st.loAt.u, st.loAt.v)} (${fmt(st.lo)}).`;
  }
  if (!monthCovered()) return `NASA's data does not cover ${when()}. Try another month.`;
  const st = yearStats(state.yi);
  if (!st.bands.length) return `NASA has no data for ${when()}.`;
  const top = st.bands.reduce((a, b) => (b.mean > a.mean ? b : a));
  const here = currentValue() ?? boxMean(state.yi, state.lat, state.lon, 4), name = placeName(state.lat, state.lon); // same value as the "now hearing" card
  const near = name.replace(/^near /, ''); // placeName says "near X" when far from X; the sentences below add their own "Near"
  if (state.track.kind === 'ocean') return `The warmest water is in ${top.name}. The coldest is near the poles. Near ${near}: ${feeling(here).toLowerCase()}.`;
  if (state.track.kind === 'lightning') return `In ${when()}${kind().partYears?.[year()] ? ` (${kind().partYears[year()]})` : ''}, NASA saw the most lightning in ${top.name}. Near ${near}: ${feeling(here).toLowerCase()}.`;
  const overall = st.mean < -0.3 ? 'most of the world was colder than normal' : st.mean < 0.3 ? 'the world as a whole was about normal'
    : st.mean < 1 ? 'most of the world was warmer than normal' : 'most of the world was much warmer than normal';
  const extra = state.track.kind === 'combo' ? ` ${comboDetail(here, { lat: state.lat, lon: state.lon }).split(' · ').slice(1).map(x => x[0].toUpperCase() + x.slice(1)).join('. ')}.` : '';
  return `In ${when()}, ${overall}. The warmest part was ${top.name}. Near ${near}, it was ${feeling(here).toLowerCase()}.${extra}`;
}

// ---------- speech ----------
let voicePick = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voicePick = vs.find(v => /en-(US|GB|AU)/i.test(v.lang) && /Samantha|Google|Natural|Daniel|Karen/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
const hasHan = t => /[\u3400-\u9fff]/.test(t); // Chinese characters
const zhVoice = () => { const vs = speechSynthesis.getVoices(); return vs.find(v => /^zh[-_](CN|Hans)/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null; };
function announce(text) { const el = $('#live'); el.lang = hasHan(text) ? 'zh' : 'en'; el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); }
function speak(text, { interrupt = true } = {}) {
  announce(text);
  if (!state.voice || !('speechSynthesis' in window)) return Promise.resolve();
  if (interrupt) speechSynthesis.cancel();
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text), zh = hasHan(text), v = zh ? zhVoice() : voicePick;
    if (v) u.voice = v;
    u.lang = v?.lang || (zh ? 'zh-CN' : 'en-US'); u.rate = zh ? 1 : 1.05;
    u.onend = res; u.onerror = res;
    setTimeout(res, 400 + text.length * (zh ? 260 : 75)); // never hang if the engine stays silent
    speechSynthesis.speak(u);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- drawing ----------
function frameImage(yi, T = state.track) {
  const y = T.years[yi], key = `${T.id}/${y}`;
  if (!state.images.has(key)) {
    const img = new Image(); img.decoding = 'async';
    img.src = `assets/${T.frameDir || T.id}/frames/${y}.jpg`;
    img.onload = () => { if (!isImage() && `${state.track.id}/${year()}` === key) draw(); };
    state.images.set(key, img);
  }
  return state.images.get(key);
}
function preloadAll() { // keeps loading this track's frames even if the listener switches tracks meanwhile
  const T = state.track; T.years.forEach((_, i) => setTimeout(() => frameImage(i, T), i * 40));
}

function sizeCanvas(w, h) {
  const c = $('#map');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.aspectRatio = `${w} / ${h}`; }
}
function ring(g, x, y, r) {
  g.lineWidth = 5; g.strokeStyle = '#0A0F18'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5; g.strokeStyle = '#FFFFFF'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}
function draw() {
  const c = $('#map'), g = c.getContext('2d');
  if (isImage()) {
    if (!src.canvas) { sizeCanvas(1440, 720); g.fillStyle = '#05080F'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#A9B5C8'; g.font = '36px system-ui'; g.textAlign = 'center'; g.fillText('Paste or drop a NASA picture with a color bar', c.width / 2, c.height / 2); return; }
    sizeCanvas(src.width, src.height);
    g.drawImage(src.canvas, 0, 0);
    const { p0, p1 } = state.cal, r = Math.max(8, src.width / 120);
    g.save();
    if (p0 && p1) { g.setLineDash([10, 7]); g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke(); g.setLineDash([]); }
    [p0, p1].forEach(p => p && ring(g, p.x, p.y, r));
    if (src.legend) { const x = state.u * src.width, y = state.v * src.height; g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, src.height); g.stroke(); ring(g, x, y, r * 1.4); }
    g.restore();
    return;
  }
  // track mode: wrap this year's NASA frame onto the globe (or the nearest year already loaded)
  const img = frameImage(state.yi);
  const texKey = `${state.track.id}/${year()}${monthOn() ? `/m${state.month}` : ''}`;
  if (monthOn()) { if (state.texYear !== texKey) { const tex = monthTexture(img); if (tex) { globe.setTexture(tex); state.texYear = texKey; } } }
  else if (img.complete && img.naturalWidth) { if (state.texYear !== texKey) { globe.setTexture(img); state.texYear = texKey; } }
  else if (state.texYear == null || !state.texYear.startsWith(state.track.id)) {
    for (let d = 1; d < 15; d++) { const alt = state.images.get(`${state.track.id}/${state.track.years[state.yi - d]}`); if (alt?.complete && alt.naturalWidth) { globe.setTexture(alt); break; } }
  }
  globe.setMarker(state.lat, state.lon);
  const label = state.monthLabel || when();
  $('#yearBig').textContent = label; $('#yearOut').textContent = label;
  $('#year').value = sliderValue(); $('#year').setAttribute('aria-valuetext', label);
  $('#wholeYear').hidden = !monthOn() || state.playing;
}

// A map of one month: temperature drawn from NASA's monthly numbers in the yearly map's colors, with NASA's coastlines;
// lightning: that month's lightning laid brightly over the dimmed yearly picture.
let coastMask = null, monthCanvas = null;
function monthTexture(img) {
  const T = state.track;
  if (!img.complete || !img.naturalWidth) return null;
  if (dataId(T) === 'temperature' ? !yearLoaded(year()) : !lightningByCell) return null;
  monthCanvas ||= Object.assign(document.createElement('canvas'), { width: 720, height: 360 });
  const g = monthCanvas.getContext('2d', { willReadFrequently: true });
  if (dataId(T) === 'temperature') {
    if (!coastMask) { g.drawImage(img, 0, 0, 720, 360); const d = g.getImageData(0, 0, 720, 360).data; coastMask = new Uint8Array(720 * 360); for (let i = 0; i < coastMask.length; i++) coastMask[i] = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < 70 ? 1 : 0; }
    const stops = T.stops, col = v => {
      if (v == null) return [128, 128, 128];
      if (v <= stops[0].value) return stops[0].rgb;
      for (let i = 1; i < stops.length; i++) if (v <= stops[i].value) { const a = stops[i - 1], b = stops[i], k = (v - a.value) / (b.value - a.value); return a.rgb.map((c, j) => c + (b.rgb[j] - c) * k); }
      return stops[stops.length - 1].rgb;
    };
    const cells = Array.from({ length: 16200 }, (_, i) => col(cellValue(state.yi, i)));
    const out = g.createImageData(720, 360), o = out.data;
    for (let py = 0; py < 360; py++) for (let px = 0; px < 720; px++) {
      const p = py * 720 + px, c = coastMask[p] ? [15, 15, 15] : cells[(py >> 2) * 180 + (px >> 2)];
      o[p * 4] = c[0]; o[p * 4 + 1] = c[1]; o[p * 4 + 2] = c[2]; o[p * 4 + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  } else {
    g.drawImage(img, 0, 0, 720, 360); g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(0, 0, 720, 360);
    for (let i = 0; i < 16200; i++) { const v = cellValue(state.yi, i); if (v > 0) { g.fillStyle = `rgba(255,226,70,${(0.25 + 0.75 * v).toFixed(2)})`; g.fillRect((i % 180) * 4, Math.floor(i / 180) * 4, 4, 4); } }
  }
  return monthCanvas;
}

function drawLegend() {
  const c = $('#legend'), g = c.getContext('2d');
  const stops = isImage() ? src.legend?.stops : state.track.stops;
  g.clearRect(0, 0, c.width, c.height);
  if (!stops) { $('#lgMin').textContent = $('#lgMid').textContent = $('#lgMax').textContent = ''; return; }
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), `rgb(${s.rgb.join(',')})`));
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  const { min, max } = scale();
  const L = kind().legend;
  $('#lgMin').textContent = isImage() ? `Low: ${fmt(min)}` : L[0];
  $('#lgMid').textContent = isImage() ? '' : L[1];
  $('#lgMax').textContent = isImage() ? `High: ${fmt(max)}` : L[2];
}

// ---------- readout ----------
function updateReadout({ play = true, speakIt = false, sayShort = false } = {}) {
  if (isImage() && !src.legend) return null;
  const v = currentValue(), place = currentPlace();
  showValue(v, place);
  if (play) { if (v == null && state.track.kind !== 'combo') sound.noData({ pan: currentPan() }); else playValue(tOf(v), { pan: currentPan(), soft: true, at: { lat: state.lat, lon: state.lon }, v }); score.live(stepOf(v), shortPlace(place)); }
  const inWhen = isImage() ? '' : ` in ${when()}`;
  if (speakIt) speak(`${place}${inWhen}. ${feeling(v)}${v == null ? '' : `, ${say(v)}`}.`); else (sayShort ? speak : announce)(`${place}. ${feeling(v)}.`); // sayShort: arrow keys and Controls, so the voice guide says where you went
  return v;
}
// The "now hearing" card glows from ice blue (low) to ember (high), like NASA's colour bar.
function toneFor(v) {
  if (v == null) return '#6F8299';
  const t = Math.max(0, Math.min(1, tOf(v)));
  const stops = [[0, [110, 166, 214]], [0.5, [233, 227, 214]], [0.75, [232, 131, 74]], [1, [196, 71, 31]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (t - a) / (b - a);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`;
  }
  return 'rgb(196,71,31)';
}
function comboDetail(v, at) { // "+0.9 °C vs normal · sea 30 °C · lots of lightning"
  const sea = seaNear(at.lat, at.lon), lt = lightningAt(at.lat, at.lon);
  return [v == null ? 'no temperature data' : `${fmt(v)} vs normal`, sea == null ? 'no sea nearby' : `sea ${Math.round(sea)} °C`,
    lt == null ? 'lightning not seen from the ISS' : KINDS.lightning.words(lt).toLowerCase()].join(' · ');
}
function showValue(v, place, at = null) {
  $('#nowBox').style.setProperty('--tone', toneFor(v));
  if (place) $('#rPlace').textContent = place;
  if (!isImage() && state.track?.kind === 'combo') { $('#rValue').textContent = feeling(v); $('#rDetail').textContent = comboDetail(v, at || { lat: state.lat, lon: state.lon }); return; }
  if (v == null && !monthCovered()) { $('#rValue').textContent = 'No data for this month'; $('#rDetail').textContent = `NASA's data does not cover ${when()}`; return; }
  $('#rValue').textContent = feeling(v);
  $('#rDetail').textContent = v == null ? (isImage() ? 'Not a color on the color bar' : kind().noData) : isImage() ? fmt(v) : kind().detail(v, fmt(v));
}
// Plain words first; the number is shown smaller underneath.
function feeling(v, k = isImage() ? null : kind()) {
  if (v == null && !isImage() && !monthCovered()) return 'No data for this month';
  if (v == null) return k?.noDataWord || 'No data';
  if (!k) {
    const t = tOf(v);
    return t < 0.15 ? 'Very low' : t < 0.4 ? 'Low' : t < 0.6 ? 'In the middle' : t < 0.85 ? 'High' : 'Very high';
  }
  return k.words(v);
}
// Each track has its own instrument (see tracks.js).
// "All three": the nearest sea (searching wider until there is water) and lightning (that year if the ISS saw it, else its 2017-2023 average)
function seaNear(lat, lon) { const O = state.tracks.ocean; if (!O) return null; for (const r of [4, 8, 14]) { const v = boxMean(0, lat, lon, r, O); if (v != null) return v; } return null; }
const seaT = v => { const O = state.tracks.ocean; return (v - O.min) / (O.max - O.min); };
function lightningAt(lat, lon, y = year()) {
  const L = state.tracks.lightning; if (!L) return null;
  const yi = L.years.indexOf(y); if (yi >= 0) return boxMean(yi, lat, lon, 4, L);
  let sum = 0, n = 0; L.years.forEach((_, i) => { const v = boxMean(i, lat, lon, 4, L); if (v != null) { sum += v; n++; } });
  return n ? sum / n : null;
}
function playCombo(lat, lon, v, { pan = 0, soft = false } = {}) {
  if (v == null) sound.noData({ pan }); else if (soft) sound.note(tOf(v), { pan }); else sound.tap(tOf(v), { pan });
  const at = sound.now, sea = seaNear(lat, lon), lt = lightningAt(lat, lon);
  if (sea != null) sound.harp(seaT(sea), { pan, when: at + 0.12, gain: 0.4 });
  if (lt != null) sound.drum(lt, { pan, when: at + 0.24, gain: 0.5 });
}
function playValue(t, { pan = 0, soft = false, at = null, v = null } = {}) {
  const inst = isImage() ? 'mallet' : kind().instrument;
  if (inst === 'combo' && at) { playCombo(at.lat, at.lon, v, { pan, soft }); return; }
  if (inst === 'harp') sound.harp(t, { pan });
  else if (inst === 'drum') sound.drum(t, { pan });
  else if (soft) sound.note(t, { pan }); else sound.tap(t, { pan });
}
function moveTo(lat, lon, opts = {}) {
  $('#nowBox').hidden = false;
  state.lat = Math.max(-89, Math.min(89, lat)); state.lon = ((lon + 540) % 360) - 180;
  if (opts.center && !isImage()) globe.centerOn(state.lat, state.lon);
  draw(); return updateReadout(opts);
}

// ---------- play the Earth like an instrument ----------
function tapAt(lat, lon, { record = true } = {}) {
  $('#nowBox').hidden = false;
  state.lat = lat; state.lon = lon;
  const v = trackValue(state.yi, lat, lon), pan = panFor(lat, lon);
  if (v == null && state.track.kind !== 'combo') sound.noData({ pan }); else playValue(tOf(v), { pan, at: { lat, lon }, v });
  const label = shortPlace(placeName(lat, lon));
  if (state.replaying) score.add(stepOf(v), label); else score.live(stepOf(v), label, { tap: true });
  globe.ripple(lat, lon);
  draw(); updateReadout({ play: false });
  if (record) {
    const now = performance.now();
    const gap = state.taps.length ? Math.min(1200, now - state.lastTapAt) : 0;
    state.lastTapAt = now;
    state.taps.push({ gap, lat, lon });
    if (state.taps.length > 32) state.taps.shift();
    updateTapUI();
    guideAfterTap(v);
  }
}
function updateTapUI() {
  const n = state.taps.length;
  $('#replayBtn').disabled = n === 0; $('#clearBtn').disabled = n === 0;
}
async function replayTaps() {
  if (state.replaying || !state.taps.length) return;
  state.replaying = true; $('#replayBtn').disabled = true;
  announce(`Playing your tune in ${year()}.`);
  score.take(String(year()), state.taps.length);
  for (const t of state.taps) {
    await sleep(Math.max(250, Math.min(700, t.gap)));
    tapAt(t.lat, t.lon, { record: false });
  }
  await sleep(500);
  state.replaying = false; updateTapUI();
}

// ---------- step-by-step guide (first visit) ----------
const guide = { step: 1, done: false };
function setGuide({ label, title, text, btn, alt, say }) {
  $('#guideStep').textContent = label || '';
  $('#guideTitle').textContent = title; $('#guideText').textContent = text || '';
  for (const [id, b] of [['#guideBtn', btn], ['#guideAlt', alt]]) {
    const el = $(id); el.hidden = !b; el.disabled = false;
    if (b) { el.textContent = b[0]; el.onclick = async () => { sound.start(); el.disabled = true; await b[1](); }; }
  }
  speak(say || `${title}. ${text || ''}`);
}
function resetGuide() {
  state.taps = []; updateTapUI(); guide.step = 1; globe.clearStrokes(); score.clear();
  setGuide({ label: 'Step 1 of 3', title: 'Tap 3 places on the Earth', text: 'Every place plays a note. Warmer places play higher notes. Your 3 notes become a tune.',
    say: state.voice ? 'Move your mouse or finger over the Earth to hear it. Warmer places play higher notes. Stop for a moment, and I will tell you where you are. To make a tune, add 3 places: tap a place, or press Add this place in Controls, at the top of the page.' : null });
}
function guideAfterTap(v) {
  if (state.mode !== 'track' || guide.step !== 1 || state.track.id !== 'temperature') return;
  const n = state.taps.length, place = placeName(state.lat, state.lon);
  if (n < 3) {
    setGuide({ label: 'Step 1 of 3', title: n === 1 ? 'Nice! Tap 2 more places' : 'Tap 1 more place', text: `That was ${place}: ${feeling(v).toLowerCase()}.`,
      say: state.voice ? `That was ${place}: ${feeling(v).toLowerCase()}. ${n === 1 ? 'Add 2 more places.' : 'Add 1 more place.'}` : null });
    return;
  }
  guide.step = 2;
  setGuide({
    label: 'Step 2 of 3', title: 'Now go back in time',
    text: `You made a tune of ${n} notes. Let's hear the same tune in 1880, before the Earth warmed up.`,
    btn: ['Play my tune in 1880', async () => { await playTuneIn(1880); guideStep3(); }],
  });
}
function guideStep3() {
  guide.step = 3;
  setGuide({
    label: 'Step 3 of 3', title: 'Now hear it today',
    text: 'Same places, same tune. This time in 2025. Listen: is it higher?',
    btn: ['Play my tune in 2025', async () => { await playTuneIn(2025); guideDone(); }],
  });
}
function guideDone() {
  guide.step = 4; guide.done = true; $('.timeline').hidden = state.track.years.length < 2;
  // compare only the places NASA measured in both years, so a place with no 1880 data can't tip the answer
  const i0 = yearIndexOf(1880), i1 = yearIndexOf(2025);
  const pairs = state.taps.map(t => [boxMean(i0, t.lat, t.lon, 4), boxMean(i1, t.lat, t.lon, 4)]).filter(([x, y]) => x != null && y != null);
  const d = pairs.length ? pairs.reduce((s, [x, y]) => s + y - x, 0) / pairs.length : null;
  score.setNote(d == null ? '' : `Your places: about ${Math.abs(d).toFixed(1)} °C ${d >= 0 ? 'warmer' : 'cooler'} than in 1880`);
  const text = d == null ? 'NASA has no 1880 data for some of your places, so try places with more history, like Europe or the USA.'
    : d > 0.2 ? `Your tune went higher. The places you chose are about ${d.toFixed(1)} °C warmer than in 1880${pairs.length < state.taps.length ? ' (counting only places NASA measured back then)' : ''}. That is what climate change sounds like.`
      : d < -0.2 ? `Your tune went lower. The places you chose were cooler in 2025 than in 1880, which is rare. Most of the world got warmer.`
        : 'Your tune stayed about the same. These places changed less than most of the world. Try tapping the Arctic.';
  setGuide({
    label: 'You did it', title: d != null && d > 0.2 ? 'Did you hear it go higher?' : 'What did you hear?', text,
    btn: ['Make my own Earth song', async () => setMode('song')],
    alt: ['Try other places', async () => resetGuide()],
  });
}
async function playTuneIn(y) {
  state.yi = yearIndexOf(y); state.month = null; draw(); updateReadout({ play: false }); // the guide compares whole years
  $('#guideTitle').textContent = `Playing your tune in ${y}…`;
  await replayTaps();
}
function yearIndexOf(y, T = state.track) { return Math.max(0, T.years.indexOf(y)); }
// nearest year this track has (a moment in 2026 shows the 2025 map; its sound uses NASA's monthly data)
function yearIndexNear(y, T = state.track) { const i = T.years.indexOf(y); return i >= 0 ? i : y > T.years[T.years.length - 1] ? T.years.length - 1 : 0; }
function moveUV(u, v, opts) {
  state.u = Math.max(0, Math.min(1, u)); state.v = Math.max(0, Math.min(1, v));
  draw(); return updateReadout(opts);
}
async function setYear(yi, month = state.month) {
  if (isImage()) return;
  state.yi = Math.max(0, Math.min(state.track.years.length - 1, yi));
  state.month = hasMonths() ? month : null;
  await ensureMonthData();
  draw(); updateReadout({ play: true });
  if (guide.done) $('#desc').textContent = describe(); // keep the sentence under the card in step with the year bar
  announce(`${when()}. ${placeName(state.lat, state.lon)}: ${fmt(currentValue())}.`);
}

// ---------- actions ----------
// ---------- Play, month by month ----------
// NASA monthly data for one place, fetched cell by cell (by-cell.bin holds every month of cell 0, then of cell 1, ...),
// so only the few cells around the place are downloaded (an HTTP range request; about 60 KB for temperature).
const MONTH_SERIES = {
  temperature: { dir: 'assets/temperature/monthly', decode: (c, m) => m.encoding.offset + (c - 1) * m.encoding.step, first: m => [m.firstYear, 1], stepMs: 17 },
  lightning: { dir: 'assets/lightning/monthly', decode: c => (c - 1) / 254, first: m => [m.firstYear, m.firstMonth], stepMs: 300 },
};
const seriesMeta = {}, seriesFull = {};
async function monthSeriesAt(id, lat, lon, r = 6) {
  const cfg = MONTH_SERIES[id], T = state.tracks[id]; if (!cfg || !T) return null;
  const meta = seriesMeta[id] ||= await fetch(`${cfg.dir}/meta.json`).then(res => res.json());
  const N = meta.monthsPerCell, cells = [];
  for (let la = lat - r + 1; la <= lat + r; la += 2) { // the same box as boxMean()
    if (la < -90 || la > 90) continue;
    for (let lo = lon - r + 1; lo <= lon + r; lo += 2) cells.push({ idx: cellIndex(la, lo, T), k: Math.cos(la * Math.PI / 180) });
  }
  const ids = [...new Set(cells.map(c => c.idx))].sort((a, b) => a - b), runs = [], bytes = new Map();
  for (const i of ids) { const last = runs[runs.length - 1]; if (last && i === last[1] + 1) last[1] = i; else runs.push([i, i]); }
  for (const [a, b] of runs) { // one request per run of neighbouring cells
    let buf;
    if (seriesFull[id]) buf = seriesFull[id].subarray(a * N, (b + 1) * N);
    else {
      const res = await fetch(`${cfg.dir}/by-cell.bin`, { headers: { Range: `bytes=${a * N}-${(b + 1) * N - 1}` } });
      if (!res.ok) throw new Error('No monthly data');
      const arr = new Uint8Array(await res.arrayBuffer());
      if (res.status === 206) buf = arr; else { seriesFull[id] = arr; buf = arr.subarray(a * N, (b + 1) * N); } // a server without range support sends it all
    }
    for (let i = a; i <= b; i++) bytes.set(i, buf.subarray((i - a) * N, (i - a + 1) * N));
  }
  const [fy, fm] = cfg.first(meta), out = [];
  for (let k = 0; k < N; k++) {
    let sum = 0, w = 0;
    for (const c of cells) { const code = bytes.get(c.idx)[k]; if (code) { sum += cfg.decode(code, meta) * c.k; w += c.k; } }
    const mm = fm - 1 + k; out.push({ year: fy + Math.floor(mm / 12), month: mm % 12 + 1, v: w ? sum / w : null });
  }
  return out;
}
async function playMonths(series, place) {
  const T = state.track, cfg = MONTH_SERIES[dataId(T)], inst = kind().instrument, n = series.length, step = cfg.stepMs / 1000;
  // "All three": the sea on the harp every January, and lightning on the drums for the months the ISS saw (Mar 2017 to Aug 2023)
  let sea = null, lmap = null;
  if (inst === 'combo') {
    sea = seaNear(state.lat, state.lon);
    try { lmap = new Map((await monthSeriesAt('lightning', state.lat, state.lon, 6)).map(q => [`${q.year}-${q.month}`, q.v])); } catch { lmap = null; }
  }
  const lab = p => `${MON[p.month - 1]} ${p.year}`;
  const slow = cfg.stepMs > 100; // lightning: slow enough to show each month's own map
  if (slow) await loadLightningMonths();
  score.line(`${shortPlace(place)}, every month`, n, lab(series[0]), lab(series[n - 1]));
  const t0 = sound.now + 0.15, start = performance.now() + 150;
  let scheduled = 0, shown = -1;
  while (state.playing) {
    const elapsed = (performance.now() - start) / 1000;
    while (scheduled < n && scheduled * step < elapsed + 0.3) { // sound is scheduled a little ahead, so it stays steady
      const p = series[scheduled], when = t0 + scheduled * step;
      if (p.v != null) {
        if (inst === 'drum') sound.drum(tOf(p.v), { when }); // more lightning, more drum hits
        else sound.note(tOf(p.v), { when, dur: Math.max(0.07, step * 2), gain: 0.3, layers: false });
      }
      if (inst === 'combo') {
        if (p.month === 1 && sea != null) sound.harp(seaT(sea), { when, gain: 0.22 });
        const lv = lmap?.get(`${p.year}-${p.month}`); if (lv != null && lv >= 0.15) sound.kick({ when, gain: 0.15 + 0.3 * lv });
      }
      if (p.month === 1 && p.year % 50 === 0) sound.tick({ when });
      scheduled++;
    }
    const now = Math.max(0, Math.min(n - 1, Math.floor(elapsed / step)));
    if (now > shown) {
      score.putMany(series.slice(shown + 1, now + 1).map((p, j) => [shown + 1 + j, stepOf(p.v)]));
      const p = series[now], yi = T.years.indexOf(p.year);
      if (slow && yi >= 0) { state.yi = yi; state.month = p.month; draw(); } // each month's own map
      else if (yi >= 0 && yi !== state.yi) { state.yi = yi; draw(); } // fast: that year's map
      state.monthLabel = lab(p); $('#yearBig').textContent = state.monthLabel; $('#yearOut').textContent = state.monthLabel;
      $('#year').value = yi * 12 + p.month - 1;
      showValue(p.v);
      for (let i = shown + 1; i <= now; i++) { const q = series[i]; if (q.month === 1 && (cfg.stepMs > 100 || q.year % 50 === 0)) announce(String(q.year)); }
      shown = now;
    }
    if (shown >= n - 1 && elapsed > n * step + 0.2) break;
    await sleep(20);
  }
  state.monthLabel = null; state.month = null;
}

// ---------- Fly with the Space Station ----------
// One orbit like the ISS's: a circle tilted 51.6° to the equator, once every 92.9 minutes, while the Earth turns
// underneath (so each orbit lands about 23° further west). The orbit is placed so it passes over the place you picked;
// the ISS never flies further north or south than 51.6°, so for places beyond that it passes as close as it can.
// It fits the data: NASA's lightning track was seen from the ISS, and the background photo was taken from it.
const ISS = { inc: 51.64, periodMin: 92.9, earthDegPerMin: 360 / 1436.07, steps: 120, stepMs: 125 };
function issTrack(lat, lon) {
  const i = ISS.inc * Math.PI / 180, latP = Math.max(-ISS.inc + 0.05, Math.min(ISS.inc - 0.05, lat)) * Math.PI / 180;
  const u0 = Math.asin(Math.sin(latP) / Math.sin(i)), node = lon - Math.atan2(Math.cos(i) * Math.sin(u0), Math.cos(u0)) * 180 / Math.PI;
  const pts = [];
  for (let k = 0; k <= ISS.steps; k++) {
    const f = k / ISS.steps - 0.5, u = u0 + 2 * Math.PI * f; // half an orbit before the place, half after
    const la = Math.asin(Math.sin(i) * Math.sin(u)) * 180 / Math.PI;
    const lo = node + Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)) * 180 / Math.PI - ISS.earthDegPerMin * f * ISS.periodMin;
    pts.push({ lat: la, lon: ((lo + 540) % 360) - 180, min: f * ISS.periodMin });
  }
  return { pts, over: Math.abs(lat) <= ISS.inc };
}
function setIssUI(on) { const b = $('#issBtn'); b.textContent = on ? 'Stop' : 'Fly with the Space Station'; b.setAttribute('aria-pressed', on); }
async function flyISS() {
  if (isImage()) return;
  if (state.playing) { state.playing = false; return; }
  state.playing = true; setIssUI(true); $('#playBtn').disabled = true;
  const place = placeName(state.lat, state.lon), { pts, over } = issTrack(state.lat, state.lon), kd = state.track.kind;
  globe.clearStrokes(); globe.startStroke(); pts.forEach(p => globe.addPoint(p.lat, p.lon)); // the orbit line
  $('#nowBox').hidden = false; $('#globeHint').hidden = true;
  await speak(over ? `One orbit with the Space Station, passing over ${place}.` : `The Space Station never flies over ${place}. This orbit passes as close as it can.`);
  score.line('One orbit with the Space Station', pts.length, '−46 min', '+46 min');
  let best = null, bestSea = null, bestLt = null;
  for (let k = 0; k < pts.length && state.playing; k++) {
    const p = pts[k], v = trackValue(state.yi, p.lat, p.lon);
    if (kd === 'combo') { // all three: also remember the warmest sea and the most lightning under the orbit
      const o = boxMean(0, p.lat, p.lon, 2, state.tracks.ocean), l = lightningAt(p.lat, p.lon);
      if (o != null && (!bestSea || o > bestSea.v)) bestSea = { ...p, v: o };
      if (l != null && (!bestLt || l > bestLt.v)) bestLt = { ...p, v: l };
    }
    if (v != null || kd === 'combo') playValue(tOf(v), { pan: 0, at: p, v }); if (v != null && (!best || v > best.v)) best = { ...p, v };
    globe.setMarker(p.lat, p.lon); globe.centerOn(p.lat, p.lon, ISS.stepMs);
    if (k % 12 === 0) globe.ripple(p.lat, p.lon);
    showValue(v, placeName(p.lat, p.lon), p); score.put(k, stepOf(v));
    await sleep(ISS.stepMs);
  }
  const finished = state.playing;
  state.playing = false; setIssUI(false); $('#playBtn').disabled = false;
  globe.setMarker(state.lat, state.lon); globe.centerOn(state.lat, state.lon, 600); draw(); updateReadout({ play: false });
  if (!finished) return;
  const top = best ? `${kd === 'lightning' ? 'The most lightning' : kd === 'ocean' ? 'The warmest water' : 'The warmest place'} under it was ${placeName(best.lat, best.lon)} (${fmt(best.v)}).` : 'NASA has no data along this orbit.';
  const more = kd === 'combo' ? [bestSea && `The warmest sea was ${placeName(bestSea.lat, bestSea.lon)} (${Math.round(bestSea.v)} °C).`, bestLt && `The most lightning was ${placeName(bestLt.lat, bestLt.lon)}.`].filter(Boolean).join(' ') : '';
  const msg = `That was one orbit of the Space Station: about 93 minutes, played in 15 seconds${over ? `, right over ${place}` : ''}. ${top}${more ? ' ' + more : ''}`;
  $('#desc').textContent = msg; speak(msg);
}

async function playHistory({ quiet = false } = {}) {
  if (isImage()) return;
  if (state.playing) { state.playing = false; return; }
  state.playing = true; state.month = null; state.hist = null; setPlayingUI(true); draw();
  const place = placeName(state.lat, state.lon), years = state.track.years;
  if (!quiet) await speak(`${place}, ${when(0)} to ${when(years.length - 1)}.`);
  const short = years.length < 40, inst = kind().instrument; // a short series (lightning: 7 years) plays slower, one year at a time
  let series = null;
  if (MONTH_SERIES[dataId()] && state.playing) {
    try { series = (await monthSeriesAt(dataId(), state.lat, state.lon, 6))?.filter(p => p.year >= years[0] && p.year <= years[years.length - 1]); } catch { series = null; }
  }
  if (series?.length && state.playing) await playMonths(series, place);
  else score.line(`${shortPlace(place)}, every year`, years.length, when(0), when(years.length - 1));
  for (let i = 0; i < years.length && state.playing && !series?.length; i++) { // one note per year if the monthly data can't be loaded
    state.yi = i; draw();
    const v = boxMean(i, state.lat, state.lon, 6);
    if (v == null) sound.noData();
    else if (inst === 'drum') sound.drum(tOf(v)); // each track keeps its own instrument: more lightning, more drum hits
    else if (inst === 'harp') sound.harp(tOf(v));
    else sound.note(tOf(v), { dur: short ? 0.4 : 0.16, gain: 0.45 });
    score.put(i, stepOf(v));
    if (short) announce(`${when(i)}. ${feeling(v)}.`);
    else if (years[i] % 50 === 0) { sound.tick({ when: sound.now + 0.08 }); announce(String(years[i])); }
    showValue(v);
    await sleep(short ? 650 : 140);
  }
  const finished = state.playing;
  state.playing = false; setPlayingUI(false); draw();
  if (!finished) return;
  const avg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) { const v = boxMean(i, state.lat, state.lon, 6); if (v != null) { s += v; n++; } } return n ? s / n : null; };
  // compare the start with the end: the first and last 10 years of a long series, the first and last year of a short one
  const L = years.length, n = short ? 1 : 10, mo = null;
  // short series: the first and last year that have data (a month can be missing at the start or end)
  const has = i => boxMean(i, state.lat, state.lon, 6) != null;
  const i0 = short ? Math.max(0, years.findIndex((_, i) => has(i))) : 0, i1 = short ? Math.max(i0, L - 1 - [...years].reverse().findIndex((_, j) => has(L - 1 - j))) : L - 1;
  const first = avg(i0, i0 + n - 1), last = avg(i1 - n + 1, i1);
  const msg = first != null && last != null
    ? (state.track.kind === 'temperature'
      ? `Near ${place}: ${mo ? `${mo} in the 1880s was` : 'the 1880s were'} ${feeling(first).toLowerCase()}. ${mo ? `${mo} in recent years is` : 'Today it is'} ${feeling(last).toLowerCase()}. That is about ${Math.abs(last - first).toFixed(1)} °C ${last >= first ? 'warmer' : 'cooler'} than in the 1880s.`
      : `Near ${place}: ${feeling(first).toLowerCase()} in ${when(i0)}, ${feeling(last).toLowerCase()} in ${when(i1)}.`)
    : `NASA has no measurements near ${place} ${short ? 'in these years' : 'in the early years'}, so we can't compare then and now. Try another place.`;
  state.hist = { first, last, i0, i1, short };
  $('#desc').textContent = msg; if (!quiet) speak(msg);
  if (first != null && last != null && state.track.kind === 'temperature') score.setNote(`About ${Math.abs(last - first).toFixed(1)} °C ${last >= first ? 'warmer' : 'cooler'} than in the 1880s`);
}
function setPlayingUI(on) { const b = $('#playBtn'), y = state.track.years; b.textContent = on ? 'Stop' : `Play ${y[0]} → ${y[y.length - 1]}`; b.setAttribute('aria-pressed', on); }

async function sweep() {
  if (state.busy || (isImage() && !src.legend)) return;
  state.busy = true;
  if (isImage()) {
    const u0 = state.u;
    await speak('Sweeping left to right.');
    score.line('Left to right', 61, 'left', 'right'); let k = 0;
    for (let u = 0; u <= 1.0001; u += 1 / 60) {
      state.u = Math.min(1, u); draw();
      const v = src.valueAt(state.u, state.v);
      if (v == null) sound.noData({ pan: u * 2 - 1 }); else sound.note(tOf(v), { pan: u * 2 - 1, dur: 0.12, gain: 0.4, layers: false });
      score.put(Math.min(60, k++), stepOf(v));
      await sleep(85);
    }
    state.u = u0;
  } else {
    // one full turn of the Earth along this latitude, starting and ending where you are
    const lat = state.lat, lon0 = state.lon;
    await speak('Spinning the Earth. Listen as we go around.');
    score.line('One trip around the Earth', 61, shortPlace(placeName(lat, lon0)), 'back again');
    for (let k = 0; k <= 60; k++) {
      state.lon = ((lon0 + k * 6 + 540) % 360) - 180;
      globe.centerOn(lat, state.lon, 80); draw();
      const v = trackValue(state.yi, lat, state.lon);
      if (v == null) sound.noData(); else sound.note(tOf(v), { dur: 0.12, gain: 0.4, layers: false });
      score.put(k, stepOf(v));
      await sleep(85);
    }
    state.lon = lon0;
  }
  draw(); updateReadout({ play: false }); state.busy = false;
}

async function hearLegend() {
  if (state.busy || !scale()) return;
  state.busy = true;
  const { min, max } = scale();
  const parts = isImage()
    ? [[0, `This low note means the lowest value on the color bar.`], [0.5, `This middle note means the middle of the color bar.`], [1, `This high note means the highest value.`]]
    : [[0, 'This low note means colder than normal.'], [0.5, 'This middle note means normal.'], [1, 'This high note means much hotter than normal. When it is very warm, a second voice joins in.']];
  for (const [t, text] of parts) { await speak(text); sound.note(t, { dur: 0.6 }); score.live(noteIndex(t), t === 0 ? 'low' : t === 1 ? 'high' : 'middle', { tap: true }); await sleep(900); }
  state.busy = false;
}

function setHint() { // the hint on the globe says how to listen; with Voice guide on, moving listens
  $('#globeHint .hint-mouse').textContent = state.voice ? 'Move the mouse to listen. Click to add a place.' : 'Tap to play. Drag to spin the Earth.';
  $('#globeHint .hint-touch').textContent = state.voice ? 'Slide a finger to listen. Two fingers spin.' : 'Tap to play. Drag to spin the Earth.';
}
function toggle(act) {
  if (act === 'voice') { state.voice = !state.voice; setHint(); if (!state.voice) speechSynthesis?.cancel(); speak(state.voice ? 'Voice guide on. I will read every step aloud.' : 'Voice guide off.'); }
  if (act === 'ref' && scale()) { state.ref = !state.ref; sound.reference(state.ref, isImage() ? 0.5 : tOf(0)); announce(state.ref ? 'Average hum on. It plays the middle note.' : 'Average hum off'); }
  document.querySelector(`[data-act="${act}"]`)?.setAttribute('aria-pressed', act === 'voice' ? state.voice : state.ref);
}
function act(name) {
  if (name === 'legend') hearLegend();
  if (name === 'sweep') sweep();
  if (name === 'describe') { const t = describe(); $('#desc').textContent = t; speak(t); }
  if (name === 'voice' || name === 'ref') toggle(name);
}

// ---------- your own map ----------
function setMode(mode) {
  if (state.playing) state.playing = false;
  stopSong();
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
  const img = isImage(), song = mode === 'song', ask = mode === 'ask', other = song || ask;
  $('#byo').hidden = !img; $('#songBox').hidden = !song; $('#askBox').hidden = !ask;
  $('#globeWrap').hidden = img; $('#mapWrap').hidden = !img; $('#issBtn').hidden = img;
  $('.timeline').hidden = img || state.track.years.length < 2; // always on screen whenever the map has more than one year
  document.querySelectorAll('[data-years]').forEach(b => { b.hidden = img || state.track.years.length < 2; });
  $('#trackPicker').hidden = img || other;
  $('#guide').hidden = img || other; $('#moreBox').hidden = img || other;
  if (!img && !other) $('#nowBox').hidden = state.taps.length === 0 && !guide.done;
  if (ask) $('#nowBox').hidden = !state.asked;
  $('#trackTitle').textContent = img ? (src.canvas ? `Your map: ${src.name}` : 'Your own NASA map') : song ? 'My Earth song' : ask ? 'Ask the Earth' : state.track.title;
  $('#trackSub').textContent = img ? 'Any NASA picture with a color bar' : song ? 'Years and places that matter to you, played as music' : ask ? 'Your question, answered with NASA data and played as sound' : state.track.subtitle;
  $('#trackEic').textContent = img || song ? '' : `From NASA's Earth Information Center: ${state.track.eic || 'EIC content'}`;
  if (song) renderMoments();
  $('#credit').innerHTML = img ? 'Picture supplied by you. Please credit its source, for example the NASA Scientific Visualization Studio page you copied it from.' : `${state.track.credit}. <a href="${state.track.sourceUrl}">${state.track.sourceUrl}</a>`;
  $('#map').setAttribute('aria-label', 'Your picture. After the color bar is marked, arrow keys move and Enter reads the spot.');
  $('#globe').setAttribute('aria-label', `${kind().label} globe. Arrow keys travel, `
    + (state.track.years.length > 1 ? 'square brackets change the year, ' : '') + 'Enter reads the spot, question mark for help. On a phone, use Controls at the top of the page.');
  if (!img) globe.request();
  score.clear(); score.setAxis(scoreAxis());
  draw(); drawLegend();
  if (img) { updateSteps(); if (src.legend) updateReadout({ play: false }); else clearReadout(); }
  else { updateReadout({ play: false }); $('#desc').textContent = ask ? '' : song || guide.done ? describe() : ''; }
  if (ask) setTimeout(() => $('#askText').focus(), 50);
}
function clearReadout() { ['#rPlace', '#rValue', '#rDetail'].forEach(s => { $(s).textContent = '—'; }); $('#desc').textContent = ''; }
function updateSteps() {
  const step = !src.canvas ? 0 : state.cal.step; // 0 no picture, 1 low end, 2 high end, 3 values, 4 ready
  [['#st1', 1], ['#st2', 2], ['#st3', 3]].forEach(([id, n]) => { const li = $(id); li.classList.toggle('current', step === n); li.classList.toggle('done', step > n); });
  $('#singBtn').disabled = step !== 3;
  if (step === 0) $('#byoStatus').textContent = 'Waiting for a picture.';
  else if (step === 1) $('#byoStatus').textContent = 'Click the low end of the color bar.';
  else if (step === 2) $('#byoStatus').textContent = 'Now click the high end.';
  else if (step === 3) $('#byoStatus').textContent = 'Check the two numbers, then press Make it sing.';
}
async function usePicture(blob) {
  if (!blob || !/^image\//.test(blob.type)) { $('#byoStatus').textContent = 'That is not a picture. Copy or drop an image file.'; return; }
  try { await src.load(blob); } catch (e) { $('#byoStatus').textContent = e.message; return; }
  state.cal = { step: 1, p0: null, p1: null }; state.u = 0.5; state.v = 0.4;
  if (!isImage()) setMode('image'); else setMode('image');
  speak('Picture loaded. A sighted helper now marks the color bar: click its low end, then its high end.');
}
function calibrationClick(e) {
  const r = $('#map').getBoundingClientRect();
  const p = { x: (e.clientX - r.left) / r.width * src.width, y: (e.clientY - r.top) / r.height * src.height };
  if (state.cal.step === 1) state.cal = { step: 2, p0: p, p1: null };
  else if (state.cal.step === 2) { state.cal.p1 = p; state.cal.step = 3; $('#vMin').focus(); $('#vMin').select(); }
  draw(); updateSteps();
}
function makeItSing() {
  const vmin = parseFloat($('#vMin').value), vmax = parseFloat($('#vMax').value), unit = $('#vUnit').value.trim();
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin === vmax) { $('#byoStatus').textContent = 'Type two different numbers for the low and high ends.'; return; }
  sound.start();
  src.calibrate(state.cal.p0, state.cal.p1, vmin, vmax, unit);
  state.cal.step = 4; updateSteps(); drawLegend();
  const secs = Math.round((src.readyAt - src.loadedAt) / 1000);
  const msg = `Ready. From picture to sound in ${secs} seconds. Move around to listen.`;
  $('#byoStatus').textContent = msg;
  $('#desc').textContent = describe();
  $('#map').focus();
  draw(); speak(msg).then(() => sweep());
}

// ---------- AI: a story becomes an Earth song ----------
async function storyToSong() {
  const text = $('#storyText').value.trim();
  if (!text) { $('#storyNote').textContent = 'Write a sentence or two first.'; return; }
  const btn = $('#storyBtn'); btn.disabled = true; $('#storyNote').textContent = 'Reading your story…';
  let moments = [], note = '', usedAI = false;
  try {
    if (aiReady()) {
      const r = await aiSong(text); usedAI = true; note = String(r.note || '').replace(/^[^\p{L}\p{N}]+/u, ''); // drop stray leading symbols
      moments = (r.moments || []).filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180)
        .map(m => {
          const month = m.month >= 1 && m.month <= 12 ? Math.round(m.month) : null, day = month && m.day >= 1 && m.day <= 31 ? Math.round(m.day) : null;
          return { year: Math.min(2026, Math.max(1880, Math.round(m.year))), month, day, name: String(m.place).slice(0, 40), lat: m.lat, lon: m.lon, label: String(m.label || '').slice(0, 60) };
        })
        .slice(0, 6);
    } else moments = storyWithoutAI(text);
  } catch (e) { moments = storyWithoutAI(text); note = `${e.message} I read your story without AI instead.`; }
  btn.disabled = false;
  if (!moments.length) { $('#storyNote').textContent = note || 'I could not find a year and a place. Try: "I was born in Sibu in 2006."'; return; }
  await prepareMoments(moments);
  moments.forEach(m => { if (m.year > lastMapYear() && !usesMonth(m)) { m.year = lastMapYear(); m.month = m.day = null; } }); // beyond NASA's data: use the latest year
  state.moments = moments; state.picking = null; renderMoments();
  $('#storyNote').textContent = `${usedAI ? 'AI found' : 'Found'} ${moments.length} moment${moments.length > 1 ? 's' : ''}. Check them below. ${note}`.trim();
  if (state.songPlaying) stopSong();
  playSong();
}

// ---------- AI: Ask the Earth ----------
// The AI only turns the question into a plan (which data, places, years). Earth Jukebox looks up
// the values in NASA's data, plays them, and writes the answer from those values.
const nearestYear = (T, y) => T.years.reduce((best, v) => (Math.abs(v - y) < Math.abs(best - y) ? v : best), T.years[0]);
function askTrack(id) {
  if (!state.tracks[id] || state.track.id === id) return;
  useTrack(id); preloadAll(); drawLegend(); score.setAxis(scoreAxis());
  $('#trackEic').textContent = `From NASA's Earth Information Center: ${state.track.eic || 'EIC content'}`;
}
async function playAt(p, yi, when = null) { // when = {year, month}: use NASA's monthly data for that month
  state.yi = yi; state.lat = p.lat; state.lon = p.lon;
  globe.centerOn(p.lat, p.lon, 450); draw(); await sleep(500);
  const v = when?.month ? monthBoxMean(when.year, when.month, p.lat, p.lon, 3) ?? monthValue(when.year, when.month, p.lat, p.lon)
    : boxMean(yi, p.lat, p.lon, 3) ?? trackValue(yi, p.lat, p.lon);
  if (v == null) sound.noData(); else playValue(tOf(v));
  globe.ripple(p.lat, p.lon); showValue(v, p.name);
  return v;
}
// Answers in Chinese when 中文 is chosen or the question is written in Chinese. Same NASA numbers, same rules.
const ZH_WORDS = { 'Much colder than normal': '比正常冷很多', 'Colder than normal': '比正常冷', 'About normal': '和正常差不多', 'Warmer than normal': '比正常暖',
  'Much warmer than normal': '比正常暖很多', 'Extremely warm': '非常暖', 'Icy water': '冰冷的海水', 'Cold water': '冷的海水', 'Cool water': '凉的海水',
  'Warm water': '暖的海水', 'Very warm water': '很暖的海水', 'Almost no lightning': '几乎没有闪电', 'A little lightning': '有一点闪电',
  'Some lightning': '有一些闪电', 'Lots of lightning': '闪电很多', 'A lightning hotspot': '闪电热点' };
const zhFeel = (v, k = kind()) => (v == null ? '没有资料' : ZH_WORDS[k.words(v)] || k.words(v));
const zhNum = t => t.replace(' or more', ' 或以上').replace('no data', '没有资料');
const zhTrack = { temperature: '温度', ocean: '海水温度', lightning: '闪电' };
async function askEarth(question) {
  const q = question.trim(); if (!q || state.asking) return;
  const zh = state.lang === 'zh' || hasHan(q);
  const out = $('#askAnswer'); out.classList.remove('err'); out.lang = zh ? 'zh' : 'en';
  const fail = msg => { out.classList.add('err'); out.textContent = msg; announce(msg); };
  if (!aiReady()) { fail(zh ? '"问地球"需要 AI 小帮手，现在还没有开。可以先试 Play 或 My Earth song。' : 'Ask the Earth needs the AI helper, which is not switched on yet. Try Play or My Earth song.'); return; }
  state.asking = true; out.textContent = zh ? '正在读你的问题…' : 'Reading your question…';
  let plan;
  try { plan = await aiAsk(q); } catch (e) { state.asking = false; fail(zh ? 'AI 小帮手现在有问题，请再试一次。' : e.message); return; }
  await sound.start();
  try {
    if (plan.kind === 'unsupported' || !state.tracks[plan.track]) {
      out.textContent = plan.reason || (zh ? '我可以回答 1880 年以来的温度、海水温度，以及从太空站看到的闪电。' : 'I can answer questions about temperature since 1880, ocean temperature, and lightning seen from space.');
      speak(out.textContent); return;
    }
    const places = (plan.places || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
      .slice(0, 2).map(p => ({ name: String((zh && p.local_name) || p.name).slice(0, 40), lat: p.lat, lon: p.lon }));
    if (!places.length) { fail(zh ? '你指的是哪个地方？请说一个城镇、国家或海洋的名字。' : 'Which place do you mean? Try naming a town, a country or an ocean.'); return; }
    askTrack(plan.track); state.asked = true; $('#nowBox').hidden = false;
    const T = state.track, k = kind(), last = T.years[T.years.length - 1];
    const notes = [], years = [], whens = [];
    await loadMeta();
    (plan.years || []).forEach((y, i) => {
      const mo = plan.months?.[i];
      if (T.kind === 'temperature' && mo >= 1 && mo <= 12) { // a month was named: NASA's monthly data
        let w = { year: y, month: mo };
        if (!hasMonth(y, mo)) {
          const l = latestMonth();
          if (l && y >= l.year) { notes.push(zh ? `NASA 的每月资料只到 ${l.year} 年 ${l.month} 月，所以我用了那个月。` : `NASA's monthly data goes up to ${MONTHS[l.month - 1]} ${l.year}, so I used that month.`); w = { year: l.year, month: l.month }; } else w = null;
        }
        if (w) { years.push(w.year); whens.push(w); return; }
      }
      const c = nearestYear(T, y); years.push(c); whens.push(null);
      if (c !== y) notes.push(zh ? `NASA 的${zhTrack[T.kind] || ''}资料是 ${T.years[0]}${T.years.length > 1 ? ` 到 ${last}` : ''} 年，所以我用了 ${c} 年，不是 ${y} 年。`
        : `NASA's ${k.label.toLowerCase()} data covers ${T.years[0]}${T.years.length > 1 ? `–${last}` : ''}, so I used ${c} instead of ${y}.`);
    });
    await Promise.all(whens.filter(Boolean).map(w => loadYear(w.year)));
    const whenText = i => (whens[i] ? (zh ? `${whens[i].year} 年 ${whens[i].month} 月` : `${MONTHS[whens[i].month - 1]} ${whens[i].year}`) : (zh ? `${years[i]} 年` : String(years[i])));
    // monthly values are NASA's numbers, not read from the map's colors, so they are not capped at ±2 °C
    const num = (v, w) => (T.kind === 'lightning' ? (zh ? `10 天期间里有 ${Math.round(v * 100)}% 看到闪电` : `seen in ${Math.round(v * 100)}% of 10-day periods`)
      : w ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C` : (zh ? zhNum(fmt(v)) : fmt(v)));
    const words = (v, w) => (v == null ? (zh ? '没有资料' : 'no data') : zh ? `${zhFeel(v, k)}（${num(v, w)}）` : `${k.words(v).toLowerCase()} (${num(v, w)})`);
    const diff = (a, b) => (zh ? `大约${b >= a ? '暖' : '冷'}了 ${Math.abs(b - a).toFixed(1)} °C。` : ` That is about ${Math.abs(b - a).toFixed(1)} °C ${b >= a ? 'warmer' : 'cooler'}.`);
    const yi = y => yearIndexNear(y, T);
    let text;
    if (plan.kind === 'trend' && T.years.length > 1) {
      state.lat = places[0].lat; state.lon = places[0].lon; globe.centerOn(places[0].lat, places[0].lon); draw();
      out.textContent = zh ? `正在播放${places[0].name}，${T.years[0]} 到 ${last} 年…` : `Playing ${places[0].name} from ${T.years[0]} to ${last}…`;
      if (zh) await speak(out.textContent);
      await playHistory({ quiet: zh });
      const h = state.hist;
      text = !zh ? $('#desc').textContent
        : h?.first == null || h?.last == null ? `NASA 在${places[0].name}附近早期没有测量，所以没办法比较以前和现在。可以试试别的地方。`
          : T.kind === 'temperature' ? `${places[0].name}附近：1880 年代${zhFeel(h.first, k)}，最近十年${zhFeel(h.last, k)}，比 1880 年代${h.last >= h.first ? '暖' : '冷'}了大约 ${Math.abs(h.last - h.first).toFixed(1)} °C。`
            : `${places[0].name}附近：${T.years[h.i0]} 年${zhFeel(h.first, k)}，${T.years[h.i1]} 年${zhFeel(h.last, k)}。`;
    } else if (plan.kind === 'compare_years' && new Set(years.map((y, i) => `${y}-${whens[i]?.month || 0}`)).size >= 2) {
      const order = years.map((y, i) => i).sort((i, j) => years[i] - years[j] || (whens[i]?.month || 0) - (whens[j]?.month || 0));
      const i1 = order[0], i2 = order[order.length - 1], y1 = whenText(i1), y2 = whenText(i2);
      score.clear();
      const a = await playAt(places[0], yi(years[i1]), whens[i1]); score.take(y1, 1, 'One place, two dates'); score.add(stepOf(a), places[0].name); await sleep(900);
      const b = await playAt(places[0], yi(years[i2]), whens[i2]); score.take(y2, 1, 'One place, two dates'); score.add(stepOf(b), places[0].name);
      if (a != null && b != null && T.kind === 'temperature') score.setNote(`${Math.abs(b - a).toFixed(1)} °C ${b >= a ? 'warmer' : 'cooler'} in ${y2} than in ${y1}`);
      const both = a != null && b != null && T.kind === 'temperature';
      text = zh ? `${places[0].name}：${y1}${words(a, whens[i1])}；${y2}${words(b, whens[i2])}。${both ? diff(a, b) : ''}`
        : `${places[0].name}: ${y1} was ${words(a, whens[i1])}; ${y2} was ${words(b, whens[i2])}.${both ? diff(a, b) : ''}`;
    } else if (plan.kind === 'compare_places' && places.length >= 2) {
      const iy = years.length - 1, y = years[iy] ?? last, w = whens[iy] || null, label = iy >= 0 ? whenText(iy) : (zh ? `${last} 年` : String(last));
      score.clear(); score.take(T.years.length > 1 ? label : '', 2, 'Two places');
      const a = await playAt(places[0], yi(y), w); score.add(stepOf(a), places[0].name); await sleep(900);
      const b = await playAt(places[1], yi(y), w); score.add(stepOf(b), places[1].name);
      text = zh ? `${T.years.length > 1 ? `${label}，` : ''}${places[0].name}${words(a, w)}，${places[1].name}${words(b, w)}。`
        : `${T.years.length > 1 ? `In ${label}, ` : ''}${places[0].name} was ${words(a, w)} and ${places[1].name} was ${words(b, w)}.`;
    } else {
      const iy = years.length - 1, y = years[iy] ?? last, w = whens[iy] || null, label = iy >= 0 ? whenText(iy) : (zh ? `${last} 年` : String(last));
      const a = await playAt(places[0], yi(y), w); score.live(stepOf(a), places[0].name, { tap: true });
      text = zh ? `${places[0].name}${T.years.length > 1 ? `，${label}` : ''}：${words(a, w)}。` : `${places[0].name}${T.years.length > 1 ? ` in ${label}` : ''}: ${words(a, w)}.`;
    }
    if (T.kind === 'temperature' && plan.kind !== 'trend') text += zh ? `“正常”是指 1951 到 1980 年的平均${whens.some(Boolean) ? '（同一个月份）。每月的数字来自 NASA GISTEMP' : ''}。`
      : ` "Normal" means the 1951–1980 average${whens.some(Boolean) ? ' for that month. Monthly values come from NASA GISTEMP' : ''}.`;
    if (notes.length) text += (zh ? '' : ' ') + notes.join(zh ? '' : ' ');
    out.textContent = text; $('#desc').textContent = ''; speak(text);
  } finally { state.asking = false; }
}
// Speak instead of typing (the browser's speech recognition, in the browser's language). Hidden where it isn't supported.
// Ask the Earth: one question, answered as soon as you stop. My Earth song: keep talking, press Stop, check the text, then make the song.
function attachMic(button, field, { story = false, onDone } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  button.hidden = false; let rec = null;
  const idle = button.textContent;
  button.addEventListener('click', () => {
    sound.start();
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = state.lang === 'zh' ? 'zh-CN' : /^en/i.test(navigator.language) ? navigator.language : 'en-US'; rec.maxAlternatives = 1;
    rec.continuous = story; rec.interimResults = story;
    const before = field.value.trim() ? field.value.trim() + ' ' : '';
    button.setAttribute('aria-pressed', 'true'); button.textContent = story ? 'Stop' : 'Listening…';
    announce(story ? 'Listening. Tell your story, then press Stop.' : 'Listening.');
    rec.onresult = e => {
      const text = [...e.results].map(r => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
      field.value = before + text;
      if (!story && e.results[e.results.length - 1].isFinal) onDone?.(text);
    };
    rec.onend = () => {
      rec = null; button.setAttribute('aria-pressed', 'false'); button.textContent = idle;
      if (story && field.value.trim()) { announce('Got it. Check your story, then press Make my song from this.'); $('#storyBtn').focus(); }
    };
    rec.onerror = e => { if (e.error === 'not-allowed') $(story ? '#storyNote' : '#askAnswer').textContent = 'Allow the microphone in your browser to speak.'; };
    rec.start();
  });
}
// Voice guide on: whatever the mouse rests on, or the keyboard lands on, says what it is (the globe answers with notes instead).
const SAYABLE = 'button, a[href], summary, input, select, textarea, #nowBox, #scoreBox, .legend, #yearOut, #yearBig, h1, h2, h3, h4, p, li, label, figcaption, .ask-answer, .lang-row .small, img[alt]:not([alt=""])';
const CARDS = '#nowBox, #scoreBox, .legend, .ask-answer'; // read as a whole, not line by line
const sayable = t => t.closest?.(CARDS) || t.closest?.(SAYABLE);
let sayOver = null, sayTimer = 0;
function nameOf(el) {
  if (el.id === 'nowBox') return [$('#rPlace').textContent, $('#rValue').textContent, $('#rDetail').textContent].filter(Boolean).join('. ');
  if (el.id === 'scoreBox') return score.describe();
  if (el.tagName === 'IMG') return el.alt;
  if (el.id === 'yearOut' || el.id === 'yearBig') return `Year: ${$('#yearOut').textContent}`;
  if (el.classList.contains('legend')) return `Color key: ${$('#lgMin').textContent} on the left, ${$('#lgMid').textContent || 'normal'} in the middle, ${$('#lgMax').textContent} on the right.`;
  if (el.type === 'range') return `Year bar, ${el.getAttribute('aria-valuetext') || el.value}`;
  if (el.matches('input, textarea, select')) {
    let lab = ''; if (el.labels?.[0]) { const c = el.labels[0].cloneNode(true); c.querySelectorAll('input, select, textarea').forEach(x => x.remove()); lab = c.textContent; } // the label without the menu's own options
    const name = (el.getAttribute('aria-label') || lab || el.placeholder || 'Text box').replace(/\s+/g, ' ').trim();
    if (el.tagName === 'SELECT') return `${name}, choice: ${el.selectedOptions[0]?.text || 'none'}`;
    return `${name}, text box${el.value.trim() ? `: ${el.value.trim()}` : ', empty'}`;
  }
  const c = el.cloneNode(true); c.querySelectorAll('[aria-hidden="true"], img').forEach(x => x.remove()); c.querySelectorAll('br').forEach(b => b.replaceWith(' ')); // key hints hidden from screen readers are skipped; visible key names (Space, I) are read
  let n = (el.getAttribute('aria-label') || c.textContent || '').replace(/\s+/g, ' ').trim();
  const pressed = el.getAttribute('aria-pressed'), exp = el.getAttribute('aria-expanded');
  if (pressed != null && el.dataset.act === 'voice') n += pressed === 'true' ? ', on' : ', off';
  else if (pressed === 'true' && el.id !== 'issBtn' && el.id !== 'playBtn') n += ', selected';
  if (exp != null) n += exp === 'true' ? ', open' : ', closed';
  if (el.tagName === 'SUMMARY') n += el.parentElement.open ? ', open' : ', closed';
  if (el.disabled) n += ', not available yet';
  return n;
}
// The first screen talks too. Browsers only allow speech after the first key press or click, so the first one
// says hello and explains the two buttons; after that, whatever the mouse or the Tab key lands on is read.
const startOpen = () => !$('#start').hidden;
let welcomed = false;
function talk(text, opts) { const v = state.voice; state.voice = true; const p = speak(text, opts); state.voice = v; return p; } // speak even before Voice guide is on
const talking = () => state.voice || (welcomed && startOpen());
function welcome(byKey) {
  welcomed = true;
  talk('Welcome to Earth Jukebox. NASA maps of the Earth, played as sound: warmer places sing higher. Put on headphones. '
    + (byKey ? 'You are on the button Start with voice guide. Press Enter to start, and I will read every step. If you use a screen reader, press Tab and choose Start listening instead.'
      : 'There are two buttons: Start listening, and Start with voice guide. Rest the mouse on one and I will read it.'));
}
function setupStartTalk() {
  $('#startVoiceBtn').focus({ preventScroll: true }); // Enter right away starts the voice guide
  document.addEventListener('keydown', e => {
    if (!startOpen()) return;
    const onKeyButton = e.target.closest?.('#start button, #start a') && (e.key === 'Enter' || e.key === ' ');
    if (!welcomed && !onKeyButton) { e.preventDefault(); welcome(true); return; }
    if (e.key === 'Tab') { // keep Tab inside the first screen
      const f = [...$('#start').querySelectorAll('button, a[href]')], i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }, true);
  document.addEventListener('pointerdown', e => { if (startOpen() && !welcomed && !e.target.closest('#start button, #start a')) welcome(false); }, true);
}
function setupSayOnHover() {
  document.addEventListener('pointerover', e => {
    if (!talking() || e.pointerType !== 'mouse') return;
    const el = sayable(e.target); if (!el || el === sayOver || el.closest('#globeWrap')) return;
    sayOver = el; clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { if (sayOver !== el || !talking()) return; const t = nameOf(el); if (t) talk(t); }, 180); // also while music plays: words always come first
  });
  document.addEventListener('pointerout', e => { if (sayOver && !sayOver.contains(e.relatedTarget)) { sayOver = null; clearTimeout(sayTimer); } });
  document.addEventListener('focusin', e => {
    if (!talking()) return;
    const el = sayable(e.target); if (!el || el === sayOver) return;
    const t = nameOf(el); if (t) talk(t);
  });
}
function setLang(l) { // English or 中文, for speaking (Speak buttons) and for Ask the Earth's answers
  state.lang = l; try { localStorage.setItem('ej-lang', l); } catch { /* private window */ }
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === l));
}
function setupMic() {
  let saved = null; try { saved = localStorage.getItem('ej-lang'); } catch { /* private window */ }
  setLang(saved === 'zh' || saved === 'en' ? saved : /^zh/i.test(navigator.language || '') ? 'zh' : 'en');
  document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => { setLang(b.dataset.lang); announce(b.dataset.lang === 'zh' ? '中文' : 'English'); }));
  attachMic($('#micBtn'), $('#askText'), { onDone: t => askEarth(t) });
  attachMic($('#storyMic'), $('#storyText'), { story: true });
}

// ---------- input ----------
function help() { // spoken key help; the year keys only matter when the track has more than one year
  const y = state.track.years, many = !isImage() && y.length > 1;
  return 'Arrow keys travel, with shift in small steps. '
    + (many ? `Square brackets, or page up and page down, change the year. Space plays ${y[0]} to ${y[y.length - 1]}. ` : '')
    + 'T taps here, R replays your taps. Enter reads this spot. I flies one orbit with the Space Station. S goes once around the Earth. L plays the legend. '
    + (many ? 'D describes the year. ' : 'D describes the map. ')
    + 'B toggles the average hum. Numbers 1 to 9 travel to places. V turns the voice on or off.';
}
const runKey = key => onKey({ key, shiftKey: false, target: document.body, preventDefault() {} });
function onKey(e) {
  if (!state.track || startOpen()) return; // the first screen handles its own keys
  if (e.target.matches?.('input, textarea')) { if (e.key === 'Enter' && e.target.closest('#byo')) makeItSing(); return; }
  const k = e.key, img = isImage();
  if (img && !src.legend && k !== '?') return;
  const step = img ? (e.shiftKey ? 0.01 : 0.05) : (e.shiftKey ? 2 : 10);
  const yr = n => setYear(n).then(() => { if (state.voice) speak(`${when()}. ${placeName(state.lat, state.lon)}: ${fmt(currentValue())}.`); });
  const move = (dy, dx) => (img ? moveUV(state.u + dx * step, state.v + dy * step) : moveTo(state.lat - dy * step, state.lon + dx * step, { center: true, sayShort: true }));
  const map = {
    ArrowLeft: () => move(0, -1), ArrowRight: () => move(0, 1), ArrowUp: () => move(-1, 0), ArrowDown: () => move(1, 0),
    PageUp: () => yr(state.yi + (e.shiftKey ? 10 : 1)), PageDown: () => yr(state.yi - (e.shiftKey ? 10 : 1)),
    ']': () => yr(state.yi + 1), '[': () => yr(state.yi - 1), '}': () => yr(state.yi + 10), '{': () => yr(state.yi - 10),
    Home: () => yr(0), End: () => yr(state.track.years.length - 1),
    Enter: () => updateReadout({ speakIt: true }), ' ': () => playHistory(),
    i: () => flyISS(), s: () => act('sweep'), l: () => act('legend'), d: () => act('describe'), b: () => act('ref'), v: () => act('voice'), '?': () => speak(help()),
    t: () => { if (!img) tapAt(state.lat, state.lon); }, r: () => { if (!img) replayTaps(); },
  };
  let fn = map[k] || map[k.toLowerCase?.()];
  if (!fn && !img && /^[1-9]$/.test(k)) { const p = JUMPS[+k - 1]; fn = () => { moveTo(p.lat, p.lon, { center: true }); speak(`${p.name}. ${say(currentValue())}.`); }; }
  if (!fn) return;
  if (e.target.closest?.('button, summary') && (k === 'Enter' || k === ' ')) return; // let buttons work normally
  e.preventDefault(); fn();
}
function pointerUV(e) { const r = $('#map').getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
let lastMove = 0;
// Picture mode (flat canvas)
function onMapMove(e) {
  if (state.busy || !src.legend) return;
  const now = performance.now(); if (now - lastMove < 60) return; lastMove = now;
  const [u, v] = pointerUV(e), cell = Math.round(u * 80) * 1000 + Math.round(v * 80);
  if (cell !== state.lastCell) { state.lastCell = cell; moveUV(u, v); }
}
function onMapDown(e) {
  sound.start();
  if (!src.canvas) { $('#pickFile').click(); return; }
  if (state.cal.step === 1 || state.cal.step === 2) { calibrationClick(e); return; }
  if (!src.legend) return;
  const [u, v] = pointerUV(e); moveUV(u, v);
}
function onMapUp() { if (src.legend) updateReadout({ play: false, speakIt: true }); }

// Globe gestures:
//   tap                         -> play that place
//   drag (one or two fingers)   -> spin the Earth
//   mouse hover                 -> listen without clicking
// The only line on the globe is the Space Station's orbit ("Fly with the Space Station").
const drag = { on: false, x: 0, y: 0, moved: 0, id: null, mode: 'pending', lastNoteAt: 0, lastCell: -1, notes: 0 };
const touches = new Map();
// With Voice guide on ("blind mode"), moving the mouse or one finger over the Earth keeps playing notes,
// resting for a moment says where you are, and leaving the Earth's edge ticks. Two fingers still spin.
const hover = { x: -999, y: 0, on: false, t: 0, talking: false };
function hearUnder(e) {
  const dense = state.voice, p = globe.pick(e.clientX, e.clientY);
  if (!p) { if (dense && hover.on) sound.noData(); hover.on = false; clearTimeout(hover.t); return; }
  hover.on = true;
  const now = performance.now(), cell = cellIndex(p.lat, p.lon);
  const far = Math.hypot(e.clientX - hover.x, e.clientY - hover.y) > 14; // a note every few millimetres, even inside one 2° cell
  if ((cell !== state.lastCell || (dense && far)) && now - lastMove >= (dense ? 90 : 70)) {
    lastMove = now; hover.x = e.clientX; hover.y = e.clientY; state.lastCell = cell;
    if (hover.talking) { speechSynthesis?.cancel(); hover.talking = false; }
    moveTo(p.lat, p.lon);
  }
  if (!dense) return;
  clearTimeout(hover.t);
  hover.t = setTimeout(() => {
    if (state.playing || state.busy || state.replaying || !hover.on) return;
    hover.talking = true; speak(`${currentPlace()}. ${feeling(currentValue())}.`).then(() => { hover.talking = false; });
  }, 650);
}
function onGlobeDown(e) {
  sound.start();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { $('#globe').setPointerCapture(e.pointerId); } catch { /* synthetic or ended pointer */ }
  if (touches.size >= 2) { drag.mode = 'spin'; return; } // second finger: spin
  const onGlobe = !!globe.pick(e.clientX, e.clientY);
  const spin = e.shiftKey || e.button === 1 || e.button === 2 || !onGlobe || state.replaying || state.songPlaying;
  const explore = !spin && state.voice && e.pointerType !== 'mouse'; // one finger, Voice guide on: listen by touch
  Object.assign(drag, { on: true, x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, mode: spin ? 'spin' : explore ? 'explore' : 'pending', lastCell: -1, notes: 0 });
  if (explore) hover.x = -999;
}
function onGlobeMove(e) {
  if (touches.has(e.pointerId)) {
    const t = touches.get(e.pointerId);
    if (drag.mode === 'spin' && touches.size >= 2) { globe.rotateBy((e.clientX - t.x) / 2, (e.clientY - t.y) / 2); }
    t.x = e.clientX; t.y = e.clientY;
  }
  if (drag.on && e.pointerId === drag.id) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.mode === 'explore') { if (touches.size < 2 && !state.playing && !state.busy && !state.replaying) hearUnder(e); return; }
    if (drag.mode === 'pending' && drag.moved > 6) drag.mode = 'spin';
    if (drag.mode === 'spin' && touches.size < 2) globe.rotateBy(dx, dy);
    return;
  }
  if (e.pointerType !== 'mouse' || state.playing || state.busy || state.replaying) return;
  hearUnder(e);
}
function onGlobeUp(e) {
  touches.delete(e.pointerId);
  if (!drag.on || e.pointerId !== drag.id) return;
  drag.on = false;
  if (drag.mode === 'explore' ? drag.moved > 6 : drag.mode !== 'pending') return; // that was a spin, or listening by touch
  const p = globe.pick(e.clientX, e.clientY);
  if (!p) return;
  $('#globeHint').hidden = true;
  if (state.mode === 'song' && state.picking != null) { setMomentPlace(state.picking, p.lat, p.lon); return; }
  tapAt(p.lat, p.lon, { record: state.mode !== 'song' });
}

// ---------- choosing a NASA visualization (track) ----------
function switchTrack(id) {
  if (!state.tracks[id] || state.track.id === id) return;
  state.playing = false; stopSong();
  useTrack(id); preloadAll();
  setMode('track');
  if (id === 'temperature') { if (!guide.done) resetGuide(); else setGuide({ label: 'Temperature, 1880–2025', title: 'Tap the Earth, or fly with the Space Station', text: KINDS.temperature.hint }); }
  else setGuide({ label: state.track.title, title: id === 'ocean' ? 'Tap the ocean, or fly with the Space Station' : 'Tap anywhere, or fly with the Space Station', text: kind().hint });
  $('#desc').textContent = describe();
}

// ---------- my Earth song ----------
const DEFAULT_MOMENTS = [
  { year: 1900, name: 'Sibu, Sarawak', label: 'Long before I was born' },
  { year: 1965, name: 'Sibu, Sarawak', label: 'When my grandparents were young' },
  { year: 2006, month: 3, day: 15, name: 'Kuching', label: 'The day I was born' },
  { year: 2025, name: 'Sibu, Sarawak', label: 'Today' },
];
function resolveMoment(m) {
  if (m.lat != null && m.lon != null) return m;
  const p = findPlace(m.name || '');
  return p ? { ...m, lat: p.lat, lon: p.lon, name: m.name } : m;
}
// A moment with a month uses NASA's monthly data (GISTEMP v4) for that month; otherwise the yearly map.
const lastMapYear = () => temp().years[temp().years.length - 1];
const usesMonth = m => m.month >= 1 && m.month <= 12 && hasMonth(m.year, m.month);
const validMoment = m => m.year >= 1880 && (m.year <= lastMapYear() || usesMonth(m));
function momentMean(m, r = 6) {
  if (usesMonth(m)) return monthBoxMean(m.year, m.month, m.lat, m.lon, r);
  const T = temp(); return boxMean(yearIndexOf(m.year, T), m.lat, m.lon, r, T);
}
async function prepareMoments(ms) { await loadMeta(); await Promise.all([...new Set(ms.filter(usesMonth).map(m => m.year))].map(loadYear)); }
function limitsText() { const l = latestMonth(); return `Choose a year from 1880 to ${lastMapYear()}${l ? `, or a month up to ${MONTHS[l.month - 1]} ${l.year}` : ''}.`; }
function momentFeeling(m) {
  const r = resolveMoment(m);
  if (r.lat == null || !m.year) return '';
  if (!validMoment(m)) return limitsText();
  if (usesMonth(m) && !yearLoaded(m.year)) { loadYear(m.year).then(refreshFeelings); return 'Loading NASA monthly data…'; }
  const v = momentMean(r), when = usesMonth(m) ? `${MONTHS[m.month - 1]} ${m.year}` : String(m.year);
  if (v == null) return `NASA has no data here for ${when}.`;
  return `${when}: ${KINDS.temperature.words(v).toLowerCase()} (${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C)`
    + (usesMonth(m) ? `. From NASA's monthly data${m.day ? ', for the whole month' : ''}.` : '.');
}
function refreshFeelings() { document.querySelectorAll('#moments .moment').forEach(li => { const m = state.moments[+li.dataset.i]; if (m) li.querySelector('.m-feel').textContent = momentFeeling(m); }); }
function renderMoments() {
  const ol = $('#moments');
  ol.innerHTML = state.moments.map((m, i) => `
    <li class="moment${state.picking === i ? ' picking' : ''}" data-i="${i}">
      <label class="m-f"><span>Year</span><input class="m-year" type="number" min="1880" max="2026" value="${m.year ?? ''}" inputmode="numeric"></label>
      <label class="m-f"><span>Month</span><select class="m-month"><option value="">All year</option>${MONTHS.map((n, k) => `<option value="${k + 1}"${m.month === k + 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="m-f"><span>Day</span><input class="m-day" type="number" min="1" max="31" value="${m.day ?? ''}" placeholder="—" inputmode="numeric"></label>
      <button type="button" class="m-remove" aria-label="Remove moment ${i + 1}">✕</button>
      <label class="m-f m-placef"><span>Place</span><input class="m-place" list="placeList" value="${(m.name || '').replace(/"/g, '&quot;')}" placeholder="Town or city"></label>
      <label class="m-f m-labelf"><span>Why it matters</span><input class="m-label" value="${(m.label || '').replace(/"/g, '&quot;')}" placeholder="optional"></label>
      <button type="button" class="m-pick" aria-pressed="${state.picking === i}">${state.picking === i ? 'Tap the globe…' : 'Pick on globe'}</button>
      <p class="m-feel">${momentFeeling(m)}</p>
    </li>`).join('');
  $('#addMoment').disabled = state.moments.length >= 6;
}
function setMomentPlace(i, lat, lon) {
  const name = placeName(lat, lon);
  Object.assign(state.moments[i], { lat, lon, name });
  state.picking = null; renderMoments();
  moveTo(lat, lon, { center: true });
  $('#songStatus').textContent = `Moment ${i + 1}: ${name}.`;
}
function onMomentsInput(e) {
  const li = e.target.closest('.moment'); if (!li) return;
  const m = state.moments[+li.dataset.i];
  if (e.target.matches('.m-year')) m.year = parseInt(e.target.value, 10);
  if (e.target.matches('.m-month')) m.month = parseInt(e.target.value, 10) || null;
  if (e.target.matches('.m-day')) { const d = parseInt(e.target.value, 10); m.day = d >= 1 && d <= 31 ? d : null; }
  if (e.target.matches('.m-place')) { m.name = e.target.value; m.lat = m.lon = null; }
  if (e.target.matches('.m-label')) m.label = e.target.value;
  if (e.type === 'change') { li.querySelector('.m-feel').textContent = momentFeeling(m); }
}
function onMomentsClick(e) {
  const li = e.target.closest('.moment'); if (!li) return;
  const i = +li.dataset.i;
  if (e.target.matches('.m-remove')) { state.moments.splice(i, 1); state.picking = null; renderMoments(); }
  if (e.target.matches('.m-pick')) { state.picking = state.picking === i ? null : i; renderMoments(); if (state.picking != null) speak('Tap the place on the globe.'); }
}

let songTimers = [];
function stopSong() {
  songTimers.forEach(clearTimeout); songTimers = [];
  sound.stopSong?.();
  document.querySelectorAll('.moment.playing').forEach(li => li.classList.remove('playing'));
  if ($('#playSong')) $('#playSong').textContent = 'Play my Earth song';
  state.songPlaying = false;
}
async function playSong() {
  if (state.songPlaying) { stopSong(); return; }
  await sound.start();
  const moments = state.moments.map(resolveMoment);
  if (!moments.length) { $('#songStatus').textContent = 'Add at least one moment.'; return; }
  await prepareMoments(moments);
  const bad = moments.findIndex(m => m.lat == null || !validMoment(m));
  if (bad >= 0) { $('#songStatus').textContent = `Moment ${bad + 1}: ${limitsText()} Then choose a place from the list, or pick it on the globe.`; return; }
  const T = temp();
  const song = composeSong(moments, {
    yearIndexOf: y => yearIndexNear(y, T), tOf: v => (v - T.min) / (T.max - T.min),
    localMean: (yi, lat, lon, m) => (usesMonth(m) ? monthBoxMean(m.year, m.month, lat, lon, 6) : boxMean(yi, lat, lon, 6, T)),
    valueAt: (yi, lat, lon, m) => (usesMonth(m) ? monthValue(m.year, m.month, lat, lon) ?? monthBoxMean(m.year, m.month, lat, lon, 4)
      : trackValue(yi, lat, lon, T) ?? boxMean(yi, lat, lon, 4, T)),
    extra: songLayers,
  });
  state.songPlaying = true; $('#playSong').textContent = 'Stop';
  score.song(song.sections.map(sec => ({ label: `${usesMonth(sec.moment) ? MON[sec.moment.month - 1] + ' ' : ''}${sec.moment.year} ${shortPlace(sec.moment.name)}`, notes: sec.notes.map(n => n.step) })));
  sound.beginSong();
  const t0 = scheduleSong(song, sound), spb = 60 / BPM, lead = (t0 - sound.now) * 1000;
  const at = (beat, fn) => songTimers.push(setTimeout(fn, lead + beat * spb * 1000));
  song.sections.forEach((sec, k) => {
    const m = sec.moment;
    at(sec.startBeat, () => {
      document.querySelectorAll('.moment').forEach((li, j) => li.classList.toggle('playing', j === k));
      state.yi = sec.yearIndex; state.lat = m.lat; state.lon = m.lon;
      globe.centerOn(m.lat, m.lon, 500); draw(); $('#nowBox').hidden = false;
      $('#rPlace').textContent = m.name; $('#rValue').textContent = sec.mean == null ? 'No data' : KINDS.temperature.words(sec.mean);
      $('#rDetail').textContent = [usesMonth(m) ? `${MONTHS[m.month - 1]} ${m.year}, NASA monthly data` : '', sec.layers?.text].filter(Boolean).join('. ');
      $('#desc').textContent = `${dateText(m, true)}, ${m.name}${m.label ? `: ${m.label}` : ''}.`;
      announce(`${dateText(m, true)}, ${m.name}. ${sec.mean == null ? 'No data' : KINDS.temperature.words(sec.mean)}.`);
    });
    sec.notes.forEach((n, i) => at(sec.startBeat + n.beat, () => { globe.ripple(n.lat, n.lon); score.hit(k, i); }));
  });
  at(song.sections.length * BEATS_PER_MOMENT + 3.5, () => {
    stopSong();
    const first = song.sections[0], last = song.sections[song.sections.length - 1];
    const msg = song.sections.length > 1 && first.mean != null && last.mean != null
      ? `Your Earth song starts in ${dateText(first.moment, true)} (${KINDS.temperature.words(first.mean).toLowerCase()}) and ends in ${dateText(last.moment, true)} (${KINDS.temperature.words(last.mean).toLowerCase()}).`
      : 'That was your Earth song.';
    $('#desc').textContent = msg; $('#songStatus').textContent = 'Change a year or a place and play it again.';
    if (song.sections.length > 1 && first.mean != null && last.mean != null) score.setNote(`${dateText(first.moment)} → ${dateText(last.moment)}: ${last.mean >= first.mean ? '+' : '−'}${Math.abs(last.mean - first.mean).toFixed(1)} °C`);
    speak(msg);
  });
}
// Extra instruments for a moment, from the other EIC tracks (when they are loaded).
function songLayers(m) {
  const O = state.tracks.ocean, L = state.tracks.lightning, out = { ocean: null, lightning: null, text: '' };
  if (O) { let v = null; for (const r of [4, 8, 14]) { v = boxMean(0, m.lat, m.lon, r, O); if (v != null) break; } if (v != null) out.ocean = (v - O.min) / (O.max - O.min), out.oceanWords = KINDS.ocean.words(v); }
  if (L) { let s = 0, n = 0; L.years.forEach((_, yi) => { const v = boxMean(yi, m.lat, m.lon, 4, L); if (v != null) { s += v; n++; } }); if (n) out.lightning = s / n / L.max, out.lightningWords = KINDS.lightning.words(s / n); }
  out.text = [out.oceanWords && `Nearest sea: ${out.oceanWords.toLowerCase()}`, out.lightningWords && `${out.lightningWords}`].filter(Boolean).join('. ');
  return out;
}
function songLink() {
  const data = state.moments.map(m => [m.year, m.name, m.label || '', m.lat == null ? null : +m.lat.toFixed(2), m.lon == null ? null : +m.lon.toFixed(2), m.month || 0, m.day || 0]);
  return `${location.origin}${location.pathname}#song=${encodeURIComponent(JSON.stringify(data))}`;
}
function readSongLink() {
  const m = location.hash.match(/^#song=(.+)$/); if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])).slice(0, 6).map(([year, name, label, lat, lon, month, day]) => ({ year: +year, name: String(name || ''), label: String(label || ''), lat: lat ?? null, lon: lon ?? null,
      month: month >= 1 && month <= 12 ? +month : null, day: month && day >= 1 && day <= 31 ? +day : null }));
  } catch { return null; }
}
async function shareSong() {
  const url = songLink();
  try { await navigator.clipboard.writeText(url); $('#songStatus').textContent = 'Link copied. Send it to a friend so they can hear your Earth song.'; }
  catch { $('#songStatus').textContent = url; }
}

// ---------- start ----------
async function start(withVoice = false) {
  state.voice = withVoice; setHint(); document.querySelector('[data-act="voice"]')?.setAttribute('aria-pressed', withVoice);
  const ok = await sound.start();
  $('#start').hidden = true; $('#globe').focus();
  draw(); preloadAll();
  if (!ok) $('#desc').textContent = 'Sound is blocked. Tap anywhere on the page, and on iPhone turn off silent mode.';
  if (state.mode === 'song') { speak('Someone shared their Earth song with you. Press Play my Earth song to hear it.'); $('#playSong').focus(); return; }
  resetGuide(); // step 1: "Tap anywhere on the Earth" (also read aloud)
}
function buildJumps() {
  $('#jumps').innerHTML = JUMPS.map((p, i) => `<button type="button" data-jump="${i}"><kbd>${i + 1}</kbd> ${p.name.replace(/^the /, '')}</button>`).join('');
  $('#jumps').addEventListener('click', e => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    sound.start(); const p = JUMPS[+b.dataset.jump]; moveTo(p.lat, p.lon, { center: true }); speak(`${p.name}. ${say(currentValue())}.`);
  });
}

async function init() {
  loadMeta(); // NASA monthly data index (small)
  await loadTrack('temperature');
  useTrack('temperature');
  // Other EIC tracks listed in assets/tracks.json are loaded in the background.
  fetch('assets/tracks.json').then(r => (r.ok ? r.json() : [])).catch(() => []).then(ids => Promise.all(ids.filter(id => id !== 'temperature')
    .map(id => loadTrack(id).then(t => { if (t) $(`[data-track="${id}"]`).hidden = false; return t; }))))
    .then(() => { // "All three": the temperature track, played together with the sea and lightning
      const T = state.tracks.temperature; if (!T || !state.tracks.ocean || !state.tracks.lightning) return;
      state.tracks.combo = { ...T, id: 'combo', dataId: 'temperature', frameDir: 'temperature', kind: 'combo', title: 'All three together',
        subtitle: 'Temperature on the marimba, the nearest sea on the harp, lightning on the drums',
        eic: 'Climate Vital Signs, Sea Surface Currents and Temperature, and ISS Lightning',
        credit: 'NASA Scientific Visualization Studio: temperature SVS 5603 (GISTEMP v4), sea surface SVS 3912 (ECCO2), lightning SVS 5011 (ISS LIS)' };
      $('[data-track="combo"]').hidden = false;
    });
  buildJumps();
  const shared = readSongLink();
  state.moments = shared || DEFAULT_MOMENTS.map(m => ({ ...m }));
  state.picking = null;
  $('#placeList').innerHTML = PLACE_NAMES.map(n => `<option value="${n}"></option>`).join('');
  $('#moments').addEventListener('input', onMomentsInput);
  $('#moments').addEventListener('change', onMomentsInput);
  $('#moments').addEventListener('click', onMomentsClick);
  $('#addMoment').addEventListener('click', () => { state.moments.push({ year: 2025, name: '', label: '' }); renderMoments(); $('#moments li:last-child .m-place').focus(); });
  $('#playSong').addEventListener('click', playSong);
  $('#storyBtn').addEventListener('click', () => { sound.start(); storyToSong(); });
  $('#askForm').addEventListener('submit', e => { e.preventDefault(); sound.start(); askEarth($('#askText').value); });
  $('#askExamples').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; $('#askText').value = c.textContent; sound.start(); askEarth(c.textContent); });
  setupMic(); setupSayOnHover(); setupStartTalk();
  $('#shareSong').addEventListener('click', shareSong);
  setMode(shared ? 'song' : 'track');
  $('#startBtn').addEventListener('click', () => start(false));
  $('#startVoiceBtn').addEventListener('click', () => start(true));
  $('#playBtn').addEventListener('click', () => { sound.start(); playHistory(); });
  $('#issBtn').addEventListener('click', () => { sound.start(); flyISS(); });
  $('#year').addEventListener('input', e => { // 12 steps per year: the bar lands on a month
    sound.start(); const k = +e.target.value;
    if (hasMonths()) setYear(Math.floor(k / 12), (k % 12) + 1); else setYear(k);
  });
  $('#wholeYear').addEventListener('click', () => { sound.start(); setYear(state.yi, null); $('#desc').textContent = describe(); });
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { sound.start(); act(b.dataset.act); }));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.addEventListener('keydown', onKey);
  // Controls: the same actions as the keys, as big buttons (phones have no arrow keys)
  const ctl = $('#controls'), ctlBtn = $('#controlsBtn');
  ctlBtn.addEventListener('click', () => {
    const open = ctl.hidden; ctl.hidden = !open; ctlBtn.setAttribute('aria-expanded', open);
    if (!open) return;
    ctl.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    ctl.querySelector('.pad-c').focus({ preventScroll: true });
  });
  ctl.addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (!b) return; sound.start(); runKey(b.dataset.key); });
  const g = $('#globe');
  g.addEventListener('pointerdown', onGlobeDown);
  g.addEventListener('pointermove', onGlobeMove);
  g.addEventListener('pointerup', onGlobeUp);
  g.addEventListener('pointercancel', e => { drag.on = false; touches.delete(e.pointerId); });
  g.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; clearTimeout(hover.t); if (state.voice && hover.on) sound.noData(); hover.on = false; });
  g.addEventListener('contextmenu', e => e.preventDefault());
  const m = $('#map');
  m.addEventListener('pointermove', onMapMove);
  m.addEventListener('pointerdown', onMapDown);
  m.addEventListener('pointerup', onMapUp);
  // play the Earth
  $('#replayBtn').addEventListener('click', () => { sound.start(); replayTaps(); });
  $('#clearBtn').addEventListener('click', () => resetGuide());
  $('#moreBox').addEventListener('toggle', () => { if ($('#moreBox').open) { guide.done = true; $('.timeline').hidden = state.track.years.length < 2; } });
  document.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => { sound.start(); switchTrack(b.dataset.track); }));
  // your own map (its tab is hidden for now; the code stays for later)
  $('#pickBtn').addEventListener('click', () => $('#pickFile').click());
  $('#pickFile').addEventListener('change', e => usePicture(e.target.files[0]));
  $('#singBtn').addEventListener('click', makeItSing);
}
init();
