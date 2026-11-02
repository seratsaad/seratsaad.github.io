import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// A low-res rickshaw ride around Mirpur 10, built on OpenStreetMap data (mirpur.json, made by tools/build_map.py).
// People, vehicles, sound and the station cards come from the made-up Dhaka ride in ../rickshaw.

/* ---------------- helpers ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261101);
const R = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// DM Sans matches the main site; Hind Siliguri for clean Bangla signs, Baloo Da 2 for hand-painted art
const BN = "'Hind Siliguri','Kohinoor Bangla','Noto Sans Bengali',sans-serif";
const BN_ART = "'Baloo Da 2','Hind Siliguri','Kohinoor Bangla',sans-serif";
const EN = "'DM Sans',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif";
const $ = (s) => document.querySelector(s);
// canvas text only uses a web font once it has loaded, so wait (but never more than 3 s)
await Promise.race([
  Promise.all(['500 40px "DM Sans"', '700 40px "DM Sans"', '800 40px "DM Sans"', '600 40px "Hind Siliguri"', '700 40px "Hind Siliguri"', '700 40px "Baloo Da 2"', '800 40px "Baloo Da 2"']
    .map((f) => document.fonts.load(f, 'Aaঅআ').catch(() => {}))),
  new Promise((r) => setTimeout(r, 3000)),
]);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// speckle noise and grime on a canvas, so nothing looks freshly painted
function grain(g, w, h, n, alpha = 0.08, light = false) {
  for (let i = 0; i < n; i++) {
    const v = light && Math.random() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function grime(g, w, h, n = 6) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h * 0.6;
    const gr = g.createLinearGradient(0, y, 0, y + h * 0.5);
    gr.addColorStop(0, 'rgba(40,30,20,.18)'); gr.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = gr; g.fillRect(x, y, 2 + Math.random() * 6, h * 0.5);
  }
}
// relief and gloss maps derived from a canvas texture's brightness
function reliefMaps(tex, strength = 2, gloss = null) {
  const src = tex.image, w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  const make = (fill) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), out = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fill(out.data, (y * w + x) * 4, x, y);
    g.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.repeat.copy(tex.repeat); t.anisotropy = 8;
    return t;
  };
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  const normal = make((o, i, x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  });
  const rough = gloss && make((o, i, x, y) => { const v = gloss(at(x, y)) * 255; o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; });
  return { normal, rough };
}
function cloneMap(t, repeat) { const c = t.clone(); c.needsUpdate = true; c.repeat.copy(repeat); return c; }
const matCache = new Map();
function M(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
  return matCache.get(key);
}
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

// the map, loaded before anything is built
const MAP = await fetch('mirpur.json').then((r) => r.json());

/* ---------------- content ---------------- */
const IMG = '../images/';
const KIND = {
  research: { color: '#22a7b8', label: 'Research' },
  beyond: { color: '#f07a2a', label: 'Beyond' },
  personal: { color: '#e8407f', label: 'Personal' },
  links: { color: '#3fae5a', label: 'Links' },
};
const STATIONS = [
  // Research Road, heading north
  { id: 'pantera', kind: 'research', x: 62, z: -60, dir: [1, 0], plaza: 10, ring: 4.5,
    sign: 'PANTERA', sub: 'Metal-rich stars', title: 'Metal-Rich Stars (PANTERA)', img: IMG + 'covers/pantera.jpg',
    text: 'Chemical fingerprints of stars that migrated out from the inner Galaxy to the solar neighborhood.',
    links: [['../research/pantera.html', 'Read more']] },
  { id: 'binaries', kind: 'research', x: -62, z: -120, dir: [-1, 0], plaza: 10, ring: 4.5,
    sign: 'Binary Stars', sub: 'Wide pairs and close pairs', title: 'Binary Stars', img: IMG + 'covers/wide-binaries.jpg',
    text: 'From the widest pairs that test gravity to the closest ones hiding in a single spectrum.',
    links: [['../research/wide-binaries.html', 'Read more']] },
  { id: 'ai', kind: 'research', x: 62, z: -180, dir: [1, 0], plaza: 10, ring: 4.5,
    sign: 'AI in Astronomy', sub: 'Agents and open tools', title: 'AI in Astronomy', img: IMG + 'covers/ai.jpg',
    text: 'Agents and open tools that measure spectra, query archives and help run a night at the telescope.',
    links: [['../research/ai-astronomy.html', 'Read more']] },
  { id: 'young', kind: 'research', x: -62, z: -240, dir: [-1, 0], plaza: 10, ring: 4.5,
    sign: 'Young Stars & AGN', sub: 'Undergraduate work', title: 'Young Stars & AGN', img: IMG + 'covers/young-stars.jpg',
    text: 'Young stellar objects in spectroscopic surveys and a supermassive black hole binary candidate, from my years at Vanderbilt.',
    links: [['../research/undergraduate.html', 'Read more']] },
  { id: 'lbt', kind: 'research', x: 0, z: -268, dir: [0, -1], plaza: 12, ring: 5, size: [18, 12, 14],
    sign: 'LBT', sub: 'Mount Graham, Arizona', title: 'At the Telescope', img: '../pantera-spectra.png',
    text: 'Spectra for PANTERA come from PEPSI on the Large Binocular Telescope, two 8.4 m mirrors on one mount.',
    links: [['../research/pantera.html', 'PANTERA']] },

  // Beyond Avenue, heading east
  { id: 'writing', kind: 'beyond', x: 90, z: -62, dir: [0, -1], plaza: 10, ring: 4.5,
    sign: 'Writing', sub: 'Astrobites', title: 'Writing', img: IMG + 'covers/writing.jpg',
    text: 'Explaining new astrophysics research for a broad audience as an author and editor at Astrobites.',
    links: [['../beyond/writing.html', 'Read more']] },
  { id: 'aifun', kind: 'beyond', x: 150, z: 62, dir: [0, 1], plaza: 10, ring: 4.5,
    sign: 'AI for Fun', sub: 'PorAI · PocketMoney', title: 'AI for Fun', img: IMG + 'covers/ai-fun.jpg',
    text: 'PorAI, a tutor for students in Bangladesh, and PocketMoney, a money agent you text.',
    links: [['../beyond/ai.html', 'Read more']] },
  { id: 'olympiad', kind: 'beyond', x: 210, z: -62, dir: [0, -1], plaza: 10, ring: 4.5,
    sign: 'Olympiad', sub: 'IOAA', title: 'Astronomy Olympiad', img: IMG + 'covers/olympiad.jpg',
    text: 'Training the next generation of astronomers through competitive problem-solving.',
    links: [['../beyond/olympiad.html', 'Read more']] },
  { id: 'others', kind: 'beyond', x: 270, z: 62, dir: [0, 1], plaza: 10, ring: 4.5,
    sign: 'Others', sub: 'Teaching · mentoring · quantum', title: 'Others', img: IMG + 'covers/quantum.jpg',
    text: 'Quantum computing education, teaching and grading, mentoring, and a library exhibit on tech advertising.',
    links: [['../beyond/others.html', 'Read more']] },

  // Links Lane, heading west
  { id: 'links', kind: 'links', x: -132, z: 0, dir: [-1, 0], plaza: 10, ring: 4.5,
    sign: 'Say Hello', sub: 'CV · GitHub · Scholar', title: 'Say hello', img: '../dp.jpg',
    text: 'Astronomy Ph.D. student at Ohio State, from Mirpur, Dhaka.',
    links: [['../Serat_Mahmud_Saad_CV.pdf', 'CV'], ['https://github.com/seratsaad', 'GitHub'],
      ['https://scholar.google.com/citations?user=8LJQ8mkAAAAJ&hl=en', 'Scholar'], ['../index.html', 'Classic site']] },

  // the hidden gali
  { id: 'mirpur', kind: 'personal', x: -70, z: 35, dir: [1, 0], ring: 3.2,
    sign: 'মিরপুর', sub: 'Home', title: 'Mirpur, Dhaka', img: IMG + 'mirpur.jpg',
    text: 'I grew up in Mirpur, a dense, loud, wonderfully chaotic neighborhood in the heart of Dhaka.' },
  { id: 'cadet', kind: 'personal', x: -95, z: 60, dir: [0, -1], ring: 3.2,
    sign: 'Cadet College', sub: 'Mirzapur · 2014-2020', title: 'Cadet college', img: IMG + 'cadet-college.jpg',
    text: 'Six years at a military boarding school. The sky over Mirzapur was darker than Dhaka, and I started looking up.' },
  { id: 'olympiad-years', kind: 'personal', x: -122, z: 60, dir: [0, 1], ring: 3.2,
    sign: 'Olympiad Years', sub: 'IOAA 2019 · Hungary', title: 'The Olympiad years', img: IMG + 'olympiad.jpg',
    text: 'The Astronomy Olympiad gave me purpose, mentors, lifelong friends, and the confidence to aim for something bigger.' },
  { id: 'nashville', kind: 'personal', x: -140, z: 92, dir: [-1, 0], ring: 3.2,
    sign: 'Nashville', sub: 'Vanderbilt', title: 'Nashville', img: IMG + 'vanderbilt.jpg',
    text: 'When the acceptance from Vanderbilt came, it felt unreal. The culture shock was spectacular.' },
  { id: 'subha', kind: 'personal', x: -118, z: 130, dir: [0, -1], ring: 3.2,
    sign: 'Subha', sub: 'The best discovery', title: 'Subha', img: IMG + 'with-subha.jpg',
    text: 'I met Subha at Vanderbilt. In the long run, the most important discovery I have made.' },
  { id: 'family', kind: 'personal', x: -92, z: 130, dir: [0, 1], ring: 3.2,
    sign: 'Family', sub: '8,000 miles away', title: 'Family', img: IMG + 'family.jpg',
    text: 'My parents and my sister, with me even when home is 8,000 miles away.' },
  { id: 'now', kind: 'personal', x: -63, z: 130, dir: [1, 0], ring: 3.2, off: 8.2,
    sign: 'Now', sub: 'Columbus, Ohio', title: 'Now', img: IMG + 'family2.jpg',
    text: 'A Ph.D. in Astronomy at Ohio State. The 5:30 AM wake-ups are optional now.',
    links: [['../personal.html', 'The longer version']] },
];

/* ---------------- renderer, sky and light ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // low res: fewer pixels to shade
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#f1c79e');
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 40, 230);
// low res: draw only as far as the haze lets you see
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 260);

// late-afternoon sun, low in the south-west, so shadows run long down the streets
const SUN_DIR = new THREE.Vector3(-0.6, 0.38, 0.7).normalize();
const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    top: { value: new THREE.Color('#7fa6cf') }, horizon: { value: HORIZON },
    ground: { value: new THREE.Color('#d7b08a') }, sunDir: { value: SUN_DIR },
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      vec3 c = d.y > 0.0 ? mix(horizon, top, pow(clamp(d.y * 1.4, 0.0, 1.0), 0.6)) : mix(horizon, ground, clamp(-d.y * 5.0, 0.0, 1.0));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.72, 0.42) * (pow(s, 6.0) * 0.32 + pow(s, 80.0) * 0.7);
      c = mix(c, vec3(1.0, 0.96, 0.86), smoothstep(0.99935, 0.99965, s));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false;
sky.scale.setScalar(0.34); // inside the shorter view distance
sky.renderOrder = -1;
scene.add(sky);

{
  // reflections for chrome, glass and puddles come from the same sky
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
  scene.environmentIntensity = 0.45;
}
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0xa7805c, 0.9));
const sun = new THREE.DirectionalLight(0xffd3a1, 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

/* ---------------- textures ---------------- */
const groundTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c29e78'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.5 ? 'rgba(90,70,50,.18)' : 'rgba(230,205,170,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(g, w, h, 9000, 0.18, true);
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(90, 90);

const asphaltTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6b6a70'; g.fillRect(0, 0, w, h);
  grain(g, w, h, 30000, 0.16, true);
  for (let i = 0; i < 7; i++) { // patched repairs
    g.fillStyle = `rgba(${70 + Math.random() * 20},${70 + Math.random() * 20},${75 + Math.random() * 20},.35)`;
    g.beginPath(); const x = Math.random() * w, y = Math.random() * h;
    g.moveTo(x, y); for (let k = 0; k < 6; k++) g.lineTo(x + Math.random() * 120, y + Math.random() * 90); g.fill();
  }
  for (let i = 0; i < 10; i++) { // oil and water stains
    const x = Math.random() * w, y = Math.random() * h, r = 15 + Math.random() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(20,20,25,.16)'); gr.addColorStop(1, 'rgba(20,20,25,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.strokeStyle = 'rgba(35,35,38,.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { // cracks
    let x = Math.random() * w, y = Math.random() * h;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
});
asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;

const tileTex = canvasTex(128, 128, (g) => {
  g.fillStyle = '#857d72'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 165 + Math.random() * 30;
    g.fillStyle = Math.random() < 0.06 ? '#6f675d' : `rgb(${v},${v - 6},${v - 16})`;
    g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
  }
  grain(g, 128, 128, 2500, 0.25);
});
tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
// three window styles for Dhaka facades: iron grilles, sunshade windows, shutters
function windowTile(style) {
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    grain(g, 128, 128, 1200, 0.07);
    if (style === 0) {
      g.fillStyle = '#353c46'; g.fillRect(30, 26, 68, 66);
      g.fillStyle = '#4c5a6a'; g.fillRect(32, 28, 64, 18);
      g.strokeStyle = '#2b3036'; g.lineWidth = 2.5;
      for (let x = 36; x < 98; x += 8) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x, 92); g.stroke(); }
      g.beginPath(); g.moveTo(30, 58); g.lineTo(98, 58); g.stroke();
      g.strokeStyle = '#3b6f5a'; g.lineWidth = 4; g.strokeRect(30, 26, 68, 66);
    } else if (style === 1) {
      g.fillStyle = '#2f3540'; g.fillRect(18, 30, 92, 58);
      g.fillStyle = '#566578'; g.fillRect(20, 32, 42, 54); g.fillStyle = '#495567'; g.fillRect(66, 32, 42, 54);
      const sh = g.createLinearGradient(0, 18, 0, 46); sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.fillRect(10, 18, 108, 28);
      g.fillStyle = '#d9d2c6'; g.fillRect(10, 14, 108, 6);
    } else {
      g.fillStyle = '#6b4c34'; g.fillRect(36, 20, 26, 74); g.fillRect(66, 20, 26, 74);
      g.strokeStyle = '#4a3322'; g.lineWidth = 2;
      for (let y = 24; y < 94; y += 6) { g.beginPath(); g.moveTo(36, y); g.lineTo(62, y); g.moveTo(66, y); g.lineTo(92, y); g.stroke(); }
    }
    g.fillStyle = '#cfc8bb'; g.fillRect(24, 94, 80, 5);
    for (let i = 0; i < 4; i++) { // rain streaks under the sill
      const x = 30 + Math.random() * 68, gr = g.createLinearGradient(0, 98, 0, 128);
      gr.addColorStop(0, 'rgba(50,40,30,.28)'); gr.addColorStop(1, 'rgba(50,40,30,0)');
      g.fillStyle = gr; g.fillRect(x, 98, 3 + Math.random() * 5, 30);
    }
    g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, 122, 128, 6);
    g.fillStyle = '#ffffff'; g.fillRect(0, 126, 4, 2); // keep the corner texel clean for plain faces
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const WINDOW_TEX = [0, 1, 2].map(windowTile);
function stationSignTex(st, kc) {
  const personal = st.kind === 'personal';
  const w = 1024, h = personal ? 300 : 320;
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#2a1d14'; g.fillRect(0, 0, w, h);
    const r = 26, b = 12;
    g.fillStyle = '#fbf3e4'; g.beginPath(); g.roundRect(b, b, w - 2 * b, h - 2 * b, r); g.fill();
    g.fillStyle = kc; g.beginPath(); g.roundRect(b, b, h - 2 * b, h - 2 * b, [r, 0, 0, r]); g.fill();
    // icon
    const cx = h / 2, cy = h / 2, s = h * 0.26;
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    if (st.kind === 'research') { // a ringed planet
      g.lineWidth = s * 0.13;
      g.beginPath(); g.ellipse(cx, cy, s * 1.15, s * 0.34, -0.38, Math.PI, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, cy, s * 0.62, 0, 7); g.fill();
      g.fillStyle = kc; g.beginPath(); g.arc(cx - s * 0.2, cy - s * 0.2, s * 0.14, 0, 7); g.fill();
      g.beginPath(); g.ellipse(cx, cy, s * 1.15, s * 0.34, -0.38, 0, Math.PI); g.stroke();
    } else if (st.kind === 'beyond') { // a sparkle
      const star = (x, y, q) => { g.beginPath(); g.moveTo(x, y - q); g.quadraticCurveTo(x, y, x + q, y); g.quadraticCurveTo(x, y, x, y + q); g.quadraticCurveTo(x, y, x - q, y); g.quadraticCurveTo(x, y, x, y - q); g.fill(); };
      star(cx - s * 0.15, cy + s * 0.1, s * 0.95); star(cx + s * 0.62, cy - s * 0.62, s * 0.38);
    } else if (st.kind === 'links') { // a speech bubble
      g.beginPath(); g.roundRect(cx - s, cy - s * 0.75, s * 2, s * 1.3, s * 0.35); g.fill();
      g.beginPath(); g.moveTo(cx - s * 0.45, cy + s * 0.5); g.lineTo(cx - s * 0.7, cy + s * 1.05); g.lineTo(cx - s * 0.05, cy + s * 0.5); g.fill();
      g.fillStyle = kc; for (const dx of [-0.5, 0, 0.5]) { g.beginPath(); g.arc(cx + dx * s, cy - s * 0.1, s * 0.13, 0, 7); g.fill(); }
    } else { // a heart
      g.beginPath(); g.moveTo(cx, cy + s * 0.85);
      g.bezierCurveTo(cx - s * 1.3, cy - s * 0.05, cx - s * 0.7, cy - s * 1.05, cx, cy - s * 0.4);
      g.bezierCurveTo(cx + s * 0.7, cy - s * 1.05, cx + s * 1.3, cy - s * 0.05, cx, cy + s * 0.85); g.fill();
    }
    // just the title, set in DM Sans like the main site
    const x0 = h + 40, maxW = w - x0 - 50;
    const isBN = /[ঀ-৿]/.test(st.sign);
    let size = h * 0.4;
    const font = (q) => (isBN ? `600 ${q}px ${BN}` : `600 ${q}px ${EN}`);
    g.font = font(size);
    while (g.measureText(st.sign).width > maxW) { size -= 3; g.font = font(size); }
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#26272b';
    g.fillText(st.sign, x0, h * (isBN ? 0.5 : 0.47));
    // rickshaw-art stripe along the bottom edge
    const cols = ['#e8364f', '#f6c445', '#1f8a5b', '#1d6fb8'];
    for (let x = h - b, i = 0; x < w - b - r; x += 22, i++) { g.fillStyle = cols[i % 4]; g.fillRect(x, h - b - 12, 22, 12); }
    grain(g, w, h, w * 2, 0.06, true);
  });
}

/* ---------------- the map: Mirpur 10 from OpenStreetMap ---------------- */
// metres around Mirpur-10 Circle, x east and z south; the ride stays inside EDGE
const EDGE = 780;
const dm = (a) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i] / 10, a[i + 1] / 10]); return p; };
const CELL = 16, EMPTY = [];
const gk = (cx, cz) => cx * 100003 + cz;
function gridAdd(grid, minX, maxX, minZ, maxZ, item) {
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      const k = gk(cx, cz);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(item);
    }
}
const gridAt = (grid, x, z) => grid.get(gk(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY;
function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function segNear(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
  return [ax + u * dx, az + u * dz];
}
function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}
const rect = (cx, cz, sx, sz, h = 3) => ({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h });
const _c = new THREE.Color();
// vertex colours for merged geometry, optionally darker toward the bottom
function paint(g, color, { shade = 0 } = {}) {
  const p = g.attributes.position;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y, col = new Float32Array(p.count * 3), base = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    _c.copy(base);
    if (shade) _c.multiplyScalar(1 - shade * (1 - (p.getY(i) - y0) / Math.max(0.01, y1 - y0)));
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// a point along a polyline and the direction there: [x, z, dirX, dirZ]
function along(pts, cum, s) {
  s = clamp(s, 0, cum[cum.length - 1]);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = cum[i] - cum[i - 1] || 1e-6, u = (s - cum[i - 1]) / L;
  return [ax + (bx - ax) * u, az + (bz - az) * u, (bx - ax) / L, (bz - az) / L];
}

// roads: p primary, t tertiary, r residential, g gali (living street), s service, f footpath
const ROADS = MAP.r.map(([cls, w, ow, name, ...c]) => ({ cls, w: w / 10, ow, name, pts: dm(c) }))
  .filter((r) => r.pts.some(([x, z]) => Math.abs(x) < EDGE + 150 && Math.abs(z) < EDGE + 150));
const RGRID = new Map();
for (const r of ROADS) {
  r.cum = cumLen(r.pts); r.len = r.cum[r.cum.length - 1];
  for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], m = r.w / 2 + 3;
    gridAdd(RGRID, Math.min(ax, bx) - m, Math.max(ax, bx) + m, Math.min(az, bz) - m, Math.max(az, bz) + m, { r, i });
  }
}
// how far a point is from the edge of the nearest road (negative = on it), and that road
function nearRoad(x, z, classes = null) {
  let best = null, bd = 1e9;
  for (const { r, i } of gridAt(RGRID, x, z)) {
    if (classes && !classes.includes(r.cls)) continue;
    const [px, pz] = segNear(x, z, ...r.pts[i - 1], ...r.pts[i]), d = Math.hypot(x - px, z - pz) - r.w / 2;
    if (d < bd) { bd = d; best = r; }
  }
  return [bd, best];
}

// buildings: outlines turned clockwise so (-dz, dx) along each wall points outward
const BUILDINGS = [], WALLS = new Map(), BGRID = new Map();
for (const [lv, kind, ...c] of MAP.b) {
  const pts = dm(c);
  let A = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    A += x0 * z1 - x1 * z0;
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x0); minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z0);
  }
  if (maxX < -EDGE - 120 || minX > EDGE + 120 || maxZ < -EDGE - 120 || minZ > EDGE + 120) continue;
  if (A > 0) pts.reverse();
  const b = { lv, kind, h: kind === 1 ? 3 : lv * 3.2, y0: 0, pts, minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  // a main road running through an outline means it is built over the road (the metro station) or mis-mapped
  let crossed = false;
  for (let gx = minX; gx <= maxX + CELL && !crossed; gx += CELL) for (let gz = minZ; gz <= maxZ + CELL && !crossed; gz += CELL) {
    for (const { r, i } of gridAt(RGRID, Math.min(gx, maxX), Math.min(gz, maxZ))) {
      if (r.cls === 'f') continue;
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      for (let u = 0; u <= 1; u += 0.125) if (inPoly(ax + (bx - ax) * u, az + (bz - az) * u, pts)) { crossed = true; break; }
      if (crossed) break;
    }
  }
  if (crossed && (maxX - minX) * (maxZ - minZ) > 300) { b.y0 = 8.6; b.h = 15; b.elevated = true; }
  b.solid = !crossed;
  BUILDINGS.push(b);
  gridAdd(BGRID, minX, maxX, minZ, maxZ, b);
  if (b.solid) for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    gridAdd(WALLS, Math.min(ax, bx) - 2, Math.max(ax, bx) + 2, Math.min(az, bz) - 2, Math.max(az, bz) + 2, [ax, az, bx, bz, b]);
  }
}
function buildingAt(x, z) {
  for (const b of gridAt(BGRID, x, z)) if (!b.elevated && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && inPoly(x, z, b.pts)) return b;
  return null;
}
const CIRCLES = []; // posts and pillars the rickshaw bumps into

/* ---------------- textures for the map ---------------- */
// four ground-floor shopfronts that repeat every 14.4 m: shutters, an open shop, a glass front
const shopTex = canvasTex(512, 128, (g) => {
  for (let k = 0; k < 4; k++) {
    const x = k * 128;
    g.fillStyle = '#9a9184'; g.fillRect(x, 0, 128, 128);
    g.fillStyle = '#cfc6b8'; g.fillRect(x, 0, 128, 12);
    if (k === 0 || k === 2) {
      g.fillStyle = k === 0 ? '#7b8086' : pick(['#2f6f9f', '#a8452f', '#2e7d4f']); g.fillRect(x + 6, 18, 116, 110);
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 20; y < 128; y += 5) g.fillRect(x + 6, y, 116, 1.5);
    } else if (k === 1) {
      g.fillStyle = '#3a2f28'; g.fillRect(x + 6, 18, 116, 110);
      for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
        g.fillStyle = pick(['#e8364f', '#f6c445', '#1f8a5b', '#1d6fb8', '#efe9dc', '#e07a3a', '#8a5aa8']);
        g.fillRect(x + 10 + i * 12, 30 + row * 22, 9, 14);
      }
      g.fillStyle = '#7a5230'; g.fillRect(x + 6, 104, 116, 24);
    } else {
      g.fillStyle = '#2a3a44'; g.fillRect(x + 6, 18, 116, 110);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(x + 20, 18); g.lineTo(x + 50, 18); g.lineTo(x + 20, 80); g.fill();
      g.fillStyle = '#c9c2b6'; g.fillRect(x + 62, 18, 3, 110);
    }
  }
  grain(g, 512, 128, 4000, 0.14, true); grime(g, 512, 128, 10);
});
shopTex.wrapS = shopTex.wrapT = THREE.RepeatWrapping;

/* ---------------- ground, roads, parks ---------------- */
function flatBuf() { return { p: [], uv: [] }; }
// a triangle lying on the ground, wound to face up
function flatTri(B, a, b, c, y, uvs = 1 / 9) {
  const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  for (const q of up > 0 ? [a, b, c] : [a, c, b]) { B.p.push(q[0], y, q[1]); B.uv.push(q[0] * uvs, q[1] * uvs); }
}
// a strip along a polyline, with round joints so corners and junctions close up
function ribbon(B, pts, w, y, uvs) {
  const h = w / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az) || 1e-6;
    const nx = (-(bz - az) / L) * h, nz = ((bx - ax) / L) * h;
    const a1 = [ax + nx, az + nz], a2 = [ax - nx, az - nz], b1 = [bx + nx, bz + nz], b2 = [bx - nx, bz - nz];
    flatTri(B, a1, a2, b2, y, uvs); flatTri(B, a1, b2, b1, y, uvs);
  }
  for (const [x, z] of pts) for (let k = 0; k < 10; k++) {
    const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
    flatTri(B, [x, z], [x + Math.cos(a0) * h, z + Math.sin(a0) * h], [x + Math.cos(a1) * h, z + Math.sin(a1) * h], y, uvs);
  }
}
function polyFill(B, pts, y, uvs) {
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of tris) flatTri(B, pts[i], pts[j], pts[k], y, uvs);
}
function flatMesh(B, mat, shadow = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = shadow;
  scene.add(m);
  return m;
}
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshLambertMaterial({ map: groundTex }));
  groundTex.repeat.set(150, 150);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const green = flatBuf(), pitch = flatBuf(), water = flatBuf();
  for (const [kind, ...c] of MAP.green) polyFill(kind === 'pitch' || kind === 'stadium' ? pitch : green, dm(c), kind === 'pitch' ? 0.03 : 0.02, 1 / 6);
  for (const c of MAP.water) polyFill(water, dm(c), 0.04, 1 / 6);
  flatMesh(green, new THREE.MeshLambertMaterial({ color: '#7f9f58' }));
  flatMesh(pitch, new THREE.MeshLambertMaterial({ color: '#8dbb5c' }));
  flatMesh(water, new THREE.MeshLambertMaterial({ color: '#4f7f86' }));
  // sidewalks under the big roads, then the roads themselves, bigger roads drawn on top
  const side = flatBuf();
  for (const r of ROADS) if (r.cls === 'p' || r.cls === 't') ribbon(side, r.pts, r.w + 5, 0.05, 1 / 3);
  flatMesh(side, new THREE.MeshLambertMaterial({ map: tileTex, color: '#d8d0c4', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const ROAD_LOOK = { f: ['#f2e6d4', 0.06], s: ['#e4dfd8', 0.065], g: ['#ecdccb', 0.07], r: ['#e2ded8', 0.075], t: ['#d8d6da', 0.085], p: ['#cfcdd3', 0.095] };
  let k = 2;
  for (const cls of ['f', 's', 'g', 'r', 't', 'p']) {
    const B = flatBuf();
    for (const r of ROADS) if (r.cls === cls) ribbon(B, r.pts, r.w, ROAD_LOOK[cls][1], 1 / 9);
    flatMesh(B, new THREE.MeshLambertMaterial({ map: asphaltTex, color: ROAD_LOOK[cls][0], polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k }));
    k++;
  }
  // dashed lane lines on the one-way carriageways
  const dash = flatBuf();
  for (const r of ROADS) {
    if (!(r.cls === 'p' || r.cls === 't') || !r.ow) continue;
    const lanes = Math.round((r.w - 0.8) / 3.3);
    for (let l = 1; l < lanes; l++) {
      const off = -r.w / 2 + 0.4 + (l * (r.w - 0.8)) / lanes;
      for (let s = 2; s < r.len - 3; s += 9) {
        const [x0, z0, dx, dz] = along(r.pts, r.cum, s), [x1, z1] = along(r.pts, r.cum, s + 3);
        const ox = dz * off, oz = -dx * off;
        ribbon(dash, [[x0 + ox, z0 + oz], [x1 + ox, z1 + oz]], 0.16, 0.1, 1);
      }
    }
  }
  flatMesh(dash, new THREE.MeshLambertMaterial({ color: '#e8e4da', polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }));
}

/* ---------------- buildings, merged in chunks ---------------- */
const FACADES = ['#e8dcc4', '#f2e1c2', '#d9c3a5', '#e7b9a6', '#c9d8c5', '#b8cfd9', '#efd38c', '#e2a68b', '#d7d1c9', '#f0e6d8', '#c4b19a', '#9fb8ad', '#e9c7c0', '#d6b3d1', '#e3e0d8', '#cbbba0'];
const ROOFS = ['#a69e92', '#9a9186', '#b2aa9e', '#8f877c', '#b7aea2'];
const TANKS = [], DOMES = [];
{
  const chunks = new Map();
  const bufs = () => ({ p: [], n: [], uv: [], c: [] });
  const chunk = (b) => {
    const k = Math.floor(b.cx / 150) * 100 + Math.floor(b.cz / 150);
    if (!chunks.has(k)) chunks.set(k, { wall: [bufs(), bufs(), bufs()], shop: bufs(), roof: bufs() });
    return chunks.get(k);
  };
  const vert = (B, x, y, z, nx, ny, nz, u, v, col) => { B.p.push(x, y, z); B.n.push(nx, ny, nz); B.uv.push(u, v); B.c.push(col.r, col.g, col.b); };
  // one wall band between heights y0 and y1, its texture repeating every `tile` metres
  function band(B, b, y0, y1, tile, vTile, col) {
    let u = 0;
    for (let i = 0; i < b.pts.length; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[(i + 1) % b.pts.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L, u0 = tile ? u / tile : 0, u1 = tile ? (u + L) / tile : 0;
      const v0 = vTile ? 0 : 0, v1 = vTile ? (y1 - y0) / vTile : 0;
      for (const [x, y, z, uu, vv] of [[ax, y0, az, u0, v0], [bx, y0, bz, u1, v0], [bx, y1, bz, u1, v1], [ax, y0, az, u0, v0], [bx, y1, bz, u1, v1], [ax, y1, az, u0, v1]]) vert(B, x, y, z, nx, 0, nz, uu, vv, col);
      u += L;
    }
  }
  function roofCap(B, b, y, col) {
    const tris = THREE.ShapeUtils.triangulateShape(b.pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of tris) {
      let [a, c2, d] = [b.pts[i], b.pts[j], b.pts[k]];
      if ((c2[1] - a[1]) * (d[0] - a[0]) - (c2[0] - a[0]) * (d[1] - a[1]) < 0) [c2, d] = [d, c2];
      for (const q of [a, c2, d]) vert(B, q[0], y, q[1], 0, 1, 0, 0, 0, col);
      if (b.elevated) for (const q of [a, d, c2]) vert(B, q[0], b.y0, q[1], 0, -1, 0, 0, 0, col);
    }
  }
  const white = new THREE.Color('#ffffff');
  for (const b of BUILDINGS) {
    const ch = chunk(b), style = Math.floor(rand() * 3);
    const wall = new THREE.Color(b.kind === 2 ? '#f3f1ea' : b.kind === 1 ? pick(['#8d969c', '#9c6b4e', '#7f8a7a']) : b.elevated ? '#d9dcd8' : pick(FACADES)).offsetHSL(R(-0.02, 0.02), R(-0.05, 0.05), R(-0.05, 0.03));
    if (b.elevated) band(ch.wall[1], b, b.y0, b.h, 3.2, 3.2, wall);
    else if (b.kind === 1 || b.h <= 3.3) band(b.kind === 1 ? ch.wall[0] : ch.shop, b, 0, b.h, b.kind === 1 ? 0 : 14.4, b.kind === 1 ? 0 : 3.2, b.kind === 1 ? wall : white);
    else { band(ch.shop, b, 0, 3.2, 14.4, 3.2, white); band(ch.wall[style], b, 3.2, b.h, 3.2, 3.2, wall); }
    roofCap(ch.roof, b, b.h, _c.set(pick(ROOFS)).offsetHSL(0, 0, R(-0.04, 0.04)));
    if (b.kind === 2) DOMES.push([b.cx, b.h, b.cz, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.3]);
    else if (b.lv >= 3 && !b.elevated && rand() < 0.45) TANKS.push([b.cx + R(-1, 1), b.h + 0.75, b.cz + R(-1, 1)]);
  }
  const wallMats = WINDOW_TEX.map((t) => new THREE.MeshLambertMaterial({ map: t, vertexColors: true }));
  const shopMat = new THREE.MeshLambertMaterial({ map: shopTex, vertexColors: true });
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const make = (B, mat) => {
    if (!B.p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  for (const ch of chunks.values()) { ch.wall.forEach((B, i) => make(B, wallMats[i])); make(ch.shop, shopMat); make(ch.roof, roofMat); }
  const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.6, 1.5, 10), new THREE.MeshLambertMaterial({ color: '#1c1c20' }), TANKS.length);
  const o = new THREE.Object3D();
  TANKS.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); tank.setMatrixAt(i, o.matrix); });
  tank.castShadow = true; scene.add(tank);
  const dome = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2f8a5b' }), DOMES.length);
  DOMES.forEach(([x, y, z, r], i) => { o.position.set(x, y, z); o.scale.setScalar(Math.max(1.2, r)); o.updateMatrix(); dome.setMatrixAt(i, o.matrix); });
  scene.add(dome);
}

/* ---------------- shop signs with the real names from the map ---------------- */
const SIGN_SPOTS = [];
{
  const GENERIC = [['চা', '#1f8a5b'], ['মিষ্টি', '#e8364f'], ['ফার্মেসী', '#1d6fb8'], ['হোটেল', '#b8321d'], ['মোবাইল', '#7b3fb0'], ['টেইলার্স', '#d18a1b'],
    ['বিরিয়ানি', '#a0242f'], ['লাইব্রেরি', '#0f7a78'], ['স্টোর', '#3d5a99'], ['ফটোকপি', '#c25b16'], ['সেলুন', '#6b3fa0'], ['টেলিকম', '#d4145a'],
    ['হার্ডওয়্যার', '#5a6470'], ['কনফেকশনারি', '#b3261e'], ['ক্লিনিক', '#1d6fb8'], ['বস্ত্র বিতান', '#a0522d']];
  const COLS = ['#1f8a5b', '#e8364f', '#1d6fb8', '#b8321d', '#7b3fb0', '#d18a1b', '#0f7a78', '#3d5a99', '#c25b16', '#d4145a', '#2e7d4f', '#a0242f'];
  const pois = MAP.poi.map(([x, z, name, en, kind]) => ({ x: x / 10, z: z / 10, name, en, kind }))
    .filter((p) => Math.abs(p.x) < EDGE && Math.abs(p.z) < EDGE)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 4 * 64 - GENERIC.length);
  const entries = GENERIC.map(([t, bg]) => ({ text: t, bg })).concat(pois.map((p, i) => ({ text: p.name, bg: COLS[i % COLS.length], poi: p })));
  // 2048 x 2048 atlases holding 64 signs of 512 x 128 each
  const atlases = [];
  for (let a = 0; a * 64 < entries.length; a++) {
    atlases.push(canvasTex(2048, 2048, (g) => {
      for (let k = 0; k < 64 && a * 64 + k < entries.length; k++) {
        const { text, bg } = entries[a * 64 + k], x = (k % 4) * 512, y = Math.floor(k / 4) * 128;
        g.fillStyle = bg; g.fillRect(x, y, 512, 128);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 512, 7); g.fillRect(x, y + 121, 512, 7);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const isBN = /[ঀ-৿]/.test(text);
        let size = 66;
        const font = (s) => `700 ${s}px ${isBN ? BN : EN}`;
        g.font = font(size);
        while (g.measureText(text).width > 470 && size > 20) { size -= 3; g.font = font(size); }
        g.fillText(text, x + 256, y + 66);
      }
      grain(g, 2048, 2048, 60000, 0.1, true);
    }));
  }
  const bufs = atlases.map(() => ({ p: [], n: [], uv: [] }));
  function place(entryIndex, ax, az, bx, bz, cx, cz) {
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
    const w = Math.min(L * 0.85, 4.6), h = w / 4, y = 3.25 + h / 2 + 0.1;
    const x = cx + nx * 0.14, z = cz + nz * 0.14;
    const a = Math.floor(entryIndex / 64), k = entryIndex % 64, u0 = (k % 4) / 4, u1 = u0 + 0.25, v1 = 1 - Math.floor(k / 4) / 16, v0 = v1 - 1 / 16;
    const B = bufs[a];
    const c = [[x - dx * w / 2, y - h / 2, z - dz * w / 2, u0, v0], [x + dx * w / 2, y - h / 2, z + dz * w / 2, u1, v0], [x + dx * w / 2, y + h / 2, z + dz * w / 2, u1, v1], [x - dx * w / 2, y + h / 2, z - dz * w / 2, u0, v1]];
    for (const q of [c[0], c[1], c[2], c[0], c[2], c[3]]) { B.p.push(q[0], q[1], q[2]); B.n.push(nx, 0, nz); B.uv.push(q[3], q[4]); }
    SIGN_SPOTS.push([x + nx * 1.6, z + nz * 1.6]);
  }
  const used = new Set();
  // named shops go on the wall nearest to where the map puts them
  entries.forEach((e, i) => {
    if (!e.poi) return;
    let best = null, bd = 12;
    for (const dx of [-CELL, 0, CELL]) for (const dz of [-CELL, 0, CELL]) for (const wseg of gridAt(WALLS, e.poi.x + dx, e.poi.z + dz)) {
      const [ax, az, bx, bz, b] = wseg;
      if (b.h < 4 || Math.hypot(bx - ax, bz - az) < 2.5 || used.has(wseg)) continue;
      const [px, pz] = segNear(e.poi.x, e.poi.z, ax, az, bx, bz), d = Math.hypot(px - e.poi.x, pz - e.poi.z);
      if (d < bd) { bd = d; best = [wseg, px, pz]; }
    }
    if (!best) return;
    const [wseg, px, pz] = best, [ax, az, bx, bz] = wseg;
    used.add(wseg);
    const L = Math.hypot(bx - ax, bz - az), t = clamp(((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / (L * L), 0.3, 0.7);
    place(i, ax, az, bx, bz, ax + (bx - ax) * t, az + (bz - az) * t);
  });
  // and generic shop signs on walls that face a big road
  for (const b of BUILDINGS) {
    if (b.h < 4 || !b.solid) continue;
    for (let i = 0; i < b.pts.length; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[(i + 1) % b.pts.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 3) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, nx = -(bz - az) / L, nz = (bx - ax) / L;
      const [d] = nearRoad(mx + nx * 4, mz + nz * 4, ['p', 't', 'r']);
      if (d > 2 || rand() > 0.55) continue;
      const key = gridAt(WALLS, mx, mz).find((wseg) => wseg[0] === ax && wseg[1] === az && wseg[2] === bx);
      if (key && used.has(key)) continue;
      place(Math.floor(rand() * GENERIC.length), ax, az, bx, bz, mx, mz);
    }
  }
  bufs.forEach((B, a) => {
    if (!B.p.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: atlases[a] })));
  });
}

/* ---------------- Metro Line 6 on its viaduct ---------------- */
const RAIL = [];
{
  const deckMat = new THREE.MeshLambertMaterial({ color: '#c9c4bb' }), pierMat = new THREE.MeshLambertMaterial({ color: '#b9b3a8' });
  const parts = [], piers = [];
  for (const c of MAP.rail) {
    const all = dm(c);
    // keep the stretch inside the map
    const pts = all.filter(([x, z]) => Math.abs(x) < EDGE + 200 && Math.abs(z) < EDGE + 200);
    if (pts.length < 2) continue;
    const cum = cumLen(pts);
    RAIL.push({ pts, cum, len: cum[cum.length - 1] });
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
      const g = new THREE.BoxGeometry(L + 0.6, 1.4, 8.2);
      g.rotateY(-Math.atan2(bz - az, bx - ax)); g.translate((ax + bx) / 2, 10.3, (az + bz) / 2);
      parts.push(g);
    }
    for (let s = 10; s < cum[cum.length - 1]; s += 34) {
      const [x, z, dx, dz] = along(pts, cum, s);
      if (piers.some(([px, pz]) => Math.hypot(px - x, pz - z) < 12)) continue;
      piers.push([x, z, Math.atan2(dz, dx)]);
    }
  }
  if (parts.length) {
    const deck = new THREE.Mesh(mergeGeometries(parts), deckMat);
    deck.castShadow = deck.receiveShadow = true; scene.add(deck);
    const pg = [];
    for (const [x, z, a] of piers) {
      const col = new THREE.BoxGeometry(1.8, 9.6, 2.2); col.rotateY(-a); col.translate(x, 4.8, z);
      const cap = new THREE.BoxGeometry(2.4, 1.2, 7); cap.rotateY(-a); cap.translate(x, 9.2, z);
      pg.push(col, cap);
      CIRCLES.push({ x, z, r: 1.3 });
    }
    const pier = new THREE.Mesh(mergeGeometries(pg), pierMat);
    pier.castShadow = true; scene.add(pier);
  }
}
// a six-car train running back and forth on each track
const TRAINS = [];
{
  const carGeo = (() => {
    const body = new THREE.BoxGeometry(19.2, 3.2, 3);
    paint(body, '#f1f1ee');
    const win = new THREE.BoxGeometry(17.6, 1, 3.04); win.translate(0, 0.45, 0); paint(win, '#1f2933');
    const red = new THREE.BoxGeometry(19.24, 0.22, 3.06); red.translate(0, -0.35, 0); paint(red, '#d32f2f');
    const grn = new THREE.BoxGeometry(19.24, 0.22, 3.06); grn.translate(0, -0.6, 0); paint(grn, '#1f7a3f');
    return mergeGeometries([body, win, red, grn]);
  })();
  const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  RAIL.slice(0, 2).forEach((line, li) => {
    const cars = [];
    for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(carGeo, carMat); m.castShadow = true; scene.add(m); cars.push(m); }
    TRAINS.push({ line, cars, s: R(0, line.len), dir: li ? -1 : 1, side: li ? 1.9 : -1.9, wait: 0 });
  });
}
function updateTrains(dt) {
  for (const T of TRAINS) {
    const L = T.line.len, span = 6 * 19.6;
    if (T.wait > 0) T.wait -= dt;
    else {
      T.s += T.dir * 16 * dt;
      if (T.s > L - 2) { T.s = L - 2; T.dir = -1; T.wait = 6; }
      if (T.s < span) { T.s = span; T.dir = 1; T.wait = 6; }
    }
    T.cars.forEach((m, k) => {
      const s = T.s - k * 19.6 - 9.8, [x, z, dx, dz] = along(T.line.pts, T.line.cum, s);
      m.position.set(x + dz * T.side, 12.75, z - dx * T.side);
      m.rotation.y = -Math.atan2(dz, dx);
    });
  }
}

/* ---------------- people ---------------- */
const SKIN = ['#7a4b2c', '#8d5a36', '#6b3f22', '#a06a43', '#5e3a22'];
const LUNGI_TEX = [['#2b5c8a', 'rgba(40,140,90,.7)'], ['#6a2a4a', 'rgba(230,180,60,.6)'], ['#2f4f2f', 'rgba(220,220,220,.5)'], ['#3b3b6b', 'rgba(200,60,60,.6)']].map(([a, b]) => {
  const t = canvasTex(64, 64, (g) => { g.fillStyle = a; g.fillRect(0, 0, 64, 64); g.fillStyle = b; g.fillRect(0, 0, 64, 10); g.fillRect(0, 32, 64, 10); g.fillRect(0, 0, 10, 64); g.fillRect(32, 0, 10, 64); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
});
// people are built from five merged meshes (body, two legs, two arms) to keep draw calls low
const PERSON_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
const ell = (geo, x, y = x, z = x) => geo.scale(x, y, z);
const PG = {
  // head and face, relative to the centre of the head
  head: ell(new THREE.SphereGeometry(0.11, 18, 14), 0.9, 1.08, 0.98),
  jaw: ell(new THREE.SphereGeometry(0.08, 14, 10), 0.95, 0.75, 1),
  ear: ell(new THREE.SphereGeometry(0.026, 8, 6), 0.45, 1, 0.8),
  nose: ell(new THREE.SphereGeometry(0.02, 8, 6), 0.9, 1.5, 1),
  eye: ell(new THREE.SphereGeometry(0.019, 10, 6), 1.2, 0.75, 0.5),
  iris: new THREE.SphereGeometry(0.0105, 8, 6),
  brow: new THREE.BoxGeometry(0.048, 0.011, 0.012),
  mouth: new THREE.BoxGeometry(0.045, 0.011, 0.01),
  hairShort: ell(new THREE.SphereGeometry(0.118, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), 0.92, 1.08, 1.0).rotateX(-0.5),
  hairLong: ell(new THREE.SphereGeometry(0.121, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), 0.93, 1.08, 1.02).rotateX(-0.75),
  bun: new THREE.SphereGeometry(0.055, 10, 8),
  beard: ell(new THREE.SphereGeometry(0.108, 16, 8, 0.2, Math.PI - 0.4, Math.PI * 0.62, Math.PI * 0.33), 0.92, 1.08, 1.0),
  stache: ell(new THREE.SphereGeometry(0.03, 8, 6), 1.5, 0.35, 0.6),
  wrap: ell(new THREE.SphereGeometry(0.125, 18, 12, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.82), 0.95, 1.08, 1.04),
  cap: new THREE.CylinderGeometry(0.105, 0.11, 0.07, 16),
  // body
  neck: new THREE.CylinderGeometry(0.045, 0.055, 0.12, 10),
  torso: ell(new THREE.CylinderGeometry(0.185, 0.155, 0.52, 16), 1, 1, 0.62),
  chest: ell(new THREE.SphereGeometry(0.185, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 1, 0.38, 0.62),
  shoulder: new THREE.SphereGeometry(0.075, 12, 8),
  collar: ell(new THREE.TorusGeometry(0.06, 0.016, 6, 16), 1, 1, 0.8).rotateX(Math.PI / 2),
  placket: new THREE.BoxGeometry(0.026, 0.42, 0.012),
  pocket: new THREE.BoxGeometry(0.075, 0.075, 0.012),
  tie: new THREE.BoxGeometry(0.04, 0.24, 0.012),
  pelvis: ell(new THREE.CylinderGeometry(0.158, 0.145, 0.24, 14), 1, 1, 0.7),
  belt: ell(new THREE.CylinderGeometry(0.16, 0.16, 0.035, 14), 1, 1, 0.7),
  lungi: ell(new THREE.CylinderGeometry(0.19, 0.24, 0.78, 16), 1, 1, 0.78),
  knot: new THREE.BoxGeometry(0.1, 0.07, 0.03),
  kameez: ell(new THREE.CylinderGeometry(0.17, 0.28, 0.84, 16), 1, 1, 0.72),
  orna: ell(new THREE.TorusGeometry(0.16, 0.05, 6, 20, Math.PI).rotateZ(Math.PI), 1, 1.25, 0.28),
  ornaTail: new THREE.BoxGeometry(0.13, 0.55, 0.025),
  drape: new THREE.CylinderGeometry(0.1, 0.24, 0.24, 18, 1, true),
  braid: new THREE.BoxGeometry(0.15, 0.36, 0.05),
  // limbs, relative to the hip or shoulder joint
  thigh: new THREE.CylinderGeometry(0.07, 0.054, 0.82, 10),
  shoe: ell(new THREE.SphereGeometry(0.06, 10, 8), 0.85, 0.55, 1.8),
  sandal: new THREE.BoxGeometry(0.09, 0.02, 0.24), foot: ell(new THREE.SphereGeometry(0.045, 8, 6), 0.9, 0.5, 2),
  sleeve: new THREE.CylinderGeometry(0.058, 0.05, 0.27, 10),
  forearm: new THREE.CylinderGeometry(0.044, 0.035, 0.32, 10),
  hand: ell(new THREE.SphereGeometry(0.042, 10, 8), 0.6, 1.3, 0.95),
  stick: new THREE.CylinderGeometry(0.015, 0.015, 0.9, 4), umb: new THREE.ConeGeometry(0.6, 0.3, 14),
  basket: new THREE.CylinderGeometry(0.3, 0.2, 0.22, 14), bag: new THREE.BoxGeometry(0.24, 0.3, 0.1),
  backpack: new THREE.BoxGeometry(0.3, 0.38, 0.14),
};
function part(specs) {
  return mergeGeometries(specs.map(([geo, color, x, y, z, rx = 0, rz = 0]) => {
    const g = geo.clone();
    if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
    paint(g, color);
    g.translate(x, y, z);
    return g;
  }));
}
const HAIR = ['#15110e', '#15110e', '#1e1611', '#2a1d14'];
const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
// a face that reads at street distance: eyes with irises, brows, nose, lips, ears, hair
function headSpecs(skin, { hair = '#15110e', style = 'short', beard = false, cap = null, wrap = null, y = 0 } = {}) {
  const lip = mixHex(skin, '#5a1f1a', 0.45), shade = mixHex(skin, '#000000', 0.12);
  const H = [
    [PG.head, skin, 0, y, 0], [PG.jaw, skin, 0, y - 0.05, 0.015],
    [PG.ear, skin, -0.1, y - 0.005, -0.005], [PG.ear, skin, 0.1, y - 0.005, -0.005],
    [PG.nose, shade, 0, y - 0.012, 0.103],
    [PG.eye, '#efe8de', -0.038, y + 0.012, 0.092], [PG.eye, '#efe8de', 0.038, y + 0.012, 0.092],
    [PG.iris, '#24160d', -0.038, y + 0.011, 0.1], [PG.iris, '#24160d', 0.038, y + 0.011, 0.1],
    [PG.mouth, lip, 0, y - 0.05, 0.096],
  ];
  if (!wrap) H.push([PG.brow, hair, -0.04, y + 0.04, 0.096, 0, -0.08], [PG.brow, hair, 0.04, y + 0.04, 0.096, 0, 0.08]);
  if (wrap) H.push([PG.wrap, wrap, 0, y + 0.005, -0.004], [PG.brow, hair, -0.04, y + 0.036, 0.097, 0, -0.08], [PG.brow, hair, 0.04, y + 0.036, 0.097, 0, 0.08]);
  else if (style === 'long') H.push([PG.hairLong, hair, 0, y + 0.012, -0.008], [PG.bun, hair, 0, y - 0.01, -0.125]);
  else H.push([PG.hairShort, hair, 0, y + 0.012, -0.006]);
  if (beard) H.push([PG.beard, beard === 'white' ? '#e8e4dc' : hair, 0, y, 0.004], [PG.stache, beard === 'white' ? '#e8e4dc' : hair, 0, y - 0.033, 0.1]);
  if (cap) H.push([PG.cap, cap, 0, y + 0.1, -0.005]);
  return H;
}
function buildPerson(kind = pick(['m', 'm', 'f', 'f', 'lungi', 'lungi', 'school']), scale = 1) {
  const g = new THREE.Group();
  const skin = pick(SKIN), hair = pick(HAIR);
  let top = pick(['#efe9dc', '#9cc3e0', '#e0b0a0', '#3a5f8a', '#c94c4c', '#f2d06b', '#5d8a5a', '#ffffff', '#8a5aa8', '#e07a3a', '#d6c9a8']);
  if (kind === 'school') top = '#f4f4f0';
  const lungiCol = pick(['#2b5c8a', '#6a2a4a', '#2f4f2f', '#3b3b6b', '#7a5a2a']);
  const legCol = kind === 'f' ? pick(['#efe9dc', '#2b2f3a', '#c94c4c', '#e6c27a']) : kind === 'lungi' ? skin : kind === 'school' ? '#1f3a6b' : pick(['#2b2f3a', '#4a4038', '#1f2a44', '#6b6157']);
  const topDark = mixHex(top, '#000000', 0.12);
  const longSleeve = kind === 'f' || (kind === 'm' && rand() < 0.4);
  const HY = 1.665;
  const body = [[PG.neck, skin, 0, 1.55, 0], [PG.torso, top, 0, 1.25, 0], [PG.chest, top, 0, 1.51, 0]];
  for (const s of [-1, 1]) body.push([PG.shoulder, top, s * 0.19, 1.46, 0]);
  if (kind === 'f') {
    const wrap = rand() < 0.45 ? pick(['#1b1b1f', '#e8364f', '#1d6fb8', '#f6c445', '#7b3fb0', '#efe9dc', '#2f6f5a']) : null;
    const orna = pick(['#e8364f', '#f6c445', '#1f8a5b', '#ff7ab8', '#ffffff', '#7b3fb0']);
    body.push([PG.kameez, top, 0, 0.98, 0], [PG.orna, orna, 0, 1.49, 0.1, -0.5], [PG.ornaTail, orna, -0.14, 1.24, -0.12, 0.12], [PG.ornaTail, orna, 0.14, 1.24, -0.12, 0.12]);
    if (wrap) body.push([PG.drape, wrap, 0, 1.49, 0]);
    else if (rand() < 0.5) body.push([PG.braid, hair, 0, 1.47, -0.1, 0.12]);
    body.push(...headSpecs(skin, { hair, style: 'long', wrap, y: HY }));
  } else {
    const old = rand() < 0.18;
    const beard = kind !== 'school' && (old ? 'white' : rand() < 0.3);
    const cap = kind !== 'school' && (old || rand() < 0.18) ? pick(['#f2efe6', '#f2efe6', '#e9e4d6']) : null; // tupi
    body.push(...headSpecs(skin, { hair: old ? '#bdb8ae' : hair, beard, cap, y: HY }));
    body.push([PG.collar, topDark, 0, 1.515, 0.012], [PG.placket, topDark, 0, 1.27, 0.103]);
    if (kind === 'school') body.push([PG.tie, '#1f3a6b', 0, 1.36, 0.108], [PG.pocket, topDark, -0.08, 1.38, 0.104]);
    else if (rand() < 0.5) body.push([PG.pocket, topDark, -0.08, 1.37, 0.104]);
    if (kind === 'lungi') body.push([PG.lungi, lungiCol, 0, 0.7, 0], [PG.knot, mixHex(lungiCol, '#000000', 0.2), 0.03, 1.02, 0.15]);
    else body.push([PG.pelvis, legCol, 0, 0.96, 0], [PG.belt, '#2a1d14', 0, 1.04, 0]);
  }
  const extra = rand();
  if (extra < 0.12) body.push([PG.stick, '#222', 0.2, 1.9, 0.05], [PG.umb, '#1b1b1f', 0.2, 2.35, 0.05]);
  else if (extra < 0.2 && kind === 'lungi') body.push([PG.basket, '#9a7a45', 0, 1.9, 0]); // load on the head
  else if (extra < 0.32 && (kind === 'school' || kind === 'm')) body.push([PG.backpack, pick(['#1d4f91', '#b3261e', '#2f2f2f']), 0, 1.25, -0.17]);
  const bm = new THREE.Mesh(part(body), PERSON_MAT);
  bm.castShadow = true; g.add(bm);
  const hips = [], arms = [];
  const shoe = kind === 'school' ? '#111' : pick(['#2a2420', '#6b4a2a', '#222']);
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.85, 0); g.add(hip);
    const leg = [[PG.thigh, legCol, 0, -0.41, 0]];
    if (kind === 'lungi' || (kind === 'f' && rand() < 0.5)) leg.push([PG.foot, skin, 0, -0.825, 0.04], [PG.sandal, pick(['#6b4a2a', '#2a2420', '#c94c4c']), 0, -0.845, 0.04]);
    else leg.push([PG.shoe, shoe, 0, -0.82, 0.045]);
    const m = new THREE.Mesh(part(leg), PERSON_MAT);
    m.castShadow = true; hip.add(m); hips.push(hip);
  }
  const bag = kind !== 'school' && rand() < 0.2;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.215, 1.47, 0); g.add(sh);
    const specs = [[PG.sleeve, top, 0, -0.12, 0], [PG.forearm, longSleeve ? top : skin, 0, -0.4, 0], [PG.hand, skin, 0, -0.59, 0]];
    if (bag && s > 0) specs.push([PG.bag, pick(['#f2efe6', '#2f6f9f', '#d8323f']), 0, -0.74, 0]);
    sh.add(new THREE.Mesh(part(specs), PERSON_MAT)); arms.push(sh);
  }
  g.scale.setScalar(scale);
  return { g, hips, arms };
}
// only larger parts cast shadows; tiny ones just cost draw calls
function trimShadows(obj, min = 0.22) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const s = m.scale;
    if (m.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z) < min) m.castShadow = false;
  });
  return obj;
}
function seat(person, legLift = 1.45) {
  for (const h of person.hips) h.rotation.x = -legLift;
  for (const a of person.arms) a.rotation.x = -0.4;
  return person;
}

/* ---------------- vehicles ---------------- */
const wheelGeo = new Map();
function makeWheel(r, parent, x, y, z, spokes = 18) {
  const w = new THREE.Group(); w.position.set(x, y, z); parent.add(w);
  if (!wheelGeo.has(r)) {
    const pts = [];
    for (let k = 0; k < spokes; k++) { const a = (k / spokes) * Math.PI * 2; pts.push(k % 2 ? 0.045 : -0.045, 0, 0, 0, Math.sin(a) * (r - 0.06), Math.cos(a) * (r - 0.06)); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    wheelGeo.set(r, { tire: new THREE.TorusGeometry(r, 0.055, 8, 28), rim: new THREE.TorusGeometry(r - 0.06, 0.016, 6, 28), spokes: sg });
  }
  const G = wheelGeo.get(r);
  mesh(G.tire, M('#18181a', { roughness: 0.95 }), 0, 0, 0, w).rotation.y = Math.PI / 2;
  mesh(G.rim, M('#c9ccd1', { metalness: 0.9, roughness: 0.25 }), 0, 0, 0, w).rotation.y = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), M('#9a9da2', { metalness: 0.8, roughness: 0.3 }), 0, 0, 0, w).rotation.z = Math.PI / 2;
  w.add(new THREE.LineSegments(G.spokes, new THREE.LineBasicMaterial({ color: '#aeb2b8' })));
  return w;
}

const rickArt = canvasTex(512, 256, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1b2a6b'); sky.addColorStop(0.65, '#c2457a'); sky.addColorStop(1, '#f6a84a');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.fillStyle = '#fff'; g.fillRect(Math.random() * w, Math.random() * h * 0.5, 2, 2); }
  g.fillStyle = '#f6c445'; g.beginPath(); g.arc(380, 70, 34, 0, 7); g.fill();
  g.fillStyle = '#1b2a6b'; g.beginPath(); g.arc(394, 60, 30, 0, 7); g.fill();
  g.fillStyle = '#e8a05a'; g.beginPath(); g.arc(120, 80, 30, 0, 7); g.fill();
  g.strokeStyle = '#ffe2a8'; g.lineWidth = 6; g.beginPath(); g.ellipse(120, 80, 58, 14, -0.3, 0, 7); g.stroke();
  g.fillStyle = '#1f8a5b'; g.beginPath(); g.moveTo(0, h); g.quadraticCurveTo(140, 150, 260, 210); g.quadraticCurveTo(380, 150, w, 200); g.lineTo(w, h); g.fill();
  g.fillStyle = '#fff'; g.font = `800 64px ${BN_ART}`; g.textAlign = 'center'; g.fillText('ঢাকা', w / 2, 236);
  g.strokeStyle = '#f6c445'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  for (let x = 14; x < w; x += 28) { g.fillStyle = ['#e8364f', '#fff', '#1f8a5b'][(x / 28 | 0) % 3]; g.beginPath(); g.arc(x, 8, 5, 0, 7); g.fill(); }
  grain(g, w, h, 3000, 0.15, true); grime(g, w, h, 5);
});
const hoodTex = canvasTex(512, 256, (g) => {
  g.fillStyle = '#16161f'; g.fillRect(0, 0, 512, 256);
  const cols = ['#e8364f', '#f6c445', '#1f8a5b', '#1d6fb8', '#ffffff'];
  for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % 5]; g.fillRect(0, i * 28 + 6, 512, 4); }
  for (let i = 0; i < 26; i++) { // applique flowers
    const x = (i * 83) % 512, y = 20 + ((i * 53) % 220), c = cols[i % 5];
    for (let p = 0; p < 6; p++) { g.fillStyle = c; g.beginPath(); g.ellipse(x + Math.cos(p) * 7, y + Math.sin(p) * 7, 6, 3, p, 0, 7); g.fill(); }
    g.fillStyle = '#f6c445'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
  }
  grain(g, 512, 256, 4000, 0.12, true);
});
hoodTex.wrapS = THREE.RepeatWrapping;
const plateTex = canvasTex(256, 96, (g) => {
  g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#222'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 90);
  g.fillStyle = '#222'; g.textAlign = 'center'; g.font = `700 34px ${BN}`; g.fillText('ঢাকা সিটি', 128, 40); g.font = `700 36px ${BN}`; g.fillText('১৩৭৫', 128, 82);
  grain(g, 256, 96, 600, 0.2);
});
const gamchaTex = canvasTex(32, 32, (g) => { g.fillStyle = '#c8202f'; g.fillRect(0, 0, 32, 32); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(0, 6, 32, 4); g.fillRect(0, 22, 32, 4); g.fillRect(6, 0, 4, 32); g.fillRect(22, 0, 4, 32); });

const fringeTex = canvasTex(512, 64, (g) => {
  g.fillStyle = '#c8202f'; g.fillRect(0, 0, 512, 64);
  for (let x = 0; x < 512; x += 16) { g.fillStyle = ['#f6c445', '#1f8a5b', '#ffffff', '#1d6fb8'][(x / 16) % 4]; g.beginPath(); g.arc(x + 8, 40, 8, 0, Math.PI); g.fill(); }
  for (let x = 4; x < 512; x += 24) { g.fillStyle = '#e8eef5'; g.beginPath(); g.arc(x, 16, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x - 1, 14, 2, 2); }
});
fringeTex.wrapS = THREE.RepeatWrapping; fringeTex.repeat.set(3, 1);
const wingTex = canvasTex(256, 160, (g) => {
  g.fillStyle = '#1d6fb8'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#f6c445'; g.fillRect(6, 6, 244, 148);
  g.fillStyle = '#e8364f'; g.fillRect(14, 14, 228, 132);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(128, 30); g.lineTo(170, 110); g.lineTo(86, 110); g.fill();
  g.fillStyle = '#1f8a5b'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 35, 130, 9, 0, 7); g.fill(); }
  g.fillStyle = '#f6c445'; g.beginPath(); g.arc(128, 80, 16, 0, 7); g.fill();
  grain(g, 256, 160, 1500, 0.15, true);
});
const vinylTex = canvasTex(128, 128, (g) => {
  g.fillStyle = '#b81d2c'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 18; i++) {
    const x = (i * 37) % 128, y = (i * 53) % 128;
    for (let k = 0; k < 5; k++) { g.fillStyle = '#f2b6c0'; g.beginPath(); g.ellipse(x + Math.cos(k * 1.26) * 6, y + Math.sin(k * 1.26) * 6, 5, 3, k * 1.26, 0, 7); g.fill(); }
    g.fillStyle = '#f6c445'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; for (let x = 0; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
});
vinylTex.wrapS = vinylTex.wrapT = THREE.RepeatWrapping;
function buildRickshaw(seatColor = '#d8323f', panelColor = '#1d6fb8', shirt = '#efe9dc') {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const metal = M('#2d2d30', { metalness: 0.6, roughness: 0.4 });
  const chrome = M('#d4d7dc', { metalness: 0.95, roughness: 0.2 });
  const paint = M(panelColor, { roughness: 0.45 });
  const wheels = [];
  // front fork, handlebar and its decorations
  const front = new THREE.Group(); front.position.set(0, 0, 1.25); body.add(front);
  wheels.push(makeWheel(0.42, front, 0, 0.42, 0));
  mesh(new THREE.TorusGeometry(0.5, 0.025, 4, 16, Math.PI * 0.8), paint, 0, 0.42, 0, front).rotation.set(0, Math.PI / 2, 0.3);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.03, 0.8, 0.03), chrome, s * 0.06, 0.82, -0.04, front).rotation.x = 0.2;
  mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), metal, 0, 1.18, -0.12, front);
  mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8), chrome, 0, 1.24, -0.14, front).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), M('#1a1a1a'), s * 0.36, 1.24, -0.14, front).rotation.z = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), chrome, -0.24, 1.29, -0.14, front);
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), chrome, 0.3, 1.38, -0.14, front);
  mesh(new THREE.CircleGeometry(0.06, 14), chrome, 0.3, 1.54, -0.12, front);
  for (let i = 0; i < 5; i++) mesh(new THREE.IcosahedronGeometry(0.05, 0), M(['#e8364f', '#f6c445', '#ff7ab8', '#ffffff', '#f07a2a'][i]), -0.15 + i * 0.075, 1.31, -0.12, front);
  // frame, rear axle, mudguards, crank and chain
  for (const s of [-1, 1]) wheels.push(makeWheel(0.42, body, s * 0.74, 0.42, -0.55));
  for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(0.5, 0.03, 4, 16, Math.PI), paint, s * 0.74, 0.42, -0.55, body).rotation.y = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.07, 0.07, 1.9), metal, 0, 0.68, 0.3, body).rotation.x = -0.12;
  mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), metal, 0, 0.98, 0.85, body).rotation.x = 0.45;
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.55, 8), metal, 0, 0.42, -0.55, body).rotation.z = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), metal, 0, 0.88, 0.58, body).rotation.x = -0.15;
  mesh(new THREE.BoxGeometry(0.26, 0.09, 0.34), M('#1e1a18', { roughness: 0.6 }), 0, 1.2, 0.55, body);
  const crank = new THREE.Group(); crank.position.set(0, 0.55, 0.62); body.add(crank);
  mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 18), chrome, 0.1, 0, 0, crank).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(0.025, 0.16, 0.03), chrome, s * 0.13, s * 0.08, 0, crank);
    mesh(new THREE.BoxGeometry(0.1, 0.03, 0.06), M('#222'), s * 0.17, s * 0.16, 0, crank);
    arm.castShadow = false;
  }
  for (const dy of [0.1, -0.1]) {
    const ch = mesh(new THREE.BoxGeometry(0.015, 0.015, 1.18), M('#3a3632', { metalness: 0.7 }), 0.1, 0.485 + dy * 0.6, 0.035, body);
    ch.rotation.x = -Math.atan2(0.13, 1.17) + dy * 0.12;
  }
  // passenger platform, seat, side panels
  mesh(new THREE.BoxGeometry(1.35, 0.1, 1.0), paint, 0, 0.75, -0.5, body);
  mesh(new THREE.BoxGeometry(1.1, 0.04, 0.5), M('#5a4a3a'), 0, 0.58, 0.12, body);
  mesh(new THREE.BoxGeometry(1.35, 0.25, 0.65), M(seatColor, { roughness: 0.4 }), 0, 1.0, -0.55, body);
  mesh(new THREE.BoxGeometry(1.35, 0.55, 0.12), M(seatColor, { roughness: 0.4 }), 0, 1.35, -0.88, body);
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.04, 0.35, 1.0), paint, s * 0.68, 0.9, -0.5, body);
    mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), chrome, s * 0.7, 1.08, -0.5, body);
  }
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), new THREE.MeshStandardMaterial({ map: rickArt, roughness: 0.4 }));
  art.position.set(0, 0.86, -1.02); art.rotation.y = Math.PI; body.add(art);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshStandardMaterial({ map: plateTex }));
  plate.position.set(0, 0.48, -0.62); plate.rotation.y = Math.PI; body.add(plate);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), M('#ff2a2a', { emissive: '#7a0000', roughness: 0.2 }), s * 0.55, 0.64, -1.03, body);
  // folding hood with ribs and hanging tassels
  const hood = mesh(new THREE.SphereGeometry(1, 24, 12, Math.PI, Math.PI, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: hoodTex, side: THREE.DoubleSide, roughness: 0.55 }), 0, 1.12, -0.5, body);
  hood.scale.set(0.78, 1.15, 0.72);
  for (const [dz, f] of [[0, 1], [-0.3, 0.91], [-0.52, 0.69]]) {
    const rib = mesh(new THREE.TorusGeometry(1, 0.02, 4, 24, Math.PI), chrome, 0, 1.12, -0.5 + dz, body);
    rib.scale.set(0.79 * f, 1.16 * f, 1);
  }
  const tassels = [];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.08 + i * 0.105);
    const piv = new THREE.Group(); piv.position.set(Math.cos(a) * 0.79, 1.12 + Math.sin(a) * 1.16, -0.48); body.add(piv);
    const str = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 3), M('#222'), 0, -0.07, 0, piv); str.castShadow = false;
    mesh(new THREE.ConeGeometry(0.035, 0.12, 6), M(['#e8364f', '#f6c445', '#1f8a5b', '#1d6fb8', '#ff7ab8'][i % 5]), 0, -0.19, 0, piv).rotation.x = Math.PI;
    tassels.push(piv);
  }
  // hood valance with mirror-work fringe, painted side wings, floral vinyl seat, rubber mat, leaf springs
  const val = mesh(new THREE.RingGeometry(0.88, 1.0, 28, 1, 0, Math.PI), new THREE.MeshStandardMaterial({ map: fringeTex, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.2 }), 0, 1.12, -0.47, body);
  val.scale.set(0.8, 1.17, 1);
  for (const s of [-1, 1]) {
    const wing = mesh(new THREE.PlaneGeometry(0.62, 0.42), new THREE.MeshStandardMaterial({ map: wingTex, side: THREE.DoubleSide, roughness: 0.4 }), s * 0.71, 1.32, -0.62, body);
    wing.rotation.y = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.02, 0.46, 0.66), chrome, s * 0.705, 1.32, -0.62, body);
  }
  mesh(new THREE.BoxGeometry(1.24, 0.05, 0.56), new THREE.MeshStandardMaterial({ map: vinylTex, roughness: 0.35 }), 0, 1.135, -0.55, body);
  const back = mesh(new THREE.BoxGeometry(1.24, 0.42, 0.03), new THREE.MeshStandardMaterial({ map: vinylTex, roughness: 0.35 }), 0, 1.38, -0.81, body);
  back.rotation.x = -0.1;
  mesh(new THREE.BoxGeometry(1.08, 0.015, 0.48), M('#1e1e1e', { roughness: 1 }), 0, 0.605, 0.12, body);
  mesh(new THREE.BoxGeometry(1.4, 0.68, 0.02), chrome, 0, 0.86, -0.995, body);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(0.06, 0.025, 0.5 - k * 0.12), M('#2d2d30', { metalness: 0.6 }), s * 0.45, 0.5 + k * 0.03, -0.55, body);
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.5, 4), chrome, 0.06, 0.75, 0.3, body).rotation.x = Math.PI / 2 - 0.12;
  // the rickshaw puller: lungi, vest, gamcha, legs that follow the pedals
  const rider = new THREE.Group(); rider.position.set(0, 1.25, 0.55); body.add(rider);
  const skinHex = pick(SKIN), skin = M(skinHex);
  // torso, shoulders and a face, merged into one vertex-coloured mesh
  const upper = mesh(part([
    [PG.torso, shirt, 0, 0, 0], [PG.chest, shirt, 0, 0.26, 0], [PG.shoulder, shirt, -0.18, 0.215, 0], [PG.shoulder, shirt, 0.18, 0.215, 0],
    [PG.collar, mixHex(shirt, '#000000', 0.12), 0, 0.265, 0.012], [PG.neck, skinHex, 0, 0.3, 0],
  ]), PERSON_MAT, 0, 0.36, 0.06, rider);
  upper.rotation.x = 0.3; upper.scale.set(1.05, 1.05, 1.1);
  const gam = mesh(new THREE.BoxGeometry(0.46, 0.07, 0.3), new THREE.MeshStandardMaterial({ map: gamchaTex }), 0, 0.62, 0.12, rider); gam.rotation.x = 0.3;
  const head = mesh(part(headSpecs(skinHex, { beard: rand() < 0.5, hair: pick(HAIR) })), PERSON_MAT, 0, 0.82, 0.2, rider);
  head.scale.setScalar(1.22); head.rotation.x = -0.15;
  mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 16), new THREE.MeshStandardMaterial({ map: gamchaTex }), 0, 0.9, 0.2, rider).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.26, 12), new THREE.MeshStandardMaterial({ map: pick(LUNGI_TEX) }), 0, 0.04, 0, rider);
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.22, 0.56, 0.14); rider.add(sh);
    const tgt = new THREE.Vector3(s * 0.36, -0.01, 0.56).sub(sh.position);
    const len = tgt.length();
    sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tgt.normalize());
    mesh(new THREE.CylinderGeometry(0.05, 0.04, len, 10).rotateX(Math.PI / 2), skin, 0, 0, len / 2, sh);
    mesh(PG.hand, skin, 0, 0, len + 0.02, sh).rotation.x = Math.PI / 2;
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, -0.02, 0); rider.add(hip);
    mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.44, 10), new THREE.MeshStandardMaterial({ map: pick(LUNGI_TEX) }), 0, -0.22, 0, hip);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    mesh(new THREE.CylinderGeometry(0.052, 0.038, 0.44, 10), skin, 0, -0.22, 0, knee);
    mesh(PG.foot, skin, 0, -0.44, 0.04, knee);
    mesh(PG.sandal, M('#3b2a1e'), 0, -0.465, 0.04, knee);
    legs.push({ hip, knee, side: s });
  }
  bake(body); bake(front);
  return { g, body, wheels, front, legs, crank, tassels, swing: 0, swingV: 0 };
}
// two-bone IK in the side plane so the feet stay on the pedals
function pedal(rk, ph) {
  const a = 0.44;
  for (const L of rk.legs) {
    const p = ph + (L.side > 0 ? Math.PI : 0);
    const dy = -0.70 + 0.16 * Math.sin(p) + 0.02, dz = 0.07 + 0.16 * Math.cos(p);
    const d = Math.min(Math.hypot(dy, dz), 2 * a - 0.01);
    const phi = Math.atan2(dz, -dy), alpha = Math.acos(d / (2 * a));
    L.hip.rotation.x = -(phi + alpha);
    L.knee.rotation.x = Math.PI - Math.acos((2 * a * a - d * d) / (2 * a * a));
  }
  rk.crank.rotation.x = -ph;
}

const headMat = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 0.9, roughness: 0.1 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#ff3030', emissive: '#a00000', emissiveIntensity: 0.8, roughness: 0.2 });
const glassMat = new THREE.MeshStandardMaterial({ color: '#1f2933', metalness: 0.7, roughness: 0.08 });
const rubber = M('#151517', { roughness: 0.95 });
const chromeMat = M('#d4d7dc', { metalness: 0.95, roughness: 0.18 });
const RB = (w, h, d, r = 0.12, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);

// merge the static meshes of a vehicle by material, so each vehicle costs a handful of draw calls
function bake(parent) {
  const byMat = new Map();
  for (const c of [...parent.children]) {
    if (!c.isMesh || Array.isArray(c.material) || c.userData.keep) continue;
    c.updateMatrix();
    let g = c.geometry.clone();
    g.applyMatrix4(c.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(g);
    parent.remove(c);
  }
  for (const [mat, geos] of byMat) {
    const mixed = geos.some((g) => !g.index);
    const m = new THREE.Mesh(mergeGeometries(mixed ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos), mat);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
  }
  return parent;
}
// solid tyres with a hub cap for motor vehicles
function makeTyre(r, width, parent, x, y, z) {
  const w = new THREE.Group(); w.position.set(x, y, z); parent.add(w);
  mesh(new THREE.CylinderGeometry(r, r, width, 20), rubber, 0, 0, 0, w).rotation.z = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, width + 0.02, 14), M('#9ea3a8', { metalness: 0.8, roughness: 0.35 }), 0, 0, 0, w).rotation.z = Math.PI / 2;
  for (let k = 0; k < 5; k++) { const b = mesh(new THREE.BoxGeometry(width + 0.04, r * 0.08, r * 0.08), M('#5c6066', { metalness: 0.7 }), 0, Math.cos(k * 1.257) * r * 0.35, Math.sin(k * 1.257) * r * 0.35, w); b.castShadow = false; }
  return w;
}
function plateTexLatin(top, num, bg = '#f4f1e8') {
  return canvasTex(256, 96, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#222'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 90);
    g.fillStyle = '#222'; g.textAlign = 'center'; g.font = `700 30px ${BN}`; g.fillText(top, 128, 38); g.font = `700 36px ${BN}`; g.fillText(num, 128, 82);
    grain(g, 256, 96, 600, 0.2);
  });
}
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bnNum = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[d]);
function plate(parent, x, y, z, ry, top) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshStandardMaterial({ map: plateTexLatin(top, `${bnNum(Math.floor(R(11, 99)))}-${bnNum(Math.floor(R(1000, 9999)))}`) }));
  p.position.set(x, y, z); p.rotation.y = ry; p.userData.keep = true; parent.add(p);
}
function mirrors(parent, x, y, z, stalk = 0.2) {
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(stalk, 0.03, 0.03), M('#222'), s * (x + stalk / 2), y, z, parent);
    mesh(new THREE.BoxGeometry(0.06, 0.16, 0.12), M('#222'), s * (x + stalk), y, z, parent);
  }
}

/* CNG auto-rickshaw: rounded green shell, steel cage doors, spare wheel on the back */
function buildCNG() {
  const g = new THREE.Group();
  const green = M('#2f8f40', { roughness: 0.35, metalness: 0.25 });
  mesh(RB(1.38, 0.55, 2.5, 0.18), green, 0, 0.62, -0.05, g);
  const nose = mesh(new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), green, 0, 0.55, 1.05, g);
  nose.scale.set(1.05, 1.15, 0.75);
  mesh(RB(1.4, 0.12, 2.3, 0.05), green, 0, 1.95, -0.2, g);
  mesh(RB(1.3, 1.05, 0.08, 0.04), green, 0, 1.42, -1.25, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 1.25, 0.06), green, s * 0.66, 1.35, 0.55, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 1.25, 0.06), green, s * 0.66, 1.35, -1.2, g);
  const ws = mesh(new THREE.BoxGeometry(1.24, 0.72, 0.03), glassMat, 0, 1.45, 0.6, g); ws.rotation.x = -0.15;
  mesh(new THREE.BoxGeometry(0.02, 0.5, 0.02), M('#111'), 0.2, 1.4, 0.64, g).rotation.z = 0.5;
  const cage = canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128); c.fillStyle = '#2a7a38';
    for (let i = 0; i < 128; i += 13) c.fillRect(i, 0, 3, 128);
    for (let i = 0; i < 128; i += 26) c.fillRect(0, i, 128, 3);
    c.fillRect(0, 0, 128, 8); c.fillRect(0, 120, 128, 8);
  });
  const cageMat = new THREE.MeshStandardMaterial({ map: cage, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.1), cageMat);
    side.position.set(s * 0.69, 1.4, -0.32); side.rotation.y = Math.PI / 2; g.add(side);
  }
  mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), M('#1d1d1d'), 0, 1.05, -0.75, g); // rear bench
  mesh(new THREE.BoxGeometry(1.36, 0.06, 2.4), M('#f6c445'), 0, 0.92, -0.05, g); // yellow stripe
  for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(0.36, 0.07, 6, 14, Math.PI), green, s * 0.62, 0.32, -0.7, g).rotation.y = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.11, 12, 10), headMat, 0, 0.92, 1.48, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.12, 0.1, 0.03), tailMat, s * 0.55, 0.75, -1.31, g);
  mirrors(g, 0.6, 1.25, 0.75, 0.15);
  const spare = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16), rubber, 0, 1.25, -1.36, g); spare.rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 12), M('#9ea3a8', { metalness: 0.7 }), 0, 1.25, -1.36, g).rotation.x = Math.PI / 2;
  plate(g, 0, 0.62, -1.31, Math.PI, 'ঢাকা মেট্রো থ');
  bake(g);
  const driver = seat(buildPerson('m'), 1.4); driver.g.position.set(0, 0.25, 0.2); driver.g.scale.setScalar(0.9); g.add(driver.g);
  if (rand() < 0.7) { const p = seat(buildPerson()); p.g.position.set(R(-0.3, 0.3), 0.22, -0.75); p.g.scale.setScalar(0.9); g.add(p.g); }
  const wheels = [makeTyre(0.3, 0.16, g, 0, 0.3, 0.95), makeTyre(0.3, 0.16, g, -0.62, 0.3, -0.7), makeTyre(0.3, 0.16, g, 0.62, 0.3, -0.7)];
  return { g, wheels, L: 2.8, W: 1.5 };
}

/* local bus: rounded body, dents and rust, door on the left with a man hanging out */
function busSide(base, door) {
  return canvasTex(1024, 320, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 1024, 320);
    c.fillStyle = '#efe0bc'; c.fillRect(0, 196, 1024, 40);
    c.fillStyle = '#e8c53a'; c.fillRect(0, 246, 1024, 10);
    for (let x = 30; x < 1000; x += 106) {
      if (door && x < 140) continue;
      c.fillStyle = '#1e2630'; c.fillRect(x, 30, 88, 118);
      c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x + 6, 36, 22, 106);
      c.fillStyle = '#c9ccd1'; c.fillRect(x, 86, 88, 4);
      if (Math.random() < 0.75) { // passengers in the window
        c.fillStyle = '#2b1d14'; c.beginPath(); c.arc(x + 30 + Math.random() * 30, 108, 15, 0, 7); c.fill();
        c.fillStyle = pick(['#c94c4c', '#efe9dc', '#3a5f8a', '#5d8a5a']); c.fillRect(x + 18 + Math.random() * 30, 124, 40, 24);
      }
    }
    if (door) { c.fillStyle = '#111'; c.fillRect(24, 24, 104, 286); c.fillStyle = '#666'; c.fillRect(70, 30, 6, 270); }
    c.fillStyle = '#7a1c1c'; c.font = `800 44px ${BN_ART}`; c.textAlign = 'center'; c.fillText('মিরপুর - গুলিস্তান', 560, 230);
    grain(c, 1024, 320, 14000, 0.2, true);
    for (let i = 0; i < 50; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '120,60,25' : '20,20,20'},${0.2 + Math.random() * 0.25})`; c.fillRect(Math.random() * 1000, 150 + Math.random() * 160, 8 + Math.random() * 60, 3 + Math.random() * 8); }
    grime(c, 1024, 320, 30);
    const rust = c.createLinearGradient(0, 260, 0, 320); rust.addColorStop(0, 'rgba(110,60,30,0)'); rust.addColorStop(1, 'rgba(110,60,30,.55)');
    c.fillStyle = rust; c.fillRect(0, 260, 1024, 60);
  });
}
function buildBus() {
  const g = new THREE.Group();
  const base = pick(['#b8322f', '#1f5fa8', '#2f8a4a', '#c8781c', '#7a2f7a', '#d9d4c7']);
  const left = new THREE.MeshStandardMaterial({ map: busSide(base, true), roughness: 0.55, metalness: 0.15 });
  const right = new THREE.MeshStandardMaterial({ map: busSide(base, false), roughness: 0.55, metalness: 0.15 });
  const front = canvasTex(256, 256, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#111'; c.fillRect(10, 8, 236, 34);
    c.fillStyle = '#ff9a2a'; c.font = `700 24px ${BN}`; c.textAlign = 'center'; c.fillText('গুলিস্তান', 128, 34);
    c.fillStyle = '#1e2630'; c.fillRect(12, 50, 114, 110); c.fillRect(130, 50, 114, 110);
    c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(20, 56, 30, 98); c.fillRect(138, 56, 30, 98);
    c.fillStyle = '#2b1d14'; c.beginPath(); c.arc(190, 120, 16, 0, 7); c.fill();
    c.fillStyle = '#222'; c.fillRect(70, 190, 116, 34);
    c.fillStyle = '#ccc'; for (let x = 74; x < 182; x += 9) c.fillRect(x, 194, 4, 26);
    grain(c, 256, 256, 3000, 0.2, true); grime(c, 256, 256, 8);
  });
  const back = canvasTex(256, 256, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#1e2630'; c.fillRect(30, 30, 196, 90);
    c.fillStyle = '#fff'; c.font = `800 22px ${BN_ART}`; c.textAlign = 'center'; c.fillText('আল্লাহ ভরসা', 128, 160);
    grain(c, 256, 256, 3000, 0.2, true); grime(c, 256, 256, 10);
  });
  const roof = M('#cfcac0', { roughness: 0.7 });
  const geo = new RoundedBoxGeometry(2.5, 2.7, 9, 3, 0.18);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (Math.abs(Math.abs(p.getX(i)) - 1.25) < 0.01 && Math.abs(p.getZ(i)) < 4.2 && Math.abs(p.getY(i)) < 1.1) p.setX(i, p.getX(i) - Math.sign(p.getX(i)) * Math.random() * 0.06);
  geo.computeVertexNormals();
  const body = mesh(geo, [left, right, roof, roof, new THREE.MeshStandardMaterial({ map: front, roughness: 0.4, metalness: 0.2 }), new THREE.MeshStandardMaterial({ map: back, roughness: 0.6 })], 0, 1.8, 0, g);
  body.rotation.z = R(-0.025, 0.025);
  // bumpers, wheel arches, lights, bug-eye mirrors, roof rack and ladder
  for (const z of [4.55, -4.55]) mesh(RB(2.55, 0.3, 0.2, 0.06), M('#2a2a2c', { metalness: 0.4 }), 0, 0.55, z, g);
  for (const z of [-3, 3]) for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 16, 1, false, 0, Math.PI), M('#1a1a1a'), s * 1.24, 0.5, z, g).rotation.set(0, 0, Math.PI / 2 * s);
  for (const s of [-1, 1]) { mesh(new THREE.SphereGeometry(0.13, 10, 8), headMat, s * 0.95, 0.95, 4.52, g); mesh(new THREE.SphereGeometry(0.09, 10, 8), M('#ffb020', { emissive: '#a05000' }), s * 1.12, 0.95, 4.5, g); }
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.22, 0.32, 0.05), tailMat, s * 1.0, 1.0, -4.52, g);
  for (const s of [-1, 1]) {
    const st = mesh(new THREE.BoxGeometry(0.04, 0.04, 0.7), M('#222'), s * 1.2, 2.9, 4.7, g); st.rotation.x = 0.4;
    mesh(new THREE.BoxGeometry(0.06, 0.4, 0.22), M('#222'), s * 1.25, 2.6, 4.95, g);
  }
  mesh(new THREE.BoxGeometry(2.2, 0.08, 6), M('#3a3a3a', { metalness: 0.5 }), 0, 3.25, -0.5, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 0.25, 6), M('#3a3a3a', { metalness: 0.5 }), s * 1.08, 3.35, -0.5, g);
  for (let i = 0; i < 4; i++) mesh(RB(R(0.5, 0.9), R(0.3, 0.6), R(0.5, 1), 0.08), M(pick(['#6b4423', '#2f5f8f', '#8a8a8a', '#c9a24a'])), R(-0.6, 0.6), 3.5, R(-3, 1.5), g);
  for (let i = 0; i < 6; i++) mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), M('#555', { metalness: 0.6 }), -0.6, 0.9 + i * 0.4, -4.56, g);
  plate(g, 0, 0.7, -4.66, Math.PI, 'ঢাকা মেট্রো ব');
  plate(g, 0, 0.75, 4.66, 0, 'ঢাকা মেট্রো ব');
  bake(g);
  // passengers who could not get a seat
  if (rand() < 0.85) { const h = buildPerson('m'); h.g.position.set(1.35, 0.35, 3.1); h.arms[0].rotation.z = -2.5; h.g.rotation.z = 0.15; g.add(h.g); }
  if (rand() < 0.4) { const h = buildPerson('lungi'); h.g.position.set(1.4, 0.35, 2.5); h.arms[0].rotation.z = -2.4; h.g.rotation.z = 0.2; g.add(h.g); }
  if (rand() < 0.5) { const h = seat(buildPerson('lungi')); h.g.position.set(0.3, 2.85, -2); g.add(h.g); }
  const wheels = [];
  for (const z of [-3, 3]) for (const s of [-1, 1]) wheels.push(makeTyre(0.5, 0.32, g, s * 1.08, 0.5, z));
  return { g, wheels, L: 9.2, W: 2.6 };
}

/* cars: a rounded saloon, a yellow-and-black taxi, or a microbus */
function buildCar() {
  const g = new THREE.Group();
  const type = pick(['sedan', 'sedan', 'taxi', 'micro']);
  const c = type === 'taxi' ? '#f2c230' : pick(['#f2f2f0', '#c9ccd0', '#2b2b2e', '#8a1f22', '#e8e4d8', '#3d4f66']);
  const paintM = M(c, { metalness: 0.45, roughness: 0.25 });
  let L = 4.3;
  if (type === 'micro') {
    L = 4.6;
    mesh(RB(1.8, 1.55, 4.6, 0.3), paintM, 0, 1.18, 0, g);
    mesh(RB(1.82, 0.55, 4.0, 0.15), glassMat, 0, 1.55, -0.2, g);
    const ws = mesh(RB(1.65, 0.7, 0.1, 0.05), glassMat, 0, 1.5, 2.28, g); ws.rotation.x = -0.35;
    mesh(new THREE.BoxGeometry(1.82, 0.08, 4.4), M('#2a2a2c'), 0, 0.72, 0, g);
  } else {
    mesh(RB(1.78, 0.6, L, 0.22), paintM, 0, 0.66, 0, g);
    const cab = mesh(RB(1.6, 0.62, 2.2, 0.28), paintM, 0, 1.18, -0.25, g);
    cab.scale.set(1, 1, 1);
    mesh(RB(1.62, 0.44, 2.0, 0.2), glassMat, 0, 1.2, -0.25, g);
    const ws = mesh(new THREE.BoxGeometry(1.45, 0.06, 0.75), glassMat, 0, 1.15, 0.95, g); ws.rotation.x = 0.55;
    const rw = mesh(new THREE.BoxGeometry(1.45, 0.06, 0.6), glassMat, 0, 1.17, -1.42, g); rw.rotation.x = -0.6;
    if (type === 'taxi') {
      mesh(new THREE.BoxGeometry(1.8, 0.2, L - 0.4), M('#151515'), 0, 0.55, 0, g);
      mesh(RB(0.5, 0.18, 0.25, 0.05), M('#fffbe8', { emissive: '#ffd060', emissiveIntensity: 0.4 }), 0, 1.58, -0.2, g);
    }
  }
  for (const s of [-1, 1]) {
    mesh(RB(0.36, 0.14, 0.06, 0.03), headMat, s * 0.6, 0.78, L / 2 + 0.01, g);
    mesh(RB(0.3, 0.14, 0.06, 0.03), tailMat, s * 0.62, 0.82, -L / 2 - 0.01, g);
  }
  mesh(RB(0.7, 0.18, 0.06, 0.03), M('#222'), 0, 0.62, L / 2 + 0.01, g);
  for (const z of [L / 2 + 0.05, -L / 2 - 0.05]) mesh(RB(1.8, 0.16, 0.12, 0.05), M('#3a3a3c', { roughness: 0.6 }), 0, 0.42, z, g);
  mirrors(g, 0.85, 1.05, 0.7, 0.1);
  plate(g, 0, 0.5, -L / 2 - 0.12, Math.PI, type === 'taxi' ? 'ঢাকা মেট্রো চ' : 'ঢাকা মেট্রো গ');
  bake(g);
  const d = seat(buildPerson('m'), 1.45); d.g.position.set(0.4, 0.15, 0.1); d.g.scale.setScalar(0.85); g.add(d.g);
  const wheels = [];
  const wz = L / 2 - 0.85;
  for (const z of [-wz, wz]) for (const s of [-1, 1]) wheels.push(makeTyre(0.34, 0.24, g, s * 0.8, 0.34, z));
  return { g, wheels, L: L + 0.2, W: 1.9 };
}

/* painted Bangladeshi truck with its wooden crown and flower art */
function buildTruck() {
  const g = new THREE.Group();
  const cabCol = pick(['#c9302c', '#1f6fb8', '#e0a020', '#2f8a4a']);
  const art = canvasTex(512, 160, (c) => {
    c.fillStyle = '#e8c070'; c.fillRect(0, 0, 512, 160);
    for (let i = 0; i < 8; i++) { c.fillStyle = ['#e8364f', '#1f8a5b', '#1d6fb8', '#f07a2a'][i % 4]; c.fillRect(0, i * 20, 512, 3); }
    for (let i = 0; i < 14; i++) {
      const x = 20 + i * 36, y = 80 + Math.sin(i) * 30, col = pick(['#e8364f', '#f6c445', '#ffffff', '#1d6fb8', '#ff7ab8']);
      for (let k = 0; k < 6; k++) { c.fillStyle = col; c.beginPath(); c.ellipse(x + Math.cos(k) * 9, y + Math.sin(k) * 9, 8, 4, k, 0, 7); c.fill(); }
      c.fillStyle = '#1f8a5b'; c.fillRect(x - 2, y + 10, 4, 24);
    }
    c.fillStyle = '#7a1c1c'; c.font = `800 30px ${BN_ART}`; c.textAlign = 'center'; c.fillText('মায়ের দোয়া', 256, 150);
    grain(c, 512, 160, 5000, 0.2, true); grime(c, 512, 160, 12);
  });
  const artM = new THREE.MeshStandardMaterial({ map: art, roughness: 0.6 });
  const cabM = M(cabCol, { metalness: 0.3, roughness: 0.4 });
  mesh(RB(2.3, 1.8, 1.9, 0.18), cabM, 0, 1.55, 2.6, g);
  mesh(RB(2.32, 0.7, 1.4, 0.1), glassMat, 0, 1.95, 2.95, g);
  const crown = mesh(new THREE.BoxGeometry(2.4, 0.7, 0.3), artM, 0, 2.75, 3.2, g); crown.rotation.x = -0.25;
  mesh(new THREE.BoxGeometry(2.4, 0.25, 6.8), M('#3a2a20'), 0, 0.85, -0.6, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.08, 1.4, 4.6), artM, s * 1.2, 1.7, -1.3, g);
  mesh(new THREE.BoxGeometry(2.4, 1.4, 0.08), artM, 0, 1.7, -3.6, g);
  mesh(new THREE.BoxGeometry(2.4, 1.4, 0.08), artM, 0, 1.7, 1.0, g);
  mesh(RB(2.2, 0.9, 4.2, 0.4), M(pick(['#2f6f9f', '#a8452f', '#6b6b3a'])), 0, 2.6, -1.3, g); // tarp over the load
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.15, 10, 8), headMat, s * 0.85, 1.0, 3.56, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.2, 0.15, 0.05), tailMat, s * 1.0, 0.8, -3.66, g);
  mirrors(g, 1.15, 2.0, 3.2, 0.25);
  mesh(RB(2.4, 0.25, 0.15, 0.05), M('#222'), 0, 0.6, 3.6, g);
  plate(g, 0, 0.75, -3.68, Math.PI, 'ঢাকা মেট্রো ট');
  bake(g);
  const wheels = [];
  for (const z of [2.4, -1.5, -2.6]) for (const s of [-1, 1]) wheels.push(makeTyre(0.5, 0.3, g, s * 1.05, 0.5, z));
  return { g, wheels, L: 7.4, W: 2.5 };
}

/* motorbike with a rider and often a pillion */
function buildBike() {
  const g = new THREE.Group();
  const col = pick(['#c9302c', '#1d1d1f', '#1f5fa8', '#e0e0e0']);
  mesh(RB(0.3, 0.3, 0.7, 0.1), M(col, { metalness: 0.5, roughness: 0.3 }), 0, 0.85, 0.2, g);
  mesh(RB(0.28, 0.12, 0.8, 0.05), M('#1a1a1a'), 0, 0.9, -0.45, g);
  mesh(new THREE.BoxGeometry(0.2, 0.25, 0.5), M('#555', { metalness: 0.7 }), 0, 0.5, 0, g);
  const fork = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), chromeMat, 0, 0.75, 0.75, g); fork.rotation.x = -0.4;
  mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), chromeMat, 0, 1.12, 0.6, g).rotation.z = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.09, 10, 8), headMat, 0, 0.95, 0.88, g);
  mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8), chromeMat, 0.18, 0.4, -0.5, g).rotation.x = Math.PI / 2;
  bake(g);
  const r = seat(buildPerson(rand() < 0.3 ? 'school' : 'm'), 1.2); r.g.position.set(0, 0.1, -0.2); g.add(r.g);
  for (const a of r.arms) a.rotation.x = -1.1;
  mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), M(pick(['#c9302c', '#1d1d1f', '#f2f2f0'])), 0, 1.78, -0.2, g);
  if (rand() < 0.6) { const q = seat(buildPerson(), 1.2); q.g.position.set(0, 0.15, -0.6); g.add(q.g); }
  const wheels = [makeTyre(0.3, 0.1, g, 0, 0.3, 0.8), makeTyre(0.3, 0.12, g, 0, 0.3, -0.65)];
  return { g, wheels, L: 2.0, W: 0.9 };
}

/* ---------------- station pins ---------------- */
// a map pin: a rounded head tapering to a point
function makePin(r) {
  const pts = [new THREE.Vector2(0.001, -r * 1.9)];
  for (let i = 0; i <= 24; i++) {
    const ang = -0.95 + (i / 24) * (Math.PI / 2 + 0.95);
    pts.push(new THREE.Vector2(Math.max(0.001, r * Math.cos(ang)), r * Math.sin(ang)));
  }
  return new THREE.LatheGeometry(pts, 32);
}

/* ---------------- leaf-card trees ---------------- */
// a small bunch of leaves on a transparent card
const leafTex = canvasTex(128, 128, (g) => {
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + R(-0.25, 0.25), d = R(14, 30), len = R(26, 40), w = R(9, 14);
    g.save(); g.translate(64 + Math.cos(a) * d, 64 + Math.sin(a) * d); g.rotate(a + R(-0.5, 0.5));
    const v = Math.round(R(205, 255));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -w, len / 2, 0); g.quadraticCurveTo(0, w, -len / 2, 0); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2.4, 0); g.stroke();
    g.restore();
  }
});
const WIND = { value: 0 }, NO_AO = [];
const LEAF_MAT = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9 });
// the whole crown sways slowly and every leaf flutters a little
const WIND_GLSL = `#include <begin_vertex>
    vec3 root = instanceMatrix[3].xyz;
    float lift = position.y + 1.2;
    transformed.x += (sin(uWind * 1.3 + root.x * 0.15 + root.z * 0.1) * 0.06 + sin(uWind * 5.0 + dot(position, vec3(6.0, 4.0, 5.0))) * 0.025) * lift;
    transformed.z += (cos(uWind * 1.1 + root.z * 0.15) * 0.05 + cos(uWind * 4.3 + dot(position, vec3(3.0, 7.0, 4.0))) * 0.02) * lift;`;
// keep the soft-ball normals on both sides of each card
const BALL_NORMALS = THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0');
LEAF_MAT.onBeforeCompile = (sh) => {
  sh.uniforms.uWind = WIND;
  sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', WIND_GLSL);
  sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', BALL_NORMALS);
};
// the same leaves for the ambient occlusion pass, cut out by the texture so it sees leaves and not squares
const LEAF_NORMAL_MAT = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, blending: THREE.NoBlending });
LEAF_NORMAL_MAT.onBeforeCompile = (sh) => {
  sh.uniforms.uWind = WIND; sh.uniforms.leafMap = { value: leafTex };
  sh.vertexShader = 'uniform float uWind;\nvarying vec2 vLeafUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', WIND_GLSL + '\n    vLeafUv = uv;');
  sh.fragmentShader = 'uniform sampler2D leafMap;\nvarying vec2 vLeafUv;\n' + sh.fragmentShader
    .replace('void main() {', 'void main() {\n  if (texture2D(leafMap, vLeafUv).a < 0.45) discard;')
    .replace('#include <normal_fragment_begin>', BALL_NORMALS);
};
// n leaf cards scattered through a unit ball, crowded toward its surface, darker underneath
function leafPuff(n) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), ctr = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    do ctr.set(R(-1, 1), R(-1, 1), R(-1, 1)); while (ctr.lengthSq() > 1 || ctr.lengthSq() < 1e-4);
    ctr.normalize().multiplyScalar(Math.pow(rand(), 0.35));
    q.setFromEuler(e.set(R(0, 6.3), R(0, 6.3), R(0, 6.3)));
    const s = R(0.3, 0.42), jit = R(-0.06, 0.06), base = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      p.set((u - 0.5) * s * 2, (v - 0.5) * s * 2, 0).applyQuaternion(q).add(ctr);
      pos.push(p.x, p.y, p.z);
      const nn = p.clone().normalize();
      nor.push(nn.x, nn.y, nn.z);
      uv.push(u, v);
      const sh = 0.5 + 0.4 * (p.y * 0.5 + 0.5) + 0.22 * ctr.length() + jit; // inner cards sit in shade
      col.push(sh, sh, sh);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ---------------- trees in the parks and along the lanes ---------------- */
{
  const spots = [];
  for (const [, ...c] of MAP.green) {
    const pts = dm(c);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const n = Math.min(14, Math.floor(((maxX - minX) * (maxZ - minZ)) / 500));
    for (let i = 0, tries = 0; i < n && tries < 80; tries++) {
      const x = R(minX, maxX), z = R(minZ, maxZ);
      if (!inPoly(x, z, pts) || nearRoad(x, z)[0] < 2) continue;
      spots.push([x, z]); i++;
    }
  }
  for (let tries = 0; spots.length < 140 && tries < 4000; tries++) {
    const r = pick(ROADS);
    if (r.cls === 'f' || r.cls === 'p') continue;
    const [x, z, dx, dz] = along(r.pts, r.cum, R(0, r.len)), side = rand() < 0.5 ? -1 : 1, off = r.w / 2 + R(1.2, 2.5);
    const tx = x + dz * off * side, tz = z - dx * off * side;
    if (Math.abs(tx) > EDGE || Math.abs(tz) > EDGE || buildingAt(tx, tz) || nearRoad(tx, tz)[0] < 0.8 || spots.some(([sx, sz]) => Math.hypot(sx - tx, sz - tz) < 9)) continue;
    spots.push([tx, tz]);
  }
  const PUFFS = 4;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.34, 4.4, 7), new THREE.MeshLambertMaterial({ color: '#5b4636' }), spots.length);
  const crown = new THREE.InstancedMesh(leafPuff(90), LEAF_MAT, spots.length * PUFFS);
  const o = new THREE.Object3D(), c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    o.position.set(x, 2.1, z); o.rotation.set(R(-0.1, 0.1), 0, R(-0.1, 0.1)); o.scale.set(1, 1, 1); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix);
    const spin = R(0, 6.3), deep = rand() < 0.5;
    for (let k = 0; k < PUFFS; k++) {
      const a = spin + (k / (PUFFS - 1)) * Math.PI * 2, rr = k === 0 ? 0 : R(1.2, 1.8), sc = k === 0 ? R(1.6, 1.9) : R(1.2, 1.5);
      o.position.set(x + Math.cos(a) * rr, k === 0 ? R(5.9, 6.3) : R(4.9, 5.5), z + Math.sin(a) * rr);
      o.rotation.set(0, R(0, 6.3), 0); o.scale.set(sc, sc * 0.8, sc); o.updateMatrix();
      crown.setMatrixAt(i * PUFFS + k, o.matrix);
      crown.setColorAt(i * PUFFS + k, c.set(deep ? '#4f8f3f' : '#6fae4a').offsetHSL(R(-0.02, 0.02), R(-0.05, 0.05), R(-0.05, 0.05)));
    }
    CIRCLES.push({ x, z, r: 0.45 });
  });
  trunk.castShadow = crown.castShadow = true;
  scene.add(trunk, crown);
}

/* ---------------- where the stations stand ---------------- */
// the nearest point on a road of the given classes: [road, x, z, dirX, dirZ]
function snap(x, z, classes) {
  let best = null, bd = 1e9;
  for (const r of ROADS) {
    if (!classes.includes(r.cls)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], [px, pz] = segNear(x, z, ax, az, bx, bz), d = Math.hypot(px - x, pz - z);
      if (d < bd) { const L = Math.hypot(bx - ax, bz - az) || 1; bd = d; best = [r, px, pz, (bx - ax) / L, (bz - az) / L]; }
    }
  }
  return best;
}
{
  // research south along Begum Rokeya Sarani, beyond west along Main Road toward the stadium,
  // hello at the circle, and the personal stops scattered through the lanes to the north-east
  const ANCHOR = {
    pantera: [0.368 * 110, 0.93 * 110], binaries: [0.368 * 210, 0.93 * 210], ai: [0.368 * 310, 0.93 * 310], young: [0.368 * 410, 0.93 * 410], lbt: [0.368 * 520, 0.93 * 520],
    writing: [-0.917 * 110, 0.398 * 110], aifun: [-0.917 * 210, 0.398 * 210], olympiad: [-0.917 * 310, 0.398 * 310], others: [-0.917 * 410, 0.398 * 410],
    links: [-24, -30],
  };
  const personal = STATIONS.filter((s) => s.kind === 'personal');
  personal.forEach((s, i) => { const a = (i / personal.length) * Math.PI * 2; ANCHOR[s.id] = [230 + Math.cos(a) * 75, -170 + Math.sin(a) * 75]; });
  for (const st of STATIONS) {
    const [ax, az] = ANCHOR[st.id];
    const [r, x, z, dx, dz] = snap(ax, az, st.kind === 'personal' ? ['r', 'g'] : st.id === 'links' ? ['p', 't'] : ['p']);
    // stand on whichever side of the road has room: away from buildings and the other carriageway
    let side = 1;
    const room = (sd) => { const tx = x + dz * sd * (r.w / 2 + 3), tz = z - dx * sd * (r.w / 2 + 3); return (buildingAt(tx, tz) ? 0 : 1) + (nearRoad(tx, tz, ['p', 't'])[0] > 0.5 ? 1 : 0); };
    if (room(-1) > room(1)) side = -1;
    const lx = dz * side, lz = -dx * side;
    st.ring = st.kind === 'personal' ? 2.6 : 3.2;
    st.x = x + lx * Math.max(0, r.w / 2 - st.ring + 0.4); st.z = z + lz * Math.max(0, r.w / 2 - st.ring + 0.4);
    st.board = [x + lx * (r.w / 2 + 1.6), z + lz * (r.w / 2 + 1.6), Math.atan2(-lx, -lz)];
  }
}

/* ---------------- stations: a painted board, a photo, a ring on the road ---------------- */
const loader = new THREE.TextureLoader();
const STATION_OBJS = [];
const pinGeo = [];
for (const st of STATIONS) {
  const kc = KIND[st.kind].color, personal = st.kind === 'personal';
  const g = new THREE.Group();
  const [bx, bz, ry] = st.board;
  g.position.set(bx, 0, bz); g.rotation.y = ry;
  scene.add(g);
  const post = M('#2a2a2c', { metalness: 0.4 });
  for (const px of [-1.7, 1.7]) { mesh(new THREE.BoxGeometry(0.16, 6.6, 0.16), post, px, 3.3, -0.08, g); }
  const tex = stationSignTex(st, kc), asp = tex.image.width / tex.image.height, sw = 3.8, sh = sw / asp;
  mesh(new THREE.BoxGeometry(sw + 0.24, sh + 0.24, 0.12), M('#2a1d14'), 0, 2.2, -0.06, g);
  mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshLambertMaterial({ map: tex }), 0, 2.2, 0.01, g);
  const frame = mesh(new THREE.PlaneGeometry(1, 1), M('#2a1d14'), 0, 4.75, -0.02, g);
  const photo = mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#d8cbb8' }), 0, 4.75, 0.0, g);
  loader.load(st.img, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    const a = t.image.width / t.image.height;
    let pw = 2.6 * a, ph = 2.6;
    if (pw > 3.6) { pw = 3.6; ph = 3.6 / a; }
    photo.material = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    photo.scale.set(pw, ph, 1); frame.scale.set(pw + 0.3, ph + 0.3, 1);
  });
  for (const px of [-1.7, 1.7]) CIRCLES.push({ x: bx + Math.cos(ry) * px, z: bz - Math.sin(ry) * px, r: 0.25 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(st.ring - 0.35, st.ring, 48), new THREE.MeshBasicMaterial({ color: kc, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(st.x, 0.14, st.z);
  scene.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(st.ring - 0.35, 40), new THREE.MeshBasicMaterial({ color: kc, transparent: true, opacity: 0.12 }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(st.x, 0.13, st.z);
  scene.add(disc);
  const pin = pinGeo[personal ? 0 : 1] ??= makePin(personal ? 0.42 : 0.62);
  const marker = new THREE.Mesh(pin, new THREE.MeshStandardMaterial({ color: kc, emissive: kc, emissiveIntensity: 0.45, roughness: 0.35 }));
  marker.position.set(st.x, 3, st.z);
  scene.add(marker);
  STATION_OBJS.push({ st, ring, disc, marker, inside: false });
}

/* ---------------- player ---------------- */
const START = (() => { const [, x, z, dx, dz] = snap(0.368 * 45, 0.93 * 45, ['p']); return { x: x + dz * 2, z: z - dx * 2, th: Math.atan2(dx, dz) }; })();
const P = { x: START.x, z: START.z, y: 0, th: START.th, v: 0, steer: 0, wheel: 0, r: 1.05, prevV: 0 };
const player = buildRickshaw();
player.g.rotation.order = 'YXZ';
trimShadows(player.g, 0.08);
scene.add(player.g);

/* ---------------- traffic on the real road network ---------------- */
// split roads at junctions into one-way edges; a vehicle at the end of an edge picks the next one
const EDGES = [], OUT = new Map();
{
  const key = (p) => Math.round(p[0] * 10) + ',' + Math.round(p[1] * 10);
  const uses = new Map();
  for (const r of ROADS) for (const p of r.pts) uses.set(key(p), (uses.get(key(p)) || 0) + 1);
  const addEdge = (r, pts) => {
    const cum = cumLen(pts), e = { r, pts, cum, len: cum[cum.length - 1], from: key(pts[0]), to: key(pts[pts.length - 1]), rev: null };
    if (e.len < 0.5) return null;
    EDGES.push(e);
    if (!OUT.has(e.from)) OUT.set(e.from, []);
    OUT.get(e.from).push(e);
    return e;
  };
  for (const r of ROADS) {
    if (r.cls === 'f') continue;
    let a = 0;
    for (let i = 1; i < r.pts.length; i++) {
      if (i < r.pts.length - 1 && uses.get(key(r.pts[i])) < 2) continue;
      const piece = r.pts.slice(a, i + 1);
      const f = r.ow >= 0 ? addEdge(r, piece) : null, b = r.ow <= 0 ? addEdge(r, piece.slice().reverse()) : null;
      if (f && b) { f.rev = b; b.rev = f; }
      a = i;
    }
  }
}
const ALLOW = { bus: 'pt', truck: 'pt', car: 'ptrs', cng: 'ptrsg', bike: 'ptrsg', rick: 'ptrgs' };
const CAP = { p: 13, t: 10, r: 6, g: 4, s: 5 };
const NPCS = [];
function spawnNPC(n, rmin, rmax) {
  const ok = EDGES.filter((e) => ALLOW[n.kind].includes(e.r.cls));
  for (let tries = 0; tries < 60; tries++) {
    const e = pick(ok), s = R(0, e.len), [x, z] = along(e.pts, e.cum, s), d = Math.hypot(x - P.x, z - P.z);
    if (d < rmin || d > rmax || Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;
    if (NPCS.some((o) => o !== n && Math.hypot(o.g.position.x - x, o.g.position.z - z) < 8)) continue;
    Object.assign(n, { e, s, sp: n.vmax * 0.5, off: null });
    placeNPC(n, 1);
    return true;
  }
  return false;
}
function laneOff(n) {
  const w = n.e.r.w;
  return n.e.r.ow ? -(w / 2 - 1.3) + n.laneU * Math.max(0, w - 2.6) : w / 4;
}
function placeNPC(n, dt) {
  const [x, z, dx, dz] = along(n.e.pts, n.e.cum, n.s), off = laneOff(n);
  n.off = n.off === null ? off : n.off + (off - n.off) * Math.min(1, 3 * dt);
  n.g.position.set(x + dz * n.off, 0, z - dx * n.off);
  const h = Math.atan2(dx, dz);
  n.head = n.head === undefined || dt >= 1 ? h : n.head + angleDiff(h, n.head) * Math.min(1, 8 * dt);
  n.g.rotation.y = n.head;
}
function nextEdge(n) {
  const e = n.e, out = (OUT.get(e.to) || []).filter((o) => o !== e.rev && ALLOW[n.kind].includes(o.r.cls));
  if (!out.length) return e.rev && ALLOW[n.kind].includes(e.rev.r.cls) ? e.rev : null;
  // mostly carry on straight, and motor traffic prefers the bigger roads
  const [, , dx, dz] = along(e.pts, e.cum, e.len);
  const wts = out.map((o) => {
    const [, , ox, oz] = along(o.pts, o.cum, 0);
    return (0.3 + Math.max(0, dx * ox + dz * oz) * 2) * (n.kind === 'rick' ? 1 : { p: 3, t: 2, r: 1, g: 0.6, s: 0.6 }[o.r.cls]);
  });
  let u = rand() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < out.length; i++) { u -= wts[i]; if (u <= 0) return out[i]; }
  return out[out.length - 1];
}
for (let i = 0; i < 48; i++) {
  const kind = pick(['cng', 'cng', 'cng', 'bus', 'bus', 'rick', 'rick', 'rick', 'rick', 'rick', 'car', 'car', 'truck', 'bike', 'bike']);
  let v;
  if (kind === 'rick') {
    const r = buildRickshaw(pick(['#1f8a5b', '#f6c445', '#7b3fb0', '#e8364f']), pick(['#d8323f', '#1d6fb8', '#1f8a5b']), pick(['#e4d7b8', '#9cc3e0', '#e0b0a0']));
    if (rand() < 0.65) { const p = seat(buildPerson(), 1.5); p.g.position.set(R(-0.25, 0.25), 0.27, -0.62); r.body.add(p.g); if (rand() < 0.4) { const q = seat(buildPerson()); q.g.position.set(-p.g.position.x - 0.1, 0.27, -0.62); r.body.add(q.g); } }
    v = { ...r, L: 2.5, W: 1.6, vmax: R(3.5, 5), rick: r };
  } else if (kind === 'cng') v = { ...buildCNG(), vmax: R(8, 11) };
  else if (kind === 'bus') v = { ...buildBus(), vmax: R(7, 9) };
  else if (kind === 'truck') v = { ...buildTruck(), vmax: R(6, 8) };
  else if (kind === 'bike') v = { ...buildBike(), vmax: R(10, 13) };
  else v = { ...buildCar(), vmax: R(9, 12) };
  trimShadows(v.g);
  scene.add(v.g);
  const n = { ...v, kind, sp: 0, spin: 0, honkT: 0, id: i, laneU: kind === 'rick' ? R(0.7, 1) : kind === 'bus' || kind === 'truck' ? R(0.3, 0.8) : R(0, 0.7), off: null };
  NPCS.push(n);
  spawnNPC(n, 12, 260) || spawnNPC(n, 0, 2000);
}
function npcRect(n) {
  const L = n.L / 2, W = n.W / 2, s = Math.abs(Math.sin(n.head)), c = Math.abs(Math.cos(n.head));
  return rect(n.g.position.x, n.g.position.z, 2 * (s * L + c * W), 2 * (c * L + s * W));
}


/* ---------------- people on the sidewalks and in the lanes ---------------- */
const WALKERS = [], STANDERS = [];
const WALK_ROADS = ROADS.filter((r) => r.cls !== 's' && r.cls !== 'f' && r.len > 15);
const walkEdge = (r) => r.w / 2 + (r.cls === 'p' || r.cls === 't' ? 1.4 : -0.7);
function placeWalker(w, rmin, rmax) {
  for (let k = 0; k < 300; k++) {
    const r = pick(WALK_ROADS), s = R(0, r.len), [x, z] = along(r.pts, r.cum, s), d = Math.hypot(x - P.x, z - P.z);
    if ((d < rmin || d > rmax) && k < 299) continue;
    Object.assign(w, { r, s, side: rand() < 0.5 ? -1 : 1, dir: rand() < 0.5 ? -1 : 1, pause: 0 });
    return true;
  }
  return false;
}
for (let i = 0; i < 150; i++) {
  const kid = i % 16 === 0;
  const person = kid ? buildPerson(pick(['m', 'school', 'lungi']), R(0.76, 0.86)) : buildPerson();
  scene.add(person.g);
  const w = { ...person, sp: kid ? R(1.8, 2.6) : R(0.9, 1.5), cur: 0, ph: R(0, 6), pause: 0, kid };
  placeWalker(w, 0, 200);
  WALKERS.push(w);
}
// people chatting outside the shops
for (let i = 0; i < 45 && SIGN_SPOTS.length; i++) {
  const [cx, cz] = SIGN_SPOTS[Math.floor(rand() * SIGN_SPOTS.length)];
  if (Math.abs(cx) > EDGE || Math.abs(cz) > EDGE || buildingAt(cx, cz)) continue;
  const n = rand() < 0.5 ? 2 : 3;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R(-0.3, 0.3), x = cx + Math.cos(a) * 0.45, z = cz + Math.sin(a) * 0.45;
    const person = buildPerson(), ry = Math.atan2(cx - x, cz - z);
    person.g.position.set(x, 0.05, z); person.g.rotation.y = ry;
    scene.add(person.g);
    STANDERS.push({ ...person, ry, ph: R(0, 10), x, z, solid: true });
  }
}
const PEOPLE = [...WALKERS, ...STANDERS];

// someone the rickshaw runs into at speed falls back under the wheels and lies still
function knockDown(p, sp) {
  const x = p.g.position.x, z = p.g.position.z;
  p.down = {
    t: 0, x, y: p.g.position.y, z, ry: Math.atan2(P.x - x, P.z - z),
    hx: Math.sin(P.th), hz: Math.cos(P.th), slide: Math.min(2, sp * 0.2),
    arms: p.arms.map((a) => [a.rotation.x, a.rotation.z]), hips: p.hips.map((h) => h.rotation.x),
  };
  p.g.rotation.order = 'YXZ';
  scream([x, 1.5, z]); thud(Math.min(1, sp / 8));
  shake = Math.min(0.5, 0.15 + sp * 0.03);
  for (const w of WALKERS) if (!w.down && Math.hypot(w.g.position.x - x, w.g.position.z - z) < 12) w.pause = R(3, 7);
}
// returns false once they are back on their feet: only after a while, and only far out of sight
function lieDown(p, dt, dist) {
  const d = p.down;
  d.t += dt;
  if (d.t > 25 && dist > 80) {
    p.g.rotation.x = 0; p.g.position.y = d.y;
    p.arms.forEach((a, i) => { a.rotation.x = d.arms[i][0]; a.rotation.z = d.arms[i][1]; });
    p.hips.forEach((h, i) => { h.rotation.x = d.hips[i]; });
    p.down = null;
    return false;
  }
  const u = Math.min(1, d.t / 0.5), e = u * u, s = d.slide * (1 - (1 - u) * (1 - u));
  p.g.position.set(d.x + d.hx * s, d.y + 0.14 * e, d.z + d.hz * s);
  p.g.rotation.set((-Math.PI / 2) * e, d.ry, 0);
  p.arms[0].rotation.z = -1.1 * e; p.arms[1].rotation.z = 1.1 * e;
  for (const a of p.arms) a.rotation.x = -0.3 * e;
  p.hips[0].rotation.x = 0.15 * e; p.hips[1].rotation.x = -0.1 * e;
  return true;
}

/* ---------------- dust and floating motes ---------------- */
const dotTex = canvasTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
const DUST_N = 160;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
dustGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(DUST_N * 4), 4));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.9, map: dotTex, vertexColors: true, transparent: true, depthWrite: false }));
dust.frustumCulled = false;
scene.add(dust);
const DUST = Array.from({ length: DUST_N }, () => ({ life: 0, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0 }));
let dustI = 0;
function puff(x, z, n, strength) {
  for (let i = 0; i < n; i++) {
    const d = DUST[dustI++ % DUST_N];
    Object.assign(d, { life: 1, x: x + R(-0.2, 0.2), y: 0.2, z: z + R(-0.2, 0.2), vx: R(-0.6, 0.6) * strength, vy: R(0.3, 0.9) * strength, vz: R(-0.6, 0.6) * strength });
  }
}
const MOTE_N = 400;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(MOTE_N * 3);
for (let i = 0; i < MOTE_N; i++) motePos.set([R(-40, 40), R(0.5, 14), R(-40, 40)], i * 3);
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.12, map: dotTex, color: '#ffe6b8', transparent: true, opacity: 0.55, depthWrite: false }));
motes.frustumCulled = false;
scene.add(motes);

/* ---------------- audio ---------------- */
// Everything is synthesised. Sources sit in 3D around a listener at the camera, share a short
// street-canyon echo, and engines that pass by get a Doppler shift.
let AC = null, master = null, wetIn = null, noiseBuf = null, brownBuf = null, DIST = null;
let murmurGain = null, rumbleGain = null;
const SFX = {}; // the player's own rickshaw: rolling, bricks, wind, freewheel, brakes
const ENGINES = [], CHATTER = [], CHAT_SPOTS = [];
const HONK_RATE = { cng: 1.1, bike: 1.2, bus: 0.9, truck: 0.8, car: 0.8, rick: 0.7 }; // honks per second, each
const HORN = { // [partials in Hz, filter centre, typical length, repeats]
  bus: [[185, 233, 277], 900, [0.5, 1.1], [1, 2]], truck: [[165, 208], 800, [0.6, 1.2], [1, 2]],
  car: [[415, 500], 2200, [0.12, 0.3], [1, 3]], cng: [[540, 660], 1800, [0.07, 0.14], [2, 4]],
  bike: [[640, 780], 2400, [0.08, 0.16], [2, 3]],
};
const ENGINE = { // firing rate at rest and per m/s, tone filter, loudness, diesel clatter
  bus: { f0: 22, fk: 2.6, lp: 900, bp: 320, vol: 0.5, clatter: 0.35 }, truck: { f0: 20, fk: 2.4, lp: 800, bp: 280, vol: 0.5, clatter: 0.4 },
  cng: { f0: 27, fk: 5.5, lp: 2600, bp: 650, vol: 0.32, clatter: 0 }, bike: { f0: 30, fk: 6.5, lp: 1600, bp: 420, vol: 0.28, clatter: 0 },
  car: { f0: 34, fk: 4, lp: 420, bp: 180, vol: 0.14, clatter: 0 },
};
const filt = (type, f, q = 0.7) => { const b = AC.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const amp = (v = 0) => { const g = AC.createGain(); g.gain.value = v; return g; };
function loopSrc(buf = noiseBuf) { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.9); return s; }
function setPos(p, x, y, z, glide = 0) {
  if (!p.positionX) { p.setPosition(x, y, z); return; }
  if (glide) { const t = AC.currentTime; p.positionX.setTargetAtTime(x, t, glide); p.positionY.setTargetAtTime(y, t, glide); p.positionZ.setTargetAtTime(z, t, glide); }
  else { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
}
// route a node to the mix, through a 3D panner when it has a position, with some echo
function out(node, pos, wet = 0.25, hrtf = true) {
  let end = node;
  if (pos) {
    const p = AC.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.15; p.maxDistance = 500;
    setPos(p, ...pos); node.connect(p); end = p;
  }
  end.connect(master);
  if (wet) end.connect(amp(wet)).connect(wetIn);
  return end;
}
function env(g, t, a, peak, hold, rel) {
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
}

function initAudio() {
  if (AC) return;
  // iPhones mute web audio with the silent switch unless the page asks to play like media
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state !== 'running') AC.resume();
  const comp = AC.createDynamicsCompressor(); comp.threshold.value = -28; comp.ratio.value = 8; comp.attack.value = 0.004;
  // makeup gain, then a hard limiter so the louder mix never clips
  const lim = AC.createDynamicsCompressor(); lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
  master = amp(1.3); master.connect(comp).connect(amp(2.2)).connect(lim).connect(AC.destination);
  const len = AC.sampleRate * 2;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  brownBuf = AC.createBuffer(1, len, AC.sampleRate);
  const b = brownBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3; }
  DIST = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; DIST[i] = Math.tanh(2.5 * x); }
  // street canyon: a short decaying tail with a few early slaps off the facades
  const irLen = Math.floor(AC.sampleRate * 1.3), ir = AC.createBuffer(2, irLen, AC.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const x = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.5) * 0.4;
    for (const ms of [19, 37, 58, 83, 117]) x[Math.floor((AC.sampleRate * (ms + ch * 6)) / 1000)] += 0.45 * (1 - ms / 160);
  }
  const conv = AC.createConvolver(); conv.buffer = ir;
  wetIn = amp(0.5); wetIn.connect(conv).connect(filt('lowpass', 3200)).connect(master);

  // the city all around: a low roar that swells slowly, and a thin hiss of far traffic
  const roar = amp(0.42); loopSrc(brownBuf).connect(filt('lowpass', 380)).connect(roar).connect(master);
  const swell = AC.createOscillator(); swell.frequency.value = 0.045; swell.connect(amp(0.12)).connect(roar.gain); swell.start();
  loopSrc().connect(filt('bandpass', 1100, 0.5)).connect(amp(0.04)).connect(master);
  murmurGain = amp(0.06); loopSrc().connect(filt('bandpass', 600, 0.9)).connect(filt('lowpass', 1400)).connect(murmurGain).connect(master);

  // the player's rickshaw
  SFX.roll = amp(0); SFX.rollF = filt('bandpass', 300, 0.9);
  loopSrc().connect(SFX.rollF).connect(SFX.roll).connect(master);
  // bricks and broken tarmac: low rumble chopped into bumps by a square-wave gate
  rumbleGain = amp(0); SFX.bumps = AC.createOscillator(); SFX.bumps.type = 'square'; SFX.bumps.frequency.value = 8;
  const gate = amp(0.5); SFX.bumps.connect(amp(0.5)).connect(gate.gain); SFX.bumps.start();
  loopSrc(brownBuf).connect(filt('lowpass', 260)).connect(gate).connect(rumbleGain).connect(master);
  SFX.wind = amp(0); loopSrc().connect(filt('lowpass', 520, 0.5)).connect(filt('highpass', 120)).connect(SFX.wind).connect(master);
  // freewheel ratchet while coasting: a click train through a metallic resonance
  const real = new Float32Array(40), imag = new Float32Array(40);
  for (let k = 1; k < 40; k++) real[k] = 1;
  SFX.pawl = AC.createOscillator(); SFX.pawl.setPeriodicWave(AC.createPeriodicWave(real, imag)); SFX.pawl.frequency.value = 20;
  SFX.free = amp(0); SFX.pawl.connect(filt('bandpass', 4200, 3)).connect(SFX.free).connect(master); SFX.pawl.start();
  // brake squeal
  SFX.squealO = AC.createOscillator(); SFX.squealO.frequency.value = 3150;
  const vib = AC.createOscillator(); vib.frequency.value = 6.5; vib.connect(amp(25)).connect(SFX.squealO.frequency); vib.start();
  SFX.squeal = amp(0); SFX.squealO.connect(filt('bandpass', 3150, 8)).connect(SFX.squeal).connect(master); SFX.squealO.start();

  // engine voices that follow the nearest motor vehicles
  for (let i = 0; i < 14; i++) {
    const v = { n: null, eg: amp(0), tg: amp(0) };
    v.osc = AC.createOscillator(); v.osc.type = 'sawtooth';
    v.sub = AC.createOscillator(); v.sub.type = 'square';
    const shaper = AC.createWaveShaper(); shaper.curve = DIST;
    v.lp = filt('lowpass', 800, 1.2); v.bp = filt('bandpass', 400, 1.6);
    const mixE = amp(1);
    v.osc.connect(shaper); v.sub.connect(amp(0.5)).connect(shaper);
    shaper.connect(v.lp).connect(mixE); shaper.connect(v.bp).connect(mixE);
    // diesel knock: noise gated at the firing rate
    v.knock = amp(0); const kg = amp(0); v.sub.connect(amp(0.5)).connect(kg.gain);
    loopSrc().connect(filt('bandpass', 1400, 1.2)).connect(kg).connect(v.knock).connect(mixE);
    mixE.connect(v.eg);
    v.tf = filt('bandpass', 500, 0.7); loopSrc().connect(v.tf).connect(v.tg);
    const bus = amp(1); v.eg.connect(bus); v.tg.connect(bus);
    v.pan = out(bus, [0, -50, 0], 0.22);
    v.osc.start(); v.sub.start();
    ENGINES.push(v);
  }
  // voices of chatter that settle on the nearest groups of people
  const VOWELS = [[800, 1250], [420, 2000], [320, 2300], [520, 900], [350, 800], [650, 1700]];
  for (let i = 0; i < 10; i++) {
    const c = { spot: null, next: 0, VOWELS };
    c.o = AC.createOscillator(); c.o.type = 'sawtooth'; c.o.frequency.value = 140;
    c.f1 = filt('bandpass', 700, 5); c.f2 = filt('bandpass', 1300, 7);
    c.g = amp(0); c.vol = amp(0);
    c.o.connect(c.f1).connect(c.g); c.o.connect(c.f2).connect(amp(0.6)).connect(c.g);
    c.breath = amp(0); loopSrc().connect(filt('bandpass', 3200, 1.5)).connect(c.breath).connect(c.g);
    c.g.connect(filt('lowpass', 2600)).connect(c.vol);
    c.pan = out(c.vol, [0, -50, 0], 0.3, false);
    c.o.start();
    CHATTER.push(c);
  }

  for (const s of STANDERS) CHAT_SPOTS.push([s.x, 1.5, s.z]);
}

// a thumb-lever rickshaw bell: a clapper striking a steel dome many times a second
function bell(pos = null, vol = 1) {
  if (!AC) return;
  const t0 = AC.currentTime, f0 = pos ? R(1950, 2450) : 2180;
  const bus = amp(0.07 * vol); out(bus, pos, 0.3);
  const parts = [[1, 1, 0.8], [1.004, 0.7, 0.8], [2.31, 0.45, 0.45], [2.74, 0.25, 0.32], [4.13, 0.18, 0.2], [5.42, 0.1, 0.14]];
  for (const [start, n] of [[0, 7], [0.36, 6]]) {
    for (let k = 0; k < n; k++) {
      const t = t0 + start + k * 0.029 + R(0, 0.004), a = 1 - k / (n + 3);
      for (const [r, pa, dec] of parts) {
        const o = AC.createOscillator(), g = AC.createGain();
        o.frequency.value = f0 * r * (1 + R(-0.001, 0.001));
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pa * a, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g).connect(bus); o.start(t); o.stop(t + dec + 0.02);
      }
    }
  }
}
// horns by vehicle type, placed where the vehicle is; rickshaws ring their bell instead
function honk(n, vol = 1) {
  if (!AC) return;
  const pos = [n.g.position.x, 1.2, n.g.position.z];
  if (n.kind === 'rick') { bell(pos, 0.8 * vol); return; }
  const [freqs, fc, lens, reps] = HORN[n.kind] || HORN.car;
  const t0 = AC.currentTime, len = R(...lens), times = Math.round(R(reps[0], reps[1] + 0.49));
  const bus = amp(0.085 * vol); out(bus, pos, 0.35);
  const sh = AC.createWaveShaper(); sh.curve = DIST;
  const tone = filt('bandpass', fc, 1.1); sh.connect(tone).connect(filt('lowpass', fc * 2.2)).connect(bus);
  for (let r = 0; r < times; r++) {
    const s = t0 + r * (len + R(0.06, 0.12)), l = r === times - 1 && rand() < 0.3 ? len * 2.2 : len;
    for (const f of freqs) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = n.kind === 'bus' || n.kind === 'truck' ? 'sawtooth' : 'square';
      o.frequency.setValueAtTime(f * (1 + R(-0.01, 0.01)), s); o.frequency.linearRampToValueAtTime(f * 0.985, s + l);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.5, s + 0.02); g.gain.setValueAtTime(0.5, s + l); g.gain.linearRampToValueAtTime(0, s + l + 0.04);
      o.connect(g).connect(sh); o.start(s); o.stop(s + l + 0.06);
    }
  }
}
// a horn somewhere out of sight, muffled by the buildings
function farHonk() {
  const a = R(0, Math.PI * 2), r = R(70, 160);
  const n = { kind: pick(['cng', 'cng', 'car', 'bus', 'bike', 'rick', 'truck']), g: { position: { x: P.x + Math.cos(a) * r, z: P.z + Math.sin(a) * r } } };
  honk(n, R(0.8, 1.6));
}
// a short scream: a voice that jumps up, wavers and breaks off
function scream(pos) {
  if (!AC) return;
  const t0 = AC.currentTime, len = R(0.55, 0.85), f = R(380, 600);
  const bus = amp(0.6); out(bus, pos, 0.4);
  const o = AC.createOscillator(), vib = AC.createOscillator(), g = amp(0);
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f * 0.8, t0); o.frequency.linearRampToValueAtTime(f * 1.15, t0 + 0.1); o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + len);
  vib.frequency.value = R(6, 8); vib.connect(amp(f * 0.03)).connect(o.frequency);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.04); g.gain.setValueAtTime(1, t0 + len * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
  o.connect(filt('bandpass', 900, 4)).connect(g);
  o.connect(filt('bandpass', 1500, 6)).connect(amp(0.7)).connect(g);
  o.connect(filt('bandpass', 2800, 8)).connect(amp(0.3)).connect(g);
  g.connect(bus);
  o.start(t0); vib.start(t0); o.stop(t0 + len + 0.05); vib.stop(t0 + len + 0.05);
}
// hitting something: a dull thump, a sheet-metal clang and loose parts rattling
function thud(vol) {
  if (!AC) return;
  const t0 = AC.currentTime, bus = amp(0.5 * vol); out(bus, null, 0.3);
  const o = AC.createOscillator(), g = amp();
  o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.2);
  env(g, t0, 0.003, 0.7, 0, 0.25); o.connect(g).connect(bus); o.start(t0); o.stop(t0 + 0.3);
  const n = AC.createBufferSource(); n.buffer = noiseBuf; const ng = amp();
  env(ng, t0, 0.002, 0.5, 0.01, 0.18); n.connect(filt('bandpass', 900, 2.5)).connect(ng).connect(bus); n.start(t0, Math.random()); n.stop(t0 + 0.3);
  for (const f of [523, 811, 1377, 2210]) {
    const p = AC.createOscillator(), pg = amp(); p.frequency.value = f * R(0.97, 1.03);
    env(pg, t0, 0.002, 0.08, 0, R(0.25, 0.5)); p.connect(pg).connect(bus); p.start(t0); p.stop(t0 + 0.6);
  }
  for (let k = 1; k < 5; k++) clink(t0 + k * R(0.05, 0.09), 0.5 * vol, null);
}
// one small metal-on-metal tick (loose hood ribs, chain slap, glasses, spoons)
function clink(t, vol, pos, f0 = R(2600, 4200), dec = 0.08) {
  const bus = amp(vol * 0.05); out(bus, pos, pos ? 0.3 : 0.1);
  for (const r of [1, 1.57, 2.33]) {
    const o = AC.createOscillator(), g = amp(); o.frequency.value = f0 * r;
    env(g, t, 0.001, 1 / r, 0, dec / r); o.connect(g).connect(bus); o.start(t); o.stop(t + dec + 0.02);
  }
}
// the chain over the sprocket, once per sixth of a pedal turn
function tick(vol) {
  if (!AC) return;
  const t0 = AC.currentTime, src = AC.createBufferSource(), g = amp();
  src.buffer = noiseBuf;
  env(g, t0, 0.001, 0.05 * vol, 0, 0.035);
  src.connect(filt('bandpass', R(2800, 3600), 4)).connect(g).connect(master); src.start(t0, Math.random()); src.stop(t0 + 0.05);
}
// an old crank creaks under load
function creak(vol) {
  const t0 = AC.currentTime, o = AC.createOscillator(), g = amp();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(R(55, 80), t0);
  for (let k = 1; k < 8; k++) o.frequency.setValueAtTime(R(45, 95), t0 + k * 0.02);
  env(g, t0, 0.02, 0.05 * vol, 0.08, 0.06);
  o.connect(filt('bandpass', R(900, 1400), 7)).connect(g).connect(master); o.start(t0); o.stop(t0 + 0.25);
}
// house crows: harsh, nasal, rough
let lastCaw = 0;
function caw(pos, vol = 1) {
  if (!AC || AC.currentTime - lastCaw < 0.8) return;
  lastCaw = AC.currentTime;
  const bus = amp(0.2 * vol); out(bus, pos, 0.4);
  const n = 2 + Math.floor(rand() * 3), f = R(560, 700);
  for (let i = 0; i < n; i++) {
    const t = AC.currentTime + i * R(0.3, 0.42), o = AC.createOscillator(), g = amp(), rough = amp(0.5);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.9, t); o.frequency.linearRampToValueAtTime(f * 1.08, t + 0.05); o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.24);
    const lfo = AC.createOscillator(); lfo.frequency.value = R(55, 75); lfo.connect(amp(0.5)).connect(rough.gain);
    const sh = AC.createWaveShaper(); sh.curve = DIST;
    o.connect(sh).connect(rough);
    rough.connect(filt('bandpass', 1150, 2.5)).connect(g); rough.connect(filt('bandpass', 2350, 3)).connect(amp(0.5)).connect(g);
    env(g, t, 0.015, 1, 0.12, 0.1); g.connect(bus);
    o.start(t); lfo.start(t); o.stop(t + 0.3); lfo.stop(t + 0.3);
  }
}
// mynas and sparrows in the trees: quick bright sweeps
function chirp(pos) {
  const bus = amp(0.035); out(bus, pos, 0.25);
  const n = 2 + Math.floor(rand() * 5), base = R(2800, 4200);
  for (let i = 0; i < n; i++) {
    const t = AC.currentTime + i * R(0.07, 0.16), o = AC.createOscillator(), g = amp();
    o.frequency.setValueAtTime(base * R(0.9, 1.1), t); o.frequency.exponentialRampToValueAtTime(base * R(1.2, 1.6), t + 0.05);
    env(g, t, 0.005, 1, 0.02, 0.04); o.connect(g).connect(bus); o.start(t); o.stop(t + 0.1);
  }
}

const _lp = new THREE.Vector3(), _fw = new THREE.Vector3(), _up = new THREE.Vector3();
let audioT = 0, nextBell = 1, nextFar = 0.5, nextChirp = 3, nextClink = 1, lastPhase = 0;
function updateAudio(dt, thr) {
  if (!AC) return;
  const t = AC.currentTime, L = AC.listener;
  // the listener rides with the camera
  _fw.set(0, 0, -1).applyQuaternion(camera.quaternion); _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const lv = _lp.distanceTo(camera.position) / Math.max(dt, 1e-3);
  const lvx = (camera.position.x - _lp.x) / Math.max(dt, 1e-3), lvz = (camera.position.z - _lp.z) / Math.max(dt, 1e-3);
  _lp.copy(camera.position);
  if (L.positionX) {
    L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z;
    L.forwardX.value = _fw.x; L.forwardY.value = _fw.y; L.forwardZ.value = _fw.z; L.upX.value = _up.x; L.upY.value = _up.y; L.upZ.value = _up.z;
  } else { L.setPosition(camera.position.x, camera.position.y, camera.position.z); L.setOrientation(_fw.x, _fw.y, _fw.z, _up.x, _up.y, _up.z); }

  // the player's rickshaw
  const v = Math.abs(P.v), rough = { road: 0.4, foot: 0.8, brick: 1.4, dirt: 1.8 }[surface];
  SFX.roll.gain.setTargetAtTime(Math.min(0.09, v * 0.009) * (surface === 'road' ? 1 : 0.7), t, 0.05);
  SFX.rollF.frequency.setTargetAtTime(220 + v * 45, t, 0.1);
  rumbleGain.gain.setTargetAtTime(Math.min(0.5, v * 0.03 * Math.max(0, rough - 0.3)), t, 0.05);
  SFX.bumps.frequency.setTargetAtTime(Math.max(1, v * (surface === 'brick' ? 4 : 2.2)), t, 0.05);
  SFX.wind.gain.setTargetAtTime(Math.min(0.12, v * v * 0.0006), t, 0.1);
  SFX.pawl.frequency.setTargetAtTime(Math.max(2, (v / (2 * Math.PI * 0.42)) * 18), t, 0.05);
  SFX.free.gain.setTargetAtTime(thr <= 0 && P.v > 0.6 ? Math.min(0.035, v * 0.006) : 0, t, 0.04);
  SFX.squeal.gain.setTargetAtTime(K.down && P.v > 1.5 ? Math.min(0.02, (P.v - 1.5) * 0.004) : 0, t, 0.06);
  const phase = Math.floor((P.wheel * 0.7) / (Math.PI * 2));
  if (phase !== lastPhase) { lastPhase = phase; if (thr > 0 && rand() < 0.35) creak(K.boost ? 1 : 0.6); }
  if (v > 2 && rand() < dt * v * rough * 0.5) clink(t, Math.min(1, v / 8) * rough * 0.7, null, R(2200, 3600), 0.05);

  // engines: give the voices to the nearest motor vehicles
  const near = NPCS.filter((n) => n.kind !== 'rick' && n.g.visible)
    .map((n) => [n, Math.hypot(n.g.position.x - camera.position.x, n.g.position.z - camera.position.z)])
    .filter(([, d]) => d < 150).sort((a, b) => a[1] - b[1]).slice(0, ENGINES.length).map(([n]) => n);
  for (const e of ENGINES) if (e.n && !near.includes(e.n)) { e.n = null; e.eg.gain.setTargetAtTime(0, t, 0.08); e.tg.gain.setTargetAtTime(0, t, 0.08); }
  for (const n of near) {
    if (ENGINES.some((e) => e.n === n)) continue;
    const e = ENGINES.find((x) => !x.n);
    if (!e) break;
    e.n = n; e.prev = null;
    const c = ENGINE[n.kind];
    e.lp.frequency.value = c.lp; e.bp.frequency.value = c.bp; e.knock.gain.value = c.clatter;
    setPos(e.pan, n.g.position.x, 1, n.g.position.z);
  }
  for (const e of ENGINES) {
    if (!e.n) continue;
    const n = e.n, c = ENGINE[n.kind], x = n.g.position.x, z = n.g.position.z;
    // Doppler: compare how fast the source and the listener close on each other
    let doppler = 1;
    if (e.prev) {
      const svx = (x - e.prev[0]) / Math.max(dt, 1e-3), svz = (z - e.prev[1]) / Math.max(dt, 1e-3);
      const dx = camera.position.x - x, dz = camera.position.z - z, dl = Math.hypot(dx, dz) || 1;
      const vs = (svx * dx + svz * dz) / dl, vl = -(lvx * dx + lvz * dz) / dl;
      doppler = clamp((343 + vl) / (343 - vs), 0.85, 1.18);
    }
    e.prev = [x, z];
    const load = n.sp / n.vmax;
    const f = (c.f0 + n.sp * c.fk) * doppler * (1 + 0.04 * Math.sin(t * 7 + x));
    e.osc.frequency.setTargetAtTime(f, t, 0.05); e.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    e.eg.gain.setTargetAtTime(2.2 * c.vol * (0.55 + 0.45 * load), t, 0.1);
    e.tg.gain.setTargetAtTime(Math.min(0.25, n.sp * 0.02) * (n.kind === 'bus' || n.kind === 'truck' ? 1.5 : 1), t, 0.1);
    e.tf.frequency.setTargetAtTime((300 + n.sp * 30) * doppler, t, 0.1);
    setPos(e.pan, x, 1, z, 0.03);
  }
  void lv;

  // chatter: four voices on the nearest groups, speaking in short phrases
  audioT += dt;
  if (audioT > 0.5) {
    audioT = 0;
    const passing = WALKERS.filter((w) => w.g.visible).map((w) => [w.g.position.x, 1.6, w.g.position.z]);
    const spots = CHAT_SPOTS.concat(passing).map((p) => [p, Math.hypot(p[0] - P.x, p[2] - P.z)]).filter(([, d]) => d < 55).sort((a, b) => a[1] - b[1]).slice(0, CHATTER.length);
    CHATTER.forEach((c, i) => {
      const s = spots[i]?.[0] ?? null;
      if (s !== c.spot && !(s && c.spot && Math.hypot(s[0] - c.spot[0], s[2] - c.spot[2]) < 2)) { c.spot = s; if (s) { setPos(c.pan, s[0] + R(-0.5, 0.5), s[1], s[2] + R(-0.5, 0.5)); c.pitch = rand() < 0.5 ? R(105, 145) : R(185, 240); } }
      c.vol.gain.setTargetAtTime(s ? 0.28 : 0, t, 0.3);
    });
  }
  for (const c of CHATTER) {
    if (!c.spot || t < c.next) continue;
    let s = t + 0.02;
    const syl = 3 + Math.floor(rand() * 7);
    for (let k = 0; k < syl; k++) {
      const d = R(0.08, 0.2), [f1, f2] = pick(c.VOWELS), p = c.pitch * (1 + 0.12 * Math.sin(k * 1.3)) * (1 - k * 0.012);
      c.f1.frequency.setTargetAtTime(f1, s, 0.02); c.f2.frequency.setTargetAtTime(f2, s, 0.02);
      c.o.frequency.setTargetAtTime(p, s, 0.03);
      c.g.gain.setTargetAtTime(R(0.6, 1), s, 0.015); c.g.gain.setTargetAtTime(0.05, s + d * 0.8, 0.02);
      if (rand() < 0.4) { c.breath.gain.setTargetAtTime(0.25, Math.max(t, s - 0.03), 0.005); c.breath.gain.setTargetAtTime(0, s, 0.01); }
      s += d;
    }
    c.g.gain.setTargetAtTime(0, s, 0.03);
    c.next = s + R(0.08, 0.45);
  }

  // birds, rickshaw bells, and horns from streets you cannot see
  nextFar -= dt; nextChirp -= dt; nextClink -= dt;
  if (nextFar < 0) { nextFar = R(0.05, 0.35); farHonk(); if (rand() < 0.45) setTimeout(farHonk, R(60, 250)); if (rand() < 0.2) setTimeout(farHonk, R(300, 600)); }
  nextBell -= dt;
  if (nextBell < 0) { nextBell = R(0.3, 1.2); const a = R(0, Math.PI * 2), r = R(12, 50); bell([P.x + Math.cos(a) * r, 1.2, P.z + Math.sin(a) * r], R(0.4, 0.9)); }
  if (nextChirp < 0) { nextChirp = R(1.5, 5); const a = R(0, Math.PI * 2), r = R(8, 30); chirp([P.x + Math.cos(a) * r, R(4, 7), P.z + Math.sin(a) * r]); }
}

/* ---------------- input ---------------- */
const K = { up: false, down: false, left: false, right: false, boost: false };
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'boost', ShiftRight: 'boost' };
let camMode = 0, started = false;
addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { K[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (!started) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) bell(); }
  if (e.code === 'KeyC' && !e.repeat) camMode = (camMode + 1) % 2;
  if (e.code === 'KeyR' && !e.repeat) Object.assign(P, { x: START.x, z: START.z, th: START.th, v: 0 });
  if (e.code === 'Escape') closeCard();
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) K[KEYMAP[e.code]] = false; });
for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (k === 'bell') bell(); else K[k] = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { if (k !== 'bell') K[k] = false; });
}
$('#start').addEventListener('click', () => {
  initAudio(); started = true;
  $('#intro').classList.add('gone');
  setTimeout(bell, 300);
});
// Safari and phones can start or leave the audio paused; any tap or key wakes it again
const wakeAudio = () => { if (AC && AC.state !== 'running') AC.resume(); };
for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, wakeAudio, true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeAudio(); });

/* ---------------- UI: card and toast ---------------- */
let activeCard = null;
function openCard(st) {
  const card = $('#card');
  card.style.setProperty('--accent', KIND[st.kind].color);
  card.querySelector('.card-kicker').textContent = KIND[st.kind].label;
  card.querySelector('.card-title').textContent = st.title;
  const img = card.querySelector('.card-img');
  img.classList.remove('broken'); img.onerror = () => img.classList.add('broken');
  img.src = st.img || ''; img.alt = st.title;
  card.querySelector('.card-text').textContent = st.text;
  const links = card.querySelector('.card-links');
  links.innerHTML = '';
  for (const [href, label] of st.links || []) {
    const a = document.createElement('a'); a.href = href; a.textContent = label + ' →'; a.target = '_blank'; a.rel = 'noopener';
    links.appendChild(a);
  }
  card.classList.remove('hidden');
  activeCard = st;
}
function closeCard() { $('#card').classList.add('hidden'); activeCard = null; }
$('.card-close').addEventListener('click', closeCard);
let toastT = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200);
}

/* ---------------- simulation ---------------- */
let shake = 0;
function pushOut(r, rad = P.r) {
  const cx = clamp(P.x, r.minX, r.maxX), cz = clamp(P.z, r.minZ, r.maxZ);
  let nx = P.x - cx, nz = P.z - cz;
  const d2 = nx * nx + nz * nz;
  if (d2 >= rad * rad) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2); nx /= d; nz /= d;
    P.x += nx * (rad - d); P.z += nz * (rad - d);
  } else {
    const pen = [P.x - r.minX, r.maxX - P.x, P.z - r.minZ, r.maxZ - P.z];
    const i = pen.indexOf(Math.min(...pen));
    [nx, nz] = [[-1, 0], [1, 0], [0, -1], [0, 1]][i];
    if (i === 0) P.x = r.minX - rad; else if (i === 1) P.x = r.maxX + rad; else if (i === 2) P.z = r.minZ - rad; else P.z = r.maxZ + rad;
  }
  return [nx, nz];
}
function hit(n, soft = false) {
  const impact = Math.abs(Math.sin(P.th) * n[0] + Math.cos(P.th) * n[1]);
  if (!soft && Math.abs(P.v) > 3 && impact > 0.5) { thud(Math.min(1, Math.abs(P.v) / 12)); shake = Math.min(0.5, Math.abs(P.v) * 0.03); }
  P.v *= impact > 0.75 && Math.abs(P.v) > 4 && !soft ? -0.3 : 1 - 0.7 * impact;
}
function updatePlayer(dt) {
  const thr = (K.up ? 1 : 0) - (K.down ? 1 : 0), st = (K.left ? 1 : 0) - (K.right ? 1 : 0);
  surface = surfaceAt(P.x, P.z);
  const rough = { road: 0.4, foot: 0.8, brick: 1.4, dirt: 1.8 }[surface];
  // pedal power falls off with speed; rolling resistance and drag slow you down
  const power = K.boost ? 13 : 8.5;
  let a = 0;
  if (thr > 0) a = P.v < 0 ? 16 : power * (1 - P.v / (K.boost ? 21 : 15));
  else if (thr < 0) a = P.v > 0 ? -16 : -4 * (1 + P.v / 4);
  a -= Math.sign(P.v) * (0.25 * rough + 0.004 * P.v * P.v);
  if (!thr && Math.abs(P.v) < 0.15) { a = 0; P.v = 0; }
  P.prevV = P.v;
  P.v += a * dt;
  P.steer += (st * (0.6 - Math.min(0.3, Math.abs(P.v) * 0.015)) - P.steer) * Math.min(1, 7 * dt);
  P.th += (P.v * Math.tan(P.steer) / 1.8) * dt;
  P.x += Math.sin(P.th) * P.v * dt;
  P.z += Math.cos(P.th) * P.v * dt;
  collideWorld();
  for (const n of NPCS) { const nn = pushOut(npcRect(n)); if (nn) { hit(nn); if (n.honkT <= 0) { honk(n, 1.3); n.honkT = 1.5; } } }
  // people cannot stop a moving rickshaw; only at a crawl do you nudge past them
  for (const w of PEOPLE) {
    if (!w.g.visible || w.down) continue;
    const dx = P.x - w.g.position.x, dz = P.z - w.g.position.z, d = Math.hypot(dx, dz), m = P.r + 0.35;
    if (d >= m || d < 1e-4) continue;
    if (Math.abs(P.v) > 0.8) { knockDown(w, Math.abs(P.v)); P.v *= 0.85; }
    else { P.x = w.g.position.x + (dx / d) * m; P.z = w.g.position.z + (dz / d) * m; hit([dx / d, dz / d], true); w.pause = 1.5; }
  }
  for (const c of CIRCLES) {
    const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz), m = c.r + P.r;
    if (d < m) { P.x = c.x + (dx / d) * m; P.z = c.z + (dz / d) * m; hit([dx / d, dz / d]); }
  }
  P.wheel += (P.v * dt) / 0.42;
  const { g, wheels, front, body, tassels } = player;
  P.y += (0 - P.y) * Math.min(1, 14 * dt);
  g.position.set(P.x, P.y, P.z);
  g.rotation.y = P.th;
  // lean into turns, pitch under braking, shake on rough ground
  const acc = (P.v - P.prevV) / Math.max(dt, 1e-4);
  const jitter = Math.min(1, Math.abs(P.v) / 6) * rough;
  body.rotation.z = clamp(-P.steer * P.v * 0.014, -0.1, 0.1) + (Math.random() - 0.5) * 0.012 * jitter;
  body.rotation.x += (clamp(acc * 0.006, -0.05, 0.05) + (Math.random() - 0.5) * 0.01 * jitter - body.rotation.x) * Math.min(1, 10 * dt);
  body.position.y = (Math.random() * 0.012 + Math.abs(Math.sin(P.wheel * 0.7)) * 0.01) * jitter;
  for (const w of wheels) w.rotation.x = P.wheel;
  front.rotation.y = P.steer * 0.8;
  const ph = P.wheel * 0.7;
  pedal(player, ph);
  if (Math.floor(ph / (Math.PI / 3)) !== lastTick && thr > 0) { lastTick = Math.floor(ph / (Math.PI / 3)); tick(Math.min(1, Math.abs(P.v) / 8)); }
  // tassels swing like pendulums
  const rk = player;
  rk.swingV += (-40 * rk.swing - 3 * rk.swingV + acc * 0.8 + (Math.random() - 0.5) * 30 * jitter) * dt;
  rk.swing += rk.swingV * dt;
  for (const t of tassels) { t.rotation.x = clamp(rk.swing, -0.8, 0.8); t.rotation.z = -P.steer * P.v * 0.03; }
  // dust from the wheels
  if ((surface === 'dirt' && Math.abs(P.v) > 3) || (acc < -10 && Math.abs(P.v) > 3) || (Math.abs(P.steer) > 0.35 && Math.abs(P.v) > 8)) {
    if (Math.random() < dt * 30) for (const s of [-1, 1]) puff(P.x - Math.sin(P.th) * 0.6 + Math.cos(P.th) * s * 0.74, P.z - Math.cos(P.th) * 0.6 - Math.sin(P.th) * s * 0.74, 1, surface === 'dirt' ? 1.4 : 0.8);
  }

}

// bumper gap from n to o when o sits in n's path within a few metres, else null
function aheadGap(n, o) {
  const qx = o.g.position.x - n.g.position.x, qz = o.g.position.z - n.g.position.z;
  if (Math.abs(qx) + Math.abs(qz) > 24) return null;
  const hx = Math.sin(n.head), hz = Math.cos(n.head);
  const ca = qx * hx + qz * hz, cl = Math.abs(qx * hz - qz * hx);
  const oa = Math.abs(Math.sin(o.head - n.head)), ob = Math.abs(Math.cos(o.head - n.head));
  const oLen = (o.L * ob + o.W * oa) / 2, oWid = (o.L * oa + o.W * ob) / 2;
  if (ca <= 0 || cl > n.W / 2 + oWid + 0.3) return null;
  const gap = ca - n.L / 2 - oLen;
  return gap < 6 ? gap : null;
}
// do the footprints of two vehicles overlap (separating axis test)
function npcOverlap(a, b) {
  const corners = (n) => {
    const s = Math.sin(n.head), c = Math.cos(n.head), L = n.L / 2, W = n.W / 2, { x, z } = n.g.position;
    return [[L, W], [L, -W], [-L, W], [-L, -W]].map(([l, w]) => [x + s * l + c * w, z + c * l - s * w]);
  };
  const A = corners(a), B = corners(b);
  for (const n of [a, b]) for (const [ax, az] of [[Math.sin(n.head), Math.cos(n.head)], [Math.cos(n.head), -Math.sin(n.head)]]) {
    const pa = A.map((p) => p[0] * ax + p[1] * az), pb = B.map((p) => p[0] * ax + p[1] * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
function updateNPCs(dt) {
  for (const n of NPCS) n.prev = [n.e, n.s, n.g.position.x, n.g.position.z, n.head, n.off];
  for (const n of NPCS) {
    const near = Math.hypot(P.x - n.g.position.x, P.z - n.g.position.z);
    // traffic follows you around: vehicles far behind reappear down the road, out of sight
    if (near > 320) { spawnNPC(n, 210, 300); continue; }
    let target = Math.min(n.vmax, CAP[n.e.r.cls] ?? 6);
    const hf = [Math.sin(n.head), Math.cos(n.head)], hl = [hf[1], -hf[0]];
    if (n.e.len - n.s < 6 && target > 6) target = 6; // ease off into junctions
    if (near < 150) for (const o of NPCS) {
      if (o === n) continue;
      const gap = aheadGap(n, o);
      if (gap === null) continue;
      if (n.id < o.id && aheadGap(o, n) !== null && gap > 0.3) continue;
      const ov = o.sp * (Math.sin(o.head) * hf[0] + Math.cos(o.head) * hf[1]);
      target = Math.min(target, gap < 1.2 ? 0 : Math.max(0, Math.min(ov, gap - 1.2)));
    }
    const px = P.x - n.g.position.x, pz = P.z - n.g.position.z;
    const al = px * hf[0] + pz * hf[1], la = px * hl[0] + pz * hl[1];
    if (al > 0 && al < n.L / 2 + 5 && Math.abs(la) < n.W / 2 + 1.3) {
      target = 0;
      if (n.honkT <= 0) { honk(n); n.honkT = R(1.2, 2.5); }
    }
    n.honkT -= dt;
    n.sp += (target - n.sp) * Math.min(1, 3 * dt);
    n.s += n.sp * dt;
    let gone = false;
    while (n.s > n.e.len) {
      const nx = nextEdge(n);
      if (!nx) { gone = !spawnNPC(n, 210, 300); break; }
      n.s -= n.e.len; n.e = nx;
    }
    if (!gone) placeNPC(n, dt);
    n.g.visible = near < 140; // low res: the haze hides them beyond this anyway
    if (!n.g.visible) continue;
    n.spin += (n.sp * dt) / 0.35;
    for (const w of n.wheels) w.rotation.x = n.spin;
    if (n.rick) pedal(n.rick, n.spin * 0.7);
  }
  // whoever drove into another vehicle goes back a step and waits
  for (let i = 0; i < NPCS.length; i++) for (let j = i + 1; j < NPCS.length; j++) {
    const a = NPCS[i], b = NPCS[j], dx = b.g.position.x - a.g.position.x, dz = b.g.position.z - a.g.position.z;
    if (Math.abs(dx) + Math.abs(dz) > (a.L + b.L) * 0.75 || !npcOverlap(a, b)) continue;
    const ta = Math.sin(a.head) * dx + Math.cos(a.head) * dz, tb = -(Math.sin(b.head) * dx + Math.cos(b.head) * dz);
    const n = ta > tb ? a : b;
    [n.e, n.s] = n.prev; n.g.position.set(n.prev[2], 0, n.prev[3]); n.head = n.prev[4]; n.off = n.prev[5]; n.g.rotation.y = n.head; n.sp = 0;
  }
  // in Dhaka a horn means "I am here", so everyone uses it, all the time
  if (AC) for (const n of NPCS) {
    if (!n.g.visible || n.honkT > 0) continue;
    if (rand() < dt * HONK_RATE[n.kind]) { honk(n, R(0.8, 1.4)); n.honkT = R(0.25, 0.9); }
  }
}

function updateWalkers(dt, t) {
  let crowd = 0;
  for (const w of WALKERS) {
    const dx = P.x - w.g.position.x, dz = P.z - w.g.position.z, d = Math.hypot(dx, dz);
    if (w.down && lieDown(w, dt, d)) continue;
    if (d > 170 && !w.down) placeWalker(w, 110, 160);
    w.g.visible = d < 75;
    if (!w.g.visible) continue;
    if (d < 25) crowd++;
    const [x, z, fx, fz] = along(w.r.pts, w.r.cum, w.s);
    const ahead = (dx * fx + dz * fz) * w.dir;
    let target = w.sp;
    if (d < 3.2 && ahead > -0.5) target = 0;
    if (w.pause > 0) { w.pause -= dt; target = 0; }
    else if (rand() < dt * 0.03) w.pause = R(1, 4);
    if (rand() < dt * (w.kid ? 0.15 : 0.01)) w.dir = -w.dir;
    w.cur += (target - w.cur) * Math.min(1, 5 * dt);
    w.s += w.dir * w.cur * dt;
    if (w.s > w.r.len) { w.s = w.r.len; w.dir = -1; }
    if (w.s < 0) { w.s = 0; w.dir = 1; }
    const e = walkEdge(w.r) * w.side;
    w.g.position.set(x + fz * e, 0.04, z - fx * e);
    w.g.rotation.y = Math.atan2(fx * w.dir, fz * w.dir);
    w.ph += w.cur * dt * 5;
    const sw = Math.sin(w.ph) * 0.5 * Math.min(1, w.cur);
    w.hips[0].rotation.x = sw; w.hips[1].rotation.x = -sw;
    w.arms[0].rotation.x = -sw * 0.8; w.arms[1].rotation.x = sw * 0.8;
    w.g.position.y += Math.abs(Math.sin(w.ph)) * 0.03 * Math.min(1, w.cur);
  }
  for (const p of STANDERS) {
    const d = Math.abs(P.x - p.x) + Math.abs(P.z - p.z);
    p.g.visible = d < 90;
    if (p.down && lieDown(p, dt, d)) continue;
    if (!p.g.visible) continue;
    if (d < 30) crowd++;
    p.g.rotation.z = Math.sin(t * 0.7 + p.ph) * 0.02;
    p.g.rotation.y = p.ry + Math.sin(t * 0.3 + p.ph * 2) * 0.25;
    const talk = Math.max(0, Math.sin(t * 0.5 + p.ph));
    p.arms[p.ph > 5 ? 0 : 1].rotation.x = -talk * (0.6 + Math.sin(t * 6 + p.ph) * 0.25);
  }
  if (murmurGain) murmurGain.gain.value = 0.06 + Math.min(0.16, crowd * 0.005);
}

function updateStations(t) {
  for (const s of STATION_OBJS) {
    const { st } = s;
    const d = Math.hypot(P.x - st.x, P.z - st.z);
    const inside = d < st.ring;
    s.marker.rotation.y = t * 1.5;
    s.marker.position.y = 3.2 + Math.sin(t * 2 + st.x) * 0.25;
    // the personal stops only show once you are close, or once you have found one
    s.marker.visible = !inside && (st.kind !== 'personal' || galiFound || d < 60);
    s.ring.material.opacity = inside ? 1 : 0.6 + Math.sin(t * 3) * 0.2;
    s.disc.material.opacity = inside ? 0.35 : 0.12;
    if (inside && !s.inside) {
      openCard(st);
      if (!visited.has(st.id)) { visited.add(st.id); bell(); }
      if (st.kind === 'personal' && !galiFound) { galiFound = true; toast('You found the hidden gali'); }
    }
    if (!inside && s.inside && activeCard === st) closeCard();
    s.inside = inside;
  }
}

// walls and posts push the rickshaw back; the map has an edge
function collideWorld() {
  for (const [ax, az, bx, bz] of gridAt(WALLS, P.x, P.z)) {
    const [px, pz] = segNear(P.x, P.z, ax, az, bx, bz);
    let nx = P.x - px, nz = P.z - pz;
    const d = Math.hypot(nx, nz);
    if (d >= P.r || d < 1e-6) continue;
    nx /= d; nz /= d;
    P.x = px + nx * P.r; P.z = pz + nz * P.r;
    hit([nx, nz]);
  }
  if (Math.abs(P.x) > EDGE || Math.abs(P.z) > EDGE) { P.x = clamp(P.x, -EDGE, EDGE); P.z = clamp(P.z, -EDGE, EDGE); P.v *= 0.5; }
}
function surfaceAt(x, z) {
  let best = 'dirt';
  for (const { r, i } of gridAt(RGRID, x, z)) {
    const [px, pz] = segNear(x, z, ...r.pts[i - 1], ...r.pts[i]), d = Math.hypot(x - px, z - pz) - r.w / 2;
    if (d < 0) return r.cls === 'g' || r.cls === 'f' ? 'brick' : 'road';
    if ((r.cls === 'p' || r.cls === 't') && d < 2.5) best = 'foot';
  }
  return best;
}
let lastTick = 0, surface = 'road';
// keep the camera out of buildings: march from the rickshaw toward the camera
function clearance(from, to) {
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
    const b = buildingAt(x, z);
    if (b && y < b.h + 0.3) return Math.max(0.2, (i - 1.5) / steps);
  }
  return 1;
}

/* ---------------- minimap: the real streets, drawn once ---------------- */
const mm = $('#minimap'), mg = mm.getContext('2d');
const MS = 0.55, MAPW = Math.ceil(2 * (EDGE + 100) * MS);
const mapCanvas = document.createElement('canvas');
mapCanvas.width = mapCanvas.height = MAPW;
{
  const g = mapCanvas.getContext('2d'), X = (x) => (x + EDGE + 100) * MS;
  g.fillStyle = '#f2e3c6'; g.fillRect(0, 0, MAPW, MAPW);
  const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z)))); g.closePath(); g.fill(); };
  for (const [, ...c] of MAP.green) poly(dm(c), '#b9cf93');
  for (const c of MAP.water) poly(dm(c), '#8fb6bb');
  for (const b of BUILDINGS) poly(b.pts, '#dccbb0');
  g.lineCap = g.lineJoin = 'round';
  for (const cls of ['f', 's', 'g', 'r', 't', 'p']) for (const r of ROADS) {
    if (r.cls !== cls) continue;
    g.strokeStyle = cls === 'p' ? '#4a4850' : cls === 't' ? '#5a5860' : '#77737a';
    g.lineWidth = Math.max(1.2, r.w * MS);
    g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z)))); g.stroke();
  }
  g.strokeStyle = 'rgba(30,110,70,.75)'; g.lineWidth = 2.2; g.setLineDash([6, 4]);
  for (const l of RAIL) { g.beginPath(); l.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z)))); g.stroke(); }
}
let galiFound = false;
const visited = new Set();
function drawMinimap() {
  const view = 340 * MS, sx = (P.x + EDGE + 100) * MS - view / 2, sz = (P.z + EDGE + 100) * MS - view / 2;
  const k = mm.width / view;
  mg.drawImage(mapCanvas, sx, sz, view, view * (mm.height / mm.width), 0, 0, mm.width, mm.height);
  const mx = (x) => ((x + EDGE + 100) * MS - sx) * k, mz = (z) => ((z + EDGE + 100) * MS - sz) * k;
  for (const st of STATIONS) {
    if (st.kind === 'personal' && !galiFound) continue;
    const x = clamp(mx(st.x), 6, mm.width - 6), y = clamp(mz(st.z), 6, mm.height - 16);
    mg.fillStyle = KIND[st.kind].color;
    mg.beginPath(); mg.arc(x, y, visited.has(st.id) ? 2.5 : 3.6, 0, 7); mg.fill();
    if (visited.has(st.id)) { mg.strokeStyle = KIND[st.kind].color; mg.beginPath(); mg.arc(x, y, 4.5, 0, 7); mg.stroke(); }
  }
  mg.save(); mg.translate(mx(P.x), mz(P.z)); mg.rotate(-P.th + Math.PI);
  mg.fillStyle = '#e8364f'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5;
  mg.beginPath(); mg.moveTo(0, -7); mg.lineTo(5, 5); mg.lineTo(0, 2.5); mg.lineTo(-5, 5); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
  mg.fillStyle = '#3b2a1e'; mg.font = `600 10px ${EN}`;
  const shown = STATIONS.filter((s) => s.kind !== 'personal' || galiFound).length;
  mg.fillText(`${visited.size} / ${shown}${galiFound ? '' : ' + ?'}`, 6, mm.height - 6);
}

function updateParticles(dt) {
  const pos = dustGeo.attributes.position.array, col = dustGeo.attributes.color.array;
  for (let i = 0; i < DUST_N; i++) {
    const d = DUST[i];
    if (d.life > 0) {
      d.life -= dt * 0.9;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.vx *= 0.97; d.vz *= 0.97; d.vy *= 0.95;
    }
    pos[i * 3] = d.x; pos[i * 3 + 1] = d.life > 0 ? d.y : -10; pos[i * 3 + 2] = d.z;
    col.set([0.78, 0.66, 0.52, Math.max(0, d.life) * 0.45], i * 4);
  }
  dustGeo.attributes.position.needsUpdate = true;
  dustGeo.attributes.color.needsUpdate = true;
  for (let i = 0; i < MOTE_N; i++) {
    let x = motePos[i * 3] + Math.sin(i + performance.now() * 0.0003) * dt * 0.3, y = motePos[i * 3 + 1] + dt * 0.08, z = motePos[i * 3 + 2];
    if (x - P.x > 40) x -= 80; if (x - P.x < -40) x += 80;
    if (z - P.z > 40) z -= 80; if (z - P.z < -40) z += 80;
    if (y > 14) y = 0.5;
    motePos[i * 3] = x; motePos[i * 3 + 1] = y; motePos[i * 3 + 2] = z;
  }
  moteGeo.attributes.position.needsUpdate = true;
}

const camPos = new THREE.Vector3(0, 8, 46), camLook = new THREE.Vector3(0, 1, 20);
const _from = new THREE.Vector3(), _to = new THREE.Vector3();
let camYaw = START.th;
camera.position.copy(camPos);
let camOverride = null; // debug: [[x, y, z], [lookX, lookY, lookZ]]
function updateCamera(dt) {
  camYaw += angleDiff(P.th, camYaw) * (1 - Math.exp(-2.2 * dt));
  const sp = Math.abs(P.v);
  const dist = camMode ? 24 : 9 + sp * 0.22, h = camMode ? 30 : 4.6 + sp * 0.08;
  _from.set(P.x, 2.2, P.z);
  _to.set(P.x - Math.sin(camYaw) * dist, h, P.z - Math.cos(camYaw) * dist);
  const f = camMode ? 1 : clearance(_from, _to);
  _to.lerpVectors(_from, _to, f);
  camPos.lerp(_to, 1 - Math.exp(-(f < 1 ? 10 : 4) * dt));
  camLook.lerp(_from.set(P.x + Math.sin(P.th) * 4, 1.4, P.z + Math.cos(P.th) * 4), 1 - Math.exp(-6 * dt));
  camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += R(-shake, shake); camera.position.y += R(-shake, shake); shake *= Math.exp(-8 * dt); if (shake < 0.01) shake = 0; }
  camera.lookAt(camLook);
  if (camOverride) { camera.position.set(...camOverride[0]); camera.lookAt(...camOverride[1]); }
  sky.position.copy(camera.position);
  sun.position.set(P.x + SUN_DIR.x * 120, SUN_DIR.y * 120, P.z + SUN_DIR.z * 120);
  sun.target.position.set(P.x, 0, P.z);
}

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
function update(dt, t) {
  if (started) updatePlayer(dt);
  else { player.g.position.set(P.x, 0, P.z); player.g.rotation.y = P.th; pedal(player, 0); }
  updateNPCs(dt);
  updateWalkers(dt, t);
  updateTrains(dt);
  updateParticles(dt);
  updateStations(t);
  updateCamera(dt);
  updateAudio(dt, started ? (K.up ? 1 : 0) - (K.down ? 1 : 0) : 0);
  WIND.value = t;
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt, clock.elapsedTime);
  drawMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
frame();

// debug hook: advance the simulation without relying on requestAnimationFrame
let simT = 0;
window.__game = {
  P, K, STATIONS, NPCS, WALKERS, STANDERS, BUILDINGS, ROADS, EDGES, renderer, scene, camera,
  step(frames = 60, keys = {}) {
    Object.assign(K, keys);
    for (let i = 0; i < frames; i++) { simT += 1 / 60; update(1 / 60, simT); }
    for (const k in keys) K[k] = false;
    drawMinimap(); renderer.render(scene, camera);
    return { x: +P.x.toFixed(1), z: +P.z.toFixed(1), v: +P.v.toFixed(1), card: activeCard?.id ?? null, galiFound, surface };
  },
  look(from, to) { camOverride = from ? [from, to] : null; return this.step(1); },
  audio: () => ({ state: AC?.state, engines: ENGINES.map((e) => e.n?.kind ?? null), chatter: CHATTER.map((c) => !!c.spot) }),
};
