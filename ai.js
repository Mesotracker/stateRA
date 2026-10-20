'use strict';
/* =====================================================================
   CITY.RA — ai.js
   Faction AI (base building, economy, production, research, scouting,
   capture, defence, attack waves, air and naval use) and diplomacy
   (stances, opinion, proposals, trade agreements, sanctions).
   ===================================================================== */

const AI_DIFF = {
  easy:   { bonus: 0.8, speed: 0.8, trickle: 0, first: 480, wave: 380, size: 5, grow: 1, react: 0.5 },
  normal: { bonus: 1.0, speed: 1.0, trickle: 0.6, first: 330, wave: 270, size: 7, grow: 2, react: 0.8 },
  hard:   { bonus: 1.25, speed: 1.2, trickle: 1.8, first: 240, wave: 200, size: 9, grow: 3, react: 1 },
  brutal: { bonus: 1.6, speed: 1.4, trickle: 3.5, first: 170, wave: 150, size: 11, grow: 4, react: 1 },
};
const AI_PLAN = {
  common: ['power', 'refinery', 'barracks', 'power', 'factory', 'refinery', 'depot', 'farm', 'pump', 'radar', 'power', 'repair', 'medical', 'turret', 'lab', 'power', 'fueldepot', 'turret', 'sam', 'mine', 'logistics', 'ammo', 'power', 'bunker', 'turret', 'tower', 'power', 'sam', 'abm', 'power', 'silo'],
  meridian: { early: 'hangar', extra: ['hangar', 'sam'] },
  steppe: { early: 'factory', extra: ['factory', 'turret', 'bunker'] },
  league: { early: 'shipyard', extra: ['shipyard', 'coastal', 'hangar'] },
  highland: { early: 'barracks', extra: ['barracks', 'bunker', 'tower', 'tower'] },
};
const AI_MIX = {
  meridian: { inf: { rifle: 4, at: 2, aa: 1, mg: 1, spec: 1, robosoldier: 2 }, veh: { mbt: 3, ifv: 2, aatruck: 1, spg: 1, scout: 1, heavy: 1, mech: 2 }, air: { gunship: 3, fighter: 2, cas: 2, stratos: 1, bomber: 1, recondrone: 1, kamikaze: 2, ucav: 2 }, sea: { destroyer: 2, patrol: 2 } },
  steppe: { inf: { rifle: 4, at: 2, mg: 2, aa: 1, robosoldier: 2 }, veh: { mbt: 4, heavy: 3, mlrs: 2, spg: 2, mammoth: 1, aatruck: 1, mech: 2 }, air: { gunship: 2, fighter: 1, kamikaze: 2, ucav: 1 }, sea: { destroyer: 2, patrol: 2 } },
  league: { inf: { rifle: 4, at: 2, aa: 1, mg: 1, robosoldier: 2 }, veh: { ifv: 3, wavecutter: 3, mbt: 2, aatruck: 1, mlrs: 1, mech: 1 }, air: { gunship: 2, fighter: 1, recondrone: 1, ucav: 2 }, sea: { destroyer: 3, patrol: 2, sub: 1 } },
  highland: { inf: { rifle: 4, mg: 2, at: 3, sniper: 1, ghost: 1, aa: 1, exo: 1, robosoldier: 2 }, veh: { jeep: 2, ifv: 2, mbt: 2, aatruck: 1, mech: 1 }, air: { gunship: 2, kamikaze: 3, recondrone: 1 }, sea: { patrol: 2, destroyer: 1 } },
};
const AI_LATE = ['missiles', 'hypersonic', 'nuclear', 'icbm'];
const AI_TECH = {
  meridian: ['drones', 'robotics', 'ecm', 'composite', 'heavyarmor', 'radarguide', 'strategic', 'specops', ...AI_LATE],
  steppe: ['robotics', 'composite', 'heavyarmor', 'drones', 'logistics2', 'veteran', 'radarguide', ...AI_LATE],
  league: ['drones', 'composite', 'silent', 'robotics', 'logistics2', 'heavyarmor', 'ecm', ...AI_LATE],
  highland: ['drones', 'specops', 'robotics', 'veteran', 'civeng', 'composite', 'heavyarmor', ...AI_LATE],
};

const AI = {
  setup(f, diff) {
    const D = AI_DIFF[diff] || AI_DIFF.normal;
    f.aiBonus = D.bonus; f.aiSpeed = D.speed; f.aiTrickle = D.trickle;
    f.ai = { diff, D, nextAttack: D.first + Math.random() * 60, wave: 0, scoutT: 60, capT: 20, t: Math.random(), squad: new Set(), lastThreat: -99, passive: false };
  },
  hq(f) { return G.blds.find((b) => !b.dead && b.owner === f.id && b.type === 'hq') || G.blds.find((b) => !b.dead && b.owner === f.id); },

  tick(f) {
    const A = f.ai; if (!A || !f.alive) return;
    const hq = this.hq(f); if (!hq) { this.armyOnly(f); return; }
    // place ready structure
    const it = f.q.bld[0];
    if (it && it.done) { const s = this.findSpot(f, it.key, hq); if (s) Eco.place(f, s.x, s.y); else { f.q.bld.shift(); Eco.refund(f, it.cost, 0.9); } }
    if (!f.q.bld.length) { const next = this.nextBuild(f, hq); if (next) Eco.queue(f, next, false); }
    this.production(f);
    if (!f.research && Eco.has(f, 'lab') && f.res.credits > 1800) { const t = AI_TECH[f.key].find((k) => !f.tech.has(k) && (TECH[k].req || []).every((q) => f.tech.has(q)) && !((k === 'nuclear' || k === 'icbm') && (f.ai.diff === 'easy' || G.time < 900))); if (t) Eco.startResearch(f, t); }
    for (const b of G.blds) if (b.owner === f.id && !b.dead) { if (b.hp < b.maxHp * 0.7 && f.res.credits > 400) b.repairing = true; if (b.d.up && b.level < 2 && !b.upg && f.res.credits > 4000 && Math.random() < 0.02) Eco.upgrade(b); }
    this.army(f, hq);
    this.capture(f, hq);
    this.civic(f);
    this.missiles(f, hq);
  },
  missiles(f, hq) {
    const silos = G.blds.filter((b) => b.owner === f.id && b.d.silo && !b.dead && b.built >= 1); if (!silos.length) return;
    const D = f.ai.diff, atWar = G.factions.some((o) => o.alive && o.id !== f.id && hostile(f.id, o.id));
    const order = ['icbm', 'nuke', 'tacnuke', 'hyper', 'ballistic', 'thermo', 'srbm', 'cluster', 'cruise'];
    for (const s of silos) {
      if (!s.load) {
        for (const k of order) {
          const M = MISSILES[k]; if (!Strike.unlocked(f, k)) continue;
          if (M.nuke && (!atWar || D === 'easy' || G.time < 1200 || (D === 'normal' && Math.random() < 0.8))) continue;
          if (f.res.credits < M.cost.credits * 1.5) continue;
          if (!M.nuke && k !== 'cruise' && Math.random() < 0.45) continue;
          Strike.arm(s, k); break;
        }
        continue;
      }
      if (!Strike.ready(s) || Math.random() > 0.2) continue;
      const kind = s.load.kind, M = MISSILES[kind], R = M.nuke ? Strike.radii(M.yieldKt).mod : 0;
      let t = null, bv = 0;
      for (const b of G.blds) {
        if (b.dead || !hostile(f.id, b.owner) || (G.cfg.fog && !Vis.explored(f.id, b.x, b.y)) || !Strike.inRange(s, kind, b.x, b.y)) continue;
        let v = (b.type === 'hq' ? 5 : b.d.prod ? 3 : b.d.silo ? 6 : 1) * b.d.cost.c;
        if (M.nuke) { let n = 0; for (const o of G.blds) if (!o.dead && hostile(f.id, o.owner) && Math.hypot(o.x - b.x, o.y - b.y) < R) n++; for (const o of G.blds) if (!o.dead && friendly(f.id, o.owner) && Math.hypot(o.x - b.x, o.y - b.y) < R * 1.6) { v = 0; break; } v *= 1 + n * 0.6; }
        if (v > bv) { bv = v; t = b; }
      }
      if (t) Strike.launch(s, t.x + U.rnd(-20, 20), t.y + U.rnd(-20, 20));
    }
  },

  nextBuild(f, hq) {
    const P = AI_PLAN[f.key], plan = AI_PLAN.common.slice();
    plan.splice(5, 0, P.early); plan.push(...P.extra);
    const counts = {};
    const coast = World.waterNear(hq.tx - 8, hq.ty - 8, 19, 19, 6);
    for (const k of plan) {
      counts[k] = (counts[k] || 0) + 1;
      if ((k === 'shipyard' || k === 'coastal') && !coast) continue;
      if (k === 'mine' && !this.metalNear(hq)) continue;
      if (Eco.count(f, k) + (f.q.bld.some((q) => q.key === k) ? 1 : 0) >= counts[k]) continue;
      if (Eco.locked(f, k, false)) continue;
      if (k !== 'power' && f.power.prod - f.power.use < -(BLDS[k].pw || 0) && BLDS[k].pw < 0) return 'power';
      return k;
    }
    if (f.power.prod - f.power.use < 40) return 'power';
    if (f.res.credits > 3500 && Math.random() < 0.3) return U.pick(['turret', 'sam', 'bunker', 'power']);
    return null;
  },
  metalNear(hq) { const M = G.map; for (let y = hq.ty - 20; y < hq.ty + 20; y++) for (let x = hq.tx - 20; x < hq.tx + 20; x++) if (x >= 0 && y >= 0 && x < M.w && y < M.h && M.res[y * M.w + x] === 1 && !M.occ[y * M.w + x]) return { x, y }; return null; },

  findSpot(f, key, hq) {
    const d = BLDS[key], M = G.map, cx = hq.tx + 1, cy = hq.ty + 1;
    const enemy = this.enemyDir(f, hq);
    const tryAt = (tx, ty, gap) => {
      if (!World.canPlace(key, f.id, tx, ty).ok) return false;
      if (gap) for (let y = ty - 1; y <= ty + d.h; y++) for (let x = tx - 1; x <= tx + d.w; x++) { if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue; const o = M.occ[y * M.w + x]; if (o) { const e = G.ents.get(o); if (e && e.kind === 'bld' && !e.d.wall) return false; } if (M.ore[y * M.w + x] > 0 && key !== 'refinery') return false; }
      return true;
    };
    if (key === 'mine') { const m = this.metalNear(hq); if (m) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tryAt(m.x + dx, m.y + dy, false)) return { x: m.x + dx, y: m.y + dy }; return null; }
    const def = d.cat === 'def';
    for (let r = def ? 6 : 3; r < 22; r++) {
      const cand = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) cand.push([dx, dy]);
      if (def && enemy) cand.sort((a, b) => Math.hypot(a[0] / r - enemy.x, a[1] / r - enemy.y) - Math.hypot(b[0] / r - enemy.x, b[1] / r - enemy.y));
      else for (let i = cand.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
      for (const [dx, dy] of cand) { const tx = cx + dx - Math.floor(d.w / 2), ty = cy + dy - Math.floor(d.h / 2); if (tryAt(tx, ty, !d.coast)) return { x: tx, y: ty }; }
    }
    return null;
  },
  enemyDir(f, hq) {
    let best = null, bd = 1e9;
    for (const o of G.factions) if (o !== f && o.alive && hostile(f.id, o.id)) { const d = Math.hypot(o.startX - hq.x, o.startY - hq.y); if (d < bd) { bd = d; best = o; } }
    if (!best) return null; const a = Math.atan2(best.startY - hq.y, best.startX - hq.x); return { x: Math.cos(a), y: Math.sin(a) };
  },

  production(f) {
    const mix = AI_MIX[f.key];
    const harv = G.units.filter((u) => u.owner === f.id && u.type === 'harvester').length, refs = Eco.count(f, 'refinery');
    if (harv < refs * 2 && !f.q.veh.some((q) => q.key === 'harvester') && Eco.has(f, 'factory')) { Eco.queue(f, 'harvester', true); }
    const eng = G.units.filter((u) => u.owner === f.id && u.type === 'engineer').length;
    if (eng < 1 && G.time > 40 && Eco.has(f, 'barracks') && !f.q.inf.some((q) => q.key === 'engineer') && Math.random() < 0.3) Eco.queue(f, 'engineer', true);
    const sup = G.units.filter((u) => u.owner === f.id && u.type === 'supply').length;
    if (sup < 1 && G.time > 200 && Eco.has(f, 'factory') && f.res.credits > 2000 && Math.random() < 0.1) Eco.queue(f, 'supply', true);
    for (const cat of ['inf', 'veh', 'air', 'sea']) {
      if (!Eco.has(f, PRODUCER[cat])) continue;
      if (f.q[cat].length >= 2) continue;
      if (f.res.credits < (cat === 'inf' ? 300 : 1200)) continue;
      if (cat === 'air') { const n = G.units.filter((u) => u.owner === f.id && u.d.cat === 'air').length; if (n >= Eco.count(f, 'hangar') * 4) continue; }
      const opts = Object.entries(mix[cat] || {}).filter(([k]) => !Eco.locked(f, k, true));
      if (!opts.length) continue;
      let tot = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * tot, pick = opts[0][0];
      for (const [k, w] of opts) { r -= w; if (r <= 0) { pick = k; break; } }
      Eco.queue(f, pick, true);
    }
  },

  combat(f) { return G.units.filter((u) => u.owner === f.id && !u.dead && !u.inside && u.d.w.length && !(u.d.ab && (u.d.ab.harvest))); },

  army(f, hq) {
    const A = f.ai, D = A.D, all = this.combat(f);
    const ground = all.filter((u) => u.d.cat === 'inf' || u.d.cat === 'veh');
    // rally point toward the enemy
    const ed = this.enemyDir(f, hq);
    const rally = { x: hq.x + (ed ? ed.x : 0) * 7 * TILE, y: hq.y + (ed ? ed.y : 0) * 7 * TILE };
    for (const b of G.blds) if (b.owner === f.id && b.d.prod && !b.rally) b.rally = { x: rally.x + U.rnd(-40, 40), y: rally.y + U.rnd(-40, 40) };
    // threats near base
    let threat = null;
    const out = G.hash.query(hq.x, hq.y, 18 * TILE, World.tmp);
    for (const e of out) if ((e.kind === 'unit') && !e.dead && hostile(f.id, e.owner) && canSee(f.id, e)) { threat = e; break; }
    if (!threat) for (const b of G.blds) if (b.owner === f.id && !b.dead && G.time - b.lastHit < 4 && b.lastHitBy) { threat = G.ents.get(b.lastHitBy); break; }
    if (threat && Math.random() < D.react) {
      A.lastThreat = G.time;
      const def = ground.filter((u) => !A.squad.has(u.id) && (u.state === 'idle' || u.state === 'guard'));
      if (def.length) Orders.move(def, threat.x, threat.y, { am: true });
      for (const u of all) if (u.d.cat === 'air' && u.ammo > 0 && (u.state === 'orbit' || u.state === 'hover' || u.state === 'docked' || u.state === 'idle')) { if (World.canHit(u.d.w[0], threat) || u.d.w.some((k) => World.canHit(k, threat))) Orders.attack([u], threat); }
    }
    // gather idle units at rally
    if (G.time - A.lastThreat > 15) for (const u of ground) if (!A.squad.has(u.id) && u.state === 'idle' && Math.hypot(u.x - rally.x, u.y - rally.y) > 8 * TILE) World.moveTo(u, rally.x + U.rnd(-60, 60), rally.y + U.rnd(-60, 60));
    // retreat badly damaged vehicles
    if (Eco.has(f, 'repair')) for (const u of ground) if (u.d.cat === 'veh' && u.hp < u.maxHp * 0.3 && u.state !== 'retreat') World.retreat(u, false);
    // squads: purge dead
    for (const id of A.squad) { const u = G.ents.get(id); if (!u || u.dead) A.squad.delete(id); }
    if (A.passive) return;
    // launch attack wave
    const avail = ground.filter((u) => !A.squad.has(u.id) && u.state !== 'retreat');
    const need = D.size + A.wave * D.grow;
    if (G.time >= A.nextAttack && avail.length >= need) {
      const tgt = this.pickTarget(f, hq);
      if (tgt) {
        const send = avail.slice(0, Math.max(need, Math.floor(avail.length * 0.8)));
        for (const u of send) A.squad.add(u.id);
        Orders.move(send, tgt.x, tgt.y, { am: true });
        A.target = tgt; A.wave++; A.nextAttack = G.time + D.wave * (0.8 + Math.random() * 0.4);
        if (hostile(f.id, G.player) && tgt.owner === G.player) Bus.emit('aiAttack', f, tgt);
      }
    }
    // keep squad pushing
    if (A.squad.size && Math.random() < 0.25) {
      const sq = [...A.squad].map((id) => G.ents.get(id)).filter((u) => u && !u.dead);
      const idle = sq.filter((u) => u.state === 'idle');
      if (idle.length) { const tgt = this.pickTarget(f, hq, idle[0]); if (tgt) Orders.move(idle, tgt.x, tgt.y, { am: true }); else for (const u of idle) A.squad.delete(u.id); }
    }
    // air strikes on the current target area
    const strikeT = A.target && G.ents.get(A.target.id);
    for (const u of all) {
      if (u.d.cat !== 'air' || u.ammo <= 0 || u.type === 'fighter') continue;
      if (!(u.state === 'docked' || u.state === 'orbit' || u.state === 'hover' || u.state === 'idle')) continue;
      if (Math.random() > 0.08) continue;
      const t = strikeT && !strikeT.dead ? strikeT : this.knownEnemy(f, hq, true);
      if (t && u.d.w.some((k) => World.canHit(k, t))) Orders.attack([u], t);
    }
    // navy patrols toward enemy coast
    for (const u of all) if (u.d.cat === 'sea' && u.state === 'idle' && Math.random() < 0.05) {
      const t = this.knownEnemy(f, hq, false, (e) => Path.sameComp('naval', u.x / TILE, u.y / TILE, e.x / TILE, e.y / TILE) || World.waterNear(e.tx || (e.x / TILE) | 0, e.ty || (e.y / TILE) | 0, 1, 1, 6));
      if (t) Orders.move([u], t.x, t.y, { am: true });
    }
    // scouting
    A.scoutT -= 1;
    if (A.scoutT <= 0) {
      A.scoutT = 110 + Math.random() * 60;
      const sc = ground.find((u) => (u.type === 'scout' || u.type === 'jeep' || u.type === 'recon' || u.type === 'rifle') && !A.squad.has(u.id) && u.state === 'idle');
      if (sc) { const s = U.pick(G.settlements.concat(G.factions.filter((o) => o !== f).map((o) => ({ x: o.startX, y: o.startY })))); if (s) World.moveTo(sc, s.x, s.y, { am: true }); }
    }
  },
  knownEnemy(f, from, buildingsFirst, filt) {
    let best = null, bd = 1e9;
    const consider = (e) => { if (e.dead || !hostile(f.id, e.owner)) return; if (G.cfg.fog && !Vis.explored(f.id, e.x, e.y)) return; if (filt && !filt(e)) return; const d = Math.hypot(e.x - from.x, e.y - from.y); if (d < bd) { bd = d; best = e; } };
    for (const b of G.blds) consider(b);
    if (!best || !buildingsFirst) for (const u of G.units) if (!u.inside && u.d.cat !== 'air') consider(u);
    return best;
  },
  pickTarget(f, hq, from) {
    const src = from || hq;
    let t = this.knownEnemy(f, src, true, (e) => Path.sameComp('track', src.x / TILE, src.y / TILE, e.x / TILE, e.y / TILE));
    if (t) return t;
    // scout towards a likely enemy start
    const enemies = G.factions.filter((o) => o !== f && o.alive && hostile(f.id, o.id));
    if (!enemies.length) return null;
    const o = enemies.sort((a, b) => Math.hypot(a.startX - src.x, a.startY - src.y) - Math.hypot(b.startX - src.x, b.startY - src.y))[0];
    if (!Path.sameComp('track', src.x / TILE, src.y / TILE, o.startX / TILE, o.startY / TILE)) return null;
    return { x: o.startX, y: o.startY, id: 0, owner: o.id };
  },
  capture(f, hq) {
    const A = f.ai; A.capT -= 1; if (A.capT > 0) return; A.capT = 12;
    const engs = G.units.filter((u) => u.owner === f.id && u.type === 'engineer' && u.state === 'idle');
    for (const e of engs) {
      let best = null, bd = 34 * TILE;
      for (const c of G.civb) { if (!c.d.cap || c.rubble || c.ctrl === f.id || (c.ctrl >= 0 && !hostile(f.id, c.ctrl))) continue; if (G.civs.some(() => false)) continue; const d = Math.hypot(c.x - hq.x, c.y - hq.y); if (d < bd && !G.units.some((o) => o !== e && o.owner === f.id && o.ord && o.ord.id === c.id)) { bd = d; best = c; } }
      if (best) Orders.task(e, best, 'capture');
      else { for (const b of G.blds) if (b.owner === f.id && b.hp < b.maxHp * 0.6) { Orders.task(e, b, 'repair'); break; } }
    }
  },
  civic(f) {
    // humane factions send aid to unhappy settlements they control
    if (FACTIONS[f.key].humane < 0.6 || Math.random() > 0.05) return;
    const trucks = G.units.filter((u) => u.owner === f.id && u.type === 'supply' && u.state === 'idle');
    if (!trucks.length || f.res.supplies < 150 || f.res.food < 80) return;
    const s = G.settlements.filter((s) => s.ctrl === f.id && s.happy < 50)[0];
    if (!s) return; const c = G.ents.get(U.pick(s.blds)); if (c && !c.rubble) Orders.task(trucks[0], c, 'aid');
  },
  armyOnly(f) {
    const units = this.combat(f), idle = units.filter((u) => u.state === 'idle');
    if (idle.length && Math.random() < 0.1) { const t = this.knownEnemy(f, idle[0], false); if (t) Orders.move(idle, t.x, t.y, { am: true }); }
  },
};

/* ---------------- diplomacy ---------------- */
const STANCE_LABEL = { war: 'At war', ceasefire: 'Ceasefire', neutral: 'Neutral', alliance: 'Allied' };
const Dip = {
  init(n, mode) {
    G.dip = [];
    for (let a = 0; a < n; a++) { G.dip.push([]); for (let b = 0; b < n; b++) G.dip[a].push({ stance: a === b ? 'self' : 'war', opinion: 0, trade: false, sanction: false, since: 0, hits: 0 }); }
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const fa = G.factions[a], fb = G.factions[b];
      let st = 'war';
      if (mode === 'teams') st = fa.team === fb.team ? 'alliance' : 'war';
      else if (mode === 'diplomatic') st = 'neutral';
      else if (mode === 'peace') st = (fa.isPlayer || fb.isPlayer) ? 'neutral' : 'war';
      G.dip[a][b].stance = st; G.dip[a][b].opinion = st === 'alliance' ? 50 : st === 'war' ? -30 : 0;
    }
    this.t = 0;
  },
  set(a, b, stance, quiet) {
    const prev = G.dip[a][b].stance; if (prev === stance) return;
    G.dip[a][b].stance = G.dip[b][a].stance = stance; G.dip[a][b].since = G.dip[b][a].since = G.time;
    if (stance === 'war') { G.dip[a][b].trade = G.dip[b][a].trade = false; for (const u of G.units) if ((u.owner === a || u.owner === b)) u.scanT = 0; }
    if (stance !== 'war') for (const u of G.units) { const t = G.ents.get(u.tgt); if (t && ((u.owner === a && t.owner === b) || (u.owner === b && t.owner === a))) { u.tgt = 0; if (u.state === 'attack') World.idle(u); } }
    if (!quiet) Bus.emit('msg', fac(a).name + ' and ' + fac(b).name + ': ' + STANCE_LABEL[stance], a === G.player || b === G.player ? (stance === 'war' ? 'bad' : 'good') : 'info');
    Bus.emit('dip', a, b, stance);
  },
  strength(f) { let s = 0; for (const u of G.units) if (u.owner === f.id && !u.dead) s += u.d.cost.c * (u.hp / u.maxHp); for (const b of G.blds) if (b.owner === f.id && !b.dead) s += b.d.cost.c * 0.3; return s + 1; },
  // AI evaluates a proposal from `from` to `to`
  evaluate(to, from, kind) {
    const T = fac(to), F = fac(from), r = G.dip[to][from], ratio = this.strength(T) / this.strength(F);
    const humane = FACTIONS[T.key].humane, opinion = r.opinion + F.rep * humane * 0.4;
    const commonEnemy = G.factions.some((o) => o.alive && o.id !== to && o.id !== from && hostile(to, o.id) && hostile(from, o.id));
    switch (kind) {
      case 'ceasefire': if (r.stance !== 'war') return [false, 'We are not at war.']; return G.time - r.since > 150 && opinion > -45 && (ratio < 1.3 || G.time - r.since > 400) && G.time - (r.lastHit || -99) > 25 ? [true, 'We accept a ceasefire.'] : [false, ratio >= 1.3 ? 'We hold the advantage. No ceasefire.' : 'Your forces are still attacking us.'];
      case 'peace': if (r.stance !== 'ceasefire') return [false, 'A ceasefire must come first.']; return opinion > -10 ? [true, 'We will stand down to neutrality.'] : [false, 'Trust has not been earned yet.'];
      case 'alliance': if (r.stance === 'war') return [false, 'Not while we are at war.']; return opinion > 30 || (commonEnemy && opinion > 10) ? [true, 'We stand together.'] : [false, 'We need more reason to trust you.'];
      case 'trade': if (r.stance === 'war') return [false, 'No trade with an enemy.']; if (r.sanction || G.dip[from][to].sanction) return [false, 'Sanctions block any agreement.']; return opinion > -15 ? [true, 'Trade routes are open.'] : [false, 'We decline.'];
    }
    return [false, 'Unknown proposal.'];
  },
  propose(from, to, kind) {
    const r = G.dip[from][to];
    if (kind === 'war') { this.set(from, to, 'war'); G.dip[to][from].opinion -= 40; return [true, 'War declared.']; }
    if (kind === 'sanction') { r.sanction = true; r.trade = G.dip[to][from].trade = false; G.dip[to][from].opinion -= 20; Bus.emit('msg', fac(from).name + ' imposed sanctions on ' + fac(to).name, 'info'); return [true, 'Sanctions imposed. Trade with their settlements is blocked.']; }
    if (kind === 'lift') { r.sanction = false; G.dip[to][from].opinion += 8; return [true, 'Sanctions lifted.']; }
    if (kind === 'cancel') { r.trade = G.dip[to][from].trade = false; G.dip[to][from].opinion -= 5; return [true, 'Trade agreement cancelled.']; }
    const T = fac(to);
    if (!T.isAI) { Bus.emit('proposal', from, to, kind); return [null, 'Awaiting reply.']; }
    const [ok, text] = this.evaluate(to, from, kind);
    if (ok) this.accept(from, to, kind); else G.dip[to][from].opinion -= 2;
    return [ok, text];
  },
  accept(from, to, kind) {
    if (kind === 'ceasefire') this.set(from, to, 'ceasefire');
    else if (kind === 'peace') this.set(from, to, 'neutral');
    else if (kind === 'alliance') this.set(from, to, 'alliance');
    else if (kind === 'trade') { G.dip[from][to].trade = G.dip[to][from].trade = true; Bus.emit('msg', 'Trade agreement: ' + fac(from).short + ' – ' + fac(to).short, 'good'); }
    G.dip[to][from].opinion += 10; G.dip[from][to].opinion += 10;
  },
  onHit(victimOwner, attackerOwner) {
    if (victimOwner < 0 || attackerOwner < 0 || victimOwner === attackerOwner) return;
    const r = G.dip[victimOwner][attackerOwner]; r.lastHit = G.time; r.hits++;
    if (r.stance === 'ceasefire' || r.stance === 'neutral') { r.opinion -= 1; if (r.hits > 6) { this.set(victimOwner, attackerOwner, 'war'); Bus.emit('msg', fac(victimOwner).name + ' says the ' + (r.stance === 'ceasefire' ? 'ceasefire' : 'peace') + ' was broken', 'bad'); r.hits = 0; } }
  },
  tick() {
    // every 10 s: opinion drift, AI initiatives
    for (const a of G.factions) for (const b of G.factions) {
      if (a === b || !a.alive || !b.alive) continue;
      const r = G.dip[a.id][b.id]; r.hits = Math.max(0, r.hits - 2);
      const humane = FACTIONS[a.key].humane;
      const common = G.factions.some((o) => o.alive && o !== a && o !== b && hostile(a.id, o.id) && hostile(b.id, o.id));
      const target = (r.stance === 'alliance' ? 40 : r.stance === 'war' ? -30 : 0) + (r.trade ? 15 : 0) + (common ? 12 : 0) + b.rep * humane * 0.5 - (G.dip[b.id][a.id].sanction ? 25 : 0) - (FACTIONS[a.key].aggr - 0.5) * 20;
      r.opinion = U.clamp(r.opinion + (target - r.opinion) * 0.08, -100, 100);
    }
    for (const a of G.factions) {
      if (!a.isAI || !a.alive || Math.random() > 0.35) continue;
      for (const b of G.factions) {
        if (a === b || !b.alive) continue;
        const r = G.dip[a.id][b.id], ratio = this.strength(a) / this.strength(b);
        if (G.cfg.lockDip) continue;
        if (r.stance === 'war' && ratio < 0.6 && G.time - r.since > 180 && Math.random() < 0.3) { this.offer(a, b, 'ceasefire'); break; }
        if (r.stance === 'ceasefire' && G.time - r.since > 240 && r.opinion > 0 && Math.random() < 0.3) { this.offer(a, b, 'peace'); break; }
        if (r.stance === 'neutral' && !r.trade && r.opinion > 10 && Math.random() < 0.15) { this.offer(a, b, 'trade'); break; }
        if (r.stance !== 'war' && r.stance !== 'alliance' && (r.opinion < -45 || (ratio > 2.2 && FACTIONS[a.key].aggr > 0.6 && r.opinion < 10)) && G.time > 300 && Math.random() < 0.2) { this.set(a.id, b.id, 'war'); break; }
      }
    }
  },
  offer(a, b, kind) {
    if (b.isAI) { const [ok] = this.evaluate(b.id, a.id, kind); if (ok) this.accept(a.id, b.id, kind); }
    else Bus.emit('proposal', a.id, b.id, kind);
  },
};
Bus.on('attacked', (b) => { if (b.lastAttackerOwner != null) Dip.onHit(b.owner, b.lastAttackerOwner); });
