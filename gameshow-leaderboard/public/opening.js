'use strict';
// Cinematic cold open:
//   1. letterbox + film grain + date title card (drone, heartbeat)
//   2. satellite map flies in from space to the venue, targeting HUD, radar pings
//   3. target lock + address card
//   4. "your hosts" reveal, one name at a time
//   5. GAMES NIGHT neon build letter by letter -> EXTRAVAGANZA explosion
// The narrator's lines (from the server) drive the timing; without a voice it
// runs on fixed timings.

const Opening = (() => {
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  let map = null;
  let show = null;

  async function loadShow() {
    try { show = await (await fetch('api/show')).json(); } catch (_) { show = null; }
    return show;
  }

  // Create the map early (hidden) so the first tiles are cached by showtime.
  async function prepare() {
    await loadShow();
    if (!show || !window.L || map) return;
    map = L.map('cineMap', {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0, inertia: false,
    }).setView([show.lat, show.lon], 2.4);
    L.tileLayer(ESRI, { maxZoom: 19, maxNativeZoom: 19, keepBuffer: 4, crossOrigin: true }).addTo(map);
  }

  // film grain texture
  (function grain() {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 26;
    }
    g.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL()})`);
  })();

  async function typewrite(el, text, speed = 55) {
    el.textContent = '';
    for (const ch of text) {
      el.textContent += ch;
      if (ch.trim()) GameAudio.sfx.typeTick();
      await sleep(speed);
    }
  }

  function fmtCoord(v, pos, neg) {
    return `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;
  }

  // HUD readouts follow the map camera during the flight
  let hudRaf = null;
  function trackHud() {
    cancelAnimationFrame(hudRaf);
    const loop = () => {
      if (map) {
        const c = map.getCenter();
        const z = map.getZoom();
        $('#hudLat').textContent = fmtCoord(c.lat, 'N', 'S');
        $('#hudLon').textContent = fmtCoord(c.lng, 'E', 'W');
        const alt = 40075016 / Math.pow(2, z) / 2.2;
        $('#hudAlt').textContent = alt > 2000 ? `${Math.round(alt / 1000).toLocaleString('en-GB')} KM` : `${Math.round(alt).toLocaleString('en-GB')} M`;
      }
      $('#hudTime').textContent = new Date().toLocaleTimeString('en-GB');
      hudRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  async function run({ ann, playLine, slam, lasers, burst, confetti }) {
    if (!show) await loadShow();
    const s = show || {};
    const cinema = $('#cinema');
    const sub = $('#cineSub');
    const sfx = GameAudio.sfx;
    const line = async (i, minMs) => {
      const t0 = performance.now();
      if (ann && ann.lines[i]) await playLine(ann, i, '', { captionEl: sub });
      const rest = minMs - (performance.now() - t0);
      if (rest > 0) await sleep(rest);
    };

    // music bows out for the cold open
    const musicWas = GameAudio.musicOn;
    if (musicWas) GameAudio.setMusic(false);

    // ---- 1. black, letterbox, date card
    cinema.className = 'cinema on';
    $('#cineText').innerHTML = '';
    $('#cineHosts').innerHTML = '';
    $('#ctMain').innerHTML = '';
    $('#ctSub').textContent = '';
    sub.textContent = '';
    const stopDrone = sfx.drone(40);
    await sleep(900);
    cinema.classList.add('bars');
    sfx.heartbeat();
    const beats = setInterval(() => sfx.heartbeat(), 1300);
    await sleep(900);
    const dateEl = document.createElement('div');
    dateEl.className = 'cine-date';
    $('#cineText').appendChild(dateEl);
    await typewrite(dateEl, s.date || '', 70);
    await line(0, 2600);

    // ---- 2. map flight
    dateEl.classList.add('out');
    sfx.whoosh();
    cinema.classList.add('mapon');
    $('#hudStatus').textContent = 'ACQUIRING SIGNAL…';
    trackHud();
    let pings = null;
    if (map) {
      map.invalidateSize();
      map.setView([s.lat, s.lon], 2.4, { animate: false });
      await sleep(700);
      pings = setInterval(() => sfx.ping(), 1100);
      $('#hudStatus').textContent = 'TRACKING TARGET…';
      map.flyTo([s.lat, s.lon], 18.3, { duration: 8.5, easeLinearity: 0.12 });
      await new Promise((r) => { map.once('moveend', r); setTimeout(r, 10500); });
    } else {
      cinema.classList.add('nomap');
      pings = setInterval(() => sfx.ping(), 1100);
      await sleep(6000);
    }
    clearInterval(pings);

    // ---- 3. lock on + address
    sfx.lock();
    slam(0.5);
    cinema.classList.add('locked');
    $('#hudStatus').textContent = 'TARGET LOCKED';
    $('#hudLat').textContent = fmtCoord(s.lat, 'N', 'S');
    $('#hudLon').textContent = fmtCoord(s.lon, 'E', 'W');
    const label = $('#pinLabel');
    label.textContent = '';
    typewrite(label, s.address || '', 60);
    await line(1, 3200);

    // ---- 4. hosts
    clearInterval(beats);
    sfx.braam(2.6);
    slam(1);
    cinema.classList.add('hosts');
    const hosts = s.hosts || [];
    $('#cineHosts').innerHTML = `<div class="hosts-kicker">YOUR HOSTS</div><div class="hosts-row">${hosts
      .map((h) => `<div class="host"><div class="host-glow"></div><div class="host-name">${esc(h)}</div></div>`)
      .join('')}</div>`;
    const cards = [...document.querySelectorAll('#cineHosts .host')];
    const clip = ann && (await ann.ready)[2];
    const dur = clip ? clip.duration * 1000 : 4200;
    const reveal = (async () => {
      await sleep(dur * 0.12);
      for (let i = 0; i < cards.length; i++) {
        cards[i].classList.add('in');
        sfx.impact();
        const r = cards[i].getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, ['#00e5ff', '#ff2bd6', '#ffc400', '#39ff88'][i % 4], 120, 1.4);
        slam(0.6);
        await sleep((dur * 0.8) / Math.max(1, cards.length));
      }
    })();
    await line(2, 4200);
    await reveal;
    await sleep(500);

    // ---- 5. title build
    cinema.classList.add('title');
    lasers(true);
    const word = `${s.eventTitle || 'GAMES NIGHT'}`;
    $('#ctMain').innerHTML = [...word].map((ch) => (ch === ' ' ? '<span class="sp"> </span>' : `<span>${esc(ch)}</span>`)).join('');
    const letters = [...document.querySelectorAll('#ctMain span:not(.sp)')];
    const lastLine = (async () => {
      await sleep(300);
      await line(3, 0);
    })();
    for (const l of letters) {
      l.classList.add('lit');
      sfx.neonBuzz();
      await sleep(140);
    }
    // wait for the narrator to reach the end of the line, then explode
    await Promise.race([lastLine, sleep(5000)]);
    $('#ctSub').textContent = s.eventSubtitle || 'EXTRAVAGANZA';
    cinema.classList.add('boom');
    sfx.braam(3.5);
    sfx.impact();
    sfx.fanfare(true);
    slam(2);
    for (let i = 0; i < 4; i++) burst(innerWidth * (0.2 + i * 0.2), innerHeight * 0.5, ['#00e5ff', '#ff2bd6', '#ffc400', '#39ff88'][i], 200, 2);
    confetti(6000);
    await sleep(600);
    sfx.airhorn();
    sfx.applause(6, 1.8);
    sfx.crowd(6, 1.4);
    await sleep(4200);

    // ---- out
    stopDrone();
    cancelAnimationFrame(hudRaf);
    cinema.classList.add('fadeout');
    await sleep(1200);
    cinema.className = 'cinema';
    if (musicWas) { GameAudio.setTrack('epic'); GameAudio.setMusic(true); }
  }

  return { prepare, run };
})();
