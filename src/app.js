// AI-assisted (Anthropic Claude).
// Earth Jukebox: explore a NASA visualization by ear.
import { Sound, noteName } from './audio.js';
import { JUMPS, placeName, formatCoord } from './places.js';

const $ = s => document.querySelector(s);
const sound = new Sound();
const state = {
  track: null, cube: null, yi: 0, lat: 2.3, lon: 111.8,
  voice: true, ref: false, playing: false, busy: false, images: new Map(), lastCell: -1,
};

// ---------- data ----------
async function loadTrack(id) {
  const track = await (await fetch(`assets/${id}/track.json`)).json();
  const cube = new Uint8Array(await (await fetch(`assets/${id}/cube.bin`)).arrayBuffer());
  Object.assign(state, { track, cube, yi: track.years.length - 1 });
  $('#trackTitle').textContent = track.title;
  $('#trackSub').textContent = track.subtitle;
  $('#credit').innerHTML = `${track.credit}. <a href="${track.sourceUrl}">${track.sourceUrl}</a>`;
  const yr = $('#year'); yr.max = track.years.length - 1; yr.value = state.yi;
  drawLegend();
}

const grid = () => state.track.grid;
function cellIndex(lat, lon) {
  const { width: W, height: H, cellDegrees: d } = grid();
  const cx = ((Math.floor((lon + 180) / d) % W) + W) % W;
  const cy = Math.max(0, Math.min(H - 1, Math.floor((90 - lat) / d)));
  return cy * W + cx;
}
function decode(code) {
  if (!code) return null;
  const { min, max } = state.track;
  return min + (code - 1) / 254 * (max - min);
}
function valueAt(yi, lat, lon) {
  const { width: W, height: H } = grid();
  return decode(state.cube[yi * W * H + cellIndex(lat, lon)]);
}
// Area-weighted average of a box around a point (smoother, used for playing history).
function boxMean(yi, lat, lon, r = 6) {
  const d = grid().cellDegrees;
  let s = 0, w = 0;
  for (let la = lat - r + d / 2; la <= lat + r; la += d) {
    if (la < -90 || la > 90) continue;
    const k = Math.cos(la * Math.PI / 180);
    for (let lo = lon - r + d / 2; lo <= lon + r; lo += d) {
      const v = valueAt(yi, la, lo);
      if (v != null) { s += v * k; w += k; }
    }
  }
  return w ? s / w : null;
}
const tOf = v => (v - state.track.min) / (state.track.max - state.track.min);

const BANDS = [['the Arctic', 66, 90], ['the northern mid-latitudes', 30, 66], ['the tropics', -30, 30], ['the southern mid-latitudes', -66, -30], ['Antarctica', -90, -66]];
function yearStats(yi) {
  const { width: W, height: H, cellDegrees: d } = grid();
  const bands = BANDS.map(([name, lo, hi]) => ({ name, lo, hi, s: 0, w: 0 }));
  let s = 0, w = 0, all = 0;
  for (let cy = 0; cy < H; cy++) {
    const lat = 90 - (cy + 0.5) * d, k = Math.cos(lat * Math.PI / 180);
    for (let cx = 0; cx < W; cx++) {
      all += k;
      const v = decode(state.cube[yi * W * H + cy * W + cx]);
      if (v == null) continue;
      s += v * k; w += k;
      const b = bands.find(b => lat >= b.lo && lat < b.hi) || bands[0];
      b.s += v * k; b.w += k;
    }
  }
  const withData = bands.filter(b => b.w > 0).map(b => ({ name: b.name, mean: b.s / b.w }));
  return { mean: s / w, coverage: w / all, bands: withData };
}

// ---------- words ----------
function fmt(v, digits = 1) {
  if (v == null) return 'no data';
  const { min, max, unit } = state.track;
  const s = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)} ${unit}`;
  if (v >= max - 0.03) return `${s} or more`;
  if (v <= min + 0.03) return `${s} or less`;
  return s;
}
function say(v) { // spoken form
  if (v == null) return 'no data here';
  const { min, max } = state.track, a = Math.abs(v).toFixed(1);
  let s = `${v >= 0 ? 'plus' : 'minus'} ${a} degrees`;
  if (v >= max - 0.03) s += ' or more'; else if (v <= min + 0.03) s += ' or less';
  return s;
}
const year = () => state.track.years[state.yi];

function describeYear() {
  const st = yearStats(state.yi);
  const warm = st.bands.reduce((a, b) => (b.mean > a.mean ? b : a));
  const cool = st.bands.reduce((a, b) => (b.mean < a.mean ? b : a));
  const here = boxMean(state.yi, state.lat, state.lon, 4);
  return `${year()}. Compared with 1951–1980, the parts of the map with data (${Math.round(st.coverage * 100)}% of Earth's area) average about ${fmt(st.mean)}. ` +
    `Warmest: ${warm.name}, ${fmt(warm.mean)}. Coolest: ${cool.name}, ${fmt(cool.mean)}. ` +
    `Around ${placeName(state.lat, state.lon)}: ${fmt(here)}.`;
}

// ---------- speech ----------
let voicePick = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voicePick = vs.find(v => /en-(US|GB|AU)/i.test(v.lang) && /Samantha|Google|Natural|Daniel|Karen/i.test(v.name))
    || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function announce(text) { const el = $('#live'); el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); }
function speak(text, { interrupt = true } = {}) {
  announce(text);
  if (!state.voice || !('speechSynthesis' in window)) return Promise.resolve();
  if (interrupt) speechSynthesis.cancel();
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text);
    if (voicePick) u.voice = voicePick;
    u.lang = voicePick?.lang || 'en-US'; u.rate = 1.05;
    u.onend = res; u.onerror = res;
    setTimeout(res, 400 + text.length * 75); // never hang if the engine stays silent
    speechSynthesis.speak(u);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- drawing ----------
function frameImage(yi) {
  const y = state.track.years[yi];
  if (!state.images.has(y)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = `assets/${state.track.id}/frames/${y}.jpg`;
    img.onload = () => { if (state.track.years[state.yi] === y) draw(); };
    state.images.set(y, img);
  }
  return state.images.get(y);
}
function preloadAll() { state.track.years.forEach((_, i) => setTimeout(() => frameImage(i), i * 40)); }

function draw() {
  const c = $('#map'), g = c.getContext('2d'), W = c.width, H = c.height;
  let img = frameImage(state.yi);
  if (!img.complete || !img.naturalWidth) { // show the nearest year already loaded
    for (let d = 1; d < 15 && !(img.complete && img.naturalWidth); d++) {
      const alt = state.images.get(state.track.years[state.yi - d]);
      if (alt?.complete && alt.naturalWidth) img = alt;
    }
  }
  if (img.complete && img.naturalWidth) g.drawImage(img, 0, 0, W, H); else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  const x = (state.lon + 180) / 360 * W, y = (90 - state.lat) / 180 * H;
  g.save();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  g.lineWidth = 5; g.strokeStyle = '#0A0F18'; g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5; g.strokeStyle = '#FFFFFF'; g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.stroke();
  g.restore();
  $('#yearBig').textContent = year(); $('#yearOut').textContent = year();
  $('#year').value = state.yi; $('#year').setAttribute('aria-valuetext', String(year()));
}

function drawLegend() {
  const c = $('#legend'), g = c.getContext('2d'), stops = state.track.stops;
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), `rgb(${s.rgb.join(',')})`));
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  const { min, max, unit } = state.track;
  $('#lgMin').textContent = `${min} ${unit} or less`;
  $('#lgMid').textContent = `0 = 1951–1980 average`;
  $('#lgMax').textContent = `+${max} ${unit} or more`;
}

// ---------- readout ----------
function updateReadout({ play = true, speakIt = false, pan } = {}) {
  const v = valueAt(state.yi, state.lat, state.lon);
  const place = placeName(state.lat, state.lon);
  $('#rPlace').textContent = place;
  $('#rCoord').textContent = formatCoord(state.lat, state.lon);
  $('#rValue').textContent = fmt(v);
  $('#rNote').textContent = v == null ? 'silent' : noteName(tOf(v));
  const p = pan ?? state.lon / 180;
  if (play) { if (v == null) sound.noData({ pan: p }); else sound.note(tOf(v), { pan: p }); }
  if (speakIt) speak(`${place}, ${year()}. ${say(v)}.`);
  else announce(`${place}. ${fmt(v)}.`);
  return v;
}

function moveTo(lat, lon, opts) {
  state.lat = Math.max(-89, Math.min(89, lat));
  state.lon = ((lon + 540) % 360) - 180;
  draw();
  return updateReadout(opts);
}
function setYear(yi, opts = {}) {
  state.yi = Math.max(0, Math.min(state.track.years.length - 1, yi));
  draw();
  if (opts.quiet) return;
  updateReadout({ play: true, speakIt: false });
  announce(`${year()}. ${placeName(state.lat, state.lon)}: ${fmt(valueAt(state.yi, state.lat, state.lon))}.`);
}

// ---------- modes ----------
async function playHistory() {
  if (state.playing) { state.playing = false; return; }
  state.playing = true; setPlayingUI(true);
  const place = placeName(state.lat, state.lon), years = state.track.years;
  await speak(`${place}, ${years[0]} to ${years[years.length - 1]}.`);
  for (let i = 0; i < years.length && state.playing; i++) {
    state.yi = i; draw();
    const v = boxMean(i, state.lat, state.lon, 6);
    if (v == null) sound.noData(); else sound.note(tOf(v), { dur: 0.16, gain: 0.45 });
    if (years[i] % 50 === 0) { sound.tick({ when: sound.now + 0.08 }); announce(String(years[i])); }
    $('#rValue').textContent = fmt(v); $('#rNote').textContent = v == null ? 'silent' : noteName(tOf(v));
    await sleep(140);
  }
  const finished = state.playing;
  state.playing = false; setPlayingUI(false);
  if (finished) {
    const avg = (from, to) => { let s = 0, n = 0; for (let i = from; i <= to; i++) { const v = boxMean(i, state.lat, state.lon, 6); if (v != null) { s += v; n++; } } return n ? s / n : null; };
    const first = avg(0, 9), last = avg(years.length - 10, years.length - 1);
    const msg = first != null && last != null
      ? `Around ${place}, ${years[0]} to ${years[9]} averaged ${fmt(first)}. ${years[years.length - 10]} to ${years[years.length - 1]} averaged ${fmt(last)}. That is ${Math.abs(last - first).toFixed(1)} degrees ${last >= first ? 'warmer' : 'cooler'}.`
      : `Around ${place}, NASA's map has gaps in the early years, so we cannot compare the start and the end.`;
    $('#desc').textContent = msg;
    speak(msg);
  }
}
function setPlayingUI(on) { const b = $('#playBtn'); b.textContent = on ? 'Stop' : 'Play history'; b.setAttribute('aria-pressed', on); }

async function sweep() {
  if (state.busy) return; state.busy = true;
  const lat = state.lat, lon0 = state.lon;
  await speak(`Sweeping west to east along ${formatCoord(lat, 0).split(' ')[0]}.`);
  for (let lon = -180; lon <= 180; lon += 6) {
    state.lon = Math.min(179, lon); draw();
    const v = valueAt(state.yi, lat, state.lon);
    if (v == null) sound.noData({ pan: lon / 180 }); else sound.note(tOf(v), { pan: lon / 180, dur: 0.12, gain: 0.4, layers: false });
    await sleep(85);
  }
  state.lon = lon0; draw(); updateReadout({ play: false });
  state.busy = false;
}

async function hearLegend() {
  if (state.busy) return; state.busy = true;
  const { min, max, unit } = state.track;
  const parts = [[0, `Low note: ${min} degrees or colder than the 1951 to 1980 average.`], [0.5, 'Middle note: the same as the average.'], [1, `High note: plus ${max} degrees or warmer. Above plus 1, a second voice joins.`]];
  for (const [t, text] of parts) { await speak(text); sound.note(t, { dur: 0.6 }); await sleep(900); }
  state.busy = false;
}

function toggle(act) {
  if (act === 'voice') { state.voice = !state.voice; if (!state.voice) speechSynthesis?.cancel(); announce(state.voice ? 'Voice on' : 'Voice off'); }
  if (act === 'ref') { state.ref = !state.ref; sound.reference(state.ref, tOf(0)); announce(state.ref ? 'Average hum on. It plays the middle note.' : 'Average hum off'); }
  document.querySelector(`[data-act="${act}"]`).setAttribute('aria-pressed', act === 'voice' ? state.voice : state.ref);
}

function act(name) {
  if (name === 'legend') hearLegend();
  if (name === 'sweep') sweep();
  if (name === 'describe') { const t = describeYear(); $('#desc').textContent = t; speak(t); }
  if (name === 'voice' || name === 'ref') toggle(name);
}

const HELP = 'Arrow keys move ten degrees, with shift two degrees. Square brackets, or page up and page down, change the year; with shift, ten years. Space plays history. Enter reads this spot. S sweeps across. L plays the legend. D describes the year. B toggles the average hum. Numbers 1 to 9 jump to places. V turns the voice on or off.';

// ---------- input ----------
function onKey(e) {
  if (!state.track || e.target.tagName === 'INPUT' && e.key !== 'PageUp' && e.key !== 'PageDown') return;
  const step = e.shiftKey ? 2 : 10, k = e.key;
  const map = {
    ArrowLeft: () => moveTo(state.lat, state.lon - step), ArrowRight: () => moveTo(state.lat, state.lon + step),
    ArrowUp: () => moveTo(state.lat + step, state.lon), ArrowDown: () => moveTo(state.lat - step, state.lon),
    PageUp: () => setYear(state.yi + (e.shiftKey ? 10 : 1)), PageDown: () => setYear(state.yi - (e.shiftKey ? 10 : 1)),
    ']': () => setYear(state.yi + 1), '[': () => setYear(state.yi - 1), '}': () => setYear(state.yi + 10), '{': () => setYear(state.yi - 10),
    Home: () => setYear(0), End: () => setYear(state.track.years.length - 1),
    Enter: () => updateReadout({ speakIt: true }), ' ': () => playHistory(),
    s: () => act('sweep'), l: () => act('legend'), d: () => act('describe'), b: () => act('ref'), v: () => act('voice'), '?': () => speak(HELP),
  };
  let fn = map[k] || map[k.toLowerCase?.()];
  if (!fn && /^[1-9]$/.test(k)) { const p = JUMPS[+k - 1]; fn = () => { moveTo(p.lat, p.lon, { play: true }); speak(`${p.name}. ${say(valueAt(state.yi, state.lat, state.lon))}.`); }; }
  if (!fn) return;
  if (e.target.closest?.('button') && (k === 'Enter' || k === ' ')) return; // let buttons work normally
  e.preventDefault(); fn();
}

function pointToLatLon(e) {
  const r = $('#map').getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  return [90 - y * 180, x * 360 - 180];
}
let lastMove = 0;
function onPointerMove(e) {
  if (!state.track || state.playing || state.busy) return;
  const now = performance.now(); if (now - lastMove < 60) return; lastMove = now;
  const [lat, lon] = pointToLatLon(e);
  const cell = cellIndex(lat, lon);
  if (cell === state.lastCell) return; state.lastCell = cell;
  moveTo(lat, lon, { play: true });
}

// ---------- start ----------
async function start() {
  const ok = await sound.start();
  $('#start').hidden = true;
  $('#map').focus();
  draw(); updateReadout({ play: false });
  preloadAll();
  if (!ok) $('#desc').textContent = 'Sound is blocked. Tap anywhere on the page, and on iPhone turn off silent mode.';
  speak(`Earth Jukebox. ${state.track.title}. You are at ${placeName(state.lat, state.lon)} in ${year()}. ${say(valueAt(state.yi, state.lat, state.lon))}. Use the arrow keys to move, space to play history, and question mark for help.`);
}

function buildJumps() {
  $('#jumps').innerHTML = JUMPS.map((p, i) => `<button type="button" data-jump="${i}"><kbd>${i + 1}</kbd> ${p.name.replace(/^the /, '')}</button>`).join('');
  $('#jumps').addEventListener('click', e => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    const p = JUMPS[+b.dataset.jump]; moveTo(p.lat, p.lon); speak(`${p.name}. ${say(valueAt(state.yi, state.lat, state.lon))}.`);
  });
}

async function init() {
  await loadTrack('temperature');
  buildJumps();
  draw(); updateReadout({ play: false });
  $('#desc').textContent = describeYear();
  $('#startBtn').addEventListener('click', start);
  $('#playBtn').addEventListener('click', () => { sound.start(); playHistory(); });
  $('#year').addEventListener('input', e => setYear(+e.target.value));
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { sound.start(); act(b.dataset.act); }));
  document.addEventListener('keydown', onKey);
  const m = $('#map');
  m.addEventListener('pointermove', onPointerMove);
  m.addEventListener('pointerdown', e => { sound.start(); const [lat, lon] = pointToLatLon(e); state.lastCell = cellIndex(lat, lon); moveTo(lat, lon); });
  m.addEventListener('pointerup', () => updateReadout({ play: false, speakIt: true }));
}
init();
