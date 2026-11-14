'use strict';
// Premium text-to-speech for the announcer.
//   ELEVENLABS_API_KEY  -> ElevenLabs (best: most expressive "arena announcer" delivery)
//   OPENAI_API_KEY      -> OpenAI gpt-4o-mini-tts (voice steered by instructions)
//   neither             -> the projector browser's built-in voice (free, less dramatic)
// Audio is synthesised as soon as a line is written, so it's usually ready
// before the display asks for it. Only server-written lines can be spoken,
// so nobody can use the public display to spend your TTS credits.

const crypto = require('crypto');

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const ELEVEN_BASE = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
// "Adam": deep, broadcast-style. Swap for any voice ID from your ElevenLabs Voice Library.
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
// Try the most expressive model first (understands [shouting]/[excited] tags);
// if the account can't use it, fall back automatically and stop retrying it.
let elevenModels = process.env.ELEVENLABS_MODEL ? [process.env.ELEVENLABS_MODEL] : ['eleven_v3', 'eleven_multilingual_v2'];
const TAG_MODELS = /v3/;
const stripTags = (t) => t.replace(/\[[^\]]{1,30}\]\s*/g, '').replace(/\s+/g, ' ').trim();
const OPENAI_VOICE = process.env.OPENAI_TTS_VOICE || 'ash';
const OPENAI_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';

const PROVIDER = (process.env.TTS_PROVIDER || (ELEVEN_KEY ? 'elevenlabs' : OPENAI_KEY ? 'openai' : 'browser')).toLowerCase();

const OPENAI_INSTRUCTIONS = {
  hype: 'You are a legendary boxing-ring and arena announcer. Deep, booming, theatrical. Stretch the big words, build slowly then ROAR the climax, punch every team name like a title fight introduction.',
  rumble: 'You are a legendary prize-fight ring announcer hyping a packed arena. Start low and rumbling, draw out every vowel, build to an explosive roar on the final words.',
  winner: 'You are a legendary game-show host revealing the grand champion. Enormous excitement, triumphant, roaring the team name.',
  suspense: 'You are a game-show host building suspense before a reveal. Slow, low, dramatic pauses, hushed intensity.',
  ouch: 'You are a cheeky game-show announcer reacting to a team losing points. Playful mock sympathy, comedic timing.',
  intro: 'You are a legendary arena ring announcer introducing fighters. Booming, drawn-out names, huge build.',
  default: 'You are an energetic, charismatic game-show announcer on live TV. Upbeat, punchy, crisp diction, big smile in the voice.',
};

// Spoken spellings for names the voice gets wrong, e.g. { "Samer": "Saah-mare" }
let pronounceMap = [];
function setPronunciations(map) {
  pronounceMap = Object.entries(map || {}).map(([word, say]) => [new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), say]);
}
function pronounce(text) {
  return pronounceMap.reduce((t, [re, say]) => t.replace(re, say), text);
}

const cache = new Map(); // id -> { text, mood, audio: Promise<{buf,type}|null> }

async function elevenOnce(model, text, mood) {
  const calm = mood === 'suspense';
  const v3 = TAG_MODELS.test(model);
  const res = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(ELEVEN_VOICE)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: v3 ? text : stripTags(text),
      model_id: model,
      // v3: lowest stability = most theatrical. Older models: low stability, high style.
      voice_settings: v3
        ? { stability: calm ? 0.5 : 0.0 }
        : { stability: calm ? 0.5 : 0.22, similarity_boost: 0.8, style: calm ? 0.4 : 0.9, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const err = new Error(`ElevenLabs ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'audio/mpeg' };
}

async function elevenlabs(text, mood) {
  let lastErr;
  for (const model of [...elevenModels]) {
    try {
      return await elevenOnce(model, text, mood);
    } catch (err) {
      lastErr = err;
      // 4xx on a model we're trying speculatively: drop it for the rest of the night
      if (elevenModels.length > 1 && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
        console.warn(`[tts] ${model} not available on this account (${err.message.slice(0, 120)}). Falling back.`);
        elevenModels = elevenModels.filter((m) => m !== model);
      } else if (err.status === 401 || err.status === 429) {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function openai(text, mood) {
  const res = await fetch(`${OPENAI_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      voice: OPENAI_VOICE,
      input: stripTags(text),
      instructions: OPENAI_INSTRUCTIONS[mood] || OPENAI_INSTRUCTIONS.default,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'audio/mpeg' };
}

function synth(text, mood) {
  if (PROVIDER === 'elevenlabs' && ELEVEN_KEY) return elevenlabs(text, mood);
  if (PROVIDER === 'openai' && OPENAI_KEY) return openai(text, mood);
  return Promise.resolve(null);
}

// Register a line and start synthesising it right away. Returns its id.
function register(text, mood = 'default') {
  const id = crypto.randomBytes(9).toString('base64url');
  const spoken = pronounce(text);
  const entry = { text: spoken, mood, audio: null };
  if (mode() !== 'browser') {
    const t0 = Date.now();
    entry.audio = synth(spoken, mood)
      .then((a) => {
        if (a) console.log(`[tts] ${PROVIDER} ${a.buf.length}B in ${Date.now() - t0}ms`);
        return a;
      })
      .catch((err) => {
        console.warn('[tts] failed, display will use its built-in voice:', err.message);
        return null;
      });
  }
  cache.set(id, entry);
  while (cache.size > 200) cache.delete(cache.keys().next().value);
  return id;
}

async function get(id) {
  const entry = cache.get(id);
  if (!entry || !entry.audio) return null;
  return entry.audio;
}

function mode() {
  if (PROVIDER === 'elevenlabs' && ELEVEN_KEY) return 'server';
  if (PROVIDER === 'openai' && OPENAI_KEY) return 'server';
  return 'browser';
}

function describe() {
  return mode() === 'server' ? `${PROVIDER} (${PROVIDER === 'elevenlabs' ? elevenModels.join(' → ') : OPENAI_MODEL + '/' + OPENAI_VOICE})` : "projector browser's built-in voice";
}

module.exports = { register, get, mode, describe, stripTags, pronounce, setPronunciations };
