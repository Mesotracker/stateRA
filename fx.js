'use strict';
/* =====================================================================
   CITY.RA — fx.js
   Pooled particles (explosions, smoke, fire, sparks, debris, water,
   flares, contrails), temporary light sources and persistent decals.
   ===================================================================== */

const FX = {
  parts: [],
  pool: new Pool(() => ({})),
  lights: [],
  max: 4500,
  quality: 1,

  add(type, x, y, o) {
    if (this.parts.length >= this.max * this.quality) return null;
    const p = this.pool.get();
    p.type = type; p.x = x; p.y = y; p.z = o.z || 0; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0; p.max = o.max || 1; p.size = o.size || 3; p.grow = o.grow || 0; p.c = o.c || '#fff'; p.a = o.a || 0; p.va = o.va || 0; p.len = o.len || 0; p.drag = o.drag == null ? 0.9 : o.drag; p.alpha = o.alpha == null ? 1 : o.alpha; p.trail = !!o.trail;
    this.parts.push(p); return p;
  },

  light(x, y, r, life, col) { this.lights.push({ x, y, r, life, max: life, col: col || '255,190,110' }); },

  explosion(x, y, s = 1, opts = {}) {
    const q = this.quality, n = Math.round(14 * s * q) + 4;
    // 1. Blinding white-blue thermal core & multi-stage fireball glow
    this.add('glow', x, y, { size: 7 * s, grow: 85 * s, max: 0.08, c: '255,255,255' });
    this.add('glow', x, y, { size: 16 * s, grow: 38 * s, max: 0.24, c: '255,235,170' });
    this.add('glow', x, y, { size: 12 * s, grow: 18 * s, max: 0.55, c: '255,135,45' });
    this.add('glow', x, y, { size: 8 * s, grow: 10 * s, max: 0.85, c: '190,50,15', alpha: 0.7 });
    // 2. Supersonic condensation Mach ring + ground shock dust ring
    this.add('ring', x, y, { size: 3 * s, grow: 195 * s, max: 0.36, c: '255,250,240' });
    this.add('ring', x, y, { size: 5 * s, grow: 135 * s, max: 0.58, c: '205,185,155' });
    if (s >= 1.1) this.add('ring', x, y, { size: 8 * s, grow: 240 * s, max: 0.45, c: '240,210,170' });
    // 3. Roiling fireball lobes: white-yellow core -> orange -> crimson -> cooling soot
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, edge = Math.random(), v = U.rnd(10, 72) * s * (0.4 + edge * 0.8);
      const col = edge < 0.28 ? '255,250,210' : edge < 0.6 ? '255,' + (155 + U.rint(65)) + ',45' : edge < 0.85 ? '235,' + (70 + U.rint(45)) + ',20' : '160,35,12';
      this.add('fire', x + Math.cos(a) * 4 * s * edge, y + Math.sin(a) * 4 * s * edge, {
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - U.rnd(8, 26) * s,
        size: U.rnd(4.5, 10.5) * s, grow: U.rnd(8, 16) * s, max: U.rnd(0.32, 0.85),
        c: col, drag: 0.84
      });
    }
    // 4. High-velocity incandescent shrapnel & ember streaks
    const spkN = Math.round(n * 0.85);
    for (let i = 0; i < spkN; i++) {
      const a = Math.random() * Math.PI * 2, fast = i < spkN * 0.4, v = (fast ? U.rnd(140, 340) : U.rnd(55, 160)) * s;
      this.add('spark', x, y - 2, {
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - U.rnd(20, 65),
        size: fast ? 1.7 : 1.3, max: fast ? U.rnd(0.22, 0.5) : U.rnd(0.45, 1.1),
        c: fast ? '255,245,195' : '255,' + (140 + U.rint(80)) + ',50', drag: fast ? 0.91 : 0.95
      });
    }
    // 5. Base dust wave & billowing dark convection smoke plume
    const smN = Math.round(n * 1.05);
    for (let i = 0; i < smN; i++) {
      const a = Math.random() * Math.PI * 2, up = i < smN * 0.55, v = U.rnd(8, 42) * s;
      const shade = opts.dark ? (22 + U.rint(16)) : up ? (44 + U.rint(24)) : (135 + U.rint(30));
      const cStr = up || opts.dark ? `${shade},${shade - 3},${shade - 6}` : `${shade},${shade - 12},${shade - 28}`;
      this.add('smoke', x + U.rnd(-7, 7) * s, y + U.rnd(-7, 7) * s, {
        vx: Math.cos(a) * v * (up ? 0.38 : 1.55) + (G.wind ? Math.cos(G.wind) * 6 : 4),
        vy: up ? U.rnd(-54, -16) * s : Math.sin(a) * v * 0.7 - 4,
        size: U.rnd(6, 13) * s, grow: (up ? 22 : 28) * s, max: U.rnd(2.0, 4.4),
        c: cStr, alpha: up ? 0.68 : 0.46, drag: 0.94
      });
    }
    // 6. Ballistic chunks of earth/metal with smoke ribbons & ground bounce
    if (s >= 0.65) {
      const dbN = Math.round(n * 0.75);
      for (let i = 0; i < dbN; i++) {
        const a = Math.random() * Math.PI * 2, v = U.rnd(35, 175) * s;
        this.add('debris', x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: U.rnd(55, 185) * s,
          size: U.rnd(1.4, 3.4) * Math.min(1.6, Math.sqrt(s)), max: U.rnd(0.75, 1.65),
          a: Math.random() * 6.28, va: U.rnd(-14, 14),
          c: U.pick(['#2d2926', '#4c453d', '#1c1a18', '#6e5f50', '#847565', '#c86428']),
          drag: 0.97, trail: s >= 1.0 && i % 3 === 0
        });
      }
    }
    // 7. Secondary cook-off pops and rising mushroom stem on heavy blasts
    if (s >= 1.35) {
      for (let i = 0; i < 10; i++) {
        this.add('smoke', x + U.rnd(-12, 12) * s, y - U.rnd(4, 38) * s, {
          vx: U.rnd(-8, 8), vy: U.rnd(-48, -20), size: 11 * s, grow: 20 * s,
          max: U.rnd(3.2, 6.0), c: '38,34,30', alpha: 0.62, drag: 0.96
        });
      }
    }
    if (typeof Render !== 'undefined' && s >= 0.9) {
      Render.shake = Math.max(Render.shake || 0, Math.min(18, s * 4.2));
    }
    this.light(x, y, 115 * s, 0.65, '255,175,80');
  },

  smallHit(x, y, armored) {
    if (armored) { for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28, v = U.rnd(40, 120); this.add('spark', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 1.2, max: 0.25, c: '255,220,140' }); } }
    else this.add('dust', x, y, { size: 2.5, grow: 10, max: 0.5, c: '140,120,90', alpha: 0.5 });
  },
  muzzle(x, y, a, big) {
    this.add('glow', x + Math.cos(a) * 2, y + Math.sin(a) * 2, { size: big ? 7 : 3.5, grow: big ? 8 : 4, max: 0.08, c: '255,230,160' });
    if (big) { this.add('smoke', x + Math.cos(a) * 5, y + Math.sin(a) * 5, { vx: Math.cos(a) * 25, vy: Math.sin(a) * 25, size: 5, grow: 14, max: 1.2, c: '120,115,105', alpha: 0.45 }); this.light(x, y, 40, 0.1); }
  },
  smoke(x, y, s = 1, dark) { this.add('smoke', x + U.rnd(-3, 3), y + U.rnd(-3, 3), { vx: U.rnd(-4, 4) + 6, vy: U.rnd(-10, -3), size: 4 * s, grow: 10 * s, max: U.rnd(2, 4), c: dark ? '28,26,24' : '120,118,112', alpha: dark ? 0.6 : 0.4, drag: 0.98 }); },
  flame(x, y, s = 1) {
    this.add('fire', x + U.rnd(-5, 5) * s, y + U.rnd(-5, 5) * s, { vx: U.rnd(-6, 6), vy: U.rnd(-22, -8), size: U.rnd(3, 6) * s, grow: 4 * s, max: U.rnd(0.4, 0.8), c: '255,' + (90 + U.rint(110)) + ',30', drag: 0.95 });
    if (Math.random() < 0.3) this.smoke(x, y - 6, s, true);
  },
  water(x, y, s = 1) {
    this.add('ring', x, y, { size: 3, grow: 40 * s, max: 0.6, c: '220,240,255' });
    for (let i = 0; i < 6 * s; i++) { const a = Math.random() * 6.28, v = U.rnd(10, 50) * s; this.add('water', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: U.rnd(30, 90), size: U.rnd(1.5, 3), max: 0.8, c: '220,235,245' }); }
  },
  trail(x, y, dark) { this.add('smoke', x, y, { size: 2.2, grow: 7, max: dark ? 0.9 : 1.5, c: dark ? '90,86,80' : '215,215,210', alpha: 0.5, drag: 0.9 }); },
  flare(x, y) { for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28; this.add('flare', x, y, { vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 + 20, size: 2.4, max: 1.4, c: '255,240,200', drag: 0.96 }); } this.light(x, y, 50, 1); },
  heal(x, y) { this.add('plus', x + U.rnd(-6, 6), y + U.rnd(-6, 6), { vy: -14, size: 3, max: 0.9, c: '120,230,150' }); },
  spray(x, y, tx, ty) { const a = U.ang(x, y, tx, ty); for (let i = 0; i < 2; i++) this.add('water', x, y, { vx: Math.cos(a + U.rnd(-0.2, 0.2)) * 90, vy: Math.sin(a + U.rnd(-0.2, 0.2)) * 90, vz: 30, size: 1.6, max: 0.5, c: '200,225,245' }); },

  update(dt) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life += dt;
      if (p.life >= p.max) { P[i] = P[P.length - 1]; P.pop(); this.pool.put(p); continue; }
      const dr = Math.pow(p.drag, dt * 30);
      p.vx *= dr; p.vy *= dr; p.x += p.vx * dt; p.y += p.vy * dt; p.size += p.grow * dt;
      if (p.va) p.a += p.va * dt;
      if (p.type === 'debris' || p.type === 'water') {
        p.vz -= 290 * dt; p.z += p.vz * dt;
        if (p.trail && p.z > 3 && Math.random() < 0.45) this.add('smoke', p.x, p.y - p.z * 0.4, { size: 1.6, grow: 5, max: 0.55, c: '75,70,64', alpha: 0.38, drag: 0.9 });
        if (p.z < 0) { p.z = 0; p.vz *= -0.32; p.vx *= 0.55; p.vy *= 0.55; p.va *= 0.5; }
      }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) { const l = this.lights[i]; l.life -= dt; if (l.life <= 0) this.lights.splice(i, 1); }
  },

  draw(x, view) {
    const P = this.parts, x0 = view.x0 - 60, x1 = view.x1 + 60, y0 = view.y0 - 60, y1 = view.y1 + 60;
    x.globalCompositeOperation = 'source-over';
    for (const p of P) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const k = p.life / p.max;
      if (p.type === 'smoke' || p.type === 'dust') {
        const a = p.alpha * (1 - k) * (k < 0.1 ? k * 10 : 1); if (a < 0.01) continue;
        const r = p.size * 1.7; x.globalAlpha = Math.min(1, a); x.drawImage(SPR.puff(p.c), p.x - r, p.y - p.life * 5 - r, r * 2, r * 2);
      } else if (p.type === 'debris') {
        if (p.z > 1) { x.globalAlpha = 0.28 * (1 - k); x.fillStyle = '#000'; x.fillRect(p.x - p.size * 0.4, p.y - p.size * 0.4, p.size * 0.8, p.size * 0.8); }
        x.save(); x.globalAlpha = Math.min(1, (1 - k) * 1.4); x.translate(p.x, p.y - p.z * 0.45); if (p.a) x.rotate(p.a);
        x.fillStyle = p.c; x.fillRect(-p.size * 0.6, -p.size * 0.4, p.size * 1.2, p.size * 0.8); x.restore();
      } else if (p.type === 'water') {
        x.globalAlpha = 1 - k; x.fillStyle = 'rgb(' + p.c + ')'; x.fillRect(p.x - p.size / 2, p.y - p.z * 0.4, p.size, p.size);
      } else if (p.type === 'plus') {
        x.globalAlpha = 1 - k; x.fillStyle = 'rgb(' + p.c + ')'; x.fillRect(p.x - 3, p.y - 0.8, 6, 1.6); x.fillRect(p.x - 0.8, p.y - 3, 1.6, 6);
      }
    }
    x.globalCompositeOperation = 'lighter';
    for (const p of P) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const k = p.life / p.max;
      if (p.type === 'fire' || p.type === 'glow' || p.type === 'flare') {
        const r = Math.max(0.6, p.size * (p.type === 'fire' ? 1.85 - k * 0.75 : 1.6));
        x.globalAlpha = Math.max(0, (1 - k) * (p.type === 'glow' ? 0.88 : 1)); x.drawImage(SPR.puff(p.c), p.x - r, p.y - r, r * 2, r * 2);
      } else if (p.type === 'spark') {
        x.globalAlpha = Math.max(0, 1 - k * k); x.strokeStyle = 'rgb(' + p.c + ')'; x.lineWidth = p.size || 1.2;
        x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * 0.038, p.y - p.vy * 0.038); x.stroke();
      } else if (p.type === 'ring') {
        x.globalAlpha = 1; x.strokeStyle = 'rgba(' + p.c + ',' + ((1 - k) * (1 - k) * 0.62).toFixed(3) + ')'; x.lineWidth = 3.2 * (1 - k) + 0.5;
        x.beginPath(); x.arc(p.x, p.y, p.size, 0, 6.283); x.stroke();
      }
    }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  },
};

/* persistent ground decals: craters and scorch marks, baked into terrain chunks */
const Decals = {
  add(x, y, r, kind = 'crater') {
    const M = G.map; if (!M) return;
    M.craters.push([Math.round(x), Math.round(y), Math.round(r), kind === 'scorch' ? 1 : 0]);
    if (M.craters.length > 2500) M.craters.splice(0, 200);
    if (typeof Render !== 'undefined') Render.stampDecal(x, y, r, kind);
  },
  draw(x, cx, cy, r, kind) {
    const seed = ((cx * 73 + cy * 151) | 0) & 1023;
    if (kind === 1 || kind === 'scorch') {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 1.25);
      g.addColorStop(0, 'rgba(16,14,12,0.68)');
      g.addColorStop(0.5, 'rgba(28,24,20,0.38)');
      g.addColorStop(1, 'rgba(20,18,16,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r * 1.25, 0, 6.283); x.fill();
      if (r >= 6) {
        x.strokeStyle = 'rgba(18,15,12,0.28)'; x.lineWidth = Math.max(0.8, r * 0.08);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * 6.283 + hash2(seed, i, 11) * 0.7, len = r * (0.7 + hash2(seed, i, 12) * 0.65);
          x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2);
          x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); x.stroke();
        }
      }
      return;
    }
    // Outer ejecta blanket & radial blast rays
    const outer = x.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.35);
    outer.addColorStop(0, 'rgba(35,30,24,0.45)');
    outer.addColorStop(0.55, 'rgba(78,68,54,0.28)');
    outer.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = outer; x.beginPath(); x.arc(cx, cy, r * 1.35, 0, 6.283); x.fill();
    // Raised crater rim (sunlit NW, shaded SE)
    x.strokeStyle = 'rgba(135,120,98,0.38)'; x.lineWidth = Math.max(1.2, r * 0.18);
    x.beginPath(); x.arc(cx + r * 0.04, cy + r * 0.04, r * 0.78, -0.4, 2.7); x.stroke();
    x.strokeStyle = 'rgba(25,20,16,0.52)';
    x.beginPath(); x.arc(cx - r * 0.03, cy - r * 0.03, r * 0.78, 2.7, 5.88); x.stroke();
    // Deep crater pit
    const pit = x.createRadialGradient(cx - r * 0.1, cy - r * 0.1, 0, cx, cy, r * 0.78);
    pit.addColorStop(0, 'rgba(18,15,12,0.88)');
    pit.addColorStop(0.6, 'rgba(42,36,29,0.72)');
    pit.addColorStop(0.88, 'rgba(92,80,65,0.35)');
    pit.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = pit; x.beginPath(); x.arc(cx, cy, r * 0.8, 0, 6.283); x.fill();
    // Scattered rubble clods around crater lip
    if (r >= 8) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283 + hash2(seed, i, 3) * 0.6, d = r * (0.68 + hash2(seed, i, 4) * 0.45), sz = 1 + hash2(seed, i, 5) * Math.min(3, r * 0.14);
        x.fillStyle = i % 2 ? 'rgba(45,38,32,0.65)' : 'rgba(115,102,84,0.55)';
        x.fillRect(cx + Math.cos(a) * d - sz / 2, cy + Math.sin(a) * d - sz / 2, sz, sz);
      }
    }
  },
};
