// AI drivers — spline-following with curvature-limited speed, one lookahead,
// rubber-banding relative to the player, and per-driver feel jitter.
// Reuses the exact same car physics as the player (stepCar).

import * as THREE from '../vendor/three.module.js';
import { wrapAngle, clamp, hash01 } from './util.js';
import { stepCar, CAR_PHYSICS } from './car.js';

export function createAISeed() {
  return Math.floor(Math.random() * 100000);
}

function tangentAtU(world, u) {
  const s = world.sampleAt(u);
  return s.tangent;
}

function curvatureAt(world, u) {
  const N = world.sampleCount || world.samples.length;
  const uBack = (u - 1.6 / N + 1) % 1;
  const uFwd = (u + 1.6 / N) % 1;
  const t0 = tangentAtU(world, uBack);
  const t1 = tangentAtU(world, uFwd);
  const crossY = t0.z * t1.x - t0.x * t1.z;
  const dot = clamp(t0.x * t1.x + t0.z * t1.z + t0.y * t1.y, -1, 1);
  const dTheta = Math.atan2(crossY, dot);
  // spacing between the two sample points (approx)
  const spacing = (Math.abs(uFwd - uBack) || 1 / N) * world.length;
  return dTheta / Math.max(0.001, spacing);
}

// Build an input object for one AI car and feed it into stepCar.
export function stepAI(car, player, world, dt, elapsedSec, aiSkillJitter) {
  const u = car.u;
  const sampleCount = world.sampleCount || world.samples.length;

  // lookahead distance scales with speed, clamped
  const speed = Math.abs(car.fwdSpeed);
  const lookahead = clamp(9 + speed * 0.5, 11, 58);
  const lookU = (u + lookahead / world.length) % 1;
  const ahead = world.sampleAt(lookU);

  // desired heading toward the lookahead point (centerline)
  const dx = ahead.pos.x - car.pos.x;
  const dz = ahead.pos.z - car.pos.z;
  const desired = Math.atan2(dx, dz);
  const err = wrapAngle(desired - car.heading);

  // steering: clamp to [-1, 1]; gentler at high speed is handled by the physics
  const steer = clamp(err * 2.4, -1, 1);

  // curvature-based speed limit
  const curv = Math.abs(curvatureAt(world, u + 0.004));
  const latAccelMax = 46;
  let limit = curv > 0.0004 ? Math.sqrt(latAccelMax / curv) : 90;
  limit = clamp(limit, 19, CAR_PHYSICS.topSpeed);

  // rubber-banding vs the player
  let rubber = 1.0;
  if (player) {
    const gap = player.progress - car.progress; // >0 means player is ahead
    if (gap > 70) rubber = 1.16;
    else if (gap > 20) rubber = 1.05;
    else if (gap < -70) rubber = 0.80;
    else if (gap < -20) rubber = 0.92;
  }

  // per-car feel: fixed slight variance + a slow wobble
  const jitter = aiSkillJitter || 1.0;
  const wobble = 0.97 + 0.05 * Math.sin(elapsedSec * 0.9 + car.aiSeed * 1.7);
  const targetV = Math.min(limit * wobble * jitter * rubber, CAR_PHYSICS.topSpeed * 1.02);

  // throttle / brake decision
  let throttle = 0, brake = 0;
  const diff = speed - targetV;
  if (diff < -3) throttle = 1.0;
  else if (diff < 1.2) throttle = 0.6;
  else if (diff > 3.5) brake = 1.0;
  else brake = 0.25;

  const input = {
    steer,
    throttle,
    brake,
    handbrake: false,
  };

  stepCar(car, input, world, dt);

  return car;
}

// Push overlapping cars apart (positional + velocity), player included.
export function resolveOverlaps(cars, dt, radius) {
  const minDist = radius || 3.4;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      if (dist < minDist) {
        const nx = dx / dist, nz = dz / dist;
        const overlap = (minDist - dist) * 0.5;
        a.pos.x -= nx * overlap;
        a.pos.z -= nz * overlap;
        b.pos.x += nx * overlap;
        b.pos.z += nz * overlap;
        // bleed relative velocity (soften the bump)
        const rel = (b.vel.x * nx + b.vel.z * nz) - (a.vel.x * nx + a.vel.z * nz);
        const push = Math.max(0, rel) * 0.35;
        a.vel.x -= nx * push;
        a.vel.z -= nz * push;
        b.vel.x += nx * push;
        b.vel.z += nz * push;
      }
    }
  }
}
