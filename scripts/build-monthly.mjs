// AI-assisted (Anthropic Claude).
// Month-level temperature for "My Earth song" and "Ask the Earth".
// Reads NASA GISS GISTEMP v4 monthly anomalies (data/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc, NetCDF classic,
// 2°x2° grid, °C vs 1951-1980; the same analysis behind the SVS 5603 map) and writes one small file per year:
//   assets/temperature/monthly/<year>.bin   12 months x 90 rows (north first) x 180 columns (180°W first), 1 byte per cell
//   assets/temperature/monthly/by-cell.bin  the same cell by cell (all months of cell 0, then cell 1, ...), for Play month by month
//   assets/temperature/monthly/meta.json    encoding, months available, and a check against NASA's published global means
// Byte 0 = no data; otherwise value = offset + (byte - 1) * step  (offset -6.35 °C, step 0.05 °C; values outside are clipped).
// Run: node scripts/build-monthly.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const buf = readFileSync(root + 'data/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc');

// ---- minimal NetCDF classic (CDF-1/CDF-2) reader ----
let p = 0;
const u32 = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
const pad4 = n => (n + 3) & ~3;
const name = () => { const n = u32(); const s = buf.toString('latin1', p, p + n); p += pad4(n); return s; };
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
function values(type, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = p + i * SIZE[type];
    out.push(type === 1 ? buf.readInt8(o) : type === 2 ? String.fromCharCode(buf[o]) : type === 3 ? buf.readInt16BE(o) : type === 4 ? buf.readInt32BE(o) : type === 5 ? buf.readFloatBE(o) : buf.readDoubleBE(o));
  }
  p += pad4(n * SIZE[type]);
  return type === 2 ? out.join('') : out;
}
function attrs() {
  const tag = u32(), n = u32(), out = {};
  if (tag === 0) return out;
  for (let i = 0; i < n; i++) { const k = name(), type = u32(), cnt = u32(); const v = values(type, cnt); out[k] = Array.isArray(v) && v.length === 1 ? v[0] : v; }
  return out;
}
if (buf.toString('latin1', 0, 3) !== 'CDF') throw new Error('Not a NetCDF classic file');
const version = buf[3]; p = 4;
const numrecs = u32();
const dims = []; { const tag = u32(), n = u32(); if (tag) for (let i = 0; i < n; i++) dims.push({ name: name(), len: u32() }); }
const gatts = attrs();
const vars = []; {
  const tag = u32(), n = u32();
  if (tag) for (let i = 0; i < n; i++) {
    const v = { name: name() }; const nd = u32(); v.dims = []; for (let j = 0; j < nd; j++) v.dims.push(u32());
    v.atts = attrs(); v.type = u32(); v.vsize = u32(); v.begin = version === 2 ? Number(buf.readBigUInt64BE((p += 8) - 8)) : u32();
    v.isRec = v.dims.length && dims[v.dims[0]].len === 0;
    vars.push(v);
  }
}
const recVars = vars.filter(v => v.isRec), recSize = recVars.length === 1 ? recVars[0].vsize : recVars.reduce((s, v) => s + v.vsize, 0);
const V = n => vars.find(v => v.name === n);
const readAll = (v, n) => { p = v.begin; return values(v.type, n); };
const lat = readAll(V('lat'), dims[V('lat').dims[0]].len), lon = readAll(V('lon'), dims[V('lon').dims[0]].len);
const ta = V('tempanomaly'), scale = ta.atts.scale_factor ?? 1, offset = ta.atts.add_offset ?? 0, fill = ta.atts._FillValue;
const timeV = V('time');
// time is either the record (unlimited) dimension or a fixed dimension; handle both
const timeIsRec = timeV.isRec, nTimes = timeIsRec ? numrecs : dims[timeV.dims[0]].len;
const times = timeIsRec ? Array.from({ length: nTimes }, (_, r) => { p = timeV.begin + r * recSize; return values(timeV.type, 1)[0]; }) : readAll(timeV, nTimes);
const slab = r => (ta.isRec ? ta.begin + r * recSize : ta.begin + r * 90 * 180 * SIZE[ta.type]);
const timeUnits = timeV.atts.units; // "days since 1800-01-01 00:00:00"
const epoch = Date.UTC(+timeUnits.match(/since (\d+)/)[1], 0, 1);
const ym = days => { const d = new Date(epoch + days * 86400000); return [d.getUTCFullYear(), d.getUTCMonth()]; };
console.log({ version, nTimes, dims: dims.map(d => `${d.name}:${d.len}`), lat: [lat[0], lat[lat.length - 1]], lon: [lon[0], lon[lon.length - 1]], scale, fill, timeUnits, first: ym(times[0]), last: ym(times[nTimes - 1]), title: gatts.title });
if (lat.length !== 90 || lon.length !== 180) throw new Error('Expected a 2° grid');

// ---- re-grid to Earth Jukebox order (north first, 180°W first) and encode ----
const OFF = -6.35, STEP = 0.05;
const enc = v => (v == null ? 0 : Math.max(1, Math.min(255, Math.round((v - OFF) / STEP) + 1)));
const southFirst = lat[0] < lat[lat.length - 1];
const lonIdx = lon.map(l => ((Math.floor((l + 180) / 2) % 180) + 180) % 180);
const out = new Map(); // year -> Uint8Array(12*16200)
const monthsWithData = {};
const globalMeans = {};
for (let r = 0; r < nTimes; r++) {
  const [y, m] = ym(times[r]);
  if (!out.has(y)) out.set(y, new Uint8Array(12 * 16200));
  const a = out.get(y); let any = false, s = 0, w = 0;
  const base = slab(r);
  for (let j = 0; j < 90; j++) {
    const row = southFirst ? 89 - j : j, cw = Math.cos(lat[j] * Math.PI / 180);
    for (let i = 0; i < 180; i++) {
      const raw = buf.readInt16BE(base + (j * 180 + i) * 2);
      if (raw === fill) continue;
      const v = raw * scale + offset; any = true; s += v * cw; w += cw;
      a[m * 16200 + row * 180 + lonIdx[i]] = enc(v);
    }
  }
  if (any) { (monthsWithData[y] ||= []).push(m + 1); globalMeans[`${y}-${m + 1}`] = s / w; }
}
const dir = root + 'assets/temperature/monthly/';
mkdirSync(dir, { recursive: true });
for (const [y, a] of out) if (monthsWithData[y]) writeFileSync(dir + `${y}.bin`, a);
// the same data cell by cell, for playing one place month by month: by-cell.bin = for each cell (north first, 180°W first)
// every month from January of firstYear, so the website fetches only the few cells around a place (HTTP range request)
const ys = [...out.keys()].filter(y => monthsWithData[y]).sort((a, b) => a - b);
const nMonths = (ys[ys.length - 1] - ys[0]) * 12 + Math.max(...monthsWithData[ys[ys.length - 1]]);
const byCell = new Uint8Array(16200 * nMonths);
for (let k = 0; k < nMonths; k++) { const a = out.get(ys[0] + Math.floor(k / 12)), m = k % 12; for (let c = 0; c < 16200; c++) byCell[c * nMonths + k] = a[m * 16200 + c]; }
writeFileSync(dir + 'by-cell.bin', byCell);

// ---- check: area-weighted global mean of the grid vs NASA's published monthly global means ----
const glb = readFileSync(root + 'data/gistemp/GLB.Ts+dSST.csv', 'utf8').trim().split('\n').slice(2).map(l => l.split(','));
const diffs = [];
for (const r of glb) for (let m = 1; m <= 12; m++) { const v = r[m]; const g = globalMeans[`${+r[0]}-${m}`]; if (v !== '***' && g != null) diffs.push(g - +v); }
const mae = diffs.reduce((s, d) => s + Math.abs(d), 0) / diffs.length;
const years = Object.keys(monthsWithData).map(Number).sort((a, b) => a - b);
const lastYear = years[years.length - 1];
const meta = {
  source: 'NASA GISS GISTEMP v4, gistemp1200_GHCNv4_ERSSTv5.nc (1200 km smoothing), monthly temperature anomaly vs 1951-1980, 2° grid',
  url: 'https://data.giss.nasa.gov/gistemp/',
  grid: { width: 180, height: 90, cellDegrees: 2, rows: 'north first', columns: '180°W first' },
  encoding: { offset: OFF, step: STEP, noData: 0 },
  firstYear: years[0], lastYear, lastMonth: Math.max(...monthsWithData[lastYear]), monthsPerCell: nMonths,
  check: { comparedMonths: diffs.length, meanAbsDiffFromPublishedGlobalMean: +mae.toFixed(3), note: 'Simple cos-latitude mean of the grid, compared with GLB.Ts+dSST.csv' },
};
writeFileSync(dir + 'meta.json', JSON.stringify(meta, null, 1));
console.log({ files: years.length, lastYear, lastMonth: meta.lastMonth, check: meta.check });
