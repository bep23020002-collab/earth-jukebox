// AI-assisted (Anthropic Claude).
// A round, rotatable Earth drawn on a 2D canvas. Each frame of NASA's equirectangular
// visualization is wrapped onto the sphere (orthographic view), so the colors stay exactly
// NASA's colors. No WebGL needed.

const D2R = Math.PI / 180;

export class Globe {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.lat0 = 8; this.lon0 = 112; // view centre (degrees)
    this.tex = null; this.ripples = []; this.marker = null; this.strokes = [];
    this.anim = null; this.dirty = true; this.raf = 0;
    this.out = this.g.createImageData(canvas.width, canvas.height);
  }

  get size() { return this.c.width; }
  get radius() { return this.size * 0.45; }

  // img: a loaded equirectangular picture (any size, 2:1).
  setTexture(img) { // an <img> or a <canvas>
    if (!img || !(img.naturalWidth || img.width)) return;
    if (!this.texCanvas) { this.texCanvas = document.createElement('canvas'); this.texCanvas.width = 720; this.texCanvas.height = 360; this.texG = this.texCanvas.getContext('2d', { willReadFrequently: true }); }
    this.texG.drawImage(img, 0, 0, 720, 360);
    this.tex = { w: 720, h: 360, data: this.texG.getImageData(0, 0, 720, 360).data };
    this.request();
  }

  setMarker(lat, lon) { this.marker = { lat, lon }; this.request(); }

  // Rotate smoothly so (lat, lon) faces the viewer.
  centerOn(lat, lon, ms = 320) {
    const from = { lat: this.lat0, lon: this.lon0 };
    let dLon = ((lon - from.lon + 540) % 360) - 180;
    const to = { lat: Math.max(-70, Math.min(70, lat)), lon: from.lon + dLon };
    if (ms <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.lat0 = to.lat; this.lon0 = to.lon; this.request(); return; }
    this.anim = { from, to, t0: performance.now(), ms };
    this.request();
  }

  rotateBy(dxPx, dyPx) {
    const k = 1 / this.radius / D2R * (this.c.width / this.c.getBoundingClientRect().width);
    this.lon0 -= dxPx * k; this.lat0 = Math.max(-80, Math.min(80, this.lat0 + dyPx * k));
    this.anim = null; this.request();
  }

  // Lines the listener draws on the globe (each stroke is a list of {lat, lon}).
  startStroke() { this.strokes.push([]); }
  addPoint(lat, lon) { if (!this.strokes.length) this.startStroke(); this.strokes[this.strokes.length - 1].push({ lat, lon }); this.request(); }
  clearStrokes() { this.strokes = []; this.request(); }

  ripple(lat, lon, hue = 30) { this.ripples.push({ lat, lon, t0: performance.now(), hue }); this.request(); }

  // Screen point (CSS pixels relative to the canvas) -> {lat, lon} or null if off the globe.
  pick(clientX, clientY) {
    const r = this.c.getBoundingClientRect(), s = this.c.width / r.width;
    const X = ((clientX - r.left) * s - this.size / 2) / this.radius, Y = (this.size / 2 - (clientY - r.top) * s) / this.radius;
    const rho2 = X * X + Y * Y; if (rho2 > 1) return null;
    const w = this.#toWorld(X, Y, Math.sqrt(1 - rho2));
    return { lat: Math.asin(w[2]) / D2R, lon: Math.atan2(w[1], w[0]) / D2R };
  }

  request() { this.dirty = true; if (!this.raf) this.raf = requestAnimationFrame(t => this.#frame(t)); }

  #basis() {
    const p = this.lat0 * D2R, l = this.lon0 * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    return { out: [cp * cl, cp * sl, sp], east: [-sl, cl, 0], north: [-sp * cl, -sp * sl, cp] };
  }
  #toWorld(X, Y, Z) {
    const b = this.#basis();
    return [0, 1, 2].map(i => X * b.east[i] + Y * b.north[i] + Z * b.out[i]);
  }
  project(lat, lon) { // -> {x, y, visible} in canvas pixels
    const p = lat * D2R, l = lon * D2R, w = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)], b = this.#basis();
    const dot = v => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    return { x: this.size / 2 + dot(b.east) * this.radius, y: this.size / 2 - dot(b.north) * this.radius, visible: dot(b.out) > 0 };
  }

  #frame(now) {
    this.raf = 0;
    if (this.anim) {
      const { from, to, t0, ms } = this.anim, k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
      this.lat0 = from.lat + (to.lat - from.lat) * e; this.lon0 = from.lon + (to.lon - from.lon) * e;
      if (k >= 1) this.anim = null;
    }
    this.ripples = this.ripples.filter(r => now - r.t0 < 900);
    this.#render(now);
    if (this.anim || this.ripples.length) this.request();
  }

  #render(now) {
    const S = this.size, R = this.radius, c = S / 2, g = this.g, o = this.out.data, tex = this.tex;
    const b = this.#basis();
    const L = [-0.45, 0.55, 0.7], Ln = Math.hypot(...L); L[0] /= Ln; L[1] /= Ln; L[2] /= Ln;
    o.fill(0);
    if (tex) {
      const { w: tw, h: th, data: td } = tex;
      for (let py = 0; py < S; py++) {
        const Y = (c - py - 0.5) / R; if (Y > 1 || Y < -1) continue;
        const half = Math.sqrt(1 - Y * Y) * R, x0 = Math.max(0, Math.floor(c - half)), x1 = Math.min(S - 1, Math.ceil(c + half));
        for (let px = x0; px <= x1; px++) {
          const X = (px + 0.5 - c) / R, r2 = X * X + Y * Y; if (r2 > 1) continue;
          const Z = Math.sqrt(1 - r2);
          const wx = X * b.east[0] + Y * b.north[0] + Z * b.out[0];
          const wy = X * b.east[1] + Y * b.north[1] + Z * b.out[1];
          const wz = X * b.east[2] + Y * b.north[2] + Z * b.out[2];
          const lat = Math.asin(wz), lon = Math.atan2(wy, wx);
          let tx = Math.floor((lon + Math.PI) / (2 * Math.PI) * tw); if (tx >= tw) tx -= tw;
          const ty = Math.min(th - 1, Math.floor((Math.PI / 2 - lat) / Math.PI * th));
          const ti = (ty * tw + tx) * 4, oi = (py * S + px) * 4;
          const light = 0.72 + 0.28 * Math.max(0, X * L[0] + Y * L[1] + Z * L[2]);
          const edge = r2 > 0.96 ? Math.max(0, (1 - r2) / 0.04) : 1; // soft anti-aliased rim
          o[oi] = td[ti] * light; o[oi + 1] = td[ti + 1] * light; o[oi + 2] = td[ti + 2] * light; o[oi + 3] = 255 * edge;
        }
      }
    }
    g.clearRect(0, 0, S, S);
    // atmosphere
    const atm = g.createRadialGradient(c, c, R * 0.98, c, c, R * 1.1);
    atm.addColorStop(0, 'rgba(140,194,238,0.35)'); atm.addColorStop(1, 'rgba(140,194,238,0)');
    g.fillStyle = atm; g.beginPath(); g.arc(c, c, R * 1.1, 0, Math.PI * 2); g.fill();
    if (!this.tmp) { this.tmp = document.createElement('canvas'); this.tmp.width = S; this.tmp.height = S; }
    this.tmp.getContext('2d').putImageData(this.out, 0, 0);
    g.drawImage(this.tmp, 0, 0);
    // lines drawn by the listener
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const stroke of this.strokes) {
      for (const [w, color] of [[9, 'rgba(5,8,15,.55)'], [4, 'rgba(255,255,255,.95)']]) {
        g.lineWidth = w; g.strokeStyle = color; g.beginPath(); let pen = false;
        for (const pt of stroke) { const p = this.project(pt.lat, pt.lon); if (!p.visible) { pen = false; continue; } if (pen) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); pen = true; } }
        g.stroke();
      }
    }
    // ripples where the Earth was tapped
    for (const r of this.ripples) {
      const p = this.project(r.lat, r.lon); if (!p.visible) continue;
      const k = (now - r.t0) / 900;
      g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath(); g.arc(p.x, p.y, 10 + k * R * 0.25, 0, Math.PI * 2); g.stroke();
    }
    // listening point
    if (this.marker) {
      const p = this.project(this.marker.lat, this.marker.lon);
      if (p.visible) {
        g.lineWidth = 6; g.strokeStyle = '#05080F'; g.beginPath(); g.arc(p.x, p.y, 16, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.beginPath(); g.arc(p.x, p.y, 16, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fill();
      }
    }
  }
}
