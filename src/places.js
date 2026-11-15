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

// Chinese names, for the voice guide in Chinese ("near X" becomes "X附近"). Names not listed are said as they are.
const ZH_NAMES = {
  "Sibu, Sarawak": "砂拉越诗巫",
  "the Arctic Ocean": "北冰洋",
  "the Sahara": "撒哈拉沙漠",
  "the Amazon rainforest": "亚马逊雨林",
  "Siberia": "西伯利亚",
  "the middle of the Pacific Ocean": "太平洋中间",
  "Europe": "欧洲",
  "central Australia": "澳洲中部",
  "Antarctica": "南极洲",
  "Kuching": "古晋",
  "Miri": "美里",
  "Kota Kinabalu": "亚庇",
  "Kuala Lumpur": "吉隆坡",
  "Singapore": "新加坡",
  "Jakarta": "雅加达",
  "Manila": "马尼拉",
  "Bangkok": "曼谷",
  "the South China Sea": "南中国海",
  "Tokyo": "东京",
  "Beijing": "北京",
  "Delhi": "德里",
  "the Indian Ocean": "印度洋",
  "the Arabian Peninsula": "阿拉伯半岛",
  "East Africa": "东非",
  "Southern Africa": "南部非洲",
  "West Africa": "西非",
  "the Mediterranean Sea": "地中海",
  "Greenland": "格陵兰",
  "Canada": "加拿大",
  "Alaska": "阿拉斯加",
  "the United States": "美国",
  "Mexico": "墨西哥",
  "the North Atlantic Ocean": "北大西洋",
  "the South Atlantic Ocean": "南大西洋",
  "the North Pacific Ocean": "北太平洋",
  "the South Pacific Ocean": "南太平洋",
  "the Southern Ocean": "南冰洋",
  "Argentina": "阿根廷",
  "New Zealand": "新西兰",
  "Papua New Guinea": "巴布亚新几内亚",
  "India": "印度",
  "Central Asia": "中亚",
  "the Tibetan Plateau": "青藏高原",
  "Western Europe": "西欧",
  "Scandinavia": "斯堪的纳维亚",
  "the Barents Sea": "巴伦支海",
  "the Bering Sea": "白令海",
  "the Caribbean Sea": "加勒比海",
  "Brazil": "巴西",
  "Bintulu": "民都鲁",
  "Mukah": "慕娜",
  "Kapit": "加帛",
  "Sarikei": "泗里街",
  "Limbang": "林梦",
  "Sandakan": "山打根",
  "Tawau": "斗湖",
  "George Town, Penang": "槟城乔治市",
  "Johor Bahru": "新山",
  "Ipoh": "怡保",
  "Melaka": "马六甲",
  "Kota Bharu": "哥打巴鲁",
  "Kuantan": "关丹",
  "Brunei": "文莱",
  "Pontianak": "坤甸",
  "Hanoi": "河内",
  "Ho Chi Minh City": "胡志明市",
  "Yangon": "仰光",
  "Fuzhou": "福州",
  "Guangzhou": "广州",
  "Hong Kong": "香港",
  "Taipei": "台北",
  "Shanghai": "上海",
  "Seoul": "首尔",
  "Dhaka": "达卡",
  "Mumbai": "孟买",
  "Chennai": "金奈",
  "Karachi": "卡拉奇",
  "Dubai": "迪拜",
  "Mecca": "麦加",
  "Istanbul": "伊斯坦布尔",
  "Cairo": "开罗",
  "Lagos": "拉各斯",
  "Nairobi": "内罗毕",
  "Johannesburg": "约翰内斯堡",
  "London": "伦敦",
  "Paris": "巴黎",
  "Berlin": "柏林",
  "Moscow": "莫斯科",
  "Reykjavik": "雷克雅未克",
  "New York": "纽约",
  "Los Angeles": "洛杉矶",
  "Mexico City": "墨西哥城",
  "Sao Paulo": "圣保罗",
  "Buenos Aires": "布宜诺斯艾利斯",
  "Lima": "利马",
  "Sydney": "悉尼",
  "Perth": "珀斯",
  "Auckland": "奥克兰",
  "Anchorage": "安克雷奇",
  "the North Pole": "北极",
  "the South Pole": "南极",
};
export function zhPlace(name) {
  if (!name) return name;
  const near = /^near /.test(name), base = name.replace(/^near /, '');
  const zh = ZH_NAMES[base] || base;
  return near ? `${zh}附近` : zh;
}
