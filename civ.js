'use strict';
/* =====================================================================
   CITY.RA — civ.js
   Civilian simulation: settlements with population, housing, jobs,
   services, utilities, happiness and economy; pedestrians and traffic
   on the road network; emergency services (fire, ambulance, police);
   construction crews; trade convoys; trains; tractors; evacuation and
   refugees; reputation and territorial control.
   ===================================================================== */

const RoadNet = {
  init(M) {
    const N = M.w * M.h; this.M = M; this.stamp = new Uint32Array(N); this.prev = new Int32Array(N); this.st = 1; this.res = new Int32Array(N);
    this.deg = new Uint8Array(N); this.rebuild();
  },
  ok(i, veh) { const M = this.M, r = M.road[i]; if (!r || r === 4) return false; if (veh && M.block[i]) return false; return true; },
  rebuild() {
    const M = this.M, W = M.w;
    for (let i = 0; i < M.w * M.h; i++) { if (!this.ok(i)) { this.deg[i] = 0; continue; } let n = 0; const x = i % W, y = (i / W) | 0; for (let k = 0; k < 4; k++) { const xx = x + DX8[k], yy = y + DY8[k]; if (xx >= 0 && yy >= 0 && xx < W && yy < M.h && this.ok(yy * W + xx)) n++; } this.deg[i] = n; }
  },
  path(a, b, veh, max = 6000) {
    if (a < 0 || b < 0) return null; if (a === b) return [a];
    const M = this.M, W = M.w, st = ++this.st, q = [a]; this.stamp[a] = st; this.prev[a] = -1;
    for (let h = 0; h < q.length && h < max; h++) {
      const c = q[h]; if (c === b) break;
      const x = c % W, y = (c / W) | 0;
      for (let k = 0; k < 4; k++) { const xx = x + DX8[k], yy = y + DY8[k]; if (xx < 0 || yy < 0 || xx >= W || yy >= M.h) continue; const j = yy * W + xx; if (this.stamp[j] === st || !this.ok(j, veh)) continue; this.stamp[j] = st; this.prev[j] = c; q.push(j); }
    }
    if (this.stamp[b] !== st) return null;
    const p = []; for (let c = b; c !== -1; c = this.prev[c]) p.push(c); return p.reverse();
  },
  nearest(x, y, r = 4) { const M = this.M, tx = (x / TILE) | 0, ty = (y / TILE) | 0; let best = -1, bd = 1e9; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = tx + dx, yy = ty + dy; if (xx < 0 || yy < 0 || xx >= M.w || yy >= M.h) continue; const i = yy * M.w + xx; if (!this.ok(i)) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } return best; },
};

const Civ = {
  init(M) {
    RoadNet.init(M);
    G.settlements = M.towns.map((t, i) => ({
      id: i, name: t.name, kind: t.kind, tx: t.cx, ty: t.cy, x: (t.cx + 0.5) * TILE, y: (t.cy + 0.5) * TILE, r: t.r, blds: [],
      pop: 0, popMax: 0, jobs: 0, emp: 1, happy: 62, danger: 0, cas: 0, recentCas: 0, power: 1, water: 1, health: 0, fire: 0, police: 0, edu: 0, transit: 0, infra: 1,
      stock: { food: 200, materials: 150, goods: 100 }, cash: 0, ctrl: -1, rep: G.factions.map(() => 0), inf: G.factions.map(() => 0),
      evac: null, aid: 0, out: { credits: 0, food: 0, materials: 0 }, calmT: 0, homeless: 0, refugeesOut: 0, safeT: 0, contested: false, peds: 0, cars: 0, served: {},
    }));
    for (const c of G.civb) { if (c.sett >= 0 && G.settlements[c.sett]) G.settlements[c.sett].blds.push(c.id); else this.adopt(c, true); }
    for (const s of G.settlements) {
      this.recount(s); s.pop = Math.round(s.popMax * 0.9);
      // real cities stand for their real population: every simulated resident represents `mult` people
      const t = M.towns[s.id]; s.real = !!(t && t.real && t.pop);
      s.mult = s.real && s.pop > 0 ? Math.max(1, (t.pop * 1000) / s.pop) : 1;
      s.cas = 0; s.inj = 0; s.fr = {};
    }
    for (const f of G.factions) if (FACTIONS[f.key].humane >= 1) for (const s of G.settlements) s.rep[f.id] = 10;
    G.civs = []; this.trainInit(M); this.spawnT = 0; this.tickN = 0;
  },

  adopt(c, quiet) {
    let best = -1, bd = 1e9;
    for (const s of G.settlements) { const d = Math.hypot(s.tx - c.tx, s.ty - c.ty); if (d < s.r + 6 && d < bd) { bd = d; best = s.id; } }
    if (best >= 0 && c.sett !== best) { c.sett = best; G.settlements[best].blds.push(c.id); }
  },

  functional(c) { return !c.rubble && !c.abandoned && c.hp > c.maxHp * 0.35; },
  settOf(c) { return c && c.sett >= 0 ? G.settlements[c.sett] : null; },
  settAt(x, y, pad = 6) { let best = null, bd = 1e9; for (const s of G.settlements) { const d = Math.hypot(s.x - x, s.y - y) / TILE; if (d < s.r + pad && d < bd) { bd = d; best = s; } } return best; },
  repMod(owner) { const F = FACTIONS[fac(owner).key]; return (F.mod.rep || 1); },
  blame(owner, s, amt, global) {
    if (owner < 0) return;
    const m = this.repMod(owner);
    if (s) s.rep[owner] = U.clamp(s.rep[owner] + amt * m, -100, 100);
    const f = fac(owner); f.rep = U.clamp(f.rep + global * m, -100, 100);
  },

  /* ---------- events from combat ---------- */
  noise(x, y, amt) { const s = this.settAt(x, y, 8); if (s) s.danger = Math.min(100, s.danger + amt); },
  hit(a, dmg, owner) {
    if (a.dead) return;
    a.hp -= dmg;
    if (a.hp <= 0) {
      if (!a.veh && !a.injured && a.hp > -40 && Math.random() < 0.55) { a.injured = true; a.hp = 1; a.state = 'injured'; a.timer = 70; a.path = null; this.casualtyReport(a, owner, true); return; }
      this.killAgent(a, owner);
    } else if (!a.veh) { a.state = 'flee'; }
  },
  killAgent(a, owner) {
    a.dead = true;
    if (a.veh) { FX.explosion(a.x, a.y, 0.6); Decals.add(a.x, a.y, 8, 'scorch'); }
    else { Decals.add(a.x, a.y, 3, 'scorch'); }
    const deaths = a.veh ? (a.ct === 'bus' ? 8 : a.ct === 'train' ? 12 : 1) + (a.carry || 0) : 1;
    this.casualtyReport(a, owner, false, deaths);
  },
  /* ---------- casualty ledger: whole people, killed and injured counted separately ---------- */
  people(s, sim) { return Math.round(sim * (s ? s.mult || 1 : 1)); },
  showPop(s) { return Math.round(s.pop * (s.mult || 1)); },
  showMax(s) { return Math.round(s.popMax * (s.mult || 1)); },
  causeRows() {
    const ca = G.stats.cause || {}, nm = { strike: 'missile and bomb strikes', blast: 'nuclear blast and burns', fallout: 'radioactive fallout', buildings: 'collapsed and destroyed buildings', crossfire: 'caught in combat', wounds: 'died of wounds' };
    return Object.keys(ca).filter((k) => ca[k] > 0).sort((a, b) => ca[b] - ca[a]).map((k) => `<tr><td style="padding-left:18px;opacity:.75">of which ${nm[k] || k}</td><td>${U.num(ca[k])}</td></tr>`).join('');
  },
  casWeight(s) { return s && s.mult > 1 ? Math.max(1, Math.round(Math.sqrt(s.mult))) : 1; },
  // add a fractional amount to a settlement accumulator and return the whole number that has built up
  acc(s, key, v) { if (!s) return Math.floor(v + 1e-9); const fr = s.fr || (s.fr = {}); fr[key] = (fr[key] || 0) + v; const w = Math.floor(fr[key]); fr[key] -= w; return w; },
  // true where a nuclear detonation or its fallout already accounts for civilian losses (prevents double counting)
  inNukeZone(x, y) {
    for (const z of Strike.zones || []) { const dt = G.time - z.t; if (dt >= 0 && dt < (z.d || 30) && Math.hypot(x - z.x, y - z.y) < z.R) return true; }
    return typeof Fall !== 'undefined' && Fall.patches && Fall.patches.length && Fall.at(x, y) > 0.05;
  },
  ledger(s, dead, inj, owner, cause) {
    dead = Math.max(0, Math.round(dead)); inj = Math.max(0, Math.round(inj)); if (!dead && !inj) return;
    const st = G.stats; st.civCas += dead; st.civInj = (st.civInj || 0) + inj; const ca = st.cause || (st.cause = {}); ca[cause] = (ca[cause] || 0) + dead;
    if (s) { s.cas = Math.round((s.cas || 0) + dead); s.inj = Math.round((s.inj || 0) + inj); const sim = dead / (s.mult || 1); s.recentCas += sim; s.pop = Math.max(0, s.pop - sim); }
    if (owner >= 0) { const f = fac(owner); f.civKills += dead; f.civInjured = (f.civInjured || 0) + inj; }
  },
  casualtyReport(a, owner, injured, n = 1) {
    const s = G.settlements[a.sett] || this.settAt(a.x, a.y, 20);
    if (!this.inNukeZone(a.x, a.y)) { const k = this.casWeight(s); if (injured) this.ledger(s, 0, k, owner, 'crossfire'); else this.ledger(s, n * k, Math.round(n * k * 0.8), owner, 'crossfire'); }
    if (owner >= 0) {
      this.blame(owner, s, injured ? -2 : -5 * n, injured ? -0.4 : -1.2 * n);
      if (owner === G.player && !injured) { this.casMsgT = this.casMsgT || 0; if (G.time - this.casMsgT > 12) { this.casMsgT = G.time; Bus.emit('msg', 'Civilian casualties reported' + (s ? ' in ' + s.name + ' (' + U.num(s.cas) + ' dead, ' + U.num(s.inj) + ' injured)' : '') + ' — reputation falling', 'bad', a.x, a.y); } }
    }
  },
  damaged(c, owner, frac) {
    c.lastBlame = owner;
    const s = this.settOf(c); if (c.abandoned) return;
    this.blame(owner, s, -frac * 18, -frac * 3);
    if (s) s.danger = Math.min(100, s.danger + frac * 30);
  },
  destroyed(c, owner) {
    const s = this.settOf(c);
    if (owner >= 0 && !c.abandoned) this.blame(owner, s, -8, -2.5);
    if (s && !c.abandoned && !this.inNukeZone(c.x, c.y)) {
      // people inside when it comes down: residents at night, workers by day, scaled by how full the town is
      const occ = U.clamp(s.pop / Math.max(1, s.popMax), 0, 1), night = Clock.night();
      const sim = (c.d.res || 0) * 0.15 * occ * (night ? 1 : 0.55) + (c.d.jobs || 0) * 0.08 * (night ? 0.15 : 1) * Math.max(0.3, occ);
      const dead = this.acc(s, 'bld', sim * (s.mult || 1)), hurt = this.acc(s, 'bldi', sim * 2.2 * (s.mult || 1));
      this.ledger(s, dead, hurt, owner, 'buildings');
    }
    Bus.emit('msg', c.d.name + (s ? ' in ' + s.name : '') + ' destroyed', owner === G.player ? 'bad' : 'warn', c.x, c.y);
  },
  captured(c, owner, prev) {
    const f = fac(owner);
    Bus.emit('msg', f.name + ' secured the ' + c.d.name, owner === G.player ? 'good' : 'warn', c.x, c.y);
    Bus.emit('sfx', 'capture', c.x, c.y);
    Bus.emit('captured', c, prev);
  },
  treat(a, owner) { if (!a.injured) return; a.injured = false; a.hp = 20; a.state = 'flee'; this.blame(owner, G.settlements[a.sett], 2, 0.4); },
  rebuilt(c, owner, frac) { const s = this.settOf(c); const k = fac(owner).tech.has('civeng') ? 1.5 : 1; this.blame(owner, s, frac * 25 * k, frac * 5 * k); },
  aid(c, owner, mult) {
    const s = this.settOf(c) || this.settAt(c.x, c.y, 10); if (!s) return;
    s.aid = Math.min(40, s.aid + 18 * mult); s.stock.food += 60 * mult; this.blame(owner, s, 12 * mult, 4 * mult);
    Bus.emit('msg', 'Humanitarian aid delivered to ' + s.name, owner === G.player ? 'good' : 'info', c.x, c.y);
    fac(owner).stats.aid++;
  },
  onBridge() { RoadNet.rebuild(); for (const a of G.civs) if (a.path && a.path.some((i) => !RoadNet.ok(i))) { a.path = null; } if (this.train) this.train.check = true; },

  /* ---------- per-second settlement simulation ---------- */
  recount(s) {
    let housing = 0, jobs = 0, health = 0, fire = 0, police = 0, edu = 0, transit = 0, subs = 0, waterp = 0, gov = 0, build = 0, hpSum = 0, n = 0, trade = 0;
    const out = { credits: 0, food: 0, materials: 0 };
    for (const id of s.blds) {
      const c = G.ents.get(id); if (!c) continue; n++; hpSum += c.rubble ? 0 : c.hp / c.maxHp;
      if (c.abandoned) continue;
      const fn = this.functional(c), d = c.d;
      if (!c.rubble && d.res) housing += d.res * (c.hp / c.maxHp > 0.35 ? 1 : 0.3);
      if (!fn) continue;
      jobs += d.jobs || 0;
      const v = d.svc || {};
      health += v.health || 0; fire += v.fire || 0; police += v.police || 0; edu += v.edu || 0; transit += v.transit || 0; subs += v.power || 0; waterp += v.water || 0; gov += v.gov || 0; build += v.build || 0; trade += v.trade || 0;
      if (d.out) for (const k in d.out) out[k] += d.out[k];
    }
    s.popMax = Math.round(housing); s.jobs = jobs; s.health = health; s.fire = fire; s.police = police; s.edu = edu; s.transit = transit; s.gov = gov; s.build = build; s.trade = trade;
    const grid = G.civb.some((c) => c.type === 'powerstation' && this.functional(c));
    s.power = subs > 0 ? (grid ? 1 : 0.55) : s.kind === 'village' ? 0.65 : 0.15;
    s.water = waterp > 0 ? (s.power > 0.5 ? 1 : 0.6) : s.kind === 'village' ? 0.75 : 0.3;
    s.infra = n ? hpSum / n : 1; s.baseOut = out;
  },

  tick() {
    this.tickN++;
    for (const s of G.settlements) {
      this.recount(s);
      // population dynamics
      if (s.pop > s.popMax) { const leave = Math.min(s.pop - s.popMax, Math.max(1, (s.pop - s.popMax) * 0.05)); s.pop -= leave; s.homeless += leave; }
      else if (!s.evac && s.danger < 15 && s.pop < s.popMax) { const back = Math.min(s.popMax - s.pop, Math.max(0.2, s.popMax * 0.002 * (s.happy / 60))); s.pop += back; }
      s.emp = s.pop > 0 ? Math.min(1, s.jobs / Math.max(1, s.pop * 0.5)) : 1;
      s.danger *= 0.965; s.recentCas *= 0.992; s.aid *= 0.995;
      if (s.inj > 0) { // the injured recover with medical care; without it a few die of their wounds
        const care = U.clamp(s.health / (s.pop / 400 + 0.5), 0, 1);
        const rec = this.acc(s, 'rec', s.inj * (0.0015 + 0.006 * care)), die = this.acc(s, 'wnd', s.inj * 0.0009 * (1 - 0.8 * care));
        s.inj = Math.max(0, s.inj - rec - die); if (die) this.ledger(s, die, 0, -1, 'wounds');
      }
      if (s.danger < 8) s.calmT++; else s.calmT = 0;
      const blackout = s.power < 0.5;
      const ctrlRep = s.ctrl >= 0 ? s.rep[s.ctrl] : 0;
      let target = 48 + Math.min(1, s.health / (s.pop / 400 + 0.5)) * 10 + Math.min(1, s.fire) * 5 + Math.min(1, s.police) * 5 + Math.min(1, s.edu) * 6 + s.emp * 8
        + (s.power - 1) * 18 + (s.water - 1) * 14 - s.danger * 0.55 - Math.min(30, s.recentCas * 2) - (blackout ? 6 : 0) + s.aid + ctrlRep * 0.12 + (s.infra - 1) * 25;
      target = U.clamp(target, 0, 100);
      s.happy += (target - s.happy) * 0.04;
      // economy
      const eff = (0.5 + s.power * 0.5) * (0.7 + s.water * 0.3) * (0.4 + s.emp * 0.6) * U.clamp(s.happy / 65, 0.3, 1.3) * (s.evac ? 0.3 : 1);
      const o = s.baseOut; s.out = { credits: o.credits * eff * (1 + s.pop / 900), food: o.food * eff, materials: o.materials * eff };
      s.cash += s.out.credits; s.stock.food += s.out.food - s.pop * 0.0006; s.stock.materials += s.out.materials;
      s.stock.food = U.clamp(s.stock.food, 0, 2000); s.stock.materials = U.clamp(s.stock.materials, 0, 2000);
      if (s.stock.food <= 0) s.happy -= 0.3;
      // taxes to the controlling faction
      if (s.ctrl >= 0) {
        const f = fac(s.ctrl);
        if (f && f.alive) {
          const tax = s.cash * 0.7 * U.clamp(0.5 + s.rep[s.ctrl] / 100, 0.2, 1.4); f.res.credits += tax; f.income.tax += tax; s.cash -= tax;
          if (s.stock.materials > 80) { f.res.materials += 0.08; s.stock.materials -= 0.08; }
          if (s.stock.food > 150) { f.res.food += 0.1; s.stock.food -= 0.1; }
        }
      }
      // auto-evacuation and safe return
      if (!s.evac && s.danger > 62 && s.pop > 40) this.startEvac(s, -1, true);
      if (s.evac && s.danger < 6 && s.calmT > 40 && s.evac.auto) { s.evac = null; Bus.emit('msg', s.name + ' residents are returning home', 'info', s.x, s.y); }
      // self-rebuild with construction crews
      if (s.calmT > 25 && s.build > 0 && this.tickN % 6 === s.id % 6) this.dispatchCrew(s);
      if (s.calmT > 30 && s.build === 0 && s.stock.materials > 60 && this.tickN % 12 === s.id % 12) this.slowRepair(s);
    }
    // territorial control every 2 s
    if (this.tickN % 2 === 0) this.influence();
    // fire and ambulance dispatch every second
    for (const s of G.settlements) { this.dispatchFire(s); this.dispatchAmbulance(s); }
    if (this.tickN % 25 === 0) this.convoys();
    // refugee shelters: food upkeep, slow return
    for (const b of G.blds) if (b.type === 'shelter' && b.refugees) {
      const f = fac(b.owner); f.res.food = Math.max(0, f.res.food - b.refugees * 0.002); f.res.water = Math.max(0, f.res.water - b.refugees * 0.002);
      if (f.res.food > 0) this.blame(b.owner, null, 0, 0.0004 * b.refugees);
      if (b.home != null) { const s = G.settlements[b.home]; if (s && s.danger < 6 && s.calmT > 40 && !s.evac) { const n = Math.min(b.refugees, 3); b.refugees -= n; s.pop += n; } }
    }
  },

  influence() {
    for (const s of G.settlements) {
      const pres = G.factions.map(() => 0);
      for (const e of G.hash.query(s.x, s.y, (s.r + 7) * TILE, World.tmp)) {
        if (e.dead || e.owner < 0) continue;
        if (e.kind === 'unit' && !e.inside && e.d.cat !== 'air') pres[e.owner] += e.d.cat === 'inf' ? 1 : 2;
        else if (e.kind === 'bld') pres[e.owner] += 3;
      }
      for (const c of s.blds.map((id) => G.ents.get(id))) if (c && c.ctrl >= 0) pres[c.ctrl] += 2;
      let best = -1, bs = 0;
      for (let f = 0; f < pres.length; f++) { const sc = pres[f] * (1 + s.rep[f] / 100); s.inf[f] = sc; if (sc > bs) { bs = sc; best = f; } }
      const cur = s.ctrl;
      s.contested = cur >= 0 && pres.some((p, f) => p > 2 && hostile(f, cur));
      let next = cur;
      if (best >= 0 && bs >= 6 && s.rep[best] > -40 && (cur < 0 || s.inf[cur] < bs * 0.5)) next = best;
      if (cur >= 0 && s.rep[cur] < -55) next = -1;
      if (cur >= 0 && !fac(cur).alive) next = -1;
      if (next !== cur) {
        s.ctrl = next;
        if (next === G.player) Bus.emit('msg', s.name + ' is now under your administration', 'good', s.x, s.y);
        else if (cur === G.player) Bus.emit('msg', 'You lost control of ' + s.name, 'bad', s.x, s.y);
        else if (next >= 0) Bus.emit('msg', fac(next).name + ' took control of ' + s.name, 'info', s.x, s.y);
        else if (cur >= 0) Bus.emit('msg', s.name + ' declared itself independent', 'info', s.x, s.y);
        Bus.emit('control', s, cur, next);
      }
    }
  },

  /* ---------- evacuation ---------- */
  startEvac(s, owner, auto) {
    let target = null, shelter = null, bd = 1e9;
    for (const b of G.blds) if (b.type === 'shelter' && !b.dead && (owner < 0 || b.owner === owner) && (b.refugees || 0) < b.d.refuge) { const d = Math.hypot(b.x - s.x, b.y - s.y); if (d < bd) { bd = d; shelter = b; } }
    if (!shelter) for (const o of G.settlements) if (o !== s && o.danger < 15 && o.popMax > o.pop + 30) { const d = Math.hypot(o.x - s.x, o.y - s.y); if (d < bd) { bd = d; target = o; } }
    if (!shelter && !target) { if (owner === G.player) Bus.emit('msg', 'No safe destination — build a refugee shelter', 'warn'); return false; }
    s.evac = { shelter: shelter ? shelter.id : 0, sett: target ? target.id : -1, owner, auto: !!auto, t: 0 };
    Bus.emit('msg', 'Evacuation of ' + s.name + ' under way' + (shelter ? ' to ' + fac(shelter.owner).short + ' shelter' : ' to ' + target.name), owner === G.player ? 'good' : 'warn', s.x, s.y);
    return true;
  },
  evacArrive(a) {
    const s = G.settlements[a.sett]; if (!s || !s.evac) return;
    const n = a.carry || 1;
    const sh = G.ents.get(a.destShelter);
    if (sh && !sh.dead) { sh.refugees = (sh.refugees || 0) + n; sh.home = s.id; if (s.evac.owner >= 0) this.blame(sh.owner, s, 0.06 * n, 0.02 * n); fac(sh.owner).stats.evac += n; }
    else if (a.destSett >= 0) { G.settlements[a.destSett].pop += n; }
    G.stats.evacuated = (G.stats.evacuated || 0) + n;
  },

  /* ---------- service dispatch ---------- */
  findBld(s, pred) { for (const id of s.blds) { const c = G.ents.get(id); if (c && pred(c)) return c; } return null; },
  dispatchFire(s) {
    if (!s.fire) return;
    const st = this.findBld(s, (c) => c.type === 'fire' && this.functional(c)); if (!st) return;
    const busy = G.civs.filter((a) => a.ct === 'fire' && a.sett === s.id && !a.dead).length; if (busy >= 3) return;
    for (const id of s.blds) { const c = G.ents.get(id); if (!c || c.burn <= 0 || c.rubble || G.civs.some((a) => a.ct === 'fire' && a.task === c.id && !a.dead)) continue;
      const a = this.spawnVeh(s, 'fire', st.door, c.door >= 0 ? c.door : RoadNet.nearest(c.x, c.y, 5)); if (a) { a.task = c.id; a.spd = 80; } return; }
  },
  dispatchAmbulance(s) {
    const inj = G.civs.filter((a) => a.injured && !a.dead && a.sett === s.id && !a.claimed);
    if (!inj.length) return;
    const h = this.findBld(s, (c) => (c.type === 'hospital' || c.type === 'clinic') && this.functional(c)); if (!h) return;
    if (G.civs.filter((a) => a.ct === 'ambulance' && a.sett === s.id && !a.dead).length >= 2) return;
    const v = inj[0], dest = RoadNet.nearest(v.x, v.y, 5); if (dest < 0) return;
    const a = this.spawnVeh(s, 'ambulance', h.door, dest); if (a) { a.task = v.id; a.home = h.door; v.claimed = true; a.spd = 85; }
  },
  dispatchCrew(s) {
    if (G.civs.some((a) => a.ct === 'crew' && a.sett === s.id && !a.dead)) return;
    const base = this.findBld(s, (c) => c.type === 'construction' && this.functional(c)); if (!base) return;
    let worst = null, wv = 0.92;
    for (const id of s.blds) { const c = G.ents.get(id); if (!c || c.abandoned || c.burn > 0) continue; const v = c.rubble ? -1 : c.hp / c.maxHp; if (v < wv) { wv = v; worst = c; } }
    if (!worst || s.stock.materials < 20) return;
    const a = this.spawnVeh(s, 'crew', base.door, worst.door >= 0 ? worst.door : RoadNet.nearest(worst.x, worst.y, 5)); if (a) a.task = worst.id;
  },
  slowRepair(s) { for (const id of s.blds) { const c = G.ents.get(id); if (c && !c.rubble && !c.abandoned && c.hp < c.maxHp && c.burn <= 0) { c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.08); s.stock.materials -= 4; return; } } },

  convoys() {
    const S = G.settlements;
    for (const s of S) {
      if (!s.trade && !s.blds.some((id) => { const c = G.ents.get(id); return c && c.type === 'warehouse' && this.functional(c); })) continue;
      if (s.danger > 20 || s.evac) continue;
      const others = S.filter((o) => o !== s && o.danger < 30 && Math.hypot(o.x - s.x, o.y - s.y) < 150 * TILE && !(s.ctrl >= 0 && o.ctrl >= 0 && G.dip[s.ctrl][o.ctrl].sanction));
      if (!others.length) continue;
      const o = U.pick(others);
      const from = this.randomDoor(s), to = this.randomDoor(o); if (from < 0 || to < 0) continue;
      const a = this.spawnVeh(s, U.chance(0.5) ? 'truck' : 'van', from, to);
      if (a) { a.trade = o.id; a.spd = 70; }
    }
  },
  tradeArrive(a) {
    const s = G.settlements[a.sett], o = G.settlements[a.trade]; if (!s || !o) return;
    s.cash += 25; o.cash += 25; o.stock.goods += 20; s.happy = Math.min(100, s.happy + 0.5);
    for (const f of [s.ctrl, o.ctrl]) if (f >= 0) { const F = FACTIONS[fac(f).key]; const v = 20 * (F.mod.trade || 1); fac(f).res.credits += v; fac(f).income.trade += v; }
  },

  /* ---------- agents ---------- */
  randomDoor(s, pred) {
    for (let k = 0; k < 8; k++) { const c = G.ents.get(U.pick(s.blds)); if (c && c.door >= 0 && this.functional(c) && (!pred || pred(c))) return c.door; }
    return -1;
  },
  spawnPed(s, from, to, o = {}) {
    if (from < 0 || to < 0 || from === to) return null;
    const p = RoadNet.path(from, to, false, 3000); if (!p || p.length < 2) return null;
    const W = G.map.w, side = U.chance(0.5) ? 1 : -1;
    const x0 = ((p[0] % W) + 0.5) * TILE, y0 = (((p[0] / W) | 0) + 0.5) * TILE;
    const x1 = ((p[1] % W) + 0.5) * TILE, y1 = (((p[1] / W) | 0) + 0.5) * TILE;
    const a0 = Math.atan2(y1 - y0, x1 - x0), off = 9.5 * side + U.rnd(-1.5, 1.5);
    const a = {
      id: newId(), kind: 'civ', ct: 'ped', sett: s.id,
      x: x0 - Math.sin(a0) * off, y: y0 + Math.cos(a0) * off,
      a: a0, path: p, pi: 1, spd: U.rnd(17, 25), veh: false, hp: 20,
      state: 'walk', side, sideOff: off, v: U.rint(24), rad: 3, timer: 0,
      anim: Math.random() * 10, loops: 0, pauseT: 0, ...o,
    };
    G.civs.push(a); return a;
  },
  spawnVeh(s, ct, from, to) {
    if (from < 0 || to < 0 || from === to) return null;
    const p = RoadNet.path(from, to, true, 9000); if (!p || p.length < 2) return null;
    const W = G.map.w;
    const x0 = ((p[0] % W) + 0.5) * TILE, y0 = (((p[0] / W) | 0) + 0.5) * TILE;
    const x1 = ((p[1] % W) + 0.5) * TILE, y1 = (((p[1] / W) | 0) + 0.5) * TILE;
    const a0 = Math.atan2(y1 - y0, x1 - x0), lane = 5.2;
    const sx = x0 - Math.sin(a0) * lane, sy = y0 + Math.cos(a0) * lane;
    // Prevent spawning directly on top of another vehicle
    for (const o of G.civs) if (o.veh && !o.dead && Math.hypot(o.x - sx, o.y - sy) < 18) return null;
    const a = {
      id: newId(), kind: 'civ', ct, sett: s.id,
      x: sx, y: sy, a: a0, path: p, pi: 1,
      spd: ct === 'bus' ? 54 : ct === 'truck' ? 58 : U.rnd(62, 78),
      veh: true, hp: ct === 'bus' ? 120 : 70, state: 'drive',
      v: U.rint(7), rad: ct === 'bus' ? 10 : 7, timer: 0, wait: 0, carry: 0, loops: 0,
    };
    a.res = -1; G.civs.push(a); return a;
  },

  update(dt) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.6; this.spawn(); }
    const W = G.map.w;
    for (const a of G.civs) {
      if (a.dead) continue;
      if (a.injured) { a.timer -= dt; if (a.timer <= 0) this.killAgent(a, -1); continue; }
      if (a.ct === 'tractor') { this.tractor(a, dt); continue; }
      if (a.ct === 'train' || a.ct === 'wagon') continue;
      if (a.state === 'spray') {
        const c = G.ents.get(a.task); if (!c || c.burn <= 0 || c.rubble) { a.state = 'drive'; a.path = RoadNet.path(tileOf(a.x, a.y), this.home(a), true); a.pi = 1; if (!a.path) a.dead = true; continue; }
        c.burn = Math.max(0, c.burn - dt * 0.18); FX.spray(a.x, a.y, c.x, c.y); continue;
      }
      if (a.state === 'repair') {
        const c = G.ents.get(a.task), s = G.settlements[a.sett]; a.timer += dt;
        if (!c || !s || s.danger > 20 || s.stock.materials <= 0) { a.dead = true; continue; }
        if (c.rubble) { if (a.timer > 25) { c.rubble = false; c.hp = c.maxHp * 0.15; s.stock.materials -= 20; } }
        else { c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.03 * dt); s.stock.materials -= dt * 0.4; if (c.hp >= c.maxHp) a.dead = true; }
        if (Math.random() < 0.2) FX.add('dust', c.x + U.rnd(-c.rad, c.rad) * 0.5, c.y + U.rnd(-c.rad, c.rad) * 0.5, { size: 2, grow: 6, max: 0.6, c: '200,180,140', alpha: 0.4 });
        continue;
      }
      if (!a.path) { this.arrive(a); continue; }
      // flee from danger
      const s = G.settlements[a.sett];
      if (!a.veh && s && s.danger > 25 && a.state !== 'flee' && !a.evac) { a.state = 'flee'; }
      if (a.state === 'flee' && !a.fled) { a.fled = true; const d = this.findBld(s || G.settlements[0], (c) => c.door >= 0 && this.functional(c) && Math.hypot(c.x - a.x, c.y - a.y) < 8 * TILE); if (d) { const p = RoadNet.path(tileOf(a.x, a.y), d.door, false, 1500); if (p) { a.path = p; a.pi = 1; } } a.spd = 42; }
      const next = a.path[a.pi]; if (next == null) { a.path = null; continue; }
      if (!RoadNet.ok(next, a.veh)) { a.path = null; a.blocked = true; continue; }
      const prev = a.pi > 0 ? a.path[a.pi - 1] : next;
      const px0 = ((prev % W) + 0.5) * TILE, py0 = (((prev / W) | 0) + 0.5) * TILE;
      const tx = ((next % W) + 0.5) * TILE, ty = (((next / W) | 0) + 0.5) * TILE;
      // Compute stable segment direction from prev tile -> next tile so lane/sidewalk offsets never spiral
      let segAng = Math.atan2(ty - py0, tx - px0);
      if (prev === next) segAng = a.a;
      // Blend slightly with upcoming segment at corners for smooth turning
      if (a.pi + 1 < a.path.length) {
        const n2 = a.path[a.pi + 1], tx2 = ((n2 % W) + 0.5) * TILE, ty2 = (((n2 / W) | 0) + 0.5) * TILE;
        const nextAng = Math.atan2(ty2 - ty, tx2 - tx);
        if (Math.hypot(tx - a.x, ty - a.y) < 12) segAng = U.turn(segAng, nextAng, 0.45);
      }
      const off = a.veh ? 5.2 : (a.sideOff != null ? a.sideOff : 9.5 * a.side);
      const px = -Math.sin(segAng) * off, py = Math.cos(segAng) * off;
      const gx = tx + px, gy = ty + py, dx = gx - a.x, dy = gy - a.y, dist = Math.hypot(dx, dy);
      let spd = a.spd * (s && s.danger > 25 ? 1.35 : 1);
      if (a.veh) {
        // Intersection reservation and car-following with deadlock recovery
        if (RoadNet.deg[next] >= 3 && dist < 24) {
          const r = RoadNet.res[next];
          if (r && r !== a.id) {
            const holder = G.civs.find((o) => o.id === r && !o.dead);
            if (holder && Math.hypot(holder.x - tx, holder.y - ty) < 28 && (holder.wait || 0) < 1.5) {
              a.wait += dt;
              if (a.wait < 1.8) continue;
            }
          }
          RoadNet.res[next] = a.id;
        }
        const lx = a.x + Math.cos(a.a) * 12, ly = a.y + Math.sin(a.a) * 12;
        let slowK = 1;
        for (const o of G.hash.query(lx, ly, 10, World.tmp2)) {
          if (o === a || o.dead) continue;
          if (o.kind === 'civ' && o.veh) {
            const ahead = (o.x - a.x) * Math.cos(a.a) + (o.y - a.y) * Math.sin(a.a);
            const lat = Math.abs(-(o.x - a.x) * Math.sin(a.a) + (o.y - a.y) * Math.cos(a.a));
            if (ahead > 2 && ahead < 18 && lat < 5.5 && Math.cos(o.a - a.a) > 0.35) {
              slowK = Math.min(slowK, Math.max(0, (ahead - 8) / 10));
            }
          } else if (o.kind === 'unit' && o.d.cat !== 'air' && !o.inside && o.d.cat !== 'inf') {
            slowK = 0; break;
          }
        }
        if (slowK <= 0.05) {
          a.wait += dt;
          if (a.wait < 2.2) continue;
          // Deadlock breaker: gently nudge past stalled obstacle
          slowK = 0.55;
        } else a.wait = Math.max(0, a.wait - dt * 2);
        spd *= slowK;
        const desAng = dist > 1.5 ? Math.atan2(dy, dx) : segAng;
        a.a = U.turn(a.a, desAng, 8.5 * dt);
        if (a.prevRes != null && a.prevRes !== next && RoadNet.res[a.prevRes] === a.id) RoadNet.res[a.prevRes] = 0;
        const step = Math.min(dist, spd * dt);
        a.x += (dx / (dist || 1)) * step; a.y += (dy / (dist || 1)) * step;
        if (dist < 6.5) { a.prevRes = next; a.pi++; if (a.pi >= a.path.length) { a.path = null; } }
      } else {
        // Pedestrian walking: smooth stride animation, occasional window-shopping pause, and gentle sidewalk spacing
        if (a.pauseT > 0 && a.state !== 'flee' && !a.evac) { a.pauseT -= dt; continue; }
        if (a.state === 'walk' && !a.evac && Math.random() < dt * 0.04) { a.pauseT = U.rnd(0.8, 2.2); continue; }
        a.a = U.turn(a.a, Math.atan2(dy, dx), 10 * dt);
        a.anim = (a.anim || 0) + dt * (spd * 0.32);
        const step = Math.min(dist, spd * dt);
        a.x += (dx / (dist || 1)) * step; a.y += (dy / (dist || 1)) * step;
        if (dist < 4.5) { a.pi++; if (a.pi >= a.path.length) { a.path = null; } }
      }
    }
    if (this.train) this.trainUpdate(dt);
    if (G.civs.some((a) => a.dead)) G.civs = G.civs.filter((a) => !a.dead);
  },
  home(a) { const s = G.settlements[a.sett]; return a.home != null ? a.home : s ? this.randomDoor(s) : -1; },
  arrive(a) {
    const s = G.settlements[a.sett];
    if (a.prevRes != null && RoadNet.res[a.prevRes] === a.id) RoadNet.res[a.prevRes] = 0;
    if (a.blocked && a.veh) { a.blocked = false; const p = RoadNet.path(tileOf(a.x, a.y), this.home(a), true); if (p && p.length > 1) { a.path = p; a.pi = 1; return; } a.dead = true; return; }
    if (a.ct === 'fire') { const c = G.ents.get(a.task); if (c && c.burn > 0 && Math.hypot(c.x - a.x, c.y - a.y) < c.rad + 70) { a.state = 'spray'; return; } a.dead = true; return; }
    if (a.ct === 'crew') { const c = G.ents.get(a.task); if (c && Math.hypot(c.x - a.x, c.y - a.y) < c.rad + 60) { a.state = 'repair'; a.timer = 0; return; } a.dead = true; return; }
    if (a.ct === 'ambulance') {
      if (!a.picked) { const v = G.civs.find((o) => o.id === a.task); if (v && !v.dead) { v.dead = true; a.picked = true; G.stats.treated = (G.stats.treated || 0) + 1; } a.picked = true; const p = RoadNet.path(tileOf(a.x, a.y), a.home, true); if (p) { a.path = p; a.pi = 1; return; } }
      a.dead = true; return;
    }
    if (a.trade != null) { this.tradeArrive(a); a.dead = true; return; }
    if (a.evac) { this.evacArrive(a); a.dead = true; return; }
    if (a.ct === 'police' || a.ct === 'bus') { if ((a.loops = (a.loops || 0) + 1) < 8 && s) { const p = RoadNet.path(tileOf(a.x, a.y), this.randomDoor(s), true); if (p && p.length > 1) { a.path = p; a.pi = 1; return; } } }
    // Keep cars and pedestrians circulating through town for several errands before despawning
    if ((a.ct === 'car' || a.ct === 'van') && (a.loops = (a.loops || 0) + 1) < 4 && s && s.danger <= 25) {
      const p = RoadNet.path(tileOf(a.x, a.y), this.randomDoor(s), true, 4000);
      if (p && p.length > 1) { a.path = p; a.pi = 1; return; }
    }
    if (a.ct === 'ped' && (a.loops = (a.loops || 0) + 1) < 5 && s && s.danger <= 25) {
      const p = RoadNet.path(tileOf(a.x, a.y), this.randomDoor(s), false, 2500);
      if (p && p.length > 1) { a.path = p; a.pi = 1; a.pauseT = U.rnd(0.4, 1.4); return; }
    }
    a.dead = true;
  },

  spawn() {
    const night = Clock.night(), dayK = night ? 0.25 : Clock.hourF() < 7 || Clock.hourF() > 21 ? 0.5 : 1;
    let total = G.civs.length;
    const cap = G.cfg.civCap || 420;
    for (const s of G.settlements) {
      if (total > cap) break;
      let peds = 0, cars = 0, pol = 0, bus = 0, tr = 0;
      for (const a of G.civs) if (a.sett === s.id && !a.dead) { if (a.ct === 'ped') peds++; else if (a.ct === 'police') pol++; else if (a.ct === 'bus') bus++; else if (a.ct === 'tractor') tr++; else if (a.veh) cars++; }
      s.peds = peds; s.cars = cars;
      // evacuation buses and walkers
      if (s.evac && s.pop > 5) {
        s.evac.t -= 0.6;
        if (s.evac.t <= 0) {
          s.evac.t = 3;
          const sh = G.ents.get(s.evac.shelter), destTile = sh && !sh.dead ? RoadNet.nearest(sh.x, sh.y + sh.h * TILE * 0.5 + 16, 6) : s.evac.sett >= 0 ? this.randomDoor(G.settlements[s.evac.sett]) : -1;
          const from = this.randomDoor(s, (c) => c.type === 'transit' || c.type === 'cityhall' || c.type === 'school') >= 0 ? this.randomDoor(s, (c) => c.type === 'transit' || c.type === 'cityhall' || c.type === 'school') : this.randomDoor(s);
          if (destTile >= 0 && from >= 0) {
            const a = this.spawnVeh(s, 'bus', from, destTile);
            if (a) { a.evac = true; a.carry = Math.min(30, Math.ceil(s.pop)); s.pop -= a.carry; a.destShelter = s.evac.shelter; a.destSett = s.evac.sett; a.spd = 70; total++; }
            else { for (let k = 0; k < 4; k++) { const p = this.spawnPed(s, from, destTile, { evac: true, carry: 3, destShelter: s.evac.shelter, destSett: s.evac.sett }); if (p) { s.pop -= 3; p.spd = 30; total++; } } }
          }
        }
        continue;
      }
      if (s.danger > 25) continue;
      const wantPeds = Math.min(54, Math.max(8, s.pop / 9)) * dayK, wantCars = Math.min(20, Math.max(3, s.pop / 24)) * dayK;
      if (peds < wantPeds) {
        const batch = peds < wantPeds * 0.5 ? 3 : 2;
        for (let b = 0; b < batch && total <= cap; b++) {
          const a = this.spawnPed(s, this.randomDoor(s), this.randomDoor(s));
          if (a) total++;
        }
      }
      if (cars < wantCars && Math.random() < 0.65) { const a = this.spawnVeh(s, U.chance(0.18) ? 'van' : 'car', this.randomDoor(s), this.randomDoor(s)); if (a) total++; }
      if (s.police && pol < 1 && Math.random() < 0.2) { const st = this.findBld(s, (c) => c.type === 'police' && this.functional(c)); if (st) { const a = this.spawnVeh(s, 'police', st.door, this.randomDoor(s)); if (a) { a.home = st.door; total++; } } }
      if (s.transit && bus < 2 && !night && Math.random() < 0.15) { const st = this.findBld(s, (c) => (c.type === 'transit' || c.type === 'station') && this.functional(c)); if (st) { const a = this.spawnVeh(s, 'bus', st.door, this.randomDoor(s)); if (a) { a.home = st.door; total++; } } }
      if (!night && tr < 2 && Math.random() < 0.1) { const fh = this.findBld(s, (c) => c.type === 'farmhouse' && this.functional(c)); if (fh) this.spawnTractor(s, fh); }
    }
  },

  spawnTractor(s, fh) {
    const M = G.map, tiles = [];
    for (let y = fh.ty - 10; y < fh.ty + 10; y++) for (let x = fh.tx - 10; x < fh.tx + 10; x++) if (x >= 0 && y >= 0 && x < M.w && y < M.h && M.terr[y * M.w + x] === TER.FARM && !M.occ[y * M.w + x]) tiles.push(y * M.w + x);
    if (tiles.length < 4) return;
    const t = U.pick(tiles);
    G.civs.push({ id: newId(), kind: 'civ', ct: 'tractor', sett: s.id, x: ((t % M.w) + 0.5) * TILE, y: (((t / M.w) | 0) + 0.5) * TILE, a: 0, tiles, goal: null, spd: 14, veh: true, hp: 60, v: 0, rad: 6, life: 120 });
  },
  tractor(a, dt) {
    const M = G.map; a.life -= dt; if (a.life <= 0 || Clock.night()) { a.dead = true; return; }
    if (!a.goal) { const t = U.pick(a.tiles); a.goal = { x: ((t % M.w) + 0.5) * TILE, y: (((t / M.w) | 0) + 0.5) * TILE }; }
    const dx = a.goal.x - a.x, dy = a.goal.y - a.y, d = Math.hypot(dx, dy);
    if (d < 3) { a.goal = null; return; }
    a.a = U.turn(a.a, Math.atan2(dy, dx), 2 * dt); a.x += Math.cos(a.a) * a.spd * dt; a.y += Math.sin(a.a) * a.spd * dt;
    if (Math.random() < 0.1) FX.add('dust', a.x, a.y, { size: 2, grow: 6, max: 1, c: '170,150,100', alpha: 0.35 });
  },

  /* ---------- railway ---------- */
  trainInit(M) {
    this.train = null;
    if (!M.railPath || M.railPath.length < 20) return;
    const W = M.w, pts = M.railPath.map((i) => ({ x: ((i % W) + 0.5) * TILE, y: (((i / W) | 0) + 0.5) * TILE, i }));
    const cars = [];
    for (let k = 0; k < 4; k++) { const a = { id: newId(), kind: 'civ', ct: k === 0 ? 'train' : 'wagon', sett: 0, x: pts[0].x, y: pts[0].y, a: 0, veh: true, hp: 300, v: k, rad: 12 }; cars.push(a); G.civs.push(a); }
    this.train = { pts, s: 0, dir: 1, cars, spd: 70, wait: 8, check: false };
  },
  trainUpdate(dt) {
    const T = this.train; if (T.cars[0].dead) { this.train = null; return; }
    if (T.wait > 0) { T.wait -= dt; } else {
      const M = G.map, ahead = Math.floor(T.s) + T.dir * 3;
      const p = T.pts[U.clamp(ahead, 0, T.pts.length - 1)];
      const brokenAhead = M.rail[p.i] === 3;
      if (brokenAhead) { T.dir *= -1; T.wait = 6; }
      else { T.s += T.dir * T.spd * dt / TILE; if (T.s <= 0 || T.s >= T.pts.length - 1) { T.s = U.clamp(T.s, 0, T.pts.length - 1); T.dir *= -1; T.wait = 12; } }
    }
    T.cars.forEach((c, k) => {
      if (c.dead) return;
      const s = U.clamp(T.s - T.dir * k * 1.0, 0, T.pts.length - 1), i0 = Math.floor(s), i1 = Math.min(T.pts.length - 1, i0 + 1), f = s - i0;
      const a = T.pts[i0], b = T.pts[i1]; c.x = U.lerp(a.x, b.x, f); c.y = U.lerp(a.y, b.y, f); if (i1 !== i0) c.a = Math.atan2(b.y - a.y, b.x - a.x);
    });
  },
};
