# References

## NASA data
- Global Temperature Anomalies from 1880 to 2025, NASA Scientific Visualization Studio, https://svs.gsfc.nasa.gov/5603/ (data: Robert B. Schmunk, NASA/GSFC GISS; GISTEMP). The SVS page is tagged "Earth Information Center"; it is the 2025 update of Global Temperature Anomalies from 1880 to 2023, https://svs.gsfc.nasa.gov/5207/, which appears in the EIC Climate Vital Signs Dashboard.
- Global Sea Surface Currents and Temperature, NASA Scientific Visualization Studio, https://svs.gsfc.nasa.gov/3912/ (ECCO2 ocean model, MIT/JPL). Frame flat_global_ecco2_2028x1024.25000.jpg (19 June 2007) and color bar sst_ecco2_cbar.png (0 to 32 °C). Listed in the challenge's Resources tab.
- Lightning Events Detected from the International Space Station (ISS) 2017-2023, NASA Scientific Visualization Studio, https://svs.gsfc.nasa.gov/5011/ (Lightning Imaging Sensor on the ISS). Movie iss_lightning_sos_yearly_07312023_2048p60.mp4 and labels.txt. The label file reads "2003" after "31 Dec 2022"; we read it as 2023, matching the movie's July 2023 end. The sensor only sees between about 56°N and 56°S; places outside that band are stored as "no data". Listed in the challenge's Resources tab.

- GISTEMP v4 monthly temperature anomalies, NASA GISS, gistemp1200_GHCNv4_ERSSTv5.nc (2° grid, 1200 km smoothing, January 1880 to October 2026), https://data.giss.nasa.gov/gistemp/ . The analysis behind SVS 5603; used for moments and questions that name a month, and for playing a place month by month (scripts/build-monthly.mjs, assets/temperature/monthly/).

- Lightning by month: the same SVS 5011 movie frames, grouped by the month in their date label (scripts/build-lightning-monthly.mjs, assets/lightning/monthly/).

## Background image
- "The atmospheric glow blankets Earth beneath a sparkling field of stars", photographed from the International Space Station on 7 Oct 2024 over the Pacific Ocean. NASA image iss072e030147, NASA Image and Video Library, https://images.nasa.gov/details/iss072e030147. We use a cropped strip showing only the airglow and stars (no spacecraft hardware or insignia).

## Facts quoted on the website ("Why we built it")
- 43.3 million people were blind in 2020: GBD 2019 Blindness and Vision Impairment Collaborators, "Trends in prevalence of blindness and distance and near vision impairment over 30 years", The Lancet Global Health 9(2), e130–e143, 2021. https://pubmed.ncbi.nlm.nih.gov/33275950/
- At least 2.2 billion people have a near or distance vision impairment: World Health Organization, Blindness and vision impairment fact sheet. https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment

## User test
- Test with Betty, who is totally blind, on her own iPhone with VoiceOver, guided over a Zoom call on 15 November 2026. Video, subtitles and transcript: assets/video/ (shown on about.html). Recorded and published with her consent; the English translation of her Mandarin was made with AI help (Anthropic Claude) and checked against the recording.

## Style
- Visual design follows the "dieter-rams-braun" style recipe of the web-design-engineer skill (ConardLi/garden-skills, MIT license).

## Software and services
- Anthropic Claude API (model claude-opus-5-5): understands typed or spoken questions and stories in the app (worker/src/index.js). It returns places and years only; all values come from NASA data.
- Cloudflare Workers: hosts the AI helper so the API key is never sent to the browser.
- Web Audio API, Web Speech API (speech output and speech recognition), Canvas 2D.
- FFmpeg and Node.js (data-processing scripts), @napi-rs/canvas (demo video rendering).
- Atkinson Hyperlegible Next typeface (Braille Institute, SIL Open Font License), via Google Fonts.
