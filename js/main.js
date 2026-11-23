// Main — bootstrap + game loop + state machine.
// Owns renderer, scene, camera, lights, game loop, input, audio, effects wiring.
// The track/world is built by js/track.js (buildWorld).

import * as THREE from '../vendor/three.module.js';
import { buildWorld } from './track.js';
import { createInput } from './input.js';
import {
  createCarMesh, createCar, resetCar, stepCar, applyCarMesh,
  rearWheelPositions, CAR_PHYSICS,
} from './car.js';
import { createEffects } from './effects.js';
import { stepAI, resolveOverlaps } from './ai.js';
import { createHUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { clamp, damp } from './util.js';

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 2200);

// ------------------------------------------------------------------
// World
// ------------------------------------------------------------------
const world = buildWorld(scene);

// ------------------------------------------------------------------
// Lights (world provides sky/fog/meshes but no lights)
// ------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x453d30, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dc, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
sun.shadow.camera.left = -95;
sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95;
sun.shadow.camera.bottom = -95;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);
const sunDir = new THREE.Vector3(0.62, 0.48, 0.40).normalize(); // matches the sun sprite in track.js

function updateSunFollow(target) {
  // keep the tight shadow frustum centered on the player
  sun.position.set(target.x + sunDir.x * 160, target.y + sunDir.y * 160, target.z + sunDir.z * 160);
  sun.target.position.set(target.x, target.y, target.z);
  sun.target.updateMatrixWorld();
}

// ------------------------------------------------------------------
// Cars
// ------------------------------------------------------------------
const PLAYER_COLOR = 0x7a1fd0; // purple — F40-style GT
const AI_COLORS = [0x2fb1ff, 0x39d97a, 0x9c6bff, 0xffd34d, 0xff5fa8, 0x3fd9cf, 0xff8c42, 0x9ae33e];
const GRID = [
  { u: 0.990, lat: -0.8 },   // player
  { u: 0.981, lat: 1.2 },
  { u: 0.976, lat: -2.5 },
  { u: 0.965, lat: 2.4 },
  { u: 0.958, lat: -0.4 },
  { u: 0.950, lat: 3.1 },
  { u: 0.943, lat: -3.1 },
  { u: 0.933, lat: 1.1 },
  { u: 0.925, lat: -2.1 },
];

function spawnPosition(u, lat) {
  const s = world.sampleAt(u);
  const yaw = Math.atan2(s.tangent.x, s.tangent.z);
  const rX = Math.cos(yaw), rZ = -Math.sin(yaw);
  const p = new THREE.Vector3(s.pos.x + rX * lat, s.pos.y, s.pos.z + rZ * lat);
  return { pos: p, heading: yaw };
}

const cars = [];
let player = null;

function disposeCarMesh(mesh) {
  if (!mesh || !mesh.group) return;
  mesh.group.traverse((o) => {
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    }
  });
}

function buildCars() {
  // remove old car meshes from the scene (restart path)
  for (const c of cars) {
    if (c.mesh) {
      scene.remove(c.mesh.group);
      disposeCarMesh(c.mesh);
    }
  }
  cars.length = 0;
  for (let i = 0; i < GRID.length; i++) {
    const isPlayer = i === 0;
    const color = isPlayer ? PLAYER_COLOR : AI_COLORS[i - 1];
    const mesh = createCarMesh(color, { isPlayer });
    scene.add(mesh.group);
    const car = createCar(mesh, isPlayer, 1000 + i * 77);
    const { pos, heading } = spawnPosition(GRID[i].u, GRID[i].lat);
    resetCar(car, pos, heading);
    car.u = GRID[i].u;
    car.lastU = car.u;
    cars.push(car);
    if (isPlayer) player = car;
  }
  // ensure first-frame meshes are placed on the road
  for (const c of cars) { if (c.mesh) applyCarMesh(c, world); }
}

function resetRace(fullCountdown) {
  buildCars();
  for (const c of cars) applyCarMesh(c, world);
  state = fullCountdown ? 'countdown' : 'playing';
  if (state === 'countdown') {
    countdownT = 2.55;
    lastShownNum = -1;
    goTimer = 0;
    countdownDiv.classList.remove('hidden');
  }
  // snap chase camera behind the player
  const ideal = chaseCamIdeal();
  camera.position.copy(ideal);
  camera.lookAt(player.pos.x, player.pos.y + 1.4, player.pos.z);
  // clear particles/skids
  effectsClearAll();
  boostKick = 0;
  shakeAmp = 0;
}

// effects ref (created below; hoisted binding)
let effects = null;
function effectsClearAll() {
  if (!effects) return;
  effects.reset(cars);
  for (const c of cars) effects.clearCar(c);
}

// ------------------------------------------------------------------
// UI refs
// ------------------------------------------------------------------
const titleScreen = document.getElementById('title-screen');
const btnStart = document.getElementById('btn-start');
const countdownDiv = document.getElementById('countdown');
const countdownNum = document.getElementById('countdown-num');
const pauseScreen = document.getElementById('pause-screen');
const btnResume = document.getElementById('btn-resume');
const btnPause = document.getElementById('btn-pause');
const btnMute = document.getElementById('btn-mute');
const btnRestart = document.getElementById('btn-restart');
const boostFlash = document.getElementById('boost-flash');
const touchControls = document.getElementById('touch-controls');

const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// touch controls start hidden — shown once the race starts

function setTouchControlsVisible(v) {
  if (isTouchDevice) touchControls.classList.toggle('hidden', !v);
}

const audio = new AudioEngine();
const input = createInput();

buildCars();
const hud = createHUD(world);
effects = createEffects(scene);
for (const c of cars) applyCarMesh(c, world);
updateSunFollow(player.pos);

// title screen wiring
function startRaceFromUser() {
  if (state !== 'title') return;
  audio.start();
  audio.resumeIfSuspended();
  titleScreen.classList.add('hidden');
  hud.setHidden(false);
  setTouchControlsVisible(true);
  countdownDiv.classList.remove('hidden');
  state = 'countdown';
  countdownT = 2.55;
  lastShownNum = -1;
  goTimer = 0;
}

function togglePause() {
  if (state === 'playing' || state === 'countdown' || state === 'go') {
    state = 'paused';
    pauseScreen.classList.remove('hidden');
    setTouchControlsVisible(false);
    audio.suspend();
  } else if (state === 'paused') {
    state = 'playing';
    pauseScreen.classList.add('hidden');
    setTouchControlsVisible(true);
    audio.resumeIfSuspended();
  }
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  btnMute.textContent = audio.muted ? '🔇' : '🔊';
}

function restartRace() {
  resetRace(true);
  titleScreen.classList.add('hidden');
  hud.setHidden(false);
  pauseScreen.classList.add('hidden');
  setTouchControlsVisible(true);
  countdownDiv.classList.remove('hidden');
}

btnStart.addEventListener('click', startRaceFromUser);
btnResume.addEventListener('click', togglePause);
btnPause.addEventListener('click', togglePause);
btnMute.addEventListener('click', toggleMute);
btnRestart.addEventListener('click', restartRace);

// ------------------------------------------------------------------
// State + flags
// ------------------------------------------------------------------
let state = 'title';
let countdownT = 0;
let lastShownNum = -1;
let goTimer = 0;
let gameTime = 0;
let boostKick = 0;
let shakeAmp = 0;
let frame = 0;
let elapsedSec = 0;

// ------------------------------------------------------------------
// Camera
// ------------------------------------------------------------------
function chaseCamIdeal() {
  const fwdX = Math.sin(player.heading), fwdZ = Math.cos(player.heading);
  const dist = 9.6;
  const height = 3.9;
  const ideal = new THREE.Vector3(
    player.pos.x - fwdX * dist,
    player.pos.y + height,
    player.pos.z - fwdZ * dist
  );
  // keep above the road surface
  const minY = world.surfaceYAt(player.u, 0) + 1.6;
  if (ideal.y < minY) ideal.y = minY;
  return ideal;
}

// ------------------------------------------------------------------
// Loop
// ------------------------------------------------------------------
const clock = new THREE.Clock();

function stepPhysics(dt) {
  const pressed = input.consumeJustPressed();

  // input edges
  if (state === 'title') {
    if (pressed['start'] || pressed['any']) startRaceFromUser();
    return;
  }
  if (state === 'paused') {
    if (pressed['pause'] || pressed['resume']) togglePause();
    return;
  }
  if (pressed['pause']) { togglePause(); return; }
  if (pressed['mute']) toggleMute();
  if (pressed['restart']) { restartRace(); return; }

  // countdown progression
  if (state === 'countdown') {
    countdownT -= dt;
    const num = Math.ceil(countdownT / 0.85);
    if (num !== lastShownNum && num >= 1) {
      lastShownNum = num;
      countdownNum.textContent = String(num);
      countdownNum.classList.remove('cd-pop');
      void countdownNum.offsetWidth; // restart animation
      countdownNum.classList.add('cd-pop');
      audio.playCountdownTick(false);
    }
    if (countdownT <= 0) {
      state = 'go';
      goTimer = 0.75;
      countdownNum.textContent = 'GO!';
      countdownNum.classList.remove('cd-pop');
      void countdownNum.offsetWidth;
      countdownNum.classList.add('cd-pop');
      audio.playCountdownTick(true);
    }
    // cars stay still — but still render + effects
    return;
  }

  if (state === 'go') {
    goTimer -= dt;
    if (goTimer <= 0) {
      countdownDiv.classList.add('hidden');
      state = 'playing';
    }
  }

  // === physics (player + AI) ===
  elapsedSec += dt;

  // player input
  const pInput = input.state;
  stepCar(player, pInput, world, dt);

  // AI input
  for (const c of cars) {
    if (c === player) continue;
    stepAI(c, player, world, dt, elapsedSec, 1.0);
  }

  // overlaps
  resolveOverlaps(cars, dt, 3.4);

  // boost pads
  for (const c of cars) {
    if (c.boostCd > 0) continue;
    for (const pad of world.boostPads) {
      const relX = c.pos.x - pad.pos.x;
      const relZ = c.pos.z - pad.pos.z;
      const sinY = Math.sin(pad.yaw), cosY = Math.cos(pad.yaw);
      const fwd = relX * sinY + relZ * cosY;
      const side = relX * cosY - relZ * sinY;
      if (Math.abs(fwd) < pad.halfLength && Math.abs(side) < pad.halfWidth) {
        c.boostTimer = 1.7;
        c.boostCd = 3.4;
        if (c.isPlayer) {
          hud.setMessage('BOOST!', 1100);
          audio.playBoost();
          boostFlash.classList.add('flash');
          setTimeout(() => boostFlash.classList.remove('flash'), 160);
          boostKick = 1.0;
        }
        break;
      }
    }
  }

  // effects (dust / sparks / skids)
  for (const c of cars) {
    const rear = rearWheelPositions(c, world);
    // drift dust
    if ((c.drifting || c.offRoad) && Math.abs(c.fwdSpeed) > 6) {
      const col = c.offRoad ? [0.55, 0.48, 0.38] : [0.4, 0.38, 0.35];
      for (const w of rear) {
        effects.spawnDust(w.x, w.y, w.z, { count: c.drifting ? 2 : 1, color: col, speed: c.offRoad ? 3.2 : 2.4 });
      }
    }
    // skid marks when drifting on asphalt
    if (c.drifting && !c.offRoad && Math.abs(c.fwdSpeed) > 9) {
      effects.addSkid(c, rear[0], rear[1], gameTime);
    } else {
      effects.clearSkids(c);
    }
    // wall hit sparks + shake + thud
    if (c.wallHit) {
      const sign = Math.sign(world.signedLateralAt(c.pos, c.u)) || 1;
      const fX = Math.sin(c.heading), fZ = Math.cos(c.heading);
      const rX = Math.cos(c.heading), rZ = -Math.sin(c.heading);
      const px = c.pos.x + rX * sign * 1.15;
      const pz = c.pos.z + rZ * sign * 1.15;
      effects.spawnSparks(px, c.pos.y + 0.5, pz, { count: 9 + Math.floor(c.wallHitStrength * 9), color: [1.0, 0.72, 0.3] });
      if (c.isPlayer) {
        audio.playThud(c.wallHitStrength);
        shakeAmp = Math.max(shakeAmp, 0.35 + c.wallHitStrength * 0.6);
      }
    }
  }

  // mesh + camera + audio + HUD
  for (const c of cars) applyCarMesh(c, world);

  const speedRatio = clamp(Math.abs(player.fwdSpeed) / CAR_PHYSICS.boostTopSpeed, 0, 1);
  audio.update(speedRatio, pInput.throttle, player.driftAmount, player.boosting, player.offRoad);

  updateCamera(dt, speedRatio, shakeAmp);
  updateSunFollow(player.pos);

  // HUD (throttled-ish)
  if (frame % 2 === 0) {
    hud.setSpeed(Math.abs(player.fwdSpeed) * 3.7);
    // rank by progress
    const order = cars.slice().sort((a, b) => b.progress - a.progress);
    const rank = order.indexOf(player) + 1;
    hud.setPosition(rank);
    hud.setLap(player.lap || 1);
    hud.setDrift(player.driftAmount);
  }
  if (frame % 3 === 0) hud.drawMinimap(cars, player.seed);

  effects.update(dt, gameTime, cars, world);
  gameTime += dt;
}

function updateCamera(dt, speedRatio, shakeAmp) {
  const target = chaseCamIdeal();
  camera.position.x = damp(camera.position.x, target.x, 5.2, dt);
  camera.position.y = damp(camera.position.y, target.y, 5.2, dt);
  camera.position.z = damp(camera.position.z, target.z, 5.2, dt);

  const fwd = Math.sin(player.heading), fwdZ = Math.cos(player.heading);
  const lookX = player.pos.x + fwd * 6.5;
  const lookZ = player.pos.z + fwdZ * 6.5;
  const lookY = player.pos.y + 1.35;

  // shake
  const s = shakeAmp;
  const shakeX = (Math.random() - 0.5) * s * 0.9;
  const shakeY = (Math.random() - 0.5) * s * 0.7;
  const shakeZ = (Math.random() - 0.5) * s * 0.9;

  camera.position.x += shakeX;
  camera.position.y += shakeY;
  camera.position.z += shakeZ;

  // up-vector roll with drift
  const roll = clamp(player.latSpeed * -0.02, -0.09, 0.09);
  const dirX = lookX - camera.position.x;
  const dirY = lookY - camera.position.y;
  const dirZ = lookZ - camera.position.z;
  camera.up.set(Math.sin(roll), 1, 0);
  camera.lookAt(lookX, lookY, lookZ);

  // FOV kick
  const targetFov = CAR_PHYSICS.fovBase + speedRatio * 13 + boostKick * 13;
  camera.fov = damp(camera.fov, targetFov, 5, dt);
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  frame++;

  if (state === 'title') {
    idleCamera(dt);
    input.update(isTouchDevice);
    effects.update(dt, gameTime, cars, world);
    gameTime += dt;
    renderer.render(scene, camera);
    const pressed = input.consumeJustPressed();
    if (pressed['start'] || pressed['any']) startRaceFromUser();
    return;
  }

  if (state === 'paused') {
    renderer.render(scene, camera);
    const pressed = input.consumeJustPressed();
    if (pressed['pause']) togglePause();
    return;
  }

  input.update(isTouchDevice);
  stepPhysics(dt);

  shakeAmp = Math.max(0, shakeAmp - dt * 2.4);
  boostKick = Math.max(0, boostKick - dt * 1.5);

  // animate boost pad pulse
  const t = gameTime;
  for (const pad of world.boostPads) {
    const mat = pad.mesh && pad.mesh.material;
    if (mat) {
      const off = (pad.mesh.userData && pad.mesh.userData.phaseOffset) || 0;
      mat.opacity = 0.62 + 0.33 * Math.sin(t * 3.2 + off);
    }
  }

  renderer.render(scene, camera);
}

function idleCamera(dt) {
  const t = gameTime * 0.1;
  const start = world.startPos || player.pos;
  const cx = start.x + Math.cos(t) * 26;
  const cz = start.z + Math.sin(t) * 26;
  const cy = start.y + 8.5;
  camera.position.x = damp(camera.position.x, cx, 1.4, dt);
  camera.position.y = damp(camera.position.y, cy, 1.4, dt);
  camera.position.z = damp(camera.position.z, cz, 1.4, dt);
  camera.lookAt(start.x, start.y + 2.5, start.z);
  camera.fov = damp(camera.fov, 56, 2, dt);
  camera.updateProjectionMatrix();
}

// handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'playing' || state === 'go' || state === 'countdown')) {
    togglePause();
  }
});

// Debug handle — lets the browser tool inspect live state and step the
// simulation synchronously (fixed-dt) when the page is backgrounded.
// Not intended for production gameplay; harmless if left in place.
window.__game = {
  get state() { return state; },
  get cars() { return cars; },
  get player() { return player; },
  get world() { return world; },
  get input() { return input; },
  get gameTime() { return gameTime; },
  get frame() { return frame; },
  get audio() { return audio; },
  advance(seconds, dt = 1 / 60) {
    if (state === 'title') startRaceFromUser();
    if (state === 'countdown' || state === 'go') { state = 'playing'; countdownDiv.classList.add('hidden'); }
    input.update(isTouchDevice);
    const steps = Math.min(Math.floor(seconds / dt), 3600);
    for (let i = 0; i < steps; i++) stepPhysics(dt);
    // snap the chase camera so headless screenshots frame the player
    const ideal = chaseCamIdeal();
    camera.position.copy(ideal);
    camera.up.set(0, 1, 0);
    camera.lookAt(
      player.pos.x + Math.sin(player.heading) * 6.5,
      player.pos.y + 1.35,
      player.pos.z + Math.cos(player.heading) * 6.5
    );
    renderer.render(scene, camera);
    return { state, gameTime, frame };
  },
};

animate();
