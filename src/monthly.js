// AI-assisted (Anthropic Claude).
// Month-level temperature: NASA GISS GISTEMP v4 monthly anomalies (the numbers behind the SVS 5603 map),
// on the same 2° grid, loaded one year at a time (assets/temperature/monthly/<year>.bin, built by scripts/build-monthly.mjs).
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map(m => m.slice(0, 3));

let meta = null, metaP = null;
const years = new Map(); // year -> Uint8Array | null, once loaded
const pending = new Map();

export function loadMeta() {
  metaP ||= fetch('assets/temperature/monthly/meta.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(m => (meta = m));
  return metaP;
}
export const monthlyMeta = () => meta;
// is there NASA monthly data for this month?
export function hasMonth(year, month) {
  if (!meta || !(month >= 1 && month <= 12)) return false;
  return year >= meta.firstYear && (year < meta.lastYear || (year === meta.lastYear && month <= meta.lastMonth));
}
export function latestMonth() { return meta ? { year: meta.lastYear, month: meta.lastMonth } : null; }
export function loadYear(year) {
  if (years.has(year)) return Promise.resolve(years.get(year));
  if (!pending.has(year)) {
    pending.set(year, fetch(`assets/temperature/monthly/${year}.bin`).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
      .then(b => { const a = b ? new Uint8Array(b) : null; years.set(year, a); pending.delete(year); return a; }));
  }
  return pending.get(year);
}
export const yearLoaded = year => years.has(year) && years.get(year) != null;
const cell = (lat, lon) => Math.max(0, Math.min(89, Math.floor((90 - lat) / 2))) * 180 + ((Math.floor((lon + 180) / 2) % 180) + 180) % 180;
// °C compared with 1951-1980 at one 2° cell for that month, or null (no data / not loaded yet)
export function monthValue(year, month, lat, lon) {
  const a = years.get(year); if (!a || !meta) return null;
  const code = a[(month - 1) * 16200 + cell(lat, lon)];
  return code ? meta.encoding.offset + (code - 1) * meta.encoding.step : null;
}
// the same, by grid cell index (row * 180 + column, north first)
export function monthCell(year, month, idx) {
  const a = years.get(year); if (!a || !meta) return null;
  const code = a[(month - 1) * 16200 + idx];
  return code ? meta.encoding.offset + (code - 1) * meta.encoding.step : null;
}
// area-weighted mean in a box around a point (like boxMean in app.js)
export function monthBoxMean(year, month, lat, lon, r = 6) {
  let s = 0, w = 0;
  for (let la = lat - r + 1; la <= lat + r; la += 2) for (let lo = lon - r + 1; lo <= lon + r; lo += 2) {
    const v = monthValue(year, month, Math.max(-89, Math.min(89, la)), lo); if (v == null) continue;
    const k = Math.cos(la * Math.PI / 180); s += v * k; w += k;
  }
  return w ? s / w : null;
}
// "15 Mar 2006", "Mar 2006" or "2006"
export function dateText(m, long = false) {
  const mon = m.month >= 1 && m.month <= 12 ? (long ? MONTHS : MON)[m.month - 1] : '';
  return [m.month && m.day ? m.day : '', mon, m.year].filter(Boolean).join(' ');
}
