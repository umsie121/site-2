'use strict';
// Natural-language control: "Team C smashed charades, give them 50, Tasnim was MVP"
// -> ["Tasnim +50"]. Claude translates plain English into the same commands the
// texting and phone panel use, so every change still goes through one parser
// (and can be undone). Exact commands like "A +10" skip Claude entirely.

let Anthropic = null;
try {
  const mod = require('@anthropic-ai/sdk');
  Anthropic = mod.default || mod;
} catch (_) {
  /* SDK missing: exact commands only */
}

const MODEL = process.env.HOSTBOT_MODEL || process.env.ANNOUNCER_MODEL || 'claude-opus-5-5';

const COMMANDS = `Command language (one command per array item):
- "<TEAM_ID> +N" or "<TEAM_ID> -N": add/subtract points, e.g. "A +10", "C -5"
- "<PlayerName> +N": add points to that player's team AND credit the player on screen. Prefer this whenever the points are for something a specific player did.
- "results <ids in finishing order>": award the fixed placement points after a game, e.g. "results C A D B" (1st C ... last B). Ties use "=", e.g. "results C A=D B". PREFER THIS whenever the host describes who won / came second etc. in a game, instead of inventing point amounts.
- "points N N N N": change the placement points table (1st, 2nd, 3rd, ...)
- "rumble": the big ring-announcer hype moment before a round ("hype the room", "get everyone pumped")
- "set <TEAM_ID> N": set an exact score (only when the host clearly asks to set/correct a total)
- "undo": undo the last change (use for "oops", "take that back", "undo that")
- "round <text>": change the round label, e.g. "round 3", "round Lightning Round"
- "game <name>": set the current game name, e.g. "game Charades"
- "msg <text>": flash a big message on screen (announcer reads it)
- "say <text>": announcer speaks the text (no banner)
- "hype": announcer recaps the standings
- "opening": the full cinematic cold open (map, hosts, title) followed by team intros
- "intro": team introductions only
- "timer <seconds>" (3-3600) or "timer stop"
- "winner": dramatic winner reveal; "clear": remove winner screen/message
- "rename <TEAM_ID> <new name>"
- "music on" | "music off" | "music synth|funk|tension|lounge|arcade|epic|mp3|next"
  (funk = game-show groove, tension = ticking clock for timed rounds, lounge = jazzy breaks, arcade = 8-bit, epic = finale)
- "voice on" | "voice off": announcer on/off
- "reset confirm": wipe ALL scores. Only if the host explicitly asks to reset everything.`;

const SYSTEM = `You are the backstage operator for a live GAMES NIGHT scoreboard. The host messages you in casual, possibly dictated English (typos, run-on sentences). Translate what they want into scoreboard commands.

${COMMANDS}

Rules:
- When the host gives a finishing order (who won, who came second...), use "results". Teams not mentioned simply aren't included.
- Only output points the host actually stated or clearly implied. Never invent amounts. If a needed amount or team is missing or ambiguous, output no commands and ask a short question in "reply".
- Map team mentions by ID, name, or any member's name. Use the exact spellings given in the state.
- "X and Y both get 10" means two commands. "Everyone gets 5" means one command per team.
- If the host only asks a question (e.g. "who's winning?"), output no commands and answer briefly in "reply" from the state.
- Fun requests ("make the announcer roast Team B") become "say <your short, kind, family-friendly line>".
- "reply" is a short, friendly confirmation for the host's phone (max 25 words), not shown on the big screen.`;

const SCHEMA = {
  type: 'object',
  properties: {
    commands: { type: 'array', items: { type: 'string' } },
    reply: { type: 'string' },
  },
  required: ['commands', 'reply'],
  additionalProperties: false,
};

function createHostBot({ getState }) {
  const client = Anthropic && process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  let useFast = process.env.ANNOUNCER_FAST !== 'off';

  function stateText() {
    const s = getState();
    const teams = [...s.teams]
      .sort((a, b) => b.score - a.score)
      .map((t) => `- id ${t.id}: "${t.name}", ${t.score} points, players: ${t.members.join(', ')}`)
      .join('\n');
    return `Current state: round "${s.round}"${s.game ? `, game "${s.game}"` : ''}. Placement points: ${s.placementPoints.join(', ')}.\nTeams (ranked):\n${teams}\nRecent changes: ${s.feed.slice(0, 5).map((f) => f.text).join('; ') || 'none'}`;
  }

  async function translate(text) {
    if (!client) return null;
    const ask = () =>
      client.beta.messages.create(
        {
          model: MODEL,
          max_tokens: 2000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
          ...(useFast ? { speed: 'fast' } : {}),
          system: SYSTEM,
          messages: [{ role: 'user', content: `${stateText()}\n\nHost says: ${text}` }],
        },
        { timeout: 12000, maxRetries: 1 }
      );
    let res;
    try {
      res = await ask();
    } catch (err) {
      if (useFast && err instanceof Anthropic.BadRequestError) {
        useFast = false;
        res = await ask();
      } else throw err;
    }
    if (res.stop_reason === 'refusal') return { commands: [], reply: "Sorry, I can't do that one." };
    const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const out = JSON.parse(raw);
    return {
      commands: Array.isArray(out.commands) ? out.commands.map(String).slice(0, 12) : [],
      reply: String(out.reply || '').slice(0, 300),
    };
  }

  return { available: !!client, translate };
}

module.exports = { createHostBot };
