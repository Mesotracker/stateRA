'use strict';
/* =====================================================================
   CITY.RA — strike.js
   Strategic strikes: silos arm conventional or nuclear missiles, launch
   them at any point inside their range (real km, scaled by the map),
   missiles fly visible trajectories, missile defence batteries try to
   intercept, impacts devastate areas and nuclear detonations are scaled
   by yield in real kilometres and leave drifting radioactive fallout.
   ===================================================================== */

const Strike = {
  list: [], interceptors: [], waves: [], clouds: [], later: [],

  reset() { this.list = []; this.interceptors = []; this.waves = []; this.clouds = []; this.later = []; this.zones = []; Fall.reset(); },

  km() { return (G.map && G.map.km) || 0.5; },
  distKm(ax, ay, bx, by) { return (Math.hypot(bx - ax, by - ay) / TILE) * this.km(); },
  unlocked(f, kind) { const M = MISSILES[kind]; return !M.tech || f.tech.has(M.tech) || (G.cfg.instant && f.isPlayer); },
  inRange(b, kind, x, y) { return this.distKm(b.x, b.y, x, y) <= MISSILES[kind].rangeKm; },

  /* blast radii of a nuclear detonation of Y kilotons, in pixels. Real-world scaling laws:
     fireball ~ Y^0.4, 20 psi ~ Y^(1/3), 5 psi ~ Y^(1/3), 1 psi ~ Y^(1/3), thermal burns ~ Y^0.42 */
  radiiKm(Y) { const c = Math.cbrt(Y); return { fire: 0.07 * Math.pow(Y, 0.4), heavy: 0.22 * c, mod: 0.65 * c, light: 1.8 * c, therm: 0.6 * Math.pow(Y, 0.42) }; },
  radii(Y) {
    // Accurate ground scaling: 1 tile = km() real km, no inflated cascade.
    // Each radius converts straight from km to px; only a tiny visibility
    // floor (0.6 tile) keeps sub-pixel strategic-scale blasts drawable.
    const k = this.radiiKm(Y), km = this.km(), px = (v) => (v / km) * TILE;
    const fl = 0.6 * TILE;
    const fire = Math.max(px(k.fire), fl), heavy = Math.max(px(k.heavy), fl), mod = Math.max(px(k.mod), fl), light = Math.max(px(k.light), fl), therm = Math.max(px(k.therm), fl);
    // Physical mushroom-cloud top height: ~5 * Y^0.2 km (10 kt -> 8 km, 1.5 Mt -> 21 km)
    const cloudH = Math.max(120, px(5 * Math.pow(Y, 0.2)));
    return { fire, heavy, mod, light, therm, cloudH, km: k };
  },
  blastPx(kind) { const M = MISSILES[kind]; return M.nuke ? this.radii(M.yieldKt).mod : M.splash; },

  arm(b, kind) {
    const f = fac(b.owner), M = MISSILES[kind];
    if (b.load) return [false, 'This silo is already ' + (b.load.t >= b.load.T ? 'armed' : 'arming')];
    if (!this.unlocked(f, kind)) return [false, 'Research ' + TECH[M.tech].name + ' first'];
    if (!Eco.canAfford(f, M.cost)) return [false, 'Needs ' + Eco.missing(f, M.cost).join(', ')];
    Eco.pay(f, M.cost); b.load = { kind, t: 0, T: M.time };
    return [true, M.name + ' arming'];
  },
  ready(b) { return b.load && b.load.t >= b.load.T; },

  launch(b, x, y) {
    if (!this.ready(b)) return false;
    const kind = b.load.kind, M = MISSILES[kind], dist = Math.hypot(x - b.x, y - b.y), dkm = this.distKm(b.x, b.y, x, y);
    if (dkm > M.rangeKm) { if (b.owner === G.player) Bus.emit('msg', 'Target is ' + Math.round(dkm).toLocaleString() + ' km away — ' + M.short + ' range is ' + M.rangeKm.toLocaleString() + ' km', 'warn', x, y); return false; }
    const T = Math.max(5, 6 + dkm / M.kmps + (M.flight === 'ballistic' ? 5 : 0));
    const m = { id: newId(), kind, flight: M.flight, owner: b.owner, sx: b.x, sy: b.y - 6, tx: x, ty: y, t: 0, T, x: b.x, y: b.y, z: 0, dead: false, tried: new Set(), weave: Math.random() * 6 };
    this.list.push(m); b.load = null; b.lastLaunch = G.time;
    FX.explosion(b.x, b.y, 0.6, {}); for (let i = 0; i < 14; i++) FX.smoke(b.x + U.rnd(-14, 14), b.y + U.rnd(-14, 14), 2.2);
    Bus.emit('sfx', 'launch', b.x, b.y, 1.5);
    const P = G.player, secs = Math.round(T);
    if (b.owner === P) Bus.emit('msg', M.name + ' away — impact in ' + secs + ' s', 'warn', x, y);
    else {
      const rr = (M.nuke ? this.radii(M.yieldKt).light : 22 * TILE);
      const threatened = G.blds.some((o) => o.owner === P && Math.hypot(o.x - x, o.y - y) < Math.max(22 * TILE, rr)) || G.units.some((u) => u.owner === P && Math.hypot(u.x - x, u.y - y) < Math.max(12 * TILE, rr * 0.6)) || G.settlements.some((s) => s.ctrl === P && Math.hypot(s.x - x, s.y - y) < rr);
      if (threatened || fac(P).radar) { m.shown = true; Bus.emit('msg', (threatened ? 'INCOMING ' : 'Radar: ') + M.name.toLowerCase() + ' launched by ' + fac(b.owner).short + (threatened ? ' — impact in ' + secs + ' s' : ''), threatened ? 'bad' : 'warn', x, y); if (threatened) Bus.emit('sfx', 'siren'); }
    }
    for (const f of G.factions) if (f.ai && f.id !== b.owner) f.ai.threatened = true;
    // launching at someone counts as an act of war against them
    const R0 = Math.max(14 * TILE, M.nuke ? this.radii(M.yieldKt).mod : 0);
    for (const o of G.blds) if (o.owner !== b.owner && o.owner >= 0 && Math.hypot(o.x - x, o.y - y) < R0 && G.dip[b.owner][o.owner].stance !== 'war') { Dip.set(b.owner, o.owner, 'war'); }
    return true;
  },

  pos(m, k) {
    const fl = m.flight || MISSILES[m.kind].flight;
    if (fl === 'cruise') {
      const a = Math.atan2(m.ty - m.sy, m.tx - m.sx), w = Math.sin(k * 14 + m.weave) * 10 * Math.sin(k * Math.PI);
      return { x: U.lerp(m.sx, m.tx, k) - Math.sin(a) * w, y: U.lerp(m.sy, m.ty, k) + Math.cos(a) * w, z: k < 0.06 ? (k / 0.06) * 40 : k > 0.94 ? ((1 - k) / 0.06) * 40 : 40 };
    }
    const h = Math.hypot(m.tx - m.sx, m.ty - m.sy);
    if (fl === 'hyper') {
      const kk = k < 0.2 ? (k / 0.2) * 0.12 : 0.12 + ((k - 0.2) / 0.8) * 0.88, up = 520 + Math.min(900, h * 0.08);
      const z = k < 0.2 ? (k / 0.2) * up : k > 0.97 ? 0 : up * (1 - (k - 0.2) / 0.8) * (0.4 + 0.6 * Math.abs(Math.sin((k - 0.2) * 17))) * 0.7;
      return { x: U.lerp(m.sx, m.tx, kk), y: U.lerp(m.sy, m.ty, kk), z };
    }
    // ballistic: boost nearly vertical, then a high arc, steep re-entry
    const apex = 700 + Math.min(1700, h * 0.25);
    const kk = k < 0.15 ? (k / 0.15) * 0.02 : 0.02 + ((k - 0.15) / 0.85) * 0.98;
    const z = k < 0.15 ? (k / 0.15) * apex * 0.55 : apex * (0.55 + 0.45 * Math.sin(((k - 0.15) / 0.85) * Math.PI)) * (k > 0.8 ? Math.pow(1 - (k - 0.8) / 0.2, 1.6) : 1);
    return { x: U.lerp(m.sx, m.tx, kk), y: U.lerp(m.sy, m.ty, kk), z: k > 0.98 ? 0 : z };
  },

  abmR(b) { const f = fac(b.owner); return U.clamp(100 / this.km(), b.d.abm, 70) * TILE * (f.tech.has('radarguide') ? 1.25 : 1) * (f.radar ? 1 : 0.7); },

  update(dt) {
    // silo arming
    for (const b of G.blds) {
      if (b.dead || !b.d.silo || !b.load || b.built < 1) continue;
      const f = fac(b.owner); b.load.t = Math.min(b.load.T, G.cfg.instant && f.isPlayer ? b.load.T : b.load.t + dt * (f.lowPower ? 0.4 : 1) * (f.isAI ? f.aiSpeed || 1 : 1));
      if (b.load.t >= b.load.T && !b.load.msg) { b.load.msg = true; if (b.owner === G.player) { Bus.emit('msg', MISSILES[b.load.kind].name + ' armed — select the silo and choose a target', 'good', b.x, b.y); Bus.emit('sfx', 'ready'); } }
    }
    for (const b of G.blds) if (!b.dead && b.d.abm) b.abmCool = Math.max(0, (b.abmCool || 0) - dt);
    // delayed effects (blast waves arriving, bomblets)
    if (this.later.length) { const run = this.later.filter((e) => G.time >= e.t); if (run.length) { this.later = this.later.filter((e) => G.time < e.t); for (const e of run) e.fn(); } }
    // missiles in flight
    for (const m of this.list) {
      if (m.dead) continue;
      m.t += dt; const k = Math.min(1, m.t / m.T), p = this.pos(m, k);
      m.px = m.x; m.py = m.y; m.pz = m.z; m.x = p.x; m.y = p.y; m.z = p.z; m.k = k;
      const sy = m.y - m.z * 0.35, big = MISSILES[m.kind].nuke ? 1.5 : 1;
      if (m.flight === 'cruise') { if (Math.random() < 0.9) FX.trail(m.x, sy, false); }
      else if (m.flight === 'hyper') { if (k > 0.2) FX.add('glow', m.x, sy, { size: 5, grow: 3, max: 0.18, c: '255,170,255' }); if (Math.random() < 0.7) FX.trail(m.x, sy, true); }
      else if (k < 0.2 || k > 0.82) { for (let i = 0; i < 2; i++) FX.add('smoke', m.x + U.rnd(-2, 2), sy + U.rnd(-2, 2), { size: (k < 0.2 ? 4 : 2.5) * big, grow: k < 0.2 ? 12 : 6, max: k < 0.2 ? 4 : 1.5, c: '235,232,225', alpha: 0.55, drag: 0.95 }); if (k > 0.82) FX.add('glow', m.x, sy, { size: 6, grow: 4, max: 0.12, c: '255,220,170' }); }
      // interception
      if (k > 0.05) this.tryIntercept(m, k);
      if (k >= 1) this.impact(m);
    }
    for (const it of this.interceptors) {
      it.t += dt; const m = this.list.find((q) => q.id === it.mid);
      if (m && !m.dead) { it.tx = m.x; it.ty = m.y - m.z * 0.35; }
      const kk = Math.min(1, it.t / it.T); it.x = U.lerp(it.sx, it.tx, kk); it.y = U.lerp(it.sy, it.ty, kk) - Math.sin(kk * Math.PI) * 60;
      if (Math.random() < 0.9) FX.trail(it.x, it.y, false);
      if (kk >= 1) {
        it.dead = true;
        if (m && !m.dead) {
          if (it.hit) { m.dead = true; FX.explosion(m.x, m.y - m.z * 0.35, m.flight !== 'cruise' ? 1.6 : 1); FX.light(m.x, m.y, 200, 0.6); Bus.emit('sfx', 'boom', m.x, m.y, 1.2);
            Bus.emit('msg', MISSILES[m.kind].name + ' intercepted by ' + fac(it.owner).short + ' missile defence' + (MISSILES[m.kind].nuke ? ' — warhead did not detonate' : ''), it.owner === G.player ? 'good' : m.owner === G.player ? 'bad' : 'info', m.x, m.y); }
          else FX.explosion(it.x, it.y, 0.5);
        }
      }
    }
    if (this.list.some((m) => m.dead)) this.list = this.list.filter((m) => !m.dead);
    if (this.interceptors.some((i) => i.dead)) this.interceptors = this.interceptors.filter((i) => !i.dead);
    for (const w of this.waves) w.t += dt; if (this.waves.some((w) => w.t > w.T)) this.waves = this.waves.filter((w) => w.t <= w.T);
    for (const c of this.clouds) c.t += dt; if (this.clouds.some((c) => c.t > c.life)) this.clouds = this.clouds.filter((c) => c.t <= c.life);
    Fall.update(dt);
  },

  tryIntercept(m, k) {
    if (m.flight === 'ballistic' && k < 0.78) return;
    if (m.flight === 'hyper' && k < 0.6) return;
    for (const b of G.blds) {
      if (b.dead || !b.d.abm || b.built < 1 || m.tried.has(b.id) || (b.abmCool || 0) > 0) continue;
      if (friendly(b.owner, m.owner)) continue;
      const f = fac(b.owner); if (f.lowPower) continue;
      if (Math.hypot(b.x - m.x, b.y - m.y) > this.abmR(b)) continue;
      m.tried.add(b.id); b.abmCool = 7;
      const chance = MISSILES[m.kind].hitChance * (f.tech.has('radarguide') ? 1.15 : 1) * (f.radar ? 1 : 0.8);
      this.interceptors.push({ mid: m.id, owner: b.owner, sx: b.x, sy: b.y, x: b.x, y: b.y, tx: m.x, ty: m.y - m.z * 0.35, t: 0, T: 1.3, hit: Math.random() < chance });
      FX.muzzle(b.x, b.y, -Math.PI / 2, true); Bus.emit('sfx', 'missile', b.x, b.y);
      if (b.owner === G.player) Bus.emit('msg', 'Missile defence engaging', 'info', b.x, b.y);
      break;
    }
  },

  /* ---------- impacts ---------- */
  impact(m) {
    m.dead = true;
    const M = MISSILES[m.kind];
    if (M.nuke) return this.nuclear(m);
    const x = m.tx, y = m.ty, R = M.splash, ballistic = m.flight !== 'cruise', heavy = M.dmg >= 1400 || M.fuelAir;
    if (M.bomblets) return this.cluster(m);
    FX.explosion(x, y, R / 34, { dark: true });
    FX.add('ring', x, y, { size: 10, grow: R * 5, max: 0.9, c: '255,245,230' });
    FX.add('glow', x, y, { size: R * 0.6, grow: R * 1.4, max: 0.6, c: M.fuelAir ? '255,170,90' : '255,230,180' });
    for (let i = 0; i < (heavy ? 26 : 12); i++) { const a = Math.random() * 6.28, d = Math.random() * R * 0.8; this.later.push({ t: G.time + i * 0.04, fn: () => FX.explosion(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.8 + Math.random()) }); }
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, d = Math.random() * R; FX.add('smoke', x + Math.cos(a) * d, y + Math.sin(a) * d, { vx: Math.cos(a) * 20, vy: Math.sin(a) * 20 - 8, size: 18, grow: 26, max: U.rnd(6, 12), c: '45,40,36', alpha: 0.6, drag: 0.97 }); }
    FX.light(x, y, R * 3, 1.6, '255,200,140');
    Render.shake = Math.max(Render.shake || 0, heavy ? 22 : 10); Render.flash = Math.max(Render.flash || 0, heavy ? 0.7 : 0.3);
    World.blast(x, y, R, M.dmg, 'he', m.owner, 0);
    if (heavy) World.blast(x, y, R * 0.45, M.dmg * 0.8, 'demo', m.owner, 0);
    for (const e of G.hash.query(x, y, R * 1.3, World.tmp).slice()) if ((e.kind === 'civb' && !e.rubble) || e.kind === 'bld') if (Math.random() < (M.fuelAir ? 0.95 : 0.7)) e.burn = Math.max(e.burn, 0.7);
    for (let i = 0; i < 6; i++) Decals.add(x + U.rnd(-R, R) * 0.5, y + U.rnd(-R, R) * 0.5, R * U.rnd(0.2, 0.4), 'crater');
    Decals.add(x, y, R * 0.9, 'scorch');
    this.clearTrees(x, y, R, 0.8);
    const toll = this.areaToll(x, y, [[R * 0.3, heavy ? 0.7 : 0.45], [R * 0.7, heavy ? 0.22 : 0.1], [R * 1.1, 0]], [[R * 0.3, 0.25], [R * 0.7, 0.35], [R * 1.3, 0.1], [R * 1.7, 0]], R * 1.7, m.owner, 'strike', 8, M.leth || 0.05);
    const s = Civ.settAt(x, y, 4);
    if (s) { s.danger = 100; Civ.blame(m.owner, s, heavy ? -40 : -18, heavy ? -15 : -6); for (const f of G.factions) if (f.id !== m.owner) G.dip[f.id][m.owner].opinion -= FACTIONS[f.key].humane * (heavy ? 30 : 12); }
    Bus.emit('msg', 'Strategic strike' + (s ? ' on ' + s.name : '') + ' — ' + M.name + (toll.dead + toll.inj ? ' — ' + U.num(toll.dead) + ' killed, ' + U.num(toll.inj) + ' injured' : ''), m.owner === G.player ? 'warn' : 'bad', x, y);
    Bus.emit('sfx', 'bigboom', x, y, 3);
  },

  cluster(m) {
    const M = MISSILES[m.kind], x = m.tx, y = m.ty;
    Bus.emit('sfx', 'whistle', x, y);
    for (let i = 0; i < M.bomblets; i++) {
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * M.spread, bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
      this.later.push({ t: G.time + 0.1 + Math.random() * 1.6, fn: () => {
        FX.explosion(bx, by, 0.7); World.blast(bx, by, M.splash, M.dmg, 'he', m.owner, 0);
        for (const e of G.hash.query(bx, by, M.splash, World.tmp).slice()) if ((e.kind === 'civb' && !e.rubble) || e.kind === 'bld') if (Math.random() < 0.3) e.burn = Math.max(e.burn, 0.6);
      } });
    }
    FX.light(x, y, M.spread * 2, 2, '255,200,140'); Render.shake = Math.max(Render.shake || 0, 8);
    const toll = this.areaToll(x, y, [[M.spread * 0.6, 0.07], [M.spread * 1.1, 0.02], [M.spread * 1.4, 0]], [[M.spread * 0.6, 0.14], [M.spread * 1.2, 0.05], [M.spread * 1.5, 0]], M.spread * 1.5, m.owner, 'strike', 8, M.leth || 0.06);
    const s = Civ.settAt(x, y, 4);
    if (s) { s.danger = 100; Civ.blame(m.owner, s, -30, -10); for (const f of G.factions) if (f.id !== m.owner) G.dip[f.id][m.owner].opinion -= FACTIONS[f.key].humane * 22; }
    Bus.emit('msg', 'Cluster strike' + (s ? ' on ' + s.name : '') + (toll.dead + toll.inj ? ' — ' + U.num(toll.dead) + ' killed, ' + U.num(toll.inj) + ' injured' : ''), m.owner === G.player ? 'warn' : 'bad', x, y);
  },

  clearTrees(x, y, R, p) {
    const M2 = G.map, r = Math.ceil(R / TILE), cx = (x / TILE) | 0, cy = (y / TILE) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const tx = cx + dx, ty = cy + dy; if (tx >= 0 && ty >= 0 && tx < M2.w && ty < M2.h && dx * dx + dy * dy <= r * r && Math.random() < p) M2.tree[ty * M2.w + tx] = 0; }
    Render.invalidate(cx, cy, r + 1);
  },

  /* civilian toll of a blast: each building in a town holds its share of the people, and each share is hit according to its distance from ground zero.
     deadPts / hurtPts are [distance, fraction] pairs, linear in between. */
  areaToll(x, y, deadPts, hurtPts, reach, owner, cause, hold, lethKm) {
    this.zones = this.zones || []; this.zones.push({ x, y, R: reach, t: G.time, d: hold || 30 });
    const lerp = (d, pts) => {
      if (d <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (d <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0]); }
      return 0;
    };
    let tD = 0, tI = 0;
    for (const st of G.settlements) {
      if (Math.hypot(st.x - x, st.y - y) > reach + st.r * TILE || st.pop <= 0) continue;
      let wsum = 0, kd = 0, ki = 0;
      for (const id of st.blds) {
        const c = G.ents.get(id); if (!c || !c.d) continue;
        const w = (c.d.res || 0) + (c.d.jobs || 0) * 0.25 + (c.rubble ? 0 : 0.2); if (w <= 0) continue;
        const d = Math.hypot(c.x - x, c.y - y), pd = lerp(d, deadPts), pi = Math.min(1 - pd, lerp(d, hurtPts));
        wsum += w; kd += w * pd; ki += w * pi;
      }
      if (wsum <= 0) { const d = Math.hypot(st.x - x, st.y - y); wsum = 1; kd = lerp(d, deadPts); ki = Math.min(1 - kd, lerp(d, hurtPts)); }
      const people = st.pop * (st.mult || 1); let nd = Civ.acc(st, 'a' + cause, people * kd / wsum), ni = Civ.acc(st, 'ai' + cause, people * ki / wsum);
      if (lethKm) { // a conventional warhead cannot kill more people than live inside its real lethal footprint
        const area = Math.PI * Math.pow(Math.max(1.5, st.r) * this.km(), 2), dens = (people / area) * 1.8;
        nd = Math.min(nd, Math.ceil(dens * Math.PI * lethKm * lethKm * 0.8));
        ni = Math.min(ni, Math.ceil(dens * Math.PI * Math.pow(lethKm * 3, 2) * 0.45));
      }
      if (nd + ni <= 0) continue;
      Civ.ledger(st, nd, ni, owner, cause);
      st.danger = 100; st.happy = Math.max(0, st.happy - 4 - 55 * (kd / wsum) - 20 * (ki / wsum));
      tD += nd; tI += ni;
      if (owner >= 0 && nd > 0) Civ.blame(owner, st, -Math.min(120, 8 + nd / (st.mult || 1) * 0.05), -Math.min(40, 2 + nd / (st.mult || 1) * 0.02));
    }
    return { dead: tD, inj: tI };
  },
  nukeToll(x, y, R, owner) {
    return this.areaToll(x, y,
      [[R.heavy, 0.98], [R.mod, 0.52], [R.light, 0.05], [R.light * 1.25, 0]],                                   // killed: blast, burns, collapse
      [[R.heavy, 0.02], [R.mod, 0.38], [R.light, 0.32], [R.therm * 1.1, 0.12], [R.therm * 1.6, 0]],            // injured: burns, glass, debris
      Math.max(R.light * 1.3, R.therm * 1.6), owner, 'blast', 30);
  },

  /* ---------- nuclear detonation ---------- */
  nuclear(m) {
    const M = MISSILES[m.kind], Y = M.yieldKt, x = m.tx, y = m.ty, R = this.radii(Y), now = G.time;
    // flash, shock, light
    Render.flash = 1; Render.shake = Math.max(Render.shake || 0, 14 + Math.min(40, Math.log10(Y + 1) * 14));
    FX.light(x, y, R.light, 6, '255,235,200');
    FX.add('glow', x, y, { size: R.fire * 0.6, grow: R.fire * 2.2, max: 1.6, c: '255,250,225' });
    FX.add('glow', x, y, { size: R.fire * 0.4, grow: R.heavy * 0.9, max: 2.6, c: '255,190,90' });
    Bus.emit('sfx', 'bigboom', x, y, 6);
    // double flash: searing white first, then the orange shock front
    this.waves.push({ x, y, t: 0, T: 2.2, R: R.fire * 2.2, c: '255,252,240' }, { x, y, t: 0, T: 7, R: R.light, c: '255,246,228' }, { x, y, t: 0, T: 4.5, R: R.mod, c: '255,200,140' });
    this.clouds.push({ x, y, t: 0, life: 85, R, Y, seed: Math.random() * 100, wind: (typeof G !== 'undefined' && G.wind) || 0 });
    FX.add('glow', x, y, { size: R.fire * 1.1, grow: R.fire * 0.4, max: 0.5, c: '255,255,250' });
    // the fireball and heavy blast are instant; moderate and light damage arrive with the shock front
    World.blast(x, y, R.fire, 1e6, 'demo', m.owner, 0, { noDecal: true });
    World.blast(x, y, R.heavy, 9000, 'demo', m.owner, 0, { noDecal: true });
    for (const u of G.units) if (!u.dead && u.d.cat === 'air' && Math.hypot(u.x - x, u.y - y) < R.mod) World.kill(u, m.owner, null);
    const wave = (rad, dmg, wh, k) => { this.later.push({ t: now + 7 * (rad / R.light) * k, fn: () => { World.blast(x, y, rad, dmg, wh, m.owner, 0, { noDecal: true }); for (const u of G.units) if (!u.dead && u.d.cat === 'air' && Math.hypot(u.x - x, u.y - y) < rad * 0.7) World.kill(u, m.owner, null); Render.shake = Math.max(Render.shake || 0, 10); } }); };
    wave(R.mod, 3800, 'demo', 1); wave(R.light, 700, 'he', 1);
    // thermal pulse: fires over a wide area
    for (const e of G.hash.query(x, y, R.therm, World.tmp).slice()) {
      if ((e.kind === 'civb' && !e.rubble) || (e.kind === 'bld' && !e.dead)) { const d = Math.hypot(e.x - x, e.y - y) / R.therm; if (Math.random() < 0.9 - d * 0.6) e.burn = Math.max(e.burn || 0, 0.9); }
      else if (e.kind === 'unit' && e.d.cat === 'inf' && !e.dead && !e.inside && Math.hypot(e.x - x, e.y - y) < R.therm * 0.8) { e.hp -= e.maxHp * 0.7; if (e.hp <= 0) World.kill(e, m.owner, null); }
    }
    // ground scars: crater, scorched earth, flattened and burnt trees
    Decals.add(x, y, R.fire * 1.1, 'crater'); Decals.add(x, y, R.heavy * 1.5, 'scorch'); Decals.add(x, y, R.mod * 1.25, 'scorch'); Decals.add(x, y, R.light, 'scorch');
    this.clearTrees(x, y, R.mod, 1); this.clearTrees(x, y, R.light, 0.35);
    // burning, smoke and dust over the area
    for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * R.heavy; FX.add('smoke', x + Math.cos(a) * d, y + Math.sin(a) * d, { vx: Math.cos(a) * 16, vy: Math.sin(a) * 16 - 6, size: 20 + R.heavy * 0.05, grow: 24, max: U.rnd(8, 16), c: '60,50,44', alpha: 0.6, drag: 0.97 }); }
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * R.fire; this.later.push({ t: now + i * 0.06, fn: () => FX.explosion(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.4 + Math.random() * 1.2, { dark: true }) }); }
    // consequences
    const s = Civ.settAt(x, y, Math.max(4, Math.round(R.light / TILE)));
    const toll = this.nukeToll(x, y, R, m.owner);
    for (const f of G.factions) if (f.id !== m.owner) G.dip[f.id][m.owner].opinion -= FACTIONS[f.key].humane * 55 + 20;
    G.nukes = (G.nukes || 0) + 1; G.nukeKt = (G.nukeKt || 0) + Y;
    Fall.add(x, y, Y, m.owner);
    const km = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' km';
    Bus.emit('msg', 'NUCLEAR DETONATION' + (s ? ' at ' + s.name : '') + ' — ' + Y + ' kt · fireball ' + km(R.km.fire) + ' · severe damage ' + km(R.km.mod) + ' · fallout drifting downwind' + (toll.dead ? ' — ' + U.num(toll.dead) + ' killed, ' + U.num(toll.inj) + ' injured' : ''), m.owner === G.player ? 'warn' : 'bad', x, y);
    if (G.nukeKt > 2500 && !G.nuclearWinter) { G.nuclearWinter = true; Bus.emit('msg', 'NUCLEAR WINTER — ash clouds dim the sun; harvests will fail across the world', 'bad'); }
  },

  /* ---------- drawing ---------- */
  draw(x, v) {
    // shock waves
    for (const w of this.waves) {
      const k = w.t / w.T, r = w.R * Math.min(1, k * 1.15); if (w.x + r < v.x0 || w.x - r > v.x1 || w.y + r < v.y0 || w.y - r > v.y1) continue;
      x.strokeStyle = 'rgba(' + w.c + ',' + ((1 - k) * 0.55).toFixed(3) + ')'; x.lineWidth = Math.max(2, 26 * (1 - k)); x.beginPath(); x.arc(w.x, w.y, r, 0, 6.283); x.stroke();
      const g = x.createRadialGradient(w.x, w.y, Math.max(0, r - w.R * 0.12), w.x, w.y, r); g.addColorStop(0, 'rgba(' + w.c + ',0)'); g.addColorStop(1, 'rgba(' + w.c + ',' + ((1 - k) * 0.12).toFixed(3) + ')'); x.fillStyle = g; x.beginPath(); x.arc(w.x, w.y, r, 0, 6.283); x.fill();
    }
    // mushroom clouds
    for (const c of this.clouds) this.drawCloud(x, v, c);
    for (const m of this.list) {
      if (m.owner !== G.player && !m.shown && G.cfg.fog && !Vis.at(G.player, m.x, m.y)) continue;
      const M = MISSILES[m.kind], sy = m.y - m.z * 0.35, k = m.k || 0;
      // ground track and target reticle
      if (m.owner === G.player || m.shown) {
        x.setLineDash([6, 8]); line(x, m.x, m.y, m.tx, m.ty, 'rgba(240,120,90,0.35)', 1.2); x.setLineDash([]);
        const pulse = 0.5 + 0.5 * Math.sin(G.time * 8), R = this.blastPx(m.kind);
        x.strokeStyle = 'rgba(255,90,60,' + (0.4 + pulse * 0.4) + ')'; x.lineWidth = 2; x.beginPath(); x.arc(m.tx, m.ty, R, 0, 6.283); x.stroke();
        if (M.nuke) { const rr = this.radii(M.yieldKt); for (const [rad, a] of [[rr.fire, 0.9], [rr.light, 0.35]]) { x.strokeStyle = 'rgba(255,220,90,' + a + ')'; x.lineWidth = 1.5; x.setLineDash([10, 8]); x.beginPath(); x.arc(m.tx, m.ty, rad, 0, 6.283); x.stroke(); x.setLineDash([]); } }
        line(x, m.tx - 14, m.ty, m.tx + 14, m.ty, 'rgba(255,90,60,0.8)', 2); line(x, m.tx, m.ty - 14, m.tx, m.ty + 14, 'rgba(255,90,60,0.8)', 2);
        x.font = '600 12px "IBM Plex Mono", monospace'; x.fillStyle = '#ffb0a0'; x.fillText((M.nuke ? '☢ ' : '') + Math.max(0, m.T - m.t).toFixed(1) + 's', m.tx + 10, m.ty - 10);
      }
      // shadow
      circ(x, m.x + m.z * 0.15, m.y + m.z * 0.1, 3 * (1 - Math.min(1, m.z / 1200)) + 1, 'rgba(0,0,0,0.25)');
      // body
      const a = Math.atan2(sy - (m.py != null ? m.py - (m.pz || 0) * 0.35 : sy + 1), m.x - (m.px != null ? m.px : m.x));
      x.save(); x.translate(m.x, sy); x.rotate(a);
      const sc = (m.flight === 'ballistic' ? 1.8 * (1 - Math.min(0.6, m.z / 2500)) : m.flight === 'hyper' ? 1.3 : 1) * (m.kind === 'icbm' ? 1.5 : m.kind === 'nuke' ? 1.25 : 1);
      x.scale(sc, sc);
      x.fillStyle = m.flight === 'hyper' ? '#8a8f9c' : '#e8e6de'; x.fillRect(-7, -1.6, 12, 3.2); x.fillStyle = M.nuke ? '#e8c020' : '#b33'; x.fillRect(4, -1.6, 2.5, 3.2);
      x.globalCompositeOperation = 'lighter'; x.fillStyle = m.flight === 'hyper' ? 'rgba(210,150,255,0.9)' : 'rgba(255,190,90,0.9)'; x.beginPath(); x.arc(-8, 0, 3 + Math.random() * 2, 0, 6.283); x.fill(); x.globalCompositeOperation = 'source-over';
      x.restore();
      if (m.flight !== 'cruise' && k > 0.82) { const g = x.createRadialGradient(m.x, sy, 0, m.x, sy, 26); g.addColorStop(0, 'rgba(255,240,210,0.8)'); g.addColorStop(1, 'rgba(255,140,60,0)'); x.fillStyle = g; x.fillRect(m.x - 26, sy - 26, 52, 52); }
    }
    for (const it of this.interceptors) { circ(x, it.x, it.y, 2, '#fff'); }
    // targeting aid while choosing a launch point: range ring and blast rings
    if (UI.cmd === 'launch') {
      const b = G.ents.get(UI.launchSilo);
      if (b && b.load) {
        const M = MISSILES[b.load.kind], rr = (M.rangeKm / this.km()) * TILE;
        x.setLineDash([14, 10]); x.strokeStyle = 'rgba(255,170,90,0.55)'; x.lineWidth = 3; x.beginPath(); x.arc(b.x, b.y, rr, 0, 6.283); x.stroke(); x.setLineDash([]);
        const mx = UI.mouse.wx, my = UI.mouse.wy, inr = this.distKm(b.x, b.y, mx, my) <= M.rangeKm;
        x.strokeStyle = inr ? 'rgba(255,90,60,0.9)' : 'rgba(160,160,160,0.7)'; x.lineWidth = 2;
        if (M.nuke) { const R = this.radii(M.yieldKt); for (const [rad, c] of [[R.fire, '255,240,160'], [R.heavy, '255,150,60'], [R.mod, '255,90,60'], [R.light, '255,60,60']]) { x.strokeStyle = 'rgba(' + c + ',' + (inr ? 0.85 : 0.35) + ')'; x.beginPath(); x.arc(mx, my, rad, 0, 6.283); x.stroke(); } }
        else { x.beginPath(); x.arc(mx, my, M.bomblets ? M.spread : M.splash, 0, 6.283); x.stroke(); }
        x.font = '600 12px "IBM Plex Mono", monospace'; x.fillStyle = inr ? '#ffd0a0' : '#aaa';
        x.fillText(Math.round(this.distKm(b.x, b.y, mx, my)).toLocaleString() + ' km' + (inr ? '' : ' — out of range'), mx + 14, my - 14);
      }
    }
  },

  drawCloud(x, v, c) {
    const R = c.R, k = c.t / c.life, grow = 1 - Math.pow(1 - Math.min(1, c.t / 26), 2.4), fade = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
    const H = Math.min(3400, R.cloudH || R.mod * 2.6) * (0.25 + 0.75 * grow);
    if (c.x + R.light * 1.4 < v.x0 || c.x - R.light * 1.4 > v.x1 || c.y + R.light * 0.6 < v.y0 || c.y - H - R.mod > v.y1) return;
    const seed = c.seed || 0;
    // Cap radius follows ground scale: severe-damage radius sets the torus size,
    // so the cloud dwarfs small towns but sits inside a whole theatre on world maps.
    const capR = Math.max(26, R.mod * 0.62) * (0.3 + 0.7 * grow), stemW = Math.max(9, R.heavy * 0.30);
    const drift = Math.cos(c.wind || 0) * H * 0.22 * grow, top = c.y - H, cx = c.x + drift;
    const hot = Math.max(0, 1 - c.t / 12), flash = Math.max(0, 1 - c.t / 2.2);
    x.save(); x.globalAlpha = fade;
    // 1. ground fireball: white double-flash -> deep orange -> dull red ember bed
    const fr = R.fire * (1.35 + k * 0.7);
    let gr = x.createRadialGradient(c.x, c.y, 0, c.x, c.y, fr);
    const core = flash > 0 ? '255,255,' + Math.round(240 + flash * 15) : '255,' + Math.round(120 + hot * 120) + ',' + Math.round(40 + hot * 60);
    gr.addColorStop(0, 'rgba(' + core + ',' + (0.28 + 0.65 * Math.max(hot, flash)).toFixed(3) + ')');
    gr.addColorStop(0.45, 'rgba(255,' + Math.round(110 + hot * 90) + ',40,' + (0.30 * hot + 0.08).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(120,40,15,0)');
    x.fillStyle = gr; x.beginPath(); x.arc(c.x, c.y, fr, 0, 6.283); x.fill();
    // 2. dust skirt racing along the ground (base surge)
    if (c.t < 14) {
      const sk = R.heavy * (0.6 + (c.t / 14) * 2.4), sa = 0.34 * (1 - c.t / 14);
      x.strokeStyle = 'rgba(190,170,150,' + sa.toFixed(3) + ')'; x.lineWidth = Math.max(2, R.heavy * 0.10 * (1 - c.t / 16));
      x.beginPath(); x.arc(c.x, c.y, sk, 0, 6.283); x.stroke();
      const dg = x.createRadialGradient(c.x, c.y, sk * 0.55, c.x, c.y, sk);
      dg.addColorStop(0, 'rgba(160,130,100,0)'); dg.addColorStop(1, 'rgba(170,145,120,' + (sa * 0.5).toFixed(3) + ')');
      x.fillStyle = dg; x.beginPath(); x.arc(c.x, c.y, sk, 0, 6.283); x.fill();
    }
    // 3. Wilson condensation ring at the shock front (first seconds)
    if (c.t < 5) {
      const wr = R.mod * (0.25 + (c.t / 5) * 0.9);
      x.strokeStyle = 'rgba(235,245,255,' + (0.5 * (1 - c.t / 5)).toFixed(3) + ')'; x.lineWidth = 3;
      x.beginPath(); x.ellipse(c.x, c.y - H * 0.12 * grow, wr, wr * 0.30, 0, 0, 6.283); x.stroke();
    }
    // 4. stem: scorched dust below, grey-brown column above, lit from inside while hot
    const n = 22;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), py = c.y - H * t * 0.94, rise = Math.sin(c.t * 1.4 - t * 7 + seed) * 0.5 + 0.5;
      const wob = Math.sin(t * 6.5 + c.t * 0.7 + seed) * stemW * 0.22;
      const w = stemW * (1.5 - t * 0.75) * (0.85 + 0.3 * Math.sin(t * 11 + seed + c.t * 0.4));
      const heat = hot * (1 - t * 0.8), dk = 1 - t * 0.35;
      const r0 = Math.round((70 + 150 * heat) * dk + rise * 8), g0 = Math.round((58 + 100 * heat) * dk), b0 = Math.round(52 * dk + 10);
      const g = x.createRadialGradient(cx * t + c.x * (1 - t) + wob, py, 0, cx * t + c.x * (1 - t) + wob, py, w);
      g.addColorStop(0, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',0.72)');
      g.addColorStop(0.7, 'rgba(' + Math.round(r0 * 0.7) + ',' + Math.round(g0 * 0.7) + ',' + Math.round(b0 * 0.75) + ',0.35)');
      g.addColorStop(1, 'rgba(55,50,46,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx * t + c.x * (1 - t) + wob, py, w, 0, 6.283); x.fill();
    }
    // 5. cap: roiling torus — dark sooty outside, glowing ember underside while hot
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * 6.283 + c.t * 0.06 + seed, rr = capR * (0.5 + 0.5 * Math.abs(Math.sin(i * 2.17 + seed)));
      const px = cx + Math.cos(a) * rr, py = top + Math.sin(a) * rr * 0.44 + capR * 0.12;
      const under = py > top + capR * 0.1 ? 1 : 0.35, churn = 0.5 + 0.5 * Math.sin(i * 3.1 + c.t * 0.9);
      const pr = capR * (0.34 + 0.14 * Math.sin(i * 1.7 + seed) + churn * 0.06);
      const cr = Math.round(84 + hot * 130 * under + churn * 14), cg = Math.round(72 + hot * 80 * under), cb = Math.round(64 + hot * 26 * under);
      const g = x.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.78)');
      g.addColorStop(0.65, 'rgba(' + Math.round(cr * 0.72) + ',' + Math.round(cg * 0.7) + ',' + Math.round(cb * 0.72) + ',0.42)');
      g.addColorStop(1, 'rgba(62,56,52,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, 6.283); x.fill();
    }
    // glowing cauliflower heart seen through the cap while it burns
    const hg = x.createRadialGradient(cx, top + capR * 0.15, 0, cx, top + capR * 0.15, capR * 0.95);
    hg.addColorStop(0, 'rgba(' + Math.round(150 + 105 * hot) + ',' + Math.round(105 + 90 * hot) + ',' + Math.round(80 + 60 * hot) + ',' + (0.30 + 0.48 * hot).toFixed(3) + ')');
    hg.addColorStop(0.55, 'rgba(110,92,80,' + (0.34 - hot * 0.06).toFixed(3) + ')');
    hg.addColorStop(1, 'rgba(80,72,66,0)');
    x.fillStyle = hg; x.beginPath(); x.arc(cx, top + capR * 0.15, capR * 0.95, 0, 6.283); x.fill();
    // 6. anvil: thin ice-crystal sheet shearing downwind once the cap stabilises
    if (grow > 0.55) {
      x.fillStyle = 'rgba(150,142,134,' + (0.20 * fade * grow).toFixed(3) + ')';
      x.beginPath(); x.ellipse(cx + Math.cos(c.wind || 0) * capR * 1.1, top - capR * 0.28, capR * 1.5, capR * 0.30, 0, 0, 6.283); x.fill();
    }
    x.restore();
  },
  drawMini(g, X) {
    for (const m of this.list) {
      if (m.owner !== G.player && !m.shown) continue;
      g.fillStyle = '#ff6a4a'; g.fillRect(X.ox + (m.x / TILE) * X.s - 2, X.oy + (m.y / TILE) * X.s - 2, 4, 4);
      g.strokeStyle = '#ff6a4a'; g.lineWidth = 1; const tx = X.ox + (m.tx / TILE) * X.s, ty = X.oy + (m.ty / TILE) * X.s;
      g.beginPath(); g.moveTo(tx - 4, ty - 4); g.lineTo(tx + 4, ty + 4); g.moveTo(tx + 4, ty - 4); g.lineTo(tx - 4, ty + 4); g.stroke();
    }
    for (const c of this.clouds) { if (c.t > 25) continue; g.strokeStyle = 'rgba(255,230,120,' + (1 - c.t / 25).toFixed(2) + ')'; g.lineWidth = 1.5; g.beginPath(); g.arc(X.ox + (c.x / TILE) * X.s, X.oy + (c.y / TILE) * X.s, Math.max(3, (c.R.mod / TILE) * X.s), 0, 6.283); g.stroke(); }
    Fall.drawMini(g, X);
  },
};

/* =====================================================================
   Radioactive fallout: each detonation leaves a plume that drifts with the
   wind (an ellipse stretching downwind from ground zero), stored as a
   coarse grid with an exponential decay. Radiation sickens infantry and
   civilians, hurts vehicle crews, empties settlements and ruins harvests.
   ===================================================================== */
const Fall = {
  patches: [], HALF: 800, acc: 0, warnT: -99,
  reset() { this.patches = []; this.acc = 0; this.warnT = -99; },
  decay(p) { return Math.pow(0.5, (G.time - p.t0) / this.HALF); },

  add(x, y, Y, owner) {
    const M = G.map; if (!M) return;
    const km = Strike.km(), R = Strike.radii(Y), tx = x / TILE, ty = y / TILE;
    const Rz = Math.max(2.5, (R.heavy * 1.15) / TILE);
    const Lk = 5 * Math.pow(Y, 0.45), L = U.clamp(Lk / km, Rz * 2.2, 0.75 * Math.max(M.w, M.h));
    const w = Math.max(Rz * 0.9, L * 0.11), ang = G.wind || 0, ca = Math.cos(ang), sa = Math.sin(ang);
    const ex = tx + ca * L, ey = ty + sa * L, pad = w * 1.6 + Rz + 2;
    let x0 = Math.floor(Math.min(tx, ex) - pad), x1 = Math.ceil(Math.max(tx, ex) + pad), y0 = Math.floor(Math.min(ty, ey) - pad), y1 = Math.ceil(Math.max(ty, ey) + pad);
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(M.w, x1); y1 = Math.min(M.h, y1);
    const cell = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 360)), gw = Math.max(1, Math.ceil((x1 - x0) / cell)), gh = Math.max(1, Math.ceil((y1 - y0) / cell));
    const data = new Uint8Array(gw * gh), seed = (x * 7 + y * 13) | 0;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const px = x0 + (i + 0.5) * cell, py = y0 + (j + 0.5) * cell, dx = px - tx, dy = py - ty, s = dx * ca + dy * sa, u = -dx * sa + dy * ca, d = Math.hypot(dx, dy);
      let v = 0;
      if (d < Rz * 1.3) v = 255 * Math.max(0, 1 - (d / (Rz * 1.3)) * 0.35);
      if (s > 0 && s < L * 1.1) { const ww = w * (0.55 + (s / L) * 1.1), v2 = 255 * Math.exp(-(s / L) * 2.1) * Math.exp(-(u * u) / (2 * ww * ww * 0.5)); if (v2 > v) v = v2; }
      if (v > 0) v *= 0.82 + 0.3 * hash2(i + (seed & 255), j, 91) * (1 - Math.min(1, v / 255) * 0.5);
      data[j * gw + i] = Math.min(255, v | 0);
    }
    const S = U.clamp(0.55 + Math.log10(Y) * 0.2, 0.6, 1.2);
    const p = { x0, y0, gw, gh, cell, data, t0: G.time, S, owner, f: 1, img: null };
    p.img = this.makeImg(p);
    this.patches.push(p); if (this.patches.length > 36) this.patches.shift();
  },
  makeImg(p) {
    const c = U.canvas(p.gw, p.gh), g = c.getContext('2d'), img = g.createImageData(p.gw, p.gh), D = img.data;
    for (let i = 0; i < p.data.length; i++) {
      const v = p.data[i] / 255, o = i * 4; if (v < 0.015) continue;
      // green-yellow at low dose, orange to red at high dose
      D[o] = 120 + 135 * Math.min(1, v * 1.6); D[o + 1] = 215 - 120 * Math.max(0, v - 0.35); D[o + 2] = 40 - 20 * v; D[o + 3] = Math.min(240, 70 + v * 190);
    }
    g.putImageData(img, 0, 0); return c;
  },
  at(x, y) {
    if (!this.patches.length) return 0;
    const tx = x / TILE, ty = y / TILE; let lvl = 0;
    for (const p of this.patches) {
      const gx = Math.floor((tx - p.x0) / p.cell), gy = Math.floor((ty - p.y0) / p.cell);
      if (gx < 0 || gy < 0 || gx >= p.gw || gy >= p.gh) continue;
      lvl += (p.data[gy * p.gw + gx] / 255) * p.S * p.f;
    }
    return Math.min(1.5, lvl);
  },
  update(dt) {
    if (!this.patches.length) return;
    this.acc += dt; if (this.acc < 0.5) return; const step = this.acc; this.acc = 0;
    for (const p of this.patches) p.f = this.decay(p);
    this.patches = this.patches.filter((p) => p.f > 0.025);
    if (!this.patches.length) return;
    const P = G.player; let playerHit = 0, hotspot = null;
    for (const u of G.units) {
      if (u.dead || u.inside || (u.d.cat === 'air' && u.alt > 0.3)) continue;
      const lvl = this.at(u.x, u.y); u.rad = lvl; if (lvl < 0.03) continue;
      const k = u.d.cat === 'inf' ? 1 : u.d.cat === 'veh' ? 0.3 : u.d.cat === 'sea' ? 0.35 : 0.1;
      u.dose = (u.dose || 0) + lvl * step; u.hp -= (u.maxHp || 100) * 0.012 * Math.pow(lvl, 1.3) * step * k; u.supp = Math.min(100, (u.supp || 0) + lvl * 6 * k);
      if (u.owner === P) { playerHit++; if (!hotspot) hotspot = u; }
      if (u.hp <= 0) World.kill(u, -1, null);
    }
    for (const a of G.civs) {
      if (a.dead) continue; const lvl = this.at(a.x, a.y); if (lvl < 0.05) continue;
      if (a.veh) continue;
      Civ.hit(a, 2.5 * Math.pow(lvl, 1.3) * step, -1);
    }
    for (const s of G.settlements) {
      const lvl = Math.max(this.at(s.x, s.y), this.at(s.x + 3 * TILE, s.y), this.at(s.x - 3 * TILE, s.y)); s.rad = lvl; if (lvl < 0.05 || s.pop <= 0) continue;
      s.danger = Math.max(s.danger, 30 + lvl * 70); s.happy = Math.max(0, s.happy - 1.5 * lvl * step);
      const people = s.pop * (s.mult || 1), rate = 0.003 * Math.pow(lvl, 1.4) * step;
      const nd = Civ.acc(s, 'fall', Math.min(people, people * rate + (lvl > 0.6 ? 0.5 : 0))), ni = Civ.acc(s, 'falli', people * rate * 1.8);
      Civ.ledger(s, nd, ni, -1, 'fallout');
      if (s.ctrl === P && G.time - this.warnT > 25) { this.warnT = G.time; Bus.emit('msg', 'Radioactive fallout over ' + s.name + ' — evacuate the population', 'bad', s.x, s.y); }
    }
    if (hotspot && G.time - this.warnT > 25) { this.warnT = G.time; Bus.emit('msg', 'RADIATION: ' + playerHit + ' of your units are in contaminated ground', 'bad', hotspot.x, hotspot.y); Bus.emit('sfx', 'alert'); }
    if (playerHit && Math.random() < 0.8) for (let i = 0; i < Math.min(6, playerHit); i++) Bus.emit('sfx', 'geiger');
  },
  draw(x, v) {
    if (!this.patches.length) return;
    x.imageSmoothingEnabled = true;
    const pulse = 0.9 + 0.1 * Math.sin(G.time * 2.4);
    for (const p of this.patches) {
      const w = p.gw * p.cell * TILE, h = p.gh * p.cell * TILE, px = p.x0 * TILE, py = p.y0 * TILE;
      if (px > v.x1 || py > v.y1 || px + w < v.x0 || py + h < v.y0) continue;
      x.globalAlpha = Math.min(0.85, 0.15 + p.f * 0.75) * pulse; x.drawImage(p.img, px, py, w, h);
    }
    x.globalAlpha = 1;
  },
  drawMini(g, X) {
    for (const p of this.patches) { g.globalAlpha = Math.min(0.85, 0.2 + p.f * 0.7); g.drawImage(p.img, X.ox + p.x0 * X.s, X.oy + p.y0 * X.s, p.gw * p.cell * X.s, p.gh * p.cell * X.s); }
    g.globalAlpha = 1;
  },
  save() { return this.patches.map((p) => ({ x0: p.x0, y0: p.y0, gw: p.gw, gh: p.gh, cell: p.cell, t0: p.t0, S: p.S, owner: p.owner, data: B64.enc(p.data) })); },
  load(a) { this.patches = []; for (const q of a || []) { const p = Object.assign({}, q, { data: B64.dec(q.data), f: 1 }); p.img = this.makeImg(p); this.patches.push(p); } },
};
