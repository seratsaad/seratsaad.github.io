import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
const BN = "'Kohinoor Bangla','Bangla Sangam MN','Noto Sans Bengali',sans-serif";
const EN = "system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif";
const $ = (s) => document.querySelector(s);

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

/* ---------------- content ---------------- */
const IMG = '../images/';
const KIND = {
  research: { color: '#22a7b8', label: 'Research' },
  beyond: { color: '#f07a2a', label: 'Beyond research' },
  personal: { color: '#e8407f', label: 'Personal · hidden gali' },
  links: { color: '#3fae5a', label: 'Links' },
};
const STATIONS = [
  // Research Road, heading north
  { id: 'pantera', kind: 'research', x: 62, z: -60, dir: [1, 0], plaza: 10, ring: 4.5,
    sign: 'PANTERA', sub: 'Metal-rich stars', title: 'Metal-Rich Stars (PANTERA)', img: IMG + 'covers/pantera.jpg',
    text: 'High-resolution chemical abundances of metal-rich stars in the solar neighborhood, observed with APF and LBT/PEPSI. Their chemistry is a fingerprint of stars that migrated outward from the inner Galaxy.',
    links: [['../research/pantera.html', 'Read more']] },
  { id: 'binaries', kind: 'research', x: -62, z: -120, dir: [-1, 0], plaza: 10, ring: 4.5,
    sign: 'Binary Stars', sub: 'Wide pairs and close pairs', title: 'Binary Stars', img: IMG + 'covers/wide-binaries.jpg',
    text: 'From the widest pairs that test gravity to the closest ones hiding in a single spectrum. Wide binaries as a test of Newtonian gravity and MOND (Saad & Ting 2025, 2026), and 41,466 double-lined spectroscopic binaries in APOGEE DR19 (Saad & Ting 2026).',
    links: [['../research/wide-binaries.html', 'Read more']] },
  { id: 'ai', kind: 'research', x: 62, z: -180, dir: [1, 0], plaza: 10, ring: 4.5,
    sign: 'AI in Astronomy', sub: 'Agents and open tools', title: 'AI in Astronomy', img: IMG + 'covers/ai.jpg',
    text: 'Agents and open tools that measure spectra, query archives and help run a night at the telescope. Egent measures stellar equivalent widths, SkyJev helps with observing decisions, astrodata-mcp opens astronomical archives to agents, and one project measures language-model use in astro-ph papers.',
    links: [['../research/ai-astronomy.html', 'Read more']] },
  { id: 'young', kind: 'research', x: -62, z: -240, dir: [-1, 0], plaza: 10, ring: 4.5,
    sign: 'Young Stars & AGN', sub: 'Undergraduate work', title: 'Young Stars & AGN', img: IMG + 'covers/young-stars.jpg',
    text: 'From my years at Vanderbilt. Young stellar objects in SDSS-BOSS spectra (two AJ papers, 2024 and 2025) and J1430+2303, a flickering quasar and candidate supermassive black hole binary.',
    links: [['../research/undergraduate.html', 'Read more']] },
  { id: 'lbt', kind: 'research', x: 0, z: -268, dir: [0, -1], plaza: 12, ring: 5, size: [18, 12, 14],
    sign: 'LBT', sub: 'Mount Graham, Arizona', title: 'At the Telescope', img: '../pantera-spectra.png',
    text: 'Spectra for PANTERA come from PEPSI on the Large Binocular Telescope, two 8.4 m mirrors on a single mount, and from the Automated Planet Finder at Lick Observatory.',
    links: [['../research/pantera.html', 'PANTERA']] },

  // Beyond Avenue, heading east
  { id: 'writing', kind: 'beyond', x: 90, z: -62, dir: [0, -1], plaza: 10, ring: 4.5,
    sign: 'Writing', sub: 'Astrobites', title: 'Writing', img: IMG + 'covers/writing.jpg',
    text: 'Author and editor at Astrobites, summarizing new astrophysics research for a broad audience. Posts on planet engulfment, tidal disruption events and wormholes.',
    links: [['../beyond/writing.html', 'Read more']] },
  { id: 'aifun', kind: 'beyond', x: 150, z: 62, dir: [0, 1], plaza: 10, ring: 4.5,
    sign: 'AI for Fun', sub: 'PorAI · PocketMoney', title: 'AI for Fun', img: IMG + 'covers/ai-fun.jpg',
    text: 'PorAI (por-ai.com) is an AI tutor built on the Bangladeshi national curriculum. PocketMoney (trypocketmoney.com) is a money agent you text.',
    links: [['../beyond/ai.html', 'Read more']] },
  { id: 'olympiad', kind: 'beyond', x: 210, z: -62, dir: [0, -1], plaza: 10, ring: 4.5,
    sign: 'Olympiad', sub: 'IOAA', title: 'Astronomy Olympiad', img: IMG + 'covers/olympiad.jpg',
    text: 'Training the next generation of astronomers through competitive problem-solving, and mentoring students who represent Bangladesh at the International Olympiad on Astronomy and Astrophysics.',
    links: [['../beyond/olympiad.html', 'Read more']] },
  { id: 'others', kind: 'beyond', x: 270, z: 62, dir: [0, 1], plaza: 10, ring: 4.5,
    sign: 'Others', sub: 'Teaching · mentoring · quantum', title: 'Others', img: IMG + 'covers/quantum.jpg',
    text: "Quantum computing education at The Wond'ry Quantum Studio, teaching and grading at Vanderbilt, mentoring with Project SHORT, and the Pixels and Persuasion exhibit for Vanderbilt University Libraries.",
    links: [['../beyond/others.html', 'Read more']] },

  // Links Lane, heading west
  { id: 'links', kind: 'links', x: -132, z: 0, dir: [-1, 0], plaza: 10, ring: 4.5,
    sign: 'Say Hello', sub: 'CV · GitHub · Scholar', title: 'Say hello', img: '../dp.jpg',
    text: 'Ph.D. student in Astronomy at The Ohio State University, originally from Mirpur, Dhaka.',
    links: [['../Serat_Mahmud_Saad_CV.pdf', 'CV'], ['https://github.com/seratsaad', 'GitHub'],
      ['https://scholar.google.com/citations?user=8LJQ8mkAAAAJ&hl=en', 'Scholar'], ['../index.html', 'Classic site']] },

  // the hidden gali
  { id: 'mirpur', kind: 'personal', x: -70, z: 35, dir: [1, 0], ring: 3.2,
    sign: 'মিরপুর', sub: 'Home', title: 'Mirpur, Dhaka', img: IMG + 'mirpur.jpg',
    text: 'I grew up in Mirpur, a dense, loud, wonderfully chaotic neighborhood in the heart of Dhaka. The streets never sleep, and the call to prayer mixes with rickshaw bells and vendors selling jhalmuri late at night.' },
  { id: 'cadet', kind: 'personal', x: -95, z: 60, dir: [0, -1], ring: 3.2,
    sign: 'Cadet College', sub: 'Mirzapur · 2014-2020', title: 'Cadet college', img: IMG + 'cadet-college.jpg',
    text: 'In grade 7 my parents sent me to Mirzapur Cadet College, a military boarding school. Every morning at 5:30 AM we ran 4 kilometers before breakfast. The sky over Mirzapur was darker than anything in Dhaka, and I started looking up.' },
  { id: 'olympiad-years', kind: 'personal', x: -122, z: 60, dir: [0, 1], ring: 3.2,
    sign: 'Olympiad Years', sub: 'IOAA 2019 · Hungary', title: 'The Olympiad years', img: IMG + 'olympiad.jpg',
    text: 'Telling my parents I did not want to join the military was one of the hardest conversations of my life. The Astronomy Olympiad gave me purpose, mentors, lifelong friends, and the confidence to aim for something bigger.' },
  { id: 'nashville', kind: 'personal', x: -140, z: 92, dir: [-1, 0], ring: 3.2,
    sign: 'Nashville', sub: 'Vanderbilt', title: 'Nashville', img: IMG + 'vanderbilt.jpg',
    text: 'The acceptance from Vanderbilt felt unreal, and the culture shock was spectacular. I double-majored in Physics and Mathematics and found that research is problem-solving with higher stakes and longer timescales.' },
  { id: 'subha', kind: 'personal', x: -118, z: 130, dir: [0, -1], ring: 3.2,
    sign: 'Subha', sub: 'The best discovery', title: 'Subha', img: IMG + 'with-subha.jpg',
    text: 'In my sophomore year at Vanderbilt I met Subha, now my wife. In the long run, the most important discovery I have made.' },
  { id: 'family', kind: 'personal', x: -92, z: 130, dir: [0, 1], ring: 3.2,
    sign: 'Family', sub: '8,000 miles away', title: 'Family', img: IMG + 'family.jpg',
    text: 'My parents have always been at the center of my life, and my sister is still my earliest and most honest critic. I carry all of them with me, even when home is 8,000 miles away.' },
  { id: 'now', kind: 'personal', x: -63, z: 130, dir: [1, 0], ring: 3.2, off: 8.2,
    sign: 'Now', sub: 'Columbus, Ohio', title: 'Now', img: IMG + 'family2.jpg',
    text: "A Ph.D. in Astronomy at Ohio State. The 5:30 AM wake-ups are optional now. I choose to sleep in.",
    links: [['../personal.html', 'The longer version']] },
];

/* ---------------- renderer, sky and light ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#f1c79e');
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 30, 210);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 900);

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
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 300 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

/* ---------------- layout ---------------- */
const ROADS = [], PLAZAS = [], CIRCLES = [], RESERVED = [], FOOT = [];
const MAIN = 10, BRANCH = 7, GALI = 5;
function road(x1, z1, x2, z2, w, type) {
  const r = { x1, z1, x2, z2, w, type,
    minX: Math.min(x1, x2) - w / 2, maxX: Math.max(x1, x2) + w / 2,
    minZ: Math.min(z1, z2) - w / 2, maxZ: Math.max(z1, z2) + w / 2 };
  ROADS.push(r);
  return r;
}
const rect = (cx, cz, sx, sz, h = 3) => ({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h });
const overlap = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const inRect = (x, z, r, m = 0) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
function circleHitsRect(x, z, r, b) {
  const dx = x - clamp(x, b.minX, b.maxX), dz = z - clamp(z, b.minZ, b.maxZ);
  return dx * dx + dz * dz < r * r;
}

// spatial hash for everything solid
const CELL = 12, GRID = new Map(), BIG = [];
let qid = 0;
function addCollider(r) {
  if (r.maxX - r.minX > 200 || r.maxZ - r.minZ > 200) { BIG.push(r); return r; }
  for (let ix = Math.floor(r.minX / CELL); ix <= Math.floor(r.maxX / CELL); ix++)
    for (let iz = Math.floor(r.minZ / CELL); iz <= Math.floor(r.maxZ / CELL); iz++) {
      const k = ix * 10007 + iz;
      if (!GRID.has(k)) GRID.set(k, []);
      GRID.get(k).push(r);
    }
  return r;
}
function query(minX, maxX, minZ, maxZ) {
  const out = [...BIG], id = ++qid;
  for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
    for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
      const list = GRID.get(ix * 10007 + iz);
      if (list) for (const r of list) if (r._q !== id) { r._q = id; out.push(r); }
    }
  return out;
}

road(0, 12, 0, 44, MAIN, 'main');          // start
road(0, -12, 0, -256, MAIN, 'main');       // Research Road
road(12, 0, 288, 0, MAIN, 'main');         // Beyond Avenue
road(-12, 0, -122, 0, MAIN, 'main');       // Links Lane
for (const st of STATIONS) {
  if (st.kind === 'research' && st.id !== 'lbt') road(Math.sign(st.x) * 5, st.z, st.x - Math.sign(st.x) * 8, st.z, BRANCH, 'branch');
  if (st.kind === 'beyond') road(st.x, Math.sign(st.z) * 5, st.x, st.z - Math.sign(st.z) * 8, BRANCH, 'branch');
  if (st.plaza) PLAZAS.push({ x: st.x, z: st.z, r: st.plaza });
}
const GALI_PTS = [[-70, 5], [-70, 60], [-140, 60], [-140, 130], [-60, 130]];
const GALI_ROADS = [];
for (let i = 0; i < GALI_PTS.length - 1; i++) {
  const [a, b] = [GALI_PTS[i], GALI_PTS[i + 1]];
  GALI_ROADS.push(road(a[0], a[1], b[0], b[1], GALI, 'gali'));
}
const CHOWK_R = 12;
CIRCLES.push({ x: 0, z: 0, r: 5.2 });
const RIVER_X = 300;
RESERVED.push(rect(-76.3, 8.8, 5, 3));

function isFree(r, roadMargin = 1.5) {
  if (r.minX < -178 || r.maxX > RIVER_X - 2 || r.minZ < -298 || r.maxZ > 160) return false;
  for (const rd of ROADS) if (overlap(r, rd, roadMargin)) return false;
  for (const p of PLAZAS) if (circleHitsRect(p.x, p.z, p.r + 1.5, r)) return false;
  if (circleHitsRect(0, 0, CHOWK_R + 2, r)) return false;
  for (const c of query(r.minX - 1, r.maxX + 1, r.minZ - 1, r.maxZ + 1)) if (overlap(r, c, 0.3)) return false;
  for (const c of RESERVED) if (overlap(r, c, 0.5)) return false;
  return true;
}

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

const brickTex = canvasTex(256, 256, (g) => {
  g.fillStyle = '#6a3a2c'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 16; y++) for (let x = -1; x < 9; x++) {
    const c = ['#b5654a', '#a85a41', '#c0705a', '#9d5340', '#8f4a38', '#b86f52'][Math.floor(Math.random() * 6)];
    g.fillStyle = c; g.fillRect(x * 32 + (y % 2) * 16 + 1, y * 16 + 1, 30, 14);
  }
  grain(g, 256, 256, 6000, 0.25, true);
  for (let i = 0; i < 8; i++) { const x = Math.random() * 256, y = Math.random() * 256; g.fillStyle = 'rgba(60,40,30,.35)'; g.beginPath(); g.ellipse(x, y, 14 + Math.random() * 20, 8 + Math.random() * 10, 0, 0, 7); g.fill(); }
});
brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;

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
const curbTex = canvasTex(64, 8, (g) => { g.fillStyle = '#e7c53a'; g.fillRect(0, 0, 32, 8); g.fillStyle = '#26262a'; g.fillRect(32, 0, 32, 8); grain(g, 64, 8, 120, 0.4); });
curbTex.wrapS = curbTex.wrapT = THREE.RepeatWrapping;

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
// window glass is glossy and reflects the sky; walls stay matte plaster
const WINDOW_FX = WINDOW_TEX.map((t) => reliefMaps(t, 3, (v) => (v < 0.42 ? 0.12 : 0.92)));
const GROUND_FX = reliefMaps(groundTex, 4);
const ASPHALT_FX = reliefMaps(asphaltTex, 2.5, (v) => 0.75 + v * 0.25);
const BRICK_FX = reliefMaps(brickTex, 5, (v) => (v < 0.3 ? 1 : 0.7));
const TILE_FX = reliefMaps(tileTex, 4);

function signTex(title, sub, bg, fg = '#fff', w = 1024, h = 256, weather = true) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, 0, w, h * 0.06); g.fillRect(0, h * 0.94, w, h * 0.06);
    for (let x = 18; x < w; x += 46) { g.fillStyle = ['#f6c445', '#e8364f', '#1f8a5b', '#fff'][(x / 46 | 0) % 4]; g.beginPath(); g.arc(x, h * 0.03, h * 0.02, 0, 7); g.fill(); g.beginPath(); g.arc(x, h * 0.97, h * 0.02, 0, 7); g.fill(); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = h * (sub ? 0.42 : 0.55);
    const isBN = /[ঀ-৿]/.test(title);
    const font = (s) => `700 ${s}px ${isBN ? BN : EN}`;
    g.font = font(size);
    while (g.measureText(title).width > w * 0.9) { size -= 4; g.font = font(size); }
    g.fillText(title, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) { g.globalAlpha = 0.85; g.font = `500 ${h * 0.15}px ${/[ঀ-৿]/.test(sub) ? BN : EN}`; g.fillText(sub, w / 2, h * 0.78); g.globalAlpha = 1; }
    if (weather) { grain(g, w, h, w * 4, 0.12, true); grime(g, w, h, 8); }
  });
}
const SHOP_SIGNS = [
  ['চা', '#1f8a5b'], ['মিষ্টি', '#e8364f'], ['ফার্মেসী', '#1d6fb8'], ['হোটেল', '#b8321d'],
  ['মোবাইল', '#7b3fb0'], ['টেইলার্স', '#d18a1b'], ['বিরিয়ানি', '#a0242f'], ['লাইব্রেরি', '#0f7a78'],
  ['স্টোর', '#3d5a99'], ['ফটোকপি', '#c25b16'],
].map(([t, bg]) => signTex(t, null, bg, '#fff', 512, 128));
const AD_SIGNS = [
  ['কোচিং সেন্টার', 'ভর্তি চলছে', '#1d4f91'], ['রড সিমেন্ট', 'মজবুত বাড়ি', '#b3261e'],
  ['মোবাইল ব্যাংকিং', 'সহজ লেনদেন', '#d4145a'], ['চা পাতা', 'এক কাপ চা', '#1f7a3f'],
].map(([t, s, bg]) => signTex(t, s, bg, '#fff', 1024, 384));

/* ---------------- ground, roads, footpaths ---------------- */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: groundTex, normalMap: GROUND_FX.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const ROAD_Y = { main: 0.02, branch: 0.03, gali: 0.035 };
for (const rd of ROADS) {
  const sx = rd.maxX - rd.minX, sz = rd.maxZ - rd.minZ;
  const t = (rd.type === 'gali' ? brickTex : asphaltTex).clone();
  t.needsUpdate = true;
  t.repeat.set(sx / (rd.type === 'gali' ? 4 : 12), sz / (rd.type === 'gali' ? 4 : 12));
  const fx = rd.type === 'gali' ? BRICK_FX : ASPHALT_FX;
  const mat = new THREE.MeshStandardMaterial({ map: t, normalMap: cloneMap(fx.normal, t.repeat), roughnessMap: cloneMap(fx.rough, t.repeat), roughness: 1, color: rd.type === 'branch' ? '#e9e4df' : '#ffffff' });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((rd.minX + rd.maxX) / 2, ROAD_Y[rd.type], (rd.minZ + rd.maxZ) / 2);
  m.receiveShadow = true;
  scene.add(m);
}
// faded centre dashes, with gaps where the paint has worn off
{
  const pos = [];
  for (const rd of ROADS) {
    if (rd.type !== 'main') continue;
    const alongX = rd.z1 === rd.z2;
    const a = alongX ? Math.min(rd.x1, rd.x2) : Math.min(rd.z1, rd.z2);
    const b = alongX ? Math.max(rd.x1, rd.x2) : Math.max(rd.z1, rd.z2);
    for (let t = a + 3; t < b - 2; t += 7) if (rand() > 0.18) pos.push(alongX ? [t, rd.z1, 1] : [rd.x1, t, 0]);
  }
  const dashTex = canvasTex(16, 64, (g) => { g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 16, 64); for (let i = 0; i < 260; i++) { g.clearRect(Math.random() * 16, Math.random() * 64, 2, 2); } });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, 3.2), new THREE.MeshStandardMaterial({ map: dashTex, transparent: true, opacity: 0.75 }), pos.length);
  const o = new THREE.Object3D();
  pos.forEach(([x, z, rot], i) => {
    o.position.set(x, 0.04, z); o.rotation.set(-Math.PI / 2, 0, rot ? Math.PI / 2 : 0); o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  });
  im.receiveShadow = true;
  scene.add(im);
  // zebra crossing in front of the roundabout
  for (let i = -4; i <= 4; i++) {
    const z = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3), new THREE.MeshStandardMaterial({ map: dashTex, transparent: true, opacity: 0.8 }));
    z.rotation.x = -Math.PI / 2; z.position.set(i * 1.1, 0.045, 15.5); z.receiveShadow = true; scene.add(z);
  }
}
// puddles left over from the last rain
for (let i = 0; i < 18; i++) {
  const rd = pick(ROADS);
  const x = R(rd.minX + 1.5, rd.maxX - 1.5), z = R(rd.minZ + 1.5, rd.maxZ - 1.5);
  const p = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshStandardMaterial({ color: '#8a8f96', roughness: 0.04, metalness: 0.85, transparent: true, opacity: 0.5 }));
  p.rotation.x = -Math.PI / 2; p.position.set(x, 0.05, z); p.scale.set(R(0.6, 1.5), R(0.4, 0.9), 1); p.rotation.z = R(0, 3);
  p.receiveShadow = true; scene.add(p);
}
// raised footpaths with painted curbs, broken wherever another road joins
function footStrips(rd, width) {
  const alongX = rd.z1 === rd.z2;
  const a = alongX ? Math.min(rd.x1, rd.x2) : Math.min(rd.z1, rd.z2);
  const b = alongX ? Math.max(rd.x1, rd.x2) : Math.max(rd.z1, rd.z2);
  for (const side of [-1, 1]) {
    const off = rd.w / 2 + width / 2;
    let start = null;
    const flush = (end) => {
      if (start !== null && end - start > 1.5) {
        const c = (start + end) / 2, len = end - start;
        const r = alongX ? rect(c, rd.z1 + side * off, len, width) : rect(rd.x1 + side * off, c, width, len);
        r.alongX = alongX; r.side = side; FOOT.push(r);
      }
      start = null;
    };
    for (let t = a; t <= b; t += 1) {
      const piece = alongX ? rect(t + 0.5, rd.z1 + side * off, 1, width) : rect(rd.x1 + side * off, t + 0.5, width, 1);
      const ok = !ROADS.some((o) => o !== rd && overlap(piece, o, 0.3)) && !PLAZAS.some((p) => circleHitsRect(p.x, p.z, p.r + 0.3, piece))
        && !circleHitsRect(0, 0, CHOWK_R + 0.5, piece) && !RESERVED.some((r) => overlap(piece, r));
      if (ok && start === null) start = t;
      if (!ok) flush(t);
    }
    flush(b + 1);
  }
}
for (const rd of ROADS) if (rd.type === 'main') footStrips(rd, 2); else if (rd.type === 'branch') footStrips(rd, 1.5);
{
  const tops = [], curbs = [];
  for (const f of FOOT) {
    const sx = f.maxX - f.minX, sz = f.maxZ - f.minZ, cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
    const g = new THREE.BoxGeometry(sx, 0.2, sz); g.translate(cx, 0.1, cz);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 1.4, p.getZ(i) / 1.4);
    tops.push(g);
    // curb on the road side
    const cw = 0.18, edge = f.alongX ? (f.side > 0 ? f.minZ : f.maxZ) : (f.side > 0 ? f.minX : f.maxX);
    const cg = f.alongX ? new THREE.BoxGeometry(sx, 0.24, cw) : new THREE.BoxGeometry(cw, 0.24, sz);
    cg.translate(f.alongX ? cx : edge, 0.12, f.alongX ? edge : cz);
    const cu = cg.attributes.uv, cp = cg.attributes.position;
    for (let i = 0; i < cu.count; i++) cu.setXY(i, (f.alongX ? cp.getX(i) : cp.getZ(i)), cp.getY(i));
    curbs.push(cg);
  }
  const fm = new THREE.Mesh(mergeGeometries(tops), new THREE.MeshStandardMaterial({ map: tileTex, normalMap: TILE_FX.normal, roughness: 0.95 }));
  fm.receiveShadow = true; scene.add(fm);
  const cm = new THREE.Mesh(mergeGeometries(curbs), new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.8 }));
  cm.receiveShadow = true; cm.castShadow = true; scene.add(cm);
}
// open drains along the gali edges
for (const rd of GALI_ROADS) {
  const alongX = rd.z1 === rd.z2;
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? rd.maxX - rd.minX : 0.45, alongX ? 0.45 : rd.maxZ - rd.minZ), M('#2b2622', { roughness: 0.3, metalness: 0.3 }));
    d.rotation.x = -Math.PI / 2;
    d.position.set(alongX ? (rd.minX + rd.maxX) / 2 : rd.x1 + s * 2.25, 0.045, alongX ? rd.z1 + s * 2.25 : (rd.minZ + rd.maxZ) / 2);
    d.receiveShadow = true; scene.add(d);
  }
}
// plazas
for (const p of PLAZAS) {
  const t = tileTex.clone(); t.needsUpdate = true; t.repeat.set(p.r, p.r);
  const m = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48), new THREE.MeshStandardMaterial({ map: t, normalMap: cloneMap(TILE_FX.normal, t.repeat), roughness: 0.95, color: '#d8d0c4' }));
  m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.05, p.z); m.receiveShadow = true;
  scene.add(m);
}
// roundabout (chowk) with the Shapla sculpture
{
  const t = asphaltTex.clone(); t.needsUpdate = true; t.repeat.set(2, 2);
  const c = new THREE.Mesh(new THREE.CircleGeometry(CHOWK_R, 48), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  c.rotation.x = -Math.PI / 2; c.position.y = 0.045; c.receiveShadow = true; scene.add(c);
  const ct = curbTex.clone(); ct.needsUpdate = true; ct.repeat.set(16, 1);
  mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.35, 48, 1, true), new THREE.MeshStandardMaterial({ map: ct }), 0, 0.17, 0, scene);
  mesh(new THREE.CylinderGeometry(5.1, 5.1, 0.36, 40), M('#5f9a4a', { roughness: 1 }), 0, 0.18, 0, scene);
  mesh(new THREE.CylinderGeometry(1.3, 1.6, 1.6, 20), M('#e7e1d6'), 0, 1, 0, scene);
  const petalGeo = new THREE.SphereGeometry(1, 20, 12);
  for (const [n, tilt, len, y, col] of [[8, 0.5, 2.6, 2.2, '#f4efe6'], [8, 0.95, 2.0, 2.5, '#f3c3d0'], [6, 1.25, 1.4, 2.8, '#ee93ae']]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + tilt;
      const piv = new THREE.Group(); piv.position.set(0, y, 0); piv.rotation.y = a; scene.add(piv);
      const p = mesh(petalGeo, M(col, { roughness: 0.5 }), 0, Math.sin(tilt) * len * 0.5, Math.cos(tilt) * len * 0.5, piv);
      p.scale.set(0.55, 0.16, len * 0.6);
      p.rotation.x = -tilt;
    }
  }
  // flower beds on the island
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, r = R(2.2, 4.6);
    mesh(new THREE.IcosahedronGeometry(R(0.2, 0.35), 0), M(pick(['#3f7d3a', '#4f8f3f', '#e8364f', '#f6c445'])), Math.cos(a) * r, 0.45, Math.sin(a) * r, scene);
  }
}

/* ---------------- buildings (merged per window style) ---------------- */
const BUCKETS = [[], [], [], []]; // three window styles + plain
const tankPos = [], shopSigns = SHOP_SIGNS.map(() => []), adBoards = [];
const FACADES = ['#e8dcc4', '#f2e1c2', '#d9c3a5', '#e7b9a6', '#c9d8c5', '#b8cfd9', '#efd38c', '#e2a68b', '#d7d1c9', '#f0e6d8', '#c4b19a', '#9fb8ad', '#e9c7c0', '#d6b3d1', '#e3e0d8', '#cbbba0'];
const ROOF = ['#a69e92', '#9a9186', '#b2aa9e', '#8f877c'];
const _c = new THREE.Color(), _r = new THREE.Color();

// vertex colours: walls darken toward the street (dust, damp, grime), roofs are concrete
function paint(g, color, { shade = 0, roof = null } = {}) {
  const p = g.attributes.position, n = g.attributes.normal;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
  const col = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    if (roof && n.getY(i) > 0.5) _c.set(roof);
    else {
      _c.copy(base);
      if (shade) _c.multiplyScalar(1 - shade * (1 - (p.getY(i) - y0) / Math.max(0.01, y1 - y0)));
    }
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function pushBox(cx, cy, cz, sx, sy, sz, color, bucket = 3, opts = {}) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    let su = 0, sv = 0;
    if (bucket < 3 && f !== 2 && f !== 3) { su = (f < 2 ? sz : sx) / 3.2; sv = sy / 3.2; }
    for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
  }
  if (opts.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(opts.rot));
  paint(g, color, opts);
  g.translate(cx, cy, cz);
  BUCKETS[bucket].push(g);
}

// face: unit axis [fx, fz] pointing from the building toward the road, or null
function addBuilding(r, h, color, face, mainRoad = false) {
  const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, sx = r.maxX - r.minX, sz = r.maxZ - r.minZ;
  h = Math.max(3.2, Math.round(h / 3.2) * 3.2);
  r.h = h + 1;
  const style = Math.floor(rand() * 3);
  _c.set(color).offsetHSL(R(-0.02, 0.02), R(-0.05, 0.05), R(-0.05, 0.03));
  const wall = _c.getHex();
  pushBox(cx, h / 2, cz, sx, h, sz, wall, style, { shade: R(0.18, 0.32), roof: pick(ROOF) });
  addCollider(r);
  // parapet, stair house, and sometimes a tin shed on the roof
  const dark = new THREE.Color(wall).multiplyScalar(0.8).getHex();
  pushBox(cx, h + 0.45, cz, sx + 0.2, 0.9, sz + 0.2, dark, 3, { roof: '#cfc6b8' });
  pushBox(cx, h + 0.1, cz, sx - 0.3, 0.2, sz - 0.3, pick(ROOF));
  if (rand() < 0.6) pushBox(cx + R(-sx, sx) * 0.2, h + 1.3, cz + R(-sz, sz) * 0.2, 2.6, 2.6, 2.6, wall, 3, { roof: '#9a9186', shade: 0.15 });
  if (rand() < 0.2) pushBox(cx + R(-sx, sx) * 0.2, h + 1.6, cz + R(-sz, sz) * 0.2, 3.6, 0.08, 3.2, '#8d969c', 3, { rot: new THREE.Euler(0.12, 0, 0) });
  if (rand() < 0.8) tankPos.push([cx + R(-sx, sx) * 0.3, h + 0.85, cz + R(-sz, sz) * 0.3]);
  if (rand() < 0.35) tankPos.push([cx + R(-sx, sx) * 0.3, h + 0.85, cz + R(-sz, sz) * 0.3]);
  if (!face) return;
  const [fx, fz] = face;
  const wAlong = fx ? sz : sx, half = fx ? sx / 2 : sz / 2;
  const floors = Math.round(h / 3.2);
  const lighter = new THREE.Color(wall).lerp(new THREE.Color('#ffffff'), 0.35).getHex();
  const at = (along, out) => [cx + fx * (half + out) + (fx ? 0 : along), cz + fz * (half + out) + (fx ? along : 0)];
  const bays = Math.max(1, Math.floor(wAlong / 3.2));
  for (let k = 1; k < floors; k++) {
    // sunshade slabs over every row of windows
    if (style === 1) { const [x, z] = at(0, 0.25); pushBox(x, k * 3.2 + 2.75, z, fx ? 0.5 : wAlong - 0.2, 0.1, fx ? wAlong - 0.2 : 0.5, lighter); }
    for (let b = 0; b < bays; b++) {
      const along = -wAlong / 2 + 1.6 + b * 3.2;
      if ((b + k) % 2 && rand() < 0.55) {
        if (rand() < 0.3) { const [x, z] = at(along + 1.1, 0.25); pushBox(x, k * 3.2 + 2.3, z, fx ? 0.5 : 0.9, 0.55, fx ? 0.9 : 0.5, '#e9e6df'); } // AC unit
        continue;
      }
      const [bx, bz] = at(along, 0.45);
      pushBox(bx, k * 3.2 + 0.08, bz, fx ? 0.9 : 2.6, 0.16, fx ? 2.6 : 0.9, lighter);
      pushBox(bx + fx * 0.42, k * 3.2 + 0.6, bz + fz * 0.42, fx ? 0.06 : 2.6, 0.9, fx ? 2.6 : 0.06, dark, 3, { shade: 0.2 });
      if (rand() < 0.4) { // laundry on the railing
        for (let c = 0; c < 3; c++) {
          const [lx, lz] = at(along - 0.8 + c * 0.6, 0.93);
          pushBox(lx, k * 3.2 + 0.75, lz, fx ? 0.03 : 0.5, R(0.5, 0.8), fx ? 0.5 : 0.03, pick(['#d8323f', '#f6c445', '#1d6fb8', '#ffffff', '#1f8a5b', '#e88fb0', '#7b3fb0']));
        }
      }
    }
  }
  // ground floor: rolling shutters or an open shop, an awning, a sign above
  const shopW = Math.min(wAlong - 0.6, 7);
  const open = rand() < 0.45;
  { const [x, z] = at(0, 0.06); pushBox(x, 1.4, z, fx ? 0.12 : shopW, 2.8, fx ? shopW : 0.12, open ? '#3a2f28' : pick(['#7b8086', '#2f6f9f', '#a8452f', '#2e7d4f', '#8a8d90']), 3, { shade: 0.3 }); }
  if (open) for (let i = 0; i < 4; i++) { const [x, z] = at(R(-shopW, shopW) * 0.4, 0.15); pushBox(x, R(0.3, 2.2), z, 0.5, 0.4, 0.5, pick(['#e8364f', '#f6c445', '#1d6fb8', '#fff', '#6b8f3a', '#c97a2a'])); }
  if (rand() < 0.6) {
    const [x, z] = at(0, 0.65);
    pushBox(x, 2.95, z, fx ? 1.3 : shopW + 0.2, 0.05, fx ? shopW + 0.2 : 1.3, pick(['#2f6fa3', '#c2452f', '#3f8f4f', '#e0a020', '#7a3fa0']), 3,
      { rot: fx ? new THREE.Euler(0, 0, -0.35 * fx) : new THREE.Euler(0.35 * fz, 0, 0) });
  }
  if (rand() < 0.85) {
    const i = Math.floor(rand() * SHOP_SIGNS.length);
    shopSigns[i].push({ x: cx + fx * (half + 0.14), z: cz + fz * (half + 0.14), w: Math.min(wAlong - 1, 6), ry: Math.atan2(fx, fz) });
  }
  if (mainRoad && h < 22 && rand() < 0.14) adBoards.push({ x: cx, z: cz, y: h, ry: Math.atan2(fx, fz), w: Math.min(wAlong, 10) });
}

function lineRoad(rd, o) {
  const alongX = rd.z1 === rd.z2;
  const a = alongX ? Math.min(rd.x1, rd.x2) : Math.min(rd.z1, rd.z2);
  const b = alongX ? Math.max(rd.x1, rd.x2) : Math.max(rd.z1, rd.z2);
  for (const side of [-1, 1]) {
    let t = a - 4 + R(0, 3);
    while (t < b + 4) {
      const wl = R(o.w[0], o.w[1]), d = R(o.d[0], o.d[1]), h = R(o.h[0], o.h[1]);
      const off = rd.w / 2 + o.gap + d / 2;
      const c = t + wl / 2;
      const cx = alongX ? c : rd.x1 + side * off;
      const cz = alongX ? rd.z1 + side * off : c;
      const r = rect(cx, cz, alongX ? wl : d, alongX ? d : wl);
      if (isFree(r, o.gap - 0.05)) addBuilding(r, h, pick(FACADES), alongX ? [0, -side] : [-side, 0], rd.type === 'main');
      t += wl + R(0.2, o.space);
    }
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
const PERSON_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const PG = {
  leg: new THREE.BoxGeometry(0.12, 0.85, 0.13), shoe: new THREE.BoxGeometry(0.12, 0.06, 0.24),
  torso: new THREE.BoxGeometry(0.38, 0.5, 0.22), neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8),
  head: new THREE.SphereGeometry(0.12, 12, 10), hair: new THREE.SphereGeometry(0.127, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  cap: new THREE.CylinderGeometry(0.12, 0.125, 0.08, 12), arm: new THREE.BoxGeometry(0.09, 0.56, 0.09), hand: new THREE.SphereGeometry(0.05, 6, 5),
  lungi: new THREE.CylinderGeometry(0.2, 0.25, 0.6, 12), kameez: new THREE.CylinderGeometry(0.19, 0.27, 0.8, 12),
  orna: new THREE.BoxGeometry(0.44, 0.08, 0.28), braid: new THREE.BoxGeometry(0.2, 0.42, 0.08),
  stick: new THREE.CylinderGeometry(0.015, 0.015, 0.9, 4), umb: new THREE.ConeGeometry(0.6, 0.3, 10),
  basket: new THREE.CylinderGeometry(0.3, 0.2, 0.22, 10), bag: new THREE.BoxGeometry(0.24, 0.3, 0.1),
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
function buildPerson(kind = pick(['m', 'm', 'f', 'f', 'lungi', 'lungi', 'school']), scale = 1) {
  const g = new THREE.Group();
  const skin = pick(SKIN);
  let top = pick(['#efe9dc', '#9cc3e0', '#e0b0a0', '#3a5f8a', '#c94c4c', '#f2d06b', '#5d8a5a', '#ffffff', '#8a5aa8', '#e07a3a', '#d6c9a8']);
  if (kind === 'school') top = '#f4f4f0';
  const lungiCol = pick(['#2b5c8a', '#6a2a4a', '#2f4f2f', '#3b3b6b', '#7a5a2a']);
  const legCol = kind === 'f' ? pick(['#efe9dc', '#2b2f3a', '#c94c4c', '#e6c27a']) : kind === 'lungi' ? skin : kind === 'school' ? '#1f3a6b' : pick(['#2b2f3a', '#4a4038', '#1f2a44', '#6b6157']);
  const body = [[PG.torso, top, 0, 1.27, 0], [PG.neck, skin, 0, 1.55, 0], [PG.head, skin, 0, 1.66, 0]];
  if (kind === 'f') {
    body.push([PG.kameez, top, 0, 0.98, 0], [PG.orna, pick(['#e8364f', '#f6c445', '#1f8a5b', '#ff7ab8', '#ffffff']), 0, 1.42, 0.02, 0, 0.15], [PG.braid, '#15110e', 0, 1.5, -0.1]);
    body.push([PG.hair, rand() < 0.4 ? pick(['#e8364f', '#1d6fb8', '#f6c445', '#7b3fb0']) : '#15110e', 0, 1.68, -0.01]); // some wear a scarf over the hair
  } else body.push([PG.hair, '#15110e', 0, 1.68, -0.01]);
  if (kind === 'lungi') body.push([PG.lungi, lungiCol, 0, 0.62, 0]);
  if (kind === 'm' && rand() < 0.25) body.push([PG.cap, '#f2efe6', 0, 1.77, 0]); // tupi
  const extra = rand();
  if (extra < 0.12) body.push([PG.stick, '#222', 0.2, 1.9, 0.05], [PG.umb, '#1b1b1f', 0.2, 2.35, 0.05]);
  else if (extra < 0.2 && kind === 'lungi') body.push([PG.basket, '#9a7a45', 0, 1.9, 0]); // load on the head
  else if (extra < 0.32 && (kind === 'school' || kind === 'm')) body.push([PG.backpack, pick(['#1d4f91', '#b3261e', '#2f2f2f']), 0, 1.25, -0.17]);
  const bm = new THREE.Mesh(part(body), PERSON_MAT);
  bm.castShadow = true; g.add(bm);
  const hips = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.85, 0); g.add(hip);
    const m = new THREE.Mesh(part([[PG.leg, legCol, 0, -0.42, 0], [PG.shoe, kind === 'school' ? '#111' : pick(['#2a2420', '#6b4a2a', '#222']), 0, -0.84, 0.05]]), PERSON_MAT);
    m.castShadow = true; hip.add(m); hips.push(hip);
  }
  const bag = kind !== 'school' && rand() < 0.2;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.24, 1.48, 0); g.add(sh);
    const specs = [[PG.arm, kind === 'lungi' && rand() < 0.5 ? skin : top, 0, -0.26, 0], [PG.hand, skin, 0, -0.56, 0]];
    if (bag && s > 0) specs.push([PG.bag, pick(['#f2efe6', '#2f6f9f', '#d8323f']), 0, -0.72, 0]);
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
  g.fillStyle = '#fff'; g.font = `700 64px ${BN}`; g.textAlign = 'center'; g.fillText('ঢাকা', w / 2, 236);
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
  const skin = M(pick(SKIN));
  const torso = mesh(new THREE.BoxGeometry(0.4, 0.55, 0.23), M(shirt), 0, 0.38, 0.06, rider); torso.rotation.x = 0.3;
  const gam = mesh(new THREE.BoxGeometry(0.46, 0.07, 0.3), new THREE.MeshStandardMaterial({ map: gamchaTex }), 0, 0.62, 0.12, rider); gam.rotation.x = 0.3;
  mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, 0, 0.7, 0.16, rider);
  mesh(new THREE.SphereGeometry(0.14, 14, 12), skin, 0, 0.84, 0.2, rider);
  mesh(new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#15110e'), 0, 0.86, 0.19, rider);
  mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 16), new THREE.MeshStandardMaterial({ map: gamchaTex }), 0, 0.9, 0.2, rider).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.26, 12), new THREE.MeshStandardMaterial({ map: pick(LUNGI_TEX) }), 0, 0.04, 0, rider);
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.22, 0.56, 0.14); rider.add(sh);
    const tgt = new THREE.Vector3(s * 0.36, -0.01, 0.56).sub(sh.position);
    const len = tgt.length();
    sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tgt.normalize());
    mesh(new THREE.BoxGeometry(0.08, 0.08, len), skin, 0, 0, len / 2, sh);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, -0.02, 0); rider.add(hip);
    mesh(new THREE.BoxGeometry(0.11, 0.44, 0.11), new THREE.MeshStandardMaterial({ map: pick(LUNGI_TEX) }), 0, -0.22, 0, hip);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    mesh(new THREE.BoxGeometry(0.09, 0.44, 0.09), skin, 0, -0.22, 0, knee);
    mesh(new THREE.BoxGeometry(0.1, 0.04, 0.2), M('#3b2a1e'), 0, -0.45, 0.04, knee);
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
    c.fillStyle = '#7a1c1c'; c.font = `700 44px ${BN}`; c.textAlign = 'center'; c.fillText('মিরপুর - গুলিস্তান', 560, 230);
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
    c.fillStyle = '#fff'; c.font = `700 22px ${BN}`; c.textAlign = 'center'; c.fillText('আল্লাহ ভরসা', 128, 160);
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
    c.fillStyle = '#7a1c1c'; c.font = `700 30px ${BN}`; c.textAlign = 'center'; c.fillText('মায়ের দোয়া', 256, 150);
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

/* ---------------- stations ---------------- */
const loader = new THREE.TextureLoader();
const STATION_OBJS = [];
const ringGeoCache = {};
for (const st of STATIONS) {
  const personal = st.kind === 'personal';
  const [w, d, h] = st.size || (personal ? [8, 7, 7] : [14, 10, 10]);
  const off = st.off ?? ((personal ? 3.3 : st.plaza + 0.5) + d / 2);
  const [dx, dz] = st.dir;
  const g = new THREE.Group();
  g.position.set(st.x + dx * off, 0, st.z + dz * off);
  g.rotation.y = Math.atan2(-dx, -dz);
  scene.add(g);
  const kc = KIND[st.kind].color;
  const body = personal ? pick(['#f3d9b1', '#f6c1c8', '#cfe3c6', '#c9dcef', '#f2e3a6']) : st.id === 'lbt' ? '#e9e7e2' : '#f4ead8';
  const style = personal ? 0 : 1;
  const bg = paint(new THREE.BoxGeometry(w, h, d), body, { shade: 0.25, roof: '#a69e92' });
  const uv = bg.attributes.uv;
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; const s = f === 2 || f === 3 ? 0 : 1; uv.setXY(i, uv.getX(i) * s * (f < 2 ? d : w) / 3.2, uv.getY(i) * s * h / 3.2); }
  mesh(bg, new THREE.MeshStandardMaterial({ map: WINDOW_TEX[style], normalMap: WINDOW_FX[style].normal, roughnessMap: WINDOW_FX[style].rough, vertexColors: true, roughness: 1 }), 0, h / 2, 0, g);
  mesh(new THREE.BoxGeometry(w + 0.3, 0.6, d + 0.3), M(kc), 0, h + 0.3, 0, g);
  mesh(new THREE.BoxGeometry(w * 0.5, 2.8, 0.12), M('#3a2f28'), 0, 1.4, d / 2 + 0.06, g);
  for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), M(pick(['#e8364f', '#f6c445', '#1d6fb8', '#ffffff', '#6b8f3a'])), R(-w, w) * 0.2, R(0.3, 2.2), d / 2 + 0.2, g);
  const awn = mesh(new THREE.BoxGeometry(w * 0.6, 0.05, 1.4), M(kc, { roughness: 0.7 }), 0, 3.0, d / 2 + 0.6, g); awn.rotation.x = 0.3;
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.9, 0.55, 0.5), M('#e9e6df'), s * (w / 2 - 1.2), h * 0.55, d / 2 + 0.25, g);
  for (const s of [-1, 1]) { // potted plants by the door
    mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.5, 10), M('#a0522d'), s * w * 0.32, 0.25, d / 2 + 0.7, g);
    mesh(new THREE.IcosahedronGeometry(0.45, 0), M('#3f7d3a', { flatShading: true }), s * w * 0.32, 0.8, d / 2 + 0.7, g);
  }
  const signH = personal ? 1.7 : 3;
  const sign = mesh(new THREE.PlaneGeometry(w - 0.8, signH), new THREE.MeshStandardMaterial({ map: signTex(st.sign, st.sub, kc), roughness: 0.6 }), 0, h - signH / 2 - 0.6, d / 2 + 0.06, g);
  sign.castShadow = false;
  if (st.id === 'lbt') {
    for (const sx of [-4.2, 4.2]) {
      mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.3, 40), M('#2b3440', { metalness: 0.3 }), sx, 7, d / 2 + 0.2, g).rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.32, 40), M('#cfd8e2', { metalness: 0.9, roughness: 0.15 }), sx, 7, d / 2 + 0.25, g).rotation.x = Math.PI / 2;
    }
  }
  const maxW = personal ? 6.5 : 11, maxH = personal ? 4 : 6;
  const frame = mesh(new THREE.BoxGeometry(1, 1, 0.25), M('#3a2a20'), 0, h + 0.6 + maxH / 2 + 0.6, -d * 0.15, g);
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ddd' }));
  photo.position.set(0, frame.position.y, frame.position.z + 0.13);
  g.add(photo);
  for (const px of [-1, 1]) mesh(new THREE.BoxGeometry(0.2, maxH, 0.2), M('#3a2a20'), px * maxW * 0.3, h + 0.6 + maxH / 2, -d * 0.15 - 0.2, g);
  loader.load(st.img, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    const asp = t.image.width / t.image.height;
    let pw = maxH * asp, ph = maxH;
    if (pw > maxW) { pw = maxW; ph = maxW / asp; }
    photo.material = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    photo.scale.set(pw, ph, 1);
    frame.scale.set(pw + 0.5, ph + 0.5, 1);
  });
  addCollider(rect(g.position.x, g.position.z, dx ? d : w, dx ? w : d, h + maxH + 2));
  const rg = ringGeoCache[st.ring] ??= new THREE.RingGeometry(st.ring - 0.35, st.ring, 48);
  const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: kc, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(st.x, 0.07, st.z);
  scene.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(st.ring - 0.35, 40), new THREE.MeshBasicMaterial({ color: kc, transparent: true, opacity: 0.12 }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(st.x, 0.065, st.z);
  scene.add(disc);
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(personal ? 0.45 : 0.7), new THREE.MeshStandardMaterial({ color: kc, emissive: kc, emissiveIntensity: 0.6 }));
  marker.position.set(st.x, 3, st.z);
  scene.add(marker);
  STATION_OBJS.push({ st, ring, disc, marker, inside: false });
}

/* ---------------- arches and props ---------------- */
function arch(x, z, alongX, title, sub, color) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = alongX ? Math.PI / 2 : 0; scene.add(g);
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.9, 7, 0.9), M(color, { roughness: 0.6 }), s * 6, 3.5, 0, g);
    mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), M('#d8d0c0'), s * 6, 0.25, 0, g);
    addCollider(rect(x + (alongX ? 0 : s * 6), z + (alongX ? -s * 6 : 0), 0.9, 0.9, 8));
  }
  mesh(new THREE.BoxGeometry(13.4, 2.2, 0.6), M('#2a1d14'), 0, 7.4, 0, g);
  const t = signTex(title, sub, color, '#fff', 1024, 192);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 2.0), new THREE.MeshStandardMaterial({ map: t }));
    p.position.set(0, 7.4, s * 0.31); p.rotation.y = s > 0 ? 0 : Math.PI; g.add(p);
  }
}
arch(0, -24, false, 'Research Road', 'গবেষণা সড়ক', KIND.research.color);
arch(24, 0, true, 'Beyond Avenue', 'research and beyond', KIND.beyond.color);
arch(-24, 0, true, 'Links Lane', 'CV · GitHub · Scholar', KIND.links.color);

{
  const t = canvasTex(1024, 512, (g) => {
    g.fillStyle = 'rgba(255,240,210,.9)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 150px ${EN}`; g.fillText('SERAT SAAD', 512, 190);
    g.font = `500 54px ${EN}`; g.fillText('astronomer · Ohio State · from Dhaka', 512, 330);
    g.font = `600 70px ${BN}`; g.fillText('স্বাগতম', 512, 440);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2500; i++) g.fillRect(Math.random() * 1024, Math.random() * 512, 3, 3);
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 4.7), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9 }));
  p.rotation.x = -Math.PI / 2; p.position.set(0, 0.05, 24); p.receiveShadow = true; scene.add(p);
}

// small carts and stalls (jhalmuri, fruit) that make the street feel lived in
const IDLERS = [];
function cart(x, z, ry, kind = 'jhalmuri') {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  mesh(new THREE.BoxGeometry(1.6, 0.6, 0.9), M('#7a5230'), 0, 0.85, 0, g);
  for (const s of [-1, 1]) makeWheel(0.35, g, s * 0.85, 0.35, 0, 0).rotation.y = 0;
  if (kind === 'jhalmuri') {
    mesh(new THREE.BoxGeometry(1.2, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: '#cfe6f0', transparent: true, opacity: 0.45, roughness: 0.05 }), 0, 1.4, 0, g);
    for (let i = 0; i < 5; i++) mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10), M('#c9ccd0', { metalness: 0.8, roughness: 0.3 }), -0.5 + i * 0.25, 1.32, 0.15, g);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), M('#333'), 0.7, 1.8, 0, g);
    mesh(new THREE.ConeGeometry(1.1, 0.5, 8), M(pick(['#e8364f', '#1d6fb8', '#f6c445'])), 0.7, 2.6, 0, g);
  } else {
    for (let i = 0; i < 14; i++) mesh(new THREE.SphereGeometry(0.13, 8, 6), M(pick(['#f6c445', '#7fb03a', '#e8762a', '#d8323f'])), R(-0.6, 0.6), 1.2 + R(0, 0.15), R(-0.3, 0.3), g);
  }
  const v = buildPerson('lungi'); v.g.position.set(0, 0, -0.9); g.add(v.g); IDLERS.push(v);
  addCollider(rect(x, z, 2, 2, 2));
}
cart(10, -48, 0, 'jhalmuri');
cart(-9, 44 - 32, Math.PI / 2, 'fruit');
cart(72, -8, Math.PI, 'fruit');
cart(-50, 8, Math.PI, 'jhalmuri');
for (const st of STATIONS) if (st.plaza && st.id !== 'lbt') {
  const [dx, dz] = st.dir;
  cart(st.x + dz * 7.2, st.z + dx * 7.2, Math.atan2(dx, dz), rand() < 0.5 ? 'jhalmuri' : 'fruit');
}
// the cha stall that half hides the gali, with its regulars
{
  const g = new THREE.Group(); g.position.set(-76.3, 0, 8.8); scene.add(g);
  mesh(new THREE.BoxGeometry(4.2, 1.1, 2), M('#8b5a2b'), 0, 0.55, 0, g);
  for (const sx of [-2, 2]) mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), M('#5a3a1e'), sx, 1.3, -1, g);
  const awnT = canvasTex(256, 64, (c) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f2ede2' : '#c92f3c'; c.fillRect(i * 32, 0, 32, 64); } grain(c, 256, 64, 800, 0.2); });
  const a = mesh(new THREE.PlaneGeometry(4.6, 2.4), new THREE.MeshStandardMaterial({ map: awnT, side: THREE.DoubleSide }), 0, 2.7, -0.4, g);
  a.rotation.x = -Math.PI / 2 + 0.35;
  mesh(new THREE.CylinderGeometry(0.25, 0.32, 0.5, 12), M('#c9ccd0', { metalness: 0.8, roughness: 0.3 }), -1.2, 1.35, 0, g);
  for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.16, 8), M('#f5f0e6'), 0.2 + i * 0.35, 1.18, 0.3, g);
  for (let i = 0; i < 6; i++) mesh(new THREE.BoxGeometry(0.25, 0.35, 0.08), M(pick(['#f6c445', '#e8364f', '#1d6fb8'])), -1.5 + i * 0.5, 2.25, -0.95, g);
  mesh(new THREE.BoxGeometry(3, 0.12, 0.6), M('#6b4423'), 0, 0.5, -1.9, g);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), M('#5a3a1e'), s * 1.3, 0.25, -1.9, g);
  const s = mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: signTex('চা', null, '#1f8a5b', '#fff', 256, 128) }), 0, 3.4, -1.05, g);
  s.rotation.y = Math.PI;
  const owner = buildPerson('lungi'); owner.g.position.set(0, 0, 1.4); owner.g.rotation.y = Math.PI; g.add(owner.g); IDLERS.push(owner);
  for (const sx of [-0.9, 0.6]) { const p = seat(buildPerson('m'), 1.5); p.g.position.set(sx, -0.3, -1.95); p.g.rotation.y = Math.PI; g.add(p.g); IDLERS.push(p); }
  addCollider(rect(-76.3, 8.8, 4.2, 2.2, 3));
  addCollider(rect(-76.3, 6.9, 3.2, 0.8, 1.5));
  const bunt = canvasTex(512, 64, (c) => {
    c.strokeStyle = '#333'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 6); c.lineTo(512, 6); c.stroke();
    for (let i = 0; i < 16; i++) { c.fillStyle = ['#e8364f', '#f6c445', '#1f8a5b', '#1d6fb8'][i % 4]; c.beginPath(); c.moveTo(i * 32 + 2, 6); c.lineTo(i * 32 + 30, 6); c.lineTo(i * 32 + 16, 56); c.fill(); }
  });
  for (const z of [9, 16]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.75), new THREE.MeshBasicMaterial({ map: bunt, transparent: true, side: THREE.DoubleSide, alphaTest: 0.3 }));
    b.position.set(-70, 7, z); scene.add(b);
  }
}
// parked rickshaws waiting for passengers near the roundabout and the gali
for (const [x, z, ry] of [[6, 20, 0.05], [6, 23, -0.05], [-6, 30, Math.PI], [-60, -6, Math.PI / 2]]) {
  const rk = buildRickshaw(pick(['#1f8a5b', '#f6c445', '#7b3fb0', '#e8364f']), pick(['#d8323f', '#1d6fb8', '#1f8a5b']), pick(['#e4d7b8', '#9cc3e0']));
  rk.g.position.set(x, 0.2, z); rk.g.rotation.y = ry; pedal(rk, 1); scene.add(rk.g);
  addCollider(rect(x, z, 1.8, 1.8, 2));
}

/* ---------------- fill the city ---------------- */
for (const rd of ROADS) {
  if (rd.type === 'gali') lineRoad(rd, { gap: 0.6, w: [5, 9], d: [7, 11], h: [6, 14], space: 0.6 });
  else if (rd.type === 'main') lineRoad(rd, { gap: 2, w: [7, 13], d: [9, 14], h: [8, 26], space: 1.5 });
  else lineRoad(rd, { gap: 1.6, w: [6, 11], d: [8, 12], h: [6, 18], space: 1.5 });
}
for (let i = 0; i < 3500; i++) {
  const sx = R(8, 18), sz = R(8, 18);
  const r = rect(R(-176, 296), R(-296, 158), sx, sz);
  if (isFree(r, 3)) addBuilding(r, R(9, 34), pick(FACADES), null);
}
// laundry lines strung across the gali
{
  const lines = [];
  for (const rd of GALI_ROADS) {
    const alongX = rd.z1 === rd.z2;
    const a = alongX ? Math.min(rd.x1, rd.x2) : Math.min(rd.z1, rd.z2), b = alongX ? Math.max(rd.x1, rd.x2) : Math.max(rd.z1, rd.z2);
    for (let t = a + 7; t < b - 3; t += R(9, 16)) {
      const y = R(8.5, 10.5);
      for (let s = 0; s < 8; s++) {
        const u0 = s / 8, u1 = (s + 1) / 8, o0 = -3.1 + 6.2 * u0, o1 = -3.1 + 6.2 * u1;
        const y0 = y - 4 * 0.5 * u0 * (1 - u0), y1 = y - 4 * 0.5 * u1 * (1 - u1);
        lines.push(...(alongX ? [t, y0, rd.z1 + o0, t, y1, rd.z1 + o1] : [rd.x1 + o0, y0, t, rd.x1 + o1, y1, t]));
        if (s > 0 && s < 7 && rand() < 0.7) {
          const ww = R(0.4, 0.8), hh = R(0.5, 1.0);
          pushBox(alongX ? t : rd.x1 + o0, y0 - hh / 2, alongX ? rd.z1 + o0 : t, alongX ? 0.03 : ww, hh, alongX ? ww : 0.03, pick(['#d8323f', '#f6c445', '#1d6fb8', '#ffffff', '#1f8a5b', '#e88fb0', '#7b3fb0', '#f07a2a']));
        }
      }
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#2a2420' })));
}
{
  BUCKETS.forEach((list, i) => {
    if (!list.length) return;
    const mat = i < 3 ? new THREE.MeshStandardMaterial({ vertexColors: true, map: WINDOW_TEX[i], normalMap: WINDOW_FX[i].normal, roughnessMap: WINDOW_FX[i].rough, roughness: 1 }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    list.length = 0;
  });
}
{
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 16), M('#ffffff', { roughness: 0.45 }), tankPos.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  tankPos.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(rand() < 0.8 ? '#1c1c20' : '#2f5f9f')); });
  im.castShadow = true; scene.add(im);
}
SHOP_SIGNS.forEach((tex, ti) => {
  const list = shopSigns[ti];
  if (!list.length) return;
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1.25), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), list.length);
  const o = new THREE.Object3D();
  list.forEach((s, i) => { o.position.set(s.x, 3.75, s.z); o.rotation.set(0, s.ry, 0); o.scale.set(s.w, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  scene.add(im);
});
// rooftop billboards facing the main roads
for (const a of adBoards) {
  const g = new THREE.Group(); g.position.set(a.x, a.y + 0.9, a.z); g.rotation.y = a.ry; scene.add(g);
  const bw = a.w, bh = bw * 0.375;
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.15, bh + 1.5, 0.15), M('#4a4a4a', { metalness: 0.6 }), s * bw * 0.35, (bh + 1.5) / 2, 0, g);
  for (const y of [0.7, bh + 1.4]) mesh(new THREE.BoxGeometry(bw, 0.1, 0.1), M('#4a4a4a', { metalness: 0.6 }), 0, y, -0.1, g);
  mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ map: pick(AD_SIGNS), roughness: 0.6 }), 0, 1.5 + bh / 2 - 0.3, 0.1, g);
}

/* ---------------- poles, the tangle of wires, and crows ---------------- */
const PERCHES = [];
{
  const poles = [];
  const nearJunction = (v, list) => list.some((u) => Math.abs(v - u) < 7);
  const rx = STATIONS.filter((s) => s.kind === 'research').map((s) => s.z);
  const bx = STATIONS.filter((s) => s.kind === 'beyond').map((s) => s.x);
  const lines = [];
  const coils = [];
  function wire(ax, ay, az, bx2, by, bz, sag) {
    let prev = null;
    for (let s = 0; s <= 12; s++) {
      const t = s / 12;
      const p = [ax + (bx2 - ax) * t, ay + (by - ay) * t - sag * 4 * t * (1 - t), az + (bz - az) * t];
      if (prev) lines.push(...prev, ...p);
      prev = p;
    }
  }
  function run(points) {
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const n = 5 + Math.floor(rand() * 6);
      for (let k = 0; k < n; k++) {
        const sag = R(0.4, 2.0), oy = R(-0.6, 0.4), oa = R(-0.8, 0.8);
        wire(a.x + a.px * oa, 8.3 + oy, a.z + a.pz * oa, b.x + b.px * oa, 8.3 + oy, b.z + b.pz * oa, sag);
        if (k === 0) PERCHES.push({ a: [a.x + a.px * oa, 8.3 + oy, a.z + a.pz * oa], b: [b.x + b.px * oa, 8.3 + oy, b.z + b.pz * oa], sag });
      }
      for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) { // drops to the buildings, some across the road
        const across = rand() < 0.5 ? -1 : 1;
        const tx = a.x - a.px * across * R(2, 14) + a.pz * R(-4, 4), tz = a.z - a.pz * across * R(2, 14) + a.px * R(-4, 4);
        wire(a.x, 8.2 + R(-0.4, 0.3), a.z, tx, R(5, 8), tz, R(0.3, 1.4));
      }
      if (rand() < 0.6) coils.push([a.x, R(6.8, 7.8), a.z]);
    }
  }
  const research = [], beyond = [], links = [];
  for (let z = -20; z > -252; z -= 18) if (!nearJunction(z, rx)) research.push({ x: 6.4, z, px: 1, pz: 0 });
  for (let x = 30; x < 284; x += 18) if (!nearJunction(x, bx)) beyond.push({ x, z: -6.4, px: 0, pz: 1 });
  for (let x = -30; x > -120; x -= 18) if (Math.abs(x + 70) > 6) links.push({ x, z: -6.4, px: 0, pz: 1 });
  for (const list of [research, beyond, links]) { run(list); poles.push(...list); }
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.2, 9, 8), M('#8d8a84'), poles.length);
  const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.14, 0.14), M('#5c5853'), poles.length * 2);
  const coilM = new THREE.InstancedMesh(new THREE.TorusGeometry(0.45, 0.07, 6, 16), M('#1d1a18'), coils.length);
  const tf = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 10), M('#6f7378', { metalness: 0.5 }), poles.length);
  const o = new THREE.Object3D();
  let nt = 0;
  poles.forEach((p, i) => {
    o.position.set(p.x, 4.5, p.z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    for (const [k, y] of [[0, 8.4], [1, 7.6]]) { o.position.set(p.x, y, p.z); o.rotation.set(0, p.px ? 0 : Math.PI / 2, 0); o.updateMatrix(); bar.setMatrixAt(i * 2 + k, o.matrix); }
    if (i % 4 === 1) { o.position.set(p.x + p.pz * 0.45 + p.px * 0.45, 6.4, p.z); o.rotation.set(0, 0, 0); o.updateMatrix(); tf.setMatrixAt(nt++, o.matrix); }
    addCollider(rect(p.x, p.z, 0.4, 0.4, 9));
  });
  tf.count = nt;
  coils.forEach(([x, y, z], i) => { o.position.set(x + R(-0.3, 0.3), y, z + R(-0.3, 0.3)); o.rotation.set(R(-0.6, 0.6), R(0, 3), R(-0.6, 0.6)); o.updateMatrix(); coilM.setMatrixAt(i, o.matrix); });
  im.castShadow = bar.castShadow = tf.castShadow = true;
  scene.add(im, bar, coilM, tf);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#1d1a18' })));
}
const CROWS = [];
{
  const black = M('#16161a', { roughness: 0.6 });
  for (let i = 0; i < 46; i++) {
    const p = pick(PERCHES), t = R(0.15, 0.85);
    const home = new THREE.Vector3(p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] - p.sag * 4 * t * (1 - t) + 0.1, p.a[2] + (p.b[2] - p.a[2]) * t);
    const g = new THREE.Group(); g.position.copy(home); g.rotation.y = rand() < 0.5 ? 0 : Math.PI; scene.add(g);
    const b = mesh(new THREE.SphereGeometry(0.13, 8, 6), black, 0, 0.12, 0, g); b.scale.set(0.8, 0.85, 1.6);
    mesh(new THREE.SphereGeometry(0.08, 8, 6), M('#3a3a40'), 0, 0.25, 0.17, g);
    mesh(new THREE.ConeGeometry(0.03, 0.12, 5), M('#222'), 0, 0.24, 0.28, g).rotation.x = Math.PI / 2;
    const tail = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.2), black, 0, 0.1, -0.25, g); tail.rotation.x = -0.4;
    const wings = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * 0.08, 0.18, 0); g.add(piv);
      mesh(new THREE.BoxGeometry(0.35, 0.02, 0.2), black, s * 0.17, 0, 0, piv);
      piv.rotation.z = s * 1.2;
      wings.push(piv);
    }
    CROWS.push({ g, home, wings, state: 0, t: 0, vel: new THREE.Vector3(), bob: R(0, 6) });
  }
}

/* ---------------- string lights over the gali ---------------- */
{
  const bulbs = [], lines = [];
  for (const rd of GALI_ROADS) {
    const alongX = rd.z1 === rd.z2;
    const a = alongX ? Math.min(rd.x1, rd.x2) : Math.min(rd.z1, rd.z2);
    const b = alongX ? Math.max(rd.x1, rd.x2) : Math.max(rd.z1, rd.z2);
    for (let t = a + 4; t < b - 1; t += 5) {
      let prev = null;
      for (let s = 0; s <= 8; s++) {
        const u = s / 8, off = -3.2 + 6.4 * u, y = 7.2 - 0.9 * 4 * u * (1 - u);
        const p = alongX ? [t, y, rd.z1 + off] : [rd.x1 + off, y, t];
        if (prev) lines.push(...prev, ...p);
        prev = p;
        if (s > 0 && s < 8) bulbs.push(p);
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#2a2420' })));
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  const cols = ['#ffd36b', '#ff6b8b', '#7bd3ff', '#9dff8a', '#ffffff'];
  bulbs.forEach((p, i) => { o.position.set(...p); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(cols[i % cols.length])); });
  scene.add(im);
}

/* ---------------- krishnachura and rain trees ---------------- */
{
  const spots = [];
  for (let i = 0; i < 600 && spots.length < 80; i++) {
    const rd = pick(ROADS.filter((r) => r.type !== 'gali'));
    const alongX = rd.z1 === rd.z2, side = rand() < 0.5 ? -1 : 1;
    const t = R(0, 1), off = rd.w / 2 + 1.1;
    const x = alongX ? rd.x1 + (rd.x2 - rd.x1) * t : rd.x1 + side * off;
    const z = alongX ? rd.z1 + side * off : rd.z1 + (rd.z2 - rd.z1) * t;
    const r = rect(x, z, 1.4, 1.4);
    if (isFree(r, 0.4) && Math.abs(x) + Math.abs(z) > 14) { spots.push([x, z, rand() < 0.6]); addCollider(rect(x, z, 0.7, 0.7, 3.5)); }
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.38, 4.4, 8), M('#5b4636', { roughness: 1 }), spots.length * 2);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M('#ffffff', { flatShading: true, roughness: 0.9 }), spots.length * 7);
  const o = new THREE.Object3D(), c = new THREE.Color();
  spots.forEach(([x, z, flame], i) => {
    const lean = R(-0.15, 0.15), lean2 = R(-0.15, 0.15);
    o.position.set(x, 2.1, z); o.rotation.set(lean, 0, lean2); o.scale.set(1, 1, 1); o.updateMatrix(); trunk.setMatrixAt(i * 2, o.matrix);
    o.position.set(x + R(-0.6, 0.6), 4.2, z + R(-0.6, 0.6)); o.rotation.set(R(-0.8, 0.8), 0, R(-0.8, 0.8)); o.scale.set(0.6, 0.6, 0.6); o.updateMatrix(); trunk.setMatrixAt(i * 2 + 1, o.matrix);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const rr = k === 0 ? 0 : R(1, 1.8);
      o.position.set(x + Math.cos(a) * rr, 5 + R(-0.4, 0.9) + (k === 0 ? 0.6 : 0), z + Math.sin(a) * rr);
      o.rotation.set(R(0, 3), R(0, 3), 0);
      o.scale.set(R(1.2, 1.8), R(0.9, 1.3), R(1.2, 1.8)); o.updateMatrix();
      crown.setMatrixAt(i * 7 + k, o.matrix);
      const col = flame ? pick(['#d9381e', '#e8502a', '#c92e1a', '#f06a2c', '#4a7d36']) : pick(['#3f7d3a', '#4f8f3f', '#356b30', '#5c9a45']);
      crown.setColorAt(i * 7 + k, c.set(col));
    }
  });
  trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
  scene.add(trunk, crown);
}

/* ---------------- the river at the end of Beyond Avenue ---------------- */
const BOATS = [];
{
  const w = new THREE.Mesh(new THREE.PlaneGeometry(140, 700), new THREE.MeshStandardMaterial({ color: '#52777a', roughness: 0.15, metalness: 0.35 }));
  w.rotation.x = -Math.PI / 2; w.position.set(RIVER_X + 70, 0.03, -60); scene.add(w);
  for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(1.2, 0.3 + i * 0.3, 26), M('#cbbfa9'), RIVER_X + 2 - i * 1.2, 0.15 + i * 0.15, 0, scene);
  addCollider({ minX: RIVER_X, maxX: 2000, minZ: -2000, maxZ: 2000, h: 0 });
  for (const [bx, bz, ry] of [[RIVER_X + 10, -8, 0.3], [RIVER_X + 22, 14, -0.5], [RIVER_X + 35, -30, 1.2], [RIVER_X + 50, 30, 0.1]]) {
    const b = new THREE.Group(); b.position.set(bx, 0.2, bz); b.rotation.y = ry; scene.add(b);
    mesh(new THREE.BoxGeometry(1.8, 0.6, 7), M('#5e3c20'), 0, 0, 0, b);
    for (const s of [-1, 1]) { const tip = mesh(new THREE.BoxGeometry(1.2, 0.5, 2), M('#5e3c20'), 0, 0.35, s * 4, b); tip.rotation.x = s * 0.4; }
    const roof = mesh(new THREE.CylinderGeometry(1, 1, 3, 14, 1, true, 0, Math.PI), M('#c7a46a', { side: THREE.DoubleSide }), 0, 0.4, 0, b);
    roof.rotation.x = Math.PI / 2;
    const man = buildPerson('lungi'); man.g.position.set(0, 0.3, -3); b.add(man.g);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.5, 4), M('#6b4423'), 0.4, 1.4, -3.4, b).rotation.x = 0.5;
    BOATS.push({ b, ph: R(0, 6), y: 0.2 });
  }
}
addCollider({ minX: -2000, maxX: -180, minZ: -2000, maxZ: 2000, h: 0 });
addCollider({ minX: -2000, maxX: 2000, minZ: -2000, maxZ: -300, h: 0 });
addCollider({ minX: -2000, maxX: 2000, minZ: 162, maxZ: 2000, h: 0 });

/* ---------------- player ---------------- */
const START = { x: 0, z: 30, th: Math.PI };
const P = { x: START.x, z: START.z, y: 0, th: START.th, v: 0, steer: 0, wheel: 0, r: 1.05, prevV: 0 };
const player = buildRickshaw();
player.g.rotation.order = 'YXZ';
trimShadows(player.g, 0.08);
scene.add(player.g);

/* ---------------- traffic ---------------- */
const NPCS = [];
const LANES = [
  { axis: 'z', min: -250, max: -18, n: 13 },
  { axis: 'x', min: 18, max: 282, n: 13 },
  { axis: 'x', min: -116, max: -18, n: 4 },
];
for (const [li, lane] of LANES.entries()) {
  for (let i = 0; i < lane.n; i++) {
    const kind = pick(['cng', 'cng', 'cng', 'bus', 'bus', 'rick', 'rick', 'rick', 'rick', 'car', 'car', 'truck', 'bike', 'bike']);
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
    NPCS.push({ ...v, li, lane, s: lane.min + (lane.max - lane.min) * ((i + R(0, 0.6)) / lane.n), dir: rand() < 0.5 ? 1 : -1, sp: v.vmax, spin: 0, honkT: 0, turn: -1, head: 0 });
  }
}
function npcRect(n) {
  const L = n.L / 2, W = n.W / 2, s = Math.abs(Math.sin(n.head)), c = Math.abs(Math.cos(n.head));
  return rect(n.g.position.x, n.g.position.z, 2 * (s * L + c * W), 2 * (c * L + s * W));
}

/* ---------------- pedestrians ---------------- */
const WALKERS = [];
{
  const paths = [];
  for (const f of FOOT) {
    const len = f.alongX ? f.maxX - f.minX : f.maxZ - f.minZ;
    if (len < 6) continue;
    const width = f.alongX ? f.maxZ - f.minZ : f.maxX - f.minX;
    paths.push({ alongX: f.alongX, c: f.alongX ? (f.minZ + f.maxZ) / 2 : (f.minX + f.maxX) / 2, min: (f.alongX ? f.minX : f.minZ) + 0.5, max: (f.alongX ? f.maxX : f.maxZ) - 0.5, lat: width / 2 - 0.4, len, y: 0.2 });
  }
  for (const rd of GALI_ROADS) {
    const alongX = rd.z1 === rd.z2;
    paths.push({ alongX, c: alongX ? rd.z1 : rd.x1, min: (alongX ? rd.minX : rd.minZ) + 2, max: (alongX ? rd.maxX : rd.maxZ) - 2, lat: 1.8, len: 60, y: 0.035, gali: true });
  }
  const total = paths.reduce((a, p) => a + p.len, 0);
  for (let i = 0; i < 200; i++) {
    let x = rand() * total, path = paths[0];
    for (const p of paths) { if (x < p.len) { path = p; break; } x -= p.len; }
    const kid = i % 10 === 0;
    const person = kid ? buildPerson(pick(['m', 'school', 'lungi']), R(0.58, 0.7)) : buildPerson();
    scene.add(person.g);
    WALKERS.push({ ...person, path, s: R(path.min, path.max), dir: rand() < 0.5 ? 1 : -1, off: R(-path.lat, path.lat), sp: kid ? R(1.8, 2.8) : R(0.9, 1.5), cur: 0, ph: R(0, 6), pause: 0, kid });
  }
}
// people crossing the main roads wherever they like
const CROSSERS = [];
{
  const mains = ROADS.filter((r) => r.type === 'main' && Math.max(r.maxX - r.minX, r.maxZ - r.minZ) > 40);
  for (let i = 0; i < 26; i++) {
    const rd = pick(mains), alongX = rd.z1 === rd.z2;
    const a = (alongX ? Math.min(rd.x1, rd.x2) : Math.min(rd.z1, rd.z2)) + 8, b = (alongX ? Math.max(rd.x1, rd.x2) : Math.max(rd.z1, rd.z2)) - 8;
    const person = buildPerson();
    scene.add(person.g);
    const side = rand() < 0.5 ? -1 : 1;
    CROSSERS.push({ ...person, rd, alongX, s: R(a, b), side, lat: side * 6, state: 0, wait: R(0, 10), sp: R(1.0, 1.6), cur: 0, ph: R(0, 6) });
  }
}
// people standing around: chatting groups, a bus stop queue, men sitting on the curb
const STANDERS = [];
function stander(person, x, y, z, ry, collide = true) {
  person.g.position.set(x, y, z); person.g.rotation.y = ry;
  scene.add(person.g);
  STANDERS.push({ ...person, ry, ph: R(0, 10), x, z });
  if (collide) addCollider(rect(x, z, 0.5, 0.5, 1.8));
}
function group(cx, cz, y, n) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R(-0.3, 0.3), r = n === 2 ? 0.35 : 0.5;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    stander(buildPerson(), x, y, z, Math.atan2(cx - x, cz - z));
  }
}
{
  const long = FOOT.filter((f) => Math.max(f.maxX - f.minX, f.maxZ - f.minZ) > 5);
  for (let i = 0; i < 40; i++) {
    const f = pick(long);
    const x = f.alongX ? R(f.minX + 1, f.maxX - 1) : (f.minX + f.maxX) / 2, z = f.alongX ? (f.minZ + f.maxZ) / 2 : R(f.minZ + 1, f.maxZ - 1);
    if (query(x - 1, x + 1, z - 1, z + 1).some((r) => r.h > 0 && overlap(rect(x, z, 1.4, 1.4), r))) continue;
    group(x, z, 0.2, 2 + Math.floor(rand() * 3));
  }
  for (const st of STATIONS) if (st.plaza) {
    const [dx, dz] = st.dir;
    group(st.x - dz * 7, st.z - dx * 7, 0.05, 3 + Math.floor(rand() * 3));
    group(st.x + dx * 6 - dz * 4, st.z + dz * 6 - dx * 4, 0.05, 2);
  }
  // curb sitters, legs down on the road
  for (let i = 0; i < 18; i++) {
    const f = pick(long);
    const edge = f.alongX ? (f.side > 0 ? f.minZ + 0.3 : f.maxZ - 0.3) : (f.side > 0 ? f.minX + 0.3 : f.maxX - 0.3);
    const x = f.alongX ? R(f.minX + 1, f.maxX - 1) : edge, z = f.alongX ? edge : R(f.minZ + 1, f.maxZ - 1);
    const p = seat(buildPerson(pick(['m', 'lungi'])), 1.15);
    stander(p, x, -0.52, z, f.alongX ? Math.atan2(0, -f.side) : Math.atan2(-f.side, 0), false);
  }
}
// bus stop on Beyond Avenue with a queue
{
  const g = new THREE.Group(); g.position.set(40, 0.2, -6.4); scene.add(g);
  mesh(new THREE.BoxGeometry(6, 0.1, 1.6), M('#2f6f9f', { metalness: 0.4 }), 0, 2.6, 0, g);
  mesh(new THREE.BoxGeometry(6, 1.6, 0.05), new THREE.MeshStandardMaterial({ color: '#cfe6f0', transparent: true, opacity: 0.35, roughness: 0.1 }), 0, 1.6, -0.75, g);
  for (const sx of [-2.9, 2.9]) mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), M('#555', { metalness: 0.6 }), sx, 1.3, -0.7, g);
  mesh(new THREE.BoxGeometry(4, 0.08, 0.4), M('#6b4423'), 0, 0.45, -0.5, g);
  const sign = mesh(new THREE.PlaneGeometry(2.2, 0.5), new THREE.MeshStandardMaterial({ map: signTex('বাস স্টপ', null, '#1d4f91', '#fff', 512, 128) }), 0, 2.95, 0.3, g);
  sign.castShadow = false;
  addCollider(rect(40, -7.1, 6, 0.4, 2.7));
  for (let i = 0; i < 7; i++) stander(buildPerson(), 37.5 + i * 0.75 + R(-0.1, 0.1), 0.2, -6.1 + R(-0.2, 0.2), R(-0.4, 0.4) + Math.PI * 0.08);
  for (let i = 0; i < 3; i++) stander(seat(buildPerson()), 38.6 + i * 1.1, -0.45, -6.85, 0, false);
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
let AC = null, master = null, noiseBuf = null, rumbleGain = null, murmurGain = null;
function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = 0.8; master.connect(AC.destination);
  const len = AC.sampleRate * 2;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const brown = AC.createBuffer(1, len, AC.sampleRate), b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3; }
  const loop = (buf, filterType, freq, q, gain) => {
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = AC.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = AC.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(master); src.start();
    return g;
  };
  loop(brown, 'lowpass', 500, 0.7, 0.12);                  // traffic hum
  murmurGain = loop(noiseBuf, 'bandpass', 650, 0.6, 0.012); // crowd murmur
  rumbleGain = loop(brown, 'lowpass', 220, 0.7, 0);         // tyres on bricks
}
function bell() {
  if (!AC) return;
  const t0 = AC.currentTime;
  for (const dt of [0, 0.16]) for (const [f, a] of [[2350, 0.22], [3480, 0.1], [5200, 0.05]]) {
    const o = AC.createOscillator(), gn = AC.createGain();
    o.frequency.value = f; o.type = 'sine';
    gn.gain.setValueAtTime(0, t0 + dt); gn.gain.linearRampToValueAtTime(a, t0 + dt + 0.005);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.7);
    o.connect(gn).connect(master); o.start(t0 + dt); o.stop(t0 + dt + 0.75);
  }
}
function honk(vol, pitch = 1) {
  if (!AC || vol < 0.02) return;
  const t0 = AC.currentTime, len = R(0.15, 0.35), reps = rand() < 0.3 ? 2 : 1;
  for (let r = 0; r < reps; r++) for (const f of [400 * pitch, 505 * pitch]) {
    const s = t0 + r * (len + 0.08);
    const o = AC.createOscillator(), gn = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = 'square'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 1800;
    gn.gain.setValueAtTime(0, s); gn.gain.linearRampToValueAtTime(0.05 * vol, s + 0.02);
    gn.gain.setValueAtTime(0.05 * vol, s + len); gn.gain.linearRampToValueAtTime(0, s + len + 0.05);
    o.connect(lp).connect(gn).connect(master); o.start(s); o.stop(s + len + 0.1);
  }
}
function thud(vol) {
  if (!AC) return;
  const t0 = AC.currentTime, o = AC.createOscillator(), gn = AC.createGain();
  o.frequency.setValueAtTime(140, t0); o.frequency.exponentialRampToValueAtTime(50, t0 + 0.2);
  gn.gain.setValueAtTime(0.35 * vol, t0); gn.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  o.connect(gn).connect(master); o.start(t0); o.stop(t0 + 0.3);
}
function tick(vol) {
  if (!AC) return;
  const t0 = AC.currentTime, src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  src.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 3500;
  g.gain.setValueAtTime(0.05 * vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
  src.connect(f).connect(g).connect(master); src.start(t0, Math.random()); src.stop(t0 + 0.04);
}
let lastCaw = 0;
function caw(vol) {
  if (!AC || AC.currentTime - lastCaw < 1.2) return;
  lastCaw = AC.currentTime;
  for (let i = 0; i < 3; i++) {
    const t0 = AC.currentTime + i * 0.28, o = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(720, t0); o.frequency.exponentialRampToValueAtTime(460, t0 + 0.2);
    f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 3;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.09 * vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    o.connect(f).connect(g).connect(master); o.start(t0); o.stop(t0 + 0.25);
  }
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

/* ---------------- UI: card, toast, minimap ---------------- */
let activeCard = null;
function openCard(st) {
  const card = $('#card');
  card.style.setProperty('--accent', KIND[st.kind].color);
  card.querySelector('.card-kicker').textContent = KIND[st.kind].label;
  card.querySelector('.card-title').textContent = st.title;
  card.querySelector('.card-img').src = st.img || '';
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
let toastT = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200);
}

const mm = $('#minimap'), mg = mm.getContext('2d');
const MMB = { minX: -180, maxX: 310, minZ: -300, maxZ: 162 };
const mms = mm.width / (MMB.maxX - MMB.minX);
const mx = (x) => (x - MMB.minX) * mms, mz = (z) => (z - MMB.minZ) * mms;
let galiFound = false;
const visited = new Set();
function drawMinimap() {
  mg.fillStyle = 'rgba(245,228,200,.92)'; mg.fillRect(0, 0, mm.width, mm.height);
  mg.fillStyle = 'rgba(79,127,134,.8)'; mg.fillRect(mx(RIVER_X), 0, mm.width, mm.height);
  for (const rd of ROADS) {
    if (rd.type === 'gali' && !galiFound) continue;
    mg.fillStyle = rd.type === 'gali' ? '#c0705a' : '#5a5860';
    mg.fillRect(mx(rd.minX), mz(rd.minZ), Math.max(1.5, (rd.maxX - rd.minX) * mms), Math.max(1.5, (rd.maxZ - rd.minZ) * mms));
  }
  mg.fillStyle = '#5a5860'; mg.beginPath(); mg.arc(mx(0), mz(0), CHOWK_R * mms, 0, 7); mg.fill();
  for (const st of STATIONS) {
    if (st.kind === 'personal' && !galiFound) continue;
    mg.fillStyle = KIND[st.kind].color;
    mg.beginPath(); mg.arc(mx(st.x), mz(st.z), visited.has(st.id) ? 2.5 : 3.6, 0, 7); mg.fill();
    if (visited.has(st.id)) { mg.strokeStyle = KIND[st.kind].color; mg.beginPath(); mg.arc(mx(st.x), mz(st.z), 4.5, 0, 7); mg.stroke(); }
  }
  mg.save(); mg.translate(mx(P.x), mz(P.z)); mg.rotate(-P.th + Math.PI);
  mg.fillStyle = '#e8364f'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5;
  mg.beginPath(); mg.moveTo(0, -7); mg.lineTo(5, 5); mg.lineTo(0, 2.5); mg.lineTo(-5, 5); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
  mg.fillStyle = '#3b2a1e'; mg.font = `600 10px ${EN}`;
  mg.fillText(`${visited.size} / ${STATIONS.length - (galiFound ? 0 : 7)}${galiFound ? '' : ' + ?'}`, 6, mm.height - 6);
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
const surfaceAt = (x, z) => {
  for (const rd of GALI_ROADS) if (inRect(x, z, rd) && z > 5.5) return 'brick';
  for (const f of FOOT) if (inRect(x, z, f)) return 'foot';
  for (const rd of ROADS) if (inRect(x, z, rd)) return 'road';
  for (const p of PLAZAS) if (Math.hypot(x - p.x, z - p.z) < p.r) return 'road';
  if (Math.hypot(x, z) < CHOWK_R) return 'road';
  return 'dirt';
};
let lastTick = 0, surface = 'road';

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
  for (const r of query(P.x - 2, P.x + 2, P.z - 2, P.z + 2)) { const n = pushOut(r); if (n) hit(n); }
  for (const n of NPCS) { const nn = pushOut(npcRect(n)); if (nn) { hit(nn); if (n.honkT <= 0) { honk(1, n.L > 5 ? 0.75 : 1.15); n.honkT = 1.5; } } }
  for (const w of [...WALKERS, ...CROSSERS]) {
    if (!w.g.visible) continue;
    const dx = P.x - w.g.position.x, dz = P.z - w.g.position.z, d = Math.hypot(dx, dz), m = P.r + 0.35;
    if (d < m && d > 1e-4) { P.x = w.g.position.x + (dx / d) * m; P.z = w.g.position.z + (dz / d) * m; hit([dx / d, dz / d], true); w.pause = 1.5; }
  }
  for (const c of CIRCLES) {
    const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz), m = c.r + P.r;
    if (d < m) { P.x = c.x + (dx / d) * m; P.z = c.z + (dz / d) * m; hit([dx / d, dz / d]); }
  }
  P.wheel += (P.v * dt) / 0.42;
  const { g, wheels, front, body, tassels } = player;
  P.y += ((surface === 'foot' ? 0.2 : 0) - P.y) * Math.min(1, 14 * dt);
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
  if (rumbleGain) rumbleGain.gain.value = Math.min(0.5, Math.abs(P.v) * 0.025 * (rough - 0.3));

  for (const rd of GALI_ROADS) {
    if (!galiFound && P.z > 7 && inRect(P.x, P.z, rd)) {
      galiFound = true;
      toast('You found the hidden gali · the personal side of things');
      bell();
    }
  }
}

function updateNPCs(dt) {
  for (const n of NPCS) {
    const near = Math.hypot(P.x - n.g.position.x, P.z - n.g.position.z);
    const ax = n.lane.axis;
    const fwd = ax === 'z' ? [0, n.dir] : [n.dir, 0];
    const left = [fwd[1], -fwd[0]];
    let target = n.vmax;
    if (n.turn < 0) {
      for (const o of NPCS) {
        if (o === n || o.li !== n.li || o.dir !== n.dir || o.turn >= 0) continue;
        const ahead = (o.s - n.s) * n.dir;
        if (ahead > 0 && ahead < (n.L + o.L) / 2 + 3) target = Math.min(target, ahead < (n.L + o.L) / 2 + 1 ? 0 : o.sp);
      }
    }
    const hf = [Math.sin(n.head), Math.cos(n.head)], hl = [hf[1], -hf[0]];
    const px = P.x - n.g.position.x, pz = P.z - n.g.position.z;
    const along = px * hf[0] + pz * hf[1], lat = px * hl[0] + pz * hl[1];
    if (along > 0 && along < n.L / 2 + 5 && Math.abs(lat) < n.W / 2 + 1.3) {
      target = 0;
      if (n.honkT <= 0) { honk(1 / (1 + near / 12), n.L > 5 ? 0.75 : 1.15); n.honkT = R(1.2, 2.5); }
    }
    if (near < 90) for (const c of CROSSERS) {
      if (c.state !== 1) continue;
      const qx = c.g.position.x - n.g.position.x, qz = c.g.position.z - n.g.position.z;
      const ca = qx * hf[0] + qz * hf[1], cl = qx * hl[0] + qz * hl[1];
      if (ca > 0 && ca < n.L / 2 + 4 && Math.abs(cl) < n.W / 2 + 0.8) {
        target = 0;
        if (n.honkT <= 0) { honk(0.6 / (1 + near / 12), n.L > 5 ? 0.75 : 1.15); n.honkT = R(1.5, 3); }
      }
    }
    n.honkT -= dt;
    n.sp += (target - n.sp) * Math.min(1, 3 * dt);
    const LO = 2.5;
    if (n.turn >= 0) {
      // U-turn on a half circle across the road
      n.turn += (Math.max(n.sp, 1.5) * dt) / (Math.PI * LO);
      const u = Math.min(1, n.turn);
      const al = n.s + n.dir * LO * Math.sin(Math.PI * u), la = LO * Math.cos(Math.PI * u);
      const dAl = n.dir * Math.cos(Math.PI * u), dLa = -Math.sin(Math.PI * u);
      const x = ax === 'z' ? left[0] * la : al, z = ax === 'z' ? al : left[1] * la;
      n.g.position.set(x, 0, z);
      const vx = ax === 'z' ? left[0] * dLa : dAl, vz = ax === 'z' ? dAl : left[1] * dLa;
      n.head = Math.atan2(vx, vz);
      if (u >= 1) { n.turn = -1; n.dir = -n.dir; }
    } else {
      n.s += n.dir * n.sp * dt;
      if ((n.dir > 0 && n.s > n.lane.max) || (n.dir < 0 && n.s < n.lane.min)) { n.s = n.dir > 0 ? n.lane.max : n.lane.min; n.turn = 0; }
      if (ax === 'z') n.g.position.set(left[0] * LO, 0, n.s);
      else n.g.position.set(n.s, 0, left[1] * LO);
      n.head = Math.atan2(fwd[0], fwd[1]);
    }
    n.g.rotation.y = n.head;
    n.g.visible = near < 140;
    if (!n.g.visible) continue;
    n.spin += (n.sp * dt) / 0.35;
    for (const w of n.wheels) w.rotation.x = n.spin;
    if (n.rick) pedal(n.rick, n.spin * 0.7);
    else n.g.rotation.z = Math.sin(n.spin * 0.3) * 0.006 * Math.min(1, n.sp);
  }
  if (AC && rand() < dt * 0.35) { const n = pick(NPCS); honk(0.25 / (1 + Math.hypot(P.x - n.g.position.x, P.z - n.g.position.z) / 30), R(0.8, 1.3)); }
}

function updateWalkers(dt, t) {
  let crowd = 0;
  for (const w of WALKERS) {
    const { path } = w;
    const dx = P.x - w.g.position.x, dz = P.z - w.g.position.z, d = Math.hypot(dx, dz);
    w.g.visible = d < 75;
    if (!w.g.visible) continue;
    if (d < 25) crowd++;
    // stop when the rickshaw comes close, step aside, and sometimes pause to chat
    const fx = path.alongX ? w.dir : 0, fz = path.alongX ? 0 : w.dir;
    const ahead = dx * fx + dz * fz;
    let target = w.sp;
    if (d < 3.2 && ahead > -0.5) target = 0;
    if (w.pause > 0) { w.pause -= dt; target = 0; }
    else if (rand() < dt * 0.03) w.pause = R(1, 4);
    if (rand() < dt * (w.kid ? 0.15 : 0.01)) w.dir = -w.dir;
    w.cur += (target - w.cur) * Math.min(1, 5 * dt);
    w.s += w.dir * w.cur * dt;
    if (w.s > path.max) { w.s = path.max; w.dir = -1; }
    if (w.s < path.min) { w.s = path.min; w.dir = 1; }
    if (d < 2.5) w.off += clamp(-(path.alongX ? dz : dx), -1, 1) * dt * 1.5;
    w.off = clamp(w.off, -path.lat, path.lat);
    const x = path.alongX ? w.s : path.c + w.off, z = path.alongX ? path.c + w.off : w.s;
    w.g.position.set(x, path.y, z);
    w.g.rotation.y = Math.atan2(fx, fz);
    w.ph += w.cur * dt * 5;
    const sw = Math.sin(w.ph) * 0.5 * Math.min(1, w.cur);
    w.hips[0].rotation.x = sw; w.hips[1].rotation.x = -sw;
    w.arms[0].rotation.x = -sw * 0.8; w.arms[1].rotation.x = sw * 0.8;
    w.g.position.y += Math.abs(Math.sin(w.ph)) * 0.03 * Math.min(1, w.cur);
  }
  for (const c of CROSSERS) {
    const { rd, alongX } = c;
    const cx = alongX ? c.s : rd.x1 + c.lat, cz = alongX ? rd.z1 + c.lat : c.s;
    const d = Math.hypot(P.x - cx, P.z - cz);
    c.g.visible = d < 75;
    let target = 0;
    if (c.state === 0) { c.wait -= dt; if (c.wait <= 0) c.state = 1; }
    if (c.state === 1) {
      target = c.sp;
      // hesitate when the rickshaw comes close; traffic stops for them
      if (d < 3.5) target = 0;
      c.lat -= c.side * c.cur * dt;
      if (c.lat * c.side <= -6) { c.lat = -c.side * 6; c.side = -c.side; c.state = 0; c.wait = R(5, 18); }
    }
    c.cur += (target - c.cur) * Math.min(1, 5 * dt);
    if (!c.g.visible) continue;
    const y = Math.abs(c.lat) > 5 ? 0.2 : 0.03;
    c.g.position.set(cx, y, cz);
    c.g.rotation.y = c.state === 1 ? (alongX ? Math.atan2(0, -c.side) : Math.atan2(-c.side, 0)) : (alongX ? Math.atan2(0, -c.side) : Math.atan2(-c.side, 0)) + Math.sin(t * 0.4 + c.ph) * 0.8;
    c.ph += c.cur * dt * 5;
    const sw = Math.sin(c.ph) * 0.5 * Math.min(1, c.cur);
    c.hips[0].rotation.x = sw; c.hips[1].rotation.x = -sw;
    c.arms[0].rotation.x = -sw * 0.8; c.arms[1].rotation.x = sw * 0.8;
    if (d < 25) crowd++;
  }
  for (const p of STANDERS) {
    const d = Math.abs(P.x - p.x) + Math.abs(P.z - p.z);
    p.g.visible = d < 90;
    if (!p.g.visible) continue;
    if (d < 30) crowd++;
    // shift weight, look around, talk with the hands
    p.g.rotation.z = Math.sin(t * 0.7 + p.ph) * 0.02;
    p.g.rotation.y = p.ry + Math.sin(t * 0.3 + p.ph * 2) * 0.25;
    if (p.hips[0].rotation.x === 0 || Math.abs(p.hips[0].rotation.x) < 0.5) {
      const talk = Math.max(0, Math.sin(t * 0.5 + p.ph));
      p.arms[p.ph > 5 ? 0 : 1].rotation.x = -talk * (0.6 + Math.sin(t * 6 + p.ph) * 0.25);
    }
  }
  for (const p of IDLERS) { p.g.rotation.z = Math.sin(t * 0.8 + p.g.id) * 0.02; }
  if (murmurGain) murmurGain.gain.value = 0.006 + Math.min(0.04, crowd * 0.0015);
}

function updateCrows(dt, t) {
  for (const c of CROWS) {
    const d = Math.hypot(P.x - c.home.x, P.z - c.home.z);
    if (c.state === 0) {
      if (d < 9 && Math.abs(P.v) > 1.5) {
        c.state = 1; c.t = 0;
        c.vel.set(R(-1, 1), R(3.5, 5), R(-1, 1)).normalize().multiplyScalar(R(5, 7));
        caw(1 / (1 + d / 10));
      }
      c.g.rotation.x = Math.sin(t * 3 + c.bob) > 0.95 ? 0.4 : 0;
      for (const [i, w] of c.wings.entries()) w.rotation.z = (i ? 1 : -1) * 1.2;
    } else {
      c.t += dt;
      if (c.state === 1) {
        c.vel.y += (0.6 - c.vel.y) * dt;
        c.g.position.addScaledVector(c.vel, dt);
        if (c.t > 4 && d > 14) { c.state = 2; c.t = 0; }
      } else {
        const to = c.home.clone().sub(c.g.position);
        const dist = to.length();
        if (dist < 0.2) { c.state = 0; c.g.position.copy(c.home); continue; }
        c.vel.lerp(to.normalize().multiplyScalar(Math.min(6, dist * 1.5 + 0.5)), Math.min(1, 3 * dt));
        c.g.position.addScaledVector(c.vel, dt);
      }
      c.g.rotation.y = Math.atan2(c.vel.x, c.vel.z);
      c.g.rotation.x = 0;
      const flap = Math.sin(t * 22 + c.bob) * 0.9;
      c.wings[0].rotation.z = flap; c.wings[1].rotation.z = -flap;
    }
  }
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

function updateStations(t) {
  for (const s of STATION_OBJS) {
    const { st } = s;
    const d = Math.hypot(P.x - st.x, P.z - st.z);
    const inside = d < st.ring;
    s.marker.rotation.y = t * 1.5;
    s.marker.position.y = 3 + Math.sin(t * 2 + st.x) * 0.3 + (inside ? 0.6 : 0);
    s.ring.material.opacity = inside ? 1 : 0.6 + Math.sin(t * 3) * 0.2;
    s.disc.material.opacity = inside ? 0.35 : 0.12;
    if (inside && !s.inside) {
      openCard(st);
      if (!visited.has(st.id)) { visited.add(st.id); bell(); }
    }
    if (!inside && s.inside && activeCard === st) closeCard();
    s.inside = inside;
  }
  for (const b of BOATS) { b.b.position.y = b.y + Math.sin(t * 1.2 + b.ph) * 0.06; b.b.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.03; }
}

// keep the camera out of buildings: march from the rickshaw toward the camera
function clearance(from, to) {
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
    for (const r of query(x, x, z, z)) if (r.h > 0 && y < r.h + 0.3 && inRect(x, z, r, 0.4)) return Math.max(0.2, (i - 1.5) / steps);
  }
  return 1;
}
const camPos = new THREE.Vector3(0, 8, 46), camLook = new THREE.Vector3(0, 1, 20);
const _from = new THREE.Vector3(), _to = new THREE.Vector3();
let camYaw = START.th;
camera.position.copy(camPos);
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
  updateCrows(dt, t);
  updateParticles(dt);
  updateStations(t);
  updateCamera(dt);
}
/* ---------------- post-processing: ambient occlusion, bloom, smoggy colour grade ---------------- */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(Math.min(devicePixelRatio, 2));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.blendIntensity = 1.0;
gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2.5, scale: 1.3, samples: 12 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
composer.addPass(gtao);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.9));
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c *= vec3(1.04, 1.0, 0.92);                       // warm afternoon smog
      c = (c - 0.5) * 1.07 + 0.5;                        // a little contrast
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.06);
      c = mix(c, vec3(0.93, 0.84, 0.72), 0.04);          // haze lifts the blacks
      vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.6;    // vignette
      c += (hash(vUv * 1024.0 + fract(time)) - 0.5) * 0.03; // film grain
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);
let fxOn = true, fpsT = 0, fpsN = 0, fpsChecked = false;
function setFx(on, msg) { fxOn = on; gtao.enabled = on; if (msg) toast(msg); }
addEventListener('keydown', (e) => { if (e.code === 'KeyQ' && started && !e.repeat) setFx(!fxOn, fxOn ? 'Low quality mode (Q)' : 'High quality mode (Q)'); });
function render(t) {
  grade.uniforms.time.value = t;
  composer.render();
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt, clock.elapsedTime);
  drawMinimap();
  render(clock.elapsedTime);
  // drop ambient occlusion on slow machines
  if (started && !fpsChecked) {
    fpsT += dt; fpsN++;
    if (fpsT > 4) { fpsChecked = true; if (fpsN / fpsT < 28) setFx(false, 'Switched to low quality for smoother riding (Q to change)'); }
  }
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
frame();

// debug hook: advance the simulation without relying on requestAnimationFrame
let simT = 0;
window.__game = {
  P, K, STATIONS, NPCS, WALKERS, CROSSERS, STANDERS, renderer, scene, camera, setFx,
  step(frames = 60, keys = {}) {
    Object.assign(K, keys);
    for (let i = 0; i < frames; i++) { simT += 1 / 60; update(1 / 60, simT); }
    for (const k in keys) K[k] = false;
    drawMinimap(); render(simT);
    return { x: +P.x.toFixed(1), z: +P.z.toFixed(1), v: +P.v.toFixed(1), card: activeCard?.id ?? null, galiFound, surface };
  },
};
