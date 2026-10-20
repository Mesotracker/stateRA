'use strict';
/* =====================================================================
   CITY.RA — eco.js
   Factions, resources, storage, power grid, upkeep and shortages,
   production queues, placement, selling, upgrades and research.
   ===================================================================== */

const BASE_CAP = { credits: 1e9, fuel: 1000, materials: 800, food: 600, water: 600, metal: 600, supplies: 500 };

const Eco = {
  makeFaction(i, key, o = {}) {
    const F = FACTIONS[key];
    const start = o.start || { credits: 6000, fuel: 400, materials: 400, food: 300, water: 300, metal: 250, supplies: 250 };
    return {
      id: i, key, name: F.name, short: F.short, color: F.color, isPlayer: !!o.player, isAI: !o.player, aiBonus: 1, alive: true, team: o.team == null ? i : o.team,
      res: { ...start }, cap: { ...BASE_CAP }, power: { prod: 0, use: 0 }, lowPower: false, radar: false,
      tech: new Set(o.tech || []), research: null, q: { bld: [], inf: [], veh: [], air: [], sea: [] }, primary: {},
      rep: 0, civKills: 0, lack: {}, fuelUse: 0, income: { tax: 0, trade: 0 }, rates: {}, last: { ...start },
      stats: { kills: 0, lost: 0, bkills: 0, blost: 0, harvested: 0, aid: 0, evac: 0, built: 0, trained: 0 },
      startX: 0, startY: 0, unlimited: !!o.unlimited,
    };
  },

  costOf(f, def, isUnit) {
    const F = FACTIONS[f.key], out = {};
    const m = isUnit && F.mod.cost ? F.mod.cost[def.cat] || 1 : 1;
    for (const k in def.cost) out[RES_SHORT[k] || k] = Math.round(def.cost[k] * m);
    return out;
  },
  canAfford(f, cost) { if (f.unlimited) return true; for (const k in cost) if ((f.res[k] || 0) < cost[k]) return false; return true; },
  pay(f, cost) { if (f.unlimited) return; for (const k in cost) f.res[k] -= cost[k]; },
  refund(f, cost, k = 1) { for (const r in cost) f.res[r] += cost[r] * k; },
  missing(f, cost) { const m = []; for (const k in cost) if ((f.res[k] || 0) < cost[k]) m.push(RES_LABEL[k]); return m; },

  has(f, type, built = true) { return G.blds.some((b) => !b.dead && b.owner === f.id && b.type === type && (!built || b.built >= 1)); },
  count(f, type) { let n = 0; for (const b of G.blds) if (!b.dead && b.owner === f.id && b.type === type) n++; return n; },

  // requirement check; returns null if available, else a reason
  locked(f, key, isUnit) {
    const d = isUnit ? UNITS[key] : BLDS[key];
    if (d.faction && d.faction !== f.key) return 'Exclusive to ' + FACTIONS[d.faction].name;
    if (isUnit && !this.has(f, PRODUCER[d.cat])) return 'Needs ' + BLDS[PRODUCER[d.cat]].name;
    if (!isUnit && !this.has(f, 'hq')) return 'Needs a Headquarters';
    if (G.cfg.instant && f.isPlayer) return null; // sandbox: no prerequisites
    if (d.req) for (const r of d.req) if (!this.has(f, r)) return 'Needs ' + BLDS[r].name;
    if (d.tech && !f.tech.has(d.tech)) return 'Research ' + TECH[d.tech].name;
    return null;
  },

  queue(f, key, isUnit) {
    const d = isUnit ? UNITS[key] : BLDS[key], cat = isUnit ? d.cat : 'bld';
    if (this.locked(f, key, isUnit)) return false;
    const q = f.q[cat];
    if (q.length >= (cat === 'bld' ? 6 : 12)) return false;
    q.push({ key, isUnit, t: 0, T: d.time, paid: false, done: false, hold: false, cost: this.costOf(f, d, isUnit) });
    return true;
  },
  cancel(f, cat, idx) {
    const q = f.q[cat], it = q[idx]; if (!it) return;
    if (it.paid) this.refund(f, it.cost, 1);
    q.splice(idx, 1);
  },
  speed(f, cat) {
    const ptype = cat === 'bld' ? 'hq' : PRODUCER[cat];
    let n = 0, lvl = 1;
    for (const b of G.blds) if (!b.dead && b.owner === f.id && b.type === ptype && b.built >= 1) { n++; if (b.level > 1) lvl = 1.3; }
    if (!n) return 0;
    let s = Math.min(2.5, 1 + 0.5 * (n - 1)) * lvl * (f.lowPower ? 0.5 : 1);
    if (cat === 'inf' && (f.lack.food || f.lack.water)) s *= 0.5;
    if ((cat === 'veh' || cat === 'air' || cat === 'sea') && f.lack.fuel) s *= 0.5;
    if (f.isAI) s *= f.aiSpeed || 1;
    return s * (G.cfg.buildSpeed || 1);
  },

  updateQueues(f, dt) {
    for (const cat in f.q) {
      const q = f.q[cat], it = q[0]; if (!it || it.done || it.hold) continue;
      if (!it.paid) { if (this.canAfford(f, it.cost)) { this.pay(f, it.cost); it.paid = true; } else { it.waiting = true; continue; } }
      it.waiting = false;
      const sp = this.speed(f, cat); if (!sp) continue;
      it.t += G.cfg.instant && f.isPlayer ? it.T : dt * sp;
      if (it.t >= it.T) {
        if (it.isUnit) {
          if (this.spawnProduced(f, it.key)) { q.shift(); f.stats.trained++; if (f.id === G.player) Bus.emit('msg', UNITS[it.key].name + ' ready', 'info'); Bus.emit('sfx', 'ready'); }
          else it.t = it.T;
        } else { it.done = true; if (f.id === G.player) { Bus.emit('msg', BLDS[it.key].name + ' ready to place', 'good'); Bus.emit('sfx', 'ready'); } }
      }
    }
    if (f.research) {
      const r = f.research, lab = this.has(f, 'lab'); if (!lab) return;
      r.t += G.cfg.instant && f.isPlayer ? r.T : dt * (f.lowPower ? 0.5 : 1) * (FACTIONS[f.key].mod.research || 1) * (f.isAI ? f.aiSpeed || 1 : 1);
      if (r.t >= r.T) { this.completeTech(f, r.key); f.research = null; }
    }
  },
  startResearch(f, key) {
    if (f.research || f.tech.has(key) || !this.has(f, 'lab')) return false;
    if ((TECH[key].req || []).some((k) => !f.tech.has(k))) return false;
    const c = { credits: TECH[key].cost }; if (!this.canAfford(f, c)) return false;
    this.pay(f, c); f.research = { key, t: 0, T: TECH[key].time }; return true;
  },
  completeTech(f, key) {
    f.tech.add(key);
    if (key === 'composite') for (const u of G.units) if (u.owner === f.id && u.d.cat === 'veh') { u.maxHp = Math.round(u.maxHp * 1.2); u.hp *= 1.2; }
    Bus.emit('msg', 'Research complete: ' + TECH[key].name, f.id === G.player ? 'good' : 'info');
    if (f.id === G.player) Bus.emit('sfx', 'ready');
  },

  place(f, tx, ty) {
    const it = f.q.bld[0]; if (!it || !it.done) return false;
    const ok = World.canPlace(it.key, f.id, tx, ty); if (!ok.ok) return ok;
    const b = World.addBld(it.key, f.id, tx, ty);
    f.q.bld.shift(); f.stats.built++;
    if (it.key === 'refinery') {
      const dock = Abil.refDock(b, { id: G.nextId, d: UNITS.harvester });
      const h = World.spawnUnit('harvester', f.id, dock.x, dock.y);
      h.a = Math.PI / 2;
    }
    if (it.key === 'shelter') b.refugees = 0;
    Bus.emit('sfx', 'place', b.x, b.y);
    if (BLDS[it.key].repeat && f.id === G.player && UI.shift) this.queue(f, it.key, false);
    return { ok: true, b };
  },

  sell(b) {
    const f = fac(b.owner), c = this.costOf(f, b.d, false);
    f.res.credits += (c.credits || 0) * 0.5 * (b.hp / b.maxHp); f.res.materials += (c.materials || 0) * 0.3;
    World.freeTiles(b); b.dead = true; G.ents.delete(b.id);
    FX.add('dust', b.x, b.y, { size: 10, grow: 30, max: 1.2, c: '150,140,120', alpha: 0.5 });
    if (b.docks) for (const id of b.docks) { const p = G.ents.get(id); if (p) { p.home = 0; p.state = 'orbit'; p.ord = { t: 'orbit', x: p.x, y: p.y }; } }
    Bus.emit('sfx', 'cash', b.x, b.y);
  },
  upgrade(b) {
    const f = fac(b.owner), d = b.d; if (!d.up || b.level > 1 || b.upg) return false;
    const cost = {}; for (const k in d.up.cost) cost[RES_SHORT[k] || k] = d.up.cost[k];
    if (!this.canAfford(f, cost)) { if (f.id === G.player) Bus.emit('msg', 'Insufficient resources: ' + this.missing(f, cost).join(', '), 'warn'); return false; }
    this.pay(f, cost); b.upg = { t: 0, T: d.up.time }; return true;
  },

  spawnProduced(f, key) {
    const d = UNITS[key], ptype = PRODUCER[d.cat];
    const prods = G.blds.filter((b) => !b.dead && b.owner === f.id && b.type === ptype && b.built >= 1);
    if (!prods.length) return false;
    let p = prods.find((b) => b.id === f.primary[d.cat]) || prods[(f.rr = (f.rr || 0) + 1) % prods.length];
    let x = p.x, y = (p.ty + p.h) * TILE + 12, u;
    if (d.cat === 'air') {
      if (d.plane) {
        const hg = prods.find((b) => b.docks.indexOf(0) >= 0);
        if (!hg) { if (f.id === G.player && !f.dockMsg) { f.dockMsg = true; Bus.emit('msg', 'All airfield docks are full — build another airfield', 'warn'); setTimeout(() => (f.dockMsg = false), 15000); } return false; }
        p = hg; const di = hg.docks.indexOf(0), pos = Air.dockPos(hg, di);
        u = World.spawnUnit(key, f.id, pos.x, pos.y, { docked: true, a: -Math.PI / 2 }); hg.docks[di] = u.id; u.home = hg.id; u.state = 'docked';
      } else { u = World.spawnUnit(key, f.id, p.x, p.y + 10, { a: -Math.PI / 2 }); u.alt = 0.2; u.state = 'hover'; u.home = p.id; }
    } else if (d.cat === 'sea') {
      const M = G.map; let spot = -1;
      for (let r = 1; r <= 4 && spot < 0; r++) for (let yy = p.ty - r; yy < p.ty + p.h + r && spot < 0; yy++) for (let xx = p.tx - r; xx < p.tx + p.w + r; xx++) { if (Path.passable(d.mc, xx, yy) && MOVE.naval[M.terr[yy * M.w + xx]]) { spot = yy * M.w + xx; break; } }
      if (spot < 0) return false;
      u = World.spawnUnit(key, f.id, ((spot % M.w) + 0.5) * TILE, (((spot / M.w) | 0) + 0.5) * TILE);
    } else {
      // exit tile below the producer
      const M = G.map; let spot = -1;
      for (let r = 0; r < 4 && spot < 0; r++) for (let xx = p.tx - r; xx < p.tx + p.w + r && spot < 0; xx++) { const yy = p.ty + p.h + r; if (Path.passable(d.mc, xx, yy)) spot = yy * M.w + xx; }
      if (spot < 0) spot = Path.nearestPassable(d.mc, ((p.x / TILE) | 0), p.ty + p.h, 6);
      if (spot < 0) return false;
      x = ((spot % M.w) + 0.5) * TILE; y = (((spot / M.w) | 0) + 0.5) * TILE;
      u = World.spawnUnit(key, f.id, x, y, { a: Math.PI / 2 });
    }
    if (p.rally && u.d.cat !== 'air' && !(u.d.ab && u.d.ab.harvest)) World.moveTo(u, p.rally.x + U.rnd(-12, 12), p.rally.y + U.rnd(-12, 12));
    else if (u.d.cat !== 'air' && !(u.d.ab && u.d.ab.harvest)) World.moveTo(u, u.x + U.rnd(-20, 20), u.y + 30 + U.rnd(0, 20));
    Bus.emit('produced', u, p);
    return true;
  },

  /* ---------- per-second economy ---------- */
  tick() {
    for (const f of G.factions) {
      if (!f.alive) continue;
      const cap = { ...BASE_CAP }; let prod = 0, use = 0, radar = false;
      const make = { fuel: 0, materials: 0, food: 0, water: 0, metal: 0, supplies: 0, credits: 0 };
      let infN = 0;
      for (const b of G.blds) {
        if (b.dead || b.owner !== f.id || b.built < 1) continue;
        const d = b.d, k = b.hp / b.maxHp;
        if (d.pw > 0) prod += (b.type === 'power' && b.level > 1 ? 200 : d.pw) * (0.4 + 0.6 * k); else use -= d.pw || 0;
        if (d.store) for (const r in d.store) cap[r] += d.store[r];
        if (b.type === 'radar') radar = true;
      }
      for (const c of G.civb) if (c.ctrl === f.id && !c.rubble) {
        if (c.d.cap === 'power' && Civ.functional(c)) prod += 120;
        if (c.d.cap === 'oil') { make.fuel += 1.5; make.credits += 1; }
        if (c.d.cap === 'fuel') make.fuel += 0.4;
        if (c.d.cap === 'airport') make.credits += 3;
        if (c.d.cap === 'port') make.credits += 2;
        if (c.d.cap === 'heal') for (const o of G.hash.query(c.x, c.y, 5 * TILE, World.tmp)) if (o.kind === 'unit' && o.owner === f.id && o.d.cat === 'inf' && o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + 5);
      }
      f.power.prod = Math.round(prod); f.power.use = Math.round(use);
      f.lowPower = use > prod; f.radar = radar && !f.lowPower;
      const pk = f.lowPower ? 0.5 : 1;
      for (const b of G.blds) {
        if (b.dead || b.owner !== f.id || b.built < 1) continue;
        const d = b.d, k = (0.4 + 0.6 * b.hp / b.maxHp) * pk * (b.level > 1 ? 1.5 : 1);
        if (d.make) for (const r in d.make) {
          if (r === 'supplies' && d.eat) { const need = d.eat.food * k, needM = d.eat.metal * k; if (f.res.food >= need && f.res.metal >= needM) { f.res.food -= need; f.res.metal -= needM; make.supplies += d.make.supplies * k; } }
          else make[r] += d.make[r] * k * (r === 'food' ? Math.max(0, 1 - Fall.at(b.x, b.y) * 1.2) * (G.nuclearWinter ? 0.4 : 1) : 1);
        }
        if (d.convert && f.res.credits > 30) { const n = 1.2 * pk * (b.level > 1 ? 1.5 : 1); f.res.credits -= n * 2; make.materials += n; }
      }
      for (const u of G.units) if (u.owner === f.id && !u.dead && u.d.cat === 'inf') infN++;
      // refugee upkeep handled in Civ; infantry upkeep
      const foodUse = infN * 0.012, waterUse = infN * 0.012;
      for (const r in make) f.res[r] = (f.res[r] || 0) + make[r] * (f.isAI && r !== 'credits' ? f.aiBonus : 1);
      if (f.isAI && f.aiTrickle) f.res.credits += f.aiTrickle;
      f.res.food -= foodUse; f.res.water -= waterUse; f.res.fuel -= f.fuelUse; f.fuelUse = 0;
      // trade agreements
      for (const o of G.factions) if (o !== f && o.alive && G.dip[f.id][o.id].trade) { const v = 3 * (FACTIONS[f.key].mod.trade || 1) * (this.has(f, 'logistics') ? 1.5 : 1) * (G.dip[f.id][o.id].sanction || G.dip[o.id][f.id].sanction ? 0 : 1); f.res.credits += v; f.income.trade += v; }
      for (const r of RES_KEYS) { if (r === 'credits') continue; f.res[r] = U.clamp(f.res[r], 0, cap[r]); }
      if (f.unlimited) for (const r of RES_KEYS) f.res[r] = Math.max(f.res[r], r === 'credits' ? 50000 : cap[r]);
      f.cap = cap;
      const hadShort = { ...f.lack };
      f.lack.food = f.res.food < 1 && infN > 0; f.lack.water = f.res.water < 1 && infN > 0;
      f.lack.fuel = f.res.fuel < 1; f.lack.supplies = f.res.supplies < 1;
      if (f.id === G.player) for (const r of ['food', 'water', 'fuel', 'supplies']) if (f.lack[r] && !hadShort[r]) Bus.emit('msg', RES_LABEL[r] + ' shortage — ' + ({ food: 'infantry morale and training suffer', water: 'infantry morale and training suffer', fuel: 'vehicles slowed, aircraft grounded', supplies: 'no resupply for ammunition' })[r], 'bad');
      // rates (per minute, smoothed)
      for (const r of RES_KEYS) { const dlt = (f.res[r] - (f.last[r] || 0)) * 60; f.rates[r] = f.rates[r] == null ? dlt : U.lerp(f.rates[r], dlt, 0.15); f.last[r] = f.res[r]; }
    }
    Market.tick();
  },

  checkAlive() {
    for (const f of G.factions) {
      if (!f.alive || f.noElim) continue;
      const hasB = G.blds.some((b) => b.owner === f.id && !b.dead && !b.d.wall && !b.d.walk);
      const hasU = G.units.some((u) => u.owner === f.id && !u.dead && (u.d.w.length || (u.d.ab && (u.d.ab.carry || u.d.ab.capture))));
      if (!hasB && !hasU) {
        f.alive = false;
        for (const s of G.settlements) if (s.ctrl === f.id) s.ctrl = -1;
        for (const c of G.civb) if (c.ctrl === f.id) c.ctrl = -1;
        Bus.emit('msg', f.name + ' has been defeated', f.id === G.player ? 'bad' : 'good');
        Bus.emit('defeated', f);
      }
    }
  },
};

/* =====================================================================
   STOCK & MUNICIPAL EXCHANGE
   Invest in listed corporations (defense, mining, energy, logistics,
   agri, robotics) AND municipal bonds/equities for every city/town on
   the map. Prices & dividends react dynamically to real-time theatre
   events, city prosperity, mining output, research, and combat.
   ===================================================================== */
const CORP_DEFS = [
  { id: 'c_aegis', ticker: 'AEGS', name: 'Aegis Defense Systems', sector: 'Defense & Aerospace', base: 140, div: 0.016, desc: 'Armoured vehicles, munitions and missile systems. Surges during active combat and heavy unit production.' },
  { id: 'c_orlov', ticker: 'ORLV', name: 'Orlov Heavy Mining', sector: 'Resources & Ore', base: 110, div: 0.022, desc: 'Refineries, ore collectors and metal smelting. Driven by active refineries, mines and ore harvesting.' },
  { id: 'c_helios', ticker: 'HLIO', name: 'Helios Power & Grid', sector: 'Energy & Utilities', base: 95, div: 0.026, desc: 'Power plants, fuel depots and oil derricks. Steady dividend payer when regional power grids are online.' },
  { id: 'c_trans', ticker: 'TRNS', name: 'Trans-Continental Logistics', sector: 'Shipping & Trade', base: 105, div: 0.020, desc: 'Harbours, airports, rail lines and trade convoys. Thrives on diplomatic trade agreements and intact bridges.' },
  { id: 'c_ceres', ticker: 'CRES', name: 'Ceres Agri & Biotech', sector: 'Food & Medical', base: 85, div: 0.024, desc: 'Farms, water treatment, hospitals and humanitarian supplies. Gains from population growth and aid.' },
  { id: 'c_nexus', ticker: 'NXRB', name: 'Nexus Cybernetics & Drones', sector: 'Robotics & AI', base: 165, div: 0.014, desc: 'Autonomous combat walkers, robot soldiers and remote UAVs. Booms when factions research drones and robotics.' },
];

const Market = {
  init() {
    const r = RNG((G.map ? G.map.seed : 1) + 404);
    const items = [];
    // Listed companies
    for (const c of CORP_DEFS) {
      const p0 = Math.round(c.base * (0.92 + r() * 0.16));
      const hist = [];
      let hp = p0;
      for (let i = 0; i < 36; i++) { hp = Math.max(15, hp * (1 + (r() - 0.495) * 0.025)); hist.push(Math.round(hp * 10) / 10); }
      items.push({
        id: c.id, kind: 'corp', ticker: c.ticker, name: c.name, sector: c.sector, desc: c.desc,
        price: hist[hist.length - 1], startPrice: p0, prevPrice: hist[hist.length - 2] || p0,
        divRate: c.div, shares: 0, avgCost: 0, hist, trend: 0,
      });
    }
    // Municipal city equities / bonds for every settlement on the map
    const usedTick = new Set(items.map((x) => x.ticker));
    for (const s of G.settlements || []) {
      let tk = s.name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
      while (tk.length < 3) tk += 'X';
      if (usedTick.has(tk)) tk = tk.slice(0, 3) + (s.id % 10);
      usedTick.add(tk);
      const base = s.kind === 'city' ? 130 : s.kind === 'town' ? 90 : 60;
      const p0 = Math.round(base * (0.9 + r() * 0.2));
      const hist = [];
      let hp = p0;
      for (let i = 0; i < 36; i++) { hp = Math.max(12, hp * (1 + (r() - 0.495) * 0.02)); hist.push(Math.round(hp * 10) / 10); }
      items.push({
        id: 'city_' + s.id, kind: 'city', settId: s.id, ticker: tk,
        name: s.name + ' Municipal', sector: (s.kind[0].toUpperCase() + s.kind.slice(1)) + ' Bond & Development',
        desc: 'Municipal development fund for ' + s.name + '. Value and yield track local population, happiness, power/water, infrastructure and safety. You can also directly fund civic development.',
        price: hist[hist.length - 1], startPrice: p0, prevPrice: hist[hist.length - 2] || p0,
        divRate: s.kind === 'city' ? 0.025 : 0.028, shares: 0, avgCost: 0, hist, trend: 0, devLevel: 0,
      });
    }
    G.market = { t: 0, items, divPaid: 0, lastDiv: 0, realized: 0, filter: 'all', sel: items[0] ? items[0].id : null };
  },

  ensure() {
    if (!G.market || !G.market.items || !G.market.items.length) this.init();
    return G.market;
  },

  fundamental(it) {
    if (it.kind === 'city') {
      const s = G.settlements[it.settId];
      if (!s) return it.startPrice;
      const popK = s.popMax > 0 ? U.clamp(s.pop / s.popMax, 0.1, 1.3) : 0.5;
      const happyK = U.clamp(s.happy / 62, 0.35, 1.6);
      const infraK = U.clamp(s.infra, 0.2, 1.2);
      const utilK = 0.65 + s.power * 0.2 + s.water * 0.15;
      const dangerPen = Math.max(0.25, 1 - s.danger / 115);
      const devBonus = 1 + (it.devLevel || 0) * 0.14;
      return Math.max(10, it.startPrice * popK * happyK * infraK * utilK * dangerPen * devBonus);
    }
    // Corporate fundamentals linked to real theatre state
    switch (it.id) {
      case 'c_aegis': {
        const combatU = G.units.filter((u) => !u.dead && u.d.w.length).length;
        const warCount = G.factions.filter((f) => f.alive).length;
        return it.startPrice * (0.85 + combatU * 0.012 + warCount * 0.05);
      }
      case 'c_orlov': {
        const refs = G.blds.filter((b) => !b.dead && (b.type === 'refinery' || b.type === 'mine')).length;
        const harv = G.units.filter((u) => !u.dead && u.type === 'harvester').length;
        return it.startPrice * (0.8 + refs * 0.09 + harv * 0.06);
      }
      case 'c_helios': {
        const pwr = G.blds.filter((b) => !b.dead && (b.type === 'power' || b.type === 'fueldepot')).length;
        const oil = G.civb.filter((c) => !c.rubble && (c.type === 'derrick' || c.type === 'powerstation') && c.ctrl >= 0).length;
        return it.startPrice * (0.85 + pwr * 0.05 + oil * 0.09);
      }
      case 'c_trans': {
        let trades = 0;
        for (let a = 0; a < G.factions.length; a++) for (let b = a + 1; b < G.factions.length; b++) if (G.dip[a] && G.dip[a][b] && G.dip[a][b].trade) trades++;
        const intactBridges = G.bridges.filter((b) => !b.broken).length / Math.max(1, G.bridges.length);
        return it.startPrice * (0.75 + intactBridges * 0.35 + trades * 0.18);
      }
      case 'c_ceres': {
        const avgHappy = G.settlements.length ? G.settlements.reduce((s, x) => s + x.happy, 0) / G.settlements.length : 60;
        const farms = G.blds.filter((b) => !b.dead && (b.type === 'farm' || b.type === 'medical' || b.type === 'shelter')).length;
        return it.startPrice * (0.65 + (avgHappy / 100) * 0.65 + farms * 0.07);
      }
      case 'c_nexus': {
        let techCount = 0;
        for (const f of G.factions) { if (f.tech.has('drones')) techCount += 2; if (f.tech.has('robotics')) techCount += 2; if (f.tech.has('hypersonic')) techCount += 1; }
        const bots = G.units.filter((u) => !u.dead && (u.type === 'robosoldier' || u.type === 'mech' || u.type === 'recondrone' || u.type === 'kamikaze' || u.type === 'ucav')).length;
        return it.startPrice * (0.9 + techCount * 0.14 + bots * 0.045);
      }
    }
    return it.startPrice;
  },

  tick() {
    const M = this.ensure();
    M.t++;
    // Update prices and pay dividends every 3 seconds
    if (M.t % 3 !== 0) return;
    const f = fac(G.player);
    let divTotal = 0;
    for (const it of M.items) {
      const target = this.fundamental(it);
      const pull = (target - it.price) * 0.09;
      const noise = (Math.random() - 0.492) * it.price * 0.022;
      it.prevPrice = it.price;
      it.price = Math.max(5, Math.round((it.price + pull + noise) * 10) / 10);
      it.trend = it.price - it.prevPrice;
      it.hist.push(it.price);
      if (it.hist.length > 48) it.hist.shift();
      if (it.shares > 0 && f && f.alive) {
        // Yield scales if city is healthy or company is booming
        let yieldMod = 1;
        if (it.kind === 'city') {
          const s = G.settlements[it.settId];
          if (s) yieldMod = U.clamp((s.happy / 60) * s.infra * (s.danger > 40 ? 0.3 : 1), 0.2, 1.8);
        }
        const div = it.shares * it.price * (it.divRate / 20) * yieldMod;
        f.res.credits += div;
        divTotal += div;
      }
    }
    if (divTotal > 0) {
      M.lastDiv = divTotal;
      M.divPaid += divTotal;
    }
  },

  buy(id, qty) {
    const M = this.ensure(), it = M.items.find((x) => x.id === id), f = fac(G.player);
    if (!it || !f) return false;
    const cost = Math.round(it.price * qty);
    if (!f.unlimited && f.res.credits < cost) {
      if (qty > 1) {
        const maxQ = Math.floor(f.res.credits / it.price);
        if (maxQ >= 1) return this.buy(id, maxQ);
      }
      UI.msg('Not enough credits to buy ' + it.ticker, 'warn');
      return false;
    }
    if (!f.unlimited) f.res.credits -= cost;
    const totalCost = it.avgCost * it.shares + cost;
    it.shares += qty;
    it.avgCost = totalCost / it.shares;
    // Buying municipal bonds in a city boosts local cash, infrastructure materials & reputation
    if (it.kind === 'city') {
      const s = G.settlements[it.settId];
      if (s) {
        s.cash += cost * 0.35;
        s.stock.materials = Math.min(2000, s.stock.materials + qty * 2);
        Civ.blame(G.player, s, Math.min(4, qty * 0.18), Math.min(1, qty * 0.04));
      }
    }
    Bus.emit('sfx', 'cash');
    return true;
  },

  sell(id, qty) {
    const M = this.ensure(), it = M.items.find((x) => x.id === id), f = fac(G.player);
    if (!it || !f || it.shares <= 0) return false;
    qty = Math.min(qty, it.shares);
    const proceeds = Math.round(it.price * qty);
    const profit = proceeds - it.avgCost * qty;
    f.res.credits += proceeds;
    it.shares -= qty;
    if (it.shares <= 0) { it.shares = 0; it.avgCost = 0; }
    M.realized += profit;
    Bus.emit('sfx', 'cash');
    return true;
  },

  investCity(settId) {
    const M = this.ensure(), it = M.items.find((x) => x.kind === 'city' && x.settId === settId), f = fac(G.player);
    const s = G.settlements[settId];
    if (!it || !s || !f) return false;
    const cost = 500 + (it.devLevel || 0) * 250;
    if (!f.unlimited && f.res.credits < cost) { UI.msg('Needs ' + cost + ' credits for municipal development grant', 'warn'); return false; }
    if (!f.unlimited) f.res.credits -= cost;
    it.devLevel = (it.devLevel || 0) + 1;
    s.happy = Math.min(100, s.happy + 8);
    s.stock.materials = Math.min(2000, s.stock.materials + 120);
    s.stock.food = Math.min(2000, s.stock.food + 100);
    Civ.blame(G.player, s, 10, 2.5);
    it.price = Math.round((it.price * 1.06) * 10) / 10;
    UI.msg('Civic development grant boosted ' + s.name + ' (' + it.ticker + ')', 'good', s.x, s.y);
    Bus.emit('sfx', 'cash');
    return true;
  },

  portfolioValue() {
    const M = this.ensure();
    let v = 0, cost = 0;
    for (const it of M.items) if (it.shares > 0) { v += it.shares * it.price; cost += it.shares * it.avgCost; }
    return { val: Math.round(v), cost: Math.round(cost), pnl: Math.round(v - cost) };
  },
};
