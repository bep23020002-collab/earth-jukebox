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

// Extra towns and cities people may want in their Earth song.
const MORE = [
  ['Bintulu', 3.17, 113.03], ['Mukah', 2.9, 112.1], ['Kapit', 2.02, 112.93], ['Sarikei', 2.13, 111.52], ['Limbang', 4.75, 115.0],
  ['Sandakan', 5.84, 118.12], ['Tawau', 4.24, 117.89], ['George Town, Penang', 5.41, 100.33], ['Johor Bahru', 1.49, 103.74],
  ['Ipoh', 4.6, 101.08], ['Melaka', 2.19, 102.25], ['Kota Bharu', 6.13, 102.24], ['Kuantan', 3.81, 103.33], ['Brunei', 4.9, 114.94],
  ['Pontianak', -0.03, 109.33], ['Hanoi', 21.03, 105.85], ['Ho Chi Minh City', 10.82, 106.63], ['Yangon', 16.87, 96.2],
  ['Fuzhou', 26.07, 119.3], ['Guangzhou', 23.13, 113.26], ['Hong Kong', 22.32, 114.17], ['Taipei', 25.03, 121.57],
  ['Shanghai', 31.23, 121.47], ['Seoul', 37.57, 126.98], ['Dhaka', 23.81, 90.41], ['Mumbai', 19.08, 72.88], ['Chennai', 13.08, 80.27],
  ['Karachi', 24.86, 67.0], ['Dubai', 25.2, 55.27], ['Mecca', 21.39, 39.86], ['Istanbul', 41.01, 28.98], ['Cairo', 30.04, 31.24],
  ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82], ['Johannesburg', -26.2, 28.05], ['London', 51.51, -0.13], ['Paris', 48.86, 2.35],
  ['Berlin', 52.52, 13.4], ['Moscow', 55.76, 37.62], ['Reykjavik', 64.15, -21.94], ['New York', 40.71, -74.0], ['Los Angeles', 34.05, -118.24],
  ['Mexico City', 19.43, -99.13], ['Sao Paulo', -23.55, -46.63], ['Buenos Aires', -34.6, -58.38], ['Lima', -12.05, -77.04],
  ['Sydney', -33.87, 151.21], ['Perth', -31.95, 115.86], ['Auckland', -36.85, 174.76], ['Anchorage', 61.22, -149.9],
  ['the North Pole', 89, 0], ['the South Pole', -89, 0],
].map(([name, lat, lon]) => ({ name, lat, lon }));
PLACES.push(...MORE);

// Names for a search box, without "the" so they sort naturally.
export const PLACE_NAMES = [...new Set(PLACES.map(p => p.name.replace(/^the /, '')))].sort((a, b) => a.localeCompare(b));
export function findPlace(text) {
  const q = text.trim().toLowerCase().replace(/^the /, '');
  if (!q) return null;
  return PLACES.find(p => p.name.toLowerCase().replace(/^the /, '') === q)
    || PLACES.find(p => p.name.toLowerCase().replace(/^the /, '').startsWith(q)) || null;
}

export function formatCoord(lat, lon) {
  const la = `${Math.abs(Math.round(lat))}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(Math.round(lon))}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}
