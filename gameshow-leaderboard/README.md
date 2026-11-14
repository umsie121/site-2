# 🎮 Games Night — Live Game Show Leaderboard

A projector-ready, neon game-show scoreboard with live updates. Text a score to a phone number and the big screen animates instantly: scores count up, teams swap places, particles burst, and a **NEW LEADER** takeover plays with a fanfare.

- **Display** (`/`): the projector screen. Animated stage, neon title, live rankings, score ticker, and full-screen takeovers.
- **Host panel** (`/admin`): big tap buttons for any phone. A backup if texting fails.
- **SMS webhook** (`/sms`): plug in Twilio (or any SMS provider that can POST to a URL).
- **🎙 Live AI announcer**: every score update is called out by a hype game-show voice. Claude writes each line fresh from what's happening: lead changes, comebacks, close races and the player who scored. ElevenLabs (or OpenAI) voices it through an arena-style sound chain, timed with stingers, air horns, a synthesized crowd and a sad trombone. Captions appear in a "LIVE COMMENTARY" bar with a live voice meter.
- **Sound**: all sound effects and a synthwave background track are generated in the browser, so there are no audio files. You can also load your own MP3.
- **Node 18+**, one dependency (`@anthropic-ai/sdk`).

---

## 1. Run it

```bash
npm install
node server.js
# Display: http://localhost:3000
# Host panel: http://localhost:3000/admin   (default PIN 2580)
```

Twilio needs a **public URL**, so for the night deploy it (step 2). Running it locally works for the display and host panel on the same Wi-Fi.

## 📱 Easiest: control it from your phone over Wi-Fi (no Twilio needed)

1. Start the server on the laptop. It prints a line like `📱 Phone (same Wi-Fi): http://192.168.1.23:4000/admin`. The **GO LIVE** screen also shows a QR code for it.
2. Open that address on your phone (on the same Wi-Fi) and enter the PIN.
3. Type or dictate what happened into **💬 Just tell me what happened**, in plain English:
   - "Team C smashed charades, give them 50, Tasnim was MVP"
   - "everyone gets 10 for showing up"
   - "start a 60 second timer"
   - "get the announcer to roast Team B, nicely"
   - "oops, undo that"
   - "who's winning?"

Exact commands like `A +10` run instantly. Anything else goes to Claude, which turns it into scoreboard commands and shows you which ones it ran (`ANTHROPIC_API_KEY` is required for plain English). To dictate, use your phone keyboard's 🎤, or the 🎤 button where the browser supports it.

## 2. Deploy (only needed for texting via Twilio)

**Railway** (recommended) or **Render**: create a new project from this repo. Both detect Node and run `npm start`. Then set these environment variables:

| Variable | Example | Why |
|---|---|---|
| `ADMIN_PIN` | `7391` | PIN for the host panel. **Change it.** |
| `ALLOWED_NUMBERS` | `+447700900123,+447700900456` | Only these phones can text scores. **Strongly recommended.** |
| `TWILIO_AUTH_TOKEN` | *(from the Twilio console)* | Rejects fake requests that don't come from Twilio. |
| `PUBLIC_URL` | `https://your-app.up.railway.app` | The exact public base URL. Needed for the Twilio signature check. |
| `DATA_DIR` | `/data` | Optional. Point at a mounted volume so scores survive a restart. |
| `SMS_SECRET` | `longrandomstring` | Only for non-Twilio providers. Call `/sms?key=...`. |
| `ANTHROPIC_API_KEY` | *(from console.anthropic.com)* | Claude writes the commentary. Without it, a built-in library of lines is used. |
| `ELEVENLABS_API_KEY` | *(from elevenlabs.io)* | **Best voice.** The premium announcer voice. |
| `ELEVENLABS_VOICE_ID` | `pNInz6obpgDQGcFmaJgB` | Optional. Pick a voice from the ElevenLabs Voice Library (search "announcer" or "game show host") and paste its ID. |
| `OPENAI_API_KEY` | *(optional)* | Alternative voice provider, used if there's no ElevenLabs key. `OPENAI_TTS_VOICE` defaults to `ash`. |

With no voice key, the projector browser's built-in voice reads the lines. It's free but less dramatic.

Generate a domain in Railway and open it. You should see the leaderboard.

## 3. Hook up Twilio

1. In the Twilio Console, buy a phone number with **SMS** capability (about $1–2/month).
2. Go to **Phone Numbers → Manage → Active numbers →** your number **→ Messaging configuration**.
3. Under **A message comes in**, choose **Webhook**, then enter `https://YOUR-APP-URL/sms` with method **HTTP POST**.
4. Save, then text `help` to the number. You should get the command list back.

> **US numbers:** receiving texts works right away. Twilio's *reply* texts can be filtered until the number has A2P 10DLC registration. Even if replies don't arrive, the scoreboard still updates. UK and most other countries' numbers aren't affected.

**Other providers (Wavetel, Vonage, Plivo, MessageBird, …):** point their inbound-SMS webhook at `https://YOUR-APP-URL/sms?key=YOUR_SMS_SECRET`. The server accepts form or JSON bodies with the usual field names: `From`/`from`/`msisdn` and `Body`/`text`/`message`. It replies with JSON `{ "reply": "..." }`.

## 4. The announcer

What it does on its own:

| Moment | What you hear |
|---|---|
| Points scored | News stinger → commentary line → crowd applause |
| Big score (25+) or a **lead change** | Riser and impact → hype line → **air horn** and a big crowd |
| Points lost | Commentary line → **sad trombone** |
| `round 3` / `game Charades` | Three drum hits → intro line → applause |
| `undo` | Record scratch → "Hold the phone! The judges have made a correction!" |
| `winner` | The drumroll holds while the announcer builds suspense → reveal → the announcer roars the winning team and every player's name → crowd and air horn |

- Texts that arrive within about a second of each other become **one** announcement, so a burst of updates gets one combined call.
- Music lowers automatically while the announcer speaks.
- Commentary arrives about 2–4 seconds after the board updates, like a real commentator reacting. If Claude is slow or unreachable, a built-in line is used straight away, so the show never stalls.
- Controls: `voice off` / `voice on` by text, the **🎙 ANNOUNCER** button or the **A** key on the display, and a **VOICE** volume slider. **TEST VOICE** (or **V**) plays a test line using the browser's voice.

**Rough costs for a night:** Claude is about 1p per line. ElevenLabs is roughly 100–150 characters per line, so a few hundred lines fit within a low-tier monthly plan (check current pricing).

## Pizzazz that happens automatically

- **🔥 ON FIRE streaks:** when a team scores 3, 5 or 8 times in a row, there's a fire takeover, embers rise off their row, and they get an "ON FIRE ×N" badge until someone else scores. The announcer calls the streak.
- **Lasers, screen shake and flashes** on big scores (25+), new leaders, streaks, intros and the winner reveal.
- **Beat-synced stage:** the floor grid, stage lights and title pulse in time with the generated music.

## Music

Six background tracks are generated live (no files, no licensing):

| Text | Track | Good for |
|---|---|---|
| `music synth` | 🌆 Synthwave Showdown | Default high-tech vibe |
| `music funk` | 🕺 Game Show Funk | Slap bass and brass stabs: classic TV game show |
| `music tension` | ⏱ Thinking Time | Ticking clock and a heartbeat that gets more intense every few bars. For timed rounds |
| `music lounge` | 🍸 Cocktail Lounge | Swinging jazz for breaks and food |
| `music arcade` | 👾 8-Bit Arcade | Chiptune for quick-fire or video-game rounds |
| `music epic` | 🏆 Grand Finale | Taiko drums and brass. It switches on automatically at the winner reveal if music is playing |
| `music mp3` | 🎵 My MP3s | Your own songs as a playlist |
| `music next` | ⏭ | Next track, or next song in your playlist |

**Your own songs:** put `.mp3` or `.m4a` files in `public/music/` before starting the server (they become the "My MP3s" playlist), or use **+ ADD MP3s** in the projector's control bar to pick several at once. Songs play in order and loop.

Tracks crossfade when you switch. You can also switch with the **TRACK** dropdown and **⏭ NEXT** in the control bar (or the **N** key), or with the **♫ MUSIC** buttons on the phone panel. The current track shows under the clock.

## 5. Text commands

| Text | What happens |
|---|---|
| `A +10` · `B -5` · `C 25` | Add or subtract points |
| `Team D plus 15` · `+10 to A` | Natural phrasing also works |
| `Hamza +5` | A player's name works: the points go to their team and their name flashes on screen |
| `A +10, C +5` | Several updates in one text (also works with new lines or "and") |
| `set A 100` | Set an exact score |
| `undo` | Undo the last change (up to 100 steps) |
| `scores` | Replies with the current standings |
| `round 3` · `round Trivia` | Changes the round label, with a transition |
| `msg 5 MINUTE BREAK` | Flashes a big message across the screen, and the announcer reads it |
| `say Hamza, you are on thin ice!` | The announcer says anything you type |
| `game Charades` | Shows the current game under the round, with an intro (games and rounds are free text, so name them however you like) |
| `hype` | The announcer gives a dramatic recap of the standings |
| `voice off` · `voice on` | Mutes or unmutes the announcer |
| `rename A The Lions` | Renames a team (scoring by the new name works too) |
| `intro` | 🎬 Cinematic team introductions: each team's name slams in, the players' names fly in, and the announcer introduces everyone |
| `timer 60` · `timer 2m` · `timer stop` | ⏱ A countdown ring replaces the title, the music switches to Thinking Time, it beeps through the last 10 seconds with a red pulsing frame, then **TIME'S UP!** with a buzzer |
| `winner` | Drumroll, then a full-screen winner reveal with confetti (handles ties) |
| `clear` | Removes the winner screen or message |
| `music on` · `music off` | Controls the background music on the projector remotely |
| `music funk` · `music tension` · `music next` … | Switches the background track (see Music above) |
| `reset confirm` | Sets all scores to 0 (`undo` brings them back) |
| `help` | Lists the commands |

When someone takes first place, the **NEW LEADER** takeover plays automatically.

## 6. On the night: MacBook → Apple TV (AirPlay)

1. On the MacBook, turn on **Do Not Disturb** (Control Centre → Focus). Otherwise notifications pop up on the big screen.
2. **Control Centre → Screen Mirroring →** choose the Apple TV. Mirroring keeps sound and picture in sync. If the sound still comes from the MacBook, go to **Control Centre → Sound** and choose the Apple TV.
3. Plug the MacBook into power. The page keeps the screen awake, but power saving can still throttle animations.
4. Open the display URL in **Chrome** and click **▶ GO LIVE**. This turns on sound (browsers require a click) and goes fullscreen.
5. Text `say Testing one two` and check the voice comes out of the TV. Then text `A +1`, then `undo`.

Once it's running:

1. Move the mouse to show the control dock:
   - **♫ MUSIC**: toggle the built-in synthwave track (or press **M**)
   - **VOL**: music volume. Sound effects automatically lower the music.
   - **TRACK** / **⏭ NEXT**: pick a background track (**N** skips to the next one)
   - **+ ADD MP3s**: add your own songs as a playlist (or put them in `public/music/`)
   - **SFX**: toggle sound effects (**S**)
   - **🎙 ANNOUNCER** and **VOICE**: turn the announcer on or off (**A**) and set its volume. **TEST VOICE** (**V**) plays a test line.
   - **TEST FX**: preview the animations (**T**)
   - **FULLSCREEN** (**F**). **Esc** clears overlays.
2. The page keeps the screen awake and reconnects automatically if the Wi-Fi drops (the status in the top-right corner shows this). Scores are saved on the server, so refreshing is safe.
3. Set the TV volume high. The announcer is mixed loud, and the music lowers while it speaks.

## Customising

Edit `teams.json` to change team names, colours, members, the title or the subtitle, then restart. Saved scores are kept.

## Files

```
server.js        HTTP server, SMS webhook, live updates (Server-Sent Events), persistence
commands.js      text-command parser shared by SMS and the host panel
announcer.js     commentary writer (Claude + template fallback), batching, moods
hostbot.js       plain-English → commands (Claude, structured JSON output)
tts.js           ElevenLabs / OpenAI text-to-speech with eager synthesis and caching
teams.json       teams, colours, members, title
public/index.html, display.css, display.js   projector display
public/audio.js  synthesized SFX, music, and the announcer voice chain (Web Audio API)
public/announcer.js  plays announcements: stingers, voice, captions, voice meter
public/admin.html  host control panel
test.js          parser tests (npm test)
```
