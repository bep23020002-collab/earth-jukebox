// AI-assisted (Anthropic Claude).
// Earth Jukebox: explore a NASA visualization by ear.
// Two modes share one interface:
//   track - a prepared NASA time series (Global temperature 1880–2025)
//   image - any NASA picture with a color bar, calibrated on the spot
import { Sound } from './audio.js';
import { JUMPS, placeName, formatCoord, PLACE_NAMES, findPlace } from './places.js';
import { ImageSource, describeSpot } from './image-source.js';
import { Globe } from './globe.js';
import { composeSong, scheduleSong, BPM, BEATS_PER_MOMENT } from './song.js';

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
    if (st.mean == null) return 'None of the colors match the color bar. Try marking the bar again, a little closer to its middle.';
    return `The highest values are at the ${describeSpot(st.hiAt.u, st.hiAt.v)} (${fmt(st.hi)}). The lowest are at the ${describeSpot(st.loAt.u, st.loAt.v)} (${fmt(st.lo)}).`;
  }
  const st = yearStats(state.yi);
  const warm = st.bands.reduce((a, b) => (b.mean > a.mean ? b : a));
  const overall = st.mean < -0.3 ? 'most of the world was colder than normal' : st.mean < 0.3 ? 'the world as a whole was about normal'
    : st.mean < 1 ? 'most of the world was warmer than normal' : 'most of the world was much warmer than normal';
  const here = boxMean(state.yi, state.lat, state.lon, 4);
  return `In ${year()}, ${overall}. The warmest part was ${warm.name}. Near ${placeName(state.lat, state.lon)}, it was ${feeling(here).toLowerCase()}.`;
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
  $('#lgMin').textContent = isImage() ? `Low: ${fmt(min)}` : 'Colder than normal';
  $('#lgMid').textContent = isImage() ? '' : 'Normal';
  $('#lgMax').textContent = isImage() ? `High: ${fmt(max)}` : 'Hotter than normal';
}

// ---------- readout ----------
function updateReadout({ play = true, speakIt = false } = {}) {
  if (isImage() && !src.legend) return null;
  const v = currentValue(), place = currentPlace();
  showValue(v, place);
  if (play) { if (v == null) sound.noData({ pan: currentPan() }); else sound.note(tOf(v), { pan: currentPan() }); }
  const when = isImage() ? '' : ` in ${year()}`;
  if (speakIt) speak(`${place}${when}. ${feeling(v)}${v == null ? '' : `, ${say(v)}`}.`); else announce(`${place}. ${feeling(v)}.`);
  return v;
}
function showValue(v, place) {
  if (place) $('#rPlace').textContent = place;
  $('#rValue').textContent = feeling(v);
  $('#rDetail').textContent = v == null ? 'NASA has no measurement here' : isImage() ? fmt(v) : `${fmt(v)} compared with normal`;
}
// Plain words first; the number is shown smaller underneath.
function feeling(v) {
  if (v == null) return 'No data';
  if (isImage()) {
    const t = tOf(v);
    return t < 0.15 ? 'Very low' : t < 0.4 ? 'Low' : t < 0.6 ? 'In the middle' : t < 0.85 ? 'High' : 'Very high';
  }
  return v <= -1 ? 'Much colder than normal' : v <= -0.3 ? 'Colder than normal' : v < 0.3 ? 'About normal'
    : v < 1 ? 'Warmer than normal' : v < 1.6 ? 'Much warmer than normal' : 'Extremely warm';
}
function moveTo(lat, lon, opts = {}) {
  $('#nowBox').hidden = false;
  state.lat = Math.max(-89, Math.min(89, lat)); state.lon = ((lon + 540) % 360) - 180;
  if (opts.center && !isImage()) globe.centerOn(state.lat, state.lon);
  draw(); return updateReadout(opts);
}

// ---------- play the Earth like an instrument ----------
function tapAt(lat, lon, { record = true, fromDraw = false } = {}) {
  $('#nowBox').hidden = false;
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
    if (!fromDraw) guideAfterTap(v); // a drawn line moves the guide on when the line ends
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
  for (const t of state.taps) {
    await sleep(Math.max(250, Math.min(700, t.gap)));
    tapAt(t.lat, t.lon, { record: false });
  }
  await sleep(500);
  state.replaying = false; updateTapUI();
}

// ---------- step-by-step guide (first visit) ----------
const guide = { step: 1, done: false };
function setGuide({ label, title, text, btn, alt }) {
  $('#guideStep').textContent = label || '';
  $('#guideTitle').textContent = title; $('#guideText').textContent = text || '';
  for (const [id, b] of [['#guideBtn', btn], ['#guideAlt', alt]]) {
    const el = $(id); el.hidden = !b; el.disabled = false;
    if (b) { el.textContent = b[0]; el.onclick = async () => { sound.start(); el.disabled = true; await b[1](); }; }
  }
  speak(`${title}. ${text || ''}`);
}
function resetGuide() {
  state.taps = []; updateTapUI(); guide.step = 1; globe.clearStrokes();
  setGuide({ label: 'Step 1 of 3', title: 'Tap the Earth, or draw a line on it', text: 'Every place plays a note. Warmer places play higher notes. A line you draw becomes a tune.' });
}
function guideAfterTap(v) {
  if (state.mode !== 'track' || guide.step !== 1) return;
  const n = state.taps.length, place = placeName(state.lat, state.lon);
  if (n < 3) {
    setGuide({ label: 'Step 1 of 3', title: n === 1 ? 'Nice! Tap 2 more places' : 'Tap 1 more place', text: `That was ${place}: ${feeling(v).toLowerCase()}. You can also draw a line across the Earth.` });
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
  guide.step = 4; guide.done = true; $('.timeline').hidden = false;
  const avg = y => { const yi = yearIndexOf(y); const vs = state.taps.map(t => boxMean(yi, t.lat, t.lon, 4)).filter(v => v != null); return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; };
  const a = avg(1880), b = avg(2025), d = a != null && b != null ? b - a : null;
  const text = d == null ? 'NASA has no 1880 data for some of your places, so try places with more history, like Europe or the USA.'
    : d > 0.2 ? `Your tune went higher. The places you chose are about ${d.toFixed(1)} °C warmer than in 1880. That is what climate change sounds like.`
      : d < -0.2 ? `Your tune went lower. The places you chose were cooler in 2025 than in 1880, which is rare. Most of the world got warmer.`
        : 'Your tune stayed about the same. These places changed less than most of the world. Try tapping the Arctic.';
  setGuide({
    label: 'You did it', title: d != null && d > 0.2 ? 'Did you hear it go higher?' : 'What did you hear?', text,
    btn: ['Make my own Earth song', async () => setMode('song')],
    alt: ['Try other places', async () => resetGuide()],
  });
}
async function playTuneIn(y) {
  state.yi = yearIndexOf(y); draw(); updateReadout({ play: false });
  $('#guideTitle').textContent = `Playing your tune in ${y}…`;
  await replayTaps();
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
    showValue(v);
    await sleep(140);
  }
  const finished = state.playing;
  state.playing = false; setPlayingUI(false);
  if (!finished) return;
  const avg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) { const v = boxMean(i, state.lat, state.lon, 6); if (v != null) { s += v; n++; } } return n ? s / n : null; };
  const L = years.length, first = avg(0, 9), last = avg(L - 10, L - 1);
  const msg = first != null && last != null
    ? `Near ${place}: the 1880s were ${feeling(first).toLowerCase()}. Today it is ${feeling(last).toLowerCase()}. That is about ${Math.abs(last - first).toFixed(1)} °C ${last >= first ? 'warmer' : 'cooler'} than in the 1880s.`
    : `NASA has no measurements near ${place} in the early years, so we can't compare then and now. Try another place.`;
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
    await speak('Spinning the Earth. Listen as we go around.');
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
    ? [[0, `This low note means the lowest value on the color bar.`], [0.5, `This middle note means the middle of the color bar.`], [1, `This high note means the highest value.`]]
    : [[0, 'This low note means colder than normal.'], [0.5, 'This middle note means normal.'], [1, 'This high note means much hotter than normal. When it is very warm, a second voice joins in.']];
  for (const [t, text] of parts) { await speak(text); sound.note(t, { dur: 0.6 }); await sleep(900); }
  state.busy = false;
}

function toggle(act) {
  if (act === 'voice') { state.voice = !state.voice; if (!state.voice) speechSynthesis?.cancel(); announce(state.voice ? 'Voice on' : 'Voice off'); }
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
  const img = isImage(), song = mode === 'song';
  $('#byo').hidden = !img; $('#songBox').hidden = !song;
  $('#globeWrap').hidden = img; $('#mapWrap').hidden = !img;
  $('.timeline').hidden = img || song || !guide.done;
  $('#guide').hidden = img || song; $('#moreBox').hidden = img || song;
  if (!img && !song) $('#nowBox').hidden = state.taps.length === 0 && !guide.done;
  $('#trackTitle').textContent = img ? (src.canvas ? `Your map: ${src.name}` : 'Your own NASA map') : song ? 'My Earth song' : state.track.title;
  $('#trackSub').textContent = img ? 'Any NASA picture with a color bar' : song ? 'Years and places that matter to you, played as music' : state.track.subtitle;
  if (song) renderMoments();
  $('#credit').innerHTML = img ? 'Picture supplied by you. Please credit its source, for example the NASA Scientific Visualization Studio page you copied it from.' : `${state.track.credit}. <a href="${state.track.sourceUrl}">${state.track.sourceUrl}</a>`;
  $('#map').setAttribute('aria-label', 'Your picture. After the color bar is marked, arrow keys move and Enter reads the spot.');
  if (!img) globe.request();
  draw(); drawLegend();
  if (img) { updateSteps(); if (src.legend) updateReadout({ play: false }); else clearReadout(); }
  else { updateReadout({ play: false }); $('#desc').textContent = song || guide.done ? describe() : ''; }
}
function clearReadout() { ['#rPlace', '#rValue', '#rDetail'].forEach(s => { $(s).textContent = '—'; }); $('#desc').textContent = ''; }
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

// Globe gestures:
//   tap                         -> play that place
//   press and drag              -> draw a line; every place it crosses plays, and the line becomes your tune
//   Shift+drag, two fingers, or drag starting off the globe -> spin the Earth
//   mouse hover                 -> listen without clicking
const drag = { on: false, x: 0, y: 0, moved: 0, id: null, mode: 'pending', lastNoteAt: 0, lastCell: -1, notes: 0 };
const touches = new Map();
function onGlobeDown(e) {
  sound.start();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { $('#globe').setPointerCapture(e.pointerId); } catch { /* synthetic or ended pointer */ }
  if (touches.size >= 2) { drag.mode = 'spin'; return; } // second finger: spin
  const onGlobe = !!globe.pick(e.clientX, e.clientY);
  const spin = e.shiftKey || e.button === 1 || e.button === 2 || !onGlobe || state.replaying || state.songPlaying;
  Object.assign(drag, { on: true, x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, mode: spin ? 'spin' : 'pending', lastCell: -1, notes: 0 });
}
function drawAt(clientX, clientY) {
  const p = globe.pick(clientX, clientY); if (!p) return;
  globe.addPoint(p.lat, p.lon);
  const now = performance.now(), cell = cellIndex(p.lat, p.lon);
  if (cell !== drag.lastCell && now - drag.lastNoteAt >= 140) {
    drag.lastCell = cell; drag.lastNoteAt = now; drag.notes++;
    tapAt(p.lat, p.lon, { record: state.mode !== 'song', fromDraw: true });
  }
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
    if (drag.mode === 'pending' && drag.moved > 6) {
      if (state.mode === 'song' && state.picking != null) drag.mode = 'spin';
      else { drag.mode = 'draw'; globe.startStroke(); $('#globeHint').hidden = true; }
    }
    if (drag.mode === 'spin' && touches.size < 2) globe.rotateBy(dx, dy);
    if (drag.mode === 'draw') drawAt(e.clientX, e.clientY);
    return;
  }
  if (e.pointerType !== 'mouse' || state.playing || state.busy || state.replaying) return;
  const now = performance.now(); if (now - lastMove < 70) return; lastMove = now;
  const p = globe.pick(e.clientX, e.clientY); if (!p) return;
  const cell = cellIndex(p.lat, p.lon);
  if (cell !== state.lastCell) { state.lastCell = cell; moveTo(p.lat, p.lon); }
}
function onGlobeUp(e) {
  touches.delete(e.pointerId);
  if (!drag.on || e.pointerId !== drag.id) return;
  drag.on = false;
  if (drag.mode === 'draw') {
    announce(`Your line played ${drag.notes} notes.`);
    guideAfterTap(currentValue());
    return;
  }
  if (drag.mode !== 'pending') return; // that was a spin
  const p = globe.pick(e.clientX, e.clientY);
  if (!p) return;
  $('#globeHint').hidden = true;
  if (state.mode === 'song' && state.picking != null) { setMomentPlace(state.picking, p.lat, p.lon); return; }
  tapAt(p.lat, p.lon, { record: state.mode !== 'song' });
}

// ---------- my Earth song ----------
const DEFAULT_MOMENTS = [
  { year: 1900, name: 'Sibu, Sarawak', label: 'Long before I was born' },
  { year: 1965, name: 'Sibu, Sarawak', label: 'When my grandparents were young' },
  { year: 2000, name: 'Kuching', label: 'The year 2000' },
  { year: 2025, name: 'Sibu, Sarawak', label: 'Today' },
];
function resolveMoment(m) {
  if (m.lat != null && m.lon != null) return m;
  const p = findPlace(m.name || '');
  return p ? { ...m, lat: p.lat, lon: p.lon, name: m.name } : m;
}
function momentFeeling(m) {
  const r = resolveMoment(m);
  if (r.lat == null || !(m.year >= 1880 && m.year <= 2025)) return '';
  const v = boxMean(yearIndexOf(m.year), r.lat, r.lon, 6);
  return v == null ? 'NASA has no data here for that year.' : `${feeling(v)} (${fmt(v)})`;
}
function renderMoments() {
  const ol = $('#moments');
  ol.innerHTML = state.moments.map((m, i) => `
    <li class="moment${state.picking === i ? ' picking' : ''}" data-i="${i}">
      <label class="m-f"><span>Year</span><input class="m-year" type="number" min="1880" max="2025" value="${m.year ?? ''}" inputmode="numeric"></label>
      <label class="m-f"><span>Place</span><input class="m-place" list="placeList" value="${(m.name || '').replace(/"/g, '&quot;')}" placeholder="Town or city"></label>
      <button type="button" class="m-remove" aria-label="Remove moment ${i + 1}">✕</button>
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
  const bad = moments.findIndex(m => m.lat == null || !(m.year >= 1880 && m.year <= 2025));
  if (!moments.length) { $('#songStatus').textContent = 'Add at least one moment.'; return; }
  if (bad >= 0) { $('#songStatus').textContent = `Moment ${bad + 1}: choose a year from 1880 to 2025 and a place from the list, or pick it on the globe.`; return; }
  const song = composeSong(moments, {
    yearIndexOf, tOf,
    localMean: (yi, lat, lon) => boxMean(yi, lat, lon, 6),
    valueAt: (yi, lat, lon) => trackValue(yi, lat, lon) ?? boxMean(yi, lat, lon, 4),
  });
  state.songPlaying = true; $('#playSong').textContent = 'Stop';
  sound.beginSong();
  const t0 = scheduleSong(song, sound), spb = 60 / BPM, lead = (t0 - sound.now) * 1000;
  const at = (beat, fn) => songTimers.push(setTimeout(fn, lead + beat * spb * 1000));
  song.sections.forEach((sec, k) => {
    const m = sec.moment;
    at(sec.startBeat, () => {
      document.querySelectorAll('.moment').forEach((li, j) => li.classList.toggle('playing', j === k));
      state.yi = sec.yearIndex; state.lat = m.lat; state.lon = m.lon;
      globe.centerOn(m.lat, m.lon, 500); draw(); $('#nowBox').hidden = false; showValue(sec.mean, m.name);
      $('#desc').textContent = `${m.year}, ${m.name}${m.label ? `: ${m.label}` : ''}.`;
      announce(`${m.year}, ${m.name}. ${feeling(sec.mean)}.`);
    });
    sec.notes.forEach(n => at(sec.startBeat + n.beat, () => globe.ripple(n.lat, n.lon)));
  });
  at(song.sections.length * BEATS_PER_MOMENT + 3.5, () => {
    stopSong();
    const first = song.sections[0], last = song.sections[song.sections.length - 1];
    const msg = song.sections.length > 1 && first.mean != null && last.mean != null
      ? `Your Earth song starts in ${first.moment.year} (${feeling(first.mean).toLowerCase()}) and ends in ${last.moment.year} (${feeling(last.mean).toLowerCase()}).`
      : 'That was your Earth song.';
    $('#desc').textContent = msg; $('#songStatus').textContent = 'Change a year or a place and play it again.';
    speak(msg);
  });
}
function songLink() {
  const data = state.moments.map(m => [m.year, m.name, m.label || '', m.lat == null ? null : +m.lat.toFixed(2), m.lon == null ? null : +m.lon.toFixed(2)]);
  return `${location.origin}${location.pathname}#song=${encodeURIComponent(JSON.stringify(data))}`;
}
function readSongLink() {
  const m = location.hash.match(/^#song=(.+)$/); if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])).slice(0, 6).map(([year, name, label, lat, lon]) => ({ year: +year, name: String(name || ''), label: String(label || ''), lat: lat ?? null, lon: lon ?? null }));
  } catch { return null; }
}
async function shareSong() {
  const url = songLink();
  try { await navigator.clipboard.writeText(url); $('#songStatus').textContent = 'Link copied. Send it to a friend so they can hear your Earth song.'; }
  catch { $('#songStatus').textContent = url; }
}

// ---------- start ----------
async function start() {
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
  await loadTrack('temperature');
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
  $('#shareSong').addEventListener('click', shareSong);
  setMode(shared ? 'song' : 'track');
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
  g.addEventListener('pointercancel', e => { drag.on = false; touches.delete(e.pointerId); });
  g.addEventListener('contextmenu', e => e.preventDefault());
  const m = $('#map');
  m.addEventListener('pointermove', onMapMove);
  m.addEventListener('pointerdown', onMapDown);
  m.addEventListener('pointerup', onMapUp);
  // play the Earth
  $('#replayBtn').addEventListener('click', () => { sound.start(); replayTaps(); });
  $('#clearBtn').addEventListener('click', () => resetGuide());
  $('#moreBox').addEventListener('toggle', () => { if ($('#moreBox').open) { guide.done = true; $('.timeline').hidden = false; } });
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
