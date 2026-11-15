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
NASA's Earth Information Center (EIC) shows our planet changing in stunning visualizations: a globe that warms year by year, swirling ocean currents, lightning seen from the Space Station. But they can only be seen. For the 43 million people who are blind, they are silent.

Earth Jukebox lets everyone hear them. It reads the color key of each NASA map, so every spot on Earth gets a note: warmer places sing higher. Tap the globe like an instrument, or press Play to hear your town year by year from 1880 to 2025 and hear the notes climb. Each visualization has its own instrument: temperature on marimba, ocean on harp, lightning on drums. Fly one orbit with the Space Station and hear the Earth pass below. Ask the Earth a question, or turn your own story, like where and when you were born, into an Earth song you can share.

A voice guide in English or Chinese talks you through every step, and it works with screen readers and ordinary phones. Betty, a blind tester from Sibu, helped us shape it; she says the new guide makes it clearer to use.

Now NASA's Earth is something everyone can hear.
```
（198 字，1101 字元）

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
Earth Jukebox is a web app that pairs NASA Earth Information Center (EIC) visual frames with sound generated in real time in the browser: every note is computed from the colors of NASA's own map at the moment you tap or press Play, and nothing is pre-recorded. A short tour shows a first-time visitor what to do: tap the Earth (each place plays a note; warmer places play higher), then hear 145 years in 30 seconds. Visitors can:
- Tap a rotating 3D globe like an instrument, and drag to spin it.
- Choose an EIC visualization (a "track"): Global Temperature 1880–2025 (marimba), Ocean Currents and Temperature (harp), Lightning from the Space Station 2017–2023 (drums), or All three together.
- Press Play to hear one place through time: one note per year of temperature from 1880 to 2025 in about 30 seconds, or lightning month by month from 2017 to 2023. The year bar steps by month, so any single month since 1880 can be heard.
- Fly with the Space Station: one orbit like the ISS's (51.6°, about 93 minutes) passes over your place and plays every place below it in 15 seconds, then names the warmest place under it.
- Make "My Earth song": type or speak a family story in any language ("I was born in Kuching on 15 March 2006"). Each place and date, down to the month, becomes part of a song that can be shared as a link.
- Ask the Earth: ask a question by typing or speaking, in any language ("How warm was Kuching in March 2006?"). The globe turns, plays the answer as sound, and says it in plain words, in English or in Chinese.

HOW IT ANSWERS THE CHALLENGE
- Pair EIC visuals with sound made in real time: the picture is NASA's own frame, and every note is computed from its colors in the browser at the moment you tap. Nothing is pre-recorded.
- Let people choose a visualization: four tracks, each with its own instrument. Two of the three visualizations (SVS 3912 ocean, SVS 5011 lightning) are on the challenge's own resource list; the third is the EIC Climate Vital Signs temperature map.
- Turn what is in the image into music: color becomes a number and then pitch; how often lightning was seen becomes the number of drum hits; the kind of data chooses the instrument.
- Balance data and music: a pentatonic scale with fixed rules that the app explains to the listener.
- Make accessibility the core: a voice guide in two languages, screen-reader support, plain-word descriptions, a phone layout that can be learned by touch, and a test with a blind user.

HOW IT WORKS
1. Reading the legend. We sample the color bar on NASA's own image and build a color-to-number table. Each pixel is matched to the nearest legend color in CIELAB color space; gray "no data" areas, coastlines and labels do not match, so they play no note (only a soft tick that means "no data here") instead of a made-up number. For shaded imagery (ocean flow lines) we match by hue, ignoring light and shadow.
2. Checking the numbers. The equirectangular temperature video (SVS 5603) has no printed legend. We matched its colors to NASA's labelled map and compared each year's area-weighted average with GISTEMP's published global means; this showed the video uses −2 to +2 °C, not the ±4 °C of the labelled map. Values are stored on a 2° grid for every year. Accuracy check (scripts/validate.mjs, shown with a chart on the website): over all 146 years, the global average we read from the map's colors is on average 0.07 °C from NASA GISTEMP v4's published number (correlation 0.98), and the warming listeners hear from 1880–1899 to 2015–2024 is +1.26 °C against NASA's +1.21 °C. The gap is larger near the poles (about 0.35 °C), where the map's colors stop at ±2 °C; the app says "+2 °C or more" there.
3. Months. For single months we use NASA GISTEMP v4's monthly 2° grid directly (the numbers behind the same map). Its area-weighted global mean matches NASA's published monthly global means to 0.012 °C on average over 1,762 months. Lightning by month groups NASA's 10-day lightning frames by the month on their date label. To keep it light on a phone, the page downloads only what is asked for: one year of months at a time for temperature (about 190 KB), and for lightning only the months of the place being played, with HTTP range requests.
4. Turning numbers into music. Values map to a two-octave pentatonic scale so any sequence sounds musical; warmer values are also brighter, and above +1 °C a second voice joins. Left and right on the globe play in the left and right ear. In All three, each place plays its temperature on the marimba, the nearest sea's temperature on the harp, and its lightning on the drums. In "My Earth song", the main note is how warm the place was that year or month, the melody follows temperature around the place, the harp follows the nearest ocean's temperature, and the drums follow how often the Space Station saw lightning there.
5. The Space Station orbit. We compute one circular orbit with the ISS's inclination (51.64°) and period (92.9 minutes), let the Earth turn underneath it, and place it so it passes over the chosen place (or as close as it can get beyond 51.6° north or south).
6. Understanding people's words (AI). A small AI helper (Anthropic Claude, called through our own Cloudflare Worker so the key stays private) only turns a question or story into a lookup plan: which places, which dates, which NASA track. It never states numbers: Earth Jukebox reads every value from NASA's data and writes the answer itself, so the AI cannot make up climate facts. Without the AI, the story feature still works with a simple built-in reader.
7. Saying it out loud. Every spot and date is described in plain words ("much warmer than normal") and read aloud with the browser's speech engine and screen-reader live regions.

WHO IT IS FOR AND WHY IT MATTERS
NASA's EIC visualizations show how our planet is changing, but they are visual only. 43 million people are blind and 2.2 billion live with a vision impairment (Lancet Global Health 2021; WHO). Earth Jukebox lets people who are blind or have low vision explore NASA's maps independently, and gives everyone a second sense for climate data: you hear the Arctic sing higher than the tropics, and your own town climb from 1880 to 2025. Because it reads legends, the same method can turn many other EIC visualizations into tracks, not just these three.

ACCESSIBILITY
Tested with a blind user. Betty, who is totally blind and from Sibu, tried it on her own iPhone with VoiceOver while we guided her over a Zoom call (watch her 1-minute test: https://bep23020002-collab.github.io/earth-jukebox/about.html). She found and pressed buttons by ear, made an Earth song by speaking her story, and heard the Space Station's orbit as a tune that goes "up and down, like a ringtone". She rated it 3 to 4 out of 5 for ease and said, in Mandarin, "If you use it every day, once you understand it, it's easy." But at the start she didn't know what each button was for, and the voice was too fast for her.

What we changed because of her. We made the page explain itself:
- On a phone, a double tap starts the voice guide (the top half of the screen in English, the bottom half in Chinese), and the screen becomes a remote control that never moves, so it can be learned by touch: Where am I? in the middle, North above, South below, West left, East right. The main screen has only nine buttons; the rest sit on a second screen behind More.
- Nothing has to be found by sight. A two-finger tap anywhere opens the remote or repeats where everything is. The spoken tour runs every time for people using the voice guide, and someone who comes back gets it again with one tap anywhere.
- Every button says what it does before you press it, and after each press the guide suggests one thing you haven't tried yet.
- Slower and Faster set the speed of the voice, and the voice guide speaks English or Chinese, because many older people in Sibu speak Chinese, not English.
After these changes Betty tried the new version and told us that with the step-by-step guide it is clearer how to use it, and easier to use.

Also built in:
- The page talks from the first screen, and a short tour shows a first-time visitor what to do, one thing at a time. A Tutorial button replays it.
- With Voice guide on, the page reads whatever the mouse rests on or the Tab key lands on, and describes the score display in words. On a phone it works like a screen reader: tap anything to hear it, tap again to press it, or hold and slide a finger to hear everything under it. Sliding one finger over the Earth keeps playing notes, and resting says the place.
- Controls: a keypad with North, South, East, West, "Where am I?", year before and year after, so a blind person can use it on a phone, where there are no arrow keys, with or without VoiceOver or TalkBack.
- Full keyboard control (arrow keys travel, Enter reads the spot, Space plays history, I flies with the Space Station, number keys jump to places), screen-reader announcements, and Speak buttons for voice input.
- Plain-language descriptions with numbers shown second; a score display that draws every note, for people who are deaf or hard of hearing; a typeface designed for low-vision readers (Atkinson Hyperlegible).

CREATIVITY
Instead of one song for one image, Earth Jukebox is a real jukebox: it reads the legend, so EIC images become playable tracks, which you can hear alone or all three together. Playing the globe like an instrument, flying one orbit with the Space Station while the Earth below plays, and turning the month you were born into music make a climate chart a personal, musical experience.

TOOLS
HTML, CSS and JavaScript (no frameworks); Web Audio API for real-time synthesis; Web Speech API for speech output and voice input; Canvas for reading pixels and drawing the globe (our own orthographic renderer); Node.js and FFmpeg scripts to extract frames, read legends and read NASA's NetCDF data; GitHub Pages for hosting; a Cloudflare Worker that passes questions and stories to the Anthropic Claude API. Code is open (MIT license): https://github.com/bep23020002-collab/earth-jukebox

WHAT WE CONSIDERED
Scientific honesty (values come only from NASA's legend or NASA's numbers; places with no data play no note; the color range was checked against published data); musicality versus accuracy (pentatonic scale, but fixed rules explained to the user); first-time users (a step-by-step tour, a Tutorial button to replay it, and plain words); phones (small downloads, big buttons); privacy (no accounts, no tracking; only questions and stories leave the browser: speech is turned into text by the browser's own speech service, and the text goes to our AI helper).

LIMITATIONS
Values read from the colors of NASA's visualizations are close but not exact, and capped at the ends of each color scale; single months use NASA's numbers directly. The ocean track is one model snapshot (19 June 2007). The lightning track counts how often lightning was seen in 10-day windows, not how many strikes there were; the Space Station's sensor only sees between about 56°N and 56°S, so places farther north or south stay silent, and month-by-month lightning is noisy because the station passes over each place only a few times a month. The Space Station orbit is one model orbit with the ISS's inclination and period, placed over your place, not the station's live position. Ask the Earth needs the AI helper and an internet connection. We have tested with one blind user so far; more testing with blind and low-vision people is the next step.
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
We used AI chatbots (OpenAI Codex and Anthropic Claude) before the hackathon to understand the challenge and to brainstorm. The core idea of reading a visualization's color legend so that any NASA map can be played was suggested by an AI assistant during that brainstorming; our team chose it and decided the direction, features and design during the hackathon. During the hackathon, an AI coding assistant (Anthropic Claude) wrote most of the code under our direction, helped analyze the color scale of the NASA video, and drafted English text, including this submission, which we reviewed and edited. No code was written before the official start (first commit: 14 Nov 2026, 09:07, UTC+8). Inside the app, AI (Anthropic Claude, through our Cloudflare Worker) is used only to understand a typed or spoken question or story and turn it into places and years to look up; it never produces numbers, and all sound and every value come from fixed, explained rules applied to NASA data. The page labels this: "AI only reads your question. Every number comes from NASA data." Files with AI-assisted code say so in a header comment, and commits list the AI assistant as co-author. No images, video or audio in the project were generated by AI; spoken lines in the app and the demo video use the device's built-in text-to-speech voice.
```

## NASA Data（Link Text / Link Url，一行一个，按 Add New Link）
| Link Text | Link Url |
|---|---|
| Global Temperature Anomalies from 1880 to 2025 (NASA SVS 5603; EIC Climate Vital Signs dashboard, updated version) | https://svs.gsfc.nasa.gov/5603/ |
| Global Temperature Anomalies from 1880 to 2023 (NASA SVS 5207, the version shown in the EIC Climate Vital Signs Dashboard) | https://svs.gsfc.nasa.gov/5207/ |
| Global Sea Surface Currents and Temperature (NASA SVS 3912, EIC) | https://svs.gsfc.nasa.gov/3912/ |
| Lightning Events Detected from the ISS 2017–2023 (NASA SVS 5011, EIC) | https://svs.gsfc.nasa.gov/5011/ |
| Earth Information Center Content Database (NASA SVS) | https://svs.gsfc.nasa.gov/gallery/earth-information-center/ |
| GISTEMP v4 (NASA GISS): published global means, used to check the map colors, and the monthly 2° grid, used for single months | https://data.giss.nasa.gov/gistemp/ |
| International Space Station Facts and Figures (NASA), used for the orbit | https://www.nasa.gov/international-space-station/space-station-facts-and-figures/ |
| ISS photo iss072e030147, airglow over Earth (NASA Image and Video Library), page background | https://images.nasa.gov/details/iss072e030147 |

## Space Agency Partner & Other Data
| Link Text | Link Url |
|---|---|
| Project source code (GitHub, MIT license) | https://github.com/bep23020002-collab/earth-jukebox |
| The Lancet Global Health (2021), GBD 2019 Blindness and Vision Impairment Collaborators: 43.3 million people were blind in 2020 | https://pubmed.ncbi.nlm.nih.gov/33275950/ |
| World Health Organization, Blindness and vision impairment fact sheet: at least 2.2 billion people have a vision impairment | https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment |
| Atkinson Hyperlegible Next typeface (Braille Institute, SIL Open Font License) | https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next |
| Web Audio API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API |
| Web Speech API (MDN), speech output and voice input | https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API |
| FFmpeg, used to extract video frames | https://ffmpeg.org/ |
| Node.js, used for data-processing scripts | https://nodejs.org/ |
| Anthropic Claude, AI coding assistant | https://www.anthropic.com/claude |
| OpenAI Codex, used for brainstorming before the hackathon | https://openai.com/codex/ |
| frontend-design skill (Anthropic), design guidance | https://github.com/anthropics/skills |
| web-design-engineer skill, "dieter-rams-braun" style recipe (ConardLi/garden-skills, MIT license), visual design | https://github.com/ConardLi/garden-skills |
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
