'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const board = $('#board');
  const rows = new Map(); // teamId -> { el, scoreEl, shown }
  let state = null;
  let started = false;
  let winnerUp = false;

  // ------------------------------------------------------------ helpers
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ordinal = (n) => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');
  const teamOf = (id) => state && state.teams.find((t) => t.id === id);

  function sorted(teams) {
    return [...teams].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  // Serialise big overlays so they never collide.
  let queue = Promise.resolve();
  const enqueue = (fn) => (queue = queue.then(fn).catch((e) => console.error(e)));

  // ------------------------------------------------------------ board
  function buildRow(team, i) {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.setProperty('--c', team.color);
    el.style.setProperty('--i', i);
    el.dataset.team = team.id;
    el.innerHTML = `
      <div class="row-glow"></div>
      <div class="rank"><span class="rank-n">1</span><sup>ST</sup></div>
      <div class="info">
        <div class="name-line"><div class="team-name"></div><div class="crown">👑</div><div class="fire-badge"></div></div>
        <div class="members"></div>
        <div class="bar"><div class="bar-fill"></div></div>
      </div>
      <div class="score-wrap"><div class="score">0</div><div class="pts">POINTS</div></div>`;
    board.appendChild(el);
    const r = { el, scoreEl: $('.score', el), shown: team.score, anim: null };
    r.scoreEl.textContent = fmt(team.score);
    rows.set(team.id, r);
    return r;
  }

  function render(highlightPlayer) {
    const order = sorted(state.teams);
    const max = Math.max(1, ...state.teams.map((t) => t.score));
    const top = order[0];
    const tieTop = order.length > 1 && order[1].score === top.score;

    order.forEach((team, pos) => {
      const r = rows.get(team.id) || buildRow(team, state.teams.indexOf(team));
      const rank = 1 + state.teams.filter((t) => t.score > team.score).length;
      const prevPos = Number(r.el.style.getPropertyValue('--pos') || pos);
      r.el.classList.toggle('moving-up', pos < prevPos);
      if (pos < prevPos) setTimeout(() => r.el.classList.remove('moving-up'), 1300);
      r.el.style.setProperty('--pos', pos);
      r.el.dataset.rank = rank;
      $('.rank-n', r.el).textContent = rank;
      $('.rank sup', r.el).textContent = ordinal(rank);
      $('.team-name', r.el).textContent = team.name;
      $('.members', r.el).innerHTML = team.members
        .map((m) => (m === highlightPlayer ? `<b class="flashname">${esc(m)}</b>` : esc(m)))
        .join('<i>•</i>');
      $('.bar-fill', r.el).style.width = Math.max(1.5, (Math.max(0, team.score) / max) * 100) + '%';
      r.el.classList.toggle('leader', team === top && !tieTop && top.score > 0);
      const st = state.streak;
      const fire = !!(st && st.team === team.id && st.count >= 3);
      r.el.classList.toggle('onfire', fire);
      if (fire) $('.fire-badge', r.el).textContent = `🔥 ON FIRE ×${st.count}`;
      countTo(r, team.score);
    });
  }

  function countTo(r, target) {
    if (r.shown === target && !r.anim) return;
    cancelAnimationFrame(r.anim);
    const from = r.shown;
    const t0 = performance.now();
    const dur = Math.min(1800, 600 + Math.abs(target - from) * 25);
    let lastTick = 0;
    r.scoreEl.classList.add('counting');
    const stepFn = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      r.shown = from + (target - from) * e;
      r.scoreEl.textContent = fmt(r.shown);
      if (t - lastTick > 70 && p < 1) { lastTick = t; GameAudio.sfx.tick(); }
      if (p < 1) r.anim = requestAnimationFrame(stepFn);
      else { r.shown = target; r.anim = null; r.scoreEl.classList.remove('counting'); r.scoreEl.textContent = fmt(target); }
    };
    r.anim = requestAnimationFrame(stepFn);
  }

  // ------------------------------------------------------------ hud
  function renderHud() {
    const title = $('#title');
    title.textContent = state.title;
    $('#subtitle').textContent = state.subtitle;
    const roundEl = $('#round');
    if (roundEl.textContent !== state.round) {
      roundEl.textContent = state.round;
      roundEl.classList.remove('flash'); void roundEl.offsetWidth; roundEl.classList.add('flash');
    }
    const gameEl = $('#game');
    const g = state.game || '';
    if (gameEl.textContent !== g) {
      gameEl.textContent = g;
      gameEl.classList.remove('flash'); void gameEl.offsetWidth; gameEl.classList.add('flash');
    }
    renderTicker();
  }

  let lastFeedKey = '';
  function renderTicker() {
    const feed = state.feed.length ? state.feed : [{ text: 'Welcome to ' + state.title, color: '#ff2bd6' }];
    const standings = sorted(state.teams).map((t, i) => ({ text: `${i + 1}${ordinal(i + 1)} ${t.name} · ${fmt(t.score)}`, color: t.color }));
    const items = [...feed.slice(0, 8), ...standings];
    const key = JSON.stringify(items);
    if (key === lastFeedKey) return;
    lastFeedKey = key;
    const el = $('#ticker');
    el.innerHTML = items.map((f) => `<span style="--c:${esc(f.color || '#fff')}">${esc(f.text)}</span>`).join('');
    el.style.setProperty('--dur', Math.max(25, items.length * 5) + 's');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }

  setInterval(() => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }, 1000);

  // ------------------------------------------------------------ fx canvas
  const fx = $('#fx');
  const fctx = fx.getContext('2d');
  const parts = [];
  let confettiUntil = 0;
  let confettiColors = ['#00e5ff', '#ff2bd6', '#ffc400', '#39ff88', '#ffffff'];

  // Pre-rendered glow sprites: much cheaper than canvas shadowBlur on weak GPUs.
  const glowCache = new Map();
  function glow(color) {
    let g = glowCache.get(color);
    if (g) return g;
    g = document.createElement('canvas');
    g.width = g.height = 64;
    const c = g.getContext('2d');
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.18, color);
    grd.addColorStop(0.45, color + '55');
    grd.addColorStop(1, color + '00');
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
    glowCache.set(color, g);
    return g;
  }

  function sizeCanvas(c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst(x, y, color, count = 90, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (2 + Math.random() * 9) * power;
      parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, decay: 0.012 + Math.random() * 0.02, size: 1.5 + Math.random() * 3, color });
    }
  }

  function confetti(n = 12) {
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: 'conf', x: Math.random() * innerWidth, y: -20, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, w: 8 + Math.random() * 10, h: 5 + Math.random() * 6,
        color: confettiColors[(Math.random() * confettiColors.length) | 0], life: 1, decay: 0.0025,
      });
    }
  }

  let fireRects = [], fireFrame = 0;
  const EMBER = ['#ff6a00', '#ffb300', '#ff3d00', '#fff3b0'];
  function fxLoop() {
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    if (fireFrame++ % 20 === 0) fireRects = [...document.querySelectorAll('.row.onfire')].map((el) => el.getBoundingClientRect());
    for (const r of fireRects) {
      if (parts.length > 700) break;
      for (let k = 0; k < 2; k++) parts.push({ kind: 'ember', x: r.left + Math.random() * r.width, y: r.bottom - 4, vx: (Math.random() - 0.5) * 1.2, vy: -1.2 - Math.random() * 2.2, life: 1, decay: 0.012 + Math.random() * 0.015, size: 1 + Math.random() * 2.2, color: EMBER[(Math.random() * 4) | 0] });
    }
    if (performance.now() < confettiUntil && parts.length < 600) confetti(4);
    fctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.kind === 'ember') {
        p.vx += (Math.random() - 0.5) * 0.3; p.vy *= 0.985;
        fctx.globalCompositeOperation = 'lighter';
        fctx.globalAlpha = Math.max(0, p.life);
        const ez = (p.size * p.life + 0.5) * 6;
        fctx.drawImage(glow(p.color), p.x - ez / 2, p.y - ez / 2, ez, ez);
      } else if (p.kind === 'spark') {
        p.vx *= 0.96; p.vy = p.vy * 0.96 + 0.18;
        fctx.globalCompositeOperation = 'lighter';
        fctx.globalAlpha = Math.max(0, p.life);
        const sz = (p.size * p.life + 0.5) * 6;
        fctx.drawImage(glow(p.color), p.x - sz / 2, p.y - sz / 2, sz, sz);
      } else {
        p.vx += Math.sin(p.y / 40) * 0.05; p.rot += p.vr;
        fctx.globalCompositeOperation = 'source-over';
        fctx.globalAlpha = Math.min(1, p.life * 2);
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot);
        fctx.fillStyle = p.color; fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
        fctx.restore();
      }
      if (p.life <= 0 || p.y > innerHeight + 40) parts.splice(i, 1);
    }
    fctx.globalAlpha = 1;
    requestAnimationFrame(fxLoop);
  }

  // ambient floating motes
  const amb = $('#ambient');
  const actx = amb.getContext('2d');
  const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2.2 + 0.4, s: Math.random() * 0.0004 + 0.0001, h: Math.random() < 0.5 ? '#00e5ff' : '#ff2bd6', p: Math.random() * 6 }));
  function ambLoop(t) {
    actx.clearRect(0, 0, innerWidth, innerHeight);
    for (const m of motes) {
      m.y -= m.s; if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      actx.globalAlpha = 0.25 + 0.25 * Math.sin(t / 900 + m.p);
      const sz = m.r * 7;
      actx.drawImage(glow(m.h), m.x * innerWidth + Math.sin(t / 3000 + m.p) * 20 - sz / 2, m.y * innerHeight - sz / 2, sz, sz);
    }
    requestAnimationFrame(ambLoop);
  }

  function popAt(teamId, delta, player) {
    const r = rows.get(teamId);
    const team = teamOf(teamId);
    if (!r || !team) return;
    const rect = r.scoreEl.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const el = document.createElement('div');
    el.className = 'pop' + (delta < 0 ? ' neg' : '');
    el.style.setProperty('--c', team.color);
    el.style.left = Math.min(x, innerWidth - 120) + 'px';
    el.style.top = y + 'px';
    el.innerHTML = `${delta > 0 ? '+' : ''}${fmt(delta)}${player ? `<small>${esc(player)}</small>` : ''}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2100);
    if (delta > 0) {
      burst(x, y, team.color, 60 + Math.min(140, delta * 3), 1 + Math.min(1, delta / 50));
      burst(x, y, '#ffffff', 25, 0.7);
    } else {
      burst(x, y, '#ff2a55', 30, 0.6);
    }
  }

  // ------------------------------------------------------------ big-moment FX
  let laserTimer = null;
  function lasers(on, ms) {
    const el = $('#lasers');
    clearTimeout(laserTimer);
    el.classList.toggle('on', !!on);
    if (on && ms) laserTimer = setTimeout(() => el.classList.remove('on'), ms);
  }
  function slam(power = 1) {
    const d = 0.9 * power;
    const shake = [
      { transform: 'translate(0,0)' }, { transform: `translate(${-d}vw, ${d * 0.6}vh)` }, { transform: `translate(${d}vw, ${-d * 0.5}vh)` },
      { transform: `translate(${-d * 0.6}vw, ${-d * 0.3}vh)` }, { transform: `translate(${d * 0.3}vw, ${d * 0.2}vh)` }, { transform: 'translate(0,0)' },
    ];
    $('#board').animate(shake, { duration: 520, easing: 'ease-out' });
    $('.hud').animate(shake, { duration: 520, easing: 'ease-out' });
    $('#flash').animate([{ opacity: Math.min(0.7, 0.45 * power) }, { opacity: 0 }], { duration: 480, easing: 'ease-out' });
  }
  function onBeat(strength) {
    if (document.hidden) return;
    const k = strength === 2 ? 1 : 0.5;
    $('#beatflash').animate([{ opacity: 0.85 * k }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
    $('.floor').animate([{ opacity: Math.min(1, 0.55 + 0.4 * k) }, { opacity: 0.55 }], { duration: 380, easing: 'ease-out' });
    if (strength === 2) $('.title').animate([{ filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: 300 });
  }

  // ------------------------------------------------------------ countdown timer
  let timerEnd = null, timerTotal = 0, timerTick = null, lastSec = null, timeUpFor = null, prevTrack = null;
  const RING = 276.5;
  function setTimer(t) {
    stopTimer(false);
    if (!t) return;
    timerEnd = Date.now() + (t.endsAt - state.now);
    timerTotal = t.total * 1000;
    lastSec = null;
    document.body.classList.add('timing');
    if (GameAudio.musicOn && GameAudio.track !== 'tension' && GameAudio.track !== 'mp3') { prevTrack = GameAudio.track; GameAudio.setTrack('tension'); }
    timerTick = setInterval(updateTimer, 100);
    updateTimer();
  }
  function updateTimer() {
    const rem = Math.max(0, timerEnd - Date.now());
    const secs = Math.ceil(rem / 1000);
    const digits = $('#timerDigits');
    digits.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    $('#timerProg').style.strokeDashoffset = RING * (1 - rem / timerTotal);
    if (secs !== lastSec) {
      lastSec = secs;
      if (secs <= 10 && secs > 0) {
        document.body.classList.add('urgent');
        GameAudio.sfx.beep(secs <= 3);
        digits.classList.remove('tick'); void digits.offsetWidth; digits.classList.add('tick');
      }
    }
    if (rem <= 0) timeUp();
  }
  function stopTimer(restore = true) {
    clearInterval(timerTick); timerTick = null;
    document.body.classList.remove('timing', 'urgent');
    if (restore && prevTrack) { GameAudio.setTrack(prevTrack); prevTrack = null; }
  }
  function timeUp() {
    if (timeUpFor === timerEnd || timerEnd === null) return;
    timeUpFor = timerEnd;
    stopTimer();
    if (!started) return;
    GameAudio.sfx.buzzer();
    slam(1.4);
    enqueue(() => showTakeover({ color: '#ff2a55', kicker: '⏱  ⏱  ⏱', main: "TIME'S UP!", ms: 2600 }));
  }

  // ------------------------------------------------------------ takeovers
  const takeover = $('#takeover');
  async function showTakeover({ color, kicker, main, sub, ms = 4000, sticky = false }) {
    takeover.style.setProperty('--c', color);
    takeover.firstElementChild.innerHTML = `<div class="to-rays"></div>
      <div class="to-kicker">${esc(kicker)}</div>
      <div class="to-main">${esc(main)}</div>
      ${sub ? `<div class="to-sub">${esc(sub)}</div>` : ''}`;
    takeover.classList.add('on');
    if (sticky) return;
    await sleep(ms);
    takeover.classList.remove('on');
    await sleep(400);
  }

  const banner = $('#banner');
  async function showBanner(text, ms = 5000) {
    $('.banner-text', banner).textContent = text;
    banner.classList.remove('off', 'on'); void banner.offsetWidth;
    banner.classList.add('on');
    await sleep(ms);
    banner.classList.add('off');
    await sleep(550);
    banner.classList.remove('on', 'off');
  }

  function leaderTakeover(teamId) {
    enqueue(async () => {
      await sleep(1300); // let the rows finish re-ordering
      const t = teamOf(teamId);
      if (!t || winnerUp) return;
      GameAudio.sfx.impact();
      GameAudio.sfx.fanfare(false);
      slam(1.2);
      lasers(true, 5200);
      confettiColors = [t.color, '#ffffff', t.color, '#ffd34d'];
      confettiUntil = performance.now() + 2500;
      await showTakeover({ color: t.color, kicker: '★ NEW LEADER ★', main: t.name, sub: `${fmt(t.score)} POINTS`, ms: 4200 });
    });
  }

  function winnerFinale() {
    enqueue(async () => {
      winnerUp = true;
      showTakeover({ color: '#ffffff', kicker: 'THE RESULTS ARE IN', main: '. . .', sticky: true });
      const stopRoll = GameAudio.sfx.drumrollLoop();
      const started = performance.now();
      // The announcer builds suspense over the drumroll, then names the champion.
      const ann = await Announcer.waitForWinner(9000);
      if (ann) await Announcer.playLine(ann, 0, 'AND THE WINNER IS');
      const elapsed = performance.now() - started;
      if (elapsed < 2800) await sleep(2800 - elapsed);
      stopRoll();
      GameAudio.sfx.impact();
      GameAudio.sfx.fanfare(true);
      slam(1.6);
      lasers(true);
      const order = sorted(state.teams);
      const tied = order.filter((t) => t.score === order[0].score);
      if (tied.length > 1) {
        confettiColors = tied.map((t) => t.color).concat('#ffffff');
        showTakeover({ color: '#ffd34d', kicker: "IT'S A TIE!", main: tied.map((t) => t.name).join(' & '), sub: `${fmt(order[0].score)} POINTS EACH`, sticky: true });
      } else {
        const t = order[0];
        confettiColors = [t.color, '#ffd34d', '#ffffff', t.color];
        showTakeover({ color: t.color, kicker: '🏆 AND THE WINNER IS 🏆', main: t.name, sub: t.members.join(' · '), sticky: true });
        burst(innerWidth / 2, innerHeight / 2, t.color, 260, 2);
        burst(innerWidth / 2, innerHeight / 2, '#ffd34d', 160, 1.6);
      }
      confettiUntil = performance.now() + 60000;
      if (GameAudio.musicOn && GameAudio.track !== 'mp3') { GameAudio.setTrack('epic'); syncDock(); }
      GameAudio.sfx.applause(6, 1.6);
      setTimeout(() => GameAudio.sfx.airhorn(), 400);
      if (ann) {
        await sleep(1400);
        await Announcer.playLine(ann, 1, 'CHAMPIONS');
        GameAudio.sfx.applause(5, 1.4);
        await sleep(1500);
        Announcer.finish();
      }
    });
  }

  // Streak: a team scored 3 / 5 / 8 times in a row
  function streakMoment(teamId, count) {
    enqueue(async () => {
      const t = teamOf(teamId);
      if (!t || winnerUp) return;
      GameAudio.sfx.fire();
      lasers(true, 3200);
      const r = rows.get(teamId);
      if (r) { const b = r.el.getBoundingClientRect(); for (let i = 0; i < 6; i++) burst(b.left + Math.random() * b.width, b.bottom, EMBER[i % 4], 40, 1.2); }
      await showTakeover({ color: '#ff6a00', kicker: `🔥 ${count} IN A ROW 🔥`, main: count >= 8 ? 'LEGENDARY!' : count >= 5 ? 'UNSTOPPABLE!' : 'ON FIRE!', sub: t.name, ms: 2600 });
    });
  }

  // Cinematic team introductions, choreographed to the announcer's lines
  function introSequence() {
    enqueue(async () => {
      lasers(true);
      const ann = await Announcer.waitFor('intro', 8000);
      const n = state.teams.length;
      GameAudio.sfx.impact(); slam(1);
      confettiColors = state.teams.map((t) => t.color).concat('#ffffff');
      showTakeover({ color: '#ff2bd6', kicker: 'WELCOME TO', main: state.title, sub: state.subtitle, sticky: true });
      if (ann) await Announcer.playLine(ann, 0, 'NOW INTRODUCING'); else await sleep(3000);
      for (let i = 0; i < n; i++) {
        const t = state.teams[i];
        GameAudio.sfx.whoosh();
        await sleep(280);
        GameAudio.sfx.impact(); slam(0.8);
        takeover.style.setProperty('--c', t.color);
        takeover.firstElementChild.innerHTML = `<div class="to-rays"></div>
          <div class="to-kicker">INTRODUCING</div>
          <div class="to-main">${esc(t.name)}</div>
          <div class="to-members">${t.members.map((m, k) => `<span style="animation-delay:${0.6 + k * 0.22}s">${esc(m)}</span>`).join('')}</div>`;
        takeover.classList.add('on');
        burst(innerWidth / 2, innerHeight * 0.45, t.color, 180, 1.6);
        if (ann && ann.lines[i + 1]) await Announcer.playLine(ann, i + 1, 'NOW INTRODUCING'); else await sleep(3600);
        GameAudio.sfx.applause(2.2, 0.9);
        await sleep(600);
      }
      GameAudio.sfx.fanfare(true);
      confettiUntil = performance.now() + 5000;
      slam(1.3);
      showTakeover({ color: '#ffd34d', kicker: '★ ★ ★', main: 'LET THE GAMES BEGIN!', sticky: true });
      if (ann && ann.lines[n + 1]) await Announcer.playLine(ann, n + 1, 'LIVE COMMENTARY'); else await sleep(2600);
      GameAudio.sfx.airhorn(); GameAudio.sfx.applause(4, 1.4);
      await sleep(2200);
      Announcer.finish();
      takeover.classList.remove('on');
      lasers(false);
      await sleep(400);
    });
  }

  function clearOverlays() {
    lasers(false);
    winnerUp = false;
    confettiUntil = 0;
    takeover.classList.remove('on');
    banner.classList.remove('on', 'off');
  }

  // ------------------------------------------------------------ events
  function handle({ state: next, event }) {
    const first = !state;
    state = next;
    const events = (event && event.events) || [];
    const scoreEv = events.filter((e) => e.kind === 'score');
    const highlight = scoreEv.find((e) => e.player)?.player;
    renderHud();
    render(highlight);
    if (first) { if (state.timer) setTimer(state.timer); return; }
    for (const e of events) {
      if (e.kind === 'timer') setTimer(e.timer);
      if (e.kind === 'timeup') timeUp();
    }
    if (!started) return;

    scoreEv.forEach((e, i) => {
      setTimeout(() => {
        const r = rows.get(e.team);
        if (!r || !e.delta) return;
        r.el.classList.remove('hit', 'miss'); void r.el.offsetWidth;
        r.el.classList.add(e.delta > 0 ? 'hit' : 'miss');
        popAt(e.team, e.delta, e.player);
        e.delta > 0 ? GameAudio.sfx.score(e.delta) : GameAudio.sfx.wrong();
        if (e.delta >= 25) { slam(Math.min(1.5, e.delta / 40)); lasers(true, 3000); }
      }, i * 350);
    });

    for (const e of events) {
      switch (e.kind) {
        case 'leader': leaderTakeover(e.team); break;
        case 'round': GameAudio.sfx.round(); enqueue(() => showBanner(e.text, 3600)); break;
        case 'message': GameAudio.sfx.message(); enqueue(() => showBanner(e.text, 6000)); break;
        case 'winner': winnerFinale(); break;
        case 'announce': Announcer.handle(e); break;
        case 'streak': streakMoment(e.team, e.count); break;
        case 'intro': introSequence(); break;
        case 'voice': Announcer.setEnabled(e.on); syncDock(); break;
        case 'game': enqueue(() => showBanner('NOW PLAYING: ' + e.text, 3600)); break;
        case 'clear': clearOverlays(); GameAudio.sfx.whoosh(); break;
        case 'undo': case 'reset': case 'rename': GameAudio.sfx.whoosh(); break;
        case 'music':
          if (e.track === 'next') GameAudio.nextTrack();
          else if (e.track) GameAudio.setTrack(e.track);
          GameAudio.setMusic(e.on);
          syncDock();
          break;
      }
    }
  }

  function connect() {
    const conn = $('#conn');
    const es = new EventSource('events');
    es.onopen = () => { conn.className = 'conn ok'; conn.lastChild.textContent = 'CONNECTED'; };
    es.onmessage = (m) => handle(JSON.parse(m.data));
    es.onerror = () => { conn.className = 'conn bad'; conn.lastChild.textContent = 'RECONNECTING'; };
  }

  // ------------------------------------------------------------ controls
  const btnMusic = $('#btnMusic'), btnSfx = $('#btnSfx'), trackSel = $('#trackSel');
  let lastNp = '';
  function buildTrackList() {
    const opts = GameAudio.tracks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`);
    if (GameAudio.playlist.length) opts.push(`<option value="mp3">My MP3s (${GameAudio.playlist.length})</option>`);
    trackSel.innerHTML = opts.join('');
    trackSel.value = GameAudio.track;
  }
  trackSel.innerHTML = '<option>Synthwave Showdown</option>';
  trackSel.addEventListener('change', () => { GameAudio.setTrack(trackSel.value); if (!GameAudio.musicOn) GameAudio.setMusic(true); syncDock(); });
  function syncDock() {
    $('b', btnMusic).textContent = GameAudio.musicOn ? 'ON' : 'OFF';
    $('b', btnSfx).textContent = GameAudio.sfxOn ? 'ON' : 'OFF';
    if (trackSel.value !== GameAudio.track) buildTrackList();
    const np = GameAudio.musicOn ? '♫ ' + GameAudio.nowPlaying.toUpperCase() : '';
    if (np !== lastNp) { lastNp = np; const el = $('#np'); el.textContent = np; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    $('#btnVoice b').textContent = Announcer.enabled ? 'ON' : 'OFF';
    try { localStorage.setItem('gn-audio', JSON.stringify({ music: GameAudio.musicOn, sfx: GameAudio.sfxOn, vol: $('#vol').value, voice: Announcer.enabled, voiceVol: $('#voiceVol').value, track: GameAudio.track })); } catch {}
  }

  function testFx() {
    if (!state) return;
    const t = sorted(state.teams)[0];
    const r = rows.get(t.id);
    r.el.classList.remove('hit'); void r.el.offsetWidth; r.el.classList.add('hit');
    popAt(t.id, 25, 'TEST');
    GameAudio.sfx.score(25);
    setTimeout(() => leaderTakeover(t.id), 300);
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  $('#dock').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'music') GameAudio.setMusic(!GameAudio.musicOn);
    if (act === 'sfx') GameAudio.setSfx(!GameAudio.sfxOn);
    if (act === 'test') testFx();
    if (act === 'voice') Announcer.setEnabled(!Announcer.enabled);
    if (act === 'testvoice') Announcer.test();
    if (act === 'full') toggleFull();
    if (act === 'load') $('#file').click();
    if (act === 'next') { if (!GameAudio.musicOn) GameAudio.setMusic(true); GameAudio.nextTrack(); }
    syncDock();
  });
  $('#file').addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    GameAudio.addFiles(files.map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), src: URL.createObjectURL(f) })));
    GameAudio.setMusic(true);
    buildTrackList();
    syncDock();
  });
  $('#vol').addEventListener('input', (e) => { GameAudio.setVolume(e.target.value / 100); syncDock(); });
  $('#voiceVol').addEventListener('input', (e) => { GameAudio.setVoiceVolume(e.target.value / 100); syncDock(); });

  addEventListener('keydown', (e) => {
    if (!started) return;
    const k = e.key.toLowerCase();
    if (k === 'f') toggleFull();
    if (k === 'm') GameAudio.setMusic(!GameAudio.musicOn);
    if (k === 'n') { if (!GameAudio.musicOn) GameAudio.setMusic(true); GameAudio.nextTrack(); }
    if (k === 's') GameAudio.setSfx(!GameAudio.sfxOn);
    if (k === 't') testFx();
    if (k === 'a') Announcer.setEnabled(!Announcer.enabled);
    if (k === 'v') Announcer.test();
    if (k === 'escape') clearOverlays();
    syncDock();
  });

  let hideTimer;
  addEventListener('mousemove', () => {
    document.body.classList.add('show-cursor');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 3000);
  });

  async function keepAwake() {
    try {
      const lock = await navigator.wakeLock?.request('screen');
      lock?.addEventListener('release', () => document.visibilityState === 'visible' && keepAwake());
    } catch {}
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());

  $('#startBtn').addEventListener('click', async () => {
    await GameAudio.init();
    started = true;
    $('#start').classList.add('gone');
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('gn-audio') || '{}'); } catch {}
    if (prefs.vol) { $('#vol').value = prefs.vol; }
    GameAudio.setVolume($('#vol').value / 100);
    if (prefs.sfx === false) GameAudio.setSfx(false);
    if (prefs.voiceVol) $('#voiceVol').value = prefs.voiceVol;
    GameAudio.setVoiceVolume($('#voiceVol').value / 100);
    Announcer.setEnabled(prefs.voice !== false && state?.voice !== false);
    GameAudio.onChange(syncDock);
    GameAudio.onBeat(onBeat);
    if (prefs.track && prefs.track !== 'mp3') GameAudio.setTrack(prefs.track);
    // songs dropped into public/music/ become the "My MP3s" playlist
    fetch('api/music').then((r) => r.json()).then((list) => {
      if (list.length) GameAudio.addFiles(list.map((f) => ({ name: f.name, src: f.url })), prefs.track === 'mp3' || !prefs.track);
      buildTrackList(); syncDock();
    }).catch(() => {});
    buildTrackList();
    if (prefs.music) GameAudio.setMusic(true);
    syncDock();
    GameAudio.sfx.impact();
    GameAudio.sfx.fanfare(false);
    confettiUntil = performance.now() + 1500;
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    keepAwake();
  });

  // Keep sound alive: Chrome can pause audio after sleep or when the output
  // device changes (e.g. starting AirPlay). Resume automatically; if the browser
  // insists on a click, say so on screen instead of failing silently.
  const soundWarn = $('#soundwarn');
  async function checkSound() {
    if (!started || !GameAudio.ready) return;
    if (!GameAudio.running) await GameAudio.resume();
    soundWarn.hidden = GameAudio.running;
  }
  setInterval(checkSound, 2000);
  document.addEventListener('visibilitychange', checkSound);
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (started) GameAudio.resume().then(checkSound); }, true));

  // Start screen: QR code to open the host panel on a phone (same Wi-Fi)
  fetch('api/info').then((r) => r.json()).then((info) => {
    const url = info.admin && info.admin[0];
    if (!url) return;
    $('#adminUrl').textContent = url.replace(/^http:\/\//, '');
    $('#startPhone').hidden = false;
    if (window.QRCode) new QRCode($('#qr'), { text: url, width: 120, height: 120, colorDark: '#05060f', colorLight: '#ffffff' });
    else $('#qr').remove();
  }).catch(() => {});

  // ------------------------------------------------------------ boot
  const resize = () => { sizeCanvas(fx); sizeCanvas(amb); };
  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(fxLoop);
  requestAnimationFrame(ambLoop);
  connect();
})();
