'use strict';
// Synthesized game-show audio: every sound effect and the background track are
// generated live with the Web Audio API, so there are no files to load.

const GameAudio = (() => {
  let ctx, master, sfxBus, musicBus, duckGain, comp, delay, delayFb, noiseBuf;
  let sfxOn = true;
  let musicOn = false;
  let musicVol = 0.45;
  let mode = 'synth'; // 'synth' | 'file'
  let fileEl = null, fileNode = null;

  function init() {
    if (ctx) return ctx.resume();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);

    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(duckGain);

    // tempo-synced echo for the arp + sfx sparkle
    delay = ctx.createDelay(1); delay.delayTime.value = (60 / BPM) * 0.75;
    delayFb = ctx.createGain(); delayFb.gain.value = 0.32;
    const delayLp = ctx.createBiquadFilter(); delayLp.type = 'lowpass'; delayLp.frequency.value = 2600;
    delay.connect(delayLp).connect(delayFb).connect(delay);
    const delayOut = ctx.createGain(); delayOut.gain.value = 0.5;
    delayLp.connect(delayOut).connect(musicBus);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx.resume();
  }

  const now = () => ctx.currentTime;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function env(g, t, a, peak, dcy, sus = 0.0001) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dcy);
  }

  function tone({ type = 'sine', freq, t = now(), dur = 0.4, vol = 0.3, attack = 0.005, out = sfxBus, detune = 0, glideTo, filter }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass'; f.frequency.setValueAtTime(filter.freq, t); f.Q.value = filter.q || 1;
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
      node = o.connect(f);
    }
    node.connect(g).connect(out);
    env(g, t, attack, vol, dur);
    o.start(t); o.stop(t + attack + dur + 0.05);
    return g;
  }

  function noise({ t = now(), dur = 0.3, vol = 0.3, type = 'bandpass', freq = 1000, to, q = 1, attack = 0.005, out = sfxBus }) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(out);
    env(g, t, attack, vol, dur);
    s.start(t, Math.random()); s.stop(t + attack + dur + 0.05);
  }

  function bell(freq, t, vol = 0.25, dur = 1.2) {
    tone({ type: 'sine', freq, t, dur, vol });
    tone({ type: 'sine', freq: freq * 2.76, t, dur: dur * 0.4, vol: vol * 0.35 });
    tone({ type: 'triangle', freq: freq * 2, t, dur: dur * 0.6, vol: vol * 0.25 });
  }

  function duck(amount = 0.35, hold = 1.2) {
    if (!musicOn) return;
    const t = now();
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setTargetAtTime(amount, t, 0.05);
    duckGain.gain.setTargetAtTime(1, t + hold, 0.6);
  }

  // ---------------------------------------------------------------- SFX
  const sfx = {
    // rising chime; bigger scores = longer, higher run
    score(delta = 10) {
      if (!ctx || !sfxOn) return;
      duck(0.4, 1.4);
      const t = now() + 0.02;
      const scale = [72, 76, 79, 84, 88, 91, 96, 100];
      const n = Math.min(scale.length, 3 + Math.floor(Math.log2(Math.max(1, Math.abs(delta)))));
      for (let i = 0; i < n; i++) bell(mtof(scale[i]), t + i * 0.07, 0.2, 0.9);
      noise({ t, dur: 0.6, vol: 0.06, type: 'highpass', freq: 6000 }); // sparkle
      tone({ type: 'sine', freq: 140, glideTo: 45, t, dur: 0.35, vol: 0.5 }); // thump
    },
    // game-show buzzer
    wrong() {
      if (!ctx || !sfxOn) return;
      duck(0.3, 1);
      const t = now() + 0.02;
      for (const f of [98, 103.5]) tone({ type: 'square', freq: f, t, dur: 0.75, vol: 0.18, attack: 0.01, filter: { freq: 900 } });
      tone({ type: 'sawtooth', freq: 196, glideTo: 92, t: t + 0.05, dur: 0.7, vol: 0.12, filter: { freq: 1400 } });
    },
    whoosh() {
      if (!ctx || !sfxOn) return;
      const t = now();
      noise({ t, dur: 0.7, vol: 0.32, type: 'bandpass', freq: 250, to: 5000, q: 2.5, attack: 0.25 });
    },
    impact() {
      if (!ctx || !sfxOn) return;
      const t = now();
      tone({ type: 'sine', freq: 110, glideTo: 30, t, dur: 1.2, vol: 0.85 });
      noise({ t, dur: 1.4, vol: 0.25, type: 'lowpass', freq: 3000, to: 200 });
      noise({ t, dur: 2.2, vol: 0.08, type: 'highpass', freq: 7000 });
    },
    tick() {
      if (!ctx || !sfxOn) return;
      tone({ type: 'square', freq: 2400, dur: 0.025, vol: 0.035, filter: { freq: 3500 } });
    },
    // brass-ish fanfare
    fanfare(big = false) {
      if (!ctx || !sfxOn) return;
      duck(0.15, big ? 4 : 2.6);
      const t = now() + 0.05;
      const brass = (notes, at, dur) => {
        for (const m of notes) {
          for (const dt of [-8, 8]) {
            tone({ type: 'sawtooth', freq: mtof(m), t: at, dur, vol: 0.07, attack: 0.04, detune: dt, filter: { freq: 600, to: 3200, q: 2 } });
          }
        }
      };
      const seq = big
        ? [[[60, 64, 67], 0, 0.18], [[60, 64, 67], 0.2, 0.18], [[60, 64, 67], 0.4, 0.18], [[65, 69, 72], 0.62, 0.5], [[67, 71, 74], 1.15, 0.5], [[72, 76, 79, 84], 1.7, 1.8]]
        : [[[67, 71, 74], 0, 0.14], [[67, 71, 74], 0.16, 0.14], [[72, 76, 79], 0.34, 1.2]];
      for (const [notes, off, dur] of seq) brass(notes, t + off, dur);
      const end = t + seq[seq.length - 1][1];
      noise({ t: end, dur: 2.5, vol: 0.14, type: 'highpass', freq: 5000 }); // cymbal
      tone({ type: 'sine', freq: 65, glideTo: 40, t: end, dur: 1, vol: 0.6 });
    },
    drumroll(seconds = 2.4) {
      if (!ctx || !sfxOn) return;
      duck(0.2, seconds + 3);
      const t = now();
      let x = 0;
      while (x < seconds) {
        const p = x / seconds;
        noise({ t: t + x, dur: 0.07, vol: 0.08 + p * 0.22, type: 'bandpass', freq: 1800, q: 0.8 });
        x += 0.055 - p * 0.02;
      }
    },
    round() {
      if (!ctx || !sfxOn) return;
      sfx.whoosh();
      const t = now() + 0.35;
      [60, 67, 72].forEach((m, i) => bell(mtof(m), t + i * 0.12, 0.22, 1.4));
    },
    message() {
      if (!ctx || !sfxOn) return;
      sfx.whoosh();
      const t = now() + 0.3;
      bell(mtof(84), t, 0.18); bell(mtof(91), t + 0.12, 0.18);
    },
  };

  // ------------------------------------------------------------- music
  // Driving synthwave loop: Am – F – C – G at 112bpm, 16 steps per bar.
  const BPM = 112;
  const STEP = 60 / BPM / 4;
  const CHORDS = [
    { root: 45, notes: [57, 60, 64] }, // Am
    { root: 41, notes: [53, 57, 60] }, // F
    { root: 48, notes: [55, 60, 64] }, // C
    { root: 43, notes: [55, 59, 62] }, // G
  ];
  let step = 0, nextTime = 0, timer = null;

  function scheduleStep(s, t) {
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    const chord = CHORDS[bar];
    const bus = musicBus;
    const section = Math.floor(s / 64) % 4; // vary every 4 bars

    // kick
    if (i % 4 === 0) {
      tone({ type: 'sine', freq: 150, glideTo: 42, t, dur: 0.28, vol: 0.75, out: bus });
    }
    // snare / clap on 2 & 4
    if (i === 4 || i === 12) {
      noise({ t, dur: 0.18, vol: 0.22, type: 'bandpass', freq: 1900, q: 0.7, out: bus });
      tone({ type: 'triangle', freq: 190, glideTo: 140, t, dur: 0.1, vol: 0.15, out: bus });
    }
    // hats
    if (i % 2 === 1) noise({ t, dur: 0.04, vol: 0.06, type: 'highpass', freq: 8000, out: bus });
    if (section > 0 && i % 4 === 2) noise({ t, dur: 0.12, vol: 0.04, type: 'highpass', freq: 7000, out: bus });
    // bass: driving 8ths with octave jumps
    if (i % 2 === 0) {
      const m = chord.root - 12 + (i % 4 === 2 ? 12 : 0);
      tone({ type: 'sawtooth', freq: mtof(m), t, dur: STEP * 1.6, vol: 0.16, out: bus, filter: { freq: 380, to: 160, q: 6 } });
    }
    // arp (16ths) into echo
    if (section !== 1 || i < 8) {
      const pattern = [0, 1, 2, 1, 0, 1, 2, 3];
      const idx = pattern[i % 8];
      const m = idx === 3 ? chord.notes[0] + 12 : chord.notes[idx] + 12;
      const g = tone({ type: 'square', freq: mtof(m), t, dur: STEP * 0.9, vol: 0.035, out: bus, filter: { freq: 2400, q: 1 } });
      g.connect(delay);
    }
    // pad at the start of each bar
    if (i === 0) {
      for (const m of chord.notes) {
        for (const dt of [-12, 12]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = dt;
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
          const gg = ctx.createGain();
          o.connect(f).connect(gg).connect(bus);
          const len = STEP * 16;
          gg.gain.setValueAtTime(0.0001, t);
          gg.gain.exponentialRampToValueAtTime(0.022, t + 0.6);
          gg.gain.setValueAtTime(0.022, t + len - 0.3);
          gg.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.2);
          o.start(t); o.stop(t + len + 0.3);
        }
      }
      // lead hook every other phrase
      if (section >= 2) {
        const hook = [[0, chord.notes[2] + 12, 3], [4, chord.notes[1] + 12, 2], [7, chord.notes[2] + 12, 5]];
        for (const [st, m, len] of hook) {
          tone({ type: 'sawtooth', freq: mtof(m), t: t + st * STEP, dur: STEP * len, vol: 0.05, attack: 0.02, out: bus, filter: { freq: 1800, q: 2 } });
        }
      }
    }
  }

  function pump() {
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextTime);
      nextTime += STEP;
      step++;
    }
  }

  function startSynth() {
    if (timer) return;
    step = 0; nextTime = ctx.currentTime + 0.1;
    timer = setInterval(pump, 25);
  }
  function stopSynth() { clearInterval(timer); timer = null; }

  function applyMusic() {
    if (!ctx) return;
    const t = now();
    musicBus.gain.cancelScheduledValues(t);
    if (musicOn) {
      if (mode === 'synth') { if (fileEl) fileEl.pause(); startSynth(); }
      else { stopSynth(); fileEl && fileEl.play().catch(() => {}); }
      musicBus.gain.setTargetAtTime(musicVol * 0.9, t, 0.4);
    } else {
      musicBus.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => { if (!musicOn) { stopSynth(); fileEl && fileEl.pause(); } }, 1500);
    }
  }

  function loadFile(src) {
    if (!ctx) return;
    if (!fileEl) {
      fileEl = new window.Audio();
      fileEl.loop = true;
      fileEl.crossOrigin = 'anonymous';
      fileNode = ctx.createMediaElementSource(fileEl);
      fileNode.connect(musicBus);
    }
    fileEl.src = src;
    mode = 'file';
    applyMusic();
  }

  return {
    init,
    sfx,
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },
    get mode() { return mode; },
    get hasFile() { return !!(fileEl && fileEl.src); },
    setSfx(v) { sfxOn = v; },
    setMusic(v) { musicOn = v; applyMusic(); },
    setVolume(v) { musicVol = v; if (ctx && musicOn) musicBus.gain.setTargetAtTime(v * 0.9, now(), 0.1); },
    setMode(m) { mode = m; applyMusic(); },
    loadFile,
  };
})();
