// Gameplay for the Mirpur 10 rickshaw game. main.js builds the world; this file decides what happens in it:
// a story told in days (levels), the passenger job with bargaining, tips and rival rickshaws, stamina and
// cha stalls, rain, the traffic officer at the circle, small events, upgrades, and the light of the day.

export function initLife(G) {
  const { THREE, P, K, scene, R, pick, clamp, toast, hooks, PLACES, CIRCLE, $ } = G;
  const round5 = (v) => Math.max(10, Math.round(v / 5) * 5);
  const tk = (v) => (v < 0 ? `-৳${-v}` : `৳${v}`);
  const fmt = (h) => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

  /* ---------------- the story, day by day ---------------- */
  const LEVELS = [
    { bn: 'প্রথম দিন', title: 'First day', rent: 200, start: 7, end: 13, secs: 300, rival: [45, 70],
      mix: { normal: 5, hurry: 1, elder: 1 },
      story: 'Rahim has come to Dhaka from Rangpur. Karim mahajan rents him a rickshaw for ৳200 a day. Earn the rent by early afternoon.',
      done: 'Karim counts the notes twice and nods. "Come back tomorrow."', fail: '"Short again?" Karim keeps the rickshaw for the night.' },
    { bn: 'অফিসের ভিড়', title: 'Office rush', rent: 250, start: 7, end: 12, secs: 300, rival: [30, 50],
      mix: { hurry: 5, normal: 2, kids: 2 },
      story: 'Morning rush at Mirpur 10. Office workers are late and pay extra if you get them there in time.',
      done: 'An office clerk saves your number: "You are the fast one."', fail: 'Too many late clerks today. Tomorrow, go faster.' },
    { bn: 'বৃষ্টির দিন', title: 'Monsoon', rent: 250, start: 12, end: 19, secs: 330, rain: 0.85, rival: [50, 80],
      mix: { normal: 3, shopper: 2, elder: 1, hurry: 1 },
      story: 'The monsoon is here. Roads flood, few rickshaws are out, and everyone pays more. Your legs will feel it.',
      done: 'Soaked, tired, and paid. The rain was good to you.', fail: 'The rain won today. Keep some energy for the flooded roads.' },
    { bn: 'মায়ের চিঠি', title: "Ma's letter", rent: 300, start: 8, end: 20, secs: 420, goal: { takeHome: 400, text: 'Take home ৳400 for Ma\'s roof' },
      mix: { normal: 3, shopper: 2, cargo: 2, elder: 1, kids: 1 }, events: ['wallet', 'patient'],
      story: 'A letter from Ma in Rangpur: the roof leaks, and the rains are coming. She needs ৳400.',
      done: 'You send ৳400 home from the bKash shop by the circle. Ma calls to say the roof is fixed.', fail: 'Not enough for the roof yet. Ma says not to worry, which makes you worry more.' },
    { bn: 'ক্রিকেট ম্যাচ', title: 'Match night', rent: 300, start: 15, end: 22, secs: 360, special: 'stadium',
      mix: { fan: 5, normal: 2, hurry: 1 },
      story: 'Bangladesh plays tonight at Sher-e-Bangla stadium. Everyone with a flag wants to get to the match.',
      done: 'Bangladesh won, and half of Mirpur sang in your rickshaw.', fail: 'The fans found other rickshaws. Be quicker to the stadium next time.' },
    { bn: 'ভিআইপি', title: 'VIP movement', rent: 300, start: 9, end: 17, secs: 360, officer: [9, 14], fine: 50,
      mix: { normal: 3, hurry: 3, shopper: 1 },
      story: 'A VIP is passing through Mirpur 10. The traffic police are strict today: when the officer raises his hands, stop.',
      done: 'Not a single fine. The officer even waved you through once.', fail: 'Fines ate the day. Watch the officer at the circle.' },
    { bn: 'ঈদের আগে', title: 'Before Eid', rent: 400, start: 8, end: 22, secs: 420, fareMult: 2, toBus: 0.5, rain: 0.2,
      goal: { takeHome: 500, text: 'Take home ৳500 for Eid gifts' },
      mix: { shopper: 3, normal: 3, cargo: 1, kids: 1 },
      story: 'The day before Eid. Everyone is shopping or heading for the bus stand. Fares double, and so does the rent.',
      done: 'New clothes for your sister, a sari for Ma. Eid Mubarak.', fail: 'The gifts will be small this Eid. Next year.' },
    { bn: 'নিজের রিকশা', title: 'A rickshaw of my own', rent: 300, start: 7, end: 22, secs: 480, rain: 0.3, events: ['wallet', 'patient'],
      goal: { savings: 3000, text: 'Have ৳3000 saved by tonight' },
      mix: { normal: 3, hurry: 2, shopper: 2, elder: 1, kids: 1, cargo: 1 },
      story: 'Karim mahajan will sell you this rickshaw for ৳3000. Save enough by tonight, and tomorrow you ride for yourself.',
      done: 'Karim hands you the papers. The rickshaw is yours. No more rent, ever.', fail: 'Not there yet. Karim will wait, for now.' },
  ];
  const FREE = { bn: 'নিজের দিন', title: 'Free day', rent: 0, start: 7, end: 22, secs: 600, rain: 0.3, events: ['wallet', 'patient'],
    mix: { normal: 3, hurry: 2, shopper: 2, elder: 1, kids: 1, cargo: 1 }, story: 'Your own rickshaw, your own hours. Everything you earn is yours.', done: 'A good day on your own rickshaw.', fail: 'A slow day. There is always tomorrow.' };

  /* ---------------- upgrades, bought from savings between days ---------------- */
  const UPGRADES = [
    { id: 'bell', bn: 'বড় ঘণ্টা', title: 'Big bell', cost: 150, text: 'People hear you coming: the bell clears the way, and waiting passengers hold on longer.' },
    { id: 'cushion', bn: 'নরম গদি', title: 'Soft cushion', cost: 250, text: 'Elderly passengers forgive bumps and tip double.' },
    { id: 'lights', bn: 'রঙিন বাতি', title: 'Fairy lights', cost: 300, text: 'Coloured lights on the hood. Fares are 15% higher after dark.' },
    { id: 'wheels', bn: 'হালকা চাকা', title: 'Light wheels', cost: 400, text: 'A little faster on every road.' },
    { id: 'motor', bn: 'ব্যাটারি মোটর', title: 'Battery motor', cost: 1500, text: 'An electric motor: much less tiring and more pull. The future of Dhaka rickshaws.' },
  ];

  /* ---------------- saved progress ---------------- */
  const SAVE_KEY = 'mirpur10-rickshaw-v1';
  let save = { unlocked: 1, stars: {}, savings: 0, owned: [], best: 0, karma: 0, own: false };
  try { save = Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch { /* a fresh start */ }
  const store = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ } };
  const has = (id) => save.owned.includes(id);

  /* ---------------- interface: HUD pills, panels, the bargaining card ---------------- */
  const css = document.createElement('style');
  css.textContent = `
    #life { position: fixed; top: 52px; left: 14px; z-index: 6; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; pointer-events: none; }
    .life-pill { background: rgba(38,39,43,.86); color: #fff; border-radius: 999px; padding: 5px 12px; font: 500 13px var(--sans); }
    .life-pill.goal { background: rgba(255,250,242,.92); color: var(--ink); }
    .life-energy { display: flex; align-items: center; gap: 8px; }
    .life-bar { width: 120px; height: 8px; border-radius: 4px; background: rgba(255,255,255,.25); overflow: hidden; }
    .life-bar i { display: block; height: 100%; width: 100%; background: #6fd16f; transition: width .3s, background .3s; }
    .life-officer.stop { background: #c62828; }
    #life-panel { position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center; background: rgba(25,15,8,.45); }
    #life-panel.hidden, #offer.hidden { display: none; }
    .life-card { background: var(--paper); border-radius: 18px; padding: 22px 24px 20px; width: min(460px, calc(100vw - 28px)); max-height: calc(100vh - 36px); overflow: auto;
      box-shadow: 0 0 0 4px #e8364f, 0 0 0 8px #f6c445, 0 0 0 12px #1f8a5b, 0 24px 60px rgba(0,0,0,.45); color: var(--ink); }
    .life-card .bn { font-family: var(--bn-art); font-weight: 700; font-size: 22px; color: #e8364f; line-height: 1.1; }
    .life-card h2 { margin: 4px 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
    .life-card p { margin: 0 0 10px; font-size: 14.5px; font-weight: 300; line-height: 1.55; color: var(--ink-soft); }
    .life-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
    .life-btn { font: 500 14px var(--sans); border: 0; border-radius: 999px; padding: 9px 16px; cursor: pointer; background: #e8364f; color: #fff; }
    .life-btn.alt { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1.5px rgba(0,0,0,.18); }
    .life-btn[disabled] { opacity: .45; cursor: default; }
    .life-levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 8px; margin-top: 8px; }
    .life-level { border: 0; border-radius: 12px; padding: 10px 11px; background: #fff; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); cursor: pointer; text-align: left; font: 400 12.5px var(--sans); color: var(--ink-soft); }
    .life-level b { display: block; font-size: 14px; font-weight: 600; color: var(--ink); }
    .life-level .bnl { font-family: var(--bn); font-weight: 600; color: #e8364f; }
    .life-level.locked { opacity: .4; cursor: default; }
    .life-stars { color: #e0a020; letter-spacing: 2px; font-size: 13px; }
    .life-row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; border-bottom: 1px dashed rgba(0,0,0,.12); }
    .life-row.total { font-weight: 600; border: 0; font-size: 15px; }
    .life-up { display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px dashed rgba(0,0,0,.12); }
    .life-up small { display: block; font-size: 12.5px; color: var(--ink-soft); font-weight: 300; }
    #offer { position: fixed; left: 50%; bottom: 92px; transform: translateX(-50%); z-index: 8; width: min(380px, calc(100vw - 28px));
      background: var(--paper); border-radius: 16px; padding: 14px 16px; box-shadow: 0 12px 34px rgba(30,15,5,.4); font-size: 14.5px; color: var(--ink); }
    #offer .say { font-family: var(--bn); font-weight: 600; font-size: 16px; margin-bottom: 4px; }
    #offer .life-btn { padding: 8px 13px; font-size: 13.5px; }
    @media (hover: none) and (pointer: coarse) { #offer { bottom: 236px; } #life { top: 50px; } .life-bar { width: 90px; } }
  `;
  document.head.appendChild(css);
  const hud = document.createElement('div');
  hud.id = 'life';
  hud.innerHTML = `<div class="life-pill" id="life-clock"></div><div class="life-pill goal" id="life-goal"></div>
    <div class="life-pill life-energy">Energy <span class="life-bar"><i></i></span></div><div class="life-pill life-officer" id="life-officer"></div>`;
  document.body.appendChild(hud);
  const panel = document.createElement('div');
  panel.id = 'life-panel'; panel.className = 'hidden';
  document.body.appendChild(panel);
  const offer = document.createElement('div');
  offer.id = 'offer'; offer.className = 'hidden';
  document.body.appendChild(offer);
  const el = { clock: $('#life-clock'), goal: $('#life-goal'), bar: hud.querySelector('.life-bar i'), officer: $('#life-officer'), wallet: $('#wallet'),
    job: $('#job'), arrow: $('#job .job-arrow'), to: $('#job .job-to'), meta: $('#job .job-meta') };
  let choice = null; // key handler for the open card: 1 and 2 pick its buttons
  function showPanel(html, buttons) {
    panel.innerHTML = `<div class="life-card">${html}<div class="life-btns"></div></div>`;
    const row = panel.querySelector('.life-btns');
    buttons.forEach(([label, fn, alt, disabled]) => {
      const b = document.createElement('button');
      b.className = 'life-btn' + (alt ? ' alt' : ''); b.textContent = label; b.disabled = !!disabled;
      b.onclick = fn; row.appendChild(b);
    });
    panel.classList.remove('hidden');
    S.paused = true;
  }
  function hidePanel() { panel.classList.add('hidden'); S.paused = false; }
  function showOffer(say, line, buttons) {
    offer.innerHTML = `<div class="say">${say}</div><div>${line}</div><div class="life-btns"></div>`;
    const row = offer.querySelector('.life-btns');
    buttons.forEach(([label, fn, alt], i) => {
      const b = document.createElement('button');
      b.className = 'life-btn' + (alt ? ' alt' : ''); b.textContent = `${i + 1} · ${label}`; b.onclick = fn; row.appendChild(b);
    });
    choice = buttons.map((b) => b[1]);
    offer.classList.remove('hidden');
  }
  function hideOffer() { offer.classList.add('hidden'); choice = null; }
  addEventListener('keydown', (e) => {
    if (!choice) return;
    const i = { Digit1: 0, Numpad1: 0, Digit2: 1, Numpad2: 1 }[e.code];
    if (i !== undefined && choice[i]) { e.preventDefault(); choice[i](); }
  });

  /* ---------------- state of the day ---------------- */
  const S = { level: null, li: -1, running: false, paused: false, t: 0, clock: 9, earned: 0, tips: 0, spent: 0, fines: 0, trips: 0,
    stamina: 100, tiredHint: false, rain: 0, rainTarget: 0, rainRoll: 20, chaT: 0, wallet: false };
  const J = { state: 'off', next: 2, spot: null, waiting: null, riders: [], props: [], to: null, fare: 0, type: 'normal', limit: 0, t: 0, rivalT: 0, bumps: 0, chatter: 0, slowHint: false, back: null };

  /* ---------------- light by the hour, and weather ---------------- */
  const sun = G.sun, hemi = G.hemi, skyU = G.sky.material.uniforms;
  const C = { dayTop: new THREE.Color('#7fa6cf'), dayHor: new THREE.Color('#f1c79e'), nightTop: new THREE.Color('#0d1424'), nightHor: new THREE.Color('#2a3145'),
    rainTop: new THREE.Color('#68727e'), rainHor: new THREE.Color('#9aa2aa'), sunDay: new THREE.Color('#ffd3a1'), sunEve: new THREE.Color('#ff9a5a') };
  const _t = new THREE.Color(), _h = new THREE.Color();
  const daylight = (h) => (h < 6 ? 0.12 : h < 8 ? 0.12 + ((h - 6) / 2) * 0.88 : h < 16.5 ? 1 : h < 18.5 ? 1 - ((h - 16.5) / 2) * 0.55 : h < 19.6 ? 0.45 - ((h - 18.5) / 1.1) * 0.33 : 0.12);
  function applyLight() {
    const h = S.running ? S.clock : 9.5, L = daylight(h), wet = S.rain;
    sun.intensity = 3.1 * L * (1 - 0.65 * wet);
    hemi.intensity = 0.28 + 0.62 * L * (1 - 0.25 * wet);
    sun.color.copy(C.sunDay).lerp(C.sunEve, h > 16 && h < 19.5 ? Math.sin(((h - 16) / 3.5) * Math.PI) : 0);
    _t.copy(C.nightTop).lerp(C.dayTop, L).lerp(C.rainTop, wet * 0.75);
    _h.copy(C.nightHor).lerp(C.dayHor, L).lerp(C.rainHor, wet * 0.7);
    skyU.top.value.copy(_t); skyU.horizon.value.copy(_h);
    if (scene.fog) { scene.fog.color.copy(_h); scene.fog.far = 420 - 200 * wet - 120 * (1 - L); }
    G.headMat.emissiveIntensity = 0.9 + (1 - L) * 2.2;
    if (fairy) for (const m of fairy) m.material.emissiveIntensity = 0.3 + (1 - L) * 2.5;
  }
  // rain: streaks falling around the camera, a hiss, and wetter, darker light
  const RAIN_N = 1500, rainPos = new Float32Array(RAIN_N * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: '#c9d4df', transparent: true, opacity: 0 });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false; scene.add(rainLines);
  for (let i = 0; i < RAIN_N; i++) { const x = R(-35, 35), y = R(0, 28), z = R(-35, 35); rainPos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6); }
  let rainGain = null;
  function updateRain(dt) {
    const lv = S.level;
    if (S.running && lv?.rain) {
      if ((S.rainRoll -= dt) <= 0) {
        S.rainRoll = R(35, 70);
        const was = S.rainTarget;
        S.rainTarget = Math.random() < lv.rain ? 1 : 0;
        if (S.rainTarget && !was) toast('বৃষ্টি! Rain: fares are up, roads are slower');
      }
    } else S.rainTarget = 0;
    S.rain += clamp(S.rainTarget - S.rain, -dt * 0.12, dt * 0.12);
    rainLines.visible = S.rain > 0.02;
    rainMat.opacity = 0.45 * S.rain;
    if (rainLines.visible) {
      const cx = G.camera.position.x, cz = G.camera.position.z, fall = 24 * dt;
      for (let i = 0; i < RAIN_N; i++) {
        const o = i * 6;
        rainPos[o + 1] -= fall; rainPos[o + 4] -= fall;
        let x = rainPos[o], z = rainPos[o + 2];
        if (rainPos[o + 4] < 0 || Math.abs(x - cx) > 36 || Math.abs(z - cz) > 36) {
          x = cx + R(-35, 35); z = cz + R(-35, 35); const y = R(10, 28);
          rainPos.set([x, y, z, x + 0.05, y - 0.7, z], o);
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    const AC = G.audio.ctx();
    if (AC && !rainGain && G.audio.master()) {
      rainGain = G.audio.amp(0);
      G.audio.loopSrc().connect(G.audio.filt('highpass', 900)).connect(G.audio.filt('lowpass', 6500)).connect(rainGain).connect(G.audio.master());
    }
    if (rainGain) rainGain.gain.setTargetAtTime(0.16 * S.rain, AC.currentTime, 0.4);
  }

  /* ---------------- cha stalls: a cup of tea fills you back up ---------------- */
  const STALLS = [];
  {
    const spots = G.SIGN_SPOTS.filter(([x, z]) => { const d = Math.hypot(x - CIRCLE.x, z - CIRCLE.z); return d > 35 && d < 260 && !G.buildingAt(x, z) && G.nearRoad(x, z)[0] > 0.6; });
    for (const [x, z] of spots.sort(() => Math.random() - 0.5)) {
      if (STALLS.length >= 5) break;
      if (STALLS.some((s) => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      const y = G.pavementAt(x, z) ? G.KERB : 0, g = new THREE.Group();
      const [, road] = G.nearRoad(x, z);
      g.position.set(x, y, z);
      if (road) { const s = G.snap(x, z, [road.cls]); if (s) g.rotation.y = Math.atan2(s[1] - x, s[2] - z); }
      scene.add(g);
      G.mesh(new THREE.BoxGeometry(1.6, 0.75, 0.7), G.M('#7a5230'), 0, 0.38, 0, g);
      G.mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.32, 10), G.M('#26262a', { metalness: 0.5 }), -0.45, 0.92, 0, g);
      for (let k = 0; k < 4; k++) G.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 8), G.M('#e9e3cf', { transparent: true, opacity: 0.8 }), 0.05 + k * 0.22, 0.9, 0.05, g);
      for (const [px, pz] of [[-0.95, -0.55], [0.95, -0.55], [-0.95, 0.75], [0.95, 0.75]]) G.mesh(new THREE.BoxGeometry(0.06, 2.2, 0.06), G.M('#5a4632'), px, 1.1, pz, g);
      G.mesh(new THREE.BoxGeometry(2.3, 0.06, 1.7), G.M('#1d6fb8'), 0, 2.2, 0.1, g);
      G.mesh(new THREE.BoxGeometry(1.5, 0.3, 0.32), G.M('#6b4a32'), 0, 0.3, 1.25, g);
      const sign = G.canvasTex(256, 96, (c) => { c.fillStyle = '#1f8a5b'; c.fillRect(0, 0, 256, 96); c.fillStyle = '#fff'; c.font = `700 60px ${G.BN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('চা', 128, 52); });
      const sp = G.mesh(new THREE.PlaneGeometry(0.9, 0.34), new THREE.MeshLambertMaterial({ map: sign, side: THREE.DoubleSide }), 0, 2.42, 0.95, g);
      sp.castShadow = false;
      const owner = G.buildPerson('lungi'); owner.g.position.set(0, 0, -0.75); g.add(owner.g);
      for (let k = 0; k < 2; k++) { const p = G.seat(G.buildPerson(), 1.45); p.g.position.set(-0.4 + k * 0.8, 0.3, 1.25); p.g.rotation.y = Math.PI; g.add(p.g); }
      G.CIRCLES.push({ x, z, r: 1.3 });
      STALLS.push({ x, z, g });
    }
  }
  function updateStamina(dt) {
    const pedalling = S.running && !S.paused && K.up && Math.abs(P.v) > 0.3;
    // heavier loads (bags, sacks, two kids) tire you faster
    const drain = (K.boost ? 1.1 : 0.42) * (has('motor') ? 0.35 : 1) * (1 + 0.4 * S.rain) * (J.state === 'ride' ? 1 / (J.load || 1) : 1);
    if (pedalling) S.stamina -= drain * dt;
    else if (Math.abs(P.v) < 1) S.stamina += 0.25 * dt;
    S.stamina = clamp(S.stamina, 0, 100);
    if (S.stamina < 25 && !S.tiredHint && S.running) { S.tiredHint = true; toast('You are tired. Stop at a cha stall (চা on the map)'); }
    if (S.stamina > 60) S.tiredHint = false;
    // stop at a stall for a cup
    S.chaT -= dt;
    for (const s of STALLS) {
      if (Math.hypot(P.x - s.x, P.z - s.z) < 4.8 && Math.abs(P.v) < 1 && S.stamina < 92 && S.chaT <= 0 && S.running) {
        S.chaT = 6;
        const friend = Math.random() < 0.15;
        S.stamina = 100;
        if (friend) toast('Your friend Jamal is at the stall: the cha is on him');
        else { S.spent += 10; toast('এক কাপ চা · energy full · -৳10'); }
        G.bell([s.x, 1.2, s.z], 0.3);
      }
    }
  }

  /* ---------------- the traffic officer at the circle ---------------- */
  const O = { phase: 'go', t: 14, wasIn: false, whistleT: 0 };
  function whistle(vol = 1) {
    const AC = G.audio.ctx(), master = G.audio.master();
    if (!AC || !master) return;
    const t0 = AC.currentTime, o = AC.createOscillator(), lfo = AC.createOscillator(), lg = G.audio.amp(160), g = G.audio.amp(0);
    o.frequency.value = 2900; lfo.frequency.value = 28; lfo.connect(lg).connect(o.frequency);
    o.connect(G.audio.filt('bandpass', 2900, 2)).connect(g).connect(master);
    for (const [s, e] of [[0, 0.35], [0.45, 0.9]]) { g.gain.setValueAtTime(0, t0 + s); g.gain.linearRampToValueAtTime(0.18 * vol, t0 + s + 0.03); g.gain.setValueAtTime(0.18 * vol, t0 + e - 0.05); g.gain.linearRampToValueAtTime(0, t0 + e); }
    o.start(t0); lfo.start(t0); o.stop(t0 + 1); lfo.stop(t0 + 1);
  }
  function updateOfficer(dt, t) {
    const [go, stop] = S.level?.officer || [16, 6];
    O.t -= dt;
    if (O.t <= 0) {
      O.phase = O.phase === 'go' ? 'stop' : 'go';
      O.t = O.phase === 'go' ? go : stop;
      const d = Math.hypot(P.x - CIRCLE.x, P.z - CIRCLE.z);
      if (O.phase === 'stop' && d < 70) whistle(clamp(1 - d / 70, 0.2, 1));
    }
    const pol = G.POLICE;
    if (pol) {
      if (O.phase === 'go') { pol.arms[0].rotation.x = -1.6 + Math.sin(t * 2.2) * 0.5; pol.arms[0].rotation.z = -0.4; pol.arms[1].rotation.x = 0; pol.arms[1].rotation.z = 0; }
      else { pol.arms[0].rotation.x = -2.9; pol.arms[0].rotation.z = -0.25; pol.arms[1].rotation.x = -2.9; pol.arms[1].rotation.z = 0.25; }
    }
    const d = Math.hypot(P.x - CIRCLE.x, P.z - CIRCLE.z), inside = d < CIRCLE.ring + 3.5;
    if (S.running && O.phase === 'stop' && inside && !O.wasIn && Math.abs(P.v) > 1.5) {
      const fine = S.level.fine || 20;
      S.fines += fine;
      whistle(1);
      toast(`পুলিশ: থামেন! You ran the officer's signal · -৳${fine}`);
    }
    O.wasIn = inside;
    el.officer.style.display = S.running && d < 75 ? '' : 'none';
    el.officer.textContent = O.phase === 'stop' ? 'Officer: STOP ✋' : 'Officer: go';
    el.officer.classList.toggle('stop', O.phase === 'stop');
  }

  /* ---------------- passengers ---------------- */
  const TYPES = {
    normal: { kind: () => pick(['m', 'f', 'lungi']), p: 0.5, lines: ['গরম আজ খুব।', 'মেট্রোতে এত ভিড়!', 'আপনার রিকশাটা সুন্দর তো!', 'মামা, একটু তাড়াতাড়ি চালান।'] },
    hurry: { label: 'in a hurry', kind: () => 'm', p: 0.7, lines: ['মামা, জলদি! অফিসে দেরি হয়ে গেছে।', 'আর পাঁচ মিনিট আছে!', 'বস আজ মেরে ফেলবে।'] },
    elder: { label: 'elderly: take it easy', kind: () => 'lungi', p: 0.4, lines: ['আস্তে চালাও বাবা, কোমরে ব্যথা।', 'আমাদের সময়ে এত গাড়ি ছিল না।'] },
    shopper: { label: 'with heavy bags', kind: () => 'f', p: 0.55, load: 0.8, mult: 1.3, lines: ['শাহ আলী মার্কেট থেকে অনেক কিছু কিনলাম!', 'ব্যাগগুলো সাবধানে রাখবেন।'] },
    kids: { label: 'two schoolkids', kind: () => 'school', scale: 0.78, riders: 2, p: 0.3, load: 0.9, mult: 1.2, lines: ['মামা, স্কুলে যাবো!', 'জোরে চালান মামা!'] },
    cargo: { label: 'sacks of rice: no haggling', kind: () => 'lungi', p: 1, load: 0.7, mult: 1.6, cargo: true, fixed: true, lines: ['বস্তাগুলো দোকানে পৌঁছে দিতে হবে।'] },
    fan: { label: 'cricket fan', kind: () => pick(['m', 'school']), p: 0.75, mult: 1.25, lines: ['বাংলাদেশ! বাংলাদেশ!', 'আজ আমরা জিতবই!'] },
    patient: { label: 'urgent: to hospital', kind: () => 'f', p: 1, fixed: true, mult: 1, lines: ['তাড়াতাড়ি হাসপাতালে চলেন, প্লিজ!'] },
  };
  const ringMat = new THREE.MeshBasicMaterial({ color: '#f6c445', transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.65, 3, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; scene.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.65, 40), new THREE.MeshBasicMaterial({ color: '#f6c445', transparent: true, opacity: 0.15 }));
  disc.rotation.x = -Math.PI / 2; scene.add(disc);
  const pin = new THREE.Mesh(G.makePin(0.6), new THREE.MeshStandardMaterial({ color: '#f6c445', emissive: '#f6c445', emissiveIntensity: 0.45, roughness: 0.35 }));
  scene.add(pin);
  const markers = (c, on = true) => { for (const m of [ring, disc, pin]) { m.visible = on; m.material.color.set(c); if (m.material.emissive) m.material.emissive.set(c); } };
  markers('#f6c445', false);
  // special places: the stadium for match night
  const stadium = (() => {
    let best = null, area = 0;
    for (const [kind, ...c] of G.MAP.green || []) {
      if (kind !== 'stadium' && kind !== 'pitch') continue;
      const pts = G.dm(c); let a = 0;
      for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length]; a += x0 * z1 - x1 * z0; }
      if (Math.abs(a) > area) { area = Math.abs(a); best = pts; }
    }
    if (!best) return null;
    const x = best.reduce((s, p) => s + p[0], 0) / best.length, z = best.reduce((s, p) => s + p[1], 0) / best.length, s = G.snap(x, z, ['p', 't']);
    return s ? { name: 'Sher-e-Bangla Stadium', cat: 'stadium', x, z, stop: G.curb(s, x, z) } : null;
  })();
  function pickType() {
    const mix = S.level?.mix || { normal: 1 };
    if (S.level?.events?.includes('patient') && Math.random() < 0.08) return 'patient';
    let u = Math.random() * Object.values(mix).reduce((a, b) => a + b, 0);
    for (const [k, w] of Object.entries(mix)) { u -= w; if (u <= 0) return k; }
    return 'normal';
  }
  function destination(type, from) {
    const near = (cat) => PLACES.filter((p) => p.cat === cat);
    let list = null;
    if (type === 'patient') list = near('hospital');
    else if (type === 'cargo' || type === 'shopper') list = near('market');
    else if (type === 'kids') list = near('school');
    else if (type === 'fan' && stadium) return stadium;
    else if (S.level?.toBus && Math.random() < S.level.toBus) list = near('bus');
    const far = (l) => l.filter((p) => { const d = Math.hypot(p.stop[0] - from[0], p.stop[1] - from[1]); return d > 120 && d < 650; });
    if (type === 'patient' && list?.length) return list.sort((a, b) => Math.hypot(a.stop[0] - from[0], a.stop[1] - from[1]) - Math.hypot(b.stop[0] - from[0], b.stop[1] - from[1]))[0];
    const options = list && far(list).length ? far(list) : far(PLACES).length ? far(PLACES) : PLACES;
    return pick(options);
  }
  function spawn() {
    const type = pickType(), T = TYPES[type];
    let spot = null;
    if (type === 'cargo') { const m = PLACES.filter((p) => p.cat === 'market' && Math.hypot(p.stop[0] - P.x, p.stop[1] - P.z) < 260); if (m.length) spot = pick(m).stop; }
    const near = PLACES.filter((p) => { const d = Math.hypot(p.stop[0] - P.x, p.stop[1] - P.z); return d > 60 && d < 220; });
    if (!spot && near.length && Math.random() < 0.4) spot = pick(near).stop;
    for (let k = 0; !spot && k < 200; k++) {
      const r = pick(G.WALK_ROADS);
      const [x, z] = G.along(r.pts, r.cum, R(0, r.len)), d = Math.hypot(x - P.x, z - P.z);
      if (d < 50 || d > 200 || Math.abs(x) > G.EDGE - 20 || Math.abs(z) > G.EDGE - 20) continue;
      spot = G.curb(G.snap(x, z, [r.cls]), x + R(-1, 1), z + R(-1, 1));
    }
    if (!spot) spot = pick(PLACES).stop;
    const person = G.buildPerson(T.kind(), T.scale || 1);
    const [x, z, side] = spot, s = G.snap(x, z, ['p', 't', 'r', 'g']) || [null, 0, 0, 1, 0], dx = s[3], dz = s[4];
    let off = 2.6;
    while (off > 1.2 && G.buildingAt(x + dz * side * off, z - dx * side * off)) off -= 0.4;
    const px = x + dz * side * off, pz = z - dx * side * off;
    person.g.position.set(px, G.pavementAt(px, pz) ? G.KERB + 0.02 : 0.05, pz);
    scene.add(person.g);
    J.props = [];
    if (T.cargo) for (let k = 0; k < 3; k++) { const sack = G.mesh(new THREE.BoxGeometry(0.55, 0.4, 0.4), G.M('#c9b48a'), px + R(-0.8, 0.8), person.g.position.y + 0.2 + (k === 2 ? 0.4 : 0), pz + R(-0.6, 0.6), scene); J.props.push(sack); }
    const rivalMin = (S.level?.rival || [40, 65])[0] + (has('bell') ? 6 : 0) + S.rain * 20, rivalMax = (S.level?.rival || [40, 65])[1] + (has('bell') ? 6 : 0) + S.rain * 20;
    Object.assign(J, { state: 'pickup', spot, waiting: person, type, slowHint: false, rivalT: R(rivalMin, rivalMax), bumps: 0 });
    markers(type === 'patient' ? '#e8364f' : '#f6c445');
    if (type === 'patient') toast('Someone is calling for a rickshaw to the hospital!');
  }
  function clearPickup() {
    if (J.waiting) scene.remove(J.waiting.g);
    for (const p of J.props) scene.remove(p);
    J.waiting = null; J.props = [];
  }
  function fareFor(dist, type) {
    let f = (25 + dist * 0.09) * (TYPES[type].mult || 1) * (S.level?.fareMult || 1) * (1 + 0.4 * S.rain);
    if (has('lights') && S.clock >= 18) f *= 1.15;
    return round5(f);
  }
  function board(fare) {
    hideOffer();
    const T = TYPES[J.type];
    if (J.waiting) scene.remove(J.waiting.g);
    J.waiting = null;
    J.riders = [];
    const n = T.riders || 1;
    for (let k = 0; k < n; k++) {
      const r = G.seat(G.buildPerson(T.kind(), T.scale || 1), 1.5);
      r.g.position.set(n > 1 ? -0.22 + k * 0.44 : 0, 0.27, -0.62);
      G.player.body.add(r.g); J.riders.push(r.g);
    }
    for (const p of J.props) { scene.remove(p); }
    J.props = [];
    if (T.cargo || J.type === 'shopper') for (let k = 0; k < (T.cargo ? 3 : 2); k++) {
      const box = G.mesh(new THREE.BoxGeometry(T.cargo ? 0.5 : 0.35, T.cargo ? 0.35 : 0.3, 0.35), G.M(T.cargo ? '#c9b48a' : pick(['#e8364f', '#1d6fb8', '#f6c445'])), -0.25 + k * 0.25, 0.75, -0.25, G.player.body);
      J.riders.push(box);
    }
    const dist = Math.hypot(J.to.stop[0] - J.spot[0], J.to.stop[1] - J.spot[1]);
    J.fare = fare;
    J.load = T.load || 1;
    J.limit = J.type === 'hurry' ? dist / 4.3 + 18 : J.type === 'patient' ? dist / 4.5 + 15 : 0;
    J.t = 0; J.chatter = R(14, 24);
    Object.assign(J, { state: 'ride', slowHint: false });
    markers(J.type === 'patient' ? '#e8364f' : '#3fae5a');
    G.bell(null, 0.8);
    toast(`${pick(T.lines)} · To ${J.to.name} · ৳${fare}`);
  }
  function startOffer() {
    const T = TYPES[J.type];
    J.to = destination(J.type, J.spot);
    const dist = Math.hypot(J.to.stop[0] - J.spot[0], J.to.stop[1] - J.spot[1]), fair = fareFor(dist, J.type);
    if (T.fixed) return board(J.type === 'patient' ? Math.max(fair, 120) : fair);
    J.state = 'offer';
    const offerFare = round5(fair * R(0.8, 0.95)), ask = round5(fair * 1.3);
    const p = clamp(T.p + 0.3 * S.rain + 0.05 * save.karma + (has('bell') ? 0.05 : 0), 0.1, 0.95);
    showOffer(`"${J.to.name} যাবেন? ৳${offerFare}"`, `${T.label ? T.label[0].toUpperCase() + T.label.slice(1) + '. ' : ''}${J.to.name}, ${Math.round(dist)} m. Take it, or ask for more?`, [
      [`ঠিক আছে · ৳${offerFare}`, () => board(offerFare)],
      [`আরো দিন · ৳${ask}`, () => {
        if (Math.random() < p) { toast('ঠিক আছে, চলেন!'); board(ask); }
        else { hideOffer(); toast('থাক, অন্য রিকশা নিই। (They walked off)'); clearPickup(); markers('#f6c445', false); Object.assign(J, { state: 'wait', next: R(2, 4) }); }
      }, true],
    ]);
  }
  function dropOff() {
    const T = TYPES[J.type];
    let tip = 0, note = '';
    if (J.type === 'hurry') { if (J.t <= J.limit) { tip = round5(R(20, 40)); note = 'just in time'; } else note = 'late'; }
    if (J.type === 'patient') { if (J.t <= J.limit) { tip = 100; note = 'just in time'; } else note = 'too slow'; }
    if (J.type === 'elder' && J.bumps === 0) { tip = has('cushion') ? 30 : 15; note = 'a smooth ride'; }
    if (J.type === 'kids' && Math.random() < 0.5) { tip = 10; note = 'a chocolate and ৳10'; }
    for (const r of J.riders) G.player.body.remove(r);
    J.riders = [];
    const pay = Math.max(10, J.fare) + tip;
    S.earned += Math.max(10, J.fare); S.tips += tip; S.trips++;
    toast(`+৳${pay}${tip ? ` (tip ৳${tip}, ${note})` : note ? ` (${note})` : ''} · ${J.to.name}`);
    G.bell(null, 0.6);
    const back = J.to.stop;
    Object.assign(J, { state: 'wait', next: R(1.5, 3.5) / (S.level?.fareMult || 1), to: null, load: 1 });
    markers('#f6c445', false);
    // now and then the passenger leaves something behind
    if (S.level?.events?.includes('wallet') && !S.wallet && Math.random() < 0.2 && T !== TYPES.cargo) {
      S.wallet = true;
      showOffer('A wallet on the seat!', 'The passenger left it behind: ৳300 and an ID card inside.', [
        ['Return it', () => { hideOffer(); Object.assign(J, { state: 'return', spot: back, rivalT: 45 }); markers('#7b3fb0'); toast('Ride back before they leave (45 s)'); }],
        ['Keep it', () => { hideOffer(); S.earned += 150; save.karma -= 1; store(); toast('+৳150. You feel uneasy all day.'); }, true],
      ]);
    }
  }
  function updateJob(dt, t) {
    if (!S.running) { markers('#f6c445', false); el.job.classList.add('hidden'); return; }
    if (J.state === 'wait') {
      if ((J.next -= dt) <= 0) spawn();
      el.job.classList.add('hidden');
      return;
    }
    const target = J.state === 'ride' ? J.to.stop : J.spot, [tx, tz] = target, d = Math.hypot(P.x - tx, P.z - tz);
    ring.position.set(tx, 0.15, tz); disc.position.set(tx, 0.14, tz);
    pin.position.set(tx, 3.4 + Math.sin(t * 2) * 0.25, tz); pin.rotation.y = t * 1.5; pin.visible = d > 3;
    if (J.waiting) {
      const w = J.waiting, a = w.arms[1];
      a.rotation.x = -2.6 + Math.sin(t * 6) * 0.35; a.rotation.z = Math.sin(t * 6) * 0.25;
      if (Math.hypot(P.x - w.g.position.x, P.z - w.g.position.z) < 45) w.g.rotation.y = Math.atan2(P.x - w.g.position.x, P.z - w.g.position.z);
    }
    if (J.state === 'pickup' || J.state === 'return') {
      J.rivalT -= dt;
      if (J.rivalT <= 0) {
        toast(J.state === 'return' ? 'Too late: they have gone home. You keep the wallet for now.' : 'Another rickshaw got there first');
        clearPickup(); markers('#f6c445', false); Object.assign(J, { state: 'wait', next: R(2, 4) });
        return;
      }
    }
    if (J.state === 'ride') {
      J.t += dt;
      if ((J.chatter -= dt) <= 0) { J.chatter = R(18, 30); toast(pick(TYPES[J.type].lines)); }
    }
    if (J.state === 'offer' && d > 5) { hideOffer(); J.state = 'pickup'; }
    if (d < 3) {
      if (Math.abs(P.v) > 2.5) { if (!J.slowHint) { J.slowHint = true; toast('Slow down to stop'); } }
      else if (J.state === 'pickup') startOffer();
      else if (J.state === 'ride') dropOff();
      else if (J.state === 'return') {
        S.earned += 80; save.karma += 1; store();
        toast('"আল্লাহ আপনার ভালো করুক।" They give you ৳80 for your honesty.');
        markers('#f6c445', false); Object.assign(J, { state: 'wait', next: R(2, 3) });
      }
    }
    if (J.state === 'wait' || J.state === 'off') { el.job.classList.add('hidden'); return; }
    // the job card at the bottom: who, where, how far, and the clock that matters
    el.job.classList.remove('hidden');
    const label = TYPES[J.type]?.label;
    if (J.state === 'pickup' || J.state === 'offer') {
      el.to.textContent = J.type === 'patient' ? 'Urgent: someone needs a hospital' : `A passenger is waving${label ? ` · ${label}` : ''}`;
      el.meta.textContent = `${Math.round(d)} m away · another rickshaw is coming (${Math.ceil(J.rivalT)} s)`;
    } else if (J.state === 'return') {
      el.to.textContent = 'Return the wallet'; el.meta.textContent = `${Math.round(d)} m · ${Math.ceil(J.rivalT)} s left`;
    } else {
      el.to.textContent = `To ${J.to.name}`;
      el.meta.textContent = `৳${J.fare} · ${Math.round(d)} m${J.limit ? ` · ${Math.max(0, Math.ceil(J.limit - J.t))} s left` : ''}${label ? ` · ${label}` : ''}`;
    }
    const rel = Math.atan2(tx - P.x, tz - P.z) - G.camYaw();
    el.arrow.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  }

  /* ---------------- fairy lights, once bought ---------------- */
  let fairy = null;
  function dressRickshaw() {
    if (!has('lights') || fairy) return;
    fairy = [];
    const box = new THREE.Box3().setFromObject(G.player.body), cols = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585'];
    const top = box.max.y - G.player.g.position.y - 0.05;
    for (let k = 0; k < 14; k++) {
      const a = (k / 13) * Math.PI;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshStandardMaterial({ color: cols[k % 5], emissive: cols[k % 5], emissiveIntensity: 1 }));
      m.position.set(Math.cos(a) * 0.55, top - 0.35 + Math.sin(a) * 0.35, -0.85);
      G.player.body.add(m); fairy.push(m);
    }
  }
  dressRickshaw();

  /* ---------------- the day: start, clock, end ---------------- */
  function starsFor(lv, takeHome) {
    const base = Math.max(lv.goal?.takeHome || 0, 100);
    return takeHome >= base * 2.2 ? 3 : takeHome >= base * 1.4 ? 2 : 1;
  }
  function goalMet(lv, takeHome) {
    if (takeHome < 0) return false;
    if (lv.goal?.takeHome) return takeHome >= lv.goal.takeHome;
    if (lv.goal?.savings) return save.savings + takeHome >= lv.goal.savings;
    return true;
  }
  function begin(li) {
    const lv = li < 0 ? FREE : LEVELS[li];
    showPanel(`<div class="bn">${lv.bn}</div><h2>${li < 0 ? lv.title : `Day ${li + 1} · ${lv.title}`}</h2><p>${lv.story}</p>
      <p><b>${lv.rent ? `Rent: ৳${lv.rent}.` : 'No rent: the rickshaw is yours.'}</b> ${lv.goal ? `Goal: ${lv.goal.text}.` : ''} From ${fmt(lv.start)} to ${fmt(lv.end)}.</p>
      <p style="font-size:13px">Stop in the yellow ring to pick someone up (1 or 2 to answer them), the green ring to drop them off. Cha stalls refill your energy. Stop when the officer at the circle raises his hands.</p>`,
    [['Start the day', () => {
      hidePanel();
      Object.assign(S, { level: lv, li, running: true, t: 0, clock: lv.start, earned: 0, tips: 0, spent: 0, fines: 0, trips: 0, stamina: 100, rain: lv.rain > 0.7 ? 0.6 : 0, rainTarget: 0, rainRoll: 5, wallet: false });
      clearPickup(); for (const r of J.riders) G.player.body.remove(r);
      Object.assign(J, { state: 'wait', next: 2, riders: [], to: null, load: 1 });
      O.phase = 'go'; O.t = 10;
    }], ['Back to the days', () => menu(), true]]);
  }
  function endDay() {
    const lv = S.level, li = S.li;
    S.running = false;
    hideOffer(); clearPickup(); for (const r of J.riders) G.player.body.remove(r);
    Object.assign(J, { state: 'off', riders: [], to: null, load: 1 });
    const takeHome = S.earned + S.tips - S.spent - S.fines - lv.rent, pass = goalMet(lv, takeHome);
    save.savings += takeHome;
    save.best = Math.max(save.best, takeHome);
    let stars = 0;
    if (li >= 0 && pass) {
      stars = starsFor(lv, takeHome);
      save.stars[li] = Math.max(save.stars[li] || 0, stars);
      save.unlocked = Math.max(save.unlocked, li + 2);
      if (li === LEVELS.length - 1) save.own = true;
    }
    store();
    const row = (a, b, cls = '') => `<div class="life-row ${cls}"><span>${a}</span><span>${b}</span></div>`;
    const next = li >= 0 && pass && li + 1 < LEVELS.length;
    showPanel(`<div class="bn">${pass ? 'দিন শেষ' : 'আজ হলো না'}</div><h2>${pass ? 'Day done' : 'Not today'}${stars ? ` <span class="life-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` : ''}</h2>
      <p>${pass ? lv.done : lv.fail}</p>
      ${row(`Fares (${S.trips} ${S.trips === 1 ? 'trip' : 'trips'})`, `৳${S.earned}`)}${row('Tips', `৳${S.tips}`)}${row('Cha', `-৳${S.spent}`)}${row('Fines', `-৳${S.fines}`)}${row('Rent to Karim mahajan', `-৳${lv.rent}`)}
      ${row('Take home', tk(takeHome), 'total')}${row('Savings', tk(save.savings))}
      ${lv.goal ? `<p style="margin-top:8px">${lv.goal.text}: <b>${pass ? 'done' : 'not yet'}</b></p>` : ''}`,
    [[next ? 'Next day' : pass ? 'Days' : 'Try again', () => (next ? begin(li + 1) : pass ? menu() : begin(li))], ['Upgrades', () => shop(() => menu()), true], ['Days', () => menu(), true]]);
  }
  function updateDay(dt) {
    if (!S.running || S.paused) return;
    const lv = S.level;
    S.t += dt;
    S.clock = lv.start + (S.t / lv.secs) * (lv.end - lv.start);
    if (S.clock >= lv.end && (J.state !== 'ride' || S.clock >= lv.end + 0.6)) endDay();
  }

  /* ---------------- menus: the days, and the upgrade shop ---------------- */
  function menu() {
    const cards = LEVELS.map((lv, i) => {
      const open = i < save.unlocked, st = save.stars[i] || 0;
      return `<button class="life-level${open ? '' : ' locked'}" data-i="${i}" ${open ? '' : 'disabled'}><span class="bnl">${lv.bn}</span><b>Day ${i + 1} · ${lv.title}</b>${open ? `<span class="life-stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>` : 'Locked'}</button>`;
    }).join('') + (save.own ? `<button class="life-level" data-i="-1"><span class="bnl">${FREE.bn}</span><b>Free day</b>No rent, your own rickshaw</button>` : '');
    showPanel(`<div class="bn">রিকশাওয়ালা</div><h2>Rahim's days in Mirpur</h2><p>Savings ${tk(save.savings)} · Best day ${tk(save.best)}</p><div class="life-levels">${cards}</div>`,
      [['Upgrades', () => shop(() => menu()), true], ['Just ride around', () => { hidePanel(); S.running = false; }, true]]);
    panel.querySelectorAll('.life-level:not(.locked)').forEach((b) => (b.onclick = () => begin(+b.dataset.i)));
  }
  function shop(back) {
    const items = UPGRADES.map((u) => {
      const own = has(u.id), can = save.savings >= u.cost;
      return `<div class="life-up"><div><b>${u.title}</b> <span style="font-family:var(--bn);color:#e8364f">${u.bn}</span><small>${u.text}</small></div>
        <button class="life-btn${own ? ' alt' : ''}" data-id="${u.id}" ${own || !can ? 'disabled' : ''}>${own ? 'Owned' : `৳${u.cost}`}</button></div>`;
    }).join('');
    showPanel(`<div class="bn">দোকান</div><h2>Upgrades</h2><p>Savings: ${tk(save.savings)}</p>${items}`, [['Done', back]]);
    panel.querySelectorAll('.life-up .life-btn:not([disabled])').forEach((b) => (b.onclick = () => {
      const u = UPGRADES.find((x) => x.id === b.dataset.id);
      if (save.savings < u.cost) return;
      save.savings -= u.cost; save.owned.push(u.id); store(); dressRickshaw();
      toast(`${u.title} bought`); shop(back);
    }));
  }
  // after the intro's Start button, show the days
  $('#start').addEventListener('click', () => setTimeout(menu, 450));

  /* ---------------- HUD each frame ---------------- */
  function updateHud() {
    el.wallet.textContent = S.running ? `${tk(S.earned + S.tips - S.spent - S.fines)} · ${S.trips} ${S.trips === 1 ? 'trip' : 'trips'}` : `Savings ${tk(save.savings)}`;
    hud.style.display = G.isStarted() ? '' : 'none';
    el.clock.style.display = el.goal.style.display = S.running ? '' : 'none';
    if (S.running) {
      const lv = S.level, net = S.earned + S.tips - S.spent - S.fines;
      el.clock.textContent = `${S.li < 0 ? 'Free day' : `Day ${S.li + 1}`} · ${fmt(S.clock)}${S.rain > 0.3 ? ' · বৃষ্টি' : ''}`;
      el.goal.textContent = lv.rent ? (net < lv.rent ? `Rent ৳${lv.rent}: ৳${Math.max(0, lv.rent - net)} to go` : lv.goal?.takeHome ? `Rent paid · ৳${Math.max(0, lv.goal.takeHome - (net - lv.rent))} more for the goal` : 'Rent paid · the rest is yours') : 'No rent today';
    }
    el.bar.style.width = `${S.stamina}%`;
    el.bar.style.background = S.stamina < 25 ? '#e8364f' : S.stamina < 55 ? '#f6c445' : '#6fd16f';
  }

  /* ---------------- hooks into the world ---------------- */
  hooks.update.push((dt, t) => {
    // menus open: the world keeps moving, you do not
    if (S.paused) { K.up = K.down = K.left = K.right = false; P.v *= 0.9; }
    updateDay(dt);
    updateStamina(dt);
    updateRain(dt);
    updateOfficer(dt, t);
    updateJob(dt, t);
    applyLight();
    updateHud();
  });
  hooks.effort = () => {
    const tired = S.stamina < 30 ? 0.5 + (S.stamina / 30) * 0.5 : 1;
    return tired * (J.state === 'ride' ? J.load || 1 : 1) * (1 - 0.15 * S.rain) * (has('wheels') ? 1.08 : 1) * (has('motor') ? 1.25 : 1);
  };
  hooks.busy = () => J.state === 'ride' || J.state === 'offer';
  hooks.bump = [(speed) => {
    if (J.state !== 'ride') return;
    J.bumps++;
    if (J.type === 'elder' || J.type === 'patient') {
      const cut = has('cushion') && J.type === 'elder' ? 5 : 10;
      J.fare = Math.max(10, J.fare - cut);
      toast(`"আস্তে, বাবা!" · -৳${cut}`);
    } else if (J.type === 'kids' && speed > 5) toast('"ওহ!" The kids hold on tight.');
  }];
  hooks.knock = [() => { if (J.state === 'ride') { J.fare = Math.max(10, J.fare - 20); toast('"আস্তে চালান, মামা!" · -৳20'); } }];
  hooks.bell = [() => {
    const r = has('bell') ? 20 : 11, fx = Math.sin(P.th), fz = Math.cos(P.th);
    for (const c of G.CROSSERS) { const dx = c.g.position.x - P.x, dz = c.g.position.z - P.z; if (Math.hypot(dx, dz) < r && dx * fx + dz * fz > 0 && c.state === 1) c.cur = 2.6; }
    for (const w of G.WALKERS) { const dx = w.g.position.x - P.x, dz = w.g.position.z - P.z; if (Math.hypot(dx, dz) < r && dx * fx + dz * fz > 0) w.pause = 0; }
    if (J.state === 'pickup' && J.waiting && Math.hypot(J.waiting.g.position.x - P.x, J.waiting.g.position.z - P.z) < 40) J.rivalT += 3;
  }];
  hooks.minimap = [(mg, mx, mz, mm) => {
    for (const s of STALLS) {
      const x = mx(s.x), y = mz(s.z);
      if (x < 0 || y < 0 || x > mm.width || y > mm.height) continue;
      mg.fillStyle = '#7a5230'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(x, y, 3.5, 0, 7); mg.fill(); mg.stroke();
    }
    if (J.state === 'off' || J.state === 'wait' || !S.running) return;
    const [tx, tz] = J.state === 'ride' ? J.to.stop : J.spot;
    const x = clamp(mx(tx), 6, mm.width - 6), y = clamp(mz(tz), 6, mm.height - 6);
    mg.fillStyle = J.state === 'ride' ? '#3fae5a' : J.state === 'return' ? '#7b3fb0' : J.type === 'patient' ? '#e8364f' : '#f6c445';
    mg.strokeStyle = '#3b2a1e'; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(x, y, 5, 0, 7); mg.fill(); mg.stroke();
  }];

  return {
    S, J, save, LEVELS, STALLS, menu, begin, endDay, shop,
    debug: () => ({ level: S.li, running: S.running, clock: +S.clock.toFixed(2), job: J.state, type: J.type, earned: S.earned, stamina: Math.round(S.stamina), rain: +S.rain.toFixed(2), officer: O.phase }),
  };
}
