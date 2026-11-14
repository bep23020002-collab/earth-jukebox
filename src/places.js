// AI-assisted (Anthropic Claude).
// A small gazetteer so readouts can say where you are without a map.
// `jump` places are on number keys 1-9 for quick keyboard travel.

export const JUMPS = [
  { name: 'Sibu, Sarawak', lat: 2.3, lon: 111.8 },
  { name: 'the Arctic Ocean', lat: 82, lon: 30 },
  { name: 'the Sahara', lat: 23, lon: 13 },
  { name: 'the Amazon rainforest', lat: -4, lon: -62 },
  { name: 'Siberia', lat: 62, lon: 100 },
  { name: 'the middle of the Pacific Ocean', lat: 0, lon: -150 },
  { name: 'Europe', lat: 50, lon: 10 },
  { name: 'central Australia', lat: -24, lon: 134 },
  { name: 'Antarctica', lat: -80, lon: 0 },
];

const PLACES = [
  ...JUMPS,
  { name: 'Kuching', lat: 1.6, lon: 110.3 }, { name: 'Miri', lat: 4.4, lon: 114.0 },
  { name: 'Kota Kinabalu', lat: 6.0, lon: 116.1 }, { name: 'Kuala Lumpur', lat: 3.1, lon: 101.7 },
  { name: 'Singapore', lat: 1.35, lon: 103.8 }, { name: 'Jakarta', lat: -6.2, lon: 106.8 },
  { name: 'Manila', lat: 14.6, lon: 121.0 }, { name: 'Bangkok', lat: 13.8, lon: 100.5 },
  { name: 'the South China Sea', lat: 12, lon: 114 }, { name: 'Tokyo', lat: 35.7, lon: 139.7 },
  { name: 'Beijing', lat: 39.9, lon: 116.4 }, { name: 'Delhi', lat: 28.6, lon: 77.2 },
  { name: 'the Indian Ocean', lat: -15, lon: 75 }, { name: 'the Arabian Peninsula', lat: 23, lon: 46 },
  { name: 'East Africa', lat: 0, lon: 37 }, { name: 'Southern Africa', lat: -25, lon: 25 },
  { name: 'West Africa', lat: 10, lon: -2 }, { name: 'the Mediterranean Sea', lat: 36, lon: 18 },
  { name: 'Greenland', lat: 72, lon: -40 }, { name: 'Canada', lat: 58, lon: -100 },
  { name: 'Alaska', lat: 64, lon: -152 }, { name: 'the United States', lat: 39, lon: -98 },
  { name: 'Mexico', lat: 23, lon: -102 }, { name: 'the North Atlantic Ocean', lat: 40, lon: -40 },
  { name: 'the South Atlantic Ocean', lat: -25, lon: -15 }, { name: 'the North Pacific Ocean', lat: 35, lon: -160 },
  { name: 'the South Pacific Ocean', lat: -30, lon: -120 }, { name: 'the Southern Ocean', lat: -60, lon: 60 },
  { name: 'Argentina', lat: -36, lon: -64 }, { name: 'New Zealand', lat: -41, lon: 174 },
  { name: 'Papua New Guinea', lat: -6, lon: 145 }, { name: 'India', lat: 21, lon: 79 },
  { name: 'Central Asia', lat: 45, lon: 65 }, { name: 'the Tibetan Plateau', lat: 33, lon: 88 },
  { name: 'Western Europe', lat: 46, lon: 2 }, { name: 'Scandinavia', lat: 63, lon: 16 },
  { name: 'the Barents Sea', lat: 75, lon: 40 }, { name: 'the Bering Sea', lat: 58, lon: -175 },
  { name: 'the Caribbean Sea', lat: 15, lon: -75 }, { name: 'Brazil', lat: -12, lon: -48 },
];

function distanceKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function placeName(lat, lon) {
  let best = PLACES[0], d = Infinity;
  for (const p of PLACES) { const k = distanceKm({ lat, lon }, p); if (k < d) { d = k; best = p; } }
  return d < 400 ? best.name : `near ${best.name}`;
}

export function formatCoord(lat, lon) {
  const la = `${Math.abs(Math.round(lat))}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(Math.round(lon))}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}
