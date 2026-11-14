// AI-assisted (Anthropic Claude).
// Talks to the Earth Jukebox AI helper (worker/src/index.js). The helper only understands words;
// every number the website shows or plays still comes from NASA's data.
import { findPlace, PLACE_NAMES } from './places.js';

// Set after the helper is deployed, e.g. "https://earth-jukebox-ai.<account>.workers.dev". Empty = AI features offline.
export const AI_URL = 'https://earth-jukebox-ai.yapa920.workers.dev';
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

// Without the AI helper: find "date + place" pairs ourselves in each sentence (English place names only).
// Dates: "2006", "March 2006", "15 March 2006", "March 15, 2006", "15/3/2006" (day/month/year) or "2006-03-15".
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|May|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function findDate(clause) {
  const iso = clause.match(/\b(18[89]\d|19\d\d|20[0-2]\d)-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };
  const dmy = clause.match(/\b(\d{1,2})[/.](\d{1,2})[/.](18[89]\d|19\d\d|20[0-2]\d)\b/);
  if (dmy) return { year: +dmy[3], month: +dmy[2], day: +dmy[1] };
  const y = clause.match(/\b(18[89]\d|19\d\d|20[0-2]\d)\b/);
  if (!y) return /\b(today|now)\b/i.test(clause) ? { year: 2025 } : null;
  const mm = clause.match(new RegExp(MONTH_RE.source, 'i'));
  if (!mm || (mm[1].toLowerCase() === 'may' && mm[1] !== 'May')) return { year: +y[1] }; // "may" as a verb is not a month
  const month = MONTH_KEYS.indexOf(mm[1].slice(0, 3).toLowerCase()) + 1;
  const d = clause.match(new RegExp(`\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+(?:of\\s+)?${mm[1]}\\b`, 'i')) || clause.match(new RegExp(`\\b${mm[1]}\\s+([0-3]?\\d)(?:st|nd|rd|th)?\\b`, 'i'));
  return { year: +y[1], month, day: d ? +d[1] : null };
}
export function storyWithoutAI(text) {
  // full names ("Sibu, Sarawak") and their short form ("Sibu"), longest first
  const names = [...new Set(PLACE_NAMES.flatMap(n => [n, n.split(',')[0].trim()]))].sort((a, b) => b.length - a.length);
  const out = [];
  for (const clause of text.split(/[.;!?\n]|,(?!\s*[0-9])\s*(?:and\s+)?|\band\b|\bthen\b/i)) {
    const date = findDate(clause);
    const lower = clause.toLowerCase(), name = names.find(n => lower.includes(n.toLowerCase()));
    if (!date || !name) continue;
    const month = date.month >= 1 && date.month <= 12 ? date.month : null, day = month && date.day >= 1 && date.day <= 31 ? date.day : null;
    const p = findPlace(name);
    out.push({ year: Math.min(2026, Math.max(1880, date.year)), month, day, name: p.name.replace(/^the /, ''), lat: p.lat, lon: p.lon, label: clause.trim().replace(/\s+/g, ' ').slice(0, 40) });
    if (out.length === 6) break;
  }
  return out;
}
