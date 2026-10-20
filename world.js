'use strict';
/* =====================================================================
   CITY.RA — world.js
   Entities (units, military buildings, civilian buildings, bridges,
   wrecks), visibility, combat, projectiles, damage, death, unit AI
   behaviours and the order system used by both players and the AI.
   ===================================================================== */

const fac = (i) => G.factions[i];
const hostile = (a, b) => a >= 0 && b >= 0 && a !== b && G.dip[a] && G.dip[a][b].stance === 'war';
const friendly = (a, b) => a === b || (a >= 0 && b >= 0 && G.dip[a] && G.dip[a][b].stance === 'alliance');
const tileOf = (x, y) => ((y / TILE) | 0) * G.map.w + ((x / TILE) | 0);
const isAir = (e) => e.kind === 'unit' && e.d.cat === 'air' && e.alt > 0.3;
const VET_XP = [0, 60, 170, 340];

/* ---------------- visibility ---------------- */
const Vis = {
  init(M, nf) {
    const N = M.w * M.h; this.vis = []; this.exp = []; this.circ = {};
    for (let f = 0; f < nf; f++) { this.vis.push(new Uint8Array(N)); this.exp.push(new Uint8Array(N)); }
    this.dirty = true;
  },
  offsets(r) {
    r = Math.round(r * 2) / 2; if (this.circ[r]) return this.circ[r];
    const o = []; const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r) o.push(dx, dy);
    return (this.circ[r] = o);
  },
  stamp(v, e, tx, ty, r) {
    const M = G.map, W = M.w, H = M.h, o = this.offsets(r);
    for (let k = 0; k < o.length; k += 2) { const x = tx + o[k], y = ty + o[k + 1]; if (x >= 0 && y >= 0 && x < W && y < H) v[y * W + x] = 1; }
  },
  sightMod() { const w = G.weather.type; return (w === 'fog' ? -3 : w === 'storm' ? -2 : w === 'sand' ? -3 : w === 'rain' || w === 'snow' ? -1 : 0) + (Clock.night() ? -1 : 0); },
  update() {
    const M = G.map, nf = G.factions.length, sm = this.sightMod();
    for (let f = 0; f < nf; f++) {
      const v = this.vis[f]; v.fill(0);
      if (!G.cfg.fog) { v.fill(1); this.exp[f].fill(1); continue; }
    }
    if (!G.cfg.fog) return;
    const share = (owner, fn) => { for (let f = 0; f < nf; f++) if (friendly(owner, f)) fn(this.vis[f]); };
    for (const u of G.units) {
      if (u.dead || u.inside) continue;
      const F = FACTIONS[fac(u.owner).key];
      let r = u.d.sight + (u.d.cat === 'inf' && F.mod.sight ? F.mod.sight.inf : 0) + sm;
      if (u.d.cat !== 'air') { const h = M.hgt[tileOf(u.x, u.y)]; if (h > 0.62) r += 1.5; } else r += 1;
      const tx = (u.x / TILE) | 0, ty = (u.y / TILE) | 0; r = Math.max(2, r);
      share(u.owner, (v) => this.stamp(v, u, tx, ty, r));
    }
    for (const b of G.blds) {
      if (b.dead) continue;
      let r = (b.d.sight || 5) + Math.max(b.w, b.h) / 2 + (b.type === 'radar' && b.level > 1 ? 10 : 0) + (b.type === 'hq' && b.level > 1 ? 4 : 0);
      share(b.owner, (v) => this.stamp(v, b, (b.x / TILE) | 0, (b.y / TILE) | 0, r));
    }
    for (const c of G.civb) {
      if (c.ctrl < 0 || c.rubble) continue;
      const r = c.d.cap === 'sight' ? 20 : c.d.cap === 'airport' ? 14 : 4;
      share(c.ctrl, (v) => this.stamp(v, c, (c.x / TILE) | 0, (c.y / TILE) | 0, r));
    }
    for (let f = 0; f < nf; f++) { const v = this.vis[f], e = this.exp[f]; for (let i = 0; i < v.length; i++) if (v[i]) e[i] = 1; }
    this.dirty = true;
  },
  at(f, x, y) { if (f < 0) return true; const i = tileOf(x, y); return this.vis[f] ? this.vis[f][i] === 1 : true; },
  explored(f, x, y) { const i = tileOf(x, y); return this.exp[f] ? this.exp[f][i] === 1 : true; },
};

// can faction f see entity e (fog + stealth)
function canSee(f, e) {
  if (friendly(f, e.owner)) return true;
  if (!Vis.at(f, e.x, e.y)) return false;
  if (e.kind === 'unit') {
    if (e.d.ab && e.d.ab.submerge && G.time - e.lastFire > 4) return detected(f, e, 'sonar', 5);
    const camo = (e.d.ab && e.d.ab.stealth) || (e.d.camo && G.map.terr[tileOf(e.x, e.y)] === TER.FOREST);
    if (camo && G.time - e.lastFire > 3) return detected(f, e, 'detect', 6) || nearEnemy(f, e, 2.5);
  }
  return true;
}
function detected(f, e, ab, r) {
  const out = World.tmp; G.hash.query(e.x, e.y, r * TILE, out);
  for (const o of out) if (o.kind === 'unit' && !o.dead && friendly(f, o.owner) && o.d.ab && o.d.ab[ab]) return true;
  return false;
}
function nearEnemy(f, e, r) {
  const out = World.tmp; G.hash.query(e.x, e.y, r * TILE, out);
  for (const o of out) if ((o.kind === 'unit' || o.kind === 'bld') && !o.dead && friendly(f, o.owner)) return true;
  return false;
}

/* ---------------- world ---------------- */
const World = {
  tmp: [], tmp2: [], charges: [],

  reset(M) {
    G.map = M; G.ents.clear(); G.units = []; G.blds = []; G.civb = []; G.civs = []; G.wrecks = []; G.bridges = []; G.proj = []; G.sel = []; G.groups = {};
    FX.parts.length = 0; FX.lights.length = 0; this.charges = []; G.nextId = 1; G.time = 0;
    G.hash = new Grid(M.w * TILE, M.h * TILE, 128);
    Path.init(M);
  },

  populate(M) {
    for (const p of M.plan.civb) this.addCiv(p.type, p.tx, p.ty, { town: p.town, v: p.v, abandoned: p.abandoned });
    for (const span of M.plan.bridges) this.addBridge(span);
  },

  addCiv(type, tx, ty, o = {}) {
    const d = CIVB[type], M = G.map;
    const c = { id: newId(), kind: 'civb', type, d, owner: -1, ctrl: -1, sett: o.town == null ? -1 : o.town, tx, ty, w: d.w, h: d.h,
      x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, hp: d.hp, maxHp: d.hp, v: o.v || 0, rubble: false, burn: 0, rad: Math.max(d.w, d.h) * TILE * 0.5,
      abandoned: !!o.abandoned || !!d.ruin, door: -1, cap: 0, lit: Math.random() };
    if (c.abandoned) c.hp = d.hp * 0.4;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) { const i = y * M.w + x; M.occ[i] = c.id; M.tree[i] = 0; }
    c.door = this.findDoor(c);
    G.ents.set(c.id, c); G.civb.push(c); return c;
  },
  findDoor(c) {
    const M = G.map; let best = -1, bd = 1e9;
    for (let y = c.ty - 2; y < c.ty + c.h + 2; y++) for (let x = c.tx - 2; x < c.tx + c.w + 2; x++) {
      if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue; const i = y * M.w + x; if (!M.road[i] || M.road[i] >= 3) continue;
      const d = Math.hypot(x + 0.5 - (c.tx + c.w / 2), y + 0.5 - (c.ty + c.h / 2)); if (d < bd) { bd = d; best = i; }
    }
    return best;
  },

  addBridge(span) {
    const M = G.map; let sx = 0, sy = 0;
    for (const i of span.tiles) { sx += (i % M.w) + 0.5; sy += ((i / M.w) | 0) + 0.5; }
    const n = span.tiles.length, b = { id: newId(), kind: 'bridge', owner: -1, tiles: span.tiles, rail: span.rail, x: (sx / n) * TILE, y: (sy / n) * TILE, hp: 1600 + n * 200, maxHp: 1600 + n * 200, rad: n * TILE * 0.5 + 10, broken: false, d: { name: span.rail ? 'Rail bridge' : 'Road bridge' } };
    G.ents.set(b.id, b); G.bridges.push(b); return b;
  },

  addBld(type, owner, tx, ty, o = {}) {
    const d = BLDS[type], M = G.map;
    const b = { id: newId(), kind: 'bld', type, d, owner, tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, hp: d.hp, maxHp: d.hp,
      level: 1, built: o.instant ? 1 : 0, rad: Math.max(d.w, d.h) * TILE * 0.5, ta: Math.random() * 6, cool: 0, tgt: 0, scanT: 0, repairing: false, burn: 0, upg: null,
      docks: d.docks ? new Array(d.docks).fill(0) : null, rally: null, lastHit: -99, dish: Math.random() * 6 };
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) { const i = y * M.w + x; M.occ[i] = b.id; M.tree[i] = 0; M.ore[i] = 0; }
    G.ents.set(b.id, b); G.blds.push(b);
    if (typeof Render !== 'undefined') Render.clearTrees(tx, ty, d.w, d.h);
    Bus.emit('bldAdded', b);
    return b;
  },

  canPlace(type, owner, tx, ty) {
    const d = BLDS[type], M = G.map;
    if (tx < 0 || ty < 0 || tx + d.w > M.w || ty + d.h > M.h) return { ok: false, why: 'Outside the map' };
    let water = 0, land = 0, metal = 0;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
      const i = y * M.w + x, t = M.terr[i];
      if (M.occ[i]) return { ok: false, why: 'Space is occupied' };
      if (M.road[i] >= 3 || M.rail[i] >= 2) return { ok: false, why: 'Cannot build on bridges' };
      if (TER_INFO[t].water) water++; else land++;
      if (t === TER.ROCK) return { ok: false, why: 'Mountain terrain' };
      if (M.res[i] === 1) metal++;
    }
    if (d.coast) { if (water < 3 || land < 2) return { ok: false, why: 'Shipyards need a shoreline' }; }
    else if (water) return { ok: false, why: 'Cannot build on water' };
    if (d.needs === 'metal' && metal < 2) return { ok: false, why: 'Place over a metal deposit' };
    if (d.nearWater && !this.waterNear(tx, ty, d.w, d.h, 4)) return { ok: false, why: 'Needs water within 4 tiles' };
    // units in the way
    const cx = (tx + d.w / 2) * TILE, cy = (ty + d.h / 2) * TILE;
    for (const u of G.hash.query(cx, cy, Math.max(d.w, d.h) * TILE * 0.6, this.tmp2)) if (u.kind === 'unit' && u.d.cat !== 'air' && u.d.cat !== 'sea' && !u.inside) {
      if (u.x > tx * TILE - 4 && u.x < (tx + d.w) * TILE + 4 && u.y > ty * TILE - 4 && u.y < (ty + d.h) * TILE + 4 && u.owner !== owner) return { ok: false, why: 'Units are in the way' };
    }
    // build radius
    let near = false;
    for (const b of G.blds) {
      if (b.dead || b.owner !== owner || b.d.wall || b.d.walk) continue;
      const rad = (b.d.buildRadius || 7) + Math.max(b.w, b.h) / 2;
      const dx = Math.max(0, Math.abs(tx + d.w / 2 - (b.tx + b.w / 2)) - d.w / 2), dy = Math.max(0, Math.abs(ty + d.h / 2 - (b.ty + b.h / 2)) - d.h / 2);
      if (Math.hypot(dx, dy) <= rad) { near = true; break; }
    }
    if (!near && !G.cfg.buildAnywhere) return { ok: false, why: 'Too far from your base' };
    return { ok: true };
  },
  waterNear(tx, ty, w, h, r) {
    const M = G.map;
    for (let y = ty - r; y < ty + h + r; y++) for (let x = tx - r; x < tx + w + r; x++) { if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue; if (TER_INFO[M.terr[y * M.w + x]].water) return true; }
    return false;
  },

  spawnUnit(type, owner, x, y, o = {}) {
    const d = UNITS[type], f = fac(owner), F = FACTIONS[f.key];
    let hpm = (F.mod.hp && F.mod.hp[d.cat]) || 1;
    if (d.cat === 'veh' && f.tech.has('composite')) hpm *= 1.2;
    const u = { id: newId(), kind: 'unit', type, d, owner, x, y, a: o.a != null ? o.a : Math.PI / 2, ta: o.a != null ? o.a : Math.PI / 2,
      hp: Math.round(d.hp * hpm), maxHp: Math.round(d.hp * hpm), ammo: d.ammo, morale: 100, supp: 0, xp: 0, vet: d.cat === 'inf' && f.tech.has('veteran') ? 1 : 0,
      state: 'idle', ord: null, path: null, pi: 0, pathReq: null, cool: d.w.map(() => Math.random() * 0.5), tgt: 0, scanT: Math.random() * 0.4,
      cargo: [], inside: 0, alt: d.cat === 'air' ? (o.docked ? 0 : 1) : 0, rad: d.r, anim: Math.random() * 10, lastFire: -99, lastHit: -99, moving: false,
      harv: 0, hs: null, home: 0, dock: -1, stuck: 0, ordT: -99, burst: null, pathFail: 0, vx: 0, vy: 0, rearm: 0, hold: false };
    if (d.vet) u.vet = d.vet;
    if (o.vet) u.vet = o.vet;
    if (u.vet) u.xp = VET_XP[u.vet];
    G.ents.set(u.id, u); G.units.push(u);
    if (d.ab && d.ab.harvest) { u.state = 'harvest'; u.hs = 'seek'; }
    if (d.cat === 'air' && d.plane && !o.docked) { u.state = 'orbit'; u.ord = { t: 'orbit', x, y }; }
    Bus.emit('unitAdded', u);
    return u;
  },

  addWreck(u) {
    const M = G.map, i = tileOf(u.x, u.y);
    const w = { id: newId(), kind: 'wreck', type: u.type, owner: u.owner, x: u.x, y: u.y, a: u.a, t: G.time, tile: i, rad: u.rad, burn: 6 };
    if (M.road[i] && M.road[i] < 3) M.block[i] = 1;
    G.ents.set(w.id, w); G.wrecks.push(w);
    return w;
  },
  removeWreck(w) {
    const M = G.map; w.dead = true; G.ents.delete(w.id);
    if (!G.wrecks.some((o) => o !== w && !o.dead && o.tile === w.tile)) M.block[w.tile] = 0;
  },

  remove(e) { e.dead = true; G.ents.delete(e.id); },

  /* ---------------- damage ---------------- */
  armorIdx(t) {
    if (t.kind === 'unit') return ARMOR[t.d.armor];
    if (t.kind === 'civ') return t.veh ? 1 : 0;
    return 5;
  },
  hurt(t, dmg, wh, owner, srcId) {
    if (!t || t.dead || t.hp <= 0 && t.kind !== 'bridge') return;
    if (t.kind === 'civb' && t.rubble) return;
    if (t.kind === 'bridge' && t.broken) return;
    let m = WH[wh][this.armorIdx(t)];
    if (!m) return;
    if (t.kind === 'unit') {
      if (t.d.cat === 'inf') {
        const tl = tileOf(t.x, t.y), terr = G.map.terr[tl];
        let cover = TER_INFO[terr].cover || 0;
        const occ = G.map.occ[tl]; if (occ) { const b = G.ents.get(occ); if (b && b.d && b.d.cover) cover = Math.max(cover, b.d.cover); }
        if (wh === 'small' || wh === 'he' || wh === 'ap_lt') m *= 1 - cover;
        if (t.supp > 40 && (wh === 'small' || wh === 'he')) m *= 0.6;
      }
      if (t.d.cat === 'air' && t.alt < 0.3 && wh !== 'aa') m = WH[wh][1];
    }
    const src = srcId ? G.ents.get(srcId) : null;
    if (src && src.kind === 'unit') m *= 1 + 0.12 * src.vet;
    if (src && src.kind === 'bld' && src.level > 1) m *= 1.6;
    const d = dmg * m;
    t.hp -= d; t.lastHit = G.time;
    if (owner >= 0 && t.owner >= 0 && owner !== t.owner && (t.kind === 'unit' || t.kind === 'bld')) { Dip.onHit(t.owner, owner); t.lastHitBy = srcId; }
    if (t.kind === 'unit') {
      if (!(t.d.ab && t.d.ab.fearless)) t.morale = Math.max(0, t.morale - (d / t.maxHp) * 45);
      if (src) t.lastAttacker = src.id;
      if (src && src.kind === 'unit') { src.xp += d * 0.05; }
    }
    if (t.kind === 'bld' && owner !== t.owner && owner >= 0) { Bus.emit('attacked', t); }
    if (t.kind === 'civb' && owner >= 0) Civ.damaged(t, owner, d / t.maxHp);
    if ((wh === 'he' || wh === 'demo') && (t.kind === 'civb' || t.kind === 'bld') && !t.d.wall && Math.random() < 0.18 + d / t.maxHp) t.burn = Math.max(t.burn, 0.5);
    if (t.hp <= 0) this.kill(t, owner, src);
  },

  blast(x, y, rad, dmg, wh, owner, srcId, opt = {}) {
    const out = G.hash.query(x, y, rad, this.tmp);
    const list = out.slice();
    for (const e of list) {
      if (e.dead || e.kind === 'wreck') continue;
      if (e.kind === 'unit' && (e.inside || (e.d.cat === 'air' && e.alt > 0.3))) continue;
      if (e.kind === 'unit' && e.d.ab && e.d.ab.submerge) continue;
      const dd = Math.max(0, Math.hypot(e.x - x, e.y - y) - (e.kind === 'unit' ? 0 : e.rad * 0.6));
      if (dd > rad) continue;
      const f = 1 - (dd / rad) * 0.65;
      if (e.kind === 'civ') { Civ.hit(e, dmg * f, owner); continue; }
      if (e.kind === 'unit' && e.d.cat === 'inf' && !(e.d.ab && e.d.ab.fearless)) e.supp = Math.min(100, e.supp + 30 * f);
      this.hurt(e, dmg * f, wh, owner, srcId);
    }
    const tl = tileOf(x, y);
    if (G.map && TER_INFO[G.map.terr[tl]].water && !G.map.road[tl]) FX.water(x, y, rad / 40);
    else if (!opt.noDecal && rad >= 20) Decals.add(x, y, rad * 0.55, 'crater');
    Civ.noise(x, y, rad / 10);
    Bus.emit('sfx', 'boom', x, y, rad / 40);
  },

  kill(t, owner, src) {
    if (t.dead) return;
    if (t.kind === 'unit') this.killUnit(t, owner, src);
    else if (t.kind === 'bld') this.killBld(t, owner);
    else if (t.kind === 'civb') this.killCiv(t, owner);
    else if (t.kind === 'bridge') this.breakBridge(t, owner);
  },

  killUnit(u, owner, src) {
    u.dead = true; u.hp = 0; G.ents.delete(u.id);
    const f = fac(u.owner); f.stats.lost++;
    if (owner >= 0 && owner !== u.owner) { fac(owner).stats.kills++; if (src && src.kind === 'unit' && !src.dead) src.xp += (u.d.cost.c || 100) / 8; }
    if (u.d.cat === 'inf') { FX.add('dust', u.x, u.y, { size: 3, grow: 8, max: 0.6, c: '120,100,80', alpha: 0.6 }); Decals.add(u.x, u.y, 4, 'scorch'); Bus.emit('sfx', 'die', u.x, u.y); }
    else if (u.d.cat === 'sea') { FX.explosion(u.x, u.y, u.rad / 14); FX.water(u.x, u.y, 2); }
    else if (u.d.cat === 'air') { FX.explosion(u.x, u.y - u.alt * 24, 1.2); if (u.alt > 0.3) { const p = Proj.spawn({ type: 'crash', x: u.x, y: u.y, z: u.alt * 24, tx: u.x + Math.cos(u.a) * 60, ty: u.y + Math.sin(u.a) * 60, spd: 120, dmg: 60, wh: 'he', splash: 30, owner: u.owner, src: 0 }); } this.undock(u); }
    else { FX.explosion(u.x, u.y, u.rad / 13); this.addWreck(u); }
    // passengers
    for (const id of u.cargo) {
      const p = G.ents.get(id); if (!p) continue;
      if (u.d.cat === 'veh' && Math.random() < 0.6) { p.inside = 0; p.x = u.x + U.rnd(-10, 10); p.y = u.y + U.rnd(-10, 10); p.state = 'idle'; p.hp *= 0.5; }
      else { p.dead = true; G.ents.delete(p.id); f.stats.lost++; }
    }
    u.cargo = [];
    // morale shock to friends nearby
    for (const o of G.hash.query(u.x, u.y, 4 * TILE, this.tmp)) if (o.kind === 'unit' && o.owner === u.owner && !o.dead && !(o.d.ab && o.d.ab.fearless)) o.morale = Math.max(0, o.morale - 8);
    Bus.emit('unitLost', u, owner);
  },
  undock(u) { if (u.home) { const h = G.ents.get(u.home); if (h && h.docks) { const i = h.docks.indexOf(u.id); if (i >= 0) h.docks[i] = 0; } } },

  freeTiles(e) { const M = G.map; for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) { const i = y * M.w + x; if (M.occ[i] === e.id) M.occ[i] = 0; } },

  killBld(b, owner) {
    b.dead = true; b.hp = 0; G.ents.delete(b.id); this.freeTiles(b);
    const n = Math.max(1, b.w * b.h);
    for (let i = 0; i < Math.min(5, n); i++) setTimeout(() => FX.explosion(b.x + U.rnd(-b.w, b.w) * 12, b.y + U.rnd(-b.h, b.h) * 12, 1 + Math.random()), i * 140);
    FX.explosion(b.x, b.y, 1.6, { dark: true });
    Decals.add(b.x, b.y, Math.max(b.w, b.h) * TILE * 0.6, 'scorch');
    if (b.d.volatile) this.blast(b.x, b.y, b.d.volatile, 260, 'he', b.owner, 0);
    if (b.docks) for (const id of b.docks) { const p = G.ents.get(id); if (p && p.alt < 0.3) this.killUnit(p, owner, null); }
    fac(b.owner).stats.blost++;
    if (owner >= 0 && owner !== b.owner) fac(owner).stats.bkills++;
    Bus.emit('bldLost', b, owner);
    Bus.emit('sfx', 'bigboom', b.x, b.y, 1.5);
  },

  killCiv(c, owner) {
    c.hp = 0; c.rubble = true; c.burn = 0.4;
    FX.explosion(c.x, c.y, 1.2, { dark: true });
    if (c.d.volatile) this.blast(c.x, c.y, c.d.volatile, 200, 'he', owner, 0);
    if (c.ctrl >= 0 && c.type === 'powerstation') c.ctrl = -1;
    Civ.destroyed(c, owner);
    Bus.emit('sfx', 'bigboom', c.x, c.y, 1.2);
  },

  breakBridge(b, owner) {
    b.broken = true; b.hp = 0; const M = G.map;
    for (const i of b.tiles) {
      if (M.road[i] === 3) M.road[i] = 4; if (M.rail[i] === 2) M.rail[i] = 3;
      const x = ((i % M.w) + 0.5) * TILE, y = (((i / M.w) | 0) + 0.5) * TILE;
      FX.explosion(x, y, 1.2); FX.water(x, y, 1.5);
      for (const u of G.hash.query(x, y, 20, this.tmp).slice()) if (u.kind === 'unit' && u.d.cat !== 'air' && u.d.cat !== 'sea' && !u.dead) this.killUnit(u, owner, null);
    }
    Path.rebuildComponents(); Render.invalidateTiles(b.tiles); Civ.onBridge(b);
    Bus.emit('msg', b.d.name + ' destroyed — route cut', 'warn', b.x, b.y);
  },
  repairBridge(b) {
    const M = G.map; b.broken = false;
    for (const i of b.tiles) { if (M.road[i] === 4) M.road[i] = 3; if (M.rail[i] === 3) M.rail[i] = 2; }
    Path.rebuildComponents(); Render.invalidateTiles(b.tiles); Civ.onBridge(b);
    Bus.emit('msg', b.d.name + ' reopened', 'good', b.x, b.y);
  },

  /* ---------------- update ---------------- */
  update(dt) {
    // spatial hash
    const H = G.hash; H.clear();
    for (const u of G.units) if (!u.dead && !u.inside) H.add(u);
    for (const b of G.blds) if (!b.dead) H.add(b);
    for (const c of G.civb) H.add(c);
    for (const c of G.civs) if (!c.dead && !c.indoors) H.add(c);
    for (const b of G.bridges) H.add(b);
    for (const u of G.units) if (!u.dead) this.updUnit(u, dt);
    for (const b of G.blds) if (!b.dead) this.updBld(b, dt);
    for (const c of G.civb) this.updCivB(c, dt);
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i]; c.t -= dt;
      if (Math.random() < 0.2) FX.add('glow', c.x, c.y, { size: 2, max: 0.15, c: '255,60,40' });
      if (c.t <= 0) { const t = G.ents.get(c.id); FX.explosion(c.x, c.y, 1.6); if (t) this.hurt(t, 950, 'demo', c.owner, 0); this.blast(c.x, c.y, 40, 60, 'he', c.owner, 0); this.charges.splice(i, 1); }
    }
    for (const w of G.wrecks) { if (w.burn > 0) { w.burn -= dt; if (Math.random() < 0.25) FX.smoke(w.x, w.y, 0.8, true); if (Math.random() < 0.1) FX.flame(w.x, w.y, 0.5); } if (G.time - w.t > 360) this.removeWreck(w); }
    Proj.update(dt);
    if (G.units.some((u) => u.dead)) G.units = G.units.filter((u) => !u.dead);
    if (G.blds.some((b) => b.dead)) G.blds = G.blds.filter((b) => !b.dead);
    if (G.wrecks.some((w) => w.dead)) G.wrecks = G.wrecks.filter((w) => !w.dead);
  },

  speedMod(u) {
    const d = u.d, f = fac(u.owner), F = FACTIONS[f.key];
    if (d.cat === 'air') return (F.mod.speed && F.mod.speed.air) || 1;
    const i = tileOf(u.x, u.y);
    let m = 1;
    if (d.cat !== 'sea') { const c = Path.cost(d.mc, i) || 1.5; m = U.clamp(Math.pow(1 / c, 0.7), 0.4, 1.45); }
    if (u.hp < u.maxHp * 0.25) m *= 0.8;
    if (d.cat !== 'inf' && f.lack.fuel) m *= 0.5;
    if (d.cat === 'inf' && u.supp > 45) m *= 0.5;
    if (u.morale < 25) m *= 1.1;
    const w = G.weather.type;
    if (w === 'snow') m *= d.mc === 'wheel' ? 0.75 : 0.85; else if (w === 'storm' || w === 'sand') m *= 0.9; else if (w === 'rain' && d.mc === 'wheel') m *= 0.92;
    if (F.mod.speed) { if (d.cat === 'sea' && F.mod.speed.sea) m *= F.mod.speed.sea; if (d.mc === 'wheel' && F.mod.speed.wheel) m *= F.mod.speed.wheel; }
    return m;
  },

  rangeOf(src, wkey) {
    const w = WEAPONS[wkey]; let r = w.rng;
    const f = fac(src.owner), F = FACTIONS[f.key];
    if (w.proj === 'arc' || w.proj === 'arcrocket') r *= F.mod.artRange || 1;
    if (w.tg.includes('a') && !w.tg.includes('g') && f.tech.has('radarguide')) r *= 1.3;
    if (w.tg === 'a' && src.kind === 'bld' && !World.hasRadar(src.owner)) r *= 0.75;
    if (src.kind === 'unit' && src.d.cat !== 'air') { const h = G.map.hgt[tileOf(src.x, src.y)]; if (h > 0.62 && (w.proj === 'bullet' || w.proj === 'shell')) r += 0.8; }
    return r * TILE;
  },
  hasRadar(fi) { const f = fac(fi); return f.radar; },

  canHit(wkey, t) {
    const w = WEAPONS[wkey];
    if (t.kind === 'unit') {
      if (t.d.cat === 'air') return t.alt > 0.3 ? w.tg.includes('a') : w.tg.includes('g');
      if (t.d.ab && t.d.ab.submerge && G.time - t.lastFire > 4) return w.tg.includes('s');
      if (w.naval) return t.d.cat === 'sea';
      return w.tg.includes('g');
    }
    if (w.naval) return false;
    return w.tg.includes('g');
  },

  validTarget(src, t) {
    if (!t || t.dead) return false;
    if (t.kind === 'unit' && t.inside) return false;
    if (t.kind === 'civb' && t.rubble) return false;
    if (t.kind === 'bridge' && t.broken) return false;
    return true;
  },

  // pick the best auto-target in range/sight
  scan(src, radius) {
    const out = G.hash.query(src.x, src.y, radius, this.tmp);
    let best = 0, bs = -1e9;
    const wl = src.kind === 'unit' ? src.d.w : src.d.w_;
    for (const e of out) {
      if (e.dead || (e.kind !== 'unit' && e.kind !== 'bld')) continue;
      if (!hostile(src.owner, e.owner)) continue;
      if (e.kind === 'unit' && e.inside) continue;
      if (!canSee(src.owner, e)) continue;
      let wi = -1; for (let i = 0; i < wl.length; i++) if (this.canHit(wl[i], e)) { wi = i; break; }
      if (wi < 0) continue;
      const w = WEAPONS[wl[wi]], dd = Math.hypot(e.x - src.x, e.y - src.y) - (e.kind === 'bld' ? e.rad : 0);
      if (w.min && dd < w.min * TILE) continue;
      let s = -dd / TILE;
      if (e.kind === 'bld') s -= e.d.w_ ? 2 : 8; else s += 4;
      if (e.kind === 'unit') { const ai = ARMOR[e.d.armor]; s += WH[w.wh][ai] * 6; if (G.time - e.lastFire < 3) s += 3; s += (1 - e.hp / e.maxHp) * 2; if (!e.d.w.length) s -= 3; }
      if (s > bs) { bs = s; best = e.id; }
    }
    return best;
  },

  fire(src, wi, t, wkeyOverride) {
    const wkey = wkeyOverride || (src.kind === 'unit' ? src.d.w[wi] : src.d.w_[wi]), w = WEAPONS[wkey];
    if (src.kind === 'unit' && src.d.ammo > 0) {
      if (src.ammo <= 0) return false;
      const big = w.proj !== 'bullet';
      if (big || Math.random() < 0.5) src.ammo--;
    }
    const tx = t ? t.x : src.fx, ty = t ? t.y : src.fy;
    const ang = U.ang(src.x, src.y, tx, ty);
    let acc = w.proj === 'bullet' ? 0.82 : 0.78;
    if (src.kind === 'unit') { if (src.supp > 40) acc -= 0.25; if (src.morale < 30) acc -= 0.2; if (src.moving) acc -= 0.12; acc += src.vet * 0.04; }
    if (t && t.kind === 'unit' && t.moving && t.d.cat !== 'inf') acc -= 0.1;
    if (t && t.kind !== 'unit') acc = 0.97;
    if (wkey === 'sniper') acc = 0.94;
    if (w.homing) acc = 0.9;
    if (G.weather.type === 'storm' || G.weather.type === 'fog') acc -= 0.08;
    const srcZ = src.kind === 'unit' && src.d.cat === 'air' ? src.alt * 24 : 0;
    const mx = src.x + Math.cos(src.kind === 'unit' && src.d.cat !== 'inf' && src.d.cat !== 'air' ? (this.turAng(src)) : ang) * (src.rad * 0.8), my = src.y + Math.sin(src.kind === 'unit' && src.d.cat !== 'inf' && src.d.cat !== 'air' ? this.turAng(src) : ang) * (src.rad * 0.8) - srcZ;
    const dmg = w.dmg * (src.kind === 'unit' && src.morale < 30 ? 0.7 : 1);
    const spread = w.spread || 0;
    const ex = tx + (spread ? U.rnd(-spread, spread) : 0), ey = ty + (spread ? U.rnd(-spread, spread) : 0);
    Proj.spawn({ type: w.proj, x: mx, y: my, z: srcZ, tx: ex, ty: ey, spd: w.spd, dmg, wh: w.wh, splash: w.splash || 0, owner: src.owner, src: src.id, tgt: t ? t.id : 0,
      hit: Math.random() < acc, homing: !!w.homing, supp: w.supp || 0, wkey, tz: t && isAir(t) ? t.alt * 24 : 0 });
    FX.muzzle(mx, my, ang, w.proj === 'shell' || w.proj === 'arc');
    src.lastFire = G.time;
    Bus.emit('sfx', w.snd, src.x, src.y);
    Civ.noise(src.x, src.y, 0.15);
    if (w.burst && !src.burst) src.burst = { left: w.burst - 1, wi, t: t ? t.id : 0, gap: w.bgap, k: 0, wkey, fx: tx, fy: ty };
    return true;
  },
  turAng(u) { return u.d.cat === 'inf' ? u.a : u.ta; },

  /* --------- unit update --------- */
  updUnit(u, dt) {
    if (u.inside) { const tr = G.ents.get(u.inside); if (!tr) { u.dead = true; G.ents.delete(u.id); return; } u.x = tr.x; u.y = tr.y; return; }
    const d = u.d;
    for (let i = 0; i < u.cool.length; i++) u.cool[i] -= dt;
    u.anim += dt;
    const fearless = !!(d.ab && d.ab.fearless);
    u.supp = fearless ? 0 : Math.max(0, u.supp - dt * 9);
    const f = fac(u.owner);
    if (fearless) u.morale = 100;
    else {
      if (G.time - u.lastHit > 6) u.morale = Math.min(100, u.morale + dt * (f.lack.food || f.lack.water ? 0.5 : 3));
      if (d.cat === 'inf' && (f.lack.food || f.lack.water)) u.morale = Math.max(10, u.morale - dt * 0.6);
    }
    // veterancy
    while (u.vet < 3 && u.xp >= VET_XP[u.vet + 1]) { u.vet++; Bus.emit('promoted', u); }
    if (u.vet && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.vet * 0.4 * dt);
    if (u.burst) {
      u.burst.k += dt;
      if (u.burst.k >= u.burst.gap) { u.burst.k = 0; const t = G.ents.get(u.burst.t); const b = u.burst; u.burst = null; if (t || b.fx != null) { u.fx = b.fx; u.fy = b.fy; this.fire(u, b.wi, t && !t.dead ? t : null, b.wkey); } if (b.left > 1) { u.burst = b; b.left--; } }
    }
    this.passives(u, dt);
    if (d.cat === 'air') return Air.update(u, dt);
    const wasX = u.x, wasY = u.y;
    // target scanning
    u.scanT -= dt;
    if (u.scanT <= 0) {
      u.scanT = 0.35 + Math.random() * 0.25;
      if (d.w.length && u.ammo !== 0 && !(u.ord && (u.ord.t === 'move' && !u.ord.am)) && u.state !== 'attack' && u.state !== 'retreat') {
        const cur = G.ents.get(u.tgt);
        if (!cur || cur.dead || !canSee(u.owner, cur) || Math.hypot(cur.x - u.x, cur.y - u.y) > (d.sight + 1) * TILE) {
          const r = Math.max(...d.w.map((k) => this.rangeOf(u, k))) * (u.state === 'idle' || u.state === 'guard' ? 1.25 : 1.05);
          u.tgt = this.scan(u, Math.min(r, (d.sight + 1) * TILE));
        }
      }
      // cover-seeking for infantry under fire
      if (d.cat === 'inf' && u.state === 'idle' && G.time - u.lastHit < 2 && G.time - u.ordT > 6 && !u.seek) this.seekCover(u);
      // morale break
      if (u.morale < 18 && u.state !== 'retreat' && d.cat !== 'sea' && G.time - u.ordT > 4) this.retreat(u, true);
    }
    switch (u.state) {
      case 'idle': case 'guard':
        if (u.tgt) this.engage(u, dt, u.state === 'guard' ? 6 : 3);
        else if (u.state === 'guard' && u.ord && Math.hypot(u.ord.x - u.x, u.ord.y - u.y) > 2 * TILE && !u.path && !u.pathReq) Path.request(u, u.ord.x, u.ord.y);
        if (u.path) this.follow(u, dt);
        break;
      case 'move': case 'retreat':
        if (u.ord && u.ord.am && u.tgt && this.engage(u, dt, 0)) break;
        if (this.follow(u, dt)) this.arrived(u);
        break;
      case 'attack': {
        const t = G.ents.get(u.ord && u.ord.id);
        if (!this.validTarget(u, t)) { this.idle(u); break; }
        u.tgt = t.id; this.engage(u, dt, 99, true);
        break;
      }
      case 'fireAt': {
        const o = u.ord; let wi = -1;
        for (let i = 0; i < d.w.length; i++) if (WEAPONS[d.w[i]].tg.includes('g')) { wi = i; break; }
        if (wi < 0 || u.ammo === 0) { this.idle(u); break; }
        const dist = Math.hypot(o.x - u.x, o.y - u.y), rng = this.rangeOf(u, d.w[wi]);
        if (dist > rng) { if (!u.path && !u.pathReq) Path.request(u, o.x, o.y); this.follow(u, dt); }
        else { u.path = null; if (this.aim(u, U.ang(u.x, u.y, o.x, o.y), dt) && u.cool[wi] <= 0) { u.fx = o.x; u.fy = o.y; this.fire(u, wi, null); u.cool[wi] = WEAPONS[d.w[wi]].rel; } }
        break;
      }
      case 'harvest': Abil.harvest(u, dt); break;
      case 'task': Abil.task(u, dt); break;
      case 'board': {
        const tr = G.ents.get(u.ord.id);
        if (!tr || tr.dead) { this.idle(u); break; }
        const dist = Math.hypot(tr.x - u.x, tr.y - u.y);
        if (dist < tr.rad + 18) { if (!this.board(u, tr)) this.idle(u); break; }
        if (!u.path && !u.pathReq || (u.repath = (u.repath || 0) - dt) < 0) { u.repath = 1.5; Path.request(u, tr.x, tr.y); }
        this.follow(u, dt);
        break;
      }
      case 'patrol': {
        if (u.tgt && this.engage(u, dt, 4)) break;
        if (this.follow(u, dt) || (!u.path && !u.pathReq)) { const o = u.ord; o.i = (o.i + 1) % o.pts.length; Path.request(u, o.pts[o.i].x, o.pts[o.i].y); }
        break;
      }
    }
    this.separate(u, dt);
    u.moving = Math.abs(u.x - wasX) + Math.abs(u.y - wasY) > 0.2 * dt * 30;
    if (u.moving && d.cat === 'veh' && Math.random() < 0.06 && G.map.terr[tileOf(u.x, u.y)] !== TER.URBAN && !G.map.road[tileOf(u.x, u.y)]) FX.add('dust', u.x - Math.cos(u.a) * u.rad, u.y - Math.sin(u.a) * u.rad, { size: 3, grow: 9, max: 0.9, c: '150,135,105', alpha: 0.35 });
    if (u.moving && d.cat === 'sea' && Math.random() < 0.3) FX.add('dust', u.x - Math.cos(u.a) * u.rad, u.y - Math.sin(u.a) * u.rad, { size: 2, grow: 10, max: 1.2, c: '220,235,240', alpha: 0.35 });
    if (u.moving && d.cat === 'veh') f.fuelUse += dt * (f.tech.has('logistics2') ? 0.021 : 0.03);
    if (u.moving && d.cat === 'sea') f.fuelUse += dt * 0.04;
  },

  passives(u, dt) {
    const ab = u.d.ab; if (!ab) return;
    u.pT = (u.pT || 0) - dt; if (u.pT > 0) return; u.pT = 0.5;
    const f = fac(u.owner);
    if (ab.heal) {
      let healed = 0;
      for (const o of G.hash.query(u.x, u.y, 3.5 * TILE, this.tmp)) {
        if (o.kind === 'unit' && o.d.cat === 'inf' && friendly(o.owner, u.owner) && o.hp < o.maxHp && !o.dead) { o.hp = Math.min(o.maxHp, o.hp + ab.heal * 0.5 * 2); if (Math.random() < 0.4) FX.heal(o.x, o.y); if (++healed >= 2) break; }
        else if (o.kind === 'civ' && o.injured && !o.dead) { Civ.treat(o, u.owner); FX.heal(o.x, o.y); }
      }
      if (!healed && u.state === 'idle' && G.time - u.ordT > 3) {
        for (const o of G.hash.query(u.x, u.y, 7 * TILE, this.tmp)) if ((o.kind === 'unit' && o.d.cat === 'inf' && o.owner === u.owner && o.hp < o.maxHp * 0.8 && o !== u) || (o.kind === 'civ' && o.injured)) { this.moveTo(u, o.x, o.y); u.ordT = G.time - 4; break; }
      }
    }
    if (ab.fix) {
      for (const o of G.hash.query(u.x, u.y, 3.5 * TILE, this.tmp)) if (o.kind === 'unit' && (o.d.cat === 'veh' || o.d.cat === 'sea') && o !== u && friendly(o.owner, u.owner) && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + ab.fix); if (Math.random() < 0.3) FX.add('spark', o.x, o.y, { size: 1.3, max: 0.3, c: '255,220,140', vx: U.rnd(-30, 30), vy: U.rnd(-30, 30) }); }
    }
    if (ab.resupply) {
      const rate = f.tech.has('logistics2') ? 0.24 : 0.12;
      for (const o of G.hash.query(u.x, u.y, 4 * TILE, this.tmp)) if (o.kind === 'unit' && o.d.ammo > 0 && o.ammo < o.d.ammo && friendly(o.owner, u.owner) && f.res.supplies > 0.5) { const add = Math.max(1, o.d.ammo * rate); o.ammo = Math.min(o.d.ammo, o.ammo + add); f.res.supplies -= add * 0.06; }
    }
  },

  seekCover(u) {
    const M = G.map, tx = (u.x / TILE) | 0, ty = (u.y / TILE) | 0;
    const cur = TER_INFO[M.terr[ty * M.w + tx]].cover || 0; if (cur >= 0.3) return;
    let best = null, bd = 1e9;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue; const i = y * M.w + x;
      let c = TER_INFO[M.terr[i]].cover || 0; const o = M.occ[i]; if (o) { const b = G.ents.get(o); if (b && b.d && b.d.cover && friendly(b.owner, u.owner)) c = b.d.cover; else continue; }
      if (c < 0.3 || !Path.cost('foot', i)) continue; const dd = Math.hypot(dx, dy); if (dd < bd) { bd = dd; best = [x, y]; }
    }
    if (best) { u.seek = true; this.moveTo(u, (best[0] + 0.5) * TILE, (best[1] + 0.5) * TILE); u.ord.seek = true; setTimeout(() => { u.seek = false; }, 8000); }
  },

  retreat(u, auto) {
    const f = u.owner; let best = null, bd = 1e9;
    for (const b of G.blds) {
      if (b.dead || b.owner !== f) continue;
      const pref = u.d.cat === 'inf' ? b.type === 'medical' : b.type === 'repair';
      const dd = Math.hypot(b.x - u.x, b.y - u.y) - (pref ? 4000 : b.type === 'hq' ? 1000 : 0);
      if (dd < bd) { bd = dd; best = b; }
    }
    if (!best) return;
    this.moveTo(u, best.x + U.rnd(-30, 30), best.y + best.h * TILE * 0.5 + 24);
    u.state = 'retreat'; u.tgt = 0;
    if (auto && u.owner === G.player && !u.retreatMsg) { u.retreatMsg = true; Bus.emit('msg', u.d.name + ' morale broken — falling back', 'warn', u.x, u.y); setTimeout(() => (u.retreatMsg = false), 20000); }
  },

  aim(u, ang, dt) {
    const d = u.d;
    if (d.cat === 'inf') { u.a = U.turn(u.a, ang, 8 * dt); return Math.abs(U.angDiff(u.a, ang)) < 0.3; }
    const sp = SPR.unit(u.type, fac(u.owner).key);
    if (sp.tur) { u.ta = U.turn(u.ta, ang, 3.2 * dt); return Math.abs(U.angDiff(u.ta, ang)) < 0.12; }
    u.a = U.turn(u.a, ang, (d.cat === 'sea' ? 0.8 : 2.4) * dt); u.ta = u.a;
    return Math.abs(U.angDiff(u.a, ang)) < (d.cat === 'sea' ? 1.2 : 0.2);
  },

  // returns true while engaged
  engage(u, dt, chaseTiles, explicit) {
    const t = G.ents.get(u.tgt), d = u.d;
    if (!this.validTarget(u, t) || (!explicit && !canSee(u.owner, t))) { u.tgt = 0; return false; }
    let wi = -1, best = 0;
    for (let i = 0; i < d.w.length; i++) if (this.canHit(d.w[i], t)) { const r = this.rangeOf(u, d.w[i]); if (wi < 0 || r > best) { wi = i; best = r; } }
    if (wi < 0) { u.tgt = 0; return false; }
    if (u.ammo === 0 && d.ammo > 0) { if (!explicit) u.tgt = 0; return false; }
    const dist = Math.hypot(t.x - u.x, t.y - u.y) - (t.kind === 'unit' ? 0 : t.rad * 0.85);
    const range = best;
    const w0 = WEAPONS[d.w[wi]];
    if (dist > range || (w0.min && dist < w0.min * TILE)) {
      if (chaseTiles > 0 && !(w0.min && dist < w0.min * TILE)) {
        u.repath = (u.repath || 0) - dt;
        if ((!u.path && !u.pathReq) || u.repath < 0) { u.repath = 1.6; Path.request(u, t.x, t.y); }
        this.follow(u, dt);
        if (!explicit && u.ord && Math.hypot(u.x - (u.ord.x || u.x), u.y - (u.ord.y || u.y)) > chaseTiles * TILE) { u.tgt = 0; return false; }
        return true;
      }
      return false;
    }
    if (explicit || u.state === 'idle' || u.state === 'guard' || u.state === 'patrol') u.path = null;
    const ang = U.ang(u.x, u.y, t.x, t.y);
    const aimed = this.aim(u, ang, dt);
    for (let i = 0; i < d.w.length; i++) {
      if (u.cool[i] > 0 || !this.canHit(d.w[i], t)) continue;
      const w = WEAPONS[d.w[i]], r = this.rangeOf(u, d.w[i]);
      if (dist > r || (w.min && dist < w.min * TILE)) continue;
      if (!aimed && w.proj !== 'missile' && w.proj !== 'bullet') continue;
      if (this.fire(u, i, t)) u.cool[i] = w.rel * (u.morale < 30 ? 1.6 : 1) * (u.supp > 60 ? 1.4 : 1) * (0.92 + Math.random() * 0.16);
    }
    return true;
  },

  follow(u, dt) {
    if (!u.path) return !u.pathReq && u.state !== 'idle';
    const p = u.path[u.pi]; if (!p) { u.path = null; return true; }
    const d = u.d, dx = p.x - u.x, dy = p.y - u.y, dist = Math.hypot(dx, dy);
    const spd = d.spd * this.speedMod(u);
    const last = u.pi === u.path.length - 1;
    if (dist < (last ? 3 : 10)) { u.pi++; if (u.pi >= u.path.length) { u.path = null; return true; } return false; }
    const ang = Math.atan2(dy, dx);
    let step;
    if (d.cat === 'inf') { u.a = U.turn(u.a, ang, 10 * dt); step = spd * dt; }
    else {
      const tr = d.cat === 'sea' ? 1.1 : d.mc === 'hover' ? 3 : 2.6;
      u.a = U.turn(u.a, ang, tr * dt);
      const off = Math.abs(U.angDiff(u.a, ang));
      step = off > 1.2 ? spd * dt * 0.15 : spd * dt * Math.cos(off * 0.8);
      if (!u.tgt) u.ta = U.turn(u.ta, u.a, 3 * dt);
    }
    step = Math.min(step, dist);
    const nx = u.x + Math.cos(d.cat === 'inf' ? ang : u.a) * step, ny = u.y + Math.sin(d.cat === 'inf' ? ang : u.a) * step;
    const ti = tileOf(nx, ny);
    const here = tileOf(u.x, u.y);
    if (Path.cost(d.mc, ti) > 0 || Path.cost(d.mc, here) === 0) { u.x = nx; u.y = ny; u.stuck = 0; u.realign = false; }
    else {
      // blocked by a corner: slide along whichever axis is free
      const tx = tileOf(nx, u.y), ty = tileOf(u.x, ny);
      if (Math.abs(nx - u.x) > step * 0.35 && Path.cost(d.mc, tx) > 0) { u.x = nx; u.stuck = Math.max(0, u.stuck - dt); }
      else if (Math.abs(ny - u.y) > step * 0.35 && Path.cost(d.mc, ty) > 0) { u.y = ny; u.stuck = Math.max(0, u.stuck - dt); }
      else {
        u.stuck += dt;
        const cx = ((here % G.map.w) + 0.5) * TILE, cy = (((here / G.map.w) | 0) + 0.5) * TILE;
        if (u.stuck > 0.35 && !u.realign) { u.realign = true; // realign to the tile centre, where the path was planned from
          u.path.splice(u.pi, 0, { x: cx, y: cy });
        } else if (u.stuck > 1.2) { // still jammed: replan, and as a last resort shuffle to the tile centre
          u.stuck = 0.4; u.realign = false; u.reroutes = (u.reroutes || 0) + 1;
          const goal = u.path[u.path.length - 1];
          if (u.reroutes % 3 === 0) { u.x += (cx - u.x) * 0.5; u.y += (cy - u.y) * 0.5; }
          Path.request(u, goal.x, goal.y);
        }
      }
    }
    return false;
  },

  separate(u, dt) {
    if (u.d.cat === 'air') return;
    if (u.state === 'harvest' && u.hs === 'unload') return;
    const out = G.hash.query(u.x, u.y, u.rad * 2.2, this.tmp2);
    let px = 0, py = 0;
    const isHarv = !!(u.d.ab && u.d.ab.harvest);
    for (const o of out) {
      if (o === u || o.kind !== 'unit' || o.dead || o.inside || o.d.cat === 'air' || (o.d.cat === 'sea') !== (u.d.cat === 'sea')) continue;
      if (o.state === 'harvest' && o.hs === 'unload') continue;
      const dx = u.x - o.x, dy = u.y - o.y, dd = Math.hypot(dx, dy) || 0.01, min = (u.rad + o.rad) * (isHarv && o.d.ab && o.d.ab.harvest ? 0.62 : 0.75);
      if (dd < min) { const k = ((min - dd) / min) * (isHarv ? 0.65 : 1); px += (dx / dd) * k; py += (dy / dd) * k; }
    }
    if (px || py) {
      const s = Math.min(1, Math.hypot(px, py)) * 40 * dt, a = Math.atan2(py, px);
      const nx = u.x + Math.cos(a) * s, ny = u.y + Math.sin(a) * s;
      if (Path.cost(u.d.mc, tileOf(nx, ny)) > 0) { u.x = nx; u.y = ny; }
    }
    const M = G.map; u.x = U.clamp(u.x, 4, M.w * TILE - 4); u.y = U.clamp(u.y, 4, M.h * TILE - 4);
  },

  arrived(u) {
    if (u.ord && u.ord.t === 'move' && Math.hypot(u.ord.x - u.x, u.ord.y - u.y) > 3 * TILE && (u.ord.re = (u.ord.re || 0) + 1) <= 8) { Path.request(u, u.ord.x, u.ord.y); return; }
    if (u.ord && u.ord.queue && u.ord.queue.length) { const n = u.ord.queue.shift(); this.moveTo(u, n.x, n.y, { am: n.am, queue: u.ord.queue }); return; }
    if (u.state === 'retreat') { u.state = 'idle'; u.ord = null; return; }
    if (u.d.ab && u.d.ab.harvest && u.ord && u.ord.t === 'move') { u.path = null; u.state = 'idle'; u.ord = { t: 'idle', x: u.x, y: u.y }; return; }
    this.idle(u);
  },
  idle(u) { u.path = null; if (u.d.ab && u.d.ab.harvest) { u.state = 'harvest'; u.hs = 'seek'; u.ord = null; return; } u.state = 'idle'; u.ord = { t: 'idle', x: u.x, y: u.y }; },
  moveTo(u, x, y, o = {}) {
    u.state = 'move'; u.ord = { t: 'move', x, y, am: !!o.am, queue: o.queue || null }; u.tgt = o.am ? u.tgt : 0; u.ordT = G.time;
    if (u.d.cat === 'air') { Air.order(u, u.ord); return; }
    Path.request(u, x, y);
  },

  board(u, tr) {
    const cap = tr.d.ab && tr.d.ab.carry; if (!cap) return false;
    const used = tr.cargo.reduce((s, id) => { const p = G.ents.get(id); return s + (p ? (p.d.cat === 'inf' ? 1 : 2) : 0); }, 0);
    const need = u.d.cat === 'inf' ? 1 : 2;
    if (tr.d.ab.carryInf && u.d.cat !== 'inf') return false;
    if (u.d.cat === 'air' || u.d.cat === 'sea') return false;
    if (used + need > cap) { if (u.owner === G.player) Bus.emit('msg', tr.d.name + ' is full', 'info'); return false; }
    tr.cargo.push(u.id); u.inside = tr.id; u.state = 'inside'; u.path = null; u.tgt = 0;
    const si = G.sel.indexOf(u); if (si >= 0) G.sel.splice(si, 1);
    Bus.emit('sfx', 'click', u.x, u.y);
    return true;
  },
  unload(tr) {
    if (!tr.cargo.length) return;
    if (tr.d.cat === 'air' && tr.alt > 0.05) { tr.landing = true; return; }
    const M = G.map, tx = (tr.x / TILE) | 0, ty = (tr.y / TILE) | 0;
    let placed = 0;
    for (const id of tr.cargo.slice()) {
      const p = G.ents.get(id); if (!p) continue;
      let spot = -1;
      for (let r = 1; r <= 3 && spot < 0; r++) for (let dy = -r; dy <= r && spot < 0; dy++) for (let dx = -r; dx <= r; dx++) { if (Path.passable(p.d.mc, tx + dx, ty + dy)) { spot = (ty + dy) * M.w + tx + dx; if (Math.random() < 0.5) break; } }
      if (spot < 0) continue;
      p.inside = 0; p.x = ((spot % M.w) + 0.5) * TILE + U.rnd(-6, 6); p.y = (((spot / M.w) | 0) + 0.5) * TILE + U.rnd(-6, 6); this.idle(p);
      tr.cargo.splice(tr.cargo.indexOf(id), 1); placed++;
    }
    if (!placed && tr.owner === G.player) Bus.emit('msg', 'No landing ground in reach — move closer to shore', 'info');
  },

  /* --------- building update --------- */
  updBld(b, dt) {
    const d = b.d, f = fac(b.owner);
    if (b.built < 1) { b.built = Math.min(1, b.built + (G.cfg.instant && fac(b.owner).isPlayer ? 1 : dt / 1.4)); return; }
    b.dish += dt * 1.4;
    if (b.upg) { b.upg.t += G.cfg.instant && f.isPlayer ? b.upg.T : dt * (f.lowPower ? 0.5 : 1); if (b.upg.t >= b.upg.T) { b.level = 2; b.upg = null; const k = b.hp / b.maxHp; if (b.type === 'hq') { b.maxHp *= 2; } else if (b.type === 'turret') b.maxHp *= 1.4; b.hp = b.maxHp * k; if (b.owner === G.player) Bus.emit('msg', d.up.name + ' complete', 'good', b.x, b.y); SPR.cache.delete('b:' + b.type + ':' + f.key + ':2'); } }
    if (b.repairing && b.hp < b.maxHp) {
      const amt = 40 * dt, cost = amt * 0.25;
      if (f.res.credits >= cost) { f.res.credits -= cost; b.hp = Math.min(b.maxHp, b.hp + amt); if (Math.random() < 0.1) FX.add('spark', b.x + U.rnd(-b.rad, b.rad) * 0.6, b.y + U.rnd(-b.rad, b.rad) * 0.6, { size: 1.4, max: 0.4, c: '255,220,140', vx: U.rnd(-20, 20), vy: -20 }); }
      if (b.hp >= b.maxHp) b.repairing = false;
    }
    this.burnTick(b, dt);
    if (b.hp < b.maxHp * 0.5 && Math.random() < dt * 4 * (1 - b.hp / b.maxHp)) FX.smoke(b.x + U.rnd(-b.rad, b.rad) * 0.5, b.y + U.rnd(-b.rad, b.rad) * 0.5, 1, true);
    if ((b.type === 'power') && !f.lowPower && Math.random() < dt * 2.5) { FX.smoke(b.tx * TILE + 18, b.ty * TILE + 14, 1.2); FX.smoke(b.tx * TILE + b.w * TILE - 18, b.ty * TILE + 14, 1.2); }
    const powered = !d.needPower || !f.lowPower;
    // support radii
    b.sT = (b.sT || 0) - dt;
    if (b.sT <= 0) {
      b.sT = 0.5;
      if (d.fixR || d.healR || d.supplyR) {
        const R = (d.fixR || d.healR || d.supplyR) * TILE + b.rad;
        for (const o of G.hash.query(b.x, b.y, R, this.tmp)) {
          if (o.kind !== 'unit' || o.dead || !friendly(o.owner, b.owner)) continue;
          if (d.fixR && (o.d.cat === 'veh') && o.hp < o.maxHp && f.res.credits > 1) { o.hp = Math.min(o.maxHp, o.hp + 12); f.res.credits -= 2; if (Math.random() < 0.5) FX.add('spark', o.x, o.y, { size: 1.3, max: 0.3, c: '255,220,140', vx: U.rnd(-30, 30), vy: U.rnd(-30, 30) }); }
          if (d.healR && o.d.cat === 'inf' && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + 6); o.morale = Math.min(100, o.morale + 4); if (Math.random() < 0.3) FX.heal(o.x, o.y); }
          if (d.supplyR && o.d.ammo > 0 && o.ammo < o.d.ammo && f.res.supplies > 0.5) { const add = o.d.ammo * (b.type === 'ammo' ? 0.2 : 0.1) * (f.tech.has('logistics2') ? 2 : 1); o.ammo = Math.min(o.d.ammo, o.ammo + add); f.res.supplies -= add * 0.05; }
        }
      }
    }
    // weapons
    const wl = d.w_ ? d.w_.slice() : (b.type === 'hq' && b.level > 1 ? ['turretgun'] : null);
    if (wl && powered) {
      if (!b.wl) b.wl = wl;
      b.cool -= dt; b.scanT -= dt;
      if (b.scanT <= 0) { b.scanT = 0.45; const cur = G.ents.get(b.tgt); if (!cur || cur.dead || Math.hypot(cur.x - b.x, cur.y - b.y) > this.rangeOf(b, wl[0]) + (cur.rad || 0) || !canSee(b.owner, cur)) { const fake = { x: b.x, y: b.y, owner: b.owner, kind: 'bld', d: { w_: wl }, level: b.level }; b.tgt = this.scan(fake, this.rangeOf(b, wl[0])); } }
      const t = G.ents.get(b.tgt);
      if (t && !t.dead && this.canHit(wl[0], t)) {
        const ang = U.ang(b.x, b.y, t.x, t.y);
        b.ta = U.turn(b.ta, ang, 2.5 * dt);
        if (b.cool <= 0 && Math.abs(U.angDiff(b.ta, ang)) < 0.15) {
          const w = WEAPONS[wl[0]], fake = { kind: 'bld', x: b.x, y: b.y, owner: b.owner, id: b.id, rad: b.rad * 0.6, d: { w_: wl }, level: b.level };
          this.fire(fake, 0, t); b.cool = w.rel * (b.level > 1 ? 0.8 : 1); b.lastFire = G.time;
        }
      } else if (b.type !== 'tower' && b.type !== 'bunker') b.ta += dt * 0.15;
    }
  },

  burnTick(b, dt) {
    if (b.burn <= 0) return;
    const wet = G.weather.type === 'rain' || G.weather.type === 'storm' || G.weather.type === 'snow';
    b.hp -= b.maxHp * 0.01 * b.burn * dt;
    b.burn = U.clamp(b.burn + dt * (wet ? -0.04 : 0.012) - (b.hp < b.maxHp * 0.12 ? dt * 0.05 : 0), 0, 1);
    if (Math.random() < dt * 10 * b.burn) FX.flame(b.x + U.rnd(-b.rad, b.rad) * 0.6, b.y + U.rnd(-b.rad, b.rad) * 0.6, 0.6 + b.burn);
    if (Math.random() < dt * 0.3 * b.burn) FX.light(b.x, b.y, 60 + b.burn * 50, 0.8, '255,150,60');
    b.spreadT = (b.spreadT || 0) - dt;
    if (b.spreadT <= 0) {
      b.spreadT = 2;
      if (b.burn > 0.45 && Math.random() < 0.3) for (const o of G.hash.query(b.x, b.y, b.rad + 44, this.tmp)) if ((o.kind === 'civb' && !o.rubble || o.kind === 'bld') && o !== b && o.burn <= 0 && Math.random() < 0.35) { o.burn = 0.25; break; }
    }
    if (b.hp <= 0) { if (b.kind === 'civb') this.killCiv(b, b.lastBlame == null ? -1 : b.lastBlame); else this.killBld(b, -1); }
  },

  updCivB(c, dt) {
    if (c.rubble) { if (c.burn > 0) { c.burn -= dt * 0.05; if (Math.random() < dt * 4 * c.burn) FX.smoke(c.x + U.rnd(-c.rad, c.rad) * 0.5, c.y + U.rnd(-c.rad, c.rad) * 0.5, 1, true); } return; }
    this.burnTick(c, dt);
    if (c.hp < c.maxHp * 0.45 && Math.random() < dt * 2) FX.smoke(c.x + U.rnd(-c.rad, c.rad) * 0.5, c.y + U.rnd(-c.rad, c.rad) * 0.5, 0.8, true);
    if ((c.type === 'factory' || c.type === 'powerstation') && Math.random() < dt * 1.2 && Civ.functional(c)) FX.smoke(c.tx * TILE + c.w * TILE - 14, c.ty * TILE + 12, 1);
    if (c.type === 'derrick' && c.ctrl >= 0) c.v = (c.v + dt) % 6.28;
  },
};

/* ---------------- projectiles ---------------- */
const Proj = {
  pool: new Pool(() => ({})),
  spawn(o) {
    const p = this.pool.get();
    Object.assign(p, { x: o.x, y: o.y, z: o.z || 0, sx: o.x, sy: o.y, sz: o.z || 0, tx: o.tx, ty: o.ty, tz: o.tz || 0, type: o.type, spd: o.spd || 600, dmg: o.dmg, wh: o.wh, splash: o.splash || 0,
      owner: o.owner, src: o.src, tgt: o.tgt || 0, hit: o.hit !== false, homing: !!o.homing, supp: o.supp || 0, t: 0, a: Math.atan2(o.ty - o.y, o.tx - o.x), dead: false, decoy: false, wkey: o.wkey });
    const dist = Math.hypot(o.tx - o.x, o.ty - o.y);
    p.T = p.type === 'bomb' ? 0.7 : p.type === 'crash' ? 1.1 : Math.max(0.05, dist / p.spd);
    if (!p.hit && p.type !== 'arc' && p.type !== 'arcrocket') { p.tx += U.rnd(-18, 18); p.ty += U.rnd(-18, 18); }
    if (p.type === 'missile' && p.tgt) {
      const t = G.ents.get(p.tgt);
      if (t && t.kind === 'unit' && t.d.cat === 'air' && fac(t.owner).tech.has('ecm') && Math.random() < 0.35) { p.decoy = true; p.hit = false; FX.flare(t.x, t.y - t.alt * 24); }
    }
    G.proj.push(p); return p;
  },
  update(dt) {
    const P = G.proj;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.t += dt;
      if (p.homing && !p.decoy && p.tgt) {
        const t = G.ents.get(p.tgt);
        if (t && !t.dead) { p.tx = t.x; p.ty = t.y; p.tz = isAir(t) ? t.alt * 24 : 0; }
      }
      if (p.type === 'missile' || p.type === 'torp' || (p.type === 'rocket' && p.homing)) {
        const des = Math.atan2(p.ty - p.tz - p.y, p.tx - p.x);
        p.a = U.turn(p.a, des, (p.type === 'torp' ? 2 : 5) * dt);
        const s = p.spd * dt; p.x += Math.cos(p.a) * s; p.y += Math.sin(p.a) * s;
        p.z = U.lerp(p.z, 0, dt * 2);
        if (p.type === 'missile' && Math.random() < 0.8) FX.trail(p.x, p.y, false);
        if (p.type === 'torp' && Math.random() < 0.5) FX.add('dust', p.x, p.y, { size: 1.5, grow: 4, max: 0.8, c: '220,235,245', alpha: 0.4 });
        if (Math.hypot(p.tx - p.x, p.ty - p.tz - p.y) < 8 || p.t > 6) this.impact(p);
      } else if (p.type === 'arc' || p.type === 'arcrocket') {
        const k = Math.min(1, p.t / p.T), dist = Math.hypot(p.tx - p.sx, p.ty - p.sy);
        p.x = U.lerp(p.sx, p.tx, k); p.y = U.lerp(p.sy, p.ty, k); p.z = Math.sin(k * Math.PI) * dist * 0.28 + p.sz * (1 - k);
        if (p.type === 'arcrocket' && Math.random() < 0.9) FX.trail(p.x, p.y - p.z, true);
        if (k >= 1) this.impact(p);
      } else if (p.type === 'bomb' || p.type === 'crash') {
        const k = Math.min(1, p.t / p.T); p.x = U.lerp(p.sx, p.tx, k); p.y = U.lerp(p.sy, p.ty, k); p.z = p.sz * (1 - k * k);
        if (p.type === 'crash' && Math.random() < 0.8) FX.smoke(p.x, p.y - p.z, 1, true);
        if (k >= 1) this.impact(p);
      } else {
        const k = Math.min(1, p.t / p.T); p.x = U.lerp(p.sx, p.tx, k); p.y = U.lerp(p.sy, p.ty - p.tz, k); p.z = 0;
        if (p.type === 'rocket' && Math.random() < 0.85) FX.trail(p.x, p.y, false);
        if (k >= 1) this.impact(p);
      }
      if (p.dead) { P[i] = P[P.length - 1]; P.pop(); this.pool.put(p); }
    }
  },
  impact(p) {
    p.dead = true;
    const t = p.tgt ? G.ents.get(p.tgt) : null;
    if (p.splash) {
      if (p.type === 'arc' || p.type === 'arcrocket' || p.type === 'bomb' || p.type === 'crash' || !t || !p.hit) {
        FX.explosion(p.tx, p.ty, p.splash / 45);
        World.blast(p.tx, p.ty, p.splash, p.dmg, p.wh, p.owner, p.src);
        return;
      }
    }
    if (t && !t.dead && p.hit && World.canHit(p.wkey || 'rifle', t) !== false) {
      World.hurt(t, p.dmg, p.wh, p.owner, p.src);
      if (t.kind === 'unit' && t.d.cat === 'inf') t.supp = Math.min(100, t.supp + p.supp);
      if (t.kind === 'unit' && t.d.cat !== 'inf' || t.kind === 'bld') FX.smallHit(p.x, p.y, true);
      if (p.splash) { FX.explosion(p.x, p.y, p.splash / 50); World.blast(p.x, p.y, p.splash * 0.7, p.dmg * 0.4, p.wh, p.owner, p.src); }
      else if (p.type === 'shell' || p.type === 'rocket' || p.type === 'missile' || p.type === 'torp') FX.explosion(p.x, p.y, p.type === 'missile' || p.type === 'torp' ? 0.7 : 0.45);
    } else {
      // miss: near-miss suppression and collateral
      FX.smallHit(p.x, p.y, false);
      if (p.type !== 'bullet') { FX.explosion(p.x, p.y, 0.35); World.blast(p.x, p.y, 14, p.dmg * 0.25, p.wh, p.owner, p.src, { noDecal: true }); }
      else { for (const e of G.hash.query(p.x, p.y, 14, World.tmp)) { if (e.kind === 'unit' && e.d.cat === 'inf' && !e.dead) e.supp = Math.min(100, e.supp + p.supp * 0.6); else if (e.kind === 'civ' && !e.dead && Math.random() < 0.12) Civ.hit(e, p.dmg, p.owner); } }
    }
  },
};

/* ---------------- aircraft behaviour ---------------- */
const Air = {
  order(u, o) {
    if (u.d.plane) {
      if (u.alt < 0.5 && fac(u.owner).lack.fuel) { if (u.owner === G.player) Bus.emit('msg', 'Aircraft grounded — no fuel', 'warn'); return; }
      World.undockSoft(u);
      if (o.t === 'attack') u.state = 'strike'; else u.state = 'fly';
      u.ord = o;
    } else { u.state = o.t === 'attack' ? 'attack' : 'fly'; u.ord = o; u.landing = false; }
  },
  update(u, dt) {
    const d = u.d, f = fac(u.owner);
    if (u.alt > 0.3) f.fuelUse += dt * 0.08;
    if (d.plane) return this.plane(u, dt);
    return this.heli(u, dt);
  },
  steer(u, tx, ty, dt, tr) {
    const des = U.ang(u.x, u.y, tx, ty);
    u.a = U.turn(u.a, des, tr * dt);
    const s = u.d.spd * World.speedMod(u) * dt * (u.alt < 1 ? 0.6 + u.alt * 0.4 : 1);
    u.x += Math.cos(u.a) * s; u.y += Math.sin(u.a) * s;
    const M = G.map; u.x = U.clamp(u.x, 8, M.w * TILE - 8); u.y = U.clamp(u.y, 8, M.h * TILE - 8);
  },
  findHome(u) {
    let best = null, bd = 1e9;
    for (const b of G.blds) if (!b.dead && b.owner === u.owner && b.type === 'hangar' && b.built >= 1) {
      const free = b.docks.indexOf(0), mine = b.docks.indexOf(u.id);
      if (free < 0 && mine < 0) continue;
      const dd = Math.hypot(b.x - u.x, b.y - u.y); if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  },
  dockPos(b, i) { return { x: b.tx * TILE + 16 + i * 22, y: b.ty * TILE + b.h * TILE * 0.75 }; },
  plane(u, dt) {
    const d = u.d, o = u.ord || {};
    const tr = u.type === 'bomber' ? 1.0 : u.type === 'fighter' ? 2.0 : 1.5;
    if (u.state === 'docked') {
      u.alt = Math.max(0, u.alt - dt);
      const h = G.ents.get(u.home);
      if (!h || h.dead) { u.state = 'orbit'; u.ord = { t: 'orbit', x: u.x, y: u.y }; return; }
      const p = this.dockPos(h, h.docks.indexOf(u.id)); u.x = U.lerp(u.x, p.x, dt * 3); u.y = U.lerp(u.y, p.y, dt * 3); u.a = U.turn(u.a, -Math.PI / 2, dt * 2);
      u.rearm += dt;
      const fr = fac(u.owner);
      if (u.ammo < d.ammo && u.rearm > 1.4 && fr.res.supplies > 2) { u.rearm = 0; u.ammo++; fr.res.supplies -= 2; }
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 8 * dt);
      return;
    }
    u.alt = Math.min(1, u.alt + dt * 0.7);
    // auto-acquire for fighters and armed aircraft
    u.scanT -= dt;
    if (u.scanT <= 0) {
      u.scanT = 0.4;
      if (d.w.length && u.ammo > 0 && (u.state === 'orbit' || u.state === 'fly' && o.am)) {
        const tg = World.scan(u, d.sight * TILE);
        if (tg) { const t = G.ents.get(tg); if (u.type === 'fighter' ? isAir(t) : true) { u.state = 'strike'; u.ord = { t: 'attack', id: tg, auto: true, rx: o.x, ry: o.y }; } }
      }
      if (u.type === 'reconplane' && u.state === 'orbit') { u.orbT = (u.orbT || 0) + 0.4; if (u.orbT > 25) { u.orbT = 0; u.state = 'rtb'; } }
    }
    if (u.state === 'fly') {
      this.steer(u, o.x, o.y, dt, tr);
      if (Math.hypot(o.x - u.x, o.y - u.y) < 40) { u.state = 'orbit'; u.ord = { t: 'orbit', x: o.x, y: o.y }; }
    } else if (u.state === 'orbit') {
      const ox = o.x != null ? o.x : u.x, oy = o.y != null ? o.y : u.y, rad = 90;
      const a = U.ang(ox, oy, u.x, u.y) + 0.5;
      this.steer(u, ox + Math.cos(a) * rad, oy + Math.sin(a) * rad, dt, tr);
      if (d.w.length && u.ammo <= 0) u.state = 'rtb';
    } else if (u.state === 'strike') {
      const t = G.ents.get(o.id);
      if (!World.validTarget(u, t) || u.ammo <= 0) { u.state = u.ammo > 0 ? 'orbit' : 'rtb'; u.ord = { t: 'orbit', x: o.rx != null ? o.rx : u.x, y: o.ry != null ? o.ry : u.y }; return; }
      const dist = Math.hypot(t.x - u.x, t.y - u.y);
      if (dist < 50 && u.type !== 'bomber') { // overshoot and loop
        this.steer(u, u.x + Math.cos(u.a) * 100, u.y + Math.sin(u.a) * 100, dt, tr * 0.3);
      } else this.steer(u, t.x, t.y, dt, tr);
      for (let i = 0; i < d.w.length; i++) {
        if (u.cool[i] > 0 || !World.canHit(d.w[i], t)) continue;
        const w = WEAPONS[d.w[i]], r = World.rangeOf(u, d.w[i]);
        const off = Math.abs(U.angDiff(u.a, U.ang(u.x, u.y, t.x, t.y)));
        if (dist > r + t.rad * 0.5 || off > (w.proj === 'bomb' ? 1.2 : 0.5)) continue;
        if (w.proj === 'bomb') { Proj.spawn({ type: 'bomb', x: u.x, y: u.y, z: 24, tx: u.x + Math.cos(u.a) * 26, ty: u.y + Math.sin(u.a) * 26, dmg: w.dmg, wh: w.wh, splash: w.splash, owner: u.owner, src: u.id }); u.ammo--; u.lastFire = G.time; Bus.emit('sfx', 'whistle', u.x, u.y); }
        else World.fire(u, i, t);
        u.cool[i] = w.rel;
      }
    } else if (u.state === 'rtb') {
      const h = G.ents.get(u.home) && !G.ents.get(u.home).dead ? G.ents.get(u.home) : this.findHome(u);
      if (!h) { u.state = 'orbit'; const hq = G.blds.find((b) => b.owner === u.owner); u.ord = { t: 'orbit', x: hq ? hq.x : u.x, y: hq ? hq.y : u.y }; return; }
      if (h.docks.indexOf(u.id) < 0) { const fi = h.docks.indexOf(0); if (fi < 0) { u.state = 'orbit'; return; } h.docks[fi] = u.id; u.home = h.id; }
      const p = this.dockPos(h, h.docks.indexOf(u.id));
      this.steer(u, p.x, p.y, dt, tr * 1.3);
      if (Math.hypot(p.x - u.x, p.y - u.y) < 30) { u.state = 'docked'; u.ord = null; }
    }
  },
  heli(u, dt) {
    const d = u.d, o = u.ord || {};
    if (u.landing) { u.alt = Math.max(0, u.alt - dt * 0.8); if (u.alt <= 0.02) { u.landing = false; World.unload(u); } return; }
    if (u.state !== 'landed') u.alt = Math.min(1, u.alt + dt * 0.6);
    u.scanT -= dt;
    if (u.scanT <= 0 && d.w.length && u.ammo > 0 && (u.state === 'idle' || u.state === 'hover' || (u.state === 'fly' && o.am))) {
      u.scanT = 0.4; const tg = World.scan(u, d.sight * TILE); if (tg) { u.tgt = tg; }
    }
    if (d.w.length && u.ammo <= 0 && d.ammo > 0 && u.state !== 'rearm') { u.state = 'rearm'; }
    const spdMove = (tx, ty, stopAt) => {
      const dist = Math.hypot(tx - u.x, ty - u.y); if (dist < stopAt) return true;
      const des = U.ang(u.x, u.y, tx, ty); u.a = U.turn(u.a, des, 3 * dt);
      const s = Math.min(dist, d.spd * World.speedMod(u) * dt); u.x += Math.cos(des) * s; u.y += Math.sin(des) * s; u.moving = true; return false;
    };
    u.moving = false;
    if (u.state === 'fly') { if (u.tgt && o.am) { u.state = 'hover'; } else if (spdMove(o.x, o.y, 6)) { u.state = 'hover'; } }
    else if (u.state === 'attack') { const t = G.ents.get(o.id); if (!World.validTarget(u, t)) { u.state = 'hover'; u.tgt = 0; } else u.tgt = t.id; }
    else if (u.state === 'rearm') {
      const h = this.findHome(u) || G.ents.get(u.home);
      if (!h || h.dead) { u.state = 'hover'; }
      else { if (h.docks.indexOf(u.id) < 0) { const fi = h.docks.indexOf(0); if (fi >= 0) { h.docks[fi] = u.id; u.home = h.id; } }
        const p = this.dockPos(h, Math.max(0, h.docks.indexOf(u.id)));
        if (spdMove(p.x, p.y, 4)) { u.alt = Math.max(0.05, u.alt - dt); u.rearm += dt; const fr = fac(u.owner); if (u.rearm > 0.6 && fr.res.supplies > 1) { u.rearm = 0; u.ammo = Math.min(d.ammo, u.ammo + 1); fr.res.supplies -= 1.5; } if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 10 * dt); if (u.ammo >= d.ammo && u.hp >= u.maxHp * 0.95) { World.undockSoft(u); u.state = 'hover'; } } }
    }
    if (u.tgt && u.state !== 'rearm') {
      const t = G.ents.get(u.tgt);
      if (!World.validTarget(u, t) || !canSee(u.owner, t) && u.state !== 'attack') u.tgt = 0;
      else if (d.ab && d.ab.kamikaze) {
        // Loitering munition dives directly onto target and detonates shaped-charge warhead
        const dist = Math.hypot(t.x - u.x, t.y - u.y) - (t.kind === 'unit' ? 0 : t.rad * 0.6);
        if (dist > 18) {
          spdMove(t.x, t.y, 6);
          u.alt = Math.max(0.2, Math.min(1, dist / 140));
        } else {
          FX.explosion(t.x, t.y, 1.35);
          World.hurt(t, 240, 'at', u.owner, u.id);
          World.blast(t.x, t.y, 44, 140, 'he', u.owner, u.id);
          World.undock(u);
          u.dead = true; u.hp = 0; G.ents.delete(u.id);
          return;
        }
      } else {
        let best = 0; for (const k of d.w) if (World.canHit(k, t)) best = Math.max(best, World.rangeOf(u, k));
        const dist = Math.hypot(t.x - u.x, t.y - u.y) - (t.kind === 'unit' ? 0 : t.rad * 0.8);
        if (!best) u.tgt = 0;
        else if (dist > best * 0.9) spdMove(t.x, t.y, best * 0.8);
        else {
          const ang = U.ang(u.x, u.y, t.x, t.y); u.a = U.turn(u.a, ang, 3 * dt);
          for (let i = 0; i < d.w.length; i++) { if (u.cool[i] > 0 || !World.canHit(d.w[i], t)) continue; const r = World.rangeOf(u, d.w[i]); if (dist > r || Math.abs(U.angDiff(u.a, ang)) > 0.4) continue; World.fire(u, i, t); u.cool[i] = WEAPONS[d.w[i]].rel; }
        }
      }
    }
    // gentle spacing between helicopters
    for (const oth of G.hash.query(u.x, u.y, 26, World.tmp2)) if (oth !== u && oth.kind === 'unit' && oth.d.cat === 'air' && !oth.d.plane) { const a = U.ang(oth.x, oth.y, u.x, u.y); u.x += Math.cos(a) * 20 * dt; u.y += Math.sin(a) * 20 * dt; }
  },
};
World.undockSoft = function (u) { if (u.state === 'docked') { u.state = 'fly'; } };

/* ---------------- special abilities ---------------- */
const Abil = {
  harvest(u, dt) {
    const M = G.map, f = fac(u.owner), cap = u.d.ab.harvest;
    if (u.tgt && u.d.w.length) World.engage(u, dt, 0);
    // watchdog: a truck that is supposed to be driving but has not moved for 4.5 s gets a fresh plan
    if (u.hs === 'go' || u.hs === 'return' || u.hs === 'seek') {
      if (u.wdX === undefined || Math.hypot(u.x - u.wdX, u.y - u.wdY) > 4) { u.wdX = u.x; u.wdY = u.y; u.wdT = 0; }
      else if ((u.wdT += dt) > 4.5) {
        u.wdT = 0; u.path = null; u.pathReq = null; u.stuck = 0; u.realign = false;
        const t = Path.nearestPassable(u.d.mc, (u.x / TILE) | 0, (u.y / TILE) | 0, 5);
        if (t >= 0) {
          const cx = ((t % M.w) + 0.5) * TILE, cy = (((t / M.w) | 0) + 0.5) * TILE;
          if (Path.cost(u.d.mc, tileOf(u.x, u.y)) === 0) { u.x = cx; u.y = cy; }
          else { u.x = U.lerp(u.x, cx, 0.5); u.y = U.lerp(u.y, cy, 0.5); }
        }
        if (u.hs === 'go') u.badOre = u.oreT;
        u.hs = u.harv >= cap * 0.4 ? 'return' : 'seek';
      }
    } else u.wdX = undefined;
    switch (u.hs) {
      case 'seek': {
        let t = this.findOre(u, 32);
        if (t < 0 && (u.oreX != null || u.oreY != null)) { u.oreX = undefined; u.oreY = undefined; t = this.findOre(u, 48); }
        if (t < 0) t = this.findOre(u, 64);
        if (t < 0) { u.hs = u.harv > 0 ? 'return' : 'idle'; if (u.hs === 'idle' && u.owner === G.player && !u.noOreMsg) { u.noOreMsg = true; Bus.emit('msg', 'Ore collector found no ore in range', 'warn', u.x, u.y); } break; }
        u.noOreMsg = false; u.oreT = t; u.oreX = t % M.w; u.oreY = (t / M.w) | 0; u.hs = 'go';
        Path.request(u, (u.oreX + 0.5) * TILE, (u.oreY + 0.5) * TILE);
        break;
      }
      case 'go': {
        if (u.oreT == null || M.ore[u.oreT] < 10 || M.occ[u.oreT]) { u.path = null; u.hs = 'seek'; break; }
        const tx = ((u.oreT % M.w) + 0.5) * TILE, ty = (((u.oreT / M.w) | 0) + 0.5) * TILE;
        const curT = tileOf(u.x, u.y);
        if (Math.hypot(tx - u.x, ty - u.y) < 28 || (M.ore[curT] >= 20 && Math.hypot(tx - u.x, ty - u.y) < 56)) {
          if (M.ore[curT] >= 20 && !M.occ[curT]) u.oreT = curT;
          u.path = null; u.hs = 'mine'; u.mT = 0; break;
        }
        if (World.follow(u, dt)) {
          if (Math.hypot(tx - u.x, ty - u.y) < 38) { u.path = null; u.hs = 'mine'; u.mT = 0; }
          else { u.badOre = u.oreT; u.hs = 'seek'; }
        } else if (!u.path && !u.pathReq) { u.badOre = u.oreT; u.hs = 'seek'; }
        break;
      }
      case 'mine': {
        u.mT += dt;
        const tx = ((u.oreT % M.w) + 0.5) * TILE, ty = (((u.oreT / M.w) | 0) + 0.5) * TILE;
        if (Math.hypot(tx - u.x, ty - u.y) > 10) {
          const a = Math.atan2(ty - u.y, tx - u.x);
          u.a = U.turn(u.a, a, 4 * dt);
          u.x += Math.cos(a) * Math.min(18 * dt, Math.hypot(tx - u.x, ty - u.y));
          u.y += Math.sin(a) * Math.min(18 * dt, Math.hypot(tx - u.x, ty - u.y));
        } else {
          u.a += Math.sin(G.time * 2.5 + u.id) * dt * 0.35;
        }
        if (Math.random() < 0.25) FX.add('dust', u.x + Math.cos(u.a) * 10, u.y + Math.sin(u.a) * 10, { size: 3, grow: 8, max: 0.8, c: '215,185,85', alpha: 0.4 });
        if (u.mT >= 0.45) {
          u.mT = 0; let ore = M.ore[u.oreT];
          if (ore <= 0 || M.occ[u.oreT]) {
            const n = this.findOre(u, 6);
            if (n >= 0) { u.oreT = n; u.oreX = n % M.w; u.oreY = (n / M.w) | 0; u.hs = 'go'; Path.request(u, (u.oreX + 0.5) * TILE, (u.oreY + 0.5) * TILE); }
            else u.hs = u.harv > 0 ? 'return' : 'seek';
            break;
          }
          const take = Math.min(ore, 32, cap - u.harv); M.ore[u.oreT] -= take; u.harv += take;
          if (M.ore[u.oreT] < 20) { M.ore[u.oreT] = 0; Render.miniDirty = true; }
          if (u.harv >= cap) { u.hs = 'return'; u.path = null; }
        }
        break;
      }
      case 'return': {
        const r = this.nearestRef(u);
        if (!r) { u.hs = 'idle'; break; }
        const dock = this.refDock(r, u);
        const dist = Math.hypot(dock.x - u.x, dock.y - u.y);
        // Check if another harvester is actively unloading right in front of us at this refinery
        const busy = G.units.some((o) => o !== u && !o.dead && o.owner === u.owner && o.state === 'harvest' && o.hs === 'unload' && o.ref === r.id && Math.hypot(o.x - dock.x, o.y - dock.y) < 18);
        if (dist < 30 && !busy) { u.hs = 'unload'; u.mT = 0; u.path = null; u.ref = r.id; u.dockX = dock.x; u.dockY = dock.y; break; }
        if (dist < 48 && busy) { u.path = null; u.wdT = 0; u.a = U.turn(u.a, U.ang(u.x, u.y, r.x, r.y), dt * 3); break; }
        u.retRepath = (u.retRepath || 0) - dt;
        if ((!u.path && !u.pathReq) || u.retRepath <= 0) { u.retRepath = 2.5; Path.request(u, dock.x, dock.y); }
        if (World.follow(u, dt) && dist >= 30) { Path.request(u, dock.x, dock.y); }
        break;
      }
      case 'unload': {
        u.mT += dt;
        const r = G.ents.get(u.ref);
        if (!r || r.dead) { u.hs = 'return'; break; }
        if (u.dockX != null) { u.x = U.lerp(u.x, u.dockX, Math.min(1, dt * 6)); u.y = U.lerp(u.y, u.dockY, Math.min(1, dt * 6)); }
        u.a = U.turn(u.a, -Math.PI / 2, dt * 4);
        if (Math.random() < 0.25) FX.add('spark', u.x + U.rnd(-6, 6), u.y - 8, { vx: U.rnd(-15, 15), vy: U.rnd(-25, -5), size: 1.3, max: 0.3, c: '245,210,95' });
        if (u.mT > 1.8) {
          const mult = (r && r.level > 1 ? 1.25 : 1) * (f.isAI ? f.aiBonus : 1);
          f.res.credits += u.harv * mult; f.stats.harvested += u.harv * mult; u.harv = 0; u.hs = 'seek';
          Bus.emit('sfx', 'cash', u.x, u.y);
        }
        break;
      }
      case 'idle': u.idleT = (u.idleT || 0) + dt; if (u.idleT > 4) { u.idleT = 0; if (u.harv > 0 && this.nearestRef(u)) u.hs = 'return'; else u.hs = 'seek'; } break;
    }
  },
  findOre(u, maxR = 32) {
    const M = G.map, tx = (u.x / TILE) | 0, ty = (u.y / TILE) | 0;
    let best = -1, bd = 1e9;
    const ox = u.oreX != null ? u.oreX : tx, oy = u.oreY != null ? u.oreY : ty;
    // Count other friendly harvesters targeting each tile so trucks spread across the ore patch
    const taken = new Set();
    for (const o of G.units) if (o !== u && !o.dead && o.owner === u.owner && o.oreT != null && (o.hs === 'go' || o.hs === 'mine')) taken.add(o.oreT);
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ox + dx, y = oy + dy; if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue;
        const i = y * M.w + x; if (M.ore[i] < 20 || M.occ[i] || i === u.badOre) continue;
        if (!Path.cost(u.d.mc, i)) continue;
        if (!Path.sameComp('track', tx, ty, x, y)) continue;
        const dd = Math.hypot(x - tx, y - ty) + Math.hypot(dx, dy) * 0.35 + (taken.has(i) ? 4.5 : 0);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0 && r > bd + 2) break;
    }
    return best;
  },
  refDock(r, u) {
    const M = G.map, bays = [-1, 0, 1];
    const slot = bays[u.id % 3];
    const baseTx = U.clamp(r.tx + 1 + slot, 0, M.w - 1), baseTy = U.clamp(r.ty + r.h, 0, M.h - 1);
    if (Path.passable(u.d.mc, baseTx, baseTy)) return { x: (baseTx + 0.5) * TILE, y: (baseTy + 0.38) * TILE };
    for (const b of [0, -1, 1]) {
      const tx = U.clamp(r.tx + 1 + b, 0, M.w - 1), ty = U.clamp(r.ty + r.h, 0, M.h - 1);
      if (Path.passable(u.d.mc, tx, ty)) return { x: (tx + 0.5) * TILE, y: (ty + 0.38) * TILE };
    }
    const np = Path.nearestPassable(u.d.mc, r.tx + 1, r.ty + r.h, 4);
    if (np >= 0) return { x: ((np % M.w) + 0.5) * TILE, y: (((np / M.w) | 0) + 0.5) * TILE };
    return { x: r.x, y: (r.ty + r.h) * TILE + 12 };
  },
  nearestRef(u) {
    let best = null, bd = 1e9;
    const tx = (u.x / TILE) | 0, ty = (u.y / TILE) | 0;
    for (const b of G.blds) {
      if (b.dead || b.owner !== u.owner || b.type !== 'refinery' || b.built < 1) continue;
      if (!Path.sameComp('track', tx, ty, b.tx + 1, Math.min(G.map.h - 1, b.ty + b.h))) continue;
      const q = G.units.filter((o) => o !== u && !o.dead && o.owner === u.owner && o.state === 'harvest' && (o.hs === 'return' || o.hs === 'unload') && o.ref === b.id).length;
      const d = Math.hypot(b.x - u.x, b.y - u.y) + q * 48;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) {
      for (const b of G.blds) if (!b.dead && b.owner === u.owner && b.type === 'refinery' && b.built >= 1) { const d = Math.hypot(b.x - u.x, b.y - u.y); if (d < bd) { bd = d; best = b; } }
    }
    return best;
  },

  // generic "go to an entity and do something" tasks
  task(u, dt) {
    const o = u.ord, t = G.ents.get(o.id), f = fac(u.owner);
    if (!t || t.dead && o.t !== 'clear') { World.idle(u); return; }
    const reach = (t.rad || 10) + u.rad + (o.t === 'aid' ? 26 : 10);
    const dist = Math.hypot(t.x - u.x, t.y - u.y);
    if (dist > reach) {
      if ((!u.path && !u.pathReq) || (u.repath = (u.repath || 0) - dt) < 0) { u.repath = 3; let gx = t.x, gy = t.y; if (o.t === 'aid' && t.door >= 0) { gx = ((t.door % G.map.w) + 0.5) * TILE; gy = (((t.door / G.map.w) | 0) + 0.5) * TILE; } Path.request(u, gx, gy); }
      if (World.follow(u, dt) && dist > reach * 1.8 && u.pathFail > 2) World.idle(u);
      return;
    }
    u.path = null;
    switch (o.t) {
      case 'capture': {
        if (t.kind === 'civb' && t.d.cap) { const prev = t.ctrl; t.ctrl = u.owner; Civ.captured(t, u.owner, prev); u.dead = true; G.ents.delete(u.id); return; }
        if (t.kind === 'bld' && t.owner !== u.owner) {
          if (t.hp > t.maxHp * 0.5 && hostile(u.owner, t.owner)) { if (u.owner === G.player) Bus.emit('msg', 'Damage the structure below 50% before capturing', 'info'); World.idle(u); return; }
          const old = t.owner; t.owner = u.owner; t.tgt = 0; Bus.emit('msg', fac(u.owner).name + ' captured a ' + t.d.name, u.owner === G.player ? 'good' : 'warn', t.x, t.y); Bus.emit('captured', t, old); u.dead = true; G.ents.delete(u.id); return;
        }
        World.idle(u); return;
      }
      case 'repair': {
        const rate = (u.d.ab.repair === 2.5 ? 75 : 32) * (f.tech.has('civeng') ? 2 : 1) * dt;
        if (Math.random() < 0.3) FX.add('spark', t.x + U.rnd(-t.rad, t.rad) * 0.5, t.y + U.rnd(-t.rad, t.rad) * 0.5, { size: 1.3, max: 0.4, c: '255,220,140', vx: U.rnd(-20, 20), vy: -20 });
        const matCost = rate * 0.04;
        if (f.res.materials < matCost) { if (u.owner === G.player && !u.matMsg) { u.matMsg = true; Bus.emit('msg', 'Repairs halted — no construction materials', 'warn'); } return; }
        f.res.materials -= matCost;
        if (t.kind === 'civb') {
          if (t.rubble) { t.rubble = false; t.hp = t.maxHp * 0.1; t.burn = 0; Civ.rebuilt(t, u.owner, 0.5); }
          t.hp = Math.min(t.maxHp, t.hp + rate); t.burn = Math.max(0, t.burn - dt * 0.3); Civ.rebuilt(t, u.owner, rate / t.maxHp);
          if (t.hp >= t.maxHp) { if (t.abandoned) { t.abandoned = false; if (t.type === 'ruin') { t.type = 'house'; t.d = CIVB.house; t.hp = t.maxHp = CIVB.house.hp; } Civ.adopt(t); } World.idle(u); }
        } else if (t.kind === 'bridge') {
          t.hp = Math.min(t.maxHp, t.hp + rate * 1.5);
          if (t.broken && t.hp > t.maxHp * 0.3) World.repairBridge(t);
          if (t.hp >= t.maxHp) World.idle(u);
        } else {
          t.hp = Math.min(t.maxHp, t.hp + rate); t.burn = Math.max(0, t.burn - dt * 0.3);
          if (t.hp >= t.maxHp) World.idle(u);
        }
        return;
      }
      case 'aid': {
        if (f.res.supplies < 80 || f.res.food < 40) { if (u.owner === G.player) Bus.emit('msg', 'Aid needs 80 supplies and 40 food', 'warn'); World.idle(u); return; }
        f.res.supplies -= 80; f.res.food -= 40; Civ.aid(t, u.owner, 1);
        FX.heal(u.x, u.y); FX.heal(u.x, u.y);
        World.idle(u); return;
      }
      case 'clear': {
        u.mT = (u.mT || 0) + dt; if (Math.random() < 0.3) FX.add('dust', t.x, t.y, { size: 3, grow: 8, max: 0.6, c: '120,110,90', alpha: 0.4 });
        if (u.mT > 3) { u.mT = 0; World.removeWreck(t); f.res.metal += 10; World.idle(u); }
        return;
      }
      case 'demo': {
        World.charges.push({ x: t.x + U.rnd(-6, 6), y: t.y + U.rnd(-6, 6), t: 6, id: t.id, owner: u.owner });
        if (u.owner === G.player) Bus.emit('msg', 'Charge planted — 6 seconds', 'info', t.x, t.y);
        u.lastFire = G.time; World.retreat(u, false); u.state = 'move'; return;
      }
    }
  },
};

/* ---------------- orders (shared by UI and AI) ---------------- */
const Orders = {
  formation: 'box',
  slots(units, x, y, fromX, fromY) {
    const n = units.length; if (n === 1) return [{ x, y }];
    const dir = Math.atan2(y - fromY, x - fromX), px = -Math.sin(dir), py = Math.cos(dir), fx = Math.cos(dir), fy = Math.sin(dir);
    const sp = Math.max(18, (units.reduce((s, u) => s + u.rad, 0) / n) * 2.4);
    const out = [];
    const F = this.formation;
    for (let i = 0; i < n; i++) {
      let lat, lon;
      if (F === 'line') { lat = (i - (n - 1) / 2) * sp; lon = 0; }
      else if (F === 'column') { const c = Math.min(2, n); lat = ((i % c) - (c - 1) / 2) * sp; lon = -Math.floor(i / c) * sp; }
      else if (F === 'wedge') { const row = Math.floor((Math.sqrt(8 * i + 1) - 1) / 2), k = i - (row * (row + 1)) / 2; lat = (k - row / 2) * sp; lon = -row * sp; }
      else { const c = Math.ceil(Math.sqrt(n)); lat = ((i % c) - (c - 1) / 2) * sp; lon = -(Math.floor(i / c) - (Math.ceil(n / c) - 1) / 2) * sp; }
      out.push({ x: x + px * lat + fx * lon, y: y + py * lat + fy * lon, lat });
    }
    // assign by lateral order to avoid crossing
    const ord = units.map((u, i) => ({ u, lat: (u.x - fromX) * px + (u.y - fromY) * py, i })).sort((a, b) => a.lat - b.lat);
    const so = out.map((s, i) => ({ s, i })).sort((a, b) => a.s.lat - b.s.lat);
    const res = new Array(n); ord.forEach((o, k) => { res[o.i] = so[k].s; });
    return res;
  },
  centroid(units) { let x = 0, y = 0; for (const u of units) { x += u.x; y += u.y; } return { x: x / units.length, y: y / units.length }; },
  move(units, x, y, o = {}) {
    units = units.filter((u) => u.kind === 'unit' && !u.dead && !u.inside); if (!units.length) return;
    const groups = { air: units.filter((u) => u.d.cat === 'air'), ground: units.filter((u) => u.d.cat !== 'air') };
    for (const k in groups) {
      const g = groups[k]; if (!g.length) continue;
      const c = this.centroid(g), sl = this.slots(g, x, y, c.x, c.y);
      g.forEach((u, i) => {
        if (o.queue && (u.state === 'move' || u.state === 'patrol') && u.ord && u.ord.t === 'move') { (u.ord.queue = u.ord.queue || []).push({ x: sl[i].x, y: sl[i].y, am: o.am }); return; }
        u.hold = false; u.tgt = 0;
        if (u.d.ab && u.d.ab.harvest) { u.state = 'move'; }
        World.moveTo(u, sl[i].x, sl[i].y, { am: o.am });
      });
    }
  },
  attack(units, t) {
    for (const u of units) {
      if (u.kind !== 'unit' || u.dead || !u.d.w.length) continue;
      if (!u.d.w.some((k) => World.canHit(k, t))) continue;
      u.ordT = G.time;
      if (u.d.cat === 'air') { Air.order(u, { t: 'attack', id: t.id }); u.tgt = t.id; continue; }
      u.state = 'attack'; u.ord = { t: 'attack', id: t.id }; u.tgt = t.id; u.path = null; u.repath = 0;
    }
  },
  fireAt(units, x, y) { for (const u of units) { if (u.kind !== 'unit' || !u.d.w.some((k) => WEAPONS[k].tg.includes('g')) || u.d.cat === 'air') continue; u.state = 'fireAt'; u.ord = { t: 'fireAt', x, y }; u.ordT = G.time; u.path = null; } },
  stop(units) { for (const u of units) { if (u.kind !== 'unit') continue; u.tgt = 0; u.path = null; u.pathReq = null; if (u.d.cat === 'air') { if (u.d.plane) { u.state = 'orbit'; u.ord = { t: 'orbit', x: u.x, y: u.y }; } else { u.state = 'hover'; u.ord = null; } } else World.idle(u); u.ordT = G.time; } },
  guard(units) { for (const u of units) { if (u.kind !== 'unit' || u.d.cat === 'air') continue; u.state = 'guard'; u.ord = { t: 'guard', x: u.x, y: u.y }; u.path = null; u.ordT = G.time; } },
  scatter(units) { for (const u of units) if (u.kind === 'unit') World.moveTo(u, u.x + U.rnd(-60, 60), u.y + U.rnd(-60, 60)); },
  patrol(units, pts) {
    for (const u of units) { if (u.kind !== 'unit') continue; const p = [{ x: u.x, y: u.y }, ...pts]; u.ordT = G.time;
      if (u.d.cat === 'air') { Air.order(u, { t: 'move', x: pts[0].x, y: pts[0].y, am: true }); continue; }
      u.state = 'patrol'; u.ord = { t: 'patrol', pts: p, i: 1 }; Path.request(u, p[1].x, p[1].y); }
  },
  task(u, t, kind) { u.state = 'task'; u.ord = { t: kind, id: t.id }; u.path = null; u.repath = 0; u.ordT = G.time; },
  board(units, tr) { for (const u of units) { if (u === tr || u.kind !== 'unit' || u.d.cat === 'air' || u.d.cat === 'sea') continue; u.state = 'board'; u.ord = { t: 'board', id: tr.id }; u.repath = 0; u.ordT = G.time; } },
  harvestAt(u, tile) { const M = G.map; u.state = 'harvest'; u.oreX = tile % M.w; u.oreY = (tile / M.w) | 0; u.hs = 'seek'; u.path = null; },
  retreat(units) { for (const u of units) if (u.kind === 'unit' && u.d.cat !== 'air') { World.retreat(u, false); u.ordT = G.time; } else if (u.kind === 'unit' && u.d.cat === 'air') { if (u.d.plane) u.state = 'rtb'; else u.state = 'rearm'; } },
  unload(units) { for (const u of units) if (u.cargo && u.cargo.length) World.unload(u); },
  rtb(units) { for (const u of units) if (u.kind === 'unit' && u.d.cat === 'air') { if (u.d.plane) u.state = 'rtb'; else u.state = 'rearm'; } },
};
