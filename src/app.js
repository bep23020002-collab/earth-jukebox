// AI-assisted (Anthropic Claude).
// Earth Jukebox: explore a NASA visualization by ear.
// Two modes share one interface:
//   track - a prepared NASA time series (Global temperature 1880–2025)
//   image - any NASA picture with a color bar, calibrated on the spot
import { Sound, noteIndex } from './audio.js';
import { Score } from './score.js';
import { JUMPS, placeName, formatCoord, PLACE_NAMES, findPlace, zhPlace } from './places.js';
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
  if (Number(nice(Math.abs(v))) === 0) return `0 ${unitWord}`; // not "plus 0.0"
  let s = `${v < 0 ? 'minus ' : (min < 0 ? 'plus ' : '')}${nice(Math.abs(v))} ${unitWord}`;
  if (v >= max - span * 0.008) s += ' or more'; else if (v <= min + span * 0.008) s += ' or less';
  return s;
}
// The same readings, in Chinese, for the voice guide
const placeZ = name => zhPlace(name);
const whenZ = (yi = state.yi, T = state.track) => (monthOn(T) ? `${T.years[yi]}年${state.month}月` : `${T.years[yi]}年`);
function feelingZ(v, k = isImage() ? null : kind()) {
  if (v == null && !isImage() && !monthCovered()) return '这个月没有资料';
  if (v == null) return k?.noDataWordZh || '没有资料';
  if (!k || !k.wordsZh) { const t = tOf(v); return t < 0.15 ? '很低' : t < 0.4 ? '低' : t < 0.6 ? '中间' : t < 0.85 ? '高' : '很高'; }
  return k.wordsZh(v);
}
function sayZ(v) {
  if (v == null) return '这里没有资料';
  const { min, max, unit } = scale(), span = max - min, n = nice(Math.abs(v));
  if (Number(n) === 0) return `0 ${unit === '°C' ? '度' : unit}`;
  let t = min < 0 && max > 0 ? `${v < 0 ? '低' : '高'} ${n} 度` : `${v < 0 ? '负 ' : ''}${n} ${unit === '°C' ? '度' : unit}`;
  if (v >= max - span * 0.008) t += '或以上'; else if (v <= min + span * 0.008) t += '或以下';
  return t;
}
const reading = (place, v) => tr(`${place}. ${feeling(v)}${v == null ? '' : `, ${say(v)}`}.`, `${placeZ(place)}。${feelingZ(v)}${v == null ? '' : `，${sayZ(v)}`}。`);
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

const BANDS_ZH = { 'the Arctic': '北极', 'the northern mid-latitudes': '北半球的中纬度地区', 'the tropics': '热带', 'the southern mid-latitudes': '南半球的中纬度地区', Antarctica: '南极洲' };
function describeZh() {
  if (isImage()) return null;
  if (!monthCovered()) return `NASA 的资料没有${whenZ()}。换一个月份试试。`;
  const st = yearStats(state.yi);
  if (!st.bands.length) return `NASA 没有${whenZ()}的资料。`;
  const top = st.bands.reduce((a, b) => (b.mean > a.mean ? b : a)), topZ = BANDS_ZH[top.name] || top.name;
  const here = currentValue() ?? boxMean(state.yi, state.lat, state.lon, 4), nz = placeZ(placeName(state.lat, state.lon).replace(/^near /, ''));
  if (state.track.kind === 'ocean') return `最暖的海水在${topZ}，最冷的在两极附近。${nz}附近：${feelingZ(here)}。`;
  if (state.track.kind === 'lightning') return `${whenZ()}，NASA 看到最多闪电的地方是${topZ}。${nz}附近：${feelingZ(here)}。`;
  const overall = st.mean < -0.3 ? '世界大部分地方比正常冷' : st.mean < 0.3 ? '整个世界差不多正常' : st.mean < 1 ? '世界大部分地方比正常暖' : '世界大部分地方比正常暖很多';
  return `${whenZ()}，${overall}。最暖的是${topZ}。${nz}附近${feelingZ(here)}。`;
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
const cap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
function announce(text) { text = cap(text); const el = $('#live'); el.lang = hasHan(text) ? 'zh' : 'en'; el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); }
// Speaking speed: a little slower than the phone's normal, so a first-time listener can follow (testers said it was too fast)
const RATE_EN = 0.72, RATE_ZH = 0.8;
// Slower and Faster (buttons at the top, or the - and + keys) change it for each listener; the choice is remembered
const SPEEDS = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 1.9];
let speed = 1; try { const s = +localStorage.getItem('ej-speed'); if (SPEEDS.includes(s)) speed = s; } catch { /* private window */ }
const rateOf = zh => (zh ? RATE_ZH : RATE_EN) * speed;
// The voice guide speaks English or Chinese (chosen on the first screen, or with the 中文 / English button).
// The words on screen stay English. tr(english, chinese) picks the sentence for the voice.
let talkLang = (() => { try { const l = localStorage.getItem('ej-talk'); if (l === 'en' || l === 'zh') return l; } catch { /* private window */ } return /^zh/i.test(navigator.language || '') ? 'zh' : 'en'; })();
const ZH = () => talkLang === 'zh';
const tr = (en, zh) => (ZH() ? zh : en);
function syncLangKeys() {
  document.querySelectorAll('[data-act="lang"]').forEach(b => {
    const toEn = ZH(); b.textContent = toEn ? 'English' : '中文'; b.lang = toEn ? 'en' : 'zh';
    b.setAttribute('aria-label', toEn ? 'English' : 'Chinese'); b.setAttribute('aria-description', `Switches the voice to ${toEn ? 'English' : 'Chinese'}.`);
    b.dataset.zh = toEn ? '英文' : '中文'; b.dataset.zhDesc = `把语音换成${toEn ? '英文' : '中文'}。`;
  });
}
function setTalk(l) { talkLang = l; try { localStorage.setItem('ej-talk', l); } catch { /* private window */ } setLang(l); syncLangKeys(); } // Speak and Ask the Earth follow too
function utter(text) {
  const u = new SpeechSynthesisUtterance(text), zh = hasHan(text), v = zh ? zhVoice() : voicePick;
  if (v) u.voice = v;
  u.lang = v?.lang || (zh ? 'zh-CN' : 'en-US'); u.rate = rateOf(zh);
  return u;
}
function changeSpeed(dir) {
  const i = SPEEDS.indexOf(speed), j = Math.max(0, Math.min(SPEEDS.length - 1, i + dir));
  speed = SPEEDS[j]; try { localStorage.setItem('ej-speed', speed); } catch { /* private window */ }
  const edge = j === i ? (dir < 0 ? ' This is the slowest.' : ' This is the fastest.') : '';
  const edgeZh = j === i ? (dir < 0 ? '这已经是最慢了。' : '这已经是最快了。') : '';
  talk(tr(`${dir < 0 ? 'Slower' : 'Faster'}.${edge} Speed ${j + 1} of ${SPEEDS.length}. This is how fast I speak now.`, `${dir < 0 ? '慢一点' : '快一点'}。${edgeZh}第 ${j + 1} 档，一共 ${SPEEDS.length} 档。我现在就是这个速度。`));
}
let nextHint = '', hintTimer = 0; // "Try this next", said after the result of a Controls press (see coach)
function speak(text, { interrupt = true } = {}) {
  if (nextHint) { text += ' ' + nextHint; nextHint = ''; clearTimeout(hintTimer); }
  text = cap(text);
  announce(text);
  if (!state.voice || !('speechSynthesis' in window)) return Promise.resolve();
  if (interrupt) speechSynthesis.cancel();
  return new Promise(res => {
    const u = utter(text), zh = hasHan(text);
    u.onend = res; u.onerror = res;
    setTimeout(res, 400 + text.length * (zh ? 340 : 120) / speed); // never hang if the engine stays silent (sized for the slower speed)
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
  if (speakIt) speak(tr(`${place}${inWhen}. ${feeling(v)}${v == null ? '' : `, ${say(v)}`}.`, `${placeZ(place)}，${isImage() ? '' : whenZ() + '。'}${feelingZ(v)}${v == null ? '' : `，${sayZ(v)}`}。`));
  else (sayShort ? speak : announce)(tr(`${place}. ${feeling(v)}.`, `${placeZ(place)}。${feelingZ(v)}。`)); // sayShort: arrow keys and Controls, so the voice guide says where you went
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
  if (tour.i === 0) { const v0 = trackValue(state.yi, lat, lon), pl = placeName(lat, lon); tour.heard = { place: pl.startsWith('near ') ? `a place ${pl}` : pl, placeZh: placeZ(pl), feel: feeling(v0).toLowerCase(), feelZh: feelingZ(v0), when: when() }; }
  tourHit('tap');
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
  announce(tr(`Playing your tune in ${year()}.`, `播放你的旋律，${year()}年。`));
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
function setGuide({ label, title, text, btn, alt, say, sayZh, quiet = false }) {
  $('#guideStep').textContent = label || '';
  $('#guideTitle').textContent = title; $('#guideText').textContent = text || '';
  for (const [id, b] of [['#guideBtn', btn], ['#guideAlt', alt]]) {
    const el = $(id); el.hidden = !b; el.disabled = false;
    if (b) { el.textContent = b[0]; el.dataset.zh = b[2] || ''; el.onclick = async () => { sound.start(); el.disabled = true; await b[1](); }; }
  }
  if (!quiet) speak(ZH() && sayZh ? sayZh : say || `${title}. ${text || ''}`);
}
function resetGuide({ quiet = false } = {}) {
  state.taps = []; updateTapUI(); guide.step = 1; globe.clearStrokes(); score.clear();
  setGuide({ label: 'Step 1 of 3', title: 'Tap 3 places on the Earth', text: 'Every place plays a note. Warmer places play higher notes. Your 3 notes become a tune.',
    say: state.voice ? 'If I speak too fast or too slow, press Slower or Faster at the top of the page. ' + (coarse() ? 'Tap anything on the page to hear it, and tap it again to press it. Or touch and hold, then slide your finger, to hear everything under it. ' : '') + 'Move your mouse or finger over the Earth to hear it. Warmer places play higher notes. Stop for a moment, and I will tell you where you are. To make a tune, add 3 places: tap a place, or press Add this place in Controls, at the top of the page.' : null,
    sayZh: state.voice ? '如果我讲太快或太慢，按页面最上面的"慢一点"或"快一点"。' + (coarse() ? '任何东西点一下会念出来，再点一下才是按下去。或者按住不动，再滑动手指，手指经过的东西都会念出来。' : '')
      + '把鼠标或手指在地球上移动，就会听到声音。越暖的地方，音越高。停一下，我会告诉你在哪里。要做一段旋律，加三个地方：点一个地方，或按大按钮里的"把这里加进旋律"。'
      : '在地球上点三个地方。每个地方都有一个音，越暖的地方音越高。你的三个音会变成一段旋律。', quiet });
}
function guideAfterTap(v) {
  if (state.mode !== 'track' || guide.step !== 1 || state.track.id !== 'temperature') return;
  const n = state.taps.length, place = placeName(state.lat, state.lon);
  if (n < 3) {
    setGuide({ label: 'Step 1 of 3', title: n === 1 ? 'Nice! Tap 2 more places' : 'Tap 1 more place', text: `That was ${place}: ${feeling(v).toLowerCase()}.`,
      say: state.voice ? `That was ${place}: ${feeling(v).toLowerCase()}. ${n === 1 ? 'Add 2 more places.' : 'Add 1 more place.'}` : null,
      sayZh: `那是${placeZ(place)}：${feelingZ(v)}。${n === 1 ? '再加两个地方。' : '再加一个地方。'}` });
    return;
  }
  guide.step = 2;
  setGuide({
    label: 'Step 2 of 3', title: 'Now go back in time',
    text: `You made a tune of ${n} notes. Let's hear the same tune in 1880, before the Earth warmed up.`,
    sayZh: `你做了一段 ${n} 个音的旋律。我们来听同一段旋律在 1880 年的样子，那时候地球还没变暖。按"在 1880 年播放我的旋律"。`,
    btn: ['Play my tune in 1880', async () => { await playTuneIn(1880); guideStep3(); }, '在 1880 年播放我的旋律'],
  });
}
function guideStep3() {
  guide.step = 3;
  setGuide({
    label: 'Step 3 of 3', title: 'Now hear it today',
    text: 'Same places, same tune. This time in 2025. Listen: is it higher?',
    sayZh: '同样的地方，同样的旋律。这次是 2025 年。听听看：是不是比较高？按"在 2025 年播放我的旋律"。',
    btn: ['Play my tune in 2025', async () => { await playTuneIn(2025); guideDone(); }, '在 2025 年播放我的旋律'],
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
  const textZh = d == null ? '你选的地方有些没有 1880 年的资料，试试资料比较多的地方，例如欧洲或美国。'
    : d > 0.2 ? `你的旋律变高了。你选的地方比 1880 年暖了大约 ${d.toFixed(1)} 度。这就是气候变化的声音。`
      : d < -0.2 ? '你的旋律变低了。你选的地方 2025 年比 1880 年冷，这很少见。世界上大部分地方都变暖了。'
        : '你的旋律差不多一样。这些地方变化比世界上大部分地方少。试试北极。';
  setGuide({
    label: 'You did it', title: d != null && d > 0.2 ? 'Did you hear it go higher?' : 'What did you hear?', text, sayZh: textZh,
    btn: ['Make my own Earth song', async () => setMode('song'), '做我自己的地球之歌'],
    alt: ['Try other places', async () => resetGuide(), '试试别的地方'],
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
  tourHit('year');
  state.yi = Math.max(0, Math.min(state.track.years.length - 1, yi));
  state.month = hasMonths() ? month : null;
  await ensureMonthData();
  draw(); updateReadout({ play: true });
  if (guide.done) $('#desc').textContent = describe(); // keep the sentence under the card in step with the year bar
  announce(tr(`${when()}. ${placeName(state.lat, state.lon)}: ${fmt(currentValue())}.`, `${whenZ()}。${placeZ(placeName(state.lat, state.lon))}：${sayZ(currentValue())}。`));
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
  state.playing = true; setIssUI(true); $('#playBtn').disabled = true; tourHit('track');
  const place = placeName(state.lat, state.lon), { pts, over } = issTrack(state.lat, state.lon), kd = state.track.kind;
  globe.clearStrokes(); globe.startStroke(); pts.forEach(p => globe.addPoint(p.lat, p.lon)); // the orbit line
  $('#nowBox').hidden = false; $('#globeHint').hidden = true;
  await speak(tr(over ? `One orbit with the Space Station, passing over ${place}.` : `The Space Station never flies over ${place}. This orbit passes as close as it can.`,
    over ? `跟着太空站绕地球一圈，会经过${placeZ(place)}。` : `太空站从来不会飞过${placeZ(place)}。这一圈会尽量靠近它。`));
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
  const topZh = best ? `经过${kd === 'lightning' ? '闪电最多' : kd === 'ocean' ? '海水最暖' : '最暖'}的地方是${placeZ(placeName(best.lat, best.lon))}，${sayZ(best.v)}。` : '这条轨道上 NASA 没有资料。';
  $('#desc').textContent = msg; speak(tr(msg, `太空站绕地球一圈：大约 93 分钟，这里用 15 秒弹完${over ? `，正好经过${placeZ(place)}` : ''}。${topZh}`));
}

async function playHistory({ quiet = false } = {}) {
  if (isImage()) return;
  if (state.track.years.length < 2) { speak(tr(`This map shows one moment (${when(0)}), so there is no history to play. Tap different places to compare them.`, `这张地图只有一个时间（${whenZ(0)}），所以没有历史可以播放。点不同的地方来比较。`)); return; }
  if (state.playing) { state.playing = false; return; }
  state.playing = true; state.month = null; state.hist = null; setPlayingUI(true); draw(); tourHit('playStart');
  const place = placeName(state.lat, state.lon), years = state.track.years;
  if (!quiet) await speak(tr(`${place}, ${when(0)} to ${when(years.length - 1)}.`, `${placeZ(place)}，${whenZ(0)}到${whenZ(years.length - 1)}。`));
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
  if (!finished) { tourHit('playEnd'); return; }
  const avg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) { const v = boxMean(i, state.lat, state.lon, 6); if (v != null) { s += v; n++; } } return n ? s / n : null; };
  // compare the start with the end: the first and last 10 years of a long series, the first and last year of a short one
  const L = years.length, n = short ? 1 : 10, mo = null;
  // short series: the first and last year that have data (a month can be missing at the start or end)
  const has = i => boxMean(i, state.lat, state.lon, 6) != null;
  const i0 = short ? Math.max(0, years.findIndex((_, i) => has(i))) : 0, i1 = short ? Math.max(i0, L - 1 - [...years].reverse().findIndex((_, j) => has(L - 1 - j))) : L - 1;
  const first = avg(i0, i0 + n - 1), last = avg(i1 - n + 1, i1);
  const base = place.replace(/^near /, ''); // the place name may already say "near"
  const msg = first != null && last != null
    ? (state.track.kind === 'temperature'
      ? `Near ${base}: ${mo ? `${mo} in the 1880s was` : 'the 1880s were'} ${feeling(first).toLowerCase()}. ${mo ? `${mo} in recent years is` : 'Today it is'} ${feeling(last).toLowerCase()}. That is about ${Math.abs(last - first).toFixed(1)} °C ${last >= first ? 'warmer' : 'cooler'} than in the 1880s.`
      : `Near ${base}: ${feeling(first).toLowerCase()} in ${when(i0)}, ${feeling(last).toLowerCase()} in ${when(i1)}.`)
    : `NASA has no measurements near ${base} ${short ? 'in these years' : 'in the early years'}, so we can't compare then and now. Try another place.`;
  const pz = placeZ(base), msgZh = first != null && last != null
    ? (state.track.kind === 'temperature'
      ? `${pz}附近：1880 年代${feelingZ(first)}，现在${feelingZ(last)}。比 1880 年代${last >= first ? '暖' : '冷'}了大约 ${Math.abs(last - first).toFixed(1)} 度。`
      : `${pz}附近：${whenZ(i0)}${feelingZ(first)}，${whenZ(i1)}${feelingZ(last)}。`)
    : `${pz}附近${short ? '这几年' : '早年'}没有 NASA 的测量，所以没办法比较以前和现在。换个地方试试。`;
  state.hist = { first, last, i0, i1, short };
  $('#desc').textContent = msg; if (!quiet) speak(tr(msg, msgZh));
  tourHit('playEnd');
  if (first != null && last != null && state.track.kind === 'temperature') score.setNote(`About ${Math.abs(last - first).toFixed(1)} °C ${last >= first ? 'warmer' : 'cooler'} than in the 1880s`);
}
function setPlayingUI(on) {
  const y = state.track.years;
  for (const b of [$('#playBtn'), $('#padPlay')]) { b.textContent = on ? 'Stop' : `Play ${y[0]} → ${y[y.length - 1]}`; b.setAttribute('aria-pressed', on); }
  $('#padPlay').setAttribute('aria-label', on ? 'Stop' : `Play ${y[0]} to ${y[y.length - 1]}`);
}

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
    : [[0, tr('This low note means colder than normal.', '这个低音代表比正常冷。')], [0.5, tr('This middle note means normal.', '这个中音代表正常。')],
      [1, tr('This high note means much hotter than normal. When it is very warm, a second voice joins in.', '这个高音代表比正常热很多。很暖的时候，会多一个声音一起响。')]];
  for (const [t, text] of parts) { await speak(text); sound.note(t, { dur: 0.6 }); score.live(noteIndex(t), t === 0 ? 'low' : t === 1 ? 'high' : 'middle', { tap: true }); await sleep(900); }
  state.busy = false;
}

function setHint() { // the hint on the globe says how to listen; with Voice guide on, moving listens
  $('#globeHint .hint-mouse').textContent = state.voice ? 'Move the mouse to listen. Click to add a place.' : 'Tap to play. Drag to spin the Earth.';
  $('#globeHint .hint-touch').textContent = state.voice ? 'Slide a finger to listen. Two fingers spin.' : 'Tap to play. Swipe sideways to spin.';
  document.querySelectorAll('.speed-key, .voice-only').forEach(b => { b.hidden = !state.voice; }); // Slower, Faster and 中文: only for the voice guide
  syncRemote();
  $('#globe').classList.toggle('explore', state.voice); document.documentElement.classList.toggle('voice-on', state.voice); // phones: Voice guide on, a finger listens; off, swiping up or down scrolls the page
}
function toggle(act) {
  if (act === 'voice') { state.voice = !state.voice; setHint(); if (state.voice) tourHit('voice'); if (!state.voice) speechSynthesis?.cancel(); speak(state.voice ? tr('Voice guide on. I will read every step aloud.', '语音导览开了。我会把每一步念出来。') + ' ' + (isRemote() ? remoteMap()
    : tr((coarse() ? 'Tap anything to hear it. Tap it again to press it. ' : '') + 'Slower and Faster, at the top of the page, change how fast I speak.', (coarse() ? '任何东西点一下会念出来，再点一下才是按下去。' : '') + '页面最上面的"慢一点"和"快一点"可以改变我讲话的速度。'))
    : tr('Voice guide off.', '语音导览关了。')); }
  if (act === 'ref' && scale()) { state.ref = !state.ref; sound.reference(state.ref, isImage() ? 0.5 : tOf(0)); announce(state.ref ? 'Average hum on. It plays the middle note.' : 'Average hum off.'); }
  document.querySelector(`[data-act="${act}"]`)?.setAttribute('aria-pressed', act === 'voice' ? state.voice : state.ref);
}
function act(name) {
  if (name === 'legend') hearLegend();
  if (name === 'sweep') sweep();
  if (name === 'describe') { const t = describe(); $('#desc').textContent = t; speak(tr(t, describeZh() || t)); }
  if (name === 'voice' || name === 'ref') toggle(name);
  if (name === 'slower') changeSpeed(-1);
  if (name === 'faster') changeSpeed(1);
  if (name === 'nextplace') nextPlace();
  if (name === 'help') talk(helpText());
  if (name === 'more') { document.documentElement.classList.add('remote-more'); speak(moreMap()); }
  if (name === 'back') { document.documentElement.classList.remove('remote-more'); speak(tr('Back to the remote. Where am I? is in the middle of the top half.', '回到遥控器。"我在哪里"在上半部的中间。')); }
  if (name === 'lang') { setTalk(ZH() ? 'en' : 'zh'); speak(tr('English. I will speak English now.', '中文。我现在讲中文。')); }
  if (name === 'closeControls') { openControls(false); $('#controlsBtn').focus({ preventScroll: true }); speak(tr('Big buttons closed. To open them again, press Controls, at the top of the page.', '大按钮关掉了。要再打开，按页面最上面的"大按钮"。')); }
}

// ---------- your own map ----------
function setMode(mode) {
  tourHit('mode');
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
  followLang(text);
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
  followLang(q);
  const zh = state.lang === 'zh';
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
    announce(story ? tr('Listening. Say a place and a year, for example: I was born in Sibu in 2006. Then press Stop.', '在听了。说一个地方和年份，例如：我 2006 年在诗巫出生。说完按 Stop。') : tr('Listening. Ask your question, for example: Is Sibu warmer now than in 1960?', '在听了。说你的问题，例如：诗巫现在比 1960 年暖吗？'));
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
// The first screen speaks both languages, the phone's own language first: English, then Chinese (or the other way round)
const welcomeEn = byKey => 'Welcome to Earth Jukebox. NASA maps of the Earth, played as sound: warmer places sing higher. Put on headphones. '
  + (byKey === true ? 'You are on the button Start with voice guide. Press Enter to start, and I will read every step. If you use a screen reader, press Shift and Tab, and choose Start listening instead. Press minus or plus to make me speak slower or faster.'
    : byKey === 'touch' ? 'To start in English, double-tap the top half of the screen, and I will guide you step by step. If you use VoiceOver or TalkBack, choose the button Start listening instead.'
    : 'There are three buttons: Start listening, Start with voice guide, and Chinese voice guide. Rest the mouse on one and I will read it.');
const welcomeZh = byKey => '欢迎来到地球点唱机。我们把 NASA 的地球地图变成声音：越暖的地方，音越高。请戴上耳机。'
  + (byKey === true ? '要用中文语音导览，请按一下 Tab 键，再按 Enter。'
    : byKey === 'touch' ? '要用中文，请在屏幕下半部快速点两下，我会一步一步带你。用 VoiceOver 或 TalkBack 的话，请选 Start listening 这个按钮。'
    : '要用中文，请按"中文语音导览"按钮。');
const welcomeBoth = byKey => (ZH() ? [welcomeZh(byKey), welcomeEn(byKey)] : [welcomeEn(byKey), welcomeZh(byKey)]);
function welcome(byKey) { welcomed = true; const [a, b] = welcomeBoth(byKey); talk(a); talk(b, { interrupt: false }); }
// Say hello as soon as the page opens. Most computer browsers allow this; where a browser blocks speech until the
// first key press or tap (iPhone Safari), nothing is lost: the first key press or tap says it instead.
function welcomeOnOpen() {
  if (!('speechSynthesis' in window)) return;
  const go = () => {
    if (welcomed || !startOpen()) return;
    const [a, b] = welcomeBoth(coarse() ? 'touch' : true), u = utter(a);
    u.onstart = () => { welcomed = true; };
    speechSynthesis.speak(u); speechSynthesis.speak(utter(b));
  };
  if (speechSynthesis.getVoices().length) go(); else { speechSynthesis.addEventListener('voiceschanged', go, { once: true }); setTimeout(go, 1200); }
}
function setupStartTalk() {
  $('#startVoiceBtn').focus({ preventScroll: true }); // Enter right away starts the voice guide
  document.addEventListener('keydown', e => {
    if (!startOpen()) return;
    if (welcomed && ['-', '=', '+'].includes(e.key)) { e.preventDefault(); changeSpeed(e.key === '-' ? -1 : 1); return; }
    const onKeyButton = e.target.closest?.('#start button, #start a') && (e.key === 'Enter' || e.key === ' ');
    if (!welcomed && !onKeyButton) { e.preventDefault(); welcome(true); return; }
    if (e.key === 'Tab') { // keep Tab inside the first screen
      const f = [...$('#start').querySelectorAll('button, a[href]')], i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }, true);
  // a click says hello on pointerdown; a finger only on lifting (the browser allows speech only then)
  const firstTap = e => { if (startOpen() && !welcomed && !e.target.closest('#start button, #start a')) welcome(e.pointerType === 'mouse' ? 'mouse' : 'touch'); };
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') firstTap(e); }, true);
  document.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') firstTap(e); }, true);
  // On a phone, a quick double tap anywhere starts the voice guide: the top half in English, the bottom half in Chinese.
  // It wins over a button or link under the finger, so a blind person can't open the guide page or skip the voice by accident.
  let last = { t: 0, x: 0, y: 0 };
  document.addEventListener('touchend', e => {
    if (!startOpen() || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0], now = performance.now();
    if (now - last.t < 500 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 80) { last.t = 0; if (e.cancelable) e.preventDefault(); start(true, t.clientY > innerHeight / 2 ? 'zh' : 'en'); return; }
    last = { t: now, x: t.clientX, y: t.clientY };
  }, { capture: true, passive: false });
  if (startOpen()) setInert(true);
  welcomeOnOpen();
}
function setupSayOnHover() {
  document.addEventListener('pointerover', e => {
    if (!talking() || e.pointerType !== 'mouse') return;
    const el = sayable(e.target); if (!el || el === sayOver || el.closest('#globeWrap')) return;
    sayOver = el; clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { if (sayOver !== el || !talking()) return; const t = spokenName(el); if (t) talk(t); }, 180); // also while music plays: words always come first
  });
  document.addEventListener('pointerout', e => { if (sayOver && !sayOver.contains(e.relatedTarget)) { sayOver = null; clearTimeout(sayTimer); } });
  // a quick click must not be followed by the button's name, which would cut off what the click says
  document.addEventListener('pointerdown', e => { clearTimeout(sayTimer); sayOver = sayable(e.target) || null; }, true);
  document.addEventListener('focusin', e => {
    if (!talking()) return;
    const el = sayable(e.target); if (!el || el === sayOver) return;
    const t = spokenName(el), d = spokenDesc(el); if (t) talk(d && el.matches(CONTROL) ? tr(`${t}. ${d}`, `${t}。${d}`) : t);
  });
}
// Voice guide on a phone works like a screen reader: tap anything to hear it, tap it again to press it.
// Touch and hold for a moment, then slide, to hear everything under the finger. (On the Earth, sliding plays its notes.)
const CONTROL = 'button, a[href], summary, input, select, textarea, label';
// ---------- the phone remote ----------
// On a phone with Voice guide on, Controls fill the whole screen and never scroll, so a blind person can learn
// where each button is: the top half moves you (Where am I? in the middle, North above, South below, West left,
// East right), the bottom half has the rest.
const isRemote = () => document.documentElement.classList.contains('remote');
function syncRemote() {
  const on = !$('#controls').hidden && state.voice && coarse(), html = document.documentElement;
  html.classList.toggle('remote', on); if (!on) html.classList.remove('remote-more');
}
const remoteMap = () => tr('Your screen is now a remote control. Tap a button once to hear it, and tap it again to press it. '
  + 'In the top half of the screen, Where am I? is in the middle. North is above it, South is below it, West is on the left, and East is on the right. '
  + 'At the bottom of the screen are four buttons: Play and Next place, and under them, Help and More. More has the other buttons, like Slower and Faster.',
  '你的屏幕现在是一个遥控器。按钮点一下会念出来，再点一下才是按下去。屏幕上半部的中间是"我在哪里"。它的上面是北，下面是南，左边是西，右边是东。'
  + '屏幕最下面有四个按钮：播放和下一个地方，再下面是帮助和更多。"更多"里面有其他按钮，例如慢一点和快一点。');
const moreMap = () => tr('More buttons. The top of the screen is Back. Under it: What do the sounds mean?, and Add this place to my tune. Then Year before and Year after. Then Slower and Faster. At the very bottom: Chinese, and Close.',
  '更多按钮。屏幕最上面是返回。下面是：声音代表什么，和把这里加进旋律。接着是前一年和后一年。再来是慢一点和快一点。最下面是英文，和关闭。');
function openControls(open, { scroll = true, focus = true } = {}) {
  const ctl = $('#controls'); ctl.hidden = !open; $('#controlsBtn').setAttribute('aria-expanded', open); syncRemote();
  if (!open) return;
  if (scroll && !isRemote()) ctl.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (focus) ctl.querySelector('.pad-c').focus({ preventScroll: true });
}
function helpText() {
  const here = tr(`You are in ${placeName(state.lat, state.lon)}, in ${when()}. `, `你现在在${placeZ(placeName(state.lat, state.lon))}，${whenZ()}。`);
  const what = tr('Where am I? says the place and how warm it was. North, South, East and West each travel about 1,000 kilometres and play the note there: a higher note means warmer. '
    + 'Play 1880 to 2025 plays the history of this place. Next place jumps to places like the Arctic Ocean. What do the sounds mean? plays the low, middle and high notes.',
    '"我在哪里"会念出地方和有多暖。北、南、东、西每按一次移动大约一千公里，并弹出那里的音：音越高，代表越暖。"播放"会弹出这个地方从 1880 年到现在的历史。"下一个地方"会跳到北冰洋这些地方。"声音代表什么"会弹出低音、中音和高音。');
  if (isRemote()) return here + remoteMap() + ' ' + what;
  if ($('#controls').hidden) return here + tr('Press Controls, at the top of the page, for big buttons. ', '按页面最上面的"大按钮"（Controls），会打开大按钮。') + what + (coarse() ? '' : ' ' + tr(help(), helpZh()));
  return here + what + (coarse() ? '' : ' ' + tr(help(), helpZh()));
}
// Each Controls press says what happened, then, the first time, one thing to try next that you haven't tried yet
const coach = { tried: new Set(), told: new Set() };
const COACH = [
  ['where', 'Press Where am I? to hear the place, the year, and how warm it was.', '按"我在哪里"，会念出地方、年份，还有有多暖。'],
  ['move', 'Try North, South, East or West. Each one travels about 1,000 kilometres and plays the note there. A higher note means warmer.', '试试北、南、东、西。每按一次会移动大约一千公里，并弹出那里的音。音越高，代表越暖。'],
  ['play', 'To hear how this place changed since 1880, press Play. It takes about 30 seconds.', '想听这个地方从 1880 年到现在怎么变，按"播放"。大约 30 秒。'],
  ['place', 'Press Next place to jump to another place, like the Arctic Ocean, and hear if it sounds higher.', '按"下一个地方"，可以跳到别的地方，例如北冰洋，听听它是不是比较高。'],
  ['legend', 'To hear the low, middle and high notes, press More, then What do the sounds mean?', '想听低音、中音和高音，按"更多"，再按"声音代表什么"。'],
];
const COACH_OF = { Enter: 'where', ArrowUp: 'move', ArrowDown: 'move', ArrowLeft: 'move', ArrowRight: 'move', ' ': 'play', nextplace: 'place', legend: 'legend' };
function coachFor(what) {
  coach.tried.add(what);
  if (!['where', 'move', 'place'].includes(what)) return; // these say their result at once; the hint goes right after it
  const next = COACH.find(([k]) => !coach.tried.has(k) && !coach.told.has(k));
  if (!next) return;
  coach.told.add(next[0]); nextHint = tr('Try this next. ' + next[1], '接下来可以试试：' + next[2]);
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { nextHint = ''; }, 2000);
}
let placeAt = 0; // Next place walks through the list of places (Sibu is first)
function nextPlace() {
  placeAt = (placeAt + 1) % JUMPS.length; const p = JUMPS[placeAt];
  speak(reading(p.name, moveTo(p.lat, p.lon, { center: true })));
}
const coarse = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
let armed = null; // the control read last; tapping it again presses it
const tch = { on: false, x: 0, y: 0, hold: 0, exploring: false, item: null };
function touchItem(x, y) {
  const t = document.elementFromPoint(x, y); if (!t) return null;
  return t.closest('#globeWrap') || sayable(t) || null;
}
function zhName(el) { // the Chinese name of a button, with its state, or null
  let n = el.dataset?.zh; if (!n) return null;
  if (el.id === 'playBtn' || el.id === 'padPlay') { const y = state.track?.years || [1880, 2025]; n = el.getAttribute('aria-pressed') === 'true' ? '停止' : `播放 ${y[0]} 到 ${y[y.length - 1]}`; }
  const pressed = el.getAttribute('aria-pressed'), exp = el.getAttribute('aria-expanded');
  if (el.id === 'issBtn' && pressed === 'true') n = '停止';
  if (pressed != null && el.dataset.act === 'voice') n += pressed === 'true' ? '，开着' : '，关着';
  else if (pressed === 'true' && !['issBtn', 'playBtn', 'padPlay'].includes(el.id)) n += '，已选';
  if (exp != null) n += exp === 'true' ? '，打开了' : '，关着';
  if (el.disabled) n += '，现在还不能用';
  return n;
}
const spokenName = el => (ZH() && zhName(el)) || nameOf(el);
const spokenDesc = el => (ZH() && el.dataset?.zhDesc) || el.getAttribute('aria-description');
function touchWords(el) {
  if (el.id === 'globeWrap') return tr('The Earth. Lift your finger, then slide it on the Earth to hear the notes.', '地球。手指放开，再在地球上滑，就会听到音。');
  const n = spokenName(el); if (!n || !el.matches(CONTROL) || el.disabled) return n;
  if (el.type === 'range') return tr(`${n}, slider. Slide left or right to change it.`, `年份条，${el.getAttribute('aria-valuetext') || el.value}，滑杆。左右滑动来改变。`);
  if (el.matches('input, textarea')) return tr(`${n}. Tap again to type.`, `${n}。再点一下就可以打字。`);
  if (el.tagName === 'SELECT') return tr(`${n}. Tap again to choose.`, `${n}。再点一下就可以选。`);
  if (el.tagName === 'A') return tr(`${n}, link. Tap again to open it.`, `${n}，链接。再点一下就会打开。`);
  if (el.tagName === 'LABEL') return tr(`${n}. Tap again to use it.`, `${n}。再点一下就可以用。`);
  const d = spokenDesc(el);
  return tr(`${n}, button.${d ? ' ' + d : ''} Tap again to press it.`, `${n}，按钮。${d || ''}再点一下就会按下去。`);
}
function setupTouchReader() {
  const stop = () => { tch.on = false; clearTimeout(tch.hold); };
  const say = item => {
    if (item === tch.item) return; tch.item = item;
    const w = item && touchWords(item);
    if (w) talk(w); else if (sound.ctx) sound.noData(); // nothing to read here: a soft tick
  };
  document.addEventListener('touchstart', e => {
    stop();
    if (!talking() || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (document.elementFromPoint(t.clientX, t.clientY)?.closest('#globeWrap')) return; // the Earth listens by itself
    Object.assign(tch, { on: true, x: t.clientX, y: t.clientY, exploring: false, item: null });
    tch.hold = setTimeout(() => { if (tch.on) { tch.exploring = true; say(touchItem(tch.x, tch.y)); } }, 450);
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => {
    if (!tch.on) return;
    const t = e.touches[0];
    if (tch.exploring) { if (e.cancelable) e.preventDefault(); say(touchItem(t.clientX, t.clientY)); return; } // hold, then slide: read, don't scroll
    if (Math.hypot(t.clientX - tch.x, t.clientY - tch.y) > 10) stop(); // a scroll or a slider: leave it alone
  }, { capture: true, passive: false });
  document.addEventListener('touchend', e => {
    if (!tch.on) return;
    const exploring = tch.exploring; stop();
    if (exploring) { if (e.cancelable) e.preventDefault(); armed = tch.item?.matches?.(CONTROL) ? tch.item : null; return; } // what you heard last is ready: tap it to press it
    const t = e.changedTouches[0], it = touchItem(t.clientX, t.clientY);
    if (!it || it.id === 'globeWrap') return;
    if (it === armed && it.matches(CONTROL) && !it.disabled) return; // second tap: press it
    if (e.cancelable) e.preventDefault(); // first tap: only say what it is
    armed = it.matches(CONTROL) ? it : null;
    tch.item = null; say(it);
  }, { capture: true, passive: false });
  document.addEventListener('touchcancel', stop, true);
}
// The Speak buttons must be told the language before listening, so they follow the language you last typed or spoke in
const followLang = t => { if (hasHan(t)) setLang('zh'); else if (/[a-z]{2}/i.test(t)) setLang('en'); };
function setLang(l) { // English or 中文, for speaking (Speak buttons) and for Ask the Earth's answers
  state.lang = l; try { localStorage.setItem('ej-lang', l); } catch { /* private window */ }
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === l));
}
function setupMic() {
  let saved = null; try { saved = localStorage.getItem('ej-lang'); } catch { /* private window */ }
  setLang(saved === 'zh' || saved === 'en' ? saved : /^zh/i.test(navigator.language || '') ? 'zh' : 'en');
  syncLangKeys();
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
    + 'B toggles the average hum. Numbers 1 to 9 travel to places. V turns the voice on or off. Minus and plus make me speak slower or faster.';
}
function helpZh() {
  const y = state.track.years, many = !isImage() && y.length > 1;
  return '方向键是移动，按住 Shift 是小步。' + (many ? `方括号，或 Page Up 和 Page Down，换年份。空白键播放 ${y[0]} 到 ${y[y.length - 1]} 年。` : '')
    + 'T 把这里加进旋律，R 再播一次你的旋律。Enter 念出这里。I 跟着太空站飞一圈。S 绕地球一圈。L 声音代表什么。' + (many ? 'D 说说这一年。' : 'D 说说这张地图。')
    + 'B 开关平均音。数字 1 到 9 去不同的地方。V 开关语音导览。减号和加号让我讲慢一点或快一点。';
}
const runKey = key => onKey({ key, shiftKey: false, target: document.body, preventDefault() {} });
function onKey(e) {
  if (!state.track || startOpen()) return; // the first screen handles its own keys
  if (e.target.matches?.('input, textarea')) { if (e.key === 'Enter' && e.target.closest('#byo')) makeItSing(); return; }
  const k = e.key, img = isImage();
  if (img && !src.legend && k !== '?') return;
  const step = img ? (e.shiftKey ? 0.01 : 0.05) : (e.shiftKey ? 2 : 10);
  const yr = n => setYear(n).then(() => { if (state.voice) speak(tr(`${when()}. ${placeName(state.lat, state.lon)}: ${fmt(currentValue())}.`, `${whenZ()}。${placeZ(placeName(state.lat, state.lon))}：${sayZ(currentValue())}。`)); });
  const move = (dy, dx) => (img ? moveUV(state.u + dx * step, state.v + dy * step) : moveTo(state.lat - dy * step, state.lon + dx * step, { center: true, sayShort: true }));
  const map = {
    ArrowLeft: () => move(0, -1), ArrowRight: () => move(0, 1), ArrowUp: () => move(-1, 0), ArrowDown: () => move(1, 0),
    PageUp: () => yr(state.yi + (e.shiftKey ? 10 : 1)), PageDown: () => yr(state.yi - (e.shiftKey ? 10 : 1)),
    ']': () => yr(state.yi + 1), '[': () => yr(state.yi - 1), '}': () => yr(state.yi + 10), '{': () => yr(state.yi - 10),
    Home: () => yr(0), End: () => yr(state.track.years.length - 1),
    Enter: () => updateReadout({ speakIt: true }), ' ': () => playHistory(),
    i: () => flyISS(), s: () => act('sweep'), l: () => act('legend'), d: () => act('describe'), b: () => act('ref'), v: () => act('voice'), '-': () => act('slower'), '=': () => act('faster'), '+': () => act('faster'), '?': () => speak(tr(help(), helpZh())),
    t: () => { if (!img) tapAt(state.lat, state.lon); }, r: () => { if (!img) replayTaps(); },
  };
  let fn = map[k] || map[k.toLowerCase?.()];
  if (!fn && !img && /^[1-9]$/.test(k)) { const p = JUMPS[+k - 1]; fn = () => { placeAt = +k - 1; speak(reading(p.name, moveTo(p.lat, p.lon, { center: true }))); }; }
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
    hover.talking = true; speak(tr(`${currentPlace()}. ${feeling(currentValue())}.`, `${placeZ(currentPlace())}。${feelingZ(currentValue())}。`)).then(() => { hover.talking = false; });
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
  tourHit('track');
  if (!state.tracks[id] || state.track.id === id) return;
  state.playing = false; stopSong();
  useTrack(id); preloadAll();
  setMode('track');
  const hintZh = { temperature: '点地球，或者跟着太空站飞一圈。越暖的地方音越高。', ocean: '点海洋，或者跟着太空站飞一圈。越暖的海水，音越高越亮。陆地没有声音。',
    lightning: '点任何地方，或者跟着太空站飞一圈。NASA 从太空看到越多闪电，鼓声就越多。太空站看不到太北或太南的地方，那里没有声音。',
    combo: '点任何地方，或者跟着太空站飞一圈。每个地方会同时响三种声音：有多暖（木琴）、最近的海有多暖（竖琴）、多常有闪电（鼓）。' }[id];
  if (id === 'temperature') { if (!guide.done) resetGuide(); else setGuide({ label: 'Temperature, 1880–2025', title: 'Tap the Earth, or fly with the Space Station', text: KINDS.temperature.hint, sayZh: hintZh }); }
  else setGuide({ label: state.track.title, title: id === 'ocean' ? 'Tap the ocean, or fly with the Space Station' : 'Tap anywhere, or fly with the Space Station', text: kind().hint, sayZh: hintZh });
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

// ---------- first-time tour ----------
// Four steps, one thing at a time. Each step dims the page except one thing; doing it (or Next) moves on.
const TOUR = [
  { sel: '#globeWrap', on: 'tap', title: 'Tap the Earth', zhTitle: '点地球',
    text: "Every place on NASA's map has a note. Warmer places play higher. Tap anywhere on the globe.",
    zh: 'NASA 地图上每个地方都有一个音，越暖的地方音越高。点地球上任何地方试试。',
    sr: ' Or press Controls, at the top of the page, for big buttons.', srZh: '也可以按页面最上面的"大按钮"。' },
  { sel: '.year-range', on: 'year', title: 'Go back in time', zhTitle: '回到过去',
    text: () => `${tour.heard ? `You just heard ${tour.heard.place}: ${tour.heard.feel} in ${tour.heard.when}. ` : ''}Now drag the year bar back toward 1880. You'll hear the same place in that year: a lower note means it was colder.`,
    zh: () => `${tour.heard ? `你刚听到${tour.heard.placeZh}：${tour.heard.when}年${tour.heard.feelZh}。` : ''}现在把年份条往左拉，拉回 1880 年附近。你会听到同一个地方在那一年的音：音比较低，就是那时候比较冷。`,
    sr: ' On a keyboard, press the left square bracket to go back one year.', srZh: '用键盘的话，按左方括号回到前一年。' },
  { sel: '#playBtn', on: 'playEnd', hideOn: 'playStart', title: 'Hear 145 years', zhTitle: '听 145 年',
    text: 'Press Play to hear this place every month from 1880 to 2025, in 30 seconds. Listen to the notes climb.',
    zh: '按"播放"，听这个地方从 1880 到 2025 年每个月的变化，只要 30 秒。听听音是不是一路往上。' },
  { sel: '#trackPicker', on: 'track', title: 'More NASA maps', zhTitle: '更多 NASA 地图',
    text: 'Each NASA visualization has its own instrument: temperature plays a marimba, the ocean a harp, lightning the drums. Or fly once around the Earth with the Space Station.',
    zh: '每一种 NASA 视觉图都有自己的乐器：温度是木琴，海洋是竖琴，闪电是鼓。也可以跟着太空站绕地球飞一圈。' },
  { sel: '.access', on: 'voice', title: "Made for people who can't see it", zhTitle: '为看不见地图的人而做',
    text: 'Turn on Voice guide and close your eyes: it reads every step aloud. Controls gives big buttons for phones and screen readers.',
    zh: '打开语音导览，闭上眼睛试试：它会把每一步念出来。"大按钮"给手机和读屏软件用。' },
  { sel: '.modes', on: 'mode', title: 'Make it yours', zhTitle: '变成你的',
    text: 'Turn a story about your life into a song, or ask the Earth a question, in English or Chinese.',
    zh: '把你人生的故事变成一首歌，或者问地球一个问题，英文或中文都可以。' },
];
const tour = { i: -1, hidden: false, advancing: false, heard: null };
const tourText = (st, k) => (typeof st[k] === 'function' ? st[k]() : st[k]);
const tourDone = () => false; // the tour runs every time the page is opened (judges and first-time users); Skip ends it
function startTour() {
  tour.i = 0; tour.advancing = false; tour.heard = null; $('#guide').hidden = true; // the tour replaces the step card while it runs
  addEventListener('scroll', placeTour, { passive: true }); addEventListener('resize', placeTour, { passive: true });
  showTourStep();
}
function showTourStep() {
  const st = TOUR[tour.i], el = $(st.sel); if (!el) { endTour(); return; }
  tour.hidden = false;
  $('#tourStep').textContent = `${tour.i + 1} of ${TOUR.length}`; $('#tourTitle').textContent = st.title; $('#tourText').textContent = tourText(st, 'text');
  $('#tourNext').textContent = tour.i === TOUR.length - 1 ? 'Start exploring' : 'Next';
  $('#tourNext').dataset.zh = tour.i === TOUR.length - 1 ? '开始自由探索' : '下一步';
  $('#tour').hidden = false; $('#tourSpot').hidden = false;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  placeTour(); setTimeout(placeTour, 400); setTimeout(placeTour, 900);
  speak(tr(`Tour, step ${tour.i + 1} of ${TOUR.length}. ${st.title}. ${tourText(st, 'text')}${st.sr || ''}`, `新手引导，第 ${tour.i + 1} 步，共 ${TOUR.length} 步。${st.zhTitle}。${tourText(st, 'zh')}${st.srZh || ''}`), { interrupt: false });
}
function placeTour() {
  if (tour.i < 0 || tour.hidden) return;
  {
    const el = $(TOUR[tour.i].sel); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 8, spot = $('#tourSpot'), b = $('#tour');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const bw = b.offsetWidth, bh = b.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 14;
    let top = r.bottom + pad + gap <= vh - bh - 8 ? r.bottom + pad + gap : r.top - pad - gap - bh >= 8 ? r.top - pad - gap - bh : vh - bh - 12; // below, else above, else at the bottom
    const left = Math.max(12, Math.min(vw - bw - 12, r.left + r.width / 2 - bw / 2));
    top = Math.max(8, top);
    Object.assign(b.style, { left: `${left}px`, top: `${top}px` });
  }
}
function hideTourForNow() { tour.hidden = true; $('#tour').hidden = true; $('#tourSpot').hidden = true; }
function nextTourStep() { tour.advancing = false; if (tour.i < 0) return; if (tour.i >= TOUR.length - 1) { endTour(); return; } tour.i++; showTourStep(); }
function endTour() {
  if (tour.i < 0) return;
  tour.i = -1; hideTourForNow(); $('#guide').hidden = false;
  removeEventListener('scroll', placeTour); removeEventListener('resize', placeTour);
  try { localStorage.setItem('ej-tour', 'done'); } catch { /* private window */ }
}
function tourHit(ev) { // something the tour asked for happened
  if (tour.i < 0) return;
  const st = TOUR[tour.i];
  if (st.hideOn === ev) hideTourForNow(); // keep the screen clear while it plays
  if (st.on === ev && !tour.advancing) { tour.advancing = true; setTimeout(nextTourStep, ev === 'tap' || ev === 'year' ? 1200 : 300); } // a moment to hear the note first
}
function setupTour() {
  $('#tourNext').addEventListener('click', () => { sound.start(); if (!tour.advancing) nextTourStep(); });
  $('#tourSkip').addEventListener('click', () => { endTour(); speak(tr('Tour closed.', '新手引导关掉了。')); });
  $('#tourAgain').addEventListener('click', () => { $('#moreBox').open = false; startTour(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && tour.i >= 0) endTour(); });
}

// ---------- start ----------
async function start(withVoice = false, lang = null) {
  if (lang) setTalk(lang);
  state.voice = withVoice; setHint(); document.querySelector('[data-act="voice"]')?.setAttribute('aria-pressed', withVoice);
  const sounding = sound.start(); // not awaited first: iPhone only lets the page speak during the tap itself
  $('#start').hidden = true; setInert(false); $('#globe').focus();
  draw(); preloadAll();
  if (state.mode === 'song') { speak(tr('Someone shared their Earth song with you. Press Play my Earth song to hear it.', '有人把他们的地球之歌分享给你。按"Play my Earth song"来听。')); $('#playSong').focus(); }
  else if (coarse()) { // a phone: open the big buttons and say exactly what to do first
    resetGuide({ quiet: true }); if (state.voice) openControls(true, { scroll: false });
    const place = placeName(state.lat, state.lon);
    if (state.voice) speak(tr(`You are in ${place}, in ${when()}. ${remoteMap()} If I speak too fast, press More, then Slower. Start now: tap Where am I?, in the middle of the top half, then tap it again.`,
      `你现在在${placeZ(place)}，${whenZ()}。${remoteMap()}如果我讲太快，按"更多"，再按"慢一点"。现在开始：点一下上半部中间的"我在哪里"，再点一下。`));
    else { openControls(false); $('#controlsBtn').focus({ preventScroll: true }); } // screen readers land on Controls (big buttons); the screen stays clear // after the screen reader reads the button
  }
  else resetGuide({ quiet: !tourDone() }); // step 1: "Tap anywhere on the Earth" (also read aloud, unless the tour does the talking)
  if (state.mode !== 'song' && !isRemote() && !tourDone()) startTour();
  if (!(await sounding)) $('#desc').textContent = 'Sound is blocked. Tap anywhere on the page, and on iPhone turn off silent mode.';
}
// While the first screen is open, VoiceOver and TalkBack must not wander into the page behind it
function setInert(on) { for (const el of document.querySelectorAll('body > .skip, body > header, body > main, body > footer')) el.inert = on; }
// Browsers (iPhone most strictly) only start sound and speech during a real key press or tap. Every one of those
// wakes the sound if the phone paused it, and the first one unlocks speech, so later steps can talk.
let speechUnlocked = false;
function unlock() {
  sound.wake();
  if (speechUnlocked || !('speechSynthesis' in window)) return;
  speechUnlocked = true;
  if (!speechSynthesis.speaking && !speechSynthesis.pending) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
}
function setupUnlock() {
  const opt = { capture: true, passive: true };
  document.addEventListener('keydown', unlock, opt);
  document.addEventListener('click', unlock, opt); // VoiceOver's double tap arrives as a click
  document.addEventListener('touchend', unlock, opt);
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') unlock(); }, opt);
  document.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') unlock(); }, opt);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sound.wake(); });
}
function buildJumps() {
  $('#jumps').innerHTML = JUMPS.map((p, i) => `<button type="button" data-jump="${i}"><kbd>${i + 1}</kbd> ${p.name.replace(/^the /, '')}</button>`).join('');
  $('#jumps').addEventListener('click', e => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    sound.start(); placeAt = +b.dataset.jump; const p = JUMPS[placeAt]; speak(reading(p.name, moveTo(p.lat, p.lon, { center: true })));
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
  setupUnlock(); setupMic(); setupSayOnHover(); setupTouchReader(); setupTour(); setupStartTalk();
  $('#shareSong').addEventListener('click', shareSong);
  setMode(shared ? 'song' : 'track');
  $('#startBtn').addEventListener('click', () => start(false));
  $('#startVoiceBtn').addEventListener('click', () => start(true, 'en'));
  $('#startZhBtn').addEventListener('click', () => start(true, 'zh'));
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
    const open = ctl.hidden; openControls(open);
    if (open && isRemote()) speak(remoteMap());
    else if (open && state.voice) speak(tr('Big buttons are open, below the Earth. You are on Where am I?.', '大按钮打开了，在地球下面。你在"我在哪里"上。'));
  });
  ctl.addEventListener('click', e => {
    const b = e.target.closest('[data-key], [data-act]'); if (!b) return;
    const what = COACH_OF[b.dataset.key ?? b.dataset.act]; if (what) coachFor(what);
    if (b.dataset.key) { sound.start(); runKey(b.dataset.key); }
  }, true); // capture: the hint is ready before the button speaks
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
