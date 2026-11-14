// AI-assisted (Anthropic Claude).
// Earth Jukebox AI helper (Cloudflare Worker). It keeps the Anthropic API key secret and does ONE job:
// understand what a person typed or said, and turn it into a lookup plan.
// It never produces climate numbers: the website reads every value from NASA's data itself.
//
//   POST /song  {text}      -> {moments: [{year, month, day, place, lat, lon, label}], note}   (month/day 0 = not given)
//   POST /ask   {question}  -> {kind, track, places: [{name, lat, lon}], years: [...], months: [...], reason}
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const MAX_INPUT = 600; // characters

const SONG_TOOL = {
  name: "make_song",
  description: "Return the moments (year + place) found in the person's story, in the order they happened.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      moments: {
        type: "array",
        description: "Up to 6 moments. Years 1880 to 2025 (or 2026 when a month up to October 2026 is given).",
        items: {
          type: "object",
          properties: {
            year: { type: "integer", description: "Year of the moment, 1880 to 2026" },
            month: { type: "integer", description: "Month 1-12 if the story gives one (for example a birthday), otherwise 0" },
            day: { type: "integer", description: "Day of the month 1-31 if the story gives a full date, otherwise 0" },
            place: { type: "string", description: "Town or city as the person named it, in English" },
            lat: { type: "number", description: "Approximate latitude of the place, degrees north" },
            lon: { type: "number", description: "Approximate longitude of the place, degrees east" },
            label: { type: "string", description: "Why it matters, 2 to 6 words, in English, from the person's own words" },
          },
          required: ["year", "month", "day", "place", "lat", "lon", "label"],
          additionalProperties: false,
        },
      },
      note: { type: "string", description: "One short sentence for the person, e.g. which moments were skipped and why. Empty if nothing to say." },
    },
    required: ["moments", "note"],
    additionalProperties: false,
  },
};

const ASK_TOOL = {
  name: "plan_lookup",
  description: "Say which NASA data Earth Jukebox should look up and play to answer the question.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["value", "compare_years", "compare_places", "trend", "unsupported"],
        description: "value: one place, one year. compare_years: one place, two years. compare_places: two places, one year. trend: how one place changed over all years. unsupported: the data cannot answer it.",
      },
      track: { type: "string", enum: ["temperature", "ocean", "lightning"], description: "temperature (surface temperature vs the 1951-1980 average, 1880-2025), ocean (sea surface temperature, June 2007), lightning (how often lightning was seen from the ISS, 2017-2023)" },
      places: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Place name in English" },
            local_name: { type: "string", description: "The same place name in the language and script of the question (for a Chinese question, in Chinese characters); the English name if the question is in English" },
            lat: { type: "number", description: "Approximate latitude, degrees north" },
            lon: { type: "number", description: "Approximate longitude, degrees east" },
          },
          required: ["name", "local_name", "lat", "lon"],
          additionalProperties: false,
        },
      },
      years: { type: "array", items: { type: "integer" }, description: "Years mentioned or implied; use 2025 for 'today' or 'now'" },
      months: { type: "array", items: { type: "integer" }, description: "Same length and order as years: the month 1-12 named for that year (e.g. 'March 2006', 'last month'), or 0 when no month is named" },
      reason: { type: "string", description: "One short sentence, only when kind is unsupported, saying what the person could ask instead, in the language of the question. Otherwise empty." },
    },
    required: ["kind", "track", "places", "years", "months", "reason"],
    additionalProperties: false,
  },
};

const SONG_SYSTEM = `You help people turn their life or family story into an "Earth song" in Earth Jukebox.
Find the moments in the story: each is a year (1880 to 2025) and a place. Give each place approximate coordinates.
If the story gives a month or a full date (like a birthday), fill month and day; otherwise use 0. NASA's monthly data goes up to October 2026.
Keep the person's meaning in a short English label. Use 2025 for "today" or "now".
Skip a moment if its year or place is not clear from the story, and say so in the note. Never invent people, places or years.
The story may be in any language. Always answer by calling make_song.`;

const ASK_SYSTEM = `You are the question reader for Earth Jukebox, a tool that plays NASA Earth data as sound.
Do not answer the question yourself and never state numbers. Only decide what to look up, by calling plan_lookup.
Available data: temperature anomaly at any place for each year 1880-2025, and for each month from January 1880 to October 2026 (track "temperature");
when the question names a month (or says "last month"), put it in months, in the same order as years; otherwise 0;
sea surface temperature in June 2007 (track "ocean"); how often lightning was seen from the ISS, 2017-2023 (track "lightning").
"Hotter/warmer/colder than when X happened" means compare_years for that place. "Has X warmed?" means trend.
If the question needs data Earth Jukebox does not have, use kind "unsupported" and suggest a question it can answer.
The question may be in any language. Always answer by calling plan_lookup.`;

function cors(origin, allowed) {
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function callTool(env, system, tool, text) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if a safety classifier declines, the API retries on Anthropic's recommended model
    output_config: { effort: "low" }, // short, simple extraction: keep it fast
    system,
    tools: [tool],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: text }],
  });
  if (response.stop_reason === "refusal") return { error: "The AI could not help with that request." };
  const call = response.content.find(b => b.type === "tool_use" && b.name === tool.name);
  if (!call) return { error: "The AI did not understand. Try saying it another way." };
  return { result: call.input };
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const headers = cors(request.headers.get("Origin") || "", allowed);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, headers);
    if (!allowed.includes(request.headers.get("Origin") || "")) return json({ error: "Not allowed." }, 403, headers);

    const path = new URL(request.url).pathname;
    let body;
    try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400, headers); }
    const text = String(body.text ?? body.question ?? "").trim().slice(0, MAX_INPUT);
    if (!text) return json({ error: "Type something first." }, 400, headers);

    try {
      const out = path === "/song" ? await callTool(env, SONG_SYSTEM, SONG_TOOL, text)
        : path === "/ask" ? await callTool(env, ASK_SYSTEM, ASK_TOOL, text)
          : { error: "Unknown path." };
      if (out.error) return json({ error: out.error }, 422, headers);
      return json(out.result, 200, headers);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "Too many people are asking right now. Try again in a minute." }, 429, headers);
      if (err instanceof Anthropic.AuthenticationError) return json({ error: "The AI helper is not set up yet." }, 503, headers);
      if (err instanceof Anthropic.APIError) return json({ error: "The AI helper had a problem. Try again." }, 502, headers);
      return json({ error: "The AI helper is unavailable." }, 502, headers);
    }
  },
};
