// AI-assisted (Anthropic Claude).
// The score display: every note Earth Jukebox plays is drawn as a block. Higher note = higher block.
// It is the visual twin of the sound (for people who cannot hear it, a muted video, or a noisy room).
// The block heights use exactly the same 11-note scale as the sound (audio.js), so nothing is exaggerated.
//
// Views:
//   live  - the last notes you tapped, hovered or moved to (newest in orange)
//   takes - one tune played in one year, and the same tune in another year on top (older gray, newer orange)
//   line  - one place through every year (Play 1880 -> 2025), or one trip around the Earth
//   song  - "My Earth song": each moment's melody, lit up as it plays

export const STEPS = 11;
const LIVE_SLOTS = 8;

export const SCORE_COLORS = {
  grid: '#34413A', mid: '#5C7363', label: '#9CC48A', dim: '#4E6150', on: '#D6F0C4', then: '#8A9A86', now: '#E96A26',
};

// Pure drawing, so the demo video renderer can draw the same picture.
export function drawScore(g, w, h, view, axis = {}, font = '"Atkinson Hyperlegible Mono", ui-monospace, monospace') {
  const C = SCORE_COLORS;
  g.clearRect(0, 0, w, h);
  const labelled = view && view.type !== 'live';
  const left = 2, right = w - 54, top = 6, bottom = h - (labelled || view?.type === 'live' ? 20 : 6);
  const rowH = (bottom - top) / STEPS;
  const yOf = s => bottom - (s + 0.5) * rowH;
  g.font = `11px ${font}`; g.textBaseline = 'middle';

  // reference lines: bottom, middle ("normal" for temperature), top
  g.strokeStyle = C.grid; g.lineWidth = 1;
  for (const s of [0, STEPS - 1]) { g.beginPath(); g.moveTo(left, Math.round(yOf(s)) + 0.5); g.lineTo(right, Math.round(yOf(s)) + 0.5); g.stroke(); }
  g.strokeStyle = C.mid; g.setLineDash([4, 4]);
  const ym = Math.round(yOf((STEPS - 1) / 2)) + 0.5; g.beginPath(); g.moveTo(left, ym); g.lineTo(right, ym); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.label; g.textAlign = 'left';
  if (axis.high) g.fillText(axis.high, right + 8, yOf(STEPS - 1));
  if (axis.mid) g.fillText(axis.mid, right + 8, ym);
  if (axis.low) g.fillText(axis.low, right + 8, yOf(0));
  if (!view) return;

  const block = (x, step, bw, color, alpha = 1) => {
    g.globalAlpha = alpha;
    if (step == null) { // no data: a hollow box on the bottom line
      g.strokeStyle = C.dim; g.lineWidth = 1.5; g.strokeRect(x - bw / 2 + 0.75, yOf(0) - 4, bw - 1.5, 8);
    } else {
      g.fillStyle = color; const bh = Math.max(5, rowH * 0.78);
      if (g.roundRect) { g.beginPath(); g.roundRect(x - bw / 2, yOf(step) - bh / 2, bw, bh, 2); g.fill(); } else g.fillRect(x - bw / 2, yOf(step) - bh / 2, bw, bh);
    }
    g.globalAlpha = 1;
  };
  const label = (text, x, align = 'center') => {
    if (!text) return;
    g.fillStyle = C.label; g.textAlign = align;
    g.fillText(text, x, h - 9);
  };
  const plotW = right - left;

  if (view.type === 'live') {
    const notes = view.notes.slice(-LIVE_SLOTS), colW = plotW / LIVE_SLOTS, bw = Math.min(colW * 0.72, 40);
    notes.forEach((n, i) => {
      const slot = LIVE_SLOTS - notes.length + i, x = left + (slot + 0.5) * colW, newest = i === notes.length - 1;
      block(x, n.step, bw, newest ? C.now : C.on, newest ? 1 : 0.35 + 0.5 * (i / notes.length));
      if (newest) label(n.label, Math.min(right, x + bw / 2), 'right');
    });
  } else if (view.type === 'takes') {
    const [a, b] = view.takes.length > 1 ? view.takes : [null, view.takes[0]];
    const n = b.length, colW = plotW / n, bw = Math.min(colW * 0.7, 70);
    for (let i = 0; i < n; i++) {
      const x = left + (i + 0.5) * colW, na = a?.notes[i], nb = b.notes[i];
      if (na) block(x, na.step, bw, C.then);
      if (na && nb && na.step != null && nb.step != null && na.step !== nb.step) {
        g.strokeStyle = C.now; g.lineWidth = 1.5; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(x, yOf(na.step)); g.lineTo(x, yOf(nb.step)); g.stroke(); g.setLineDash([]);
      }
      if (nb) block(x, nb.step, a ? bw * 0.62 : bw, C.now);
      if (n <= 8) label(shorten((nb || na)?.label, colW), x);
    }
  } else if (view.type === 'line') {
    const n = view.length, colW = plotW / n, bw = Math.max(1.5, colW * 0.85);
    view.notes.forEach((s, i) => { if (s === undefined) return; block(left + (i + 0.5) * colW, s, bw, i === view.at ? C.now : C.on); });
    label(view.first, left, 'left'); label(view.last, right, 'right');
  } else if (view.type === 'song') {
    const k = view.sections.length, regW = plotW / k;
    view.sections.forEach((sec, si) => {
      const x0 = left + si * regW, slot = (regW - 8) / sec.notes.length, bw = Math.max(2, slot * 0.72);
      if (si > 0) { g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x0) + 0.5, top); g.lineTo(Math.round(x0) + 0.5, bottom); g.stroke(); }
      sec.notes.forEach((s, ni) => {
        const lit = view.hits.has(`${si}:${ni}`), current = si === view.section;
        block(x0 + 4 + (ni + 0.5) * slot, s, bw, lit ? (current ? C.now : C.on) : C.dim);
      });
      label(shorten(sec.label, regW), x0 + regW / 2);
    });
  }
}
function shorten(text, width) {
  if (!text) return '';
  const max = Math.max(3, Math.floor(width / 7));
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export class Score {
  constructor({ box, canvas, title, legend, note }) {
    Object.assign(this, { box, canvas, titleEl: title, legendEl: legend, noteEl: note });
    this.view = null; this.axis = {};
    if (window.ResizeObserver) new ResizeObserver(() => this.render()).observe(canvas);
  }
  setAxis(axis) { this.axis = axis || {}; this.render(); }
  #show(view, title, legend = '') {
    this.view = view; this.box.hidden = false;
    this.titleEl.textContent = title; this.legendEl.innerHTML = legend; this.noteEl.textContent = '';
    this.render();
  }
  clear() { this.view = null; this.box.hidden = true; this.noteEl.textContent = ''; }
  setNote(text) { this.noteEl.textContent = text || ''; }
  // A note you played by tapping, moving or hovering. Hover and arrow keys don't wipe a comparison you are reading.
  live(step, label, { tap = false } = {}) {
    if (this.view && this.view.type !== 'live' && !tap) return;
    if (this.view?.type !== 'live') this.#show({ type: 'live', notes: [] }, 'What you hear');
    this.view.notes.push({ step, label }); if (this.view.notes.length > LIVE_SLOTS) this.view.notes.shift();
    this.render();
  }
  // A tune played in one year. If the last thing shown was the same tune in another year, keep it underneath.
  take(name, length, title) {
    const prev = this.view?.type === 'takes' ? this.view.takes[this.view.takes.length - 1] : null;
    const keep = prev && prev.name !== name && prev.length === length && prev.notes.length === length ? [prev] : [];
    const takes = [...keep, { name, length, notes: [] }];
    this.#show({ type: 'takes', takes }, title || (keep.length ? 'Same tune, two years' : 'Your tune'),
      takes.filter(t => t.name).map(t => `<span><i class="${t === takes[takes.length - 1] ? 'sw-now' : 'sw-then'}"></i>${t.name}</span>`).join(''));
  }
  add(step, label) {
    if (this.view?.type !== 'takes') return;
    const t = this.view.takes[this.view.takes.length - 1]; if (t.notes.length >= t.length) return;
    t.notes.push({ step, label }); this.render();
  }
  line(title, length, first, last) { this.#show({ type: 'line', length, notes: new Array(length), at: -1, first, last }, title); }
  put(i, step) { if (this.view?.type !== 'line') return; this.view.notes[i] = step; this.view.at = i; this.render(); }
  putMany(list) { if (this.view?.type !== 'line' || !list.length) return; for (const [i, step] of list) this.view.notes[i] = step; this.view.at = list[list.length - 1][0]; this.render(); }
  // The same picture in words, for the voice guide (the canvas itself is hidden from screen readers).
  describe() {
    const v = this.view; if (!v) return '';
    const ax = this.axis || {}, mid = (STEPS - 1) / 2;
    const pos = st => (st == null ? 'no data' : st > mid + 1 ? (ax.high || 'high') : st < mid - 1 ? (ax.low || 'low') : (ax.mid || 'in the middle'));
    const trend = list => { const ok = list.filter(x => x != null); if (ok.length < 2) return '';
      const k = Math.max(1, Math.round(ok.length / 5)), a = ok.slice(0, k).reduce((s, x) => s + x, 0) / k, b = ok.slice(-k).reduce((s, x) => s + x, 0) / k;
      return b > a + 0.5 ? 'The notes go up.' : b < a - 0.5 ? 'The notes go down.' : 'The notes stay about level.'; };
    let t = this.titleEl.textContent + '. ';
    if (v.type === 'live' && v.notes.length) {
      const last = v.notes[v.notes.length - 1];
      t += `${v.notes.length} note${v.notes.length > 1 ? 's' : ''}. The newest${last.label ? `, ${last.label},` : ''} is ${pos(last.step)}. ${trend(v.notes.map(n => n.step))}`;
    } else if (v.type === 'takes') {
      t += v.takes.map(k => `${k.name ? k.name + ': ' : ''}${k.notes.map(n => `${n.label ? n.label + ' ' : ''}${pos(n.step)}`).join(', ')}`).join('. ') + '.';
    } else if (v.type === 'line') {
      const ok = v.notes.filter(x => x != null);
      t += `${ok.length} notes${v.first ? `, from ${v.first}` : ''}${v.last ? ` to ${v.last}` : ''}. ${trend(v.notes)}`;
    } else if (v.type === 'song') {
      t += `${v.sections.length} part${v.sections.length > 1 ? 's' : ''}.`;
    }
    const note = this.noteEl.textContent.trim();
    return (t + (note ? ' ' + note : '')).replace(/\s+/g, ' ').trim();
  }
  song(sections) { this.#show({ type: 'song', sections, hits: new Set(), section: -1 }, 'Your Earth song'); }
  hit(si, ni) { if (this.view?.type !== 'song') return; this.view.section = si; this.view.hits.add(`${si}:${ni}`); this.render(); }
  render() {
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScore(g, w, h, this.view, this.axis);
  }
}
