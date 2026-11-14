// AI-assisted (Anthropic Claude).
// Earth Jukebox: explore a NASA visualization by ear.
// Two modes share one interface:
//   track - a prepared NASA time series (Global temperature 1880–2025)
//   image - any NASA picture with a color bar, calibrated on the spot
import { Sound, noteName } from './audio.js';
import { JUMPS, placeName, formatCoord } from './places.js';
import { ImageSource, describeSpot } from './image-source.js';
import { Globe } from './globe.js';

const $ = s => document.querySelector(s);
const sound = new Sound();
const src = new ImageSource();
const globe = new Globe($('#globe'));
const state = {
  mode: 'track', track: null, cube: null, yi: 0, lat: 2.3, lon: 111.8,
  u: 0.5, v: 0.5, cal: { step: 0, p0: null, p1: null },
  voice: true, ref: false, playing: false, busy: false, images: new Map(), lastCell: -1,
  texYear: null, taps: [], lastTapAt: 0, replaying: false,
};

// ---------- track data ----------
async function loadTrack(id) {
  const track = await (await fetch(`assets/${id}/track.json`)).json();
  const cube = new Uint8Array(await (await fetch(`assets/${id}/cube.bin`)).arrayBuffer());
  Object.assign(state, { track, cube, yi: track.years.length - 1 });
  const yr = $('#year'); yr.max = track.years.length - 1; yr.value = state.yi;
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
function trackValue(yi, lat, lon) { const { width: W, height: H } = grid(); return decode(state.cube[yi * W * H + cellIndex(lat, lon)]); }
function boxMean(yi, lat, lon, r = 6) { // area-weighted average around a point
  const d = grid().cellDegrees;
  let s = 0, w = 0;
  for (let la = lat - r + d / 2; la <= lat + r; la += d) {
    if (la < -90 || la > 90) continue;
    const k = Math.cos(la * Math.PI / 180);
    for (let lo = lon - r + d / 2; lo <= lon + r; lo += d) { const v = trackValue(yi, la, lo); if (v != null) { s += v * k; w += k; } }
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
      const v = decode(state.cube[yi * W * H + cy * W + cx]);
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
function currentValue() { return isImage() ? src.valueAt(state.u, state.v) : trackValue(state.yi, state.lat, state.lon); }
function currentPlace() { return isImage() ? describeSpot(state.u, state.v) : placeName(state.lat, state.lon); }
function currentCoord() { return isImage() ? `${Math.round(state.u * 100)}% across, ${Math.round(state.v * 100)}% down` : formatCoord(state.lat, state.lon); }
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
  const s = `${signed ? (v >= 0 ? '+' : '−') : (v < 0 ? '−' : '')}${nice(Math.abs(v))} ${unit}`.trim();
  const span = max - min;
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
    if (st.mean == null) return 'No colors on this picture match the color bar. Try marking the bar again, closer to its middle.';
    return `${Math.round(st.coverage * 100)}% of this picture matches the color bar. Average ${fmt(st.mean)}. Highest ${fmt(st.hi)}, at the ${describeSpot(st.hiAt.u, st.hiAt.v)}. Lowest ${fmt(st.lo)}, at the ${describeSpot(st.loAt.u, st.loAt.v)}.`;
  }
  const st = yearStats(state.yi);
  const warm = st.bands.reduce((a, b) => (b.mean > a.mean ? b : a));
  const cool = st.bands.reduce((a, b) => (b.mean < a.mean ? b : a));
  return `${year()}. Compared with 1951–1980, the parts of the map with data (${Math.round(st.coverage * 100)}% of Earth's area) average about ${fmt(st.mean)}. ` +
    `Warmest: ${warm.name}, ${fmt(warm.mean)}. Coolest: ${cool.name}, ${fmt(cool.mean)}. ` +
    `Around ${placeName(state.lat, state.lon)}: ${fmt(boxMean(state.yi, state.lat, state.lon, 4))}.`;
}

// ---------- speech ----------
let voicePick = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voicePick = vs.find(v => /en-(US|GB|AU)/i.test(v.lang) && /Samantha|Google|Natural|Daniel|Karen/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null;
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
    const img = new Image(); img.decoding = 'async';
    img.src = `assets/${state.track.id}/frames/${y}.jpg`;
    img.onload = () => { if (!isImage() && year() === y) draw(); };
    state.images.set(y, img);
  }
  return state.images.get(y);
}
function preloadAll() { state.track.years.forEach((_, i) => setTimeout(() => frameImage(i), i * 40)); }

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
  if (img.complete && img.naturalWidth) { if (state.texYear !== year()) { globe.setTexture(img); state.texYear = year(); } }
  else if (state.texYear == null) {
    for (let d = 1; d < 15; d++) { const alt = state.images.get(state.track.years[state.yi - d]); if (alt?.complete && alt.naturalWidth) { globe.setTexture(alt); break; } }
  }
  globe.setMarker(state.lat, state.lon);
  $('#yearBig').textContent = year(); $('#yearOut').textContent = year();
  $('#year').value = state.yi; $('#year').setAttribute('aria-valuetext', String(year()));
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
  $('#lgMin').textContent = `${fmt(min)}`;
  $('#lgMid').textContent = isImage() ? fmt((min + max) / 2) : '0 = 1951–1980 average';
  $('#lgMax').textContent = `${fmt(max)}`;
}

// ---------- readout ----------
function updateReadout({ play = true, speakIt = false } = {}) {
  if (isImage() && !src.legend) return null;
  const v = currentValue(), place = currentPlace();
  $('#rPlace').textContent = place; $('#rCoord').textContent = currentCoord();
  $('#rValue').textContent = fmt(v); $('#rNote').textContent = v == null ? 'silent' : noteName(tOf(v));
  if (play) { if (v == null) sound.noData({ pan: currentPan() }); else sound.note(tOf(v), { pan: currentPan() }); }
  const when = isImage() ? '' : `, ${year()}`;
  if (speakIt) speak(`${place}${when}. ${say(v)}.`); else announce(`${place}. ${fmt(v)}.`);
  return v;
}
function moveTo(lat, lon, opts = {}) {
  state.lat = Math.max(-89, Math.min(89, lat)); state.lon = ((lon + 540) % 360) - 180;
  if (opts.center && !isImage()) globe.centerOn(state.lat, state.lon);
  draw(); return updateReadout(opts);
}

// ---------- play the Earth like an instrument ----------
function tapAt(lat, lon, { record = true } = {}) {
  state.lat = lat; state.lon = lon;
  const v = trackValue(state.yi, lat, lon), pan = panFor(lat, lon);
  if (v == null) sound.noData({ pan }); else sound.tap(tOf(v), { pan });
  globe.ripple(lat, lon);
  draw(); updateReadout({ play: false });
  if (record) {
    const now = performance.now();
    const gap = state.taps.length ? Math.min(1200, now - state.lastTapAt) : 0;
    state.lastTapAt = now;
    state.taps.push({ gap, lat, lon });
    if (state.taps.length > 32) state.taps.shift();
    updateTapUI();
  }
}
function updateTapUI() {
  const n = state.taps.length;
  $('#replayBtn').disabled = n === 0; $('#clearBtn').disabled = n === 0;
  $('#tapCount').textContent = n
    ? `Your melody: ${n} tap${n > 1 ? 's' : ''}. Replay it, then press "In 1880" to hear the same taps in a cooler world.`
    : 'Tap a few places to make a melody. Then change the year and replay it: the same taps sound different in 1880.';
}
async function replayTaps() {
  if (state.replaying || !state.taps.length) return;
  state.replaying = true; $('#replayBtn').disabled = true;
  announce(`Replaying your melody in ${year()}.`);
  for (const t of state.taps) {
    await sleep(Math.max(120, t.gap));
    tapAt(t.lat, t.lon, { record: false });
  }
  state.replaying = false; updateTapUI();
}
function yearIndexOf(y) { return Math.max(0, state.track.years.indexOf(y)); }
function moveUV(u, v, opts) {
  state.u = Math.max(0, Math.min(1, u)); state.v = Math.max(0, Math.min(1, v));
  draw(); return updateReadout(opts);
}
function setYear(yi) {
  if (isImage()) return;
  state.yi = Math.max(0, Math.min(state.track.years.length - 1, yi));
  draw(); updateReadout({ play: true });
  announce(`${year()}. ${placeName(state.lat, state.lon)}: ${fmt(currentValue())}.`);
}

// ---------- actions ----------
async function playHistory() {
  if (isImage()) return;
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
  if (!finished) return;
  const avg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) { const v = boxMean(i, state.lat, state.lon, 6); if (v != null) { s += v; n++; } } return n ? s / n : null; };
  const L = years.length, first = avg(0, 9), last = avg(L - 10, L - 1);
  const msg = first != null && last != null
    ? `Around ${place}, ${years[0]} to ${years[9]} averaged ${fmt(first)}. ${years[L - 10]} to ${years[L - 1]} averaged ${fmt(last)}. That is ${Math.abs(last - first).toFixed(1)} degrees ${last >= first ? 'warmer' : 'cooler'}.`
    : `Around ${place}, NASA's map has gaps in the early years, so the start and the end cannot be compared.`;
  $('#desc').textContent = msg; speak(msg);
}
function setPlayingUI(on) { const b = $('#playBtn'); b.textContent = on ? 'Stop' : 'Play 1880 → 2025'; b.setAttribute('aria-pressed', on); }

async function sweep() {
  if (state.busy || (isImage() && !src.legend)) return;
  state.busy = true;
  if (isImage()) {
    const u0 = state.u;
    await speak('Sweeping left to right.');
    for (let u = 0; u <= 1.0001; u += 1 / 60) {
      state.u = Math.min(1, u); draw();
      const v = src.valueAt(state.u, state.v);
      if (v == null) sound.noData({ pan: u * 2 - 1 }); else sound.note(tOf(v), { pan: u * 2 - 1, dur: 0.12, gain: 0.4, layers: false });
      await sleep(85);
    }
    state.u = u0;
  } else {
    // one full turn of the Earth along this latitude, starting and ending where you are
    const lat = state.lat, lon0 = state.lon;
    await speak(`Going once around the Earth along ${formatCoord(lat, 0).split(' ')[0]}.`);
    for (let k = 0; k <= 60; k++) {
      state.lon = ((lon0 + k * 6 + 540) % 360) - 180;
      globe.centerOn(lat, state.lon, 80); draw();
      const v = trackValue(state.yi, lat, state.lon);
      if (v == null) sound.noData(); else sound.note(tOf(v), { dur: 0.12, gain: 0.4, layers: false });
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
    ? [[0, `Low note: ${say(min)}.`], [0.5, `Middle note: ${say((min + max) / 2)}.`], [1, `High note: ${say(max)}.`]]
    : [[0, `Low note: ${min} degrees, colder than the 1951 to 1980 average.`], [0.5, 'Middle note: the same as the average.'], [1, `High note: plus ${max} degrees or warmer. Above plus 1, a second voice joins.`]];
  for (const [t, text] of parts) { await speak(text); sound.note(t, { dur: 0.6 }); await sleep(900); }
  state.busy = false;
}

function toggle(act) {
  if (act === 'voice') { state.voice = !state.voice; if (!state.voice) speechSynthesis?.cancel(); announce(state.voice ? 'Voice on' : 'Voice off'); }
  if (act === 'ref' && scale()) { state.ref = !state.ref; sound.reference(state.ref, isImage() ? 0.5 : tOf(0)); announce(state.ref ? 'Average hum on. It plays the middle note.' : 'Average hum off'); }
  document.querySelector(`[data-act="${act}"]`).setAttribute('aria-pressed', act === 'voice' ? state.voice : state.ref);
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
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
  const img = isImage();
  $('#byo').hidden = !img;
  $('#globeWrap').hidden = img; $('#mapWrap').hidden = !img;
  $('.timeline').hidden = img; $('.jumps').hidden = img; $('#playBox').hidden = img;
  $('#trackTitle').textContent = img ? (src.canvas ? `Your map: ${src.name}` : 'Your own NASA map') : state.track.title;
  $('#trackSub').textContent = img ? 'Any NASA picture with a color bar' : state.track.subtitle;
  $('#credit').innerHTML = img ? 'Picture supplied by you. Please credit its source, for example the NASA Scientific Visualization Studio page you copied it from.' : `${state.track.credit}. <a href="${state.track.sourceUrl}">${state.track.sourceUrl}</a>`;
  $('#map').setAttribute('aria-label', 'Your picture. After the color bar is marked, arrow keys move and Enter reads the spot.');
  if (!img) globe.request();
  draw(); drawLegend();
  if (img) { updateSteps(); if (src.legend) updateReadout({ play: false }); else clearReadout(); }
  else { updateReadout({ play: false }); $('#desc').textContent = describe(); }
}
function clearReadout() { ['#rPlace', '#rCoord', '#rValue', '#rNote'].forEach(s => { $(s).textContent = '—'; }); $('#desc').textContent = ''; }
function updateSteps() {
  const step = !src.canvas ? 0 : state.cal.step; // 0 no picture, 1 low end, 2 high end, 3 values, 4 ready
  [['#st1', 1], ['#st2', 2], ['#st3', 3]].forEach(([id, n]) => { const li = $(id); li.classList.toggle('now', step === n); li.classList.toggle('done', step > n); });
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

// ---------- input ----------
const HELP = 'Arrow keys travel, with shift in small steps. Square brackets, or page up and page down, change the year. Space plays 1880 to 2025. T taps here, R replays your taps. Enter reads this spot. S goes once around the Earth. L plays the legend. D describes the year. B toggles the average hum. Numbers 1 to 9 travel to places. V turns the voice on or off.';
function onKey(e) {
  if (!state.track) return;
  if (e.target.matches?.('input, textarea')) { if (e.key === 'Enter' && e.target.closest('#byo')) makeItSing(); return; }
  const k = e.key, img = isImage();
  if (img && !src.legend && k !== '?') return;
  const step = img ? (e.shiftKey ? 0.01 : 0.05) : (e.shiftKey ? 2 : 10);
  const move = (dy, dx) => (img ? moveUV(state.u + dx * step, state.v + dy * step) : moveTo(state.lat - dy * step, state.lon + dx * step, { center: true }));
  const map = {
    ArrowLeft: () => move(0, -1), ArrowRight: () => move(0, 1), ArrowUp: () => move(-1, 0), ArrowDown: () => move(1, 0),
    PageUp: () => setYear(state.yi + (e.shiftKey ? 10 : 1)), PageDown: () => setYear(state.yi - (e.shiftKey ? 10 : 1)),
    ']': () => setYear(state.yi + 1), '[': () => setYear(state.yi - 1), '}': () => setYear(state.yi + 10), '{': () => setYear(state.yi - 10),
    Home: () => setYear(0), End: () => setYear(state.track.years.length - 1),
    Enter: () => updateReadout({ speakIt: true }), ' ': () => playHistory(),
    s: () => act('sweep'), l: () => act('legend'), d: () => act('describe'), b: () => act('ref'), v: () => act('voice'), '?': () => speak(HELP),
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

// Globe: tap to play, drag to spin, hover (mouse) to listen
const drag = { on: false, x: 0, y: 0, moved: 0, id: null };
function onGlobeDown(e) {
  sound.start();
  Object.assign(drag, { on: true, x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId });
  $('#globe').setPointerCapture(e.pointerId);
}
function onGlobeMove(e) {
  if (drag.on && e.pointerId === drag.id) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.moved > 6) globe.rotateBy(dx, dy);
    return;
  }
  if (e.pointerType !== 'mouse' || state.playing || state.busy || state.replaying) return;
  const now = performance.now(); if (now - lastMove < 70) return; lastMove = now;
  const p = globe.pick(e.clientX, e.clientY); if (!p) return;
  const cell = cellIndex(p.lat, p.lon);
  if (cell !== state.lastCell) { state.lastCell = cell; moveTo(p.lat, p.lon); }
}
function onGlobeUp(e) {
  if (!drag.on || e.pointerId !== drag.id) return;
  drag.on = false;
  if (drag.moved > 6) return; // that was a spin, not a tap
  const p = globe.pick(e.clientX, e.clientY);
  if (p) { $('#globeHint').hidden = true; tapAt(p.lat, p.lon); }
}

// ---------- start ----------
async function start() {
  const ok = await sound.start();
  $('#start').hidden = true; $('#globe').focus();
  draw(); updateReadout({ play: false }); preloadAll();
  if (!ok) $('#desc').textContent = 'Sound is blocked. Tap anywhere on the page, and on iPhone turn off silent mode.';
  speak(`Earth Jukebox. ${state.track.title}. You are at ${placeName(state.lat, state.lon)} in ${year()}. ${say(currentValue())}. Tap the globe, or use the arrow keys to travel. Space plays 1880 to 2025. Question mark for help.`);
}
function buildJumps() {
  $('#jumps').innerHTML = JUMPS.map((p, i) => `<button type="button" data-jump="${i}"><kbd>${i + 1}</kbd> ${p.name.replace(/^the /, '')}</button>`).join('');
  $('#jumps').addEventListener('click', e => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    sound.start(); const p = JUMPS[+b.dataset.jump]; moveTo(p.lat, p.lon, { center: true }); speak(`${p.name}. ${say(currentValue())}.`);
  });
}

async function init() {
  await loadTrack('temperature');
  buildJumps();
  setMode('track');
  $('#startBtn').addEventListener('click', start);
  $('#playBtn').addEventListener('click', () => { sound.start(); playHistory(); });
  $('#year').addEventListener('input', e => { sound.start(); setYear(+e.target.value); });
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { sound.start(); act(b.dataset.act); }));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.addEventListener('keydown', onKey);
  const g = $('#globe');
  g.addEventListener('pointerdown', onGlobeDown);
  g.addEventListener('pointermove', onGlobeMove);
  g.addEventListener('pointerup', onGlobeUp);
  g.addEventListener('pointercancel', () => { drag.on = false; });
  const m = $('#map');
  m.addEventListener('pointermove', onMapMove);
  m.addEventListener('pointerdown', onMapDown);
  m.addEventListener('pointerup', onMapUp);
  // play the Earth
  $('#replayBtn').addEventListener('click', () => { sound.start(); replayTaps(); });
  $('#clearBtn').addEventListener('click', () => { state.taps = []; updateTapUI(); announce('Melody cleared.'); });
  document.querySelectorAll('[data-year-jump]').forEach(b => b.addEventListener('click', () => {
    sound.start(); state.yi = yearIndexOf(+b.dataset.yearJump); draw(); updateReadout({ play: false });
    announce(`Year ${year()}.`); if (state.taps.length) replayTaps();
  }));
  // your own map: pick, drop, paste
  $('#pickBtn').addEventListener('click', () => $('#pickFile').click());
  $('#pickFile').addEventListener('change', e => usePicture(e.target.files[0]));
  $('#singBtn').addEventListener('click', makeItSing);
  const wrap = $('#mapWrap');
  document.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) wrap.classList.remove('drop'); });
  document.addEventListener('drop', e => { e.preventDefault(); wrap.classList.remove('drop'); if (e.dataTransfer.files[0]) { $('#start').hidden = true; sound.start(); usePicture(e.dataTransfer.files[0]); } });
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); $('#start').hidden = true; sound.start(); usePicture(item.getAsFile()); }
  });
}
init();
