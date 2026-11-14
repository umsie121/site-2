'use strict';
// Synthesized game-show audio: every sound effect and the background track are
// generated live with the Web Audio API, so there are no files to load.

const GameAudio = (() => {
  let ctx, master, sfxBus, musicBus, duckGain, comp, delay, delayFb, noiseBuf;
  let voiceIn, voiceOut, analyser;
  let voiceVol = 1;
  let sfxOn = true;
  let musicOn = false;
  let musicVol = 0.45;

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
    delay = ctx.createDelay(1); delay.delayTime.value = 0.4;
    delayFb = ctx.createGain(); delayFb.gain.value = 0.32;
    const delayLp = ctx.createBiquadFilter(); delayLp.type = 'lowpass'; delayLp.frequency.value = 2600;
    delay.connect(delayLp).connect(delayFb).connect(delay);
    const delayOut = ctx.createGain(); delayOut.gain.value = 0.5;
    delayLp.connect(delayOut).connect(musicBus);

    buildVoiceChain();

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


  // ------------------------------------------------------- announcer voice
  // Broadcast chain: high-pass, presence boost, heavy compression, then an
  // arena reverb and a slapback echo so the TTS voice sounds like a PA system.
  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function buildVoiceChain() {
    voiceIn = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 95;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 180; body.gain.value = 2.5; body.Q.value = 0.8;
    const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.gain.value = 4.5; presence.Q.value = 0.9;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 3;
    const vcomp = ctx.createDynamicsCompressor();
    vcomp.threshold.value = -26; vcomp.knee.value = 6; vcomp.ratio.value = 6; vcomp.attack.value = 0.004; vcomp.release.value = 0.18;
    voiceOut = ctx.createGain(); voiceOut.gain.value = voiceVol * 1.35;
    voiceIn.connect(hp).connect(body).connect(presence).connect(air).connect(vcomp).connect(voiceOut);

    voiceOut.connect(master); // dry
    const verb = ctx.createConvolver(); verb.buffer = impulse(2.6, 3.2);
    const verbGain = ctx.createGain(); verbGain.gain.value = 0.2;
    voiceOut.connect(verb).connect(verbGain).connect(master);
    const slap = ctx.createDelay(1); slap.delayTime.value = 0.14;
    const slapFb = ctx.createGain(); slapFb.gain.value = 0.22;
    const slapLp = ctx.createBiquadFilter(); slapLp.type = 'lowpass'; slapLp.frequency.value = 3000;
    const slapGain = ctx.createGain(); slapGain.gain.value = 0.16;
    voiceOut.connect(slap); slap.connect(slapLp).connect(slapFb).connect(slap);
    slapLp.connect(slapGain).connect(master);

    analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.7;
    vcomp.connect(analyser);
  }

  async function decode(arrayBuffer) {
    return ctx.decodeAudioData(arrayBuffer);
  }

  // Play a decoded voice clip through the broadcast chain; resolves when done.
  function playVoice(buffer) {
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(voiceIn);
      duck(0.22, buffer.duration + 0.4);
      src.onended = resolve;
      src.start();
    });
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

    // whoosh up into an impact: the big-moment lead-in
    riser(len = 1.3) {
      if (!ctx || !sfxOn) return Promise.resolve();
      const t = now();
      noise({ t, dur: len, vol: 0.28, type: 'bandpass', freq: 200, to: 7000, q: 1.8, attack: len * 0.9 });
      tone({ type: 'sawtooth', freq: 110, glideTo: 880, t, dur: len, vol: 0.05, attack: len * 0.8, filter: { freq: 400, to: 5000, q: 4 } });
      tone({ type: 'sine', freq: 220, glideTo: 1320, t, dur: len, vol: 0.06, attack: len * 0.8 });
      return new Promise((r) => setTimeout(() => { sfx.impact(); r(); }, len * 1000));
    },
    // stadium air horn: BWAH BWAH BWAAAAH
    airhorn() {
      if (!ctx || !sfxOn) return;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 4); }
      shaper.curve = curve;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0.11;
      shaper.connect(bp).connect(g).connect(sfxBus);
      const t0 = now() + 0.02;
      [[0, 0.16], [0.22, 0.16], [0.44, 0.9]].forEach(([off, len]) => {
        for (const f of [466, 470.5, 233, 349]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.setValueAtTime(f * 0.94, t0 + off);
          o.frequency.exponentialRampToValueAtTime(f, t0 + off + 0.05);
          const og = ctx.createGain();
          og.gain.setValueAtTime(0.0001, t0 + off);
          og.gain.exponentialRampToValueAtTime(0.5, t0 + off + 0.02);
          og.gain.setValueAtTime(0.5, t0 + off + len - 0.03);
          og.gain.exponentialRampToValueAtTime(0.0001, t0 + off + len);
          o.connect(og).connect(shaper);
          o.start(t0 + off); o.stop(t0 + off + len + 0.05);
        }
      });
    },
    // synthesized crowd: hundreds of hand claps + cheer swell + whistles
    applause(seconds = 3.5, size = 1) {
      if (!ctx || !sfxOn) return;
      const t0 = now();
      const claps = Math.floor(seconds * 260 * size);
      for (let i = 0; i < claps; i++) {
        const at = Math.random() * seconds;
        const fade = at < seconds * 0.15 ? at / (seconds * 0.15) : at > seconds * 0.6 ? 1 - (at - seconds * 0.6) / (seconds * 0.4) : 1;
        noise({ t: t0 + at, dur: 0.02 + Math.random() * 0.02, vol: 0.05 * fade * (0.4 + Math.random()), type: 'bandpass', freq: 900 + Math.random() * 1800, q: 1.2, attack: 0.001 });
      }
      noise({ t: t0, dur: seconds, vol: 0.06 * size, type: 'bandpass', freq: 700, q: 0.5, attack: seconds * 0.25 });
      for (let i = 0; i < 3 * size; i++) {
        const at = t0 + 0.2 + Math.random() * seconds * 0.6;
        const f = 1700 + Math.random() * 900;
        tone({ type: 'sine', freq: f, glideTo: f * 1.45, t: at, dur: 0.35, vol: 0.035, attack: 0.03 });
      }
    },
    // wah wah wah waaaah
    sadTrombone() {
      if (!ctx || !sfxOn) return;
      duck(0.3, 2.6);
      const t0 = now() + 0.05;
      [[62, 0, 0.42], [61, 0.45, 0.42], [60, 0.9, 0.42], [59, 1.35, 1.2]].forEach(([m, off, len], i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m - 12);
        if (i === 3) {
          const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
          const lg = ctx.createGain(); lg.gain.value = 6;
          lfo.connect(lg).connect(o.frequency); lfo.start(t0 + off + 0.25); lfo.stop(t0 + off + len);
        }
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 5;
        f.frequency.setValueAtTime(300, t0 + off);
        f.frequency.linearRampToValueAtTime(1400, t0 + off + 0.15);
        f.frequency.linearRampToValueAtTime(500, t0 + off + len);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + off);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + off + 0.05);
        g.gain.setValueAtTime(0.22, t0 + off + len - 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + len);
        o.connect(f).connect(g).connect(sfxBus);
        o.start(t0 + off); o.stop(t0 + off + len + 0.05);
      });
    },
    // big game-show buzzer for TIME'S UP
    buzzer() {
      if (!ctx || !sfxOn) return;
      duck(0.1, 1.8);
      const t = now() + 0.01;
      for (const f of [146.8, 155.6, 293.7]) tone({ type: 'square', freq: f, t, dur: 1.3, vol: 0.16, attack: 0.01, filter: { freq: 1800 } });
      tone({ type: 'sawtooth', freq: 73.4, t, dur: 1.3, vol: 0.2, filter: { freq: 600 } });
    },
    // countdown beep (urgent = last 3 seconds)
    beep(urgent = false) {
      if (!ctx || !sfxOn) return;
      tone({ type: 'square', freq: urgent ? 1320 : 990, dur: urgent ? 0.18 : 0.08, vol: urgent ? 0.09 : 0.05, filter: { freq: 4000 } });
    },
    // crackling flames for streaks
    fire() {
      if (!ctx || !sfxOn) return;
      const t = now();
      noise({ t, dur: 1.4, vol: 0.25, type: 'lowpass', freq: 600, to: 3000, attack: 0.3 });
      for (let i = 0; i < 40; i++) noise({ t: t + Math.random() * 1.5, dur: 0.015, vol: 0.12 * Math.random(), type: 'highpass', freq: 3000, attack: 0.001 });
      tone({ type: 'sine', freq: 80, glideTo: 220, t, dur: 0.9, vol: 0.35, attack: 0.2 });
    },
    recordScratch() {
      if (!ctx || !sfxOn) return;
      duck(0.05, 1.2);
      const t = now();
      noise({ t, dur: 0.25, vol: 0.3, type: 'bandpass', freq: 3000, to: 400, q: 3 });
      tone({ type: 'sawtooth', freq: 900, glideTo: 120, t, dur: 0.25, vol: 0.1, filter: { freq: 2500 } });
      noise({ t: t + 0.28, dur: 0.15, vol: 0.18, type: 'bandpass', freq: 500, to: 2500, q: 3 });
    },
    // three big drum hits
    boomBoom() {
      if (!ctx || !sfxOn) return Promise.resolve();
      duck(0.2, 1.8);
      const t = now() + 0.02;
      [0, 0.32, 0.64].forEach((off, i) => {
        tone({ type: 'sine', freq: 130 - i * 15, glideTo: 38, t: t + off, dur: 0.6, vol: 0.9 });
        noise({ t: t + off, dur: 0.35, vol: 0.2, type: 'lowpass', freq: 2500, to: 200 });
      });
      return new Promise((r) => setTimeout(r, 950));
    },
    // short TV-news stab
    newsSting() {
      if (!ctx || !sfxOn) return Promise.resolve();
      duck(0.3, 1.2);
      const t = now() + 0.02;
      const stab = (notes, at, len) => notes.forEach((m) => [-7, 7].forEach((dt) =>
        tone({ type: 'sawtooth', freq: mtof(m), t: at, dur: len, vol: 0.05, attack: 0.01, detune: dt, filter: { freq: 3500, to: 900, q: 1.5 } })));
      stab([67, 71, 74, 79], t, 0.12);
      stab([72, 76, 79, 84], t + 0.14, 0.45);
      tone({ type: 'sine', freq: 90, glideTo: 45, t, dur: 0.3, vol: 0.5 });
      return new Promise((r) => setTimeout(r, 520));
    },
    // drumroll that keeps going until stop() is called
    drumrollLoop() {
      if (!ctx || !sfxOn) return () => {};
      const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(sfxBus);
      let stopped = false;
      let at = now();
      const t0 = at;
      const pump = () => {
        if (stopped) return;
        while (at < now() + 0.3) {
          const p = Math.min(1, (at - t0) / 6);
          noise({ t: at, dur: 0.06, vol: 0.09 + p * 0.2, type: 'bandpass', freq: 1700, q: 0.8, out: bus });
          at += 0.05 - p * 0.012;
        }
        duck(0.2, 0.5);
      };
      const timer = setInterval(pump, 100); pump();
      return () => {
        stopped = true; clearInterval(timer);
        bus.gain.setTargetAtTime(0, now(), 0.03);
      };
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
  // Six live-generated tracks (16 steps per bar), plus a playlist of your own
  // MP3s. Switching crossfades; everything ducks under the announcer.
  const bus = () => musicBus;
  const kick = (t, vol = 0.75) => tone({ type: 'sine', freq: 150, glideTo: 42, t, dur: 0.28, vol, out: bus() });
  const snare = (t, vol = 0.22) => {
    noise({ t, dur: 0.18, vol, type: 'bandpass', freq: 1900, q: 0.7, out: bus() });
    tone({ type: 'triangle', freq: 190, glideTo: 140, t, dur: 0.1, vol: vol * 0.7, out: bus() });
  };
  const hat = (t, vol = 0.06, open = false) => noise({ t, dur: open ? 0.18 : 0.04, vol, type: 'highpass', freq: 8000, out: bus() });
  function pad(notes, t, len, { vol = 0.022, cutoff = 900, type = 'sawtooth', attack = 0.6, detune = 12 } = {}) {
    for (const m of notes) {
      for (const dt of [-detune, detune]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = dt;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
        const g = ctx.createGain();
        o.connect(f).connect(g).connect(bus());
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + attack);
        g.gain.setValueAtTime(vol, t + Math.max(attack, len - 0.3));
        g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.2);
        o.start(t); o.stop(t + len + 0.3);
      }
    }
  }

  const TRACKS = {
    // Driving retro synthwave: Am – F – C – G
    synth: {
      name: 'Synthwave Showdown', bpm: 112,
      step(s, t, S) {
        const CH = [{ root: 45, notes: [57, 60, 64] }, { root: 41, notes: [53, 57, 60] }, { root: 48, notes: [55, 60, 64] }, { root: 43, notes: [55, 59, 62] }];
        const bar = Math.floor(s / 16) % 4, i = s % 16, sec = Math.floor(s / 64) % 4, c = CH[bar];
        if (i % 4 === 0) kick(t);
        if (i === 4 || i === 12) snare(t);
        if (i % 2 === 1) hat(t);
        if (sec > 0 && i % 4 === 2) hat(t, 0.04, true);
        if (i % 2 === 0) tone({ type: 'sawtooth', freq: mtof(c.root - 12 + (i % 4 === 2 ? 12 : 0)), t, dur: S * 1.6, vol: 0.16, out: bus(), filter: { freq: 380, to: 160, q: 6 } });
        if (sec !== 1 || i < 8) {
          const idx = [0, 1, 2, 1, 0, 1, 2, 3][i % 8];
          tone({ type: 'square', freq: mtof(idx === 3 ? c.notes[0] + 12 : c.notes[idx] + 12), t, dur: S * 0.9, vol: 0.035, out: bus(), filter: { freq: 2400 } }).connect(delay);
        }
        if (i === 0) {
          pad(c.notes, t, S * 16);
          if (sec >= 2) for (const [st, m, len] of [[0, c.notes[2] + 12, 3], [4, c.notes[1] + 12, 2], [7, c.notes[2] + 12, 5]])
            tone({ type: 'sawtooth', freq: mtof(m), t: t + st * S, dur: S * len, vol: 0.05, attack: 0.02, out: bus(), filter: { freq: 1800, q: 2 } });
        }
      },
    },

    // Slap bass, chicken-scratch guitar, brass stabs: classic TV game show
    funk: {
      name: 'Game Show Funk', bpm: 108,
      step(s, t, S) {
        const bar = Math.floor(s / 16) % 4, i = s % 16, sec = Math.floor(s / 64) % 4;
        const r = [40, 40, 45, 47][bar];
        if ([0, 3, 8, 10].includes(i)) kick(t, i === 0 ? 0.8 : 0.55);
        if (i === 4 || i === 12) snare(t, 0.26);
        if (i === 7 || i === 15) snare(t, 0.05);
        hat(t, i % 2 ? 0.07 : 0.03);
        if (i === 14 && sec % 2) hat(t, 0.05, true);
        const bass = { 0: 0, 3: 12, 6: 0, 8: 0, 10: 10, 11: 12, 14: 7 };
        if (i in bass) tone({ type: 'sawtooth', freq: mtof(r - 12 + bass[i]), t, dur: S * 1.2, vol: 0.2, out: bus(), filter: { freq: 1300, to: 220, q: 8 } });
        if (i % 4 === 2) for (const n of [r + 27, r + 31, r + 34]) tone({ type: 'square', freq: mtof(n), t, dur: 0.05, vol: 0.018, out: bus(), filter: { type: 'bandpass', freq: 1800, q: 3 } });
        if ((bar === 1 || bar === 3) && (i === 12 || i === 14))
          for (const n of [r + 16, r + 19, r + 22, r + 26]) for (const dt of [-8, 8])
            tone({ type: 'sawtooth', freq: mtof(n), t, dur: i === 14 ? S * 3 : S * 0.8, vol: 0.032, attack: 0.01, detune: dt, out: bus(), filter: { freq: 900, to: 3000, q: 1.5 } });
        if (i === 0 && sec >= 1) pad([r + 15, r + 19, r + 22, r + 26], t, S * 16, { vol: 0.011, cutoff: 1600, type: 'square', detune: 6, attack: 0.05 });
      },
    },

    // Ticking clock + heartbeat; tension rises every 4 bars. Great for timed rounds.
    tension: {
      name: 'Thinking Time', bpm: 120,
      step(s, t, S) {
        const i = s % 16, bar = Math.floor(s / 16), lift = Math.floor(bar / 4) % 5;
        if (i % 4 === 0) {
          const hi = (i / 4) % 2 === 0;
          tone({ type: 'sine', freq: hi ? 1900 : 1500, t, dur: 0.04, vol: 0.08, out: bus() });
          noise({ t, dur: 0.02, vol: 0.05, type: 'bandpass', freq: hi ? 3000 : 2400, q: 6, out: bus() });
        }
        if (i === 0 || i === 3) tone({ type: 'sine', freq: mtof(31 + lift), glideTo: mtof(28 + lift), t, dur: 0.35, vol: i === 0 ? 0.6 : 0.4, out: bus() });
        if (i === 0 && bar % 2 === 0) pad([40 + lift, 41 + lift, 47 + lift, 52 + lift], t, S * 32, { vol: 0.018, cutoff: 500 + lift * 180, attack: 2 });
        if (i % 2 === 0) {
          const seq = [52, 55, 53, 55, 52, 56, 53, 55];
          tone({ type: 'triangle', freq: mtof(seq[(i / 2) % 8] + lift), t, dur: 0.12, vol: 0.05, out: bus(), filter: { freq: 1500 } });
        }
        if (lift >= 2 && i % 4 === 2) hat(t, 0.035);
        if (lift >= 4 && i % 2 === 1) hat(t, 0.025);
      },
    },

    // Swinging jazz: walking bass, Rhodes, brushes. Breaks and chill moments.
    lounge: {
      name: 'Cocktail Lounge', bpm: 96,
      step(s, t, S) {
        const bar = Math.floor(s / 16) % 4, i = s % 16, sw = S * 0.33;
        const C = [
          { n: [60, 65, 69, 72], w: [38, 41, 45, 44] }, // Dm9-ish
          { n: [59, 62, 65, 69], w: [43, 47, 50, 37] }, // G13
          { n: [59, 64, 67, 71], w: [36, 40, 43, 45] }, // Cmaj7
          { n: [61, 64, 67, 70], w: [45, 49, 52, 39] }, // A7
        ];
        const c = C[bar];
        if (i % 4 === 0) tone({ type: 'triangle', freq: mtof(c.w[i / 4]), t, dur: S * 3.6, vol: 0.24, out: bus(), filter: { freq: 650 } });
        const ride = { 0: 0, 4: 0, 6: sw, 8: 0, 12: 0, 14: sw };
        if (i in ride) noise({ t: t + ride[i], dur: 0.25, vol: 0.03, type: 'highpass', freq: 6500, out: bus() });
        if (i === 4 || i === 12) noise({ t, dur: 0.3, vol: 0.045, type: 'bandpass', freq: 1200, q: 0.4, attack: 0.03, out: bus() });
        if (i === 0 || i === 8) tone({ type: 'sine', freq: 90, glideTo: 50, t, dur: 0.2, vol: 0.2, out: bus() });
        if (i === 0 || i === 6) {
          const tt = t + (i === 6 ? sw : 0);
          for (const n of c.n) {
            tone({ type: 'sine', freq: mtof(n), t: tt, dur: i === 0 ? S * 5 : S * 3, vol: 0.038, out: bus() });
            tone({ type: 'triangle', freq: mtof(n + 12), t: tt, dur: S * 1.5, vol: 0.007, out: bus() });
          }
        }
        if (Math.floor(s / 64) % 2 === 1 && (i === 2 || i === 10)) bell(mtof(c.n[3] + 12), t + sw, 0.06, 1.4);
      },
    },

    // Chiptune: square-wave melody, triangle bass, noise drums
    arcade: {
      name: '8-Bit Arcade', bpm: 140,
      step(s, t, S) {
        const bar = Math.floor(s / 16) % 4, i = s % 16, sec = Math.floor(s / 64) % 2;
        const r = [48, 45, 41, 43][bar];
        const ch = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]][bar];
        if (i === 0 || i === 8 || i === 10) tone({ type: 'triangle', freq: 180, glideTo: 50, t, dur: 0.12, vol: 0.4, out: bus() });
        if (i === 4 || i === 12) noise({ t, dur: 0.1, vol: 0.14, type: 'highpass', freq: 1500, out: bus() });
        if (i % 2 === 1) noise({ t, dur: 0.02, vol: 0.035, type: 'highpass', freq: 9000, out: bus() });
        if (i % 2 === 0) tone({ type: 'triangle', freq: mtof(r - 12 + (i % 4 === 2 ? 12 : 0)), t, dur: S * 1.8, vol: 0.2, out: bus() });
        const pats = [[0, null, 1, 2, null, 1, 0, null, 2, null, 3, 2, 1, null, 0, null], [3, 2, 1, null, 0, 1, 2, null, 3, null, 4, 3, 2, 1, 0, null]];
        const p = pats[(bar + sec) % 2][i];
        if (p !== null) {
          const notes = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12];
          tone({ type: 'square', freq: mtof(notes[p] + 12), t, dur: S * 0.9, vol: 0.04, out: bus(), filter: { freq: 6000 } }).connect(delay);
        }
        if (sec === 1 && i % 2 === 1) tone({ type: 'square', freq: mtof(ch[(i >> 1) % 3] + 24), t, dur: S * 0.4, vol: 0.014, out: bus() });
      },
    },

    // Cinematic: taiko drums, string ostinato, brass. For finals and big reveals.
    epic: {
      name: 'Grand Finale', bpm: 92,
      step(s, t, S) {
        const bar = Math.floor(s / 16) % 4, i = s % 16, sec = Math.floor(s / 64) % 4;
        const r = [38, 34, 41, 36][bar];
        const tr = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]][bar];
        if ([0, 3, 6, 8, 11, 14].includes(i)) {
          tone({ type: 'sine', freq: 110, glideTo: 45, t, dur: 0.5, vol: i === 0 ? 0.9 : 0.55, out: bus() });
          noise({ t, dur: 0.25, vol: 0.12, type: 'lowpass', freq: 900, out: bus() });
        }
        if (i === 4 || i === 12) noise({ t, dur: 0.5, vol: 0.06, type: 'bandpass', freq: 2500, q: 0.5, out: bus() });
        if (i % 2 === 0) tone({ type: 'sawtooth', freq: mtof(r + 12 + [0, 7, 12, 7][(i / 2) % 4]), t, dur: S * 1.5, vol: 0.042, out: bus(), filter: { freq: 1600 } });
        if (i === 0) {
          pad(tr, t, S * 16, { vol: 0.028, cutoff: 1100, attack: 0.25, detune: 10 });
          pad([r - 12], t, S * 16, { vol: 0.05, cutoff: 400, attack: 0.1, detune: 4 });
        }
        if (sec >= 2 && (i === 0 || i === 6 || i === 8)) {
          const mel = { 0: tr[2] + 12, 6: tr[1] + 12, 8: tr[0] + 12 }[i];
          for (const dt of [-6, 6]) tone({ type: 'sawtooth', freq: mtof(mel), t, dur: i === 8 ? S * 7 : S * 5, vol: 0.042, attack: 0.08, detune: dt, out: bus(), filter: { freq: 1400 } });
        }
        if (bar === 3 && i >= 12) for (let k = 0; k < 2; k++) tone({ type: 'sine', freq: mtof(r), t: t + (k * S) / 2, dur: 0.2, vol: 0.12 + 0.04 * (i - 12), out: bus() });
      },
    },
  };

  let current = 'synth';
  let step = 0, nextTime = 0, timer = null, S = 60 / 112 / 4;
  const playlist = []; // [{ name, src }]
  let songIdx = 0;
  let fileEl = null, fileNode = null;

  function pump() {
    const tr = TRACKS[current];
    if (!tr) return;
    while (nextTime < ctx.currentTime + 0.12) {
      try { tr.step(step, nextTime, S); } catch (e) { console.error(e); }
      if (step % 4 === 0) {
        const strength = step % 16 === 0 ? 2 : 1;
        setTimeout(() => onBeat(strength), Math.max(0, (nextTime - ctx.currentTime) * 1000));
      }
      nextTime += S;
      step++;
    }
  }

  function startSynth() {
    const tr = TRACKS[current];
    S = 60 / tr.bpm / 4;
    delay.delayTime.setValueAtTime((60 / tr.bpm) * 0.75, now());
    step = 0; nextTime = ctx.currentTime + 0.1;
    clearInterval(timer);
    timer = setInterval(pump, 25);
  }
  function stopSynth() { clearInterval(timer); timer = null; }

  function ensureFileEl() {
    if (fileEl) return;
    fileEl = new window.Audio();
    fileEl.crossOrigin = 'anonymous';
    fileNode = ctx.createMediaElementSource(fileEl);
    fileNode.connect(musicBus);
    fileEl.addEventListener('ended', () => { if (playlist.length > 1) playSong(songIdx + 1); });
  }
  function playSong(i) {
    if (!playlist.length) return;
    ensureFileEl();
    songIdx = (i + playlist.length) % playlist.length;
    fileEl.src = playlist[songIdx].src;
    fileEl.loop = playlist.length === 1;
    if (musicOn && current === 'mp3') fileEl.play().catch(() => {});
    onChange();
  }

  let onChange = () => {};
  let onBeat = () => {};

  function applyMusic() {
    if (!ctx) return;
    const t = now();
    musicBus.gain.cancelScheduledValues(t);
    if (musicOn) {
      if (current === 'mp3') {
        stopSynth();
        if (playlist.length) { ensureFileEl(); if (!fileEl.src) playSong(songIdx); fileEl.play().catch(() => {}); }
      } else {
        if (fileEl) fileEl.pause();
        if (!timer) startSynth();
      }
      musicBus.gain.setTargetAtTime(musicVol * 0.9, t, 0.4);
    } else {
      musicBus.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => { if (!musicOn) { stopSynth(); fileEl && fileEl.pause(); } }, 1500);
    }
    onChange();
  }

  // Crossfade to another track: synth id, or 'mp3' for the playlist.
  function setTrack(id) {
    if (id === 'mp3' && !playlist.length) return false;
    if (id !== 'mp3' && !TRACKS[id]) return false;
    if (id === current) { applyMusic(); return true; }
    const switchNow = () => {
      current = id;
      stopSynth();
      if (fileEl && id !== 'mp3') fileEl.pause();
      applyMusic();
    };
    if (ctx && musicOn) {
      musicBus.gain.cancelScheduledValues(now());
      musicBus.gain.setTargetAtTime(0, now(), 0.15);
      setTimeout(switchNow, 650);
    } else switchNow();
    return true;
  }

  function nextTrack() {
    if (current === 'mp3' && playlist.length > 1) return playSong(songIdx + 1);
    const ids = Object.keys(TRACKS).concat(playlist.length ? ['mp3'] : []);
    setTrack(ids[(ids.indexOf(current) + 1) % ids.length]);
  }

  function addFiles(items, select = true) {
    if (!ctx) return;
    for (const it of items) if (!playlist.some((p) => p.src === it.src)) playlist.push(it);
    if (select && playlist.length) { songIdx = playlist.length - items.length; setTrack('mp3'); playSong(songIdx); }
    onChange();
  }

  return {
    init,
    sfx,
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },
    get track() { return current; },
    get tracks() { return Object.entries(TRACKS).map(([id, t]) => ({ id, name: t.name })); },
    get playlist() { return playlist.slice(); },
    get nowPlaying() { return current === 'mp3' ? (playlist[songIdx] ? playlist[songIdx].name : 'My music') : TRACKS[current].name; },
    setSfx(v) { sfxOn = v; },
    setMusic(v) { musicOn = v; applyMusic(); },
    setVoiceVolume(v) { voiceVol = v; if (voiceOut) voiceOut.gain.setTargetAtTime(v * 1.35, now(), 0.1); },
    duck,
    decode,
    playVoice,
    get analyser() { return analyser; },
    get ready() { return !!ctx; },
    get running() { return !!ctx && ctx.state === 'running'; },
    resume() { return ctx ? ctx.resume().catch(() => {}) : Promise.resolve(); },
    setVolume(v) { musicVol = v; if (ctx && musicOn) musicBus.gain.setTargetAtTime(v * 0.9, now(), 0.1); },
    setTrack,
    nextTrack,
    addFiles,
    onChange(fn) { onChange = fn; },
    onBeat(fn) { onBeat = fn; },
  };
})();
