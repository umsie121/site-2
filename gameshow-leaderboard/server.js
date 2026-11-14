'use strict';
// Games Night live leaderboard server. Zero dependencies: Node 18+ only.
//   GET  /             projector display
//   GET  /admin        phone/laptop control panel (PIN protected)
//   GET  /events       Server-Sent Events stream for live updates
//   POST /sms          SMS webhook (Twilio, or any provider posting From/Body or JSON)
//   POST /api/command  admin panel commands  { pin, text }

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseMessage, HELP, MUSIC_TRACKS } = require('./commands');
const tts = require('./tts');
const { createAnnouncer } = require('./announcer');
const { createHostBot } = require('./hostbot');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PIN = process.env.ADMIN_PIN || '2580';
const ALLOWED_NUMBERS = (process.env.ALLOWED_NUMBERS || '')
  .split(',')
  .map((n) => n.replace(/[^\d+]/g, ''))
  .filter(Boolean);
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const SMS_SECRET = process.env.SMS_SECRET || ''; // for non-Twilio providers: ?key=SECRET
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'teams.json'), 'utf8'));

// ---------------------------------------------------------------- state
function freshState() {
  return {
    title: config.title,
    subtitle: config.subtitle,
    round: 'ROUND 1',
    game: '',
    voice: true,
    timer: null, // { endsAt, total }
    streak: null, // { team, count }
    teams: config.teams.map((t) => ({ ...t, score: 0 })),
    feed: [], // recent events for the ticker
    undo: [], // snapshots of scores/names before each change
    seq: 0,
  };
}

let state = freshState();
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  // keep saved scores/names but always take members/colors from teams.json
  state = { ...state, ...saved };
  state.teams = config.teams.map((t) => {
    const s = (saved.teams || []).find((x) => x.id === t.id) || {};
    return { ...t, name: s.name || t.name, score: Number(s.score) || 0 };
  });
  state.timer = null;
  console.log('Loaded saved scores from', STATE_FILE);
} catch (_) {
  /* first run */
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }, 150);
}

function publicState() {
  const { undo, ...rest } = state;
  return { ...rest, now: Date.now() };
}

// ---------------------------------------------------------------- timer
let timerHandle = null;
function startTimer(seconds) {
  clearTimeout(timerHandle);
  if (!seconds) {
    state.timer = null;
    return;
  }
  state.timer = { endsAt: Date.now() + seconds * 1000, total: seconds };
  timerHandle = setTimeout(() => {
    state.timer = null;
    save();
    broadcast({ events: [{ kind: 'timeup' }], source: 'timer' });
    announcer.timeUp();
  }, seconds * 1000);
}

function ranking() {
  return [...state.teams].sort((a, b) => b.score - a.score);
}

function leaderId() {
  const r = ranking();
  if (r.length < 2 || r[0].score === r[1].score) return null; // tie = no leader
  return r[0].id;
}

function snapshot() {
  state.undo.push({
    round: state.round,
    game: state.game,
    teams: state.teams.map((t) => ({ id: t.id, score: t.score, name: t.name })),
  });
  if (state.undo.length > 100) state.undo.shift();
}

function addFeed(text, color) {
  state.feed.unshift({ id: ++state.seq, ts: Date.now(), text, color });
  state.feed = state.feed.slice(0, 20);
}

function teamById(id) {
  return state.teams.find((t) => t.id === id);
}

function standingsText() {
  return ranking()
    .map((t, i) => `${i + 1}. ${t.name}: ${t.score}`)
    .join('\n');
}

// --------------------------------------------------------------- SSE hub
const clients = new Set();
function broadcast(event) {
  const payload = `data: ${JSON.stringify({ state: publicState(), event })}\n\n`;
  for (const res of clients) res.write(payload);
}
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000);

const announcer = createAnnouncer({ getState: () => state, broadcast });
const hostbot = createHostBot({ getState: () => state });

// Plain English or exact commands. Exact commands run instantly; anything
// else is translated by Claude into commands (when ANTHROPIC_API_KEY is set).
async function handleChat(text, source) {
  text = String(text || '').trim();
  if (!text) return { reply: 'Say something!', commands: [] };
  const parsed = parseMessage(text, state.teams);
  if (parsed.length && parsed.every((a) => !a.error)) {
    return { reply: runText(text, source), commands: [text] };
  }
  if (!hostbot.available) {
    return { reply: parsed.find((a) => a.error).error + '\n(Add ANTHROPIC_API_KEY to use plain English.)', commands: [] };
  }
  let out;
  try {
    out = await hostbot.translate(text);
  } catch (err) {
    console.warn('[hostbot]', err.message);
    return { reply: "Couldn't reach the AI just now. Try a direct command like A +10.", commands: [] };
  }
  console.log(`[hostbot] ${JSON.stringify(text)} → ${JSON.stringify(out.commands)}`);
  const results = out.commands.map((c) => runText(c, source)).filter((r) => r && r !== 'OK');
  return { reply: [out.reply, ...results].filter(Boolean).join('\n'), commands: out.commands };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// ---------------------------------------------------------- run commands
function runText(text, source) {
  const actions = parseMessage(text, state.teams);
  const replies = [];
  const events = [];
  const before = leaderId();
  const scoresBefore = state.teams.map((t) => ({ id: t.id, score: t.score }));
  let undidScore = false;

  for (const a of actions) {
    if (a.error) {
      replies.push(a.error);
      continue;
    }
    switch (a.type) {
      case 'help':
        replies.push(HELP);
        break;
      case 'scores':
        replies.push(standingsText());
        break;
      case 'score': {
        snapshot();
        const t = teamById(a.team);
        t.score += a.delta;
        const sign = a.delta > 0 ? '+' : '';
        const who = a.player ? ` (${a.player})` : '';
        if (a.delta > 0) {
          state.streak = state.streak && state.streak.team === t.id ? { team: t.id, count: state.streak.count + 1 } : { team: t.id, count: 1 };
          if (state.streak.count === 3 || state.streak.count === 5 || state.streak.count === 8) events.push({ kind: 'streak', team: t.id, count: state.streak.count });
        }
        addFeed(`${t.name}${who} ${sign}${a.delta}`, t.color);
        events.push({ kind: 'score', team: t.id, delta: a.delta, player: a.player });
        replies.push(`${t.name}${who} ${sign}${a.delta} → ${t.score}`);
        break;
      }
      case 'set': {
        snapshot();
        const t = teamById(a.team);
        const delta = a.value - t.score;
        t.score = a.value;
        addFeed(`${t.name} set to ${a.value}`, t.color);
        events.push({ kind: 'score', team: t.id, delta, set: true });
        replies.push(`${t.name} set to ${t.score}`);
        break;
      }
      case 'undo': {
        const snap = state.undo.pop();
        if (!snap) {
          replies.push('Nothing to undo');
          break;
        }
        state.round = snap.round;
        state.game = snap.game ?? state.game;
        for (const s of snap.teams) {
          const t = teamById(s.id);
          if (t.score !== s.score) undidScore = true;
          Object.assign(t, { score: s.score, name: s.name });
        }
        addFeed('Last change undone', '#ffffff');
        events.push({ kind: 'undo' });
        replies.push('Undone.\n' + standingsText());
        break;
      }
      case 'rename': {
        snapshot();
        const t = teamById(a.team);
        const old = t.name;
        t.name = a.name;
        addFeed(`${old} is now ${a.name}`, t.color);
        events.push({ kind: 'rename', team: t.id });
        announcer.rename(old, a.name, t.id);
        replies.push(`Renamed to ${a.name}`);
        break;
      }
      case 'round':
        snapshot();
        state.round = a.text.toUpperCase();
        addFeed(state.round + ' begins', '#ffffff');
        events.push({ kind: 'round', text: state.round });
        announcer.round(state.round);
        replies.push(`Now showing: ${state.round}`);
        break;
      case 'message':
        events.push({ kind: 'message', text: a.text });
        announcer.message(a.text);
        replies.push('On screen: ' + a.text);
        break;
      case 'say':
        announcer.say(a.text);
        replies.push('Announcer: ' + a.text);
        break;
      case 'game':
        snapshot();
        state.game = a.text.toUpperCase();
        addFeed(`Now playing: ${state.game}`, '#ffffff');
        events.push({ kind: 'game', text: state.game });
        announcer.game(a.text);
        replies.push(`Now playing: ${state.game}`);
        break;
      case 'intro':
        events.push({ kind: 'intro' });
        announcer.intro();
        replies.push('Rolling the team introductions!');
        break;
      case 'timer':
        startTimer(a.seconds);
        events.push({ kind: 'timer', timer: state.timer });
        if (a.seconds) announcer.timerStart(a.seconds);
        replies.push(a.seconds ? `Timer started: ${a.seconds >= 60 ? Math.floor(a.seconds / 60) + 'm ' + (a.seconds % 60 ? (a.seconds % 60) + 's' : '') : a.seconds + 's'}`.trim() : 'Timer stopped');
        break;
      case 'recap':
        announcer.recap();
        replies.push('Announcer is recapping the standings\n' + standingsText());
        break;
      case 'voice':
        state.voice = a.on;
        events.push({ kind: 'voice', on: a.on });
        replies.push(`Announcer ${a.on ? 'on' : 'off'}`);
        break;
      case 'winner': {
        const lead = leaderId();
        events.push({ kind: 'winner', team: lead });
        announcer.winner();
        replies.push(lead ? `Crowning ${teamById(lead).name}!` : 'It is a tie at the top! Showing finale anyway.');
        break;
      }
      case 'clear':
        events.push({ kind: 'clear' });
        replies.push('Screen cleared');
        break;
      case 'music':
        events.push({ kind: 'music', on: a.on, track: a.track || null });
        replies.push(a.track ? (a.track === 'next' ? 'Skipping to the next track' : `Now playing: ${MUSIC_TRACKS[a.track]}`) : `Music ${a.on ? 'on' : 'off'}`);
        break;
      case 'reset':
        snapshot();
        for (const t of state.teams) t.score = 0;
        state.round = 'ROUND 1';
        state.game = '';
        state.streak = null;
        startTimer(0);
        state.feed = [];
        addFeed('Scores reset', '#ffffff');
        events.push({ kind: 'reset' });
        replies.push('All scores reset to 0 (text UNDO to restore)');
        break;
    }
  }

  const after = leaderId();
  if (after && after !== before && events.some((e) => e.kind === 'score')) {
    events.push({ kind: 'leader', team: after });
  }

  if (events.length) {
    save();
    broadcast({ events, source });
  }
  const scoreEvents = events.filter((e) => e.kind === 'score' && e.delta);
  if (scoreEvents.length) announcer.scores(scoreEvents, scoresBefore);
  if (undidScore) announcer.correction();
  console.log(`[${source}] ${JSON.stringify(text)} → ${replies.join(' | ').replace(/\n/g, ' / ')}`);
  return replies.join('\n\n') || 'OK';
}

// ---------------------------------------------------------------- helpers
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseBody(raw, type) {
  if ((type || '').includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// https://www.twilio.com/docs/usage/security#validating-requests
function validTwilioSignature(req, params) {
  const sig = req.headers['x-twilio-signature'];
  if (!sig) return false;
  const base =
    PUBLIC_URL ||
    `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const url = base + req.url;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', TWILIO_AUTH_TOKEN).update(Buffer.from(data, 'utf8')).digest('base64');
  return safeEqual(expected, sig);
}

function numberAllowed(from) {
  if (!ALLOWED_NUMBERS.length) return true;
  const f = String(from || '').replace(/[^\d+]/g, '');
  const digits = (s) => s.replace(/\D/g, '');
  return ALLOWED_NUMBERS.some((n) => {
    const a = digits(n);
    const b = digits(f);
    // match on last 10 digits so "+44 7700..." and "07700..." both work
    return a && b && a.slice(-10) === b.slice(-10);
  });
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = url.pathname;

  try {
    if (req.method === 'GET' && route === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write(`data: ${JSON.stringify({ state: publicState(), event: { events: [{ kind: 'sync' }] } })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && route === '/api/state') {
      return send(res, 200, JSON.stringify(publicState()), 'application/json');
    }

    if (req.method === 'GET' && route === '/healthz') return send(res, 200, 'ok');

    if (req.method === 'GET' && route === '/api/music') {
      let files = [];
      try {
        files = fs.readdirSync(path.join(PUBLIC_DIR, 'music')).filter((f) => /\.(mp3|m4a|ogg|wav|aac)$/i.test(f)).sort();
      } catch (_) {}
      const list = files.map((f) => ({ name: f.replace(/\.[^.]+$/, ''), url: 'music/' + encodeURIComponent(f) }));
      if (fs.existsSync(path.join(PUBLIC_DIR, 'music.mp3'))) list.unshift({ name: 'music', url: 'music.mp3' });
      return send(res, 200, JSON.stringify(list), 'application/json');
    }

    if (req.method === 'GET' && route.startsWith('/api/tts/')) {
      const audio = await tts.get(route.slice('/api/tts/'.length));
      if (!audio) return send(res, 404, 'No audio');
      res.writeHead(200, { 'Content-Type': audio.type, 'Content-Length': audio.buf.length, 'Cache-Control': 'private, max-age=3600' });
      return res.end(audio.buf);
    }

    if (req.method === 'POST' && route === '/api/chat') {
      const body = parseBody(await readBody(req), req.headers['content-type']);
      if (!safeEqual(body.pin || '', ADMIN_PIN)) return send(res, 401, JSON.stringify({ error: 'Wrong PIN' }), 'application/json');
      return send(res, 200, JSON.stringify(await handleChat(body.text, 'chat')), 'application/json');
    }

    if (req.method === 'GET' && route === '/api/info') {
      const ips = lanAddresses();
      return send(res, 200, JSON.stringify({ admin: ips.map((ip) => `http://${ip}:${PORT}/admin`), ai: hostbot.available }), 'application/json');
    }

    if (req.method === 'POST' && route === '/api/command') {
      const body = parseBody(await readBody(req), req.headers['content-type']);
      if (!safeEqual(body.pin || '', ADMIN_PIN)) return send(res, 401, JSON.stringify({ error: 'Wrong PIN' }), 'application/json');
      const reply = runText(body.text || '', 'admin');
      return send(res, 200, JSON.stringify({ reply }), 'application/json');
    }

    if (req.method === 'POST' && (route === '/sms' || route === '/webhook')) {
      const raw = await readBody(req);
      const params = parseBody(raw, req.headers['content-type']);
      const isTwilio = !!req.headers['x-twilio-signature'] || 'MessageSid' in params || 'SmsSid' in params;

      // Authenticate the sender.
      if (isTwilio && TWILIO_AUTH_TOKEN && !validTwilioSignature(req, params)) {
        console.warn('Rejected SMS: bad Twilio signature (check PUBLIC_URL matches the webhook URL in Twilio)');
        return send(res, 403, 'Bad signature');
      }
      if (!isTwilio && SMS_SECRET && !safeEqual(url.searchParams.get('key') || '', SMS_SECRET)) {
        return send(res, 403, 'Bad key');
      }

      const from = params.From || params.from || params.sender || params.msisdn || params.phone || '';
      const text = params.Body ?? params.body ?? params.text ?? params.message ?? params.content ?? '';

      let reply;
      if (!numberAllowed(from)) {
        console.warn('Ignored SMS from non-host number', from);
        reply = 'Sorry, only the hosts can update the scoreboard.';
      } else {
        reply = (await handleChat(text, 'sms')).reply;
      }

      if (isTwilio) {
        return send(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(reply)}</Message></Response>`,
          'text/xml'
        );
      }
      return send(res, 200, JSON.stringify({ reply }), 'application/json');
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      let file = route === '/' ? '/index.html' : route === '/admin' ? '/admin.html' : route;
      try { file = decodeURIComponent(file); } catch { return send(res, 400, 'Bad path'); }
      const full = path.normalize(path.join(PUBLIC_DIR, file));
      if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
      return fs.readFile(full, (err, buf) => {
        if (err) return send(res, 404, 'Not found');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : buf);
      });
    }

    send(res, 405, 'Method not allowed');
  } catch (err) {
    console.error(err);
    send(res, 500, 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`\n  GAMES NIGHT leaderboard live on http://localhost:${PORT}`);
  console.log(`  Display:  http://localhost:${PORT}/`);
  console.log(`  Admin:    http://localhost:${PORT}/admin   (PIN ${process.env.ADMIN_PIN ? 'from ADMIN_PIN' : ADMIN_PIN + ' — set ADMIN_PIN to change'})`);
  console.log(`  SMS hook: POST /sms`);
  for (const ip of lanAddresses()) console.log(`  📱 Phone (same Wi-Fi): http://${ip}:${PORT}/admin`);
  console.log(`  💬 Plain-English control: ${hostbot.available ? 'ON (Claude)' : 'off: set ANTHROPIC_API_KEY'}`);
  if (!ALLOWED_NUMBERS.length) console.log('  ⚠  ALLOWED_NUMBERS not set: ANY phone can text score changes.');
  if (!TWILIO_AUTH_TOKEN) console.log('  ⚠  TWILIO_AUTH_TOKEN not set: Twilio signatures are not checked.');
  console.log(`  🎙  Announcer: ${announcer.status()}`);
  console.log('');
});
