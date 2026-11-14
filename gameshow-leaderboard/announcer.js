'use strict';
// The announcer's brain: turns score changes into hype commentary.
// With ANTHROPIC_API_KEY set, Claude writes every line fresh from the live
// situation (lead changes, comebacks, tight races, player shout-outs).
// Without it, or if Claude is slow, a large template library takes over, so
// the show never waits.

const tts = require('./tts');

let Anthropic = null;
try {
  const mod = require('@anthropic-ai/sdk');
  Anthropic = mod.default || mod;
} catch (_) {
  /* SDK not installed: templates only */
}

const MODEL = process.env.ANNOUNCER_MODEL || 'claude-opus-5-5';
const WRITER_TIMEOUT_MS = parseInt(process.env.ANNOUNCER_TIMEOUT_MS || '6000', 10);
const BATCH_MS = 1300; // gather rapid-fire texts into one announcement

const SYSTEM = `You are "Max Volume", the larger-than-life live announcer for a family-and-friends GAMES NIGHT, broadcast on a big screen with sound effects and music.

Write ONE announcement for the moment described. Rules:
- 1 or 2 short, punchy sentences, at most 32 words. It will be spoken aloud by a text-to-speech voice.
- Spoken-word only: no emojis, hashtags, markdown, quotation marks, stage directions or sound-effect words.
- Use team names and player names exactly as given. Numbers must be correct; write them as digits.
- Big game-show energy: dramatic, witty, warm. Playful teasing is fine, but never mean, never crude, and keep it family-friendly and respectful for a mixed-age crowd.
- React to the story: lead changes, comebacks, close races, runaway leaders, big swings, the player who scored.
- Vary your openings and phrasing; never reuse a line from the "recent lines" list.
Reply with the announcement text only.`;

// ------------------------------------------------------------ templates
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const T = {
  big: [
    (t, d) => `Oh my goodness! ${t} just smashed in ${d} points!`,
    (t, d) => `Stop the clocks! ${d} massive points for ${t}!`,
    (t, d) => `Are you seeing this? ${t} with a monster ${d}-point haul!`,
    (t, d) => `Boom! ${t} goes big with ${d} points!`,
    (t, d) => `That is a statement! ${d} points straight into the ${t} bank!`,
  ],
  mid: [
    (t, d) => `${d} points to ${t}! They are heating up!`,
    (t, d) => `Nice work, ${t}! That's ${d} more on the board!`,
    (t, d) => `${t} picks up ${d}! The pressure is building!`,
    (t, d) => `Ka-ching! ${d} points for ${t}!`,
    (t, d) => `${t} are on the move with ${d} points!`,
  ],
  small: [
    (t, d) => `Every point counts! ${d} for ${t}!`,
    (t, d) => `${t} sneaks in ${d}!`,
    (t, d) => `A cheeky ${d} for ${t}! Don't sleep on them!`,
    (t, d) => `${t} chips away with ${d} more!`,
  ],
  player: [
    (p, t, d) => `Take a bow, ${p}! ${d} points for ${t}!`,
    (p, t, d) => `${p} delivers! ${d} points for ${t}!`,
    (p, t, d) => `Somebody give ${p} a medal! That's ${d} for ${t}!`,
    (p, t, d) => `${p} with the clutch play! ${t} picks up ${d}!`,
  ],
  ouch: [
    (t, d) => `Ooh, that's gotta hurt! ${t} drops ${d}!`,
    (t, d) => `Oh dear, oh dear! Minus ${d} for ${t}!`,
    (t, d) => `The judges have spoken! ${t} loses ${d}!`,
    (t, d) => `Ouch! ${d} points slipping away from ${t}!`,
  ],
  leader: [
    (t, s) => `We have a new leader! ${t} storms to the top with ${s}!`,
    (t, s) => `The crown changes hands! ${t} takes first place on ${s}!`,
    (t, s) => `What a turnaround! ${t} are now leading the pack with ${s}!`,
    (t, s) => `Make some noise! ${t} have seized the lead with ${s} points!`,
  ],
  close: [
    (a, b, g) => `And it's neck and neck! Just ${g} between ${a} and ${b}!`,
    (a, b, g) => `Too close to call! ${a} and ${b} separated by only ${g}!`,
  ],
  tie: [(a, b, s) => `We are dead level! ${a} and ${b} tied at the top on ${s}!`],
  runaway: [
    (t, g) => `${t} are running away with this, ${g} points clear!`,
    (t, g) => `Can anyone catch ${t}? They lead by ${g}!`,
  ],
  multi: [
    () => `Points are flying everywhere!`,
    () => `What a round! The scoreboard is on fire!`,
    () => `Hold on to your seats, the board just exploded!`,
  ],
  round: [
    (r) => `Ladies and gentlemen, it's time for ${r}! Let's go!`,
    (r) => `Here we go! ${r} starts right now!`,
    (r) => `Get ready, everybody! ${r} is underway!`,
  ],
  game: [
    (g) => `Next up, it's ${g}! Teams, get ready!`,
    (g) => `Coming up next: ${g}! Bring your A-game!`,
    (g) => `Time to play ${g}! Who wants it most?`,
  ],
  correction: [
    () => `Hold the phone! The judges have made a correction!`,
    () => `Rewind! The judges are changing that one!`,
    () => `Wait a minute! Let's run that back!`,
  ],
  fire: [
    (t, n) => `${t} are on fire! That's ${n} in a row!`,
    (t, n) => `Somebody call the fire brigade, ${t} have scored ${n} times in a row!`,
    (t, n) => `${n} in a row for ${t}! They are unstoppable!`,
  ],
  introOpen: [
    () => `Ladies and gentlemen, welcome to Games Night! Teams, one trophy, and bragging rights forever. Let's meet our contenders!`,
    () => `Good evening and welcome to the ultimate showdown! Put your hands together as we meet tonight's teams!`,
  ],
  introTeam: [
    (t, m) => `Introducing ${t}! ${m}!`,
    (t, m) => `Give it up for ${t}! Starring ${m}!`,
    (t, m) => `Make some noise for ${t}! ${m}!`,
    (t, m) => `Next up, it's ${t}! ${m}!`,
  ],
  introClose: [
    () => `The stage is set. The stakes are high. Let the games begin!`,
    () => `Four teams, one champion. Let's play!`,
  ],
  timerStart: [
    (d) => `You have ${d} on the clock. Starting now!`,
    (d) => `${d}! Your time starts now!`,
    (d) => `The clock is ticking! ${d}, go go go!`,
  ],
  timeUp: [
    () => `Time's up! Hands down, pens down!`,
    () => `And that's time! Stop right there!`,
    () => `Buzzer! Time is up!`,
  ],
  suspense: [
    () => `Ladies and gentlemen, the scores are in. After a night of fierce competition, your Games Night champions are...`,
    () => `This is the moment we've all been waiting for. The winner of Games Night is...`,
    () => `Drumroll please. Taking home the crown tonight...`,
  ],
  reveal: [
    (t, s, m) => `${t}! With ${s} points! ${m}, you are the champions!`,
    (t, s, m) => `${t}! Champions of Games Night with ${s} points! Congratulations ${m}!`,
  ],
};

function listNames(arr) {
  return arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

// ------------------------------------------------------------ factory
function createAnnouncer({ getState, broadcast }) {
  const client = Anthropic && process.env.ANTHROPIC_API_KEY && process.env.ANNOUNCER_AI !== 'off' ? new Anthropic() : null;
  let useFast = process.env.ANNOUNCER_FAST !== 'off';
  const recent = [];
  let batch = null;
  let chain = Promise.resolve();

  const standings = () => [...getState().teams].sort((a, b) => b.score - a.score);
  const leaderOf = (teams) => {
    const r = [...teams].sort((a, b) => b.score - a.score);
    return r.length > 1 && r[0].score !== r[1].score ? r[0].id : null;
  };
  const team = (id) => getState().teams.find((t) => t.id === id);

  function situationText() {
    const s = getState();
    const lines = standings().map((t, i) => `${i + 1}. ${t.name}: ${t.score} points (players: ${t.members.join(', ')})`);
    return [
      `Event: ${s.title}. Current round: ${s.round}${s.game ? `. Current game: ${s.game}` : ''}.`,
      `Standings now:\n${lines.join('\n')}`,
      recent.length ? `Recent lines (do not repeat):\n${recent.slice(-6).map((l) => '- ' + l).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  function clean(text) {
    return String(text || '')
      .replace(/[*_#`"“”]/g, '')
      .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 320);
  }

  async function write(moment, fallback) {
    if (!client) return fallback;
    const ask = async () =>
      client.beta.messages.create(
        {
          model: MODEL,
          max_tokens: 2000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          ...(useFast ? { speed: 'fast' } : {}),
          system: SYSTEM,
          messages: [{ role: 'user', content: `${situationText()}\n\nWHAT JUST HAPPENED:\n${moment}\n\nWrite the announcement.` }],
        },
        { timeout: WRITER_TIMEOUT_MS, maxRetries: 0 }
      );
    try {
      let res;
      try {
        res = await ask();
      } catch (err) {
        if (useFast && err instanceof Anthropic.BadRequestError) {
          console.warn('[announcer] fast mode rejected, using standard speed:', err.message);
          useFast = false;
          res = await ask();
        } else throw err;
      }
      if (res.stop_reason === 'refusal') return fallback;
      const text = clean(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' '));
      return text.length > 3 ? text : fallback;
    } catch (err) {
      console.warn('[announcer] writer unavailable, using template:', err.message);
      return fallback;
    }
  }

  function emit(kind, mood, focusTeam, lines) {
    const ann = {
      kind: 'announce',
      type: kind,
      mood,
      team: focusTeam || null,
      tts: tts.mode(),
      lines: lines.map((l) => ({ id: tts.register(l.text, l.mood || mood), text: l.text })),
    };
    for (const l of lines) recent.push(l.text);
    while (recent.length > 12) recent.shift();
    console.log(`[announcer] (${mood}) ${lines.map((l) => l.text).join(' / ')}`);
    broadcast({ events: [ann], source: 'announcer' });
  }

  // Queue jobs so announcements go out in order.
  const run = (fn) => (chain = chain.then(fn).catch((e) => console.error('[announcer]', e)));

  // ---------------------------------------------------------- scores
  function scores(events, before) {
    if (!batch) {
      batch = { before, events: [] };
      setTimeout(() => {
        const b = batch;
        batch = null;
        if (!b.cancelled) run(() => flushScores(b));
      }, BATCH_MS);
    }
    batch.events.push(...events);
  }

  async function flushScores({ before, events }) {
    const net = new Map();
    const players = [];
    for (const e of events) {
      net.set(e.team, (net.get(e.team) || 0) + e.delta);
      if (e.player) players.push({ player: e.player, team: e.team, delta: e.delta });
    }
    const changes = [...net.entries()].filter(([, d]) => d !== 0);
    if (!changes.length) return;

    const now = standings();
    const prevLeader = leaderOf(before);
    const newLeader = leaderOf(getState().teams);
    const leaderChanged = newLeader && newLeader !== prevLeader;
    const gap = now.length > 1 ? now[0].score - now[1].score : 0;
    // a "comeback" needs a team that was alone at the bottom and no longer is
    const sortedBefore = [...before].sort((a, b) => a.score - b.score);
    const lastBefore = sortedBefore.length > 1 && sortedBefore[0].score < sortedBefore[1].score ? sortedBefore[0] : null;
    const lastNow = [...now].reverse()[0];
    const comeback = lastBefore && lastNow.id !== lastBefore.id && team(lastBefore.id).score > lastNow.score && net.get(lastBefore.id) > 0;
    const contested = now.length > 1 && now[0].score >= 15;
    const biggest = changes.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
    const allNegative = changes.every(([, d]) => d < 0);
    const mood = leaderChanged || biggest[1] >= 25 ? 'hype' : allNegative ? 'ouch' : 'score';

    // Facts for Claude
    const facts = changes.map(([id, d]) => `${team(id).name} ${d > 0 ? 'gained' : 'lost'} ${Math.abs(d)} points (now ${team(id).score}).`);
    for (const p of players) facts.push(p.delta > 0 ? `${p.player} (${team(p.team).name}) earned ${p.delta} of those points.` : `${p.player} (${team(p.team).name}) was responsible for losing ${-p.delta} of those points.`);
    if (leaderChanged) facts.push(`LEAD CHANGE: ${team(newLeader).name} has taken first place${prevLeader ? ` from ${team(prevLeader).name}` : ''}!`);
    else if (newLeader === null && now.length > 1) facts.push(`It's a TIE at the top between ${now.filter((t) => t.score === now[0].score).map((t) => t.name).join(' and ')}.`);
    else if (contested && gap <= 5) facts.push(`Very close race: only ${gap} points between first and second.`);
    else if (contested && gap >= 40) facts.push(`${now[0].name} are running away with it, ${gap} points clear.`);
    const st = getState().streak;
    const onFire = st && st.count >= 3 && net.get(st.team) > 0 ? st : null;
    if (onFire) facts.push(`${team(onFire.team).name} are ON FIRE: ${onFire.count} scores in a row!`);
    if (comeback) facts.push(`${team(lastBefore.id).name} were in last place and have climbed off the bottom!`);

    // Template version
    const [bid, bd] = biggest;
    const bt = team(bid).name;
    let line;
    const credited = players.find((p) => p.team === bid && p.delta > 0);
    if (changes.length > 1) line = pick(T.multi)() + ' ' + changes.map(([id, d]) => `${team(id).name} ${d > 0 ? 'plus' : 'minus'} ${Math.abs(d)}`).join(', ') + '!';
    else if (bd < 0) {
      const culprit = players.find((p) => p.team === bid && p.delta < 0);
      line = pick(T.ouch)(bt, -bd) + (culprit ? ` Sorry, ${culprit.player}!` : '');
    }
    else if (credited) line = pick(T.player)(credited.player, bt, bd);
    else line = pick(bd >= 25 ? T.big : bd >= 8 ? T.mid : T.small)(bt, bd);
    if (leaderChanged) line += ' ' + pick(T.leader)(team(newLeader).name, team(newLeader).score);
    else if (newLeader === null && now[0].score > 0) line += ' ' + pick(T.tie)(now[0].name, now[1].name, now[0].score);
    else if (contested && gap <= 5 && gap > 0) line += ' ' + pick(T.close)(now[0].name, now[1].name, gap);
    else if (contested && gap >= 40) line += ' ' + pick(T.runaway)(now[0].name, gap);

    if (onFire && !leaderChanged) line += ' ' + pick(T.fire)(team(onFire.team).name, onFire.count);
    const text = await write(facts.join('\n'), line);
    emit('score', onFire && mood === 'score' ? 'hype' : mood, leaderChanged ? newLeader : bid, [{ text }]);
  }

  // ---------------------------------------------------------- other moments
  return {
    scores,
    round(label) {
      run(async () => {
        const text = await write(`A new round is starting: ${label}. Hype the room up for it and mention the current leader.`, pick(T.round)(label));
        emit('round', 'round', null, [{ text }]);
      });
    },
    game(name) {
      run(async () => {
        const text = await write(`The next game is ${name}. Introduce it with excitement.`, pick(T.game)(name));
        emit('game', 'round', null, [{ text }]);
      });
    },
    message(text) {
      run(async () => emit('message', 'message', null, [{ text: `Attention please! ${text}` }]));
    },
    say(text) {
      run(async () => emit('say', 'say', null, [{ text }]));
    },
    recap() {
      run(async () => {
        const r = standings();
        const fallback = `Here's how it stands! ` + r.map((t, i) => `${['In first', 'In second', 'In third', 'In fourth', 'In fifth', 'In sixth'][i] || 'Then'}, ${t.name} with ${t.score}.`).join(' ');
        const text = await write('The host asked for a quick, dramatic recap of the full standings, first to last. Up to 3 sentences allowed this time.', fallback);
        emit('recap', 'score', r[0] && r[0].id, [{ text }]);
      });
    },
    correction() {
      if (batch) batch.cancelled = true; // don't announce points that were just undone
      run(async () => emit('correction', 'correction', null, [{ text: pick(T.correction)() }]));
    },
    rename(oldName, newName, id) {
      run(async () => emit('say', 'score', id, [{ text: `${oldName} will now be known as ${newName}!` }]));
    },
    winner() {
      run(async () => {
        const r = standings();
        const tied = r.filter((t) => r[0] && t.score === r[0].score);
        let fallback;
        let moment;
        if (tied.length > 1) {
          fallback = `It's a tie! ${listNames(tied.map((t) => t.name))}, you share the crown with ${r[0].score} points each!`;
          moment = `FINAL RESULT: a tie for first between ${listNames(tied.map((t) => t.name))} on ${r[0].score} points. Announce the shared victory, roaring their names.`;
        } else {
          const w = r[0];
          fallback = pick(T.reveal)(w.name, w.score, listNames(w.members));
          moment = `FINAL RESULT: ${w.name} have WON Games Night with ${w.score} points (second place ${r[1] ? r[1].name + ' on ' + r[1].score : 'n/a'}). This line plays right after the reveal: start by roaring "${w.name}!", then celebrate the players by name: ${listNames(w.members)}. Up to 3 sentences allowed.`;
        }
        const intro = pick(T.suspense)();
        const reveal = await write(moment, fallback);
        emit('winner', 'winner', tied.length === 1 ? r[0].id : null, [
          { text: intro, mood: 'suspense' },
          { text: reveal, mood: 'winner' },
        ]);
      });
    },
    intro() {
      run(async () => {
        const teams = getState().teams;
        const lines = [{ text: pick(T.introOpen)(), mood: 'hype' }];
        const variants = [...T.introTeam].sort(() => Math.random() - 0.5);
        teams.forEach((t, i) => lines.push({ text: variants[i % variants.length](t.name, listNames(t.members)), mood: 'hype' }));
        lines.push({ text: pick(T.introClose)(), mood: 'hype' });
        emit('intro', 'intro', null, lines);
      });
    },
    timerStart(seconds) {
      const d = seconds >= 60 ? `${Math.floor(seconds / 60)} minute${seconds >= 120 ? 's' : ''}${seconds % 60 ? ` and ${seconds % 60} seconds` : ''}` : `${seconds} seconds`;
      run(async () => emit('timer', 'say', null, [{ text: pick(T.timerStart)(d) }]));
    },
    timeUp() {
      run(async () => emit('timeup', 'say', null, [{ text: pick(T.timeUp)() }]));
    },
    status() {
      return `${client ? `Claude ${MODEL}${useFast ? ' (fast)' : ''}` : 'built-in templates'} + ${tts.describe()}`;
    },
  };
}

module.exports = { createAnnouncer };
