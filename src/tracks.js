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
    wordsZh: v => (v <= -1 ? '比正常冷很多' : v <= -0.3 ? '比正常冷' : v < 0.3 ? '差不多正常' : v < 1 ? '比正常暖' : v < 1.6 ? '比正常暖很多' : '非常暖'),
    detail: (v, f) => `${f} compared with normal`,
    noData: 'NASA has no measurement here',
  },
  ocean: {
    label: 'Ocean',
    instrument: 'harp',              // plucked, flowing
    hint: 'Warmer water plays higher, brighter notes. Land is silent.',
    legend: ['Cold water', '', 'Warm water'],
    words: v => (v < 5 ? 'Icy water' : v < 15 ? 'Cold water' : v < 22 ? 'Cool water' : v < 27 ? 'Warm water' : 'Very warm water'),
    wordsZh: v => (v < 5 ? '冰冷的海水' : v < 15 ? '冷的海水' : v < 22 ? '凉的海水' : v < 27 ? '暖的海水' : '很暖的海水'),
    noDataWordZh: '陆地',
    detail: (v, f) => `Sea surface ${f}`,
    noData: 'Land, or no ocean data here',
    noDataWord: 'Land',
  },
  combo: {
    label: 'All three',
    instrument: 'combo',             // marimba (temperature) + harp (nearest sea) + drums (lightning), all at once
    hint: 'Each place plays three sounds at once: how warm it was (marimba), how warm the nearest sea is (harp), and how often lightning strikes there (drums).',
    legend: ['Colder than normal', 'Normal', 'Hotter than normal'],
    words: v => KINDS.temperature.words(v),
    wordsZh: v => KINDS.temperature.wordsZh(v),
    detail: (v, f) => `${f} compared with normal`,
    noData: 'NASA has no temperature measurement here',
  },
  lightning: {
    label: 'Lightning',
    instrument: 'drum',              // more lightning, more drum hits
    hint: 'The more lightning NASA saw from space, the more drum hits you hear. Places too far north or south for the Space Station to see stay silent.',
    legend: ['No lightning', '', 'Lots of lightning'],
    words: v => (v < 0.02 ? 'Almost no lightning' : v < 0.15 ? 'A little lightning' : v < 0.4 ? 'Some lightning'
      : v < 0.7 ? 'Lots of lightning' : 'A lightning hotspot'),
    wordsZh: v => (v < 0.02 ? '几乎没有闪电' : v < 0.15 ? '一点闪电' : v < 0.4 ? '有些闪电' : v < 0.7 ? '很多闪电' : '闪电热点'),
    noDataWordZh: '太空站看不到这里',
    detail: v => `Lightning seen in ${Math.round(v * 100)}% of 10-day periods`,
    // The sensor on the ISS only sees between about 56°N and 56°S (see scripts/build-lightning.mjs).
    noData: 'The Space Station cannot see this far north or south',
    noDataWord: 'Not seen from the Space Station',
    // The record starts in March 2017 and ends in July 2023, so those two years miss part of the stormy seasons.
    partYears: { 2017: 'March to December only', 2023: 'January to July only' },
  },
};
