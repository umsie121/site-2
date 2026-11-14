# 🎮 Games Night — Live Game Show Leaderboard

A projector-ready, neon game-show scoreboard with live updates. Text a score to a phone number and the big screen animates instantly: scores count up, teams swap places, particles burst, and a **NEW LEADER** takeover plays with a fanfare.

- **Display** (`/`): the projector screen. Animated stage, neon title, live rankings, score ticker, and full-screen takeovers.
- **Host panel** (`/admin`): big tap buttons for any phone. A backup if texting fails.
- **SMS webhook** (`/sms`): plug in Twilio (or any SMS provider that can POST to a URL).
- **Sound**: all sound effects and a synthwave background track are generated in the browser, so there are no audio files. You can also load your own MP3.
- **Zero dependencies**: Node 18+ only. No `npm install` needed.

---

## 1. Run it

```bash
node server.js
# Display: http://localhost:3000
# Host panel: http://localhost:3000/admin   (default PIN 2580)
```

Twilio needs a **public URL**, so for the night deploy it (step 2). Running it locally works for the display and host panel on the same Wi-Fi.

## 2. Deploy (about 5 minutes)

**Railway** (recommended) or **Render**: create a new project from this repo. Both detect Node and run `npm start`. Then set these environment variables:

| Variable | Example | Why |
|---|---|---|
| `ADMIN_PIN` | `7391` | PIN for the host panel. **Change it.** |
| `ALLOWED_NUMBERS` | `+447700900123,+447700900456` | Only these phones can text scores. **Strongly recommended.** |
| `TWILIO_AUTH_TOKEN` | *(from the Twilio console)* | Rejects fake requests that don't come from Twilio. |
| `PUBLIC_URL` | `https://your-app.up.railway.app` | The exact public base URL. Needed for the Twilio signature check. |
| `DATA_DIR` | `/data` | Optional. Point at a mounted volume so scores survive a restart. |
| `SMS_SECRET` | `longrandomstring` | Only for non-Twilio providers. Call `/sms?key=...`. |

Generate a domain in Railway and open it. You should see the leaderboard.

## 3. Hook up Twilio

1. In the Twilio Console, buy a phone number with **SMS** capability (about $1–2/month).
2. Go to **Phone Numbers → Manage → Active numbers →** your number **→ Messaging configuration**.
3. Under **A message comes in**, choose **Webhook**, then enter `https://YOUR-APP-URL/sms` with method **HTTP POST**.
4. Save, then text `help` to the number. You should get the command list back.

> **US numbers:** receiving texts works right away. Twilio's *reply* texts can be filtered until the number has A2P 10DLC registration. Even if replies don't arrive, the scoreboard still updates. UK and most other countries' numbers aren't affected.

**Other providers (Wavetel, Vonage, Plivo, MessageBird, …):** point their inbound-SMS webhook at `https://YOUR-APP-URL/sms?key=YOUR_SMS_SECRET`. The server accepts form or JSON bodies with the usual field names: `From`/`from`/`msisdn` and `Body`/`text`/`message`. It replies with JSON `{ "reply": "..." }`.

## 4. Text commands

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
| `msg 5 MINUTE BREAK` | Flashes a big message across the screen |
| `rename A The Lions` | Renames a team (scoring by the new name works too) |
| `winner` | Drumroll, then a full-screen winner reveal with confetti (handles ties) |
| `clear` | Removes the winner screen or message |
| `music on` · `music off` | Controls the background music on the projector remotely |
| `reset confirm` | Sets all scores to 0 (`undo` brings them back) |
| `help` | Lists the commands |

When someone takes first place, the **NEW LEADER** takeover plays automatically.

## 5. On the night: projector checklist

1. Open the display URL on the projector laptop in **Chrome**.
2. Click **▶ GO LIVE**. This turns on sound (browsers require a click) and goes fullscreen.
3. Move the mouse to show the control dock:
   - **♫ MUSIC**: toggle the built-in synthwave track (or press **M**)
   - **VOL**: music volume. Sound effects automatically lower the music.
   - **LOAD MP3**: use your own background track. Or put a file named `music.mp3` in `public/` to have it load automatically.
   - **SFX**: toggle sound effects (**S**)
   - **TEST FX**: preview the animations (**T**)
   - **FULLSCREEN** (**F**). **Esc** clears overlays.
4. The page keeps the screen awake and reconnects automatically if the Wi-Fi drops (the status in the top-right corner shows this). Scores are saved on the server, so refreshing is safe.
5. Do a test: text `A +1`, then `undo`.

## Customising

Edit `teams.json` to change team names, colours, members, the title or the subtitle, then restart. Saved scores are kept.

## Files

```
server.js        HTTP server, SMS webhook, live updates (Server-Sent Events), persistence
commands.js      text-command parser shared by SMS and the host panel
teams.json       teams, colours, members, title
public/index.html, display.css, display.js   projector display
public/audio.js  synthesized SFX and background music (Web Audio API)
public/admin.html  host control panel
test.js          parser tests (npm test)
```
