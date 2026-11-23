// HUD: speed, position, lap, drift meter, messages, minimap.

import { clamp } from './util.js';

export function createHUD(world) {
  const el = {
    speed: document.getElementById('hud-speed'),
    position: document.getElementById('hud-position'),
    lap: document.getElementById('hud-lap'),
    message: document.getElementById('hud-message'),
    driftFill: document.getElementById('hud-drift-fill'),
    minimap: document.getElementById('minimap'),
    hud: document.getElementById('hud'),
  };

  // --- minimap prerender ---
  const cvs = el.minimap;
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of world.samples) {
    if (s.pos.x < minX) minX = s.pos.x;
    if (s.pos.x > maxX) maxX = s.pos.x;
    if (s.pos.z < minZ) minZ = s.pos.z;
    if (s.pos.z > maxZ) maxZ = s.pos.z;
  }
  const pad = 22;
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ);
  const offX = (W - spanX * scale) / 2 - minX * scale;
  const offZ = (H - spanZ * scale) / 2 - minZ * scale;

  function toMap(x, z) {
    return [x * scale + offX, z * scale + offZ];
  }

  // prerender track outline into an offscreen canvas
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const offCtx = off.getContext('2d');

  // backdrop
  offCtx.fillStyle = 'rgba(8,12,18,0.35)';
  offCtx.fillRect(0, 0, W, H);

  // track outline (stroke with wide width, then thin center)
  offCtx.lineJoin = 'round';
  offCtx.lineCap = 'round';
  offCtx.strokeStyle = 'rgba(255,255,255,0.92)';
  offCtx.lineWidth = 13;
  offCtx.beginPath();
  for (let i = 0; i <= world.samples.length; i++) {
    const s = world.samples[i % world.samples.length];
    const [mx, my] = toMap(s.pos.x, s.pos.z);
    if (i === 0) offCtx.moveTo(mx, my);
    else offCtx.lineTo(mx, my);
  }
  offCtx.closePath();
  offCtx.stroke();

  offCtx.strokeStyle = 'rgba(20,26,34,0.95)';
  offCtx.lineWidth = 8;
  offCtx.beginPath();
  for (let i = 0; i <= world.samples.length; i++) {
    const s = world.samples[i % world.samples.length];
    const [mx, my] = toMap(s.pos.x, s.pos.z);
    if (i === 0) offCtx.moveTo(mx, my);
    else offCtx.lineTo(mx, my);
  }
  offCtx.closePath();
  offCtx.stroke();

  // start line marker (at u=0)
  {
    const s = world.samples[0];
    const [sx, sy] = toMap(s.pos.x, s.pos.z);
    const t = s.tangent;
    const tt = Math.atan2(t.x, t.z);
    const nx = Math.cos(tt), nz = -Math.sin(tt);
    const halfW = 13;
    offCtx.strokeStyle = '#ffd34d';
    offCtx.lineWidth = 4;
    offCtx.beginPath();
    offCtx.moveTo(sx - nx * halfW, sy - nz * halfW);
    offCtx.lineTo(sx + nx * halfW, sy + nz * halfW);
    offCtx.stroke();
  }

  let messageTimer = null;
  let lastMessage = '';

  return {
    setPosition(pos) {
      el.position.textContent = 'P' + pos;
    },
    setLap(lap) {
      el.lap.textContent = 'LAP ' + lap;
    },
    setSpeed(kmh) {
      el.speed.textContent = String(Math.max(0, Math.round(kmh)));
    },
    setDrift(amount) {
      el.driftFill.style.width = Math.round(clamp(amount, 0, 1) * 100) + '%';
    },
    setMessage(text, ms = 1600) {
      if (!text) return;
      el.message.textContent = text;
      el.message.classList.add('show');
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = setTimeout(() => { el.message.classList.remove('show'); }, ms);
    },
    hideMessage() {
      el.message.classList.remove('show');
    },
    setHidden(hidden) {
      el.hud.classList.toggle('hidden', hidden);
    },
    drawMinimap(cars, playerSeed) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0);
      // AI dots
      for (const c of cars) {
        if (c.isPlayer) continue;
        const [mx, my] = toMap(c.pos.x, c.pos.z);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // player dot
      const p = cars[0];
      const [pmx, pmy] = toMap(p.pos.x, p.pos.z);
      ctx.fillStyle = '#ffd34d';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pmx, pmy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // player heading tick
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(pmx, pmy);
      ctx.lineTo(pmx + fx * 12, pmy + fz * 12);
      ctx.stroke();
    },
  };
}
