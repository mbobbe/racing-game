// Car mesh builder + hybrid arcade/realistic driving physics.
// Conventions:
//   heading θ → forward = (sinθ, 0, cosθ); mesh local +X = (cosθ, 0, -sinθ)
//     (with the chase camera behind the car, local +X is the driver's LEFT / screen-left)
//   mesh: nose toward local +Z, rotation.y = θ
//   steer: +steer → heading increases → turn toward driver's left (screen-left);
//     player input maps right key → -1, left key → +1
//
// Physics approach (feels arcade-fast, keeps real weight):
//   decompose velocity into body-frame (forward, lateral) — then
//   apply longitudinal forces to forward — then update heading —
//   then re-decompose the (unchanged) world velocity in the new
//   frame, damp lateral velocity with grip (reduced when drifting
//   or off-road), and recompose.
// This lets the body rotate harder than the velocity vector does,
// which produces drift/slide without faking the physics.

import * as THREE from '../vendor/three.module.js';
import { clamp, damp, wrapAngle, lerp } from './util.js';

export const CAR_PHYSICS = {
  topSpeed: 60,
  boostTopSpeed: 88,
  accel: 38,
  brakeAccel: 55,
  reverseAccel: 20,
  reverseMax: 13,
  boostAccel: 36,
  dragQuad: 0.0011,
  dragLin: 0.05,
  offRoadDrag: 7.5,
  grip: 10.5,
  driftGrip: 3.0,
  offRoadGrip: 5.4,
  maxYawRate: 2.85,
  steerRefSpeed: 10.5,
  steerRate: 5.4,
  driftYawThresh: 0.72,
  driftSpeedMin: 13,
  wallBounce: 0.28,
  wheelRadius: 0.4,
  bodyClearance: 0.02,
  fovBase: 62,
};

// ------------------------------------------------------------------
// Mesh builder — GT-R style low supercar
// ------------------------------------------------------------------
function makeRimTexture() {
  // canvas-drawn rim plate: silver spokes on a dark disc, used on both caps
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const cx = 128, cy = 128;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.beginPath();
  ctx.arc(cx, cy, 122, 0, Math.PI * 2);
  ctx.fillStyle = '#141419';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 104, 0, Math.PI * 2);
  ctx.fillStyle = '#9aa2ac';
  ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 100);
  g.addColorStop(0, '#e9edf2');
  g.addColorStop(0.45, '#b9bfc9');
  g.addColorStop(1, '#7d8490');
  ctx.beginPath();
  ctx.arc(cx, cy, 96, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  const spikes = 6;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, py = ca;
    const rb = 24, rw = 15, tipR = 90, tipW = 9;
    ctx.beginPath();
    ctx.moveTo(cx + ca * rb + px * rw, cy + sa * rb + py * rw);
    ctx.lineTo(cx + ca * tipR + px * tipW, cy + sa * tipR + py * tipW);
    ctx.lineTo(cx + ca * tipR - px * tipW, cy + sa * tipR - py * tipW);
    ctx.lineTo(cx + ca * rb - px * rw, cy + sa * rb - py * rw);
    ctx.closePath();
    ctx.fillStyle = '#2b2f37';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  const gh = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  gh.addColorStop(0, '#f2f5f9');
  gh.addColorStop(1, '#8f96a2');
  ctx.fillStyle = gh;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3a3e46';
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#454a52';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makePlateTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f3ee';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#1d2733';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#20364a';
  ctx.font = 'bold 50px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 54);
  ctx.fillStyle = '#173a8a';
  ctx.fillRect(14, 90, 228, 14);
  ctx.fillStyle = '#c02329';
  ctx.fillRect(82, 90, 92, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createCarMesh(color, opts = {}) {
  const group = new THREE.Group();

  // ---------------- materials ----------------
  const paintMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.42, roughness: 0.18,
    clearcoat: 1.0, clearcoatRoughness: 0.07,
  });
  const glossDark = new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.6, roughness: 0.34 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0d1a24, metalness: 0.2, roughness: 0.05,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    emissive: 0x141f28, emissiveIntensity: 0.55,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.08, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({
    map: makeRimTexture(), metalness: 0.85, roughness: 0.26,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xc7cbd3, metalness: 0.92, roughness: 0.2 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff8df, emissive: 0xfff6cf, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.25,
  });
  const tailBarMat = new THREE.MeshStandardMaterial({
    color: 0x2f0605, emissive: 0xff2415, emissiveIntensity: 1.7, roughness: 0.32, metalness: 0.45,
  });
  const lampRed = new THREE.MeshStandardMaterial({
    color: 0x380a06, emissive: 0xff2a1a, emissiveIntensity: 2.0, roughness: 0.3, metalness: 0.4,
  });
  const lampAmber = new THREE.MeshStandardMaterial({
    color: 0x2f1403, emissive: 0xff9a2e, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.4,
  });
  const lampWhite = new THREE.MeshStandardMaterial({
    color: 0x2a2a24, emissive: 0xf2eccf, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4,
  });
  const plateMat = new THREE.MeshStandardMaterial({
    map: makePlateTexture('GT-R'), metalness: 0.1, roughness: 0.55,
  });
  const exhaustGlow = new THREE.MeshStandardMaterial({
    color: 0x1a0a06, emissive: 0xff6a22, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0.5,
  });

  // ---------------- body — low GT silhouette ----------------
  const shape = new THREE.Shape();
  shape.moveTo(-0.58, 1.94);
  shape.quadraticCurveTo(-0.82, 1.60, -0.88, 0.55);
  shape.quadraticCurveTo(-0.88, -1.00, -0.70, -1.74);
  shape.quadraticCurveTo(-0.50, -2.00, 0, -2.02);
  shape.quadraticCurveTo(0.50, -2.00, 0.70, -1.74);
  shape.quadraticCurveTo(0.88, -1.00, 0.88, 0.55);
  shape.quadraticCurveTo(0.82, 1.60, 0.58, 1.94);
  shape.lineTo(-0.58, 1.94);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: 0.40,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.09,
    bevelSegments: 4,
    curveSegments: 12,
  });
  bodyGeo.rotateX(Math.PI / 2); // shape +y (nose) -> world +z
  bodyGeo.translate(0, 0.82, 0); // span y ~ [0.33, 0.91]
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // hood center ridge (raised strip along the nose)
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 1.72), paintMat);
  spine.position.set(0, 0.915, 1.08);
  spine.castShadow = true;
  group.add(spine);

  // hood vents — slim dark slots flanking the ridge
  for (const sx of [-1, 1]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.62), glossDark);
    vent.position.set(sx * 0.33, 0.915, 1.20);
    group.add(vent);
  }

  // canopy scoop on the roof (GT style)
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.46), glossDark);
  scoop.position.set(0, 1.22, -0.72);
  scoop.castShadow = true;
  group.add(scoop);

  // ---------------- glass cabin — raked GT greenhouse ----------------
  // Side-profile prism: x = car length (nose +x), y = height, extruded across the width
  const cabShape = new THREE.Shape();
  cabShape.moveTo(0.74, 0.86);
  cabShape.lineTo(0.16, 1.17);                       // windshield slope
  cabShape.lineTo(-0.98, 1.20);                       // roof
  cabShape.quadraticCurveTo(-1.26, 1.17, -1.38, 0.99);  // rear curve
  cabShape.lineTo(-1.34, 0.86);
  cabShape.lineTo(0.74, 0.86);
  const cabGeo = new THREE.ExtrudeGeometry(cabShape, {
    steps: 1,
    depth: 0.94,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.045,
    bevelSegments: 3,
    curveSegments: 10,
  });
  cabGeo.rotateY(-Math.PI / 2);
  cabGeo.translate(0.49, 0, 0);
  const cabin = new THREE.Mesh(cabGeo, glassMat);
  cabin.castShadow = true;
  group.add(cabin);

  // front chin + splitter + corner headlamps
  const chin = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.15, 0.16), glossDark);
  chin.position.set(0, 0.36, 1.96);
  chin.castShadow = true;
  group.add(chin);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.07, 0.30), glossDark);
  splitter.position.set(0, 0.27, 1.98);
  splitter.castShadow = true;
  group.add(splitter);
  // slim corner headlamps, slightly inboard so they stay on the body edge
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.085, 0.10), headMat);
    lamp.position.set(sx * 0.40, 0.62, 2.00);
    lamp.castShadow = true;
    group.add(lamp);
  }

  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 3.10), glossDark);
    skirt.position.set(sx * 0.93, 0.30, 0.0);
    skirt.castShadow = true;
    group.add(skirt);
  }

  // ---------------- rear face panel + plate + round lamps ----------------
  const rearPanel = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.40, 0.08), glossDark);
  rearPanel.position.set(0, 0.58, -1.99);
  rearPanel.castShadow = true;
  group.add(rearPanel);

  // plate — a plane facing the viewer (rear)
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.24), new THREE.MeshBasicMaterial({ map: makePlateTexture('GT-R') }));
  plate.rotation.y = Math.PI;
  plate.position.set(0, 0.60, -2.16);
  group.add(plate);

  const lampGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.05, 16);
  const lampPos = [
    { x: -0.70, m: lampRed }, { x: -0.51, m: lampAmber }, { x: -0.33, m: lampWhite },
    { x: 0.37, m: lampWhite }, { x: 0.55, m: lampAmber }, { x: 0.73, m: lampRed },
  ];
  for (const lamp of lampPos) {
    const m = new THREE.Mesh(lampGeo, lamp.m);
    m.rotation.x = Math.PI / 2; // disc faces rear
    m.position.set(lamp.x, 0.64, -2.06);
    group.add(m);
  }

  // trunk louvers — full-width slats across the deck
  for (let i = 0; i < 3; i++) {
    const louver = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.035, 0.07), glossDark);
    louver.position.set(0, 0.918, -1.10 - i * 0.20);
    group.add(louver);
  }

  // vertical vent slats on the quarter edges
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.05), glossDark);
      slat.position.set(sx * 0.945, 0.62, -1.28 - i * 0.12);
      group.add(slat);
    }
  }

  // lower rear bumper + reflector
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.18, 0.24), glossDark);
  bumper.position.set(0, 0.34, -2.00);
  bumper.castShadow = true;
  group.add(bumper);
  const reflector = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.07, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x300c08, emissive: 0xff2a18, emissiveIntensity: 1.0, roughness: 0.4 }),
  );
  reflector.position.set(-0.62, 0.32, -2.14);
  group.add(reflector);

  // full-width taillight rail under the rear panel
  const tailbar = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.05, 0.05), tailBarMat);
  tailbar.position.set(0, 0.44, -2.045);
  group.add(tailbar);

  // diffuser fins + twin chunky exhausts tucked under the bumper
  for (const fx of [-0.56, -0.32, -0.08, 0.16, 0.40, 0.60]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.26), glossDark);
    fin.position.set(fx, 0.22, -2.12);
    group.add(fin);
  }
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.082, 0.26, 14, 1, false),
      [trimMat, trimMat, exhaustGlow],
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(sx * 0.34, 0.25, -2.14);
    group.add(pipe);
  }

  // ---------------- GT wing — big, tilted, endplates ----------------
  const wing = new THREE.Group();
  const wingPlan = new THREE.Shape();
  wingPlan.moveTo(-0.82, 0.20);
  wingPlan.lineTo(0.82, 0.20);
  wingPlan.lineTo(0.94, -0.26);
  wingPlan.lineTo(-0.94, -0.26);
  wingPlan.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingPlan, {
    steps: 1, depth: 0.06, bevelEnabled: true,
    bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 4,
  });
  wingGeo.rotateX(Math.PI / 2); // shape (x=width, y=depth) -> world (x=width, z=depth)
  wingGeo.translate(0, 0.02, 0);
  const wingMesh = new THREE.Mesh(wingGeo, paintMat);
  wingMesh.castShadow = true;
  wing.add(wingMesh);
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.54), glossDark);
    plate.position.set(sx * 0.95, 0.06, -0.04);
    plate.castShadow = true;
    wing.add(plate);
  }
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.13), glossDark);
    strut.position.set(sx * 0.44, -0.19, -0.03);
    strut.castShadow = true;
    wing.add(strut);
  }
  wing.position.set(0, 1.04, -1.96);
  wing.rotation.x = 0.17; // nose-down sweep — back edge up
  group.add(wing);

  // side mirrors (chrome stubs with a small stalk)
  for (const sx of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), glossDark);
    stalk.position.set(sx * 0.60, 0.92, 0.42);
    group.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.10, 0.11), trimMat);
    mirror.position.set(sx * 0.72, 0.98, 0.42);
    mirror.castShadow = true;
    group.add(mirror);
  }

  // ---------------- wheels ----------------
  const wheels = [];
  const wheelPos = [
    { x: -0.94, z: 1.42, front: true },
    { x: 0.94, z: 1.42, front: true },
    { x: -0.94, z: -1.42, front: false },
    { x: 0.94, z: -1.42, front: false },
  ];
  const tireGeo = new THREE.CylinderGeometry(CAR_PHYSICS.wheelRadius, CAR_PHYSICS.wheelRadius, 0.38, 26);
  for (const wp of wheelPos) {
    const wrapper = new THREE.Group();
    wrapper.position.set(wp.x, CAR_PHYSICS.wheelRadius, wp.z);
    const spinner = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, [tireMat, rimMat, rimMat]);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    spinner.add(tire);
    wrapper.add(spinner);
    group.add(wrapper);
    wheels.push({ wrapper, spinner, front: wp.front });
  }

  return { group, wheels, paintMat, headMat, tailMat: tailBarMat, glassMat };
}
// ------------------------------------------------------------------
// Car state
// ------------------------------------------------------------------
export function createCar(mesh, isPlayer, seed) {
  return {
    isPlayer: !!isPlayer,
    seed: (seed >>> 0) || 1,
    mesh,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    heading: 0,
    yawVel: 0,
    fwdSpeed: 0,
    latSpeed: 0,
    steerVisual: 0,
    wheelSpin: 0,
    driftAmount: 0,
    drifting: false,
    braking: false,
    offRoad: false,
    boosting: false,
    boostTimer: 0,
    boostCd: 0,
    wallHit: false,
    wallHitStrength: 0,
    started: false,
    laps: 0,
    u: 0,
    lastU: 0,
    progress: 0,
    aiSeed: Math.floor(Math.random() * 1000),
  };
}

export function resetCar(car, spawnPos, spawnHeading) {
  car.pos.copy(spawnPos);
  car.vel.set(0, 0, 0);
  car.heading = spawnHeading;
  car.yawVel = 0;
  car.fwdSpeed = 0;
  car.latSpeed = 0;
  car.steerVisual = 0;
  car.wheelSpin = 0;
  car.driftAmount = 0;
  car.drifting = false;
  car.braking = false;
  car.offRoad = false;
  car.boosting = false;
  car.boostTimer = 0;
  car.boostCd = 0;
  car.wallHit = false;
  car.wallHitStrength = 0;
  car.started = false;
  car.laps = 0;
  car.u = 0;
  car.lastU = 0;
  car.progress = 0;
}

// ------------------------------------------------------------------
// Physics step
// ------------------------------------------------------------------
export function stepCar(car, input, world, dt) {
  const P = CAR_PHYSICS;
  const geomNow = world.sampleAt(car.u);

  // --- lookups (u from the previous step; cheap and stable at this dt) ---
  const u = car.u;
  const tangent = geomNow.tangent;
  const sinH = Math.sin(car.heading), cosH = Math.cos(car.heading);
  const fX = sinH, fZ = cosH;
  const rX = cosH, rZ = -sinH;

  // --- decompose current velocity in the CURRENT body frame ---
  let fwdS = car.vel.x * fX + car.vel.z * fZ;
  let latV = car.vel.x * rX + car.vel.z * rZ;

  // --- boost timer ---
  if (car.boostTimer > 0) car.boostTimer = Math.max(0, car.boostTimer - dt);
  if (car.boostCd > 0) car.boostCd = Math.max(0, car.boostCd - dt);
  const boosting = car.boostTimer > 0;
  car.boosting = boosting;

  const topSpeed = boosting ? P.boostTopSpeed : P.topSpeed;

  // --- longitudinal forces ---
  let accel = 0;
  if (input.throttle > 0) {
    if (fwdS > -0.5) {
      accel += P.accel * input.throttle * Math.max(0.25, 1 - fwdS / topSpeed);
    } else {
      accel += P.brakeAccel * 0.7 * input.throttle; // throttle while rolling back = brake
    }
  }
  if (input.brake > 0) {
    if (fwdS > 1) accel -= P.brakeAccel * input.brake;
    else if (!input.brakeNoReverse) accel -= P.reverseAccel * input.brake; // reverse
  }
  if (boosting) accel += P.boostAccel * (1 - Math.max(0, fwdS - 38) / Math.max(1, P.boostTopSpeed - 38)) * 0.85;

  // drag (quadratic + rolling)
  accel -= P.dragQuad * fwdS * Math.abs(fwdS) + P.dragLin * fwdS;

  // off-road penalty (shoulder)
  const latPos = world.signedLateralAt(car.pos, u);
  const offRoad = Math.abs(latPos) > world.halfWidth + 0.15;
  car.offRoad = offRoad;
  if (offRoad) accel -= P.offRoadDrag * Math.sign(fwdS >= 0 ? 1 : -1) * Math.min(1, Math.abs(fwdS) / 12);

  fwdS = Math.max(fwdS + accel * dt, -P.reverseMax);
  if (fwdS > topSpeed) fwdS = Math.max(topSpeed, fwdS - (fwdS - topSpeed) * Math.min(1, dt * 7));

  // --- steering / yaw ---
  const absFwd = Math.abs(fwdS);
  const speedNorm = clamp(absFwd / P.steerRefSpeed, 0, 1);
  const highSpeedFalloff = 1 / (1 + Math.pow(Math.max(0, absFwd - 32) / 40, 2));
  const reverseDir = fwdS < -0.4 ? -1 : 1;
  const targetYaw = input.steer * P.maxYawRate * speedNorm * highSpeedFalloff * (input.handbrake ? 1.45 : 1) * reverseDir;
  car.yawVel = damp(car.yawVel, targetYaw, P.steerRate, dt);
  car.heading = wrapAngle(car.heading + car.yawVel * dt);

  // --- re-decompose in the NEW frame, apply grip, recompose ---
  const newSinH = Math.sin(car.heading), newCosH = Math.cos(car.heading);
  const newF = { x: newSinH, z: newCosH };
  const newR = { x: newCosH, z: -newSinH };

  let fwdNew = car.vel.x * newF.x + car.vel.z * newF.z + accel * dt;
  let latNew = car.vel.x * newR.x + car.vel.z * newR.z;

  // grip: drift/handbrake/off-road all reduce it
  const driftNow = Math.abs(car.yawVel) > P.driftYawThresh && absFwd > P.driftSpeedMin;
  car.drifting = driftNow;
  car.driftAmount = damp(car.driftAmount, driftNow ? 1 : 0, 7.5, dt);

  const gripNow = driftNow ? P.driftGrip : (offRoad ? P.offRoadGrip : P.grip);
  latNew *= Math.exp(-gripNow * dt);

  fwdNew = Math.max(fwdNew, -P.reverseMax);
  if (fwdNew > topSpeed) fwdNew = Math.max(topSpeed, fwdNew - (fwdNew - topSpeed) * Math.min(1, dt * 7));

  car.vel.x = newF.x * fwdNew + newR.x * latNew;
  car.vel.z = newF.z * fwdNew + newR.z * latNew;

  // --- integrate position ---
  car.pos.x += car.vel.x * dt;
  car.pos.z += car.vel.z * dt;

  // --- refresh u (fresh, after integration) for the wall clamp ---
  car.u = world.nearestU(car.pos, car.u);

  // --- wall clamp (positional) ---
  const freshSample = world.sampleAt(car.u);
  const trackYaw = Math.atan2(freshSample.tangent.x, freshSample.tangent.z);
  const tRx = Math.cos(trackYaw), tRz = -Math.sin(trackYaw);
  const latPos2 = world.signedLateralAt(car.pos, car.u);
  const wallLimit = world.halfWidth + world.wallMargin;
  car.wallHit = false;
  if (Math.abs(latPos2) > wallLimit) {
    const sign = Math.sign(latPos2);
    const excess = Math.abs(latPos2) - wallLimit;
    // pull back to the wall line along the TRACK's right vector
    car.pos.x -= tRx * excess * sign;
    car.pos.z -= tRz * excess * sign;
    // outgoing velocity (track-relative) is removed/bounced
    const alongR = car.vel.x * tRx + car.vel.z * tRz;
    if (Math.sign(alongR) === sign && Math.abs(alongR) > 3) {
      // bounce inward and stop momentum
      const bounce = 1 + P.wallBounce;
      car.vel.x -= tRx * alongR * bounce;
      car.vel.z -= tRz * alongR * bounce;
      car.wallHit = true;
      car.wallHitStrength = clamp(Math.abs(alongR) / 34, 0.2, 1);
    } else if (Math.sign(alongR) === sign && alongR !== 0) {
      // scrape along wall (remove outgoing component)
      car.vel.x -= tRx * alongR;
      car.vel.z -= tRz * alongR;
    }
  }

  // --- refresh u again after the clamp, for mesh height/lap/progress ---
  car.u = world.nearestU(car.pos, car.u);

  // --- lap detection (start line crossing) ---
  const prevU = car.lastU;
  if (prevU > 0.9 && car.u < 0.1 && fwdNew > 3) {
    if (!car.started) car.started = true;
    else car.laps += 1;
  }
  car.lastU = car.u;

  car.progress += Math.max(0, fwdNew) * dt;
  car.lap = car.started ? car.laps + 1 : 1;

  // cosmetic
  car.wheelSpin += (fwdNew / P.wheelRadius) * dt;
  car.steerVisual = damp(car.steerVisual, input.steer, 9, dt);
  car.braking = input.brake > 0 && fwdNew > 1;
  car.fwdSpeed = fwdNew;
  car.latSpeed = latNew;

  return car;
}

// ------------------------------------------------------------------
// Mesh apply — position + orient the car on the road
// ------------------------------------------------------------------
export function applyCarMesh(car, world) {
  if (!car.mesh) return;
  const P = CAR_PHYSICS;
  const u = car.u;
  const latPos = world.signedLateralAt(car.pos, u);
  const y = world.surfaceYAt(u, latPos) + P.bodyClearance;
  car.pos.y = y; // store the surface height (camera + effects use it)

  const mesh = car.mesh.group;
  mesh.position.set(car.pos.x, y, car.pos.z);

  const sample = world.sampleAt(u);
  const tangent = sample.tangent;
  const horizLen = Math.hypot(tangent.x, tangent.z);
  const slope = Math.atan2(tangent.y, horizLen || 1);

  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = car.heading;
  mesh.rotation.x = -slope;
  mesh.rotation.z = sample.bank + clamp(car.latSpeed * 0.018, -0.13, 0.13);

  const spin = car.wheelSpin;
  for (const w of car.mesh.wheels) {
    w.spinner.rotation.x = spin;
    if (w.front) w.wrapper.rotation.y = car.steerVisual * 0.42;
  }

  if (car.mesh.tailMat) {
    car.mesh.tailMat.emissiveIntensity = car.braking ? 5.6 : 1.7;
  }
}

// Helpers used by effects/AI
export function carWorldQuat(car) {
  return car.mesh.group.quaternion;
}

export function rearWheelPositions(car, world) {
  // world-space positions of the two rear wheels (for dust/sparks)
  const fX = Math.sin(car.heading), fZ = Math.cos(car.heading);
  const rX = Math.cos(car.heading), rZ = -Math.sin(car.heading);
  const out = [];
  for (const side of [-1, 1]) {
    const x = car.pos.x + rX * (side * 0.92) - fX * 1.45;
    const z = car.pos.z + rZ * (side * 0.92) - fZ * 1.45;
    const u = car.u;
    const latPos = world.signedLateralAt({ x, y: 0, z }, u);
    const y = world.surfaceYAt(u, latPos) + 0.05;
    out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

export function surfaceHeightAt(world, x, z) {
  // quick surface height lookup at a world x/z (uses the nearest sample)
  const u = world.nearestU({ x, y: 0, z }, 0);
  const latPos = world.signedLateralAt({ x, y: 0, z }, u);
  return world.surfaceYAt(u, latPos);
}
