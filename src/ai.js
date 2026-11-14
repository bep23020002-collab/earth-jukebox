// AI-assisted (Anthropic Claude).
// Talks to the Earth Jukebox AI helper (worker/src/index.js). The helper only understands words;
// every number the website shows or plays still comes from NASA's data.
import { findPlace, PLACE_NAMES } from './places.js';

// Set after the helper is deployed, e.g. "https://earth-jukebox-ai.<account>.workers.dev". Empty = AI features offline.
export const AI_URL = '';
export const aiReady = () => AI_URL.startsWith('https://');

async function post(path, payload) {
  if (!aiReady()) throw new Error('The AI helper is not switched on yet.');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(AI_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The AI helper had a problem. Try again.');
    return data;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The AI helper took too long. Try again.' : e.message);
  } finally { clearTimeout(timer); }
}
export const aiSong = text => post('/song', { text });
export const aiAsk = question => post('/ask', { question });

// Without the AI helper: find "year + place" pairs ourselves in each sentence (English place names only).
export function storyWithoutAI(text) {
  // full names ("Sibu, Sarawak") and their short form ("Sibu"), longest first
  const names = [...new Set(PLACE_NAMES.flatMap(n => [n, n.split(',')[0].trim()]))].sort((a, b) => b.length - a.length);
  const out = [];
  for (const clause of text.split(/[.;!?\n]|,\s*(?:and\s+)?|\band\b|\bthen\b/i)) {
    const y = clause.match(/\b(18[89]\d|19\d\d|20[0-2]\d)\b/) || (/\b(today|now)\b/i.test(clause) ? ['2025', '2025'] : null);
    const lower = clause.toLowerCase(), name = names.find(n => lower.includes(n.toLowerCase()));
    if (!y || !name) continue;
    const year = Math.min(2025, Math.max(1880, +y[1])), p = findPlace(name);
    out.push({ year, name: p.name.replace(/^the /, ''), lat: p.lat, lon: p.lon, label: clause.trim().replace(/\s+/g, ' ').slice(0, 40) });
    if (out.length === 6) break;
  }
  return out;
}
