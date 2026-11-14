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
    el.innerHTML = `
      <div class="row-glow"></div>
      <div class="rank"><span class="rank-n">1</span><sup>ST</sup></div>
      <div class="info">
        <div class="name-line"><div class="team-name"></div><div class="crown">👑</div></div>
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

  function fxLoop() {
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    if (performance.now() < confettiUntil && parts.length < 600) confetti(4);
    fctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.kind === 'spark') {
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
      confettiColors = [t.color, '#ffffff', t.color, '#ffd34d'];
      confettiUntil = performance.now() + 2500;
      await showTakeover({ color: t.color, kicker: '★ NEW LEADER ★', main: t.name, sub: `${fmt(t.score)} POINTS`, ms: 4200 });
    });
  }

  function winnerFinale(teamId) {
    enqueue(async () => {
      winnerUp = true;
      const order = sorted(state.teams);
      const tied = order.filter((t) => t.score === order[0].score);
      showTakeover({ color: '#ffffff', kicker: 'THE RESULTS ARE IN', main: '. . .', sticky: true });
      GameAudio.sfx.drumroll(2.6);
      await sleep(2700);
      GameAudio.sfx.impact();
      GameAudio.sfx.fanfare(true);
      if (tied.length > 1) {
        confettiColors = tied.map((t) => t.color).concat('#ffffff');
        showTakeover({ color: '#ffd34d', kicker: "IT'S A TIE!", main: tied.map((t) => t.name).join(' & '), sub: `${fmt(order[0].score)} POINTS EACH`, sticky: true });
      } else {
        const t = order[0];
        confettiColors = [t.color, '#ffd34d', '#ffffff', t.color];
        showTakeover({ color: t.color, kicker: '🏆 AND THE WINNER IS 🏆', main: t.name, sub: t.members.join(' · '), sticky: true });
        const rect = innerWidth / 2;
        burst(rect, innerHeight / 2, t.color, 260, 2);
        burst(rect, innerHeight / 2, '#ffd34d', 160, 1.6);
      }
      confettiUntil = performance.now() + 60000;
    });
  }

  function clearOverlays() {
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
    if (first || !started) return;

    scoreEv.forEach((e, i) => {
      setTimeout(() => {
        const r = rows.get(e.team);
        if (!r || !e.delta) return;
        r.el.classList.remove('hit', 'miss'); void r.el.offsetWidth;
        r.el.classList.add(e.delta > 0 ? 'hit' : 'miss');
        popAt(e.team, e.delta, e.player);
        e.delta > 0 ? GameAudio.sfx.score(e.delta) : GameAudio.sfx.wrong();
      }, i * 350);
    });

    for (const e of events) {
      switch (e.kind) {
        case 'leader': leaderTakeover(e.team); break;
        case 'round': GameAudio.sfx.round(); enqueue(() => showBanner(e.text, 3600)); break;
        case 'message': GameAudio.sfx.message(); enqueue(() => showBanner(e.text, 6000)); break;
        case 'winner': winnerFinale(e.team); break;
        case 'clear': clearOverlays(); GameAudio.sfx.whoosh(); break;
        case 'undo': case 'reset': case 'rename': GameAudio.sfx.whoosh(); break;
        case 'music': GameAudio.setMusic(e.on); syncDock(); break;
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
  const btnMusic = $('#btnMusic'), btnSfx = $('#btnSfx'), btnTrack = $('#btnTrack');
  function syncDock() {
    $('b', btnMusic).textContent = GameAudio.musicOn ? 'ON' : 'OFF';
    $('b', btnSfx).textContent = GameAudio.sfxOn ? 'ON' : 'OFF';
    $('b', btnTrack).textContent = GameAudio.mode === 'file' ? 'MP3' : 'SYNTH';
    try { localStorage.setItem('gn-audio', JSON.stringify({ music: GameAudio.musicOn, sfx: GameAudio.sfxOn, vol: $('#vol').value })); } catch {}
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
    if (act === 'full') toggleFull();
    if (act === 'load') $('#file').click();
    if (act === 'track') {
      if (GameAudio.mode === 'synth' && !GameAudio.hasFile) $('#file').click();
      else GameAudio.setMode(GameAudio.mode === 'synth' ? 'file' : 'synth');
    }
    syncDock();
  });
  $('#file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    GameAudio.loadFile(URL.createObjectURL(f));
    GameAudio.setMusic(true);
    syncDock();
  });
  $('#vol').addEventListener('input', (e) => { GameAudio.setVolume(e.target.value / 100); syncDock(); });

  addEventListener('keydown', (e) => {
    if (!started) return;
    const k = e.key.toLowerCase();
    if (k === 'f') toggleFull();
    if (k === 'm') GameAudio.setMusic(!GameAudio.musicOn);
    if (k === 's') GameAudio.setSfx(!GameAudio.sfxOn);
    if (k === 't') testFx();
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
    // optional bundled track: drop a file named music.mp3 into /public
    fetch('music.mp3', { method: 'HEAD' }).then((r) => { if (r.ok) { GameAudio.loadFile('music.mp3'); syncDock(); } }).catch(() => {});
    if (prefs.music) GameAudio.setMusic(true);
    syncDock();
    GameAudio.sfx.impact();
    GameAudio.sfx.fanfare(false);
    confettiUntil = performance.now() + 1500;
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    keepAwake();
  });

  // ------------------------------------------------------------ boot
  const resize = () => { sizeCanvas(fx); sizeCanvas(amb); };
  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(fxLoop);
  requestAnimationFrame(ambLoop);
  connect();
})();
