'use strict';
// Plays the announcer: a stinger sound, then the voice through the broadcast
// chain, with an ON AIR caption bar, a live voice spectrum, and the team being
// talked about lit up. Uses premium server audio when available, otherwise
// the browser's own speech voice.

const Announcer = (() => {
  const $ = (s) => document.querySelector(s);
  let enabled = true;
  const queue = [];
  let busy = false;
  let pendingWinner = null;
  let winnerWaiter = null;
  let fakeLevel = 0; // drives the meter when using browser speech

  // -------------------------------------------------------------- loading
  function prepare(ann) {
    ann.ready = Promise.all(
      ann.lines.map(async (line) => {
        if (ann.tts !== 'server') return null;
        try {
          const res = await fetch('api/tts/' + line.id);
          if (!res.ok) return null;
          return await GameAudio.decode(await res.arrayBuffer());
        } catch (e) {
          console.warn('TTS clip failed, using browser voice', e);
          return null;
        }
      })
    );
    return ann;
  }

  // -------------------------------------------------------------- browser voice
  let chosenVoice = null;
  function pickVoice() {
    const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    const prefs = [/premium/i, /enhanced/i, /^daniel/i, /google uk english male/i, /^arthur/i, /^aaron/i, /^alex$/i, /^fred/i, /male/i];
    for (const re of prefs) {
      const v = voices.find((x) => re.test(x.name));
      if (v) return v;
    }
    return voices[0] || null;
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = () => { chosenVoice = pickVoice(); };
    chosenVoice = pickVoice();
  }

  function speakBrowser(text, mood) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      if (chosenVoice) u.voice = chosenVoice;
      u.rate = mood === 'suspense' ? 0.88 : 1.06;
      u.pitch = mood === 'suspense' ? 0.8 : 1.0;
      u.volume = 1;
      const words = splitWords(text);
      let shown = 0;
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        let pos = 0;
        shown = words.findIndex((w) => (pos += w.length + 1) > e.charIndex) + 1 || shown;
        renderCaption(words, shown);
        fakeLevel = 1;
      };
      const done = () => { renderCaption(words, words.length); resolve(); };
      u.onend = done; u.onerror = done;
      GameAudio.duck(0.22, Math.max(2, text.length / 13));
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      setTimeout(done, 4000 + text.length * 120); // safety net
    });
  }

  // -------------------------------------------------------------- captions
  const bar = $('#onair');
  const caption = $('#onairText');
  const splitWords = (t) => t.split(/\s+/).filter(Boolean);

  function renderCaption(words, shown) {
    caption.innerHTML = words.map((w, i) => `<span class="${i < shown ? 'on' : ''}">${w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</span>`).join(' ');
  }

  function timedCaption(text, seconds) {
    const words = splitWords(text);
    const total = words.reduce((a, w) => a + w.length + 2, 0);
    let acc = 0;
    renderCaption(words, 0);
    const timers = words.map((w, i) => {
      const at = (acc / total) * seconds * 0.92 * 1000;
      acc += w.length + 2;
      return setTimeout(() => renderCaption(words, i + 1), at);
    });
    return () => { timers.forEach(clearTimeout); renderCaption(words, words.length); };
  }

  function showBar(label) {
    $('#onairLabel').textContent = label || 'LIVE COMMENTARY';
    bar.classList.remove('out'); bar.classList.add('on');
  }
  function hideBar() {
    bar.classList.add('out');
    setTimeout(() => bar.classList.remove('on', 'out'), 600);
  }

  // -------------------------------------------------------------- meter
  const viz = $('#onairViz');
  const vctx = viz.getContext('2d');
  const bins = new Uint8Array(128);
  function drawViz() {
    const w = (viz.width = viz.clientWidth * 2);
    const h = (viz.height = viz.clientHeight * 2);
    vctx.clearRect(0, 0, w, h);
    if (bar.classList.contains('on')) {
      const a = GameAudio.analyser;
      const n = 28;
      if (a) a.getByteFrequencyData(bins);
      fakeLevel *= 0.93;
      for (let i = 0; i < n; i++) {
        let v = a ? bins[2 + Math.floor(i * 1.6)] / 255 : 0;
        if (v < 0.02 && fakeLevel > 0.05) v = fakeLevel * (0.3 + Math.random() * 0.7) * (1 - i / n);
        const bh = Math.max(3, v * h * 0.95);
        const x = (i / n) * w;
        const g = vctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, '#ff2bd6'); g.addColorStop(1, '#00e5ff');
        vctx.fillStyle = g;
        vctx.fillRect(x + 2, (h - bh) / 2, w / n - 5, bh);
      }
    }
    requestAnimationFrame(drawViz);
  }
  requestAnimationFrame(drawViz);

  // -------------------------------------------------------------- playback
  async function playLine(ann, i, label) {
    const line = ann.lines[i];
    if (!line) return;
    const clips = await ann.ready;
    showBar(label);
    spotlight(ann.team, true);
    if (clips[i]) {
      const stop = timedCaption(line.text, clips[i].duration);
      await GameAudio.playVoice(clips[i]);
      stop();
    } else {
      await speakBrowser(line.text, i === 0 && ann.type === 'winner' ? 'suspense' : ann.mood);
    }
  }

  function spotlight(teamId, on) {
    document.querySelectorAll('.row.talking').forEach((r) => r.classList.remove('talking'));
    if (on && teamId) document.querySelector(`.row[data-team="${teamId}"]`)?.classList.add('talking');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function perform(ann) {
    const s = GameAudio.sfx;
    // lead-in
    if (ann.mood === 'hype') await s.riser(1.2);
    else if (ann.mood === 'round') await s.boomBoom();
    else if (ann.mood === 'correction') { s.recordScratch(); await sleep(600); }
    else if (ann.mood === 'score' || ann.mood === 'message') await s.newsSting();
    else if (ann.mood === 'say') { s.whoosh(); await sleep(300); }

    for (let i = 0; i < ann.lines.length; i++) await playLine(ann, i);

    // payoff
    if (ann.mood === 'hype') { s.airhorn(); s.applause(4, 1.3); }
    else if (ann.mood === 'round') s.applause(3, 1);
    else if (ann.mood === 'score') s.applause(2, 0.6);
    else if (ann.mood === 'ouch') s.sadTrombone();
    await sleep(900);
    spotlight(null, false);
    hideBar();
    await sleep(500);
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const ann = queue.shift();
      try { await perform(ann); } catch (e) { console.error(e); hideBar(); }
    }
    busy = false;
  }

  return {
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = v;
      if (!v) { queue.length = 0; if ('speechSynthesis' in window) speechSynthesis.cancel(); }
    },
    handle(ann) {
      if (!enabled || !GameAudio.ready) return;
      prepare(ann);
      if (ann.type === 'winner') {
        if (winnerWaiter) { winnerWaiter(ann); winnerWaiter = null; } else pendingWinner = ann;
        return;
      }
      queue.push(ann);
      // never fall far behind the action: keep only the latest few
      while (queue.length > 3) queue.shift();
      pump();
    },
    // The finale asks for the winner announcement and waits for it.
    waitForWinner(ms) {
      if (!enabled) return Promise.resolve(null);
      if (pendingWinner) { const a = pendingWinner; pendingWinner = null; return Promise.resolve(a); }
      return new Promise((resolve) => {
        winnerWaiter = resolve;
        setTimeout(() => { if (winnerWaiter === resolve) { winnerWaiter = null; resolve(null); } }, ms);
      });
    },
    playLine,
    finish() { spotlight(null, false); hideBar(); },
    test() {
      if (!GameAudio.ready) return;
      const ann = { type: 'say', mood: 'hype', team: null, tts: 'browser', lines: [{ text: 'Testing, testing! Is this thing on? Welcome to Games Night!' }] };
      prepare(ann);
      queue.push(ann);
      pump();
    },
  };
})();
