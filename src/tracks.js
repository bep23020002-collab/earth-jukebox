// AI-assisted (Anthropic Claude).
// What each Earth Jukebox track sounds like and how it is described in plain words.
// Every track comes from an official NASA Earth Information Center (EIC) visualization.

export const KINDS = {
  temperature: {
    label: 'Temperature',
    instrument: 'mallet',            // struck, marimba-like notes
    hint: 'Warmer places play higher notes.',
    legend: ['Colder than normal', 'Normal', 'Hotter than normal'],
    words: v => (v <= -1 ? 'Much colder than normal' : v <= -0.3 ? 'Colder than normal' : v < 0.3 ? 'About normal'
      : v < 1 ? 'Warmer than normal' : v < 1.6 ? 'Much warmer than normal' : 'Extremely warm'),
    detail: (v, f) => `${f} compared with normal`,
    noData: 'NASA has no measurement here',
  },
  ocean: {
    label: 'Ocean',
    instrument: 'harp',              // plucked, flowing
    hint: 'Warmer water plays higher, brighter notes. Land is silent.',
    legend: ['Cold water', '', 'Warm water'],
    words: v => (v < 5 ? 'Icy water' : v < 15 ? 'Cold water' : v < 22 ? 'Cool water' : v < 27 ? 'Warm water' : 'Very warm water'),
    detail: (v, f) => `Sea surface ${f}`,
    noData: 'Land, or no ocean data here',
    noDataWord: 'Land',
  },
  lightning: {
    label: 'Lightning',
    instrument: 'drum',              // more lightning, more drum hits
    hint: 'The more lightning NASA saw from space, the more drum hits you hear. Places too far north or south for the Space Station to see stay silent.',
    legend: ['No lightning', '', 'Lots of lightning'],
    words: v => (v < 0.02 ? 'Almost no lightning' : v < 0.15 ? 'A little lightning' : v < 0.4 ? 'Some lightning'
      : v < 0.7 ? 'Lots of lightning' : 'A lightning hotspot'),
    detail: v => `Lightning seen in ${Math.round(v * 100)}% of 10-day periods`,
    // The sensor on the ISS only sees between about 56°N and 56°S (see scripts/build-lightning.mjs).
    noData: 'The Space Station cannot see this far north or south',
    noDataWord: 'Not seen from the Space Station',
    // The record starts in March 2017 and ends in July 2023, so those two years miss part of the stormy seasons.
    partYears: { 2017: 'March to December only', 2023: 'January to July only' },
  },
};
