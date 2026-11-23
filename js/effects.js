// Effects: additive spark particles, normal-blend dust particles, and
// per-car fading skid-mark ribbons. Custom shaders, tiny.

import * as THREE from '../vendor/three.module.js';
import { clamp, damp } from './util.js';

function makeSoftCircleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PARTICLE_VERT = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (240.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
uniform sampler2D uTex;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
}`;

export class ParticleSystem {
  constructor(scene, opts) {
    this.count = opts.count || 400;
    this.blending = opts.blending || THREE.AdditiveBlending;
    this.texture = opts.texture;
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.sizes = new Float32Array(this.count);
    this.alphas = new Float32Array(this.count);
    this.lives = new Float32Array(this.count);
    this.maxLifes = new Float32Array(this.count);
    this.alphasInit = new Float32Array(this.count);
    this.grow = new Float32Array(this.count);
    this.alive = 0;
    this.time = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: this.blending,
      uniforms: { uTex: { value: this.texture } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geometry = geo;
    this.material = mat;
  }

  spawn(x, y, z, vx, vy, vz, life, size, color, grow = 0) {
    if (this.alive >= this.count) return;
    const i = this.alive++;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx; this.velocities[i * 3 + 1] = vy; this.velocities[i * 3 + 2] = vz;
    this.colors[i * 3] = color[0]; this.colors[i * 3 + 1] = color[1]; this.colors[i * 3 + 2] = color[2];
    this.sizes[i] = size;
    this.lives[i] = life; this.maxLifes[i] = life;
    this.alphasInit[i] = 1;
    this.grow[i] = grow;
    this.alphas[i] = 1;
  }

  reset() {
    this.alive = 0;
    this.geometry.setDrawRange(0, 0);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    let i = 0;
    while (i < this.alive) {
      this.lives[i] -= dt;
      if (this.lives[i] <= 0) {
        // swap with last alive
        const l = --this.alive;
        if (i !== l) {
          this.positions[i * 3] = this.positions[l * 3]; this.positions[i * 3 + 1] = this.positions[l * 3 + 1]; this.positions[i * 3 + 2] = this.positions[l * 3 + 2];
          this.velocities[i * 3] = this.velocities[l * 3]; this.velocities[i * 3 + 1] = this.velocities[l * 3 + 1]; this.velocities[i * 3 + 2] = this.velocities[l * 3 + 2];
          this.colors[i * 3] = this.colors[l * 3]; this.colors[i * 3 + 1] = this.colors[l * 3 + 1]; this.colors[i * 3 + 2] = this.colors[l * 3 + 2];
          this.sizes[i] = this.sizes[l]; this.lives[i] = this.lives[l]; this.maxLifes[i] = this.maxLifes[l];
          this.alphasInit[i] = this.alphasInit[l]; this.grow[i] = this.grow[l]; this.alphas[i] = this.alphas[l];
        }
        continue;
      }
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      // gravity-ish + drag for dust
      this.velocities[i * 3 + 1] -= 2.2 * dt;
      const t = this.lives[i] / this.maxLifes[i];
      this.alphas[i] = this.alphasInit[i] * t;
      if (this.grow[i]) this.sizes[i] += this.grow[i] * dt;
      i++;
    }
    // draw only the alive particles
    const geo = this.geometry;
    geo.setDrawRange(0, this.alive);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }
}

// Skid marks: one geometry per car, rebuilt from a small ring of segments.
const SKID_VERT = `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKID_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

class SkidCar {
  constructor(scene, maxSegs) {
    this.maxSegs = maxSegs;
    this.segments = []; // { x0,z0,x1,z1,nx,nz, born, wheel }
    this.positions = new Float32Array(maxSegs * 4 * 3);
    this.alphas = new Float32Array(maxSegs * 4);
    this.index = new Uint16Array(maxSegs * 6);
    for (let i = 0; i < maxSegs; i++) {
      const o = i * 6;
      this.index[o] = i * 4;
      this.index[o + 1] = i * 4 + 1;
      this.index[o + 2] = i * 4 + 2;
      this.index[o + 3] = i * 4 + 2;
      this.index[o + 4] = i * 4 + 1;
      this.index[o + 5] = i * 4 + 3;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.index, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0x14161a) } },
      vertexShader: SKID_VERT,
      fragmentShader: SKID_FRAG,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  addSegment(x0, y0, z0, x1, y1, z1, nx, nz, born) {
    this.segments.push({ x0, y0, z0, x1, y1, z1, nx, nz, born });
    if (this.segments.length > this.maxSegs) this.segments.shift();
  }

  rebuild(time, life, width) {
    // drop expired
    while (this.segments.length && time - this.segments[0].born > life) this.segments.shift();
    let n = 0;
    for (let i = 0; i < this.segments.length && n < this.maxSegs; i++) {
      const s = this.segments[i];
      const age = time - s.born;
      const alpha = clamp(1 - age / life, 0, 1) * 0.72;
      const hw = width * 0.5;
      const p = n * 12;
      this.positions[p] = s.x0 - s.nx * hw; this.positions[p + 1] = s.y0; this.positions[p + 2] = s.z0 - s.nz * hw;
      this.positions[p + 3] = s.x0 + s.nx * hw; this.positions[p + 4] = s.y0; this.positions[p + 5] = s.z0 + s.nz * hw;
      this.positions[p + 6] = s.x1 - s.nx * hw; this.positions[p + 7] = s.y1; this.positions[p + 8] = s.z1 - s.nz * hw;
      this.positions[p + 9] = s.x1 + s.nx * hw; this.positions[p + 10] = s.y1; this.positions[p + 11] = s.z1 + s.nz * hw;
      const o = n * 4;
      this.alphas[o] = alpha; this.alphas[o + 1] = alpha; this.alphas[o + 2] = alpha; this.alphas[o + 3] = alpha;
      n++;
    }
    this.geometry.setDrawRange(0, n * 6);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

export function createEffects(scene) {
  const texture = makeSoftCircleTexture();
  const sparks = new ParticleSystem(scene, { count: 460, blending: THREE.AdditiveBlending, texture });
  const dust = new ParticleSystem(scene, { count: 340, blending: THREE.NormalBlending, texture });
  // per-car skid ribbons created lazily by main (needs car ids)
  const skidsByCar = new Map();

  function ensureSkid(car) {
    if (!skidsByCar.has(car.seed)) {
      skidsByCar.set(car.seed, new SkidCar(scene, 100));
    }
    return skidsByCar.get(car.seed);
  }

  // spawn dust/sparks at a world position
  function spawnDust(x, y, z, opts = {}) {
    const spread = opts.spread ?? 1.1;
    const speed = opts.speed ?? 2.2;
    const color = opts.color || [0.62, 0.55, 0.46];
    const n = opts.count ?? 3;
    for (let i = 0; i < n; i++) {
      dust.spawn(
        x + (Math.random() - 0.5) * spread,
        y + Math.random() * 0.3,
        z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * speed,
        0.6 + Math.random() * 0.9,
        (Math.random() - 0.5) * speed,
        0.55 + Math.random() * 0.5,
        1.4 + Math.random() * 1.8,
        color,
        2.6
      );
    }
  }

  function spawnSparks(x, y, z, opts = {}) {
    const color = opts.color || [1.0, 0.78, 0.32];
    const n = opts.count ?? 8;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 10;
      sparks.spawn(
        x, y + 0.2, z,
        Math.cos(ang) * sp * 0.6,
        2 + Math.random() * 5,
        Math.sin(ang) * sp * 0.6,
        0.28 + Math.random() * 0.34,
        0.9 + Math.random() * 0.9,
        color,
        0
      );
    }
  }

  function addSkid(car, tipL, tipR, born, world) {
    const skid = ensureSkid(car);
    if (!car._skidTipL) {
      // first frame after a gap: just warm the tips, draw nothing
      car._skidTipL = { x: tipL.x, y: tipL.y, z: tipL.z };
      car._skidTipR = { x: tipR.x, y: tipR.y, z: tipR.z };
      return;
    }
    const movedL = Math.hypot(tipL.x - car._skidTipL.x, tipL.z - car._skidTipL.z);
    const movedR = Math.hypot(tipR.x - car._skidTipR.x, tipR.z - car._skidTipR.z);
    if (movedL < 0.06 && movedR < 0.06) return; // stationary — skip
    const y0 = car._skidTipL.y ?? tipL.y;
    const y1 = tipL.y;
    // left wheel segment
    if (movedL >= 0.06) {
      const dx = tipL.x - car._skidTipL.x, dz = tipL.z - car._skidTipL.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      skid.addSegment(car._skidTipL.x, y0 + 0.035, car._skidTipL.z, tipL.x, y1 + 0.035, tipL.z, nx, nz, born);
    }
    const y0r = car._skidTipR.y ?? tipR.y;
    const y1r = tipR.y;
    // right wheel segment
    if (movedR >= 0.06) {
      const dx = tipR.x - car._skidTipR.x, dz = tipR.z - car._skidTipR.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      skid.addSegment(car._skidTipR.x, y0r + 0.035, car._skidTipR.z, tipR.x, y1r + 0.035, tipR.z, nx, nz, born);
    }
    car._skidTipL = { x: tipL.x, y: tipL.y, z: tipL.z };
    car._skidTipR = { x: tipR.x, y: tipR.y, z: tipR.z };
  }

  function clearSkids(car) {
    car._skidTipL = undefined;
    car._skidTipR = undefined;
  }

  function clearCar(car) {
    clearSkids(car);
    const skid = skidsByCar.get(car.seed);
    if (skid) {
      skid.segments.length = 0;
    }
  }

  function rebuildSkids(time, world) {
    const life = 5.5;
    const width = 0.42;
    for (const [seed, skid] of skidsByCar) {
      skid.rebuild(time, life, width);
    }
  }

  // helper
  function surfaceAt(world, x, z) {
    const u = world.nearestU({ x, y: 0, z }, 0);
    const latPos = world.signedLateralAt({ x, y: 0, z }, u);
    return world.surfaceYAt(u, latPos);
  }

  function update(dt, time, cars, world) {
    sparks.update(dt);
    dust.update(dt);
    rebuildSkids(time, world);
  }

  function reset(cars) {
    sparks.reset();
    dust.reset();
    for (const skid of skidsByCar.values()) skid.segments.length = 0;
    if (Array.isArray(cars)) {
      for (const c of cars) {
        c._skidTipL = undefined;
        c._skidTipR = undefined;
      }
    }
  }

  return {
    sparks, dust,
    spawnDust, spawnSparks,
    addSkid, clearSkids, clearCar, reset,
    update,
    surfaceAt,
  };
}
