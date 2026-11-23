// Small math/helpers shared across the game. No THREE imports — pure JS.

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Frame-rate-independent exponential smoothing. rate is in 1/s.
export function damp(current, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

export function dampAngle(current, target, rate, dt) {
  const diff = wrapAngle(target - current);
  return current + diff * (1 - Math.exp(-rate * dt));
}

// Wrap angle to (-PI, PI]
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

// Asymmetric exponential smoothing: a bit snappier when accelerating.
export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

// Deterministic pseudo-random from an index (for stable placement).
export function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export function pick(arr, n) {
  return arr[Math.floor(hash01(n) * arr.length)];
}

export function randomIn(seed, min, max) {
  return min + hash01(seed) * (max - min);
}

// Simple clamped smoothstep 0..1.
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
