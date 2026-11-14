<!-- AI-assisted (Anthropic Claude): drafted by an AI assistant from the team's project; the team reviews and edits before submitting. -->
# 提交表格的英文内容（复制贴上用）

每个栏位依照表格顺序排列。方括号 **[ ]** 里的内容要等试用、视频完成后再补，**提交前一定要改掉或删掉**。

---

## Project Name
```
Earth Jukebox: Hear Our Changing Planet
```

## Summary（50–200 words，上限 1500 字元）
```
Earth Jukebox turns NASA Earth Information Center (EIC) visualizations into sound, so anyone can explore our changing planet by ear, including people who are blind or have low vision.

Our app reads the color legend printed on a NASA map, so every color becomes a real number, and every spot on Earth gets a note: warmer places sing higher. You can tap a 3D globe like an instrument, draw a line across it to make a tune, then hear the same tune in 1880 and again in 2025. Your ears tell you the planet has warmed. Each EIC visualization is a track with its own instrument: temperature plays a marimba, ocean temperature plays a harp, and lightning seen from the Space Station plays drums. "My Earth song" turns years and places that matter to you, like the town where you were born, into a short song you can share. Everything works with a keyboard and is read aloud, and any NASA picture with a color bar can be loaded and explored.

NASA's maps are beautiful but visual only. Earth Jukebox makes them something everyone can hear.
```
（约 180 字）

## Project Demonstration（30 秒以内的视频，公开链接）
```
[等视频剪好，上传 YouTube 设成 Unlisted 或 Public，把完整网址贴这里，例如 https://youtu.be/xxxx]
```
贴之前用无痕视窗打开一次，确认不用登录就能看。

## Project（作品公开链接）
```
https://bep23020002-collab.github.io/earth-jukebox/
```

## Project Details
直接贴进编辑框，标题可以用编辑器的粗体。

```
WHAT IT DOES
Earth Jukebox is a web app that pairs NASA Earth Information Center (EIC) visual frames with sound generated in real time in the browser. A first-time visitor is guided in three steps: tap the globe (each place plays a note; warmer places play higher), hear the same tune in 1880, then hear it in 2025. Visitors can:
- Tap or draw on a rotating 3D globe; the line you draw becomes your tune.
- Choose an EIC visualization (a "track"): Global Temperature 1880–2025, Ocean Currents and Temperature, and Lightning from the Space Station 2017–2023. Each track has its own instrument.
- Play 146 years of temperature at any place as a 20-second melody.
- Make "My Earth song": pick years and places that matter to them; each becomes two bars of music, and the song can be shared as a link.
- Ask the Earth: ask a question by typing or speaking, in any language ("Is Sibu warmer now than in 1960?"). The globe turns, plays the answer as sound, and says it in plain words.
- Tell a family story in one or two sentences, in any language, and it becomes an Earth song.

HOW IT WORKS
1. Reading the legend. We sample the color bar on NASA's own image and build a color-to-number table. Each pixel is matched to the nearest legend color in CIELAB color space; gray "no data" areas, coastlines and labels do not match and stay silent instead of producing made-up numbers. For shaded imagery (ocean flow lines) we match by hue, ignoring light and shadow.
2. Checking the numbers. The equirectangular temperature video (SVS 5603) has no printed legend. We matched its colors to NASA's labelled map and compared each year's area-weighted average with GISTEMP's published global means; this showed the video uses −2 to +2 °C, not the ±4 °C of the labelled map. Values are stored on a 2° grid for every year. Accuracy check (scripts/validate.mjs, shown with a chart on the website): over all 146 years, the global average we read from the map's colors is on average 0.07 °C from NASA GISTEMP v4's published number (correlation 0.98), and the warming listeners hear from 1880–1899 to 2015–2024 is +1.26 °C against NASA's +1.21 °C. The gap is larger near the poles (about 0.35 °C), where the map's colors stop at ±2 °C; the app says "+2 °C or more" there.
3. Turning numbers into music. Values map to a two-octave pentatonic scale so any sequence sounds musical; warmer values are also brighter, and above +1 °C a second voice joins. Left and right on the globe play in the left and right ear. In "My Earth song", the main note is how warm the place was that year, the melody follows temperature around the place, the harp follows the nearest ocean's temperature, and the drums follow how often the Space Station saw lightning there.
4. Understanding people's words (AI). A small AI helper (Anthropic Claude, called through our own Cloudflare Worker so the key stays private) only turns a question or story into a lookup plan: which places, which years, which NASA track. It never states numbers: Earth Jukebox reads every value from NASA's data and writes the answer itself, so the AI cannot make up climate facts. Without the AI, the story feature still works with a simple built-in reader.
5. Saying it out loud. Every spot and year is described in plain words ("much warmer than normal") and read aloud with the browser's speech engine and screen-reader live regions.

WHO IT IS FOR AND WHY IT MATTERS
NASA's EIC visualizations show how our planet is changing, but they are visual only. Earth Jukebox lets people who are blind or have low vision explore them independently, and gives everyone a second sense for climate data: you hear the Arctic sing higher than the tropics, and your own tune climb from 1880 to 2025. Because it reads legends, the same method works for many other EIC visualizations, not just one.

ACCESSIBILITY
Full keyboard control (arrow keys travel, Enter reads the spot, Space plays history, number keys jump to places); speech output and screen-reader announcements; plain-language descriptions with numbers shown second; a typeface designed for low-vision readers (Atkinson Hyperlegible); works on phones with touch (one finger plays, two fingers spin). [We tested Earth Jukebox with N people who are blind or have low vision from the Sarawak Society for the Blind, Sibu branch: X of N identified the warmer place by sound alone, and X of N heard that their town had warmed since 1880. Their feedback led us to … ]

CREATIVITY
Instead of one song for one image, Earth Jukebox is a real jukebox: it reads the legend, so EIC images become playable tracks. Playing the globe like an instrument, drawing a line that becomes a melody, and hearing "your" tune in two different years turn a climate chart into a personal, musical experience.

TOOLS
HTML, CSS and JavaScript (no frameworks); Web Audio API for real-time synthesis; Web Speech API for speech; Canvas for reading pixels and drawing the globe (our own orthographic renderer); Node.js and FFmpeg scripts to extract frames and read legends; GitHub Pages for hosting. Code is open: https://github.com/bep23020002-collab/earth-jukebox

WHAT WE CONSIDERED
Scientific honesty (values come only from NASA's legend; no-data stays silent; the color range was checked against published data); musicality versus accuracy (pentatonic scale, but fixed rules explained to the user); first-time users (a three-step guide and plain words); privacy (no accounts, no tracking, nothing leaves the browser).

LIMITATIONS
Values are read from the colors of NASA's visualizations, so they are close but not exact, and capped at the ends of each color scale. The ocean track is one model snapshot (19 June 2007). The lightning track counts how often lightning was seen in 10-day windows, not how many strikes there were, and the Space Station's sensor only sees between about 56°N and 56°S, so places farther north or south stay silent. "Use any NASA map" needs a sighted helper to mark the color bar once.
```

## Use of Super Intelligence (SI)
**勾选项（照实勾）：**
- ✅ Ideation or Brainstorming
- ✅ Research or Information Gathering
- ✅ Data Analysis and Interpretation
- ✅ Building SI/ML Into the Project（Ask the Earth 和故事功能用 AI 理解文字）
- ✅ Coding, Debugging, or Troubleshooting
- ✅ Writing, Editing, or Translation

**说明文字：**
```
We used AI chatbots (OpenAI Codex and Anthropic Claude) before the hackathon to understand the challenge and to brainstorm. The core idea of reading a visualization's color legend so that any NASA map can be played was suggested by an AI assistant during that brainstorming; our team chose it and decided the direction, features and design during the hackathon. During the hackathon, an AI coding assistant (Anthropic Claude) wrote most of the code under our direction, helped analyze the color scale of the NASA video, and drafted English text, including this submission, which we reviewed and edited. No code was written before the official start (first commit: 14 Nov 2026, 09:07, UTC+8). Inside the app, AI (Anthropic Claude, through our Cloudflare Worker) is used only to understand a typed or spoken question or story and turn it into places and years to look up; it never produces numbers, and all sound and every value come from fixed, explained rules applied to NASA data. The page labels this: "AI only reads your question. Every number comes from NASA data." Files with AI-assisted code say so in a header comment, and commits list the AI assistant as co-author. No images, video or audio in the project were generated by AI.
```

## NASA Data（Link Text / Link Url，一行一个，按 Add New Link）
| Link Text | Link Url |
|---|---|
| Global Temperature Anomalies from 1880 to 2025 (NASA SVS 5603; EIC Climate Vital Signs dashboard, updated version) | https://svs.gsfc.nasa.gov/5603/ |
| Global Temperature Anomalies from 1880 to 2023 (NASA SVS 5207, the version shown in the EIC Climate Vital Signs Dashboard) | https://svs.gsfc.nasa.gov/5207/ |
| Global Sea Surface Currents and Temperature (NASA SVS 3912, EIC) | https://svs.gsfc.nasa.gov/3912/ |
| Lightning Events Detected from the ISS 2017–2023 (NASA SVS 5011, EIC) | https://svs.gsfc.nasa.gov/5011/ |
| Earth Information Center Content Database (NASA SVS) | https://svs.gsfc.nasa.gov/gallery/earth-information-center/ |
| GISTEMP v4 global mean temperatures (NASA GISS), used to check the color range | https://data.giss.nasa.gov/gistemp/ |
| ISS photo iss072e030147, airglow over Earth (NASA Image and Video Library), page background | https://images.nasa.gov/details/iss072e030147 |

## Space Agency Partner & Other Data
| Link Text | Link Url |
|---|---|
| Project source code (GitHub) | https://github.com/bep23020002-collab/earth-jukebox |
| Atkinson Hyperlegible Next typeface (Braille Institute, SIL Open Font License) | https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next |
| Web Audio API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API |
| Web Speech API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API |
| FFmpeg, used to extract video frames | https://ffmpeg.org/ |
| Node.js, used for data-processing scripts | https://nodejs.org/ |
| Anthropic Claude, AI coding assistant | https://www.anthropic.com/claude |
| OpenAI Codex, used for brainstorming before the hackathon | https://openai.com/codex/ |
| frontend-design skill (Anthropic), design guidance | https://github.com/anthropics/skills |
| GitHub Pages, hosting | https://pages.github.com/ |
| Anthropic Claude API, used in the app to understand questions and stories | https://www.anthropic.com/api |
| Cloudflare Workers, hosts the small AI helper that keeps the API key private | https://workers.cloudflare.com/ |

---

## 提交前检查
- [ ] 方括号 [ ] 都已经补好或删掉
- [ ] 视频 ≤ 30 秒、有英文字幕、没有未满 18 岁的人、链接不用登录就能看
- [ ] 试用结果照实写人数，只引用对方同意公开的话
- [ ] 勾选两个声明框（已读规则；原创且所有外部资源都已列出）
- [ ] 按 **Submit for Judging**，截止 11/15 23:59（诗巫时间）
