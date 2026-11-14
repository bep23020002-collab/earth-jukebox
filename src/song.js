// AI-assisted (Anthropic Claude).
// "My Earth song": each moment (a year + a place that matters to you) becomes two bars of music.
//   - centre note  = how warm that place was that year (warmer -> higher)
//   - melody shape = how warmth changes as we walk a small circle around the place
//   - chord        = sits on the centre note, so warmer moments sound brighter
//   - drums        = how much lightning NASA's space station saw near the place (EIC: ISS lightning)
//                    (falls back to "busier when warmer" if lightning data is not loaded)
//   - harp         = how warm the nearest ocean is (EIC: sea surface currents and temperature)
// The rules are fixed and explained to the listener, so the music stays honest to the data.

export const BPM = 92;
export const BEATS_PER_MOMENT = 8;
const STEPS = 11; // notes in the scale (see audio.js)
const RHYTHM = [0, 1, 1.5, 2, 3, 4, 5, 5.5]; // where the 8 melody notes fall inside two bars
const RADIUS = 8; // degrees: size of the circle we walk around each place

// data: { valueAt(yearIndex, lat, lon, moment) -> °C or null, yearIndexOf(year), tOf(v) -> 0..1, localMean(yi, lat, lon, moment) }
// The moment is passed along so a moment with a month can use NASA's monthly data instead of the yearly map.
export function composeSong(moments, data) {
  const sections = moments.map((m, k) => {
    const yi = data.yearIndexOf(m.year);
    const mean = data.localMean(yi, m.lat, m.lon, m);
    const centre = mean == null ? null : Math.max(0, Math.min(STEPS - 1, Math.round(data.tOf(mean) * (STEPS - 1)))); // monthly values can go past the scale
    const notes = RHYTHM.map((beat, i) => {
      const a = Math.PI - i * (2 * Math.PI / RHYTHM.length); // start west, walk clockwise
      const lat = Math.max(-85, Math.min(85, m.lat + RADIUS * Math.sin(a)));
      const lon = m.lon + RADIUS * Math.cos(a) / Math.max(0.3, Math.cos(m.lat * Math.PI / 180));
      const v = data.valueAt(yi, lat, lon, m);
      if (v == null || centre == null) return { beat, step: null, lat, lon, v };
      const dev = Math.max(-3, Math.min(3, Math.round((v - mean) / 0.15))); // 0.15 °C = one scale step
      return { beat, step: Math.max(0, Math.min(STEPS - 1, centre + dev)), lat, lon, v };
    });
    const layers = data.extra ? data.extra(m) : null;
    const busy = layers?.lightning != null ? (layers.lightning < 0.15 ? 0 : layers.lightning < 0.4 ? 1 : 2)
      : mean == null ? 0 : mean < 0 ? 0 : mean < 1 ? 1 : 2; // drum pattern level
    return { moment: m, yearIndex: yi, mean, centre, notes, busy, layers, startBeat: k * BEATS_PER_MOMENT };
  });
  return { sections, totalBeats: sections.length * BEATS_PER_MOMENT + 4 };
}

// Schedule a composed song on the sound engine. Returns the start time (AudioContext seconds).
export function scheduleSong(song, sound) {
  const spb = 60 / BPM, t0 = sound.now + 0.35;
  const stepT = s => s / (STEPS - 1);
  for (const sec of song.sections) {
    const at = t0 + sec.startBeat * spb;
    if (sec.centre != null) {
      const root = sec.centre;
      sound.pad([root, Math.min(STEPS - 1, root + 3), Math.min(STEPS - 1, root + 5)].map(stepT), { when: at, dur: BEATS_PER_MOMENT * spb + 0.4, gain: 0.1 });
    }
    for (const n of sec.notes) {
      const when = at + n.beat * spb;
      if (n.step == null) sound.noData({ when }); else sound.note(stepT(n.step), { when, dur: n.beat % 1 ? spb * 0.4 : spb * 0.8, gain: 0.42, layers: false });
    }
    if (sec.layers?.ocean != null) { // the sea: a rippling harp figure, higher and brighter over warmer water
      const base = Math.round(sec.layers.ocean * (STEPS - 1));
      [0.5, 2.5, 4.5, 6.5].forEach((b, i) => sound.harp(stepT(Math.max(0, Math.min(STEPS - 1, base + [0, 2, 1, 3][i]))), { when: at + b * spb, gain: 0.22, pan: i % 2 ? 0.4 : -0.4 }));
    }
    for (let b = 0; b < BEATS_PER_MOMENT; b++) {
      if (b % 2 === 0) sound.kick({ when: at + b * spb, gain: 0.55 });
      if (sec.busy >= 2 && b % 4 === 3) sound.kick({ when: at + (b + 0.5) * spb, gain: 0.35 });
      sound.hat({ when: at + b * spb, gain: 0.07 });
      if (sec.busy >= 1) sound.hat({ when: at + (b + 0.5) * spb, gain: 0.05, pan: 0.3 });
      if (sec.busy >= 2) { sound.hat({ when: at + (b + 0.25) * spb, gain: 0.035, pan: -0.3 }); sound.hat({ when: at + (b + 0.75) * spb, gain: 0.035, pan: -0.3 }); }
    }
  }
  // ending: the last moment's chord rings out
  const last = song.sections[song.sections.length - 1];
  if (last?.centre != null) {
    const end = t0 + song.sections.length * BEATS_PER_MOMENT * spb;
    sound.pad([last.centre, Math.min(STEPS - 1, last.centre + 3), Math.min(STEPS - 1, last.centre + 5)].map(stepT), { when: end, dur: 3.2, gain: 0.12 });
    sound.note(stepT(last.centre), { when: end, dur: 1.6, gain: 0.4 });
  }
  return t0;
}
