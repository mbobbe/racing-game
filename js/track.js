import * as THREE from '../vendor/three.module.js';

// ============================================================================
// buildWorld — everything world-related for the racing game.
// Owns: canyon-loop road, shoulders, canyon walls, valley floor, distant
// mountains, sky dome, sun sprite, fog, instanced pines + rocks, the checkered
// start line and the boost pads.
// The hub owns: cameras, lights, renderer and frame animation (the boost pads
// are pulsing by the hub via mesh.userData.pulse / phaseOffset).
// ============================================================================

// ----------------------------- config -------------------------------------

const SAMPLES = 260;                 // gameplay samples (precomputed)
const GEO_ROWS = 520;                // ribbon geometry rows (2x for smoothness)
const TRACK_WIDTH = 16;
const HALF_WIDTH = TRACK_WIDTH / 2;  // 8
const WALL_MARGIN = 5;               // shoulder depth before the wall clamp line
const ROAD_EDGE = HALF_WIDTH + WALL_MARGIN;  // 13 — outer shoulder / wall base
const WALL_DEPTH = 46;               // outward reach of the canyon walls
const WALL_SLOPE = 0.9;              // mean wall rise per unit of outward distance
const CURVE_TENSION = 0.6;           // closed CatmullRom tension (0.5 - 0.75)
const TREE_COUNT = 280;
const ROCK_COUNT = 120;
const TREES_ON_SLOPE = 245;
const ROCKS_ON_SLOPE = 90;
const ROCKS_ON_SHOULDER = 18;

// Canyon-loop control points. y = road-center elevation. The loop has a few
// genuinely straight stretches (start straight along the top edge, the north
// straight, the east/west edges) which the boost pads are placed on.
const CONTROL_POINTS = [
  new THREE.Vector3(52, 8, -244),    // P0  start straight (along +x)
  new THREE.Vector3(209, 9, -239),   // P1  end of start straight
  new THREE.Vector3(270, 12, -144),  // P2  fast sweeper (south-east corner)
  new THREE.Vector3(274, 13, 39),    // P3  straight along the east edge
  new THREE.Vector3(222, 15, 157),   // P4  long left sweeper
  new THREE.Vector3(74, 17, 213),    // P5  down into the bottom straight
  new THREE.Vector3(-117, 12, 205),  // P6  long mid straight (west)
  new THREE.Vector3(-226, 8, 148),   // P7  tight left
  new THREE.Vector3(-257, 9, -4),    // P8  straight along the west edge
  new THREE.Vector3(-218, 11, -148), // P9  corner
  new THREE.Vector3(-117, 10, -222), // P10 diagonal
  new THREE.Vector3(-22, 9, -242),   // P11 short straight back to P0
];

// ----------------------------- utilities -----------------------------------

// Deterministic PRNG — stable tree/rock/mountain placement.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap 2-input pseudo-random in [0, 1).
function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

// Circular box-blur smoothing (wraps around the closed loop).
function circularSmooth(arr, window, passes) {
  let cur = arr.slice();
  const half = Math.floor(window / 2);
  for (let p = 0; p < passes; p++) {
    const next = new Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) sum += cur[(i + k + cur.length) % cur.length];
      next[i] = sum / (2 * half + 1);
    }
    cur = next;
  }
  return cur;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTexture(canvas, anisotropy, clampWrap) {
  const t = new THREE.CanvasTexture(canvas);
  if (clampWrap) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  } else {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = anisotropy === undefined ? 8 : anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Hex color brightness jitter (f < 1 darkens, f > 1 lightens).
function shadeHex(hex, f) {
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * f));
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * f));
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * f));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ----------------------------- canvas textures -----------------------------

function makeAsphaltTexture() {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#262a2f';
  ctx.fillRect(0, 0, 512, 512);
  // large soft tonal patches
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const r = 50 + Math.random() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.55;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // speckle noise
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const v = 26 + Math.random() * 48;
    ctx.fillStyle = 'rgba(' + (v + 12) + ',' + (v + 14) + ',' + (v + 18) + ',' + (0.22 + Math.random() * 0.4) + ')';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // darker oil / moisture patches (drawn before the lines so they stay crisp)
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const r = 36 + Math.random() * 78;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(13,14,17,0.36)');
    g.addColorStop(0.55, 'rgba(13,14,17,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // thin crack polylines (jagged dark streaks)
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * 512, y = Math.random() * 512;
    let ang = Math.random() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(10,10,12,' + (0.34 + Math.random() * 0.25) + ')';
    ctx.lineWidth = 0.7 + Math.random() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 5 + (Math.random() * 8 | 0);
    for (let s2 = 0; s2 < segs; s2++) {
      ang += (Math.random() - 0.5) * 1.7;
      x += Math.cos(ang) * (9 + Math.random() * 22);
      y += Math.sin(ang) * (9 + Math.random() * 22);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // white edge lines near both sides (across-track = canvas y)
  ctx.fillStyle = '#e9e4d2';
  ctx.fillRect(0, 8, 512, 7);
  ctx.fillRect(0, 512 - 15, 512, 7);
  // worn shadow just inside the lines
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 15, 512, 3);
  ctx.fillRect(0, 512 - 18, 512, 3);
  // light center dashes along the travel direction (canvas x)
  ctx.fillStyle = '#e8c55a';
  for (let x = 0; x < 512; x += 64) ctx.fillRect(x, 253, 34, 6);
  return canvasTexture(c, 8);
}

function makeDirtTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#54452f';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 12 + Math.random() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const palette = ['rgba(60,46,28,0.5)', 'rgba(88,70,46,0.5)', 'rgba(122,102,70,0.4)'];
    g.addColorStop(0, palette[Math.floor(Math.random() * palette.length)]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const v = 40 + Math.random() * 70;
    ctx.fillStyle = 'rgba(' + (v + 20) + ',' + (v + 10) + ',' + (v - 4) + ',' + (0.15 + Math.random() * 0.35) + ')';
    ctx.fillRect(x, y, 2, 2);
  }
  // pebble dashes
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const ang = Math.random() * Math.PI;
    const len = 3 + Math.random() * 6;
    const v = 90 + Math.random() * 70;
    ctx.strokeStyle = 'rgba(' + ((v + 15) | 0) + ',' + ((v + 2) | 0) + ',' + ((v - 18) | 0) + ',' + (0.45 + Math.random() * 0.35) + ')';
    ctx.lineWidth = 1.1 + Math.random() * 1.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  // grass-tuft speckle clusters (tiny green strokes)
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const n = 3 + (Math.random() * 4 | 0);
    for (let j = 0; j < n; j++) {
      const ox = (Math.random() - 0.5) * 10, oy = (Math.random() - 0.5) * 10;
      const v = 70 + Math.random() * 60;
      ctx.strokeStyle = 'rgba(' + ((v * 0.55) | 0) + ',' + (v | 0) + ',' + ((v * 0.42) | 0) + ',' + (0.4 + Math.random() * 0.35) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + (Math.random() - 0.5) * 5, y + oy - 3 - Math.random() * 5);
      ctx.stroke();
    }
  }
  return canvasTexture(c, 8);
}

function makeRockTexture() {
  // smooth rock: layered soft tonal blotches + fine speckle. No hard band ridges
  // (those rendered as dark zigzag wedges on the canyon walls).
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#6e5a45';
  ctx.fillRect(0, 0, 512, 512);
  const tones = ['#5d4c38', '#7a6850', '#54452f', '#857460', '#6e5a45', '#7d6a55', '#69584a'];
  for (let i = 0; i < 44; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const r = 40 + Math.random() * 130;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, tones[Math.floor(Math.random() * tones.length)]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.28 + Math.random() * 0.22;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  // very faint soft horizontal striations (still smooth, no hard lines)
  for (let i = 0; i < 26; i++) {
    const yy = Math.random() * 512;
    const g = ctx.createLinearGradient(0, yy, 0, yy + 22 + Math.random() * 26);
    const dark = Math.random() < 0.6;
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, dark ? 'rgba(20,14,10,0.16)' : 'rgba(190,180,160,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, yy, 512, 60);
  }
  // fine speckle
  for (let i = 0; i < 3400; i++) {
    const x = Math.random() * 512, yy = Math.random() * 512;
    const v = 30 + Math.random() * 85;
    ctx.fillStyle = 'rgba(' + v + ',' + ((v * 0.85) | 0) + ',' + ((v * 0.7) | 0) + ',' + (0.10 + Math.random() * 0.22) + ')';
    ctx.fillRect(x, yy, 2, 2);
  }
  // subtle AO band near the wall base (bottom of canvas = v 0 = wall base)
  const ao = ctx.createLinearGradient(0, 448, 0, 512);
  ao.addColorStop(0, 'rgba(12,9,6,0)');
  ao.addColorStop(0.7, 'rgba(12,9,6,0.24)');
  ao.addColorStop(1, 'rgba(12,9,6,0.45)');
  ctx.fillStyle = ao;
  ctx.fillRect(0, 448, 512, 64);
  return canvasTexture(c, 4);
}

function makeValleyTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#3a4a28';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 8 + Math.random() * 42;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const palette = ['rgba(46,66,34,0.55)', 'rgba(58,74,40,0.55)', 'rgba(88,70,45,0.45)', 'rgba(38,56,28,0.5)'];
    g.addColorStop(0, palette[Math.floor(Math.random() * palette.length)]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const v = 40 + Math.random() * 80;
    ctx.fillStyle = 'rgba(' + ((v * 0.78) | 0) + ',' + v + ',' + ((v * 0.5) | 0) + ',' + (0.1 + Math.random() * 0.3) + ')';
    ctx.fillRect(x, y, 2, 2);
  }
  // pebble dashes (small pale strokes)
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const ang = Math.random() * Math.PI;
    const len = 3 + Math.random() * 5;
    const v = 96 + Math.random() * 70;
    ctx.strokeStyle = 'rgba(' + ((v * 0.92) | 0) + ',' + ((v * 0.85) | 0) + ',' + ((v * 0.66) | 0) + ',' + (0.4 + Math.random() * 0.3) + ')';
    ctx.lineWidth = 1 + Math.random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  // grass-tuft speckle clusters (tiny green strokes)
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const n = 3 + (Math.random() * 5 | 0);
    for (let j = 0; j < n; j++) {
      const ox = (Math.random() - 0.5) * 9, oy = (Math.random() - 0.5) * 9;
      const v = 84 + Math.random() * 66;
      ctx.strokeStyle = 'rgba(' + ((v * 0.5) | 0) + ',' + (v | 0) + ',' + ((v * 0.4) | 0) + ',' + (0.38 + Math.random() * 0.35) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + (Math.random() - 0.5) * 5, y + oy - 3 - Math.random() * 5);
      ctx.stroke();
    }
  }
  return canvasTexture(c, 4);
}

function makeSkyTexture() {
  const [c, ctx] = makeCanvas(512, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.00, '#0d1a30');
  g.addColorStop(0.20, '#1e3a5f');
  g.addColorStop(0.38, '#415e83');
  g.addColorStop(0.465, '#8ba0b3');
  g.addColorStop(0.52, '#e2cda4');
  g.addColorStop(0.58, '#cdbb98');
  g.addColorStop(0.75, '#6b6657');
  g.addColorStop(1.00, '#453f36');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // subtle haze band near the horizon (canvas y ~ 0.45–0.62)
  const haze = ctx.createLinearGradient(0, 188, 0, 330);
  haze.addColorStop(0, 'rgba(226,205,164,0)');
  haze.addColorStop(0.5, 'rgba(226,205,164,0.28)');
  haze.addColorStop(1, 'rgba(226,205,164,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 188, 512, 142);
  // soft warm glow disc in the upper area, aligned to the sun sprite's sky spot
  const sunX = 210, sunY = 158;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 95);
  glow.addColorStop(0, 'rgba(255,244,214,0.42)');
  glow.addColorStop(0.38, 'rgba(255,224,160,0.20)');
  glow.addColorStop(1, 'rgba(255,210,130,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 95, sunY - 95, 190, 190);
  return canvasTexture(c, 4);
}

function makeCloudTexture() {
  const [c, ctx] = makeCanvas(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  const streaks = 46;
  for (let i = 0; i < streaks; i++) {
    const x = Math.random() * 1024;
    const y = 55 + Math.random() * 145;
    const rx = 80 + Math.random() * 190;
    const ry = 8 + Math.random() * 24;
    const a = 0.10 + Math.random() * 0.15;
    for (const ox of [-1024, 0, 1024]) {
      ctx.save();
      ctx.translate(x + ox, y);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(238,234,224,' + a + ')');
      g.addColorStop(1, 'rgba(238,234,224,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // softer overall band fill
  const band = ctx.createLinearGradient(0, 0, 0, 256);
  band.addColorStop(0, 'rgba(238,234,224,0)');
  band.addColorStop(0.45, 'rgba(238,234,224,0.10)');
  band.addColorStop(1, 'rgba(238,234,224,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 1024, 256);
  const tex = canvasTexture(c, 4);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function makeGlowTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,250,230,1)');
  g.addColorStop(0.16, 'rgba(255,232,168,0.85)');
  g.addColorStop(0.42, 'rgba(255,208,122,0.28)');
  g.addColorStop(1, 'rgba(255,200,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return canvasTexture(c, 1, true);
}

function makeChevronTexture() {
  const [c, ctx] = makeCanvas(256, 320);
  ctx.clearRect(0, 0, 256, 320);
  ctx.fillStyle = 'rgba(255,190,70,0.10)';
  ctx.fillRect(0, 0, 256, 320);
  const ys = [62, 160, 258];
  for (const y of ys) {
    ctx.beginPath();
    ctx.moveTo(48, y - 14);
    ctx.lineTo(128, y + 34);
    ctx.lineTo(208, y - 14);
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,213,74,0.95)';
    ctx.shadowColor = 'rgba(255,205,70,0.9)';
    ctx.shadowBlur = 22;
    ctx.stroke();
  }
  // thin cyan cores
  ctx.shadowColor = 'rgba(83,233,214,0.85)';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(120,240,222,0.85)';
  for (const y of ys) {
    ctx.beginPath();
    ctx.moveTo(56, y - 10);
    ctx.lineTo(128, y + 27);
    ctx.lineTo(200, y - 10);
    ctx.stroke();
  }
  return canvasTexture(c, 4, true);
}

function makeCheckeredTexture() {
  const [c, ctx] = makeCanvas(512, 128);
  const cols = 16, rows = 4;
  const cw = 512 / cols, ch = 128 / rows;
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      ctx.fillStyle = (cx + cy) % 2 ? '#171a20' : '#ede8dd';
      ctx.fillRect(Math.floor(cx * cw), Math.floor(cy * ch), Math.ceil(cw), Math.ceil(ch));
    }
  }
  return canvasTexture(c, 8, true);
}

// ============================================================================
// buildWorld
// ============================================================================

export function buildWorld(scene) {
  const rand = mulberry32(1417);

  // ---------------- curve & samples --------------------
  const curve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, 'catmullrom', CURVE_TENSION);
  const totalLength = curve.getLength();

  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const pos = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();
    samples.push({ u: u, pos: pos, tangent: tangent, bank: 0 });
  }

  // ---------------- banking (into the turn) --------------------
  const yawsArr = samples.map((s) => Math.atan2(s.tangent.x, s.tangent.z));
  const segTurn = [];
  for (let i = 0; i < SAMPLES; i++) {
    let d = yawsArr[(i + 1) % SAMPLES] - yawsArr[i];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    segTurn.push(d);
  }
  const segLen = totalLength / SAMPLES;
  const rawBank = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const prev = segTurn[(i - 1 + SAMPLES) % SAMPLES];
    const curr = segTurn[i];
    const yawRate = (prev + curr) * 0.5 / segLen;
    // turning right (yaw increasing) -> right side lower (bank < 0)
    rawBank[i] = Math.max(-0.42, Math.min(0.42, -yawRate * 38));
  }
  const bankSmooth = circularSmooth(rawBank, 9, 2);
  for (let i = 0; i < SAMPLES; i++) samples[i].bank = bankSmooth[i];

  // ---------------- helpers (exported shape) --------------------
  function sampleAt(u) {
    let uu = u - Math.floor(u);
    if (uu < 0) uu += 1;
    const f = uu * SAMPLES;
    const i0 = Math.floor(f) % SAMPLES;
    const i1 = (i0 + 1) % SAMPLES;
    const t = f - Math.floor(f);
    const a = samples[i0], b = samples[i1];
    const pos = new THREE.Vector3().lerpVectors(a.pos, b.pos, t);
    const tangent = new THREE.Vector3().lerpVectors(a.tangent, b.tangent, t).normalize();
    const bank = a.bank + (b.bank - a.bank) * t;
    return { pos: pos, tangent: tangent, bank: bank, u: uu };
  }

  function nearestU(pos, lastU) {
    let LU = Math.round(lastU * SAMPLES) % SAMPLES;
    if (LU < 0) LU += SAMPLES;
    let bestI = -1;
    let bestD = Infinity;
    for (let k = -24; k <= 24; k++) {
      let i = (LU + k) % SAMPLES;
      if (i < 0) i += SAMPLES;
      const p = samples[i].pos;
      const d = (p.x - pos.x) * (p.x - pos.x) + (p.z - pos.z) * (p.z - pos.z);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0 || bestD > 3600) {
      bestD = Infinity; bestI = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const p = samples[i].pos;
        const d = (p.x - pos.x) * (p.x - pos.x) + (p.z - pos.z) * (p.z - pos.z);
        if (d < bestD) { bestD = d; bestI = i; }
      }
    }
    return samples[bestI].u;
  }

  function signedLateralAt(pos, u) {
    const s = sampleAt(u);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    return dx * rx + dz * rz;
  }

  function surfaceYAt(u, lat) {
    const s = sampleAt(u);
    return s.pos.y + Math.tan(s.bank) * lat;
  }

  // Horizontal right vector + surface normal for a sample.
  function surfaceNormal(tangent, bank, out) {
    const yaw = Math.atan2(tangent.x, tangent.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return out.crossVectors(tangent, new THREE.Vector3(rx, Math.tan(bank), rz)).normalize();
  }

  // Per-row silhouette wiggle for the canyon walls (smooth, deterministic, periodic
  // over the loop so the start/finish seam is seamless).
  function wiggle(i, side) {
    const w = Math.PI * 2 / SAMPLES;
    return 1.4 * Math.sin(i * w * 3 + side * 2.7) + 0.7 * Math.sin(i * w * 7 + side * 1.3);
  }

  // Per-row wall rise slope (periodic over the loop): canyon narrows become steeper.
  function slopeAt(i) {
    const w = Math.PI * 2 / SAMPLES;
    return WALL_SLOPE + 0.45 * Math.sin(i * w * 3 + 1.0) + 0.15 * Math.sin(i * w * 7 + 2.3);
  }

  // ---------------- textures --------------------
  const asphaltTex = makeAsphaltTexture();
  const dirtTex = makeDirtTexture();
  const rockTex = makeRockTexture();
  const valleyTex = makeValleyTexture();
  const skyTex = makeSkyTexture();
  const glowTex = makeGlowTexture();
  const chevronTex = makeChevronTexture();
  const checkeredTex = makeCheckeredTexture();
  const cloudTex = makeCloudTexture();
  valleyTex.repeat.set(36, 36);

  const repeats = (spacing) => Math.max(1, Math.round(totalLength / spacing));

  // ---------------- flat ribbons (road + shoulders) --------------------
  function buildFlatRibbon(lats, spacing) {
    const cols = lats.length;
    const reps = repeats(spacing);
    const rows = GEO_ROWS + 1;
    const positions = new Float32Array(rows * cols * 3);
    const normals = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    const indices = [];
    const tmpNormal = new THREE.Vector3();
    for (let i = 0; i <= GEO_ROWS; i++) {
      const u = i / GEO_ROWS;
      const s = sampleAt(u);
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      surfaceNormal(s.tangent, s.bank, tmpNormal);
      const tanB = Math.tan(s.bank);
      for (let j = 0; j < cols; j++) {
        const lat = lats[j];
        const k3 = (i * cols + j) * 3;
        positions[k3] = s.pos.x + rx * lat;
        positions[k3 + 1] = s.pos.y + tanB * lat;
        positions[k3 + 2] = s.pos.z + rz * lat;
        normals[k3] = tmpNormal.x;
        normals[k3 + 1] = tmpNormal.y;
        normals[k3 + 2] = tmpNormal.z;
        const k2 = (i * cols + j) * 2;
        uvs[k2] = u * reps;
        uvs[k2 + 1] = cols === 1 ? 0 : j / (cols - 1);
      }
    }
    for (let i = 0; i < GEO_ROWS; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = (i + 1) * cols + j;
        const c = (i + 1) * cols + j + 1;
        const d = i * cols + j + 1;
        indices.push(a, b, c, a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  const roadGeo = buildFlatRibbon([-HALF_WIDTH, HALF_WIDTH], 12);
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.94, metalness: 0.0 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  scene.add(road);

  // shoulders (both sides) — dirt, follows the same banking
  const shoulderMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, metalness: 0.0 });
  const shoulderR = new THREE.Mesh(buildFlatRibbon([HALF_WIDTH, ROAD_EDGE], 14), shoulderMat);
  const shoulderL = new THREE.Mesh(buildFlatRibbon([-ROAD_EDGE, -HALF_WIDTH], 14), shoulderMat);
  shoulderR.receiveShadow = true;
  shoulderL.receiveShadow = true;
  scene.add(shoulderR, shoulderL);

  // ---------------- canyon walls --------------------
  function buildWallGeometry(side) {
    let ds = [0, 8, 16, 26, 34, 46];
    if (side < 0) ds = ds.slice().reverse();
    const cols = ds.length;
    const reps = repeats(22);
    const rows = GEO_ROWS + 1;
    const positions = new Float32Array(rows * cols * 3);
    const normals = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    const indices = [];
    // scratch vectors for the smooth ideal-plane normal (same pattern as buildFlatRibbon)
    const scratchTangent = new THREE.Vector3();
    const scratchAcross = new THREE.Vector3();
    const scratchNormal = new THREE.Vector3();
    const scratchTowardRoad = new THREE.Vector3();
    for (let i = 0; i <= GEO_ROWS; i++) {
      const u = i / GEO_ROWS;
      const s = sampleAt(u);
      const rowIdx = Math.round(u * SAMPLES) % SAMPLES;
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const tanB = Math.tan(s.bank);
      const wig = wiggle(rowIdx, side);
      const slope = slopeAt(rowIdx);
      // Smooth ideal-plane normal: the wall is a banked plane rising outward at `slope`.
      // Deriving the normal from the jittered per-vertex positions (as computeVertexNormals
      // does) made sharp inner-curve rows flip between row-to-row facets and produce zigzag
      // dark triangles, so the normal comes from the same basis as the flat ribbons instead.
      // Row GEO_ROWS duplicates row 0 (same u), so the start/finish seam stays seamless.
      scratchTangent.copy(s.tangent);
      scratchAcross.set(rx * side, slope + tanB * side, rz * side);
      scratchNormal.crossVectors(scratchTangent, scratchAcross).normalize();
      // the normal must look back toward the road (and up from the slope) — force the sign
      scratchTowardRoad.set(-side * rx, 0, -side * rz);
      if (scratchNormal.dot(scratchTowardRoad) < 0) scratchNormal.negate();
      for (let j = 0; j < cols; j++) {
        const d0 = ds[j];
        const ramp = Math.min(1, d0 / 6);
        // smooth, deterministic per-row variation (NOT per-row random noise — that
        // produced jagged row-to-row zigzag triangles). Periodic over the loop.
        const T = Math.PI * 2;
        const distJ = ramp * (Math.sin(u * T * 3.0 + j * 2.21 + side * 1.7) * 0.9 + Math.sin(u * T * 7.3 + j * 0.9 + side * 0.4) * 0.45);
        const hg = ramp * (Math.sin(u * T * 2.7 + j * 1.63 + side * 2.3) * 1.15 + Math.sin(u * T * 9.0 + j * 2.05 + side * 0.9) * 0.5);
        const lat = side * (ROAD_EDGE + d0 + distJ);
        const y = s.pos.y + tanB * lat + d0 * slopeAt(rowIdx) + wig * ramp + hg;
        const k3 = (i * cols + j) * 3;
        positions[k3] = s.pos.x + rx * lat;
        positions[k3 + 1] = y;
        positions[k3 + 2] = s.pos.z + rz * lat;
        normals[k3] = scratchNormal.x;
        normals[k3 + 1] = scratchNormal.y;
        normals[k3 + 2] = scratchNormal.z;
        const k2 = (i * cols + j) * 2;
        uvs[k2] = u * reps;
        uvs[k2 + 1] = d0 / WALL_DEPTH;
      }
    }
    for (let i = 0; i < GEO_ROWS; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = (i + 1) * cols + j;
        const c = (i + 1) * cols + j + 1;
        const d = i * cols + j + 1;
        indices.push(a, b, c, a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  const wallMat = new THREE.MeshStandardMaterial({
    map: rockTex, roughness: 0.96, metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const wallR = new THREE.Mesh(buildWallGeometry(1), wallMat);
  const wallL = new THREE.Mesh(buildWallGeometry(-1), wallMat);
  wallR.castShadow = true;
  wallR.receiveShadow = true;
  wallL.castShadow = true;
  wallL.receiveShadow = true;
  scene.add(wallR, wallL);

  // ---------------- world center --------------------
  const centroid = new THREE.Vector3();
  for (const p of CONTROL_POINTS) centroid.add(p);
  centroid.multiplyScalar(1 / CONTROL_POINTS.length);
  const cx = centroid.x, cz = centroid.z;

  // ---------------- valley floor --------------------
  const floorGeo = new THREE.PlaneGeometry(4000, 4000);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({ map: valleyTex, roughness: 1, metalness: 0.0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);

  // ---------------- distant mountains --------------------
  const mountainPalette = [0x5d6d78, 0x66796b, 0x7d8694, 0x596b70, 0x6d7a85];
  const mountainGeo = new THREE.ConeGeometry(1, 1, 7, 1);
  const snowGeo = new THREE.ConeGeometry(1, 1, 7, 1);
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xe3e9f0, flatShading: true, roughness: 0.85, metalness: 0,
  });
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + (hash2(i, 7) - 0.5) * 0.6;
    const dist = 470 + hash2(i, 13) * 380;
    const h = 95 + hash2(i, 29) * 125;
    const r = 95 + hash2(i, 37) * 110;
    const mat = new THREE.MeshStandardMaterial({
      color: mountainPalette[i % mountainPalette.length],
      flatShading: true, roughness: 1, metalness: 0,
    });
    const m = new THREE.Mesh(mountainGeo, mat);
    m.position.set(cx + Math.cos(angle) * dist, h / 2 - 4, cz + Math.sin(angle) * dist);
    m.scale.set(r, h, r);
    m.rotation.y = hash2(i, 53) * Math.PI;
    m.castShadow = false;
    m.receiveShadow = false;
    scene.add(m);
    // snow-capped peak — a small white-ish cone seated on top of each mountain
    const capH = h * 0.45;
    const snow = new THREE.Mesh(snowGeo, snowMat);
    snow.position.set(m.position.x, h * 0.775 - 4, m.position.z);
    snow.scale.set(r * 0.5, capH, r * 0.5);
    snow.rotation.y = m.rotation.y;
    snow.castShadow = false;
    snow.receiveShadow = false;
    scene.add(snow);
  }

  // ---------------- sky dome + sun sprite --------------------
  const skyGeo = new THREE.SphereGeometry(1500, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.set(cx, 0, cz);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const sunDir = new THREE.Vector3(0.62, 0.48, 0.4).normalize();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, fog: false, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  sunSprite.position.set(cx + sunDir.x * 1300, sunDir.y * 1300, cz + sunDir.z * 1300);
  sunSprite.scale.set(760, 760, 1);
  sunSprite.frustumCulled = false;
  sunSprite.renderOrder = 10;
  scene.add(sunSprite);

  // ---------------- translucent cloud band (no per-frame animation) ------------------------
  const cloudGeo = new THREE.CylinderGeometry(1180, 1180, 170, 64, 1, true);
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex, transparent: true, opacity: 0.5,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const cloudBand = new THREE.Mesh(cloudGeo, cloudMat);
  cloudBand.position.set(cx, 235, cz);
  scene.add(cloudBand);

  // ---------------- fog (matches the horizon haze) --------------------
  scene.fog = new THREE.Fog(0xc7c1a8, 150, 850);

  // ---------------- instanced pines --------------------
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.26, 1.8, 5);
  const coneLowGeo = new THREE.ConeGeometry(1.9, 3.0, 7);
  const coneTopGeo = new THREE.ConeGeometry(1.25, 2.4, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, flatShading: true, roughness: 0.95 });
  const coneMatLow = new THREE.MeshStandardMaterial({ color: 0x22431f, flatShading: true, roughness: 0.92 });
  const coneMatTop = new THREE.MeshStandardMaterial({ color: 0x2c5230, flatShading: true, roughness: 0.9 });

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
  const lowMesh = new THREE.InstancedMesh(coneLowGeo, coneMatLow, TREE_COUNT);
  const topMesh = new THREE.InstancedMesh(coneTopGeo, coneMatTop, TREE_COUNT);
  trunkMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  lowMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  topMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  trunkMesh.castShadow = true;
  lowMesh.castShadow = true;
  topMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  lowMesh.receiveShadow = true;
  topMesh.receiveShadow = true;
  trunkMesh.frustumCulled = false;
  lowMesh.frustumCulled = false;
  topMesh.frustumCulled = false;

  const mBase = new THREE.Matrix4();
  const mTmp = new THREE.Matrix4();
  const qYaw = new THREE.Quaternion();
  const eYaw = new THREE.Euler();
  const vPos = new THREE.Vector3();
  const vScale = new THREE.Vector3();

  for (let i = 0; i < TREE_COUNT; i++) {
    const onSlope = i < TREES_ON_SLOPE;
    const u = (i + 0.15 + rand() * 0.7) / TREE_COUNT;
    const s = sampleAt(u);
    const side = i % 2 === 0 ? 1 : -1;
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const scale = 0.7 + rand() * 0.9;
    const sy = scale * (0.85 + rand() * 0.3);
    const rot = rand() * Math.PI * 2;
    if (onSlope) {
      const d = 2 + rand() * 42;
      const lat = side * (ROAD_EDGE + d);
      const rowIdx = Math.round(u * SAMPLES) % SAMPLES;
      const ramp = Math.min(1, d / 6);
      const y = s.pos.y + Math.tan(s.bank) * lat + d * slopeAt(rowIdx) + wiggle(rowIdx, side) * ramp - 0.45;
      vPos.set(s.pos.x + rx * lat, y, s.pos.z + rz * lat);
    } else {
      const d = 55 + rand() * 140;
      const lat = side * (ROAD_EDGE + d);
      vPos.set(s.pos.x + rx * lat, -0.35, s.pos.z + rz * lat);
    }
    eYaw.set(0, rot, 0);
    qYaw.setFromEuler(eYaw);
    vScale.set(scale, sy, scale);
    mBase.compose(vPos, qYaw, vScale);
    mTmp.makeTranslation(0, 0.9, 0);
    trunkMesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mBase, mTmp));
    mTmp.makeTranslation(0, 2.55, 0);
    lowMesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mBase, mTmp));
    mTmp.makeTranslation(0, 4.0, 0);
    mTmp.multiply(new THREE.Matrix4().makeScale(0.85, 0.85, 0.85));
    topMesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mBase, mTmp));
  }
  trunkMesh.instanceMatrix.needsUpdate = true;
  lowMesh.instanceMatrix.needsUpdate = true;
  topMesh.instanceMatrix.needsUpdate = true;
  scene.add(trunkMesh, lowMesh, topMesh);

  // ---------------- instanced rocks --------------------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a5a48, flatShading: true, roughness: 1, metalness: 0 });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
  rockMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.frustumCulled = false;

  for (let i = 0; i < ROCK_COUNT; i++) {
    const onSlope = i < ROCKS_ON_SLOPE;
    const onShoulder = !onSlope && i < ROCKS_ON_SLOPE + ROCKS_ON_SHOULDER;
    const side = i % 2 === 0 ? 1 : -1;
    const u = (i + 0.3 + rand() * 0.7) / ROCK_COUNT;
    const s = sampleAt(u);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const scale = 0.5 + rand() * 3.0;
    const sy = scale * (0.55 + rand() * 0.45);
    const rot = rand() * Math.PI * 2;
    let lat, y;
    if (onSlope) {
      const d = 1.5 + rand() * 40;
      lat = side * (ROAD_EDGE + d);
      const rowIdx = Math.round(u * SAMPLES) % SAMPLES;
      const ramp = Math.min(1, d / 6);
      y = s.pos.y + Math.tan(s.bank) * lat + d * slopeAt(rowIdx) + wiggle(rowIdx, side) * ramp - scale * 0.3;
    } else if (onShoulder) {
      lat = side * (HALF_WIDTH + 0.8 + rand() * 3.2);
      y = s.pos.y + Math.tan(s.bank) * lat - scale * 0.25;
    } else {
      lat = side * (ROAD_EDGE + 55 + rand() * 140);
      y = 0.45 * scale;
    }
    eYaw.set(0, rot, 0);
    qYaw.setFromEuler(eYaw);
    vScale.set(scale, sy, scale);
    vPos.set(s.pos.x + rx * lat, y, s.pos.z + rz * lat);
    mBase.compose(vPos, qYaw, vScale);
    rockMesh.setMatrixAt(i, mBase);
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  scene.add(rockMesh);

  // ---------------- instanced bushes (shoulder + wall base edges) ------------------------
  const BUSH_COUNT = 50;
  const bushGeo = new THREE.IcosahedronGeometry(1, 0);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x2a4a26, flatShading: true, roughness: 1, metalness: 0 });
  const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, BUSH_COUNT);
  bushMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  bushMesh.castShadow = true;
  bushMesh.receiveShadow = true;
  bushMesh.frustumCulled = false;
  for (let i = 0; i < BUSH_COUNT; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const u = (i + 0.2 + rand() * 0.6) / BUSH_COUNT;
    const s = sampleAt(u);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const scale = 0.5 + rand() * 1.1;
    const sy = scale * (0.55 + rand() * 0.3);
    const rowIdx = Math.round(u * SAMPLES) % SAMPLES;
    let lat, y;
    if (i % 3 === 0) {
      // shoulder edge (flat, on the dirt shoulder — same banking math as the road)
      lat = side * (HALF_WIDTH + 1.2 + rand() * 2.6);
      y = s.pos.y + Math.tan(s.bank) * lat - sy * 0.35;
    } else {
      // wall base edge (follows the slope/wiggle math like the trees)
      const d = 0.6 + rand() * 7.5;
      lat = side * (ROAD_EDGE + d);
      const ramp = Math.min(1, d / 6);
      y = s.pos.y + Math.tan(s.bank) * lat + d * slopeAt(rowIdx) + wiggle(rowIdx, side) * ramp - sy * 0.4;
    }
    eYaw.set(0, rand() * Math.PI * 2, 0);
    qYaw.setFromEuler(eYaw);
    vScale.set(scale * 1.15, sy, scale * 1.15);
    vPos.set(s.pos.x + rx * lat, y, s.pos.z + rz * lat);
    mBase.compose(vPos, qYaw, vScale);
    bushMesh.setMatrixAt(i, mBase);
  }
  bushMesh.instanceMatrix.needsUpdate = true;
  scene.add(bushMesh);

  // ---------------- guidepost pillars (shoulder edge, emissive top band) ------------------------
  const POST_COUNT = 20;
  const postGeo = new THREE.BoxGeometry(0.55, 1.7, 0.55);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6e5a45, flatShading: true, roughness: 1, metalness: 0 });
  const capGeo = new THREE.BoxGeometry(0.62, 0.22, 0.62);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x2a2118, emissive: 0xffc35a, emissiveIntensity: 1.5, roughness: 0.6, metalness: 0,
  });
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, POST_COUNT);
  const capMesh = new THREE.InstancedMesh(capGeo, capMat, POST_COUNT);
  postMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  capMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  capMesh.castShadow = false;
  capMesh.receiveShadow = false;
  postMesh.frustumCulled = false;
  capMesh.frustumCulled = false;
  for (let i = 0; i < POST_COUNT; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const u = (i + 0.5 + rand() * 0.3) / POST_COUNT;
    const s = sampleAt(u);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const lat = side * (ROAD_EDGE - 0.75);
    const y = s.pos.y + Math.tan(s.bank) * lat;
    eYaw.set(0, 0, 0);
    qYaw.setFromEuler(eYaw);
    vScale.set(1, 1, 1);
    vPos.set(s.pos.x + rx * lat, y + 0.55, s.pos.z + rz * lat);
    mBase.compose(vPos, qYaw, vScale);
    postMesh.setMatrixAt(i, mBase);
    mTmp.makeTranslation(0, 0.92, 0);
    capMesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mBase, mTmp));
  }
  postMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
  scene.add(postMesh, capMesh);

  // ---------------- checkered start line --------------------
  const s0 = samples[0];
  const startGeo = new THREE.PlaneGeometry(TRACK_WIDTH, 4);
  startGeo.rotateX(-Math.PI / 2);
  const startMat = new THREE.MeshStandardMaterial({ map: checkeredTex, roughness: 0.85, metalness: 0 });
  const startLine = new THREE.Mesh(startGeo, startMat);
  const normal0 = surfaceNormal(s0.tangent, s0.bank, new THREE.Vector3());
  const zAxis0 = s0.tangent.clone().addScaledVector(normal0, -s0.tangent.dot(normal0)).normalize();
  const xAxis0 = new THREE.Vector3().crossVectors(normal0, zAxis0).normalize();
  const startBasis = new THREE.Matrix4().makeBasis(xAxis0, normal0, zAxis0);
  startLine.quaternion.setFromRotationMatrix(startBasis);
  startLine.position.set(s0.pos.x, s0.pos.y + 0.03, s0.pos.z);
  startLine.receiveShadow = true;
  scene.add(startLine);

  // ---------------- boost pads (on the straightest sections) --------------------
  const kappa = [];
  for (let i = 0; i < SAMPLES; i++) {
    const prev = segTurn[(i - 1 + SAMPLES) % SAMPLES];
    const curr = segTurn[i];
    kappa.push(Math.abs(prev + curr) * 0.5 / segLen);
  }
  const kappaSmooth = circularSmooth(kappa, 7, 1);
  const order = samples.map((s, i) => i).sort((a, b) => kappaSmooth[a] - kappaSmooth[b]);
  const minGap = Math.floor(SAMPLES / 6 * 0.9);
  const padIdx = [];
  for (const i of order) {
    if (padIdx.length >= 6) break;
    let ok = true;
    for (const p of padIdx) {
      let d = Math.abs(p - i);
      d = Math.min(d, SAMPLES - d);
      if (d < minGap) { ok = false; break; }
    }
    if (ok) padIdx.push(i);
  }
  padIdx.sort((a, b) => a - b);

  const boostPads = [];
  const padGeo = new THREE.PlaneGeometry(8, 10);
  padGeo.rotateX(-Math.PI / 2);
  for (const idx of padIdx) {
    const u = samples[idx].u;
    const s = sampleAt(u);
    const normal = surfaceNormal(s.tangent, s.bank, new THREE.Vector3());
    const zAxis = s.tangent.clone().addScaledVector(normal, -s.tangent.dot(normal)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(normal, zAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, normal, zAxis);
    const mat = new THREE.MeshBasicMaterial({
      map: chevronTex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(padGeo, mat);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.set(s.pos.x, s.pos.y + 0.07, s.pos.z);
    mesh.userData.pulse = true;
    mesh.userData.phaseOffset = rand() * Math.PI * 2;
    scene.add(mesh);
    boostPads.push({
      u: u,
      pos: s.pos.clone(),
      yaw: Math.atan2(s.tangent.x, s.tangent.z),
      halfLength: 5,
      halfWidth: 4,
      mesh: mesh,
    });
  }

  // ---------------- start --------------------
  const startPos = samples[0].pos.clone();
  const startHeading = Math.atan2(samples[0].tangent.x, samples[0].tangent.z);

  return {
    length: totalLength,
    trackWidth: TRACK_WIDTH,
    halfWidth: HALF_WIDTH,
    wallMargin: WALL_MARGIN,
    samples: samples,
    sampleCount: SAMPLES,
    sampleAt: sampleAt,
    nearestU: nearestU,
    signedLateralAt: signedLateralAt,
    surfaceYAt: surfaceYAt,
    boostPads: boostPads,
    startPos: startPos,
    startHeading: startHeading,
  };
}
