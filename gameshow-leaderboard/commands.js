'use strict';
// Turns a text message ("A +10", "Hamza +5", "undo", "msg Round 2!") into actions.
// Shared by the SMS webhook and the admin panel so both behave identically.

const MUSIC_TRACKS = {
  synth: 'Synthwave Showdown',
  funk: 'Game Show Funk',
  tension: 'Thinking Time',
  lounge: 'Cocktail Lounge',
  arcade: '8-Bit Arcade',
  epic: 'Grand Finale',
  mp3: 'My MP3s',
};
const MUSIC_ALIASES = {
  synth: 'synth', synthwave: 'synth', retro: 'synth', showdown: 'synth',
  funk: 'funk', funky: 'funk', groove: 'funk', gameshow: 'funk', 'game show': 'funk', disco: 'funk',
  tension: 'tension', thinking: 'tension', 'thinking time': 'tension', clock: 'tension', countdown: 'tension', suspense: 'tension', timer: 'tension',
  lounge: 'lounge', jazz: 'lounge', jazzy: 'lounge', chill: 'lounge', break: 'lounge', relax: 'lounge', cocktail: 'lounge',
  arcade: 'arcade', '8bit': 'arcade', '8-bit': 'arcade', chiptune: 'arcade', retro8: 'arcade', video: 'arcade', game: 'arcade',
  epic: 'epic', finale: 'epic', 'grand finale': 'epic', cinematic: 'epic', drama: 'epic', dramatic: 'epic', final: 'epic',
  mp3: 'mp3', mp3s: 'mp3', mine: 'mp3', playlist: 'mp3', songs: 'mp3', 'my music': 'mp3', 'my songs': 'mp3',
  next: 'next', skip: 'next', change: 'next', shuffle: 'next',
};

const HELP = [
  'GAMES NIGHT commands:',
  'A +10  /  B -5  /  C 25',
  'A +10, D +5  (several at once)',
  'Hamza +5  (player name works too)',
  'set A 100',
  'undo',
  'scores',
  'round 3  /  round Trivia',
  'game Charades  (name the current game)',
  'msg <text>  (flash on screen + announcer reads it)',
  'say <text>  (announcer speaks it)',
  'hype  (announcer recaps the standings)',
  'voice on|off  (announcer)',
  'rename A The Lions',
  'intro  (cinematic team introductions)',
  'timer 60  /  timer 2m  /  timer stop',
  'winner  /  music on|off',
  'music funk|tension|lounge|arcade|epic|synth|mp3|next',
  'reset confirm',
].join('\n');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// Find a team from a token: "a", "team a", "teama", custom team name, or a member name.
const clean = (s) => norm(s).replace(/[^a-z0-9 ]/g, '').replace(/^(the |team )+/, '').trim();

function resolveTeam(token, teams) {
  const t = clean(token);
  if (!t) return null;
  for (const team of teams) {
    if (norm(team.id) === t || 'team' + norm(team.id) === t.replace(/ /g, '')) return { team };
  }
  for (const team of teams) {
    const n = clean(team.name);
    if (n && n === t) return { team };
  }
  for (const team of teams) {
    for (const m of team.members) {
      if (norm(m) === t) return { team, player: m };
    }
  }
  return null;
}

function parseNumber(sign, num) {
  let n = parseInt(num, 10);
  if (!Number.isFinite(n)) return null;
  const s = norm(sign);
  if (s === '-' || s === 'minus' || s === 'min' || s === 'take' || s === 'lose' || s === 'loses') n = -n;
  return n;
}

const SIGN = '(\\+|-|plus|minus|add|take|gets?|wins?|lose|loses)?';

// Parse a single clause into an action object, or {error}.
function parseClause(raw, teams) {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const lower = norm(text);
  let m;

  if (/^(help|\?|commands|menu)$/.test(lower)) return { type: 'help' };
  if (/^(undo|oops|back|undo last)$/.test(lower)) return { type: 'undo' };
  if (/^(scores?|standings?|status|leaderboard|table)$/.test(lower)) return { type: 'scores' };
  if (/^reset( all)? confirm$/.test(lower)) return { type: 'reset' };
  if (/^reset/.test(lower)) return { error: 'To wipe ALL scores text: reset confirm' };
  if (/^(winner|crown|finale|celebrate)$/.test(lower)) return { type: 'winner' };
  if (/^(clear|hide)( winner| msg| message| banner)?$/.test(lower)) return { type: 'clear' };
  if (/^(hype|recap|commentary|standings recap|where are we)$/.test(lower)) return { type: 'recap' };
  if (/^(intro|introductions?|meet the teams|opening|open the show)$/.test(lower)) return { type: 'intro' };
  if (/^(?:timer|countdown|clock) (?:stop|off|cancel|clear|end)$/.test(lower) || /^(?:stop|cancel) (?:the )?(?:timer|countdown|clock)$/.test(lower)) return { type: 'timer', seconds: 0 };
  if ((m = lower.match(/^(?:timer|countdown|clock|start timer)\s*(?:for\s+)?(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?)?$/))) {
    const n = parseFloat(m[1]);
    const secs = Math.round(/^m/.test(m[2] || '') ? n * 60 : n);
    if (secs < 3 || secs > 3600) return { error: 'Timer must be between 3 seconds and 60 minutes' };
    return { type: 'timer', seconds: secs };
  }
  if ((m = lower.match(/^(?:voice|announcer|commentary|tts) (on|off)$/))) return { type: 'voice', on: m[1] === 'on' };
  if ((m = lower.match(/^(?:music|song|track)\s+(.+)$/)) && MUSIC_ALIASES[m[1].trim()]) {
    return { type: 'music', on: true, track: MUSIC_ALIASES[m[1].trim()] };
  }
  if ((m = lower.match(/^music (on|off|play|stop|start|pause)$/))) {
    return { type: 'music', on: ['on', 'play', 'start'].includes(m[1]) };
  }
  if ((m = text.match(/^(?:msg|message|banner|show)[:\s]+(.+)$/i))) {
    return { type: 'message', text: m[1].slice(0, 120) };
  }
  if ((m = text.match(/^(?:say|announce|speak)[:\s]+(.+)$/i))) {
    return { type: 'say', text: m[1].slice(0, 300) };
  }
  if ((m = text.match(/^(?:game|now playing|next game)[:\s]+(.+)$/i))) {
    return { type: 'game', text: m[1].trim().slice(0, 40) };
  }
  if ((m = text.match(/^round[:\s]+(.+)$/i))) {
    const r = m[1].trim();
    return { type: 'round', text: (/^\d+$/.test(r) ? 'ROUND ' + r : r).slice(0, 60) };
  }
  if ((m = text.match(/^rename\s+(\S+)\s+(?:to\s+)?(.+)$/i))) {
    const hit = resolveTeam(m[1], teams);
    if (!hit) return { error: `Unknown team "${m[1]}"` };
    return { type: 'rename', team: hit.team.id, name: m[2].slice(0, 40) };
  }
  // set A 100  /  A = 100
  if ((m = text.match(/^set\s+(.+?)\s+(?:to\s+)?(-?\d+)$/i)) || (m = text.match(/^(.+?)\s*=\s*(-?\d+)$/))) {
    const hit = resolveTeam(m[1], teams);
    if (!hit) return { error: `Unknown team "${m[1]}"` };
    return { type: 'set', team: hit.team.id, value: parseInt(m[2], 10) };
  }
  // A +10  /  Team A plus 10  /  Hamza +5  /  A 10 points
  const re1 = new RegExp(`^(.+?)\\s*${SIGN}\\s*(\\d+)\\s*(?:pts?|points?)?$`, 'i');
  // +10 A  /  10 to A  /  minus 5 team B
  const re2 = new RegExp(`^${SIGN}\\s*(\\d+)\\s*(?:pts?|points?)?\\s*(?:to|for|from)?\\s+(.+)$`, 'i');
  if ((m = text.match(re1))) {
    const hit = resolveTeam(m[1], teams);
    if (hit) {
      const delta = parseNumber(m[2], m[3]);
      if (delta === 0) return { error: 'That would be 0 points' };
      return { type: 'score', team: hit.team.id, delta, player: hit.player || null };
    }
  }
  if ((m = text.match(re2))) {
    const hit = resolveTeam(m[3], teams);
    if (hit) {
      const delta = parseNumber(m[1], m[2]);
      if (delta === 0) return { error: 'That would be 0 points' };
      return { type: 'score', team: hit.team.id, delta, player: hit.player || null };
    }
  }
  return { error: `Didn't understand "${text}". Text HELP for commands.` };
}

// Messages can hold several clauses split by commas, semicolons, "and" or newlines.
// Messages that are a free-text command (msg/round/rename) are kept whole.
function parseMessage(body, teams) {
  const text = String(body || '').trim();
  if (!text) return [{ error: 'Empty message. Text HELP for commands.' }];
  if (/^(msg|message|say|announce|speak|banner|show|round|rename|game|now playing|next game)\b/i.test(text)) {
    return [parseClause(text, teams)];
  }
  return text
    .split(/[\n,;&]+|\s+and\s+/i)
    .map((c) => parseClause(c, teams))
    .filter(Boolean);
}

module.exports = { parseMessage, parseClause, resolveTeam, HELP, MUSIC_TRACKS };
