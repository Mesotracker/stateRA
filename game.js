'use strict';
/* =====================================================================
   CITY.RA — game.js
   Clock (day/night), weather, game setup for every mode, objectives,
   main loop with fixed-step simulation, save/load.
   ===================================================================== */

const Clock = {
  update(dt) { G.hour += (dt * 24) / (G.cfg.dayLen || 720); if (G.hour >= 24) { G.hour -= 24; G.day++; } },
  hourF() { return G.hour; },
  night() { return G.hour < 5.5 || G.hour > 20.5; },
  darkness() { const h = G.hour; if (h >= 7 && h <= 18.5) return 0; if (h > 18.5 && h < 21.5) return (h - 18.5) / 3; if (h >= 4 && h < 7) return 1 - (h - 4) / 3; return 1; },
  dusk() { const h = G.hour; const a = Math.max(0, 1 - Math.abs(h - 19) / 1.6), b = Math.max(0, 1 - Math.abs(h - 6.2) / 1.4); return Math.max(a, b); },
  label() { const h = Math.floor(G.hour), m = Math.floor((G.hour - h) * 60); return 'Day ' + (G.day + 1) + '  ' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; },
};

const WEATHER = {
  summer: [['clear', 5], ['overcast', 2], ['rain', 2], ['storm', 1], ['fog', 1]],
  autumn: [['clear', 3], ['overcast', 3], ['rain', 3], ['storm', 1], ['fog', 2]],
  winter: [['clear', 3], ['overcast', 3], ['snow', 4], ['fog', 1]],
  dry: [['clear', 6], ['overcast', 1], ['sand', 2]],
};
const WEATHER_LABEL = { clear: 'Clear', overcast: 'Overcast', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog', snow: 'Snow', sand: 'Sandstorm' };
const Weather = {
  update(dt) {
    const w = G.weather; w.t -= dt;
    if (w.next) { w.k -= dt / 8; if (w.k <= 0) { w.type = w.next; w.next = null; w.k = 0; } }
    else if (w.type !== 'clear') w.k = Math.min(1, w.k + dt / 10);
    if (w.t <= 0 && G.cfg.weather !== false) {
      w.t = 160 + Math.random() * 200;
      const list = WEATHER[G.map.type === 'desert' ? 'dry' : G.map.season] || WEATHER.summer;
      let tot = list.reduce((s, x) => s + x[1], 0), r = Math.random() * tot, pick = 'clear';
      for (const [k, n] of list) { r -= n; if (r <= 0) { pick = k; break; } }
      if (pick !== w.type) { if (w.type === 'clear') { w.type = pick; w.k = 0; } else w.next = pick; Bus.emit('msg', 'Weather: ' + WEATHER_LABEL[pick] + (pick === 'storm' || pick === 'fog' || pick === 'sand' ? ' — visibility reduced' : pick === 'snow' ? ' — wheeled vehicles slowed' : ''), 'info'); }
    }
    w.flash = Math.max(0, (w.flash || 0) - dt * 2);
    if (w.type === 'storm' && w.k > 0.5 && Math.random() < dt * 0.08) { w.flash = 0.5; setTimeout(() => Bus.emit('sfx', 'thunder'), 400); }
  },
};

/* ---------------- modes ---------------- */
const MODES = {
  skirmish:     { name: 'Skirmish', desc: 'Build a base and defeat every hostile faction.' },
  conquest:     { name: 'Territorial conquest', desc: 'Hold 60% of control points (towns, oil, towers, airport, harbour) for two minutes.' },
  survival:     { name: 'Survival', desc: 'Hold out against ten escalating assault waves from the map edges.' },
  defensive:    { name: 'Defensive operation', desc: 'Your fortified base must survive 15 minutes against a superior attacker.' },
  peacekeeping: { name: 'Peacekeeping', desc: 'Two factions are at war around neutral towns. Keep civilian casualties under 60, keep reputation positive, and broker a ceasefire or keep the peace for 20 minutes.' },
  evacuation:   { name: 'Urban evacuation', desc: 'An enemy offensive is shelling the city. Evacuate 300 civilians into refugee shelters.' },
  resource:     { name: 'Resource competition', desc: 'First faction to stockpile 30,000 credits, or hold four oil derricks for three minutes, wins.' },
  reconstruction:{ name: 'Reconstruction', desc: 'The war is over but the region lies in ruins. Restore infrastructure above 85% and average happiness above 55.' },
  sandbox:      { name: 'Sandbox', desc: 'Unlimited resources, every technology, instant building and training, build anywhere. No objectives.' },
};
const CAMPAIGN = [
  { title: '1 · Valley landing', brief: 'Meridian forces have landed in the Orlov river valley. Establish a base, secure the crossing, and destroy the Iron Steppe forward outpost.', o: { mode: 'skirmish', type: 'river', size: 'small', season: 'summer', seed: 4111, player: 'meridian', ais: [{ key: 'steppe', diff: 'easy' }] } },
  { title: '2 · Smoke over Halden', brief: 'Steppe artillery is moving on the city. Build refugee shelters on your side of the line and get 300 civilians out before the bombardment levels the centre.', o: { mode: 'evacuation', type: 'continental', size: 'medium', season: 'autumn', seed: 7702, player: 'meridian', ais: [{ key: 'steppe', diff: 'normal' }] } },
  { title: '3 · Blue helmets', brief: 'The League and the Directorate are fighting over the coastal towns. You are the peacekeeping force. Protect civilians and get both sides to a ceasefire.', o: { mode: 'peacekeeping', type: 'coastal', size: 'medium', season: 'summer', seed: 9931, player: 'highland', ais: [{ key: 'league', diff: 'normal' }, { key: 'steppe', diff: 'normal' }] } },
  { title: '4 · Winter line', brief: 'The Directorate has committed its reserves. Hold the highland pass for fifteen minutes until relief arrives.', o: { mode: 'defensive', type: 'highlands', size: 'medium', season: 'winter', seed: 5150, player: 'meridian', ais: [{ key: 'steppe', diff: 'hard' }] } },
  { title: '5 · Rebuilding Kessel', brief: 'The guns are silent. Restore power, water and housing across the region and win back the people.', o: { mode: 'reconstruction', type: 'continental', size: 'medium', season: 'summer', seed: 3030, player: 'highland', ais: [{ key: 'league', diff: 'easy' }] } },
];

const Game = {
  STEP: 1 / 30, acc: 0, timers: {}, opts: null,

  defaults() { return { geo: { lat: 49.5, lon: 8, span: 4, lspan: 6.2, preset: '4' }, mode: 'skirmish', type: 'continental', size: 'medium', season: 'summer', seed: (Math.random() * 1e9) | 0, player: 'meridian', ais: [{ key: 'steppe', diff: 'normal' }], stance: 'ffa', fog: true, dayLen: 720, start: 'standard', weather: true }; },

  start(opts) {
    opts = Object.assign(this.defaults(), opts); this.opts = opts;
    G.cfg = Object.assign(G.cfg, { fog: opts.fog !== false && opts.mode !== 'sandbox' ? true : opts.mode === 'sandbox' ? !!opts.fogSandbox : false, dayLen: opts.dayLen, weather: opts.weather, buildAnywhere: opts.mode === 'sandbox', instant: opts.mode === 'sandbox', lockDip: opts.mode === 'peacekeeping' ? false : false });
    const keys = [opts.player, ...opts.ais.map((a) => a.key)];
    G.wind = Math.random() * 6.283; G.nukes = 0; G.nukeKt = 0; G.nuclearWinter = false;
    const M = MapGen.generate({ size: MAP_SIZES[opts.size] || 144, type: opts.type, season: opts.season, seed: opts.seed, factions: keys.length, geo: opts.type === 'earth' ? opts.geo : null, playerStart: opts.playerStart || null });
    World.reset(M);
    G.factions = keys.map((k, i) => Eco.makeFaction(i, k, { player: i === 0, unlimited: opts.mode === 'sandbox' && i === 0, team: i === 0 ? 0 : opts.stance === 'teams' ? 1 : i, start: this.startRes(opts, i) }));
    G.player = 0;
    G.day = 0; G.hour = opts.mode === 'evacuation' ? 7.5 : 9; G.weather = { type: opts.season === 'winter' ? 'overcast' : 'clear', k: 0.5, t: 140 }; G.stats = { civCas: 0, civInj: 0, cause: {}, evacuated: 0, treated: 0 };
    Dip.init(keys.length, opts.mode === 'peacekeeping' ? 'peace' : opts.stance);
    World.populate(M); Strike.reset();
    Vis.init(M, keys.length);
    Render.setMap(M);
    Civ.init(M);
    Market.init();
    for (const f of G.factions) this.setupBase(f, M.starts[f.id], opts);
    for (const f of G.factions) if (f.isAI) AI.setup(f, opts.ais[f.id - 1].diff);
    if (opts.mode === 'sandbox') { const f = G.factions[0]; for (const k in TECH) f.tech.add(k); }
    Modes.setup(opts);
    const hq = G.blds.find((b) => b.owner === 0 && b.type === 'hq') || G.units.find((u) => u.owner === 0);
    if (hq) G.camTarget = { x: hq.x, y: hq.y };
    Vis.update(); G.paused = false; G.running = true; G.speed = 1; this.acc = 0; this.timers = { vis: 0, sec: 0, dip: 0, alive: 0, auto: 0 };
    Bus.emit('started');
  },
  startRes(opts, i) {
    const base = { credits: 6000, fuel: 400, materials: 450, food: 300, water: 300, metal: 250, supplies: 250 };
    if (opts.startRes === 'low') for (const k in base) base[k] = Math.round(base[k] * 0.5);
    if (opts.startRes === 'high') for (const k in base) base[k] = Math.round(base[k] * 2);
    if (opts.mode === 'defensive' && i > 0) base.credits *= 2;
    return base;
  },
  setupBase(f, s, opts) {
    if (!s) return;
    f.startX = (s.x + 0.5) * TILE; f.startY = (s.y + 0.5) * TILE;
    if (opts.mode === 'survival' && f.isAI) { f.noElim = true; return; } // wave spawner has no base
    const put = (type, dx, dy) => { const d = BLDS[type]; for (let r = 0; r < 6; r++) for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) { const tx = s.x + dx + ox - Math.floor(d.w / 2), ty = s.y + dy + oy - Math.floor(d.h / 2); const save = G.cfg.buildAnywhere; G.cfg.buildAnywhere = true; const ok = World.canPlace(type, f.id, tx, ty).ok; G.cfg.buildAnywhere = save; if (ok) return World.addBld(type, f.id, tx, ty, { instant: true }); } return null; };
    const hq = put('hq', 0, 0);
    const extra = opts.start === 'light' ? [] : [['power', -5, -2], ['refinery', 5, -2], ['barracks', -5, 3]];
    if (opts.mode === 'defensive' && f.isPlayer) extra.push(['power', -4, -6], ['factory', 5, 4], ['turret', 0, 6], ['turret', 3, 7], ['turret', -3, 7], ['bunker', 0, -6], ['sam', 8, 0], ['repair', 0, 9], ['medical', -8, 6]);
    if (opts.mode === 'evacuation' && f.isPlayer) extra.push(['shelter', 0, 6]);
    for (const [t, dx, dy] of extra) { const b = put(t, dx, dy); if (b && t === 'refinery') { const dock = Abil.refDock(b, { id: G.nextId, d: UNITS.harvester }); World.spawnUnit('harvester', f.id, dock.x, dock.y); } }
    const sp = (type, n) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = 3.2 + Math.random() * 2; const x = (s.x + 0.5 + Math.cos(a) * r) * TILE, y = (s.y + 4.5 + Math.sin(a) * r * 0.5) * TILE; if (Path.passable(UNITS[type].mc, (x / TILE) | 0, (y / TILE) | 0)) World.spawnUnit(type, f.id, x, y); } };
    sp('rifle', 4); sp('engineer', 1); sp('jeep', 1); sp('mbt', 1);
    if (opts.mode === 'defensive') { if (f.isPlayer) { sp('mbt', 3); sp('at', 3); sp('mg', 2); } else { sp('mbt', 5); sp('rifle', 6); } }
  },

  loop(ts) {
    const now = ts / 1000, dt = Math.min(0.25, now - (this.lastT || now)); this.lastT = now;
    if (G.running && !G.paused) {
      this.acc += dt * G.speed; let n = 0;
      while (this.acc >= this.STEP && n < 8) { this.sim(this.STEP); this.acc -= this.STEP; n++; }
      if (n >= 8) this.acc = 0;
    }
    if (G.running) { Render.frame(); UI.frame(dt); }
    requestAnimationFrame((t) => this.loop(t));
  },

  sim(dt) {
    G.time += dt;
    Clock.update(dt); Weather.update(dt);
    for (const f of G.factions) if (f.alive) Eco.updateQueues(f, dt);
    World.update(dt);
    Strike.update(dt);
    Civ.update(dt);
    FX.update(dt);
    Path.process(4);
    const T = this.timers;
    if ((T.vis += dt) >= 0.25) { T.vis = 0; Vis.update(); }
    if ((T.sec += dt) >= 1) {
      T.sec = 0; Eco.tick(); Civ.tick();
      for (const f of G.factions) if (f.isAI) AI.tick(f);
      Modes.tick(); Objectives.check();
    }
    if ((T.dip += dt) >= 10) { T.dip = 0; Dip.tick(); }
    if ((T.alive += dt) >= 2) { T.alive = 0; Eco.checkAlive(); }
    if ((T.auto += dt) >= 180) { T.auto = 0; SaveLoad.save('auto'); }
  },
};

/* ---------------- objectives ---------------- */
const Objectives = {
  list: [], over: false,
  set(list) { this.list = list.map((o) => Object.assign({ state: null }, o)); this.over = false; },
  check() {
    if (this.over || !G.running) return;
    if (!fac(G.player).alive) return this.end(false, 'Your forces have been eliminated.');
    for (const o of this.list) { if (o.state) continue; const r = o.check(); if (r === 'done') { o.state = 'done'; Bus.emit('msg', 'Objective complete: ' + o.text, 'good'); } else if (r === 'fail') { o.state = 'fail'; return this.end(false, 'Objective failed: ' + o.text); } }
    const prim = this.list.filter((o) => !o.optional);
    if (prim.length && prim.every((o) => o.state === 'done')) this.end(true, 'All objectives complete.');
  },
  end(win, why) { this.over = true; Bus.emit('gameover', win, why); },
};

const ctrlPoints = () => G.civb.filter((c) => !c.rubble && (c.type === 'derrick' || c.type === 'commtower' || c.type === 'airport' || c.type === 'port')).length + G.settlements.length;
const Modes = {
  setup(o, restoring) {
    const P = G.player, enemies = () => G.factions.filter((f) => f.id !== P && hostile(P, f.id));
    const rivals = () => G.factions.filter((f) => f.id !== P && f.alive && G.dip[P][f.id].stance !== 'alliance');
    const destroyAll = { text: 'Defeat every rival faction (allies excepted)', check: () => (rivals().length === 0 ? 'done' : null), prog: () => rivals().length + ' rival factions remain' };
    const S = this.s = { t: 0, wave: 0, hold: 0 };
    switch (o.mode) {
      case 'sandbox': Objectives.set([]); for (const f of G.factions) if (f.isAI && !o.sandboxAI) f.ai && (f.ai.passive = true); break;
      case 'conquest': Objectives.set([{ text: 'Hold 60% of control points for 2 minutes', check: () => { const own = this.ownedPoints(P), tot = ctrlPoints(); if (own / tot >= 0.6) S.hold++; else S.hold = 0; return S.hold >= 120 ? 'done' : null; }, prog: () => this.ownedPoints(P) + ' / ' + ctrlPoints() + ' points held' + (S.hold ? ' · ' + U.time(120 - S.hold) + ' left' : '') }, Object.assign({ optional: true }, destroyAll)]);
        break;
      case 'survival': Objectives.set([{ text: 'Survive 10 assault waves', check: () => (S.wave >= 10 && !G.units.some((u) => u.owner !== P && hostile(P, u.owner) && u.wave)) ? 'done' : null, prog: () => 'Wave ' + S.wave + ' / 10 · next in ' + U.time(Math.max(0, S.next - G.time)) }]); S.next = 120; break;
      case 'defensive': Objectives.set([{ text: 'Keep your Headquarters standing for 15 minutes', check: () => (!G.blds.some((b) => b.owner === P && b.type === 'hq') ? 'fail' : G.time >= 900 ? 'done' : null), prog: () => U.time(Math.max(0, 900 - G.time)) + ' until relief' }]);
        for (const f of G.factions) if (f.ai) { f.ai.nextAttack = 90; f.ai.D = Object.assign({}, f.ai.D, { wave: 120, size: 6 }); } break;
      case 'peacekeeping':
        if (!restoring) Dip.set(1, 2, 'war', true);
        Objectives.set([
          { text: 'Keep civilian casualties under 60', check: () => (G.stats.civCas >= 60 ? 'fail' : null), prog: () => G.stats.civCas + ' killed, ' + (G.stats.civInj || 0) + ' injured' },
          { text: 'Keep your reputation above zero', check: () => (G.time > 60 && fac(P).rep < 0 ? 'fail' : null), prog: () => 'Reputation ' + fac(P).rep.toFixed(0) },
          { text: 'Broker a ceasefire between the warring sides, or keep the peace for 20 minutes', check: () => (G.dip[1][2].stance !== 'war' || G.time >= 1200 ? 'done' : null), prog: () => STANCE_LABEL[G.dip[1][2].stance] + ' · ' + U.time(Math.max(0, 1200 - G.time)) },
        ]); break;
      case 'evacuation':
        Objectives.set([{ text: 'Evacuate 300 civilians to your refugee shelters', check: () => (fac(P).stats.evac >= 300 ? 'done' : null), prog: () => fac(P).stats.evac + ' / 300 evacuated' }, { text: 'Keep your Headquarters standing', check: () => (!G.blds.some((b) => b.owner === P && b.type === 'hq') ? 'fail' : null), prog: () => '' }]);
        S.city = G.settlements[0]; S.next = 60; if (!restoring) setTimeout(() => Bus.emit('msg', 'Select any building in ' + S.city.name + ' and press Evacuate to shelter', 'warn', S.city.x, S.city.y), 1500); break;
      case 'resource': Objectives.set([{ text: 'Stockpile 30,000 credits or hold 4 oil derricks for 3 minutes', check: () => { if (fac(P).res.credits >= 30000) return 'done'; const n = G.civb.filter((c) => c.type === 'derrick' && c.ctrl === P).length; S.hold = n >= 4 ? S.hold + 1 : 0; if (S.hold >= 180) return 'done'; for (const f of G.factions) if (f.id !== P && f.alive && f.res.credits >= 30000) return 'fail'; return null; }, prog: () => U.fmt(fac(P).res.credits) + ' credits · ' + G.civb.filter((c) => c.type === 'derrick' && c.ctrl === P).length + ' derricks' }]); break;
      case 'reconstruction':
        if (!restoring) for (const c of G.civb) { if (c.abandoned) continue; const r = Math.random(); if (r < 0.18) { c.hp = 0; c.rubble = true; } else if (r < 0.55) c.hp = c.maxHp * U.rnd(0.2, 0.7); }
        if (!restoring) { for (const b of G.bridges) if (Math.random() < 0.5) World.breakBridge(b, -1); for (const s of G.settlements) { s.happy = 30; s.pop *= 0.6; } }
        if (!restoring) for (let i = 0; i < 40; i++) { const t = U.pick(G.civb); Decals.add(t.x + U.rnd(-60, 60), t.y + U.rnd(-60, 60), U.rnd(10, 22)); }
        for (const f of G.factions) { f.res.materials = Math.max(f.res.materials, 600); if (f.ai) f.ai.passive = true; }
        if (G.factions[1]) Dip.set(0, 1, 'ceasefire', true);
        Objectives.set([{ text: 'Restore infrastructure above 85% across the region', check: () => (this.infra() >= 0.85 ? 'done' : null), prog: () => 'Infrastructure ' + Math.round(this.infra() * 100) + '%' }, { text: 'Raise average happiness above 55', check: () => (this.happy() >= 55 ? 'done' : null), prog: () => 'Happiness ' + Math.round(this.happy()) }]);
        break;
      default: Objectives.set([destroyAll]);
    }
  },
  ownedPoints(f) { return G.civb.filter((c) => !c.rubble && c.ctrl === f && (c.type === 'derrick' || c.type === 'commtower' || c.type === 'airport' || c.type === 'port')).length + G.settlements.filter((s) => s.ctrl === f).length; },
  infra() { const s = G.settlements; return s.length ? s.reduce((a, x) => a + x.infra, 0) / s.length : 1; },
  happy() { const s = G.settlements; return s.length ? s.reduce((a, x) => a + x.happy, 0) / s.length : 50; },
  tick() {
    const o = Game.opts, S = this.s; if (!o || !S) return;
    if (o.mode === 'survival' && G.time >= S.next && S.wave < 10) {
      S.wave++; S.next = G.time + 95;
      const f = G.factions[1], M = G.map, n = 4 + S.wave * 2;
      const pool = S.wave < 3 ? ['rifle', 'rifle', 'jeep', 'mg'] : S.wave < 6 ? ['rifle', 'at', 'mbt', 'ifv', 'mg', 'mlrs'] : ['mbt', 'heavy', 'ifv', 'at', 'mlrs', 'spg', 'aatruck'];
      const edge = U.rint(4);
      for (let i = 0; i < n; i++) {
        const t = U.pick(pool), d = UNITS[t]; let x, y;
        for (let k = 0; k < 30; k++) { const r = Math.random(); x = edge === 0 ? 2 : edge === 1 ? M.w - 3 : r * M.w; y = edge === 2 ? 2 : edge === 3 ? M.h - 3 : r * M.h; if (edge < 2) y = U.clamp(M.h / 2 + U.rnd(-12, 12), 2, M.h - 3); else x = U.clamp(M.w / 2 + U.rnd(-12, 12), 2, M.w - 3); if (Path.passable(d.mc, x | 0, y | 0)) break; }
        const u = World.spawnUnit(t, f.id, (x + 0.5) * TILE, (y + 0.5) * TILE); u.wave = S.wave;
        const hq = G.blds.find((b) => b.owner === G.player && b.type === 'hq') || G.blds.find((b) => b.owner === G.player);
        if (hq) World.moveTo(u, hq.x + U.rnd(-40, 40), hq.y + U.rnd(-40, 40), { am: true });
      }
      if (S.wave >= 5) for (let i = 0; i < Math.floor(S.wave / 3); i++) { const u = World.spawnUnit('gunship', f.id, edge === 1 ? M.w * TILE - 40 : 40, M.h * TILE / 2); const hq = G.blds.find((b) => b.owner === G.player); if (hq) Orders.attack([u], hq); u.wave = S.wave; }
      if (f.ai) f.ai.passive = true;
      Bus.emit('msg', 'Assault wave ' + S.wave + ' inbound from the ' + ['west', 'east', 'north', 'south'][edge], 'bad'); Bus.emit('sfx', 'alert');
    }
    if (o.mode === 'evacuation' && S.city) {
      if (G.time >= S.next) { S.next = G.time + U.rnd(10, 22); const c = G.ents.get(U.pick(S.city.blds)); const f = G.factions[1]; if (c && !c.rubble && f && f.alive) { for (let i = 0; i < 3; i++) Proj.spawn({ type: 'arc', x: f.startX, y: f.startY, tx: c.x + U.rnd(-40, 40), ty: c.y + U.rnd(-40, 40), spd: 400, dmg: 90, wh: 'he', splash: 46, owner: -1, src: 0 }); S.city.danger = Math.min(100, S.city.danger + 10); } }
    }
  },
};

/* ---------------- save / load ---------------- */
const SaveLoad = {
  serialize() {
    const M = G.map;
    const mapS = { w: M.w, h: M.h, seed: M.seed, type: M.type, season: M.season, terr: B64.enc(M.terr), hgt: B64.enc(M.hgt), road: B64.enc(M.road), rail: B64.enc(M.rail), ore: B64.enc(M.ore), res: B64.enc(M.res), tree: B64.enc(M.tree), block: B64.enc(M.block), cl: M.cl ? B64.enc(M.cl) : null, ctry: M.ctry ? B64.enc(M.ctry) : null, cinfo: M.cinfo || null, km: M.km || 0.5, geo: M.geo || null, craters: M.craters.slice(-1200), props: M.props, poles: M.poles, towns: M.towns, starts: M.starts, railPath: M.railPath || null, plan: { civb: [], bridges: [] } };
    const strip = (e) => { const o = {}; for (const k in e) { if (k === 'd' || k === 'path' || k === 'pathReq' || k === 'wl') continue; o[k] = e[k]; } return o; };
    return JSON.stringify({
      v: 1, opts: Game.opts, time: G.time, day: G.day, hour: G.hour, weather: G.weather, cam: G.cam, nextId: G.nextId, stats: G.stats, map: mapS,
      factions: G.factions.map((f) => ({ ...f, tech: [...f.tech], ai: f.ai ? { ...f.ai, squad: [...f.ai.squad] } : null })),
      dip: G.dip, settlements: G.settlements, market: G.market || null,
      units: G.units.filter((u) => !u.dead).map(strip), blds: G.blds.filter((b) => !b.dead).map(strip), civb: G.civb.map(strip), bridges: G.bridges.map(strip), wrecks: G.wrecks.map(strip),
      fall: Fall.save(), wind: G.wind, nukes: G.nukes || 0, nukeKt: G.nukeKt || 0, nuclearWinter: !!G.nuclearWinter,
      exp: Vis.exp.map((e) => B64.enc(e)), obj: Objectives.list.map((o) => o.state), modeS: Modes.s,
    });
  },
  save(slot) {
    try { const s = this.serialize(); const ok = Store.set('save:' + slot, { t: Date.now(), name: (MODES[Game.opts.mode] || {}).name + ' · ' + Clock.label(), data: s }); if (slot !== 'auto') Bus.emit('msg', ok ? 'Game saved' : 'Save failed — browser storage is unavailable or full', ok ? 'good' : 'bad'); return ok; }
    catch (e) { console.error(e); Bus.emit('msg', 'Save failed: ' + e.message, 'bad'); return false; }
  },
  slots() { return ['auto', '1', '2', '3'].map((k) => ({ k, s: Store.get('save:' + k, null) })); },
  load(slot) { const s = Store.get('save:' + slot, null); if (!s) return false; return this.restore(s.data); },
  restore(str) {
    const S = JSON.parse(str);
    const M = newMap(S.map.w, S.map.h);
    Object.assign(M, { seed: S.map.seed, type: S.map.type, season: S.map.season, craters: S.map.craters, props: S.map.props, poles: S.map.poles, towns: S.map.towns, starts: S.map.starts, railPath: S.map.railPath });
    M.terr = B64.dec(S.map.terr); M.hgt = B64.dec(S.map.hgt, Float32Array); M.road = B64.dec(S.map.road); M.rail = B64.dec(S.map.rail); M.ore = B64.dec(S.map.ore, Uint16Array); M.res = B64.dec(S.map.res); M.tree = B64.dec(S.map.tree); M.block = B64.dec(S.map.block); if (S.map.cl) M.cl = B64.dec(S.map.cl); if (S.map.ctry) M.ctry = B64.dec(S.map.ctry); M.cinfo = S.map.cinfo; M.km = S.map.km || 0.5; M.geo = S.map.geo;
    Game.opts = S.opts;
    G.cfg = Object.assign(G.cfg, { fog: S.opts.mode === 'sandbox' ? false : S.opts.fog !== false, dayLen: S.opts.dayLen, weather: S.opts.weather, buildAnywhere: S.opts.mode === 'sandbox', instant: S.opts.mode === 'sandbox' });
    World.reset(M); Strike.reset();
    G.wind = S.wind || 0; G.nukes = S.nukes || 0; G.nukeKt = S.nukeKt || 0; G.nuclearWinter = !!S.nuclearWinter;
    G.time = S.time; G.day = S.day; G.hour = S.hour; G.weather = S.weather; G.stats = S.stats;
    G.factions = S.factions.map((f) => ({ ...f, tech: new Set(f.tech), ai: f.ai ? { ...f.ai, squad: new Set(f.ai.squad) } : null }));
    G.dip = S.dip; G.player = 0; Fall.load(S.fall);
    const add = (e, list, d) => { e.d = d; G.ents.set(e.id, e); list.push(e); };
    for (const c of S.civb) { add(c, G.civb, CIVB[c.type]); for (let y = c.ty; y < c.ty + c.h; y++) for (let x = c.tx; x < c.tx + c.w; x++) M.occ[y * M.w + x] = c.id; }
    for (const b of S.blds) { add(b, G.blds, BLDS[b.type]); for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) M.occ[y * M.w + x] = b.id; }
    for (const b of S.bridges) add(b, G.bridges, { name: b.rail ? 'Rail bridge' : 'Road bridge' });
    for (const w of S.wrecks) { w.kind = 'wreck'; G.ents.set(w.id, w); G.wrecks.push(w); }
    for (const u of S.units) { add(u, G.units, UNITS[u.type]); u.path = null; u.pathReq = null; if (u.state === 'move' && u.ord) Path.request(u, u.ord.x, u.ord.y); }
    G.nextId = S.nextId;
    Path.rebuildComponents();
    Vis.init(M, G.factions.length); S.exp.forEach((e, i) => { Vis.exp[i] = B64.dec(e); });
    Render.setMap(M);
    RoadNet.init(M); G.settlements = S.settlements; G.civs = []; Civ.trainInit(M); Civ.spawnT = 0; Civ.tickN = 0;
    if (S.market) G.market = S.market; else Market.init();
    Modes.setup(S.opts, true); Modes.s = S.modeS || Modes.s; Objectives.list.forEach((o, i) => (o.state = S.obj[i] || null));
    G.cam = S.cam; G.sel = []; G.paused = false; G.running = true; Game.acc = 0; Game.timers = { vis: 0, sec: 0, dip: 0, alive: 0, auto: 0 };
    Vis.update(); Bus.emit('started'); Bus.emit('msg', 'Game loaded', 'good');
    return true;
  },
};
