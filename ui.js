'use strict';
/* =====================================================================
   CITY.RA — ui.js
   Command interface: input (mouse, keyboard, touch), camera, selection,
   contextual orders, build sidebar, selection/command panel, settlement
   panel, ticker, objectives, diplomacy, civil affairs, settings with
   rebindable keys, save/load, main menu and end screen.
   ===================================================================== */

const DEFAULT_KEYS = { attackMove: 'a', stop: 's', guard: 'g', patrol: 'q', scatter: 'x', formation: 'f', retreat: 'r', unload: 'u', fireAt: 't', rtb: 'b', pause: 'p', faster: '=', slower: '-', home: 'h', diplomacy: 'k', civil: 'c', market: 'm', objectives: 'o', selectArmy: 'e', repairMode: 'z', sellMode: 'v' };
const KEY_LABEL = { attackMove: 'Attack-move', stop: 'Stop', guard: 'Guard position', patrol: 'Patrol', scatter: 'Scatter', formation: 'Cycle formation', retreat: 'Retreat', unload: 'Unload transport', fireAt: 'Fire at ground', rtb: 'Return aircraft to base', pause: 'Pause', faster: 'Faster', slower: 'Slower', home: 'Jump to HQ', diplomacy: 'Diplomacy', civil: 'Civil affairs', market: 'Stock & city market', objectives: 'Objectives', selectArmy: 'Select all combat units', repairMode: 'Repair building mode', sellMode: 'Sell building mode' };
const $ = (id) => document.getElementById(id);

const UI = {
  keys: { ...DEFAULT_KEYS }, shift: false, ctrl: false, mouse: { x: 0, y: 0, wx: 0, wy: 0, in: false }, mouseTile: { x: 0, y: 0 },
  drag: null, pan: null, cmd: null, patrolPts: [], tab: 'base', lastClick: { t: 0, id: 0 }, msgs: [], uiT: 0, edge: true, held: {}, ghostWhy: '',

  init() {
    this.keys = Object.assign({ ...DEFAULT_KEYS }, Store.get('keys', {}));
    const st = Store.get('settings', {}); this.edge = st.edge !== false; Sound.setVol(st.vol == null ? 0.5 : st.vol); Sound.on = st.sound !== false; FX.quality = st.fx || 1;
    this.cv = $('view'); Render.init(this.cv); this.resize(); window.addEventListener('resize', () => this.resize());
    const cv = this.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mouseup', (e) => this.up(e));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.offsetX, e.offsetY); }, { passive: false });
    cv.addEventListener('mouseleave', () => (this.mouse.in = false)); cv.addEventListener('mouseenter', () => (this.mouse.in = true));
    cv.addEventListener('dblclick', (e) => this.dbl(e));
    this.touchInit(cv);
    window.addEventListener('keydown', (e) => this.key(e, true)); window.addEventListener('keyup', (e) => this.key(e, false));
    document.addEventListener('pointerdown', () => Sound.start(), { once: true });
    $('mini').addEventListener('mousedown', (e) => this.miniClick(e)); $('mini').addEventListener('mousemove', (e) => { if (e.buttons & 1) this.miniClick(e); });
    $('mini').addEventListener('contextmenu', (e) => { e.preventDefault(); this.miniClick(e, true); });
    Bus.on('msg', (t, k, x, y) => this.msg(t, k, x, y));
    Bus.on('proposal', (a, b, kind) => this.proposal(a, b, kind));
    Bus.on('gameover', (w, why) => this.gameOver(w, why));
    Bus.on('started', () => { $('menu').hidden = true; $('game').hidden = false; $('endscreen').hidden = true; this.buildTabs(); this.resize(); this.closeWins(); this.msgs = []; $('ticker').innerHTML = ''; if (G.camTarget) { this.centerOn(G.camTarget.x, G.camTarget.y); G.camTarget = null; } });
    Bus.on('attacked', (b) => { if (b.owner === G.player && G.time - (this.attackMsgT || -99) > 20) { this.attackMsgT = G.time; this.msg('Our base is under attack', 'bad', b.x, b.y); Bus.emit('sfx', 'alert'); } });
    Bus.on('unitLost', (u) => { const i = G.sel.indexOf(u); if (i >= 0) G.sel.splice(i, 1); });
    Bus.on('aiAttack', (f) => { this.msg('Radar: ' + f.short + ' assault force moving', 'warn'); });
    Bus.on('promoted', (u) => { if (u.owner === G.player) this.msg(u.d.name + ' promoted to ' + ['', 'veteran', 'elite', 'heroic'][u.vet], 'good', u.x, u.y); });
    this.wire(); Menu.init();
  },

  resize() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, r.width * dpr); this.cv.height = Math.max(1, r.height * dpr);
    const m = $('mini'); const mr = m.getBoundingClientRect(); m.width = Math.max(10, mr.width * dpr); m.height = Math.max(10, mr.height * dpr);
  },
  toWorld(sx, sy) { return { x: G.cam.x + sx / G.cam.z, y: G.cam.y + sy / G.cam.z }; },
  toScreen(wx, wy) { return { x: (wx - G.cam.x) * G.cam.z, y: (wy - G.cam.y) * G.cam.z }; },
  centerOn(x, y) { const v = Render.view(); G.cam.x = x - (v.x1 - v.x0) / 2; G.cam.y = y - (v.y1 - v.y0) / 2; this.clampCam(); },
  clampCam() { const M = G.map; if (!M) return; const v = Render.view(), w = v.x1 - v.x0, h = v.y1 - v.y0; G.cam.x = U.clamp(G.cam.x, -w * 0.3, M.w * TILE - w * 0.7); G.cam.y = U.clamp(G.cam.y, -h * 0.3, M.h * TILE - h * 0.7); },
  zoom(k, sx, sy) { const before = this.toWorld(sx, sy); G.cam.z = U.clamp(G.cam.z * k, 0.15, 2.4); const after = this.toWorld(sx, sy); G.cam.x += before.x - after.x; G.cam.y += before.y - after.y; this.clampCam(); },

  /* ---------------- input ---------------- */
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  placing() { const f = G.factions[G.player]; const it = f && f.q.bld[0]; return it && it.done && this.placeMode ? it.key : null; },
  down(e) {
    if (!G.running) return;
    const p = this.local(e), w = this.toWorld(p.x, p.y);
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) { this.pan = { sx: p.x, sy: p.y, cx: G.cam.x, cy: G.cam.y }; e.preventDefault(); return; }
    if (e.button === 2) { if (this.placing()) { this.placeMode = false; return; } if (this.cmd) { this.cmd = null; this.patrolPts = []; return; } this.rightDrag = { sx: p.x, sy: p.y, cx: G.cam.x, cy: G.cam.y, moved: false }; return; }
    if (e.button !== 0) return;
    const pl = this.placing();
    if (pl) {
      const d = BLDS[pl], tx = this.mouseTile.x - Math.floor(d.w / 2), ty = this.mouseTile.y - Math.floor(d.h / 2);
      const r = Eco.place(fac(G.player), tx, ty);
      if (r && r.ok) { if (!(BLDS[pl].repeat && e.shiftKey)) this.placeMode = false; else this.placeMode = true; } else this.msg(r && r.why ? r.why : 'Cannot place here', 'warn');
      return;
    }
    if (this.cmd) { this.useCmd(w, e); return; }
    this.drag = { sx: p.x, sy: p.y, x: p.x, y: p.y, on: false };
  },
  move(e) {
    const p = this.local(e); this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.in = e.target === this.cv;
    if (!G.map) return;
    const w = this.toWorld(p.x, p.y); this.mouse.wx = w.x; this.mouse.wy = w.y; this.mouseTile = { x: (w.x / TILE) | 0, y: (w.y / TILE) | 0 };
    if (this.pan) { G.cam.x = this.pan.cx - (p.x - this.pan.sx) / G.cam.z; G.cam.y = this.pan.cy - (p.y - this.pan.sy) / G.cam.z; this.clampCam(); }
    if (this.rightDrag) { const r = this.rightDrag; if (Math.hypot(p.x - r.sx, p.y - r.sy) > 8) r.moved = true; if (r.moved) { G.cam.x = r.cx - (p.x - r.sx) / G.cam.z; G.cam.y = r.cy - (p.y - r.sy) / G.cam.z; this.clampCam(); } }
    if (this.drag) { this.drag.x = p.x; this.drag.y = p.y; if (Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > 6) this.drag.on = true; }
    this.cursor();
  },
  up(e) {
    if (this.pan && (e.button === 1 || e.button === 0)) { this.pan = null; return; }
    if (e.button === 2 && this.rightDrag) { const r = this.rightDrag; this.rightDrag = null; if (!r.moved && G.running) this.rightClick(this.toWorld(r.sx, r.sy), e); return; }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag; this.drag = null;
    if (d.on) this.boxSelect(d, e.shiftKey); else this.clickSelect(this.toWorld(d.sx, d.sy), e.shiftKey);
  },
  dbl(e) {
    const p = this.local(e), w = this.toWorld(p.x, p.y), t = this.pick(w.x, w.y, true);
    if (!t || t.kind !== 'unit' || t.owner !== G.player) return;
    const v = Render.view();
    G.sel = G.units.filter((u) => u.owner === G.player && u.type === t.type && !u.inside && u.x > v.x0 && u.x < v.x1 && u.y > v.y0 && u.y < v.y1);
    this.refreshSel(true);
  },

  pick(wx, wy, unitsFirst) {
    const out = G.hash.query(wx, wy, 18, World.tmp2); let best = null, bd = 1e9;
    for (const e of out) {
      if (e.kind !== 'unit' || e.dead || e.inside) continue;
      const ey = e.d.cat === 'air' && e.alt > 0.3 ? e.y - e.alt * 26 : e.y;
      const d = Math.hypot(e.x - wx, ey - wy); if (d < e.rad + 6 && d < bd && Render.seen(e)) { bd = d; best = e; }
    }
    // also aircraft drawn above their position
    for (const u of G.units) if (u.d.cat === 'air' && u.alt > 0.3 && !u.dead) { const d = Math.hypot(u.x - wx, u.y - u.alt * 26 - wy); if (d < u.rad + 6 && d < bd && Render.seen(u)) { bd = d; best = u; } }
    if (best) return best;
    const M = G.map, tx = (wx / TILE) | 0, ty = (wy / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= M.w || ty >= M.h) return null;
    const o = M.occ[ty * M.w + tx];
    if (o) { const e = G.ents.get(o); if (e && (!G.cfg.fog || Vis.explored(G.player, e.x, e.y))) return e; }
    for (const w of G.wrecks) if (Math.hypot(w.x - wx, w.y - wy) < w.rad + 4) return w;
    for (const b of G.bridges) if (b.tiles.includes(ty * M.w + tx)) return b;
    return null;
  },
  clickSelect(w, add) {
    const t = this.pick(w.x, w.y, true);
    if (!t) { if (!add) G.sel = []; this.refreshSel(true); return; }
    if (add && t.kind === 'unit' && t.owner === G.player) { const i = G.sel.indexOf(t); if (i >= 0) G.sel.splice(i, 1); else G.sel.push(t); }
    else G.sel = [t];
    Bus.emit('sfx', 'click');
    this.refreshSel(true);
  },
  boxSelect(d, add) {
    const a = this.toWorld(Math.min(d.sx, d.x), Math.min(d.sy, d.y)), b = this.toWorld(Math.max(d.sx, d.x), Math.max(d.sy, d.y));
    const list = G.units.filter((u) => u.owner === G.player && !u.inside && !u.dead && u.x >= a.x && u.x <= b.x && (u.y >= a.y && u.y <= b.y || u.d.cat === 'air' && u.y - u.alt * 26 >= a.y && u.y - u.alt * 26 <= b.y));
    const combat = list.filter((u) => !(u.d.ab && u.d.ab.harvest));
    const sel = combat.length ? combat : list;
    G.sel = add ? [...new Set([...G.sel, ...sel])] : sel;
    this.refreshSel(true);
  },
  myUnits() { return G.sel.filter((e) => e.kind === 'unit' && e.owner === G.player && !e.dead); },

  rightClick(w, e) {
    const mine = this.myUnits();
    const sb = G.sel.length === 1 && G.sel[0].kind === 'bld' && G.sel[0].owner === G.player ? G.sel[0] : null;
    if (!mine.length) { if (sb && sb.d.prod) { sb.rally = { x: w.x, y: w.y }; this.msg('Rally point set', 'info'); } return; }
    const t = this.pick(w.x, w.y);
    const force = e.ctrlKey || e.metaKey;
    this.flash(w.x, w.y, t && t.kind !== 'wreck' && t.owner >= 0 && hostile(G.player, t.owner) ? '#f08070' : '#9fe0a8');
    if (force) { if (t && t.kind !== 'wreck' && t !== mine[0]) Orders.attack(mine, t); else Orders.fireAt(mine, w.x, w.y); return; }
    if (t) {
      const P = G.player;
      if ((t.kind === 'unit' || t.kind === 'bld') && hostile(P, t.owner)) {
        const demo = mine.filter((u) => u.d.ab && u.d.ab.demo && t.kind === 'bld');
        const eng = mine.filter((u) => u.d.ab && u.d.ab.capture && t.kind === 'bld' && t.hp < t.maxHp * 0.5);
        for (const u of demo) Orders.task(u, t, 'demo'); for (const u of eng) Orders.task(u, t, 'capture');
        const rest = mine.filter((u) => !demo.includes(u) && !eng.includes(u)); Orders.attack(rest, t); this.order(); return;
      }
      if (t.kind === 'unit' && t.owner === P && t.d.ab && t.d.ab.carry && !mine.includes(t)) { Orders.board(mine, t); this.order(); return; }
      if (t.kind === 'bld' && t.owner === P) {
        const harv = mine.filter((u) => u.d.ab && u.d.ab.harvest); if (harv.length && t.type === 'refinery') { for (const u of harv) { u.state = 'harvest'; u.hs = 'return'; } return; }
        const rep = mine.filter((u) => u.d.ab && u.d.ab.repair); if (rep.length && t.hp < t.maxHp) { for (const u of rep) Orders.task(u, t, 'repair'); this.order(); return; }
        if (t.type === 'hangar') { Orders.rtb(mine.filter((u) => u.d.cat === 'air')); }
      }
      if (t.kind === 'civb') {
        const eng = mine.filter((u) => u.d.ab && u.d.ab.capture), sup = mine.filter((u) => u.d.ab && u.d.ab.aid), rep = mine.filter((u) => u.d.ab && u.d.ab.repair);
        if (rep.length && (t.rubble || t.hp < t.maxHp)) { for (const u of rep) Orders.task(u, t, 'repair'); this.order(); return; }
        if (eng.length && t.d.cap && t.ctrl !== P) { Orders.task(eng[0], t, 'capture'); this.order(); return; }
        if (sup.length) { for (const u of sup) Orders.task(u, t, 'aid'); this.order(); return; }
      }
      if (t.kind === 'bridge') { const rep = mine.filter((u) => u.d.ab && u.d.ab.repair); if (rep.length && t.hp < t.maxHp) { for (const u of rep) Orders.task(u, t, 'repair'); this.order(); return; } }
      if (t.kind === 'wreck') { const cl = mine.filter((u) => u.d.ab && u.d.ab.clear); if (cl.length) { Orders.task(cl[0], t, 'clear'); this.order(); return; } }
      if (t.kind === 'bld' && t.owner >= 0 && t.owner !== P && !hostile(P, t.owner)) { const eng = mine.filter((u) => u.d.ab && u.d.ab.capture); if (eng.length) this.msg('Engineers can only capture hostile structures', 'info'); }
    }
    const M = G.map, ti = tileOf(w.x, w.y);
    const harv = mine.filter((u) => u.d.ab && u.d.ab.harvest);
    if (harv.length && M.ore[ti] > 20) { for (const u of harv) Orders.harvestAt(u, ti); }
    const rest = mine.filter((u) => !harv.includes(u) || M.ore[ti] <= 20);
    if (rest.length) Orders.move(rest, w.x, w.y, { queue: e.shiftKey, am: false });
    this.order();
  },
  order() { Bus.emit('sfx', 'click'); },
  flash(x, y, col) { this.flashes = this.flashes || []; this.flashes.push({ x, y, t: 0.5, col }); },

  setCmd(c) { if (!this.myUnits().length && c !== 'repairMode' && c !== 'sellMode') return; this.cmd = c; this.patrolPts = []; this.cursor(); },
  useCmd(w, e) {
    const c = this.cmd, mine = this.myUnits(), t = this.pick(w.x, w.y);
    if (c === 'launch') { const b = G.ents.get(this.launchSilo); if (!b || !b.load) { this.cmd = null; return; } if (Strike.launch(b, w.x, w.y)) { this.flash(w.x, w.y, '#ff6a4a'); this.cmd = null; this.buildSel(); } return; }
    if (c === 'attackMove') { Orders.move(mine, w.x, w.y, { am: true, queue: e.shiftKey }); this.flash(w.x, w.y, '#f08070'); }
    else if (c === 'fireAt') { if (t && t.kind !== 'wreck') Orders.attack(mine, t); else Orders.fireAt(mine, w.x, w.y); this.flash(w.x, w.y, '#f08070'); }
    else if (c === 'patrol') { this.patrolPts.push({ x: w.x, y: w.y }); if (!e.shiftKey) { Orders.patrol(mine, this.patrolPts); this.patrolPts = []; } else return; }
    else if (c === 'capture' || c === 'repair' || c === 'aid' || c === 'clear' || c === 'demo') {
      if (!t) { this.msg('Pick a target', 'info'); return; }
      const ab = { capture: 'capture', repair: 'repair', aid: 'aid', clear: 'clear', demo: 'demo' }[c];
      const us = mine.filter((u) => u.d.ab && u.d.ab[ab === 'clear' ? 'clear' : ab]);
      for (const u of us) Orders.task(u, t, ab);
    } else if (c === 'repairMode') { if (t && t.kind === 'bld' && t.owner === G.player) { t.repairing = !t.repairing; } if (!e.shiftKey) this.cmd = null; return; }
    else if (c === 'sellMode') { if (t && t.kind === 'bld' && t.owner === G.player) { Eco.sell(t); G.sel = G.sel.filter((x) => x !== t); } if (!e.shiftKey) this.cmd = null; return; }
    this.order();
    if (!e.shiftKey) this.cmd = null;
    this.cursor();
  },
  cursor() {
    const cv = this.cv; let c = 'default';
    if (this.cmd || this.placing()) c = 'crosshair';
    else if (this.myUnits().length && G.map) { const t = this.pick(this.mouse.wx, this.mouse.wy); if (t && t.owner >= 0 && t.kind !== 'wreck' && hostile(G.player, t.owner)) c = 'crosshair'; else if (t && t.kind === 'unit' && t.owner === G.player) c = 'pointer'; }
    if (cv.style.cursor !== c) cv.style.cursor = c;
  },

  key(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    this.shift = e.shiftKey; this.ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.held[k] = down;
    if (k === ' ') { this.spaceHeld = down; if (down) e.preventDefault(); }
    if (this.rebinding && down) { e.preventDefault(); this.keys[this.rebinding] = k; Store.set('keys', this.keys); this.rebinding = null; Settings.render(); return; }
    if (!down || !G.running) return;
    if (k === 'Escape') { if (this.cmd || this.placing()) { this.cmd = null; this.placeMode = false; } else if (document.querySelector('.win:not([hidden])')) this.closeWins(); else this.toggleWin('w-menu'); return; }
    if (/^[0-9]$/.test(k)) {
      const n = k;
      if (this.ctrl) { e.preventDefault(); G.groups[n] = this.myUnits().map((u) => u.id); this.msg('Group ' + n + ' assigned', 'info'); return; }
      const ids = G.groups[n] || []; const list = ids.map((id) => G.ents.get(id)).filter((u) => u && !u.dead && !u.inside);
      if (list.length) { const now = performance.now(); if (this.lastGroup === n && now - this.lastGroupT < 350) { const c = Orders.centroid(list); this.centerOn(c.x, c.y); } G.sel = list; this.refreshSel(true); this.lastGroup = n; this.lastGroupT = now; }
      return;
    }
    const K = this.keys, act = Object.keys(K).find((a) => K[a] === k);
    if (!act) return;
    e.preventDefault();
    const mine = this.myUnits();
    switch (act) {
      case 'attackMove': case 'fireAt': case 'patrol': this.setCmd(act); break;
      case 'stop': Orders.stop(mine); break;
      case 'guard': Orders.guard(mine); break;
      case 'scatter': Orders.scatter(mine); break;
      case 'formation': this.cycleFormation(); break;
      case 'retreat': Orders.retreat(mine); break;
      case 'unload': Orders.unload(mine); break;
      case 'rtb': Orders.rtb(mine); break;
      case 'pause': this.togglePause(); break;
      case 'faster': this.setSpeed(Math.min(4, G.speed * 2)); break;
      case 'slower': this.setSpeed(Math.max(0.5, G.speed / 2)); break;
      case 'home': { const hq = G.blds.find((b) => b.owner === G.player && b.type === 'hq'); if (hq) this.centerOn(hq.x, hq.y); break; }
      case 'diplomacy': this.toggleWin('w-dip'); break;
      case 'civil': this.toggleWin('w-civ'); break;
      case 'market': this.toggleWin('w-mkt'); break;
      case 'objectives': $('objectives').classList.toggle('collapsed'); break;
      case 'selectArmy': G.sel = G.units.filter((u) => u.owner === G.player && !u.inside && u.d.w.length && !(u.d.ab && u.d.ab.harvest)); this.refreshSel(true); break;
      case 'repairMode': this.cmd = this.cmd === 'repairMode' ? null : 'repairMode'; break;
      case 'sellMode': this.cmd = this.cmd === 'sellMode' ? null : 'sellMode'; break;
    }
  },
  cycleFormation() { const F = ['box', 'line', 'wedge', 'column']; Orders.formation = F[(F.indexOf(Orders.formation) + 1) % F.length]; this.msg('Formation: ' + Orders.formation, 'info'); this.refreshSel(true); },
  togglePause() { G.paused = !G.paused; $('btn-pause').textContent = G.paused ? 'Resume' : 'Pause'; $('pausebanner').hidden = !G.paused; },
  setSpeed(s) { G.speed = s; document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); },

  touchInit(cv) {
    let t0 = null, pinch = null;
    cv.addEventListener('touchstart', (e) => {
      Sound.start();
      if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: G.cam.z }; t0 = null; return; }
      const p = this.local(e.touches[0]); t0 = { sx: p.x, sy: p.y, cx: G.cam.x, cy: G.cam.y, t: performance.now(), moved: false };
      if (this.boxMode) this.drag = { sx: p.x, sy: p.y, x: p.x, y: p.y, on: false };
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (pinch && e.touches.length === 2) { const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), r = this.cv.getBoundingClientRect(); const mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top; this.zoom((pinch.z * d / pinch.d) / G.cam.z, mx, my); return; }
      if (!t0) return; const p = this.local(e.touches[0]);
      if (Math.hypot(p.x - t0.sx, p.y - t0.sy) > 10) t0.moved = true;
      if (this.boxMode && this.drag) { this.drag.x = p.x; this.drag.y = p.y; this.drag.on = t0.moved; return; }
      if (t0.moved) { G.cam.x = t0.cx - (p.x - t0.sx) / G.cam.z; G.cam.y = t0.cy - (p.y - t0.sy) / G.cam.z; this.clampCam(); }
    }, { passive: false });
    cv.addEventListener('touchend', (e) => {
      if (pinch && e.touches.length < 2) { pinch = null; return; }
      if (!t0) return; const t = t0; t0 = null;
      if (this.boxMode && this.drag) { const d = this.drag; this.drag = null; if (d.on) { this.boxSelect(d, false); return; } }
      if (t.moved) return;
      const w = this.toWorld(t.sx, t.sy);
      if (this.placing()) { const d = BLDS[this.placing()]; const r = Eco.place(fac(G.player), ((w.x / TILE) | 0) - Math.floor(d.w / 2), ((w.y / TILE) | 0) - Math.floor(d.h / 2)); if (r && r.ok) this.placeMode = false; else this.msg(r.why || 'Cannot place', 'warn'); return; }
      if (this.cmd) { this.useCmd(w, { shiftKey: false }); return; }
      const hit = this.pick(w.x, w.y);
      if (hit && hit.kind === 'unit' && hit.owner === G.player) { G.sel = [hit]; this.refreshSel(true); return; }
      if (this.myUnits().length) this.rightClick(w, { ctrlKey: false, shiftKey: false });
      else this.clickSelect(w, false);
    });
  },

  miniClick(e, right) {
    const m = $('mini'), r = m.getBoundingClientRect(), X = Render.miniXf; if (!X) return;
    const dpr = window.devicePixelRatio || 1, mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    const wx = ((mx - X.ox) / X.s) * TILE, wy = ((my - X.oy) / X.s) * TILE;
    if (right || e.button === 2) { const mine = this.myUnits(); if (mine.length) Orders.move(mine, wx, wy, { am: e.shiftKey }); return; }
    this.centerOn(wx, wy);
  },

  /* ---------------- per frame ---------------- */
  frame(dt) {
    if (!G.map) return;
    // camera keys and edge scroll
    const sp = 900 * dt / G.cam.z; let dx = 0, dy = 0;
    if (this.held.ArrowLeft) dx -= sp; if (this.held.ArrowRight) dx += sp; if (this.held.ArrowUp) dy -= sp; if (this.held.ArrowDown) dy += sp;
    if (this.edge && this.mouse.in && !this.drag && !this.pan && document.hasFocus()) { const v = Render.view(), m = this.mouse, E = 14; if (m.x < E) dx -= sp; if (m.x > v.W - E) dx += sp; if (m.y < E) dy -= sp; if (m.y > v.H - E) dy += sp; }
    if (dx || dy) { G.cam.x += dx; G.cam.y += dy; this.clampCam(); }
    if (this.flashes) for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].t -= dt; if (this.flashes[i].t <= 0) this.flashes.splice(i, 1); }
    this.uiT -= dt;
    if (this.uiT <= 0) { this.uiT = 0.25; this.updateTop(); this.updateSide(); this.refreshSel(false); Render.drawMinimap($('mini')); this.updateObjectives(); this.updateWins(); }
  },
  drawScreen(x, v) {
    if (this.drag && this.drag.on) { const d = this.drag; x.strokeStyle = '#9fe0a8'; x.lineWidth = 1; x.fillStyle = 'rgba(159,224,168,0.08)'; const X = Math.min(d.sx, d.x), Y = Math.min(d.sy, d.y), W = Math.abs(d.x - d.sx), H = Math.abs(d.y - d.sy); x.fillRect(X, Y, W, H); x.strokeRect(X + 0.5, Y + 0.5, W, H); }
    const label = this.cmd ? { attackMove: 'ATTACK-MOVE', fireAt: 'FIRE AT TARGET', patrol: 'PATROL · shift-click to add points', launch: 'SELECT STRIKE TARGET — inside the dashed range ring', capture: 'CAPTURE', repair: 'REPAIR', aid: 'DELIVER AID', clear: 'CLEAR WRECK', demo: 'PLANT CHARGE', repairMode: 'REPAIR MODE', sellMode: 'SELL MODE' }[this.cmd] : this.placing() ? (this.ghostWhy || 'PLACE ' + BLDS[this.placing()].name.toUpperCase()) : null;
    this.readout(x, v); this.scaleBar(x, v);
    if (label && this.mouse.in) { x.font = '600 11px "IBM Plex Mono", monospace'; const w = x.measureText(label).width + 12; x.fillStyle = 'rgba(10,14,16,0.8)'; x.fillRect(this.mouse.x + 14, this.mouse.y + 14, w, 18); x.fillStyle = this.ghostWhy && this.placing() ? '#f0a080' : '#e8d9a8'; x.fillText(label, this.mouse.x + 20, this.mouse.y + 27); }
  },
  readout(x, v) {
    const M = G.map; if (!M || !this.mouse.in) return;
    const tx = this.mouseTile.x, ty = this.mouseTile.y; if (tx < 0 || ty < 0 || tx >= M.w || ty >= M.h) return;
    const parts = [];
    if (M.ctry) { const c = M.ctry[ty * M.w + tx]; parts.push(c ? Earth.countryName(c) : 'International waters'); }
    if (M.geo && M.geo.lat1 != null) { const lat = M.geo.lat1 - ((ty + 0.5) / M.h) * (M.geo.lat1 - M.geo.lat0), lon = M.geo.lon0 + ((tx + 0.5) / M.w) * (M.geo.lon1 - M.geo.lon0); parts.push(Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(((lon + 540) % 360) - 180).toFixed(2) + '°' + (((lon + 540) % 360) - 180 >= 0 ? 'E' : 'W')); }
    const rd = Fall.at(this.mouse.wx, this.mouse.wy); if (rd > 0.02) parts.push('☢ radiation ' + Math.round(rd * 100) + '%');
    const s = G.settlements.find((q) => Math.hypot(q.tx - tx, q.ty - ty) < q.r + 1);
    if (s) { const t = G.map.towns[s.id]; parts.unshift(s.name + (t && t.real ? ' (pop. ' + (t.pop >= 1000 ? (t.pop / 1000).toFixed(1) + ' M' : t.pop + ' k') + ')' : '')); }
    if (!parts.length) return;
    const txt = parts.join('  ·  '); x.font = '600 11px "IBM Plex Mono", monospace'; const w = x.measureText(txt).width + 16, X = (v.W - 296 - w) / 2, Y = 54;
    x.fillStyle = 'rgba(10,14,16,0.72)'; x.fillRect(X, Y, w, 20); x.fillStyle = rd > 0.02 ? '#d8e870' : '#e8e2c8'; x.fillText(txt, X + 8, Y + 14);
  },
  scaleBar(x, v) {
    const L0 = (k, p) => k / p;
    const M = G.map; if (!M || !M.km) return;
    const kmPx = M.km / (TILE * G.cam.z); let km = 1; const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const n of nice) if (n / kmPx <= 160) km = n;
    const L = km / kmPx, X = v.W - 296 - 24 - L0(km, kmPx), Y = v.H - 22;
    x.strokeStyle = 'rgba(240,235,215,0.9)'; x.lineWidth = 2; x.beginPath(); x.moveTo(X, Y - 5); x.lineTo(X, Y); x.lineTo(X + L, Y); x.lineTo(X + L, Y - 5); x.stroke();
    x.font = '600 10px "IBM Plex Mono", monospace'; x.fillStyle = 'rgba(240,235,215,0.95)'; x.fillText((km < 1 ? km * 1000 + ' m' : km + ' km'), X + 4, Y - 8);
  },
  drawWorld(x) {
    if (this.flashes) for (const f of this.flashes) { x.strokeStyle = f.col; x.globalAlpha = f.t * 2; x.lineWidth = 1.5; x.beginPath(); x.arc(f.x, f.y, 12 * (1.2 - f.t), 0, 6.283); x.stroke(); x.globalAlpha = 1; }
    if (this.patrolPts.length) { x.setLineDash([4, 4]); x.strokeStyle = '#e8d9a8'; x.beginPath(); const m = this.myUnits()[0]; if (m) x.moveTo(m.x, m.y); for (const p of this.patrolPts) x.lineTo(p.x, p.y); x.stroke(); x.setLineDash([]); }
  },

  /* ---------------- top bar ---------------- */
  updateTop() {
    const f = fac(G.player); if (!f) return;
    const parts = RES_KEYS.map((k) => {
      const v = f.res[k], r = f.rates[k] || 0, short = f.lack[k], cap = f.cap[k];
      return `<div class="res ${short ? 'short' : ''}" data-tip="${RES_LABEL[k]}${cap < 1e8 ? ' · capacity ' + Math.round(cap) : ''} · ${r >= 0 ? '+' : ''}${Math.round(r)}/min"><span class="rk">${RES_LABEL[k]}</span><span class="rv">${U.fmt(v)}</span><span class="rr ${r < -1 ? 'neg' : r > 1 ? 'pos' : ''}">${r >= 0 ? '+' : ''}${U.fmt(r)}</span></div>`;
    });
    const pw = f.power, k = pw.use ? Math.min(1, pw.prod / Math.max(1, pw.use) / 1.5) : 1;
    parts.splice(1, 0, `<div class="res power ${f.lowPower ? 'short' : ''}" data-tip="Power produced ${pw.prod} · used ${pw.use}${f.lowPower ? ' · LOW POWER: production halved, defences offline' : ''}"><span class="rk">Power</span><span class="rv">${pw.prod - pw.use >= 0 ? '+' : ''}${pw.prod - pw.use}</span><span class="pbar"><i style="width:${Math.round(Math.min(1, pw.use / Math.max(1, pw.prod)) * 100)}%"></i></span></div>`);
    $('resbar').innerHTML = parts.join('');
    $('clock').textContent = Clock.label();
    $('wx').textContent = WEATHER_LABEL[G.weather.type] + ' · ' + (G.map.season[0].toUpperCase() + G.map.season.slice(1));
    $('rep').textContent = 'Reputation ' + (f.rep >= 0 ? '+' : '') + f.rep.toFixed(0);
    $('rep').className = 'chip ' + (f.rep < -15 ? 'bad' : f.rep > 15 ? 'good' : '');
  },

  /* ---------------- build sidebar ---------------- */
  TABS: [['base', 'Base'], ['eco', 'Economy'], ['def', 'Defence'], ['inf', 'Infantry'], ['veh', 'Vehicles'], ['air', 'Aircraft'], ['sea', 'Naval'], ['tech', 'Research']],
  buildTabs() {
    $('tabs').innerHTML = this.TABS.map(([k, n]) => `<button class="tab ${k === this.tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('');
    $('tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; this.buildTabs(); }));
    this.buildGrid();
  },
  items() {
    const f = fac(G.player), t = this.tab;
    if (t === 'base' || t === 'eco' || t === 'def') return BUILD_ORDER_UI[t].map((k) => ({ k, isUnit: false }));
    if (t === 'tech') return Object.keys(TECH).map((k) => ({ k, tech: true }));
    return Object.keys(UNITS).filter((k) => UNITS[k].cat === t && (!UNITS[k].faction || UNITS[k].faction === f.key)).map((k) => ({ k, isUnit: true }));
  },
  buildGrid() {
    const f = fac(G.player), grid = $('grid'); grid.innerHTML = '';
    for (const it of this.items()) {
      const b = U.el('button', 'bi'); b.dataset.k = it.k; b.dataset.unit = it.isUnit ? 1 : 0; b.dataset.tech = it.tech ? 1 : 0;
      const ic = SPR.icon(it.tech ? 'tech' : it.isUnit ? 'unit' : 'bld', it.k, f.key); const img = U.el('canvas'); img.width = 132; img.height = 96; img.getContext('2d').drawImage(ic, 0, 0);
      b.appendChild(img);
      const d = it.tech ? TECH[it.k] : it.isUnit ? UNITS[it.k] : BLDS[it.k];
      b.appendChild(U.el('span', 'bn', U.esc(d.name)));
      b.appendChild(U.el('span', 'bp')); b.appendChild(U.el('span', 'bq')); b.appendChild(U.el('span', 'bs'));
      b.onclick = () => this.gridClick(it);
      b.oncontextmenu = (e) => { e.preventDefault(); this.gridCancel(it); };
      b.onmouseenter = (e) => this.tipFor(it, b); b.onmouseleave = () => this.tip(null);
      grid.appendChild(b);
    }
    this.updateSide();
  },
  gridClick(it) {
    const f = fac(G.player);
    if (it.tech) { if (f.tech.has(it.k)) return; if (!Eco.has(f, 'lab')) return this.msg('Build a Research laboratory first', 'warn'); if (f.research) return this.msg('Research already in progress', 'info'); if ((TECH[it.k].req || []).some((k) => !f.tech.has(k))) return this.msg('Requires ' + TECH[it.k].req.map((k) => TECH[k].name).join(', '), 'warn'); if (!Eco.startResearch(f, it.k)) this.msg('Insufficient credits', 'warn'); return; }
    const lock = Eco.locked(f, it.k, it.isUnit); if (lock) return this.msg(lock, 'warn');
    if (!it.isUnit) {
      const q = f.q.bld; if (q[0] && q[0].key === it.k && q[0].done) { this.placeMode = true; return; }
      if (q.length && q[0].key !== it.k && !q[0].done) { if (q.length >= 6) return; }
    }
    const n = this.shift ? 5 : 1;
    for (let i = 0; i < n; i++) Eco.queue(f, it.k, it.isUnit);
    Bus.emit('sfx', 'click');
    this.updateSide();
  },
  gridCancel(it) {
    const f = fac(G.player), cat = it.isUnit ? UNITS[it.k].cat : 'bld', q = f.q[cat];
    for (let i = q.length - 1; i >= 0; i--) if (q[i].key === it.k) { if (i === 0 && q[0].done && !it.isUnit) { this.placeMode = false; } Eco.cancel(f, cat, i); break; }
    this.updateSide();
  },
  updateSide() {
    const f = fac(G.player); if (!f) return;
    $('facname').textContent = f.name; $('facname').style.color = f.color;
    const grid = $('grid');
    grid.querySelectorAll('.bi').forEach((b) => {
      const k = b.dataset.k, isUnit = b.dataset.unit === '1', tech = b.dataset.tech === '1';
      let lock = null, prog = 0, qn = 0, status = '';
      if (tech) { lock = !Eco.has(f, 'lab') ? 'lab' : (TECH[k].req || []).some((q) => !f.tech.has(q)) ? 'req' : null; if (f.tech.has(k)) status = 'DONE'; else if (f.research && f.research.key === k) { prog = f.research.t / f.research.T; status = Math.round(prog * 100) + '%'; } b.querySelector('.bq').textContent = ''; }
      else {
        lock = Eco.locked(f, k, isUnit);
        const cat = isUnit ? UNITS[k].cat : 'bld', q = f.q[cat];
        qn = q.filter((x) => x.key === k).length;
        if (q[0] && q[0].key === k) { prog = q[0].t / q[0].T; if (q[0].done) status = 'PLACE'; else if (q[0].waiting) status = 'FUNDS'; else if (q[0].hold) status = 'HOLD'; }
        b.querySelector('.bq').textContent = qn > 1 ? qn : '';
      }
      b.classList.toggle('locked', !!lock); b.classList.toggle('ready', status === 'PLACE'); b.classList.toggle('done', status === 'DONE');
      b.querySelector('.bp').style.setProperty('--p', prog);
      b.querySelector('.bp').style.display = prog > 0 && prog < 1 ? 'block' : 'none';
      b.querySelector('.bs').textContent = status;
    });
  },
  costStr(cost) { return Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) => `<b>${v}</b> ${RES_LABEL[k].toLowerCase()}`).join(' · '); },
  tipFor(it, el) {
    const f = fac(G.player);
    let html;
    if (it.tech) { const t = TECH[it.k]; html = `<h4>${U.esc(t.name)}</h4><p>${U.esc(t.desc)}</p><p class="c"><b>${t.cost}</b> credits · ${t.time}s</p>`; }
    else if (it.isUnit) {
      const d = UNITS[it.k], c = Eco.costOf(f, d, true), lock = Eco.locked(f, it.k, true);
      const ws = d.w.map((w) => WEAPONS[w].name).join(', ') || 'Unarmed';
      html = `<h4>${U.esc(d.name)}</h4><p class="c">${this.costStr(c)} · ${d.time}s</p><dl><dt>Armour</dt><dd>${d.armor}</dd><dt>Health</dt><dd>${d.hp}</dd><dt>Speed</dt><dd>${d.spd}</dd><dt>Sight</dt><dd>${d.sight}</dd><dt>Weapons</dt><dd>${U.esc(ws)}</dd></dl>${d.ab ? '<p>' + this.abText(d.ab) + '</p>' : ''}${lock ? '<p class="lk">' + U.esc(lock) + '</p>' : '<p class="hint">Click to queue · shift-click for 5 · right-click to cancel</p>'}`;
    } else {
      const d = BLDS[it.k], c = Eco.costOf(f, d, false), lock = Eco.locked(f, it.k, false);
      html = `<h4>${U.esc(d.name)}</h4><p class="c">${this.costStr(c)} · ${d.time}s · power ${d.pw > 0 ? '+' : ''}${d.pw}</p><p>${this.bldText(d)}</p>${lock ? '<p class="lk">' + U.esc(lock) + '</p>' : '<p class="hint">Click to build, click again when ready to place' + (d.repeat ? ' · shift-place to keep building' : '') + '</p>'}`;
    }
    this.tip(html, el);
  },
  abText(ab) { const o = []; if (ab.capture) o.push('Captures structures'); if (ab.repair) o.push('Repairs buildings and bridges'); if (ab.heal) o.push('Heals infantry and treats civilians'); if (ab.harvest) o.push('Harvests ore'); if (ab.carry) o.push('Carries ' + ab.carry + ' passengers'); if (ab.detect) o.push('Detects stealth units'); if (ab.stealth) o.push('Stealthed'); if (ab.submerge) o.push('Submerged until it fires'); if (ab.demo) o.push('Plants demolition charges'); if (ab.resupply) o.push('Resupplies ammunition'); if (ab.aid) o.push('Delivers humanitarian aid'); if (ab.fix) o.push('Field-repairs vehicles'); if (ab.clear) o.push('Clears wreckage'); if (ab.sonar) o.push('Sonar'); return o.join(' · '); },
  bldText(d) {
    const o = [];
    if (d.prod) o.push('Produces ' + { inf: 'infantry', veh: 'vehicles', air: 'aircraft', sea: 'ships' }[d.prod]);
    if (d.make) o.push('Makes ' + Object.entries(d.make).map(([k, v]) => v + ' ' + k + '/s').join(', '));
    if (d.store) o.push('Stores ' + Object.entries(d.store).map(([k, v]) => v + ' ' + k).join(', '));
    if (d.w_) o.push(WEAPONS[d.w_[0]].name);
    if (d.fixR) o.push('Repairs vehicles nearby'); if (d.healR) o.push('Heals infantry nearby'); if (d.supplyR) o.push('Resupplies units nearby');
    if (d.needs === 'metal') o.push('Must sit on a metal deposit'); if (d.coast) o.push('Must touch the shoreline'); if (d.nearWater) o.push('Needs water nearby');
    if (d.refuge) o.push('Houses ' + d.refuge + ' refugees'); if (d.convert) o.push('Converts credits into construction materials'); if (d.up) o.push('Upgrade: ' + d.up.name);
    if (d.cover) o.push('Infantry cover'); if (d.wall) o.push('Blocks movement');
    return o.join(' · ');
  },
  tip(html, el) {
    const t = $('tip'); if (!html) { t.hidden = true; return; }
    t.innerHTML = html; t.hidden = false;
    const r = el.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left - tw - 8; if (x < 8) x = Math.min(window.innerWidth - tw - 8, r.right + 8);
    t.style.left = x + 'px'; t.style.top = U.clamp(r.top, 8, window.innerHeight - th - 8) + 'px';
  },

  /* ---------------- selection panel ---------------- */
  refreshSel(force) {
    G.sel = G.sel.filter((e) => e && !e.dead && !(e.kind === 'unit' && e.inside));
    const key = G.sel.map((e) => e.id).join(',') + '|' + Orders.formation;
    const panel = $('selpanel');
    if (!G.sel.length) { panel.hidden = true; this.selKey = ''; return; }
    panel.hidden = false;
    if (force || key !== this.selKey) { this.selKey = key; this.buildSel(); }
    else this.liveSel();
  },
  buildSel() {
    const s = G.sel, e = s[0], P = G.player, body = $('selbody'), cmds = $('selcmds');
    cmds.innerHTML = '';
    const btn = (label, key, fn, cls) => { const b = U.el('button', 'cmd ' + (cls || ''), U.esc(label) + (key ? `<kbd>${U.esc(key.toUpperCase())}</kbd>` : '')); b.onclick = fn; cmds.appendChild(b); return b; };
    if (e.kind === 'unit') {
      const mine = this.myUnits();
      if (s.length === 1) body.innerHTML = this.unitCard(e);
      else {
        const counts = {}; for (const u of s) counts[u.type] = (counts[u.type] || 0) + 1;
        body.innerHTML = `<h3>${s.length} units selected</h3><div class="chips">${Object.entries(counts).map(([k, n]) => `<span class="chip">${n} × ${U.esc(UNITS[k].name)}</span>`).join('')}</div><div class="live"></div>`;
      }
      if (mine.length) {
        const K = this.keys;
        btn('Attack-move', K.attackMove, () => this.setCmd('attackMove'));
        btn('Stop', K.stop, () => Orders.stop(mine));
        btn('Guard', K.guard, () => Orders.guard(mine));
        btn('Patrol', K.patrol, () => this.setCmd('patrol'));
        btn('Fire at', K.fireAt, () => this.setCmd('fireAt'));
        btn('Scatter', K.scatter, () => Orders.scatter(mine));
        btn('Formation: ' + Orders.formation, K.formation, () => this.cycleFormation());
        btn('Retreat', K.retreat, () => Orders.retreat(mine));
        const has = (ab) => mine.some((u) => u.d.ab && u.d.ab[ab]);
        if (mine.some((u) => u.cargo.length)) btn('Unload', K.unload, () => Orders.unload(mine), 'hi');
        if (mine.some((u) => u.d.cat === 'air')) btn('Return to base', K.rtb, () => Orders.rtb(mine));
        if (has('capture')) btn('Capture', '', () => this.setCmd('capture'), 'hi');
        if (has('repair')) btn('Repair', '', () => this.setCmd('repair'), 'hi');
        if (has('aid')) btn('Deliver aid', '', () => this.setCmd('aid'), 'hi');
        if (has('clear')) btn('Clear wreck', '', () => this.setCmd('clear'), 'hi');
        if (has('demo')) btn('Plant charge', '', () => this.setCmd('demo'), 'hi');
      }
    } else if (e.kind === 'bld') {
      body.innerHTML = this.bldCard(e);
      if (e.owner === P) {
        const f = fac(P);
        btn(e.repairing ? 'Stop repair' : 'Repair', '', () => { e.repairing = !e.repairing; this.buildSel(); });
        if (e.d.up && e.level < 2 && !e.upg) btn('Upgrade: ' + e.d.up.name, '', () => { if (Eco.upgrade(e)) this.buildSel(); }, 'hi');
        if (e.d.prod) btn(f.primary[e.d.prod] === e.id ? 'Primary producer' : 'Make primary', '', () => { f.primary[e.d.prod] = e.id; this.buildSel(); });
        if (e.d.prod) btn('Rally: right-click map', '', () => {}, 'ghost');
        const sb = btn(this.sellArm === e.id ? 'Confirm sale' : 'Sell', '', () => { if (this.sellArm === e.id) { Eco.sell(e); G.sel = []; this.sellArm = 0; this.refreshSel(true); } else { this.sellArm = e.id; this.buildSel(); setTimeout(() => { this.sellArm = 0; }, 3000); } }, 'warn');
        if (e.type === 'lab') { this.tab = 'tech'; this.buildTabs(); }
        if (e.d.silo) {
          if (!e.load) for (const k of Object.keys(MISSILES)) { const M = MISSILES[k]; if (!Strike.unlocked(f, k)) continue; const b = btn('Arm ' + M.short, '', () => { const [ok, msg] = Strike.arm(e, k); if (!ok) this.msg(msg, 'warn'); this.buildSel(); }, M.nuke ? 'warn' : 'hi'); b.innerHTML = '<b>Arm ' + U.esc(M.short) + '</b> · ' + M.rangeKm.toLocaleString() + ' km<br><small>' + Object.entries(M.cost).map(([r, v]) => v + ' ' + r).join(', ') + '</small>'; b.title = M.desc; }
          else if (Strike.ready(e)) btn('LAUNCH ' + MISSILES[e.load.kind].short.toUpperCase() + ' — pick target', '', () => { this.launchSilo = e.id; this.cmd = 'launch'; }, 'warn');
        }
      }
    } else if (e.kind === 'civb') {
      body.innerHTML = this.civCard(e);
      const s2 = Civ.settOf(e), f = fac(P);
      if (s2) {
        btn('Invest in ' + s2.name, 'M', () => { Market.ensure(); G.market.sel = 'city_' + s2.id; G.market.filter = 'city'; this.toggleWin('w-mkt'); }, 'hi');
        btn(s2.evac ? 'Evacuation running' : 'Evacuate to shelter', '', () => { if (!s2.evac) Civ.startEvac(s2, P, false); this.buildSel(); }, 'hi');
        btn('Fund rebuilding · 200 materials', '', () => { if (f.res.materials < 200) return this.msg('Not enough construction materials', 'warn'); f.res.materials -= 200; s2.stock.materials += 200; Civ.blame(P, s2, 6, 1.5); this.msg('Rebuilding funded in ' + s2.name, 'good'); });
        btn('Airdrop aid · 150 supplies, 80 food', '', () => { if (!Eco.has(f, 'hangar')) return this.msg('Airdrops need an airfield', 'warn'); if (f.res.supplies < 150 || f.res.food < 80) return this.msg('Need 150 supplies and 80 food', 'warn'); f.res.supplies -= 150; f.res.food -= 80; Civ.aid(e, P, 1); });
        btn('Buy food · 300 credits', '', () => { if (s2.stock.food < 150) return this.msg(s2.name + ' has no food to sell', 'warn'); if (f.res.credits < 300) return this.msg('Not enough credits', 'warn'); if (s2.ctrl >= 0 && G.dip[s2.ctrl][P].sanction) return this.msg('Sanctions block this trade', 'warn'); f.res.credits -= 300; s2.cash += 300; s2.stock.food -= 150; f.res.food += 150; });
        btn('Buy materials · 400 credits', '', () => { if (s2.stock.materials < 150) return this.msg(s2.name + ' has no materials to sell', 'warn'); if (f.res.credits < 400) return this.msg('Not enough credits', 'warn'); f.res.credits -= 400; s2.cash += 400; s2.stock.materials -= 150; f.res.materials += 150; });
      }
    } else if (e.kind === 'bridge') {
      body.innerHTML = `<h3>${e.d.name}</h3><p class="sub">${e.broken ? 'Destroyed — engineers or engineering vehicles can rebuild it' : 'Intact'}</p>${this.hpRow(e)}`;
    } else if (e.kind === 'wreck') {
      body.innerHTML = `<h3>Wreckage</h3><p class="sub">${UNITS[e.type].name}. Blocks road traffic. Engineering vehicles and recovery trucks can clear it.</p>`;
    }
    this.liveSel();
  },
  hpRow(e) { const k = U.clamp(e.hp / e.maxHp, 0, 1); return `<div class="meter"><span>Integrity</span><i><b style="width:${k * 100}%;background:${k > 0.6 ? 'var(--good)' : k > 0.3 ? 'var(--warn)' : 'var(--bad)'}"></b></i><em>${Math.max(0, Math.round(e.hp))}/${Math.round(e.maxHp)}</em></div>`; },
  meter(label, k, txt, col) { k = U.clamp(k, 0, 1); return `<div class="meter"><span>${label}</span><i><b style="width:${k * 100}%;background:${col || (k > 0.6 ? 'var(--good)' : k > 0.3 ? 'var(--warn)' : 'var(--bad)')}"></b></i><em>${txt}</em></div>`; },
  unitCard(u) {
    const f = fac(u.owner), d = u.d;
    const state = u.inside ? 'Embarked' : { idle: 'Holding', move: u.ord && u.ord.am ? 'Attack-moving' : 'Moving', attack: 'Engaging', guard: 'Guarding', patrol: 'Patrolling', retreat: 'Retreating', harvest: 'Harvesting', task: u.ord ? { capture: 'Capturing', repair: 'Repairing', aid: 'Delivering aid', clear: 'Clearing wreck', demo: 'Planting charge' }[u.ord.t] : 'Working', board: 'Boarding', fireAt: 'Firing at position', docked: 'Docked, rearming', orbit: 'On station', strike: 'Strike run', rtb: 'Returning to base', fly: 'In flight', hover: 'Hovering', rearm: 'Rearming' }[u.state] || u.state;
    return `<h3 style="--fc:${f.color}">${U.esc(d.name)}</h3><p class="sub">${U.esc(f.name)} · ${['Recruit', 'Veteran', 'Elite', 'Heroic'][u.vet]} · <span class="st">${state}</span></p>
      <div class="live"></div>
      <p class="sub small">${U.esc(d.w.map((w) => WEAPONS[w].name).join(' · ') || 'Unarmed')}${d.ab ? ' · ' + this.abText(d.ab) : ''}</p>`;
  },
  bldCard(b) {
    const f = fac(b.owner), d = b.d;
    return `<h3 style="--fc:${f.color}">${U.esc(b.level > 1 && d.up ? d.up.name : d.name)}</h3><p class="sub">${U.esc(f.name)}${d.pw ? ' · power ' + (d.pw > 0 ? '+' + (b.type === 'power' && b.level > 1 ? 200 : d.pw) : d.pw) : ''}</p><div class="live"></div><p class="sub small">${this.bldText(d)}</p>`;
  },
  civCard(c) {
    const s = Civ.settOf(c), ctl = c.ctrl >= 0 ? fac(c.ctrl).name : null;
    let h = `<h3>${U.esc(c.d.name)}</h3><p class="sub">${c.rubble ? 'Rubble — engineers can rebuild' : c.abandoned ? 'Abandoned — engineers can restore it' : Civ.functional(c) ? 'Operational' : 'Out of service'}${c.burn > 0 ? ' · ON FIRE' : ''}${ctl ? ' · held by ' + U.esc(ctl) : c.d.cap ? ' · capturable: ' + CAPTURE_INFO[c.d.cap] : ''}</p><div class="live"></div>`;
    if (s) h += `<h4 class="sett">${U.esc(s.name)} <small>${s.kind}</small></h4>`;
    return h;
  },
  liveSel() {
    const e = G.sel[0], live = document.querySelector('#selbody .live'); if (!live || !e) return;
    if (e.kind === 'unit' && G.sel.length === 1) {
      let h = this.hpRow(e);
      if (e.d.ammo > 0) h += this.meter('Ammunition', e.ammo / e.d.ammo, Math.ceil(e.ammo) + '/' + e.d.ammo, '#d8b740');
      h += this.meter('Morale', e.morale / 100, Math.round(e.morale) + (e.supp > 45 ? ' · pinned' : ''), e.morale < 30 ? 'var(--bad)' : '#8fb4d8');
      if (e.d.ab && e.d.ab.harvest) h += this.meter('Ore load', e.harv / e.d.ab.harvest, Math.round(e.harv) + '/' + e.d.ab.harvest, '#d8b740');
      if (e.d.ab && e.d.ab.carry) h += this.meter('Cargo', e.cargo.length / e.d.ab.carry, e.cargo.length + '/' + e.d.ab.carry, '#a8b8c8');
      h += this.meter('Experience', e.vet >= 3 ? 1 : (e.xp - VET_XP[e.vet]) / (VET_XP[e.vet + 1] - VET_XP[e.vet]), Math.round(e.xp) + ' xp', '#f2d06b');
      live.innerHTML = h;
      const st = document.querySelector('#selbody .st'); if (st) st.textContent = st.textContent;
    } else if (e.kind === 'unit') {
      const hp = G.sel.reduce((s, u) => s + u.hp, 0), mx = G.sel.reduce((s, u) => s + u.maxHp, 0);
      live.innerHTML = this.meter('Group integrity', hp / mx, Math.round((hp / mx) * 100) + '%');
    } else if (e.kind === 'bld') {
      let h = this.hpRow(e);
      if (e.upg) h += this.meter('Upgrading', e.upg.t / e.upg.T, Math.round((e.upg.t / e.upg.T) * 100) + '%', '#d8b740');
      if (e.built < 1) h += this.meter('Construction', e.built, Math.round(e.built * 100) + '%', '#d8b740');
      if (e.docks) h += `<p class="sub">Docks ${e.docks.filter(Boolean).length} / ${e.docks.length}</p>`;
      if (e.load) h += this.meter(MISSILES[e.load.kind].short, e.load.t / e.load.T, e.load.t >= e.load.T ? 'ARMED' : Math.round((e.load.t / e.load.T) * 100) + '%', e.load.t >= e.load.T ? 'var(--bad)' : '#d8b740');
      if (e.d.silo && !e.load) { const f0 = fac(e.owner); h += '<p class="sub small">' + Object.keys(MISSILES).map((k) => { const M = MISSILES[k], rk = M.nuke ? Strike.radiiKm(M.yieldKt) : null; return Strike.unlocked(f0, k) ? '<b>' + U.esc(M.short) + '</b> ' + M.rangeKm.toLocaleString() + ' km' + (rk ? ' · ' + M.yieldKt + ' kt · severe damage ' + rk.mod.toFixed(1) + ' km · light ' + rk.light.toFixed(0) + ' km' : '') : '<span style="opacity:.5">' + U.esc(M.short) + ' — needs ' + U.esc(TECH[M.tech].name) + '</span>'; }).join('<br>') + '<br><i>Hover a button for details.</i></p>'; }
      if (e.type === 'shelter') h += this.meter('Refugees', (e.refugees || 0) / e.d.refuge, (e.refugees || 0) + ' / ' + e.d.refuge, '#8fb4d8');
      if (e.d.prod && e.owner === G.player) { const q = fac(G.player).q[e.d.prod]; h += `<p class="sub">Queue: ${q.length ? q.map((x) => UNITS[x.key].name).slice(0, 4).join(', ') + (q.length > 4 ? '…' : '') : 'empty'}</p>`; }
      live.innerHTML = h;
    } else if (e.kind === 'civb') {
      const s = Civ.settOf(e);
      let h = this.hpRow(e);
      if (s) {
        const rep = s.rep[G.player];
        h += `<div class="stats"><div><b>${U.num(Civ.showPop(s))}</b><span>population</span></div><div><b>${Math.round(s.happy)}</b><span>happiness</span></div><div><b>${Math.round(s.infra * 100)}%</b><span>infrastructure</span></div><div><b>${s.ctrl >= 0 ? fac(s.ctrl).short : '—'}</b><span>control</span></div></div>`;
        h += this.meter('Electricity', s.power, s.power >= 1 ? 'grid' : s.power > 0.5 ? 'local' : 'blackout');
        h += this.meter('Water', s.water, Math.round(s.water * 100) + '%');
        h += this.meter('Employment', s.emp, Math.round(s.emp * 100) + '%');
        h += this.meter('Danger', s.danger / 100, Math.round(s.danger), s.danger > 40 ? 'var(--bad)' : 'var(--warn)');
        h += this.meter('Your standing', (rep + 100) / 200, (rep >= 0 ? '+' : '') + Math.round(rep), rep < -20 ? 'var(--bad)' : rep > 20 ? 'var(--good)' : '#8fb4d8');
        h += `<p class="sub small">Services: health ${s.health} · fire ${s.fire} · police ${s.police} · schools ${s.edu} · transit ${s.transit}. Killed ${U.num(s.cas)} · injured ${U.num(s.inj)}.${s.evac ? ' Evacuating.' : ''}</p>`;
      }
      live.innerHTML = h;
    } else if (e.kind === 'bridge') live.innerHTML = '';
  },

  /* ---------------- ticker ---------------- */
  msg(text, kind = 'info', x, y) {
    const t = $('ticker'); if (!t) return;
    const el = U.el('div', 'tk ' + kind, U.esc(text)); if (x != null) { el.classList.add('loc'); el.onclick = () => this.centerOn(x, y); el.title = 'Show location'; }
    t.prepend(el); while (t.children.length > 6) t.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 9000); setTimeout(() => el.remove(), 10500);
    this.log = this.log || []; this.log.unshift({ t: G.time, text, kind }); if (this.log.length > 80) this.log.pop();
  },
  proposal(a, b, kind) {
    if (b !== G.player) return;
    const label = { ceasefire: 'proposes a ceasefire', peace: 'proposes ending hostilities', alliance: 'proposes an alliance', trade: 'proposes a trade agreement' }[kind];
    const el = U.el('div', 'proposal', `<p><b style="color:${fac(a).color}">${U.esc(fac(a).name)}</b> ${label}.</p><div><button class="cmd hi">Accept</button><button class="cmd">Decline</button></div>`);
    const [yes, no] = el.querySelectorAll('button');
    yes.onclick = () => { Dip.accept(a, b, kind); el.remove(); };
    no.onclick = () => { G.dip[a][b].opinion -= 5; el.remove(); };
    $('proposals').appendChild(el); setTimeout(() => el.remove(), 45000);
  },
  updateObjectives() {
    const ob = $('objlist'); if (!ob) return;
    ob.innerHTML = Objectives.list.length ? Objectives.list.map((o) => `<li class="${o.state || ''} ${o.optional ? 'opt' : ''}"><span>${U.esc(o.text)}</span><em>${U.esc(o.prog ? o.prog() : '')}</em></li>`).join('') : '<li><span>No objectives. Build freely.</span></li>';
  },

  /* ---------------- windows ---------------- */
  wire() {
    $('btn-pause').onclick = () => this.togglePause();
    document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => this.setSpeed(+b.dataset.speed)));
    document.querySelectorAll('[data-win]').forEach((b) => (b.onclick = () => this.toggleWin(b.dataset.win)));
    document.querySelectorAll('.win .x').forEach((b) => (b.onclick = () => this.closeWins()));
    $('objhead').onclick = () => $('objectives').classList.toggle('collapsed');
    $('sidetoggle').onclick = () => document.body.classList.toggle('side-open');
    $('boxmode').onclick = () => { this.boxMode = !this.boxMode; $('boxmode').classList.toggle('on', this.boxMode); };
    $('m-resume').onclick = () => this.closeWins();
    $('m-quit').onclick = () => { G.running = false; this.closeWins(); $('game').hidden = true; $('menu').hidden = false; Menu.show(); };
    $('m-help').onclick = () => this.toggleWin('w-help');
    $('m-settings').onclick = () => this.toggleWin('w-set');
    $('m-save').onclick = () => this.toggleWin('w-save');
  },
  closeWins() { document.querySelectorAll('.win').forEach((w) => (w.hidden = true)); },
  toggleWin(id) {
    const w = $(id); if (!w) return; const open = w.hidden; this.closeWins(); w.hidden = !open;
    if (open) { if (id === 'w-dip') Diplo.render(); if (id === 'w-civ') CivWin.render(); if (id === 'w-mkt') MarketWin.render(); if (id === 'w-set') Settings.render(); if (id === 'w-save') SaveWin.render(); if (id === 'w-help') Help.render(); }
  },
  updateWins() { if (!$('w-dip').hidden) Diplo.render(true); if (!$('w-civ').hidden) CivWin.render(); if ($('w-mkt') && !$('w-mkt').hidden) MarketWin.render(true); },

  gameOver(win, why) {
    const f = fac(G.player), st = f.stats, es = $('endscreen');
    es.hidden = false;
    es.innerHTML = `<div class="endcard ${win ? 'win' : 'lose'}"><p class="eyebrow">${U.esc(MODES[Game.opts.mode].name)} · ${Clock.label()}</p><h2>${win ? 'Operation successful' : 'Operation failed'}</h2><p>${U.esc(why)}</p>
      <table><tr><td>Enemy units destroyed</td><td>${st.kills}</td></tr><tr><td>Enemy structures destroyed</td><td>${st.bkills}</td></tr><tr><td>Units lost</td><td>${st.lost}</td></tr><tr><td>Structures lost</td><td>${st.blost}</td></tr><tr><td>Ore harvested</td><td>${U.fmt(st.harvested)}</td></tr><tr><td>Civilians killed by you</td><td>${U.num(f.civKills)}</td></tr><tr><td>Civilians injured by you</td><td>${U.num(f.civInjured || 0)}</td></tr><tr><td>Civilians killed, all sides</td><td>${U.num(G.stats.civCas)}</td></tr><tr><td>Civilians injured, all sides</td><td>${U.num(G.stats.civInj || 0)}</td></tr>${Civ.causeRows()}<tr><td>Civilians evacuated to your shelters</td><td>${st.evac}</td></tr><tr><td>Aid deliveries</td><td>${st.aid}</td></tr><tr><td>Final reputation</td><td>${f.rep.toFixed(0)}</td></tr></table>
      <div class="row"><button class="cmd" id="e-watch">Keep playing</button><button class="cmd hi" id="e-menu">Main menu</button>${Menu.campaignIdx != null && win && Menu.campaignIdx < CAMPAIGN.length - 1 ? '<button class="cmd hi" id="e-next">Next mission</button>' : ''}</div></div>`;
    $('e-watch').onclick = () => { es.hidden = true; };
    $('e-menu').onclick = () => { G.running = false; es.hidden = true; $('game').hidden = true; $('menu').hidden = false; Menu.show(); };
    const nx = $('e-next'); if (nx) nx.onclick = () => { es.hidden = true; Menu.campaign(Menu.campaignIdx + 1); };
    if (win && Menu.campaignIdx != null) Store.set('campaign', Math.max(Store.get('campaign', 0), Menu.campaignIdx + 1));
  },
};

/* ---------------- diplomacy window ---------------- */
const Diplo = {
  render(live) {
    const P = G.player, el = $('dipbody');
    if (live && el.matches(':hover')) return;
    el.innerHTML = G.factions.filter((f) => f.id !== P).map((f) => {
      const r = G.dip[P][f.id], their = G.dip[f.id][P], F = FACTIONS[f.key];
      const towns = G.settlements.filter((s) => s.ctrl === f.id).length;
      const acts = [];
      if (!f.alive) acts.push('<span class="sub">Defeated</span>');
      else {
        if (r.stance === 'war') acts.push(['ceasefire', 'Propose ceasefire']);
        if (r.stance === 'ceasefire') acts.push(['peace', 'Propose peace'], ['war', 'Resume war']);
        if (r.stance === 'neutral') acts.push(['alliance', 'Propose alliance'], ['war', 'Declare war']);
        if (r.stance === 'alliance') acts.push(['war', 'Break alliance and declare war']);
        if (r.stance !== 'war' && !r.trade) acts.push(['trade', 'Propose trade agreement']);
        if (r.trade) acts.push(['cancel', 'Cancel trade agreement']);
        acts.push(r.sanction ? ['lift', 'Lift sanctions'] : ['sanction', 'Impose sanctions']);
      }
      return `<div class="dip" style="--fc:${f.color}"><div class="dh"><h4>${U.esc(f.name)}</h4><span class="pill ${r.stance}">${STANCE_LABEL[r.stance] || r.stance}</span>${r.trade ? '<span class="pill trade">Trade</span>' : ''}${r.sanction ? '<span class="pill sanc">You sanction them</span>' : ''}${their.sanction ? '<span class="pill sanc">Sanctioning you</span>' : ''}</div>
        <p class="sub">${U.esc(F.doctrine)}</p><p class="sub small">${F.traits.map(U.esc).join(' · ')}</p>
        ${UI.meter('Opinion of you', (their.opinion + 100) / 200, (their.opinion >= 0 ? '+' : '') + Math.round(their.opinion), their.opinion < -20 ? 'var(--bad)' : their.opinion > 20 ? 'var(--good)' : '#8fb4d8')}
        <p class="sub small">Controls ${towns} settlement${towns === 1 ? '' : 's'} · reputation ${f.rep.toFixed(0)} · civilians killed by you ${U.num(f.civKills)}</p>
        <div class="row">${acts.map((a) => (Array.isArray(a) ? `<button class="cmd ${a[0] === 'war' ? 'warn' : ''}" data-f="${f.id}" data-k="${a[0]}">${a[1]}</button>` : a)).join('')}</div><p class="reply" id="reply-${f.id}">${U.esc(this.replies[f.id] || '')}</p></div>`;
    }).join('') + `<p class="sub small">Other factions judge you by your reputation. Civilian casualties and destroyed homes lower it; aid, evacuation, medical treatment and rebuilding raise it. Factions with humane doctrines weigh it most.</p>`;
    el.querySelectorAll('button[data-k]').forEach((b) => (b.onclick = () => { const [ok, text] = Dip.propose(P, +b.dataset.f, b.dataset.k); this.replies[+b.dataset.f] = (ok === true ? 'Accepted: ' : ok === false ? 'Declined: ' : '') + text; this.render(); }));
  },
  replies: {},
};
const CivWin = {
  render() {
    const P = G.player, el = $('civbody');
    if (el.matches(':hover') && el.dataset.ok) return; el.dataset.ok = 1;
    const shelters = G.blds.filter((b) => b.owner === P && b.type === 'shelter');
    el.innerHTML = `<div class="tablewrap"><table class="civt"><thead><tr><th>Settlement</th><th>Control</th><th>Pop.</th><th>Happy</th><th>Power</th><th>Water</th><th>Health</th><th>Infra.</th><th>Danger</th><th>Your standing</th><th>Killed</th><th>Injured</th></tr></thead><tbody>${G.settlements.map((s) => `<tr data-s="${s.id}"><td><b>${U.esc(s.name)}</b><small>${s.kind}${s.evac ? ' · evacuating' : ''}</small></td><td style="color:${s.ctrl >= 0 ? fac(s.ctrl).color : 'inherit'}">${s.ctrl >= 0 ? fac(s.ctrl).short : 'Neutral'}${s.contested ? ' ⚑' : ''}</td><td>${U.num(Civ.showPop(s))}<small>/${U.num(Civ.showMax(s))}</small></td><td class="${s.happy < 35 ? 'bad' : s.happy > 65 ? 'good' : ''}">${Math.round(s.happy)}</td><td class="${s.power < 0.5 ? 'bad' : ''}">${s.power >= 1 ? 'Grid' : s.power > 0.5 ? 'Local' : 'Blackout'}</td><td class="${s.water < 0.5 ? 'bad' : ''}">${Math.round(s.water * 100)}%</td><td>${s.health ? s.health : '<span class="bad">None</span>'}</td><td class="${s.infra < 0.6 ? 'bad' : ''}">${Math.round(s.infra * 100)}%</td><td class="${s.danger > 40 ? 'bad' : ''}">${Math.round(s.danger)}</td><td class="${s.rep[P] < -20 ? 'bad' : s.rep[P] > 20 ? 'good' : ''}">${s.rep[P] >= 0 ? '+' : ''}${Math.round(s.rep[P])}</td><td>${U.num(s.cas)}</td><td>${U.num(s.inj)}</td></tr>`).join('')}</tbody></table></div>
      <p class="sub small">Refugees in your shelters: ${shelters.reduce((a, b) => a + (b.refugees || 0), 0)} · civilians evacuated by you: ${fac(P).stats.evac} · total civilians killed: ${U.num(G.stats.civCas)}, injured: ${U.num(G.stats.civInj || 0)}. Click a row to view the town; select any civilian building for evacuation, aid, trade and rebuilding.</p>`;
    el.querySelectorAll('tr[data-s]').forEach((r) => (r.onclick = () => { const s = G.settlements[+r.dataset.s]; UI.centerOn(s.x, s.y); UI.closeWins(); }));
  },
};
const MarketWin = {
  spark(hist, up) {
    if (!hist || hist.length < 2) return '';
    const min = Math.min(...hist), max = Math.max(...hist), rng = Math.max(1, max - min);
    const W = 88, H = 22;
    const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / rng) * (H - 4)).toFixed(1)}`).join(' ');
    const col = up ? '#79c987' : '#e0644e';
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="vertical-align:middle"><polyline fill="none" stroke="${col}" stroke-width="1.6" points="${pts}"/></svg>`;
  },
  render(live) {
    const el = $('mktbody'); if (!el) return;
    if (live && el.matches(':hover') && el.dataset.ok) return;
    el.dataset.ok = 1;
    const M = Market.ensure(), f = fac(G.player), pf = Market.portfolioValue();
    const filt = M.filter || 'all';
    const items = M.items.filter((it) => filt === 'all' ? true : filt === 'held' ? it.shares > 0 : it.kind === filt);
    const sel = M.items.find((x) => x.id === M.sel) || items[0] || M.items[0];
    if (sel) M.sel = sel.id;
    let detailHtml = '';
    if (sel) {
      const chg = ((sel.price - sel.startPrice) / sel.startPrice) * 100;
      const posVal = Math.round(sel.shares * sel.price);
      const posPnl = Math.round(sel.shares * (sel.price - sel.avgCost));
      const s = sel.kind === 'city' ? G.settlements[sel.settId] : null;
      const devCost = s ? 500 + (sel.devLevel || 0) * 250 : 0;
      detailHtml = `<div class="dip" style="--fc:${chg >= 0 ? 'var(--good)' : 'var(--bad)'};margin-bottom:12px">
        <div class="dh"><h4>${U.esc(sel.name)} <small style="font-family:var(--mono);color:var(--accent2)">[${U.esc(sel.ticker)}]</small></h4>
          <span class="pill ${chg >= 0 ? 'alliance' : 'war'}">${sel.price.toFixed(1)} cr (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)</span>
          <span class="pill trade">Yield ${(sel.divRate * 100).toFixed(1)}%</span>
        </div>
        <p class="sub small">${U.esc(sel.desc)}</p>
        ${s ? `<p class="sub small">City status: Pop <b>${U.num(Civ.showPop(s))}</b> · Happiness <b>${Math.round(s.happy)}</b> · Infra <b>${Math.round(s.infra * 100)}%</b> · Power <b>${s.power >= 1 ? 'Grid' : s.power > 0.5 ? 'Local' : 'Out'}</b> · Dev grants <b>${sel.devLevel || 0}</b></p>` : ''}
        <p class="sub small">Your holding: <b>${sel.shares}</b> shares (value <b>${U.num(posVal)}</b> cr${sel.shares > 0 ? ` · avg ${sel.avgCost.toFixed(1)} · P&L <b class="${posPnl >= 0 ? 'good' : 'bad'}">${posPnl >= 0 ? '+' : ''}${U.num(posPnl)}</b> cr` : ''})</p>
        <div class="row">
          <button class="cmd hi" data-mbuy="${sel.id}" data-q="1">Buy 1 (${Math.round(sel.price)})</button>
          <button class="cmd hi" data-mbuy="${sel.id}" data-q="5">Buy 5 (${Math.round(sel.price * 5)})</button>
          <button class="cmd hi" data-mbuy="${sel.id}" data-q="25">Buy 25 (${Math.round(sel.price * 25)})</button>
          ${sel.shares > 0 ? `<button class="cmd warn" data-msell="${sel.id}" data-q="1">Sell 1</button><button class="cmd warn" data-msell="${sel.id}" data-q="5">Sell 5</button><button class="cmd warn" data-msell="${sel.id}" data-q="${sel.shares}">Sell all (${sel.shares})</button>` : ''}
          ${s ? `<button class="cmd" data-mdev="${sel.settId}">Civic development grant (${devCost} cr)</button><button class="cmd" data-mloc="${sel.settId}">View city</button>` : ''}
        </div>
      </div>`;
    }
    el.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:10px">
        <div><b>${U.fmt(f.res.credits)}</b><span>Available Credits</span></div>
        <div><b>${U.num(pf.val)}</b><span>Portfolio Value</span></div>
        <div><b style="color:${pf.pnl >= 0 ? 'var(--good)' : 'var(--bad)'}">${pf.pnl >= 0 ? '+' : ''}${U.num(pf.pnl)}</b><span>Unrealized P&amp;L</span></div>
        <div><b style="color:var(--good)">+${U.num(Math.round(M.divPaid))}</b><span>Dividends Earned</span></div>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="cmd ${filt === 'all' ? 'on' : ''}" data-mfilt="all">All (${M.items.length})</button>
        <button class="cmd ${filt === 'corp' ? 'on' : ''}" data-mfilt="corp">Companies (${M.items.filter((x) => x.kind === 'corp').length})</button>
        <button class="cmd ${filt === 'city' ? 'on' : ''}" data-mfilt="city">Cities &amp; Towns (${M.items.filter((x) => x.kind === 'city').length})</button>
        <button class="cmd ${filt === 'held' ? 'on' : ''}" data-mfilt="held">My Portfolio (${M.items.filter((x) => x.shares > 0).length})</button>
      </div>
      ${detailHtml}
      <div class="tablewrap"><table class="civt">
        <thead><tr><th>Ticker</th><th>Issuer / City</th><th>Type</th><th>Price</th><th>Change</th><th>Trend</th><th>Yield</th><th>Shares</th><th>Value</th><th>Quick Trade</th></tr></thead>
        <tbody>${items.map((it) => {
          const chg = ((it.price - it.startPrice) / it.startPrice) * 100;
          const up = chg >= 0;
          const val = Math.round(it.shares * it.price);
          return `<tr data-msel="${it.id}" style="${it.id === M.sel ? 'background:var(--panel2)' : ''}">
            <td><b style="color:var(--accent2);font-family:var(--mono)">${U.esc(it.ticker)}</b></td>
            <td><b>${U.esc(it.name)}</b><small>${U.esc(it.sector)}</small></td>
            <td>${it.kind === 'city' ? '<span class="chip good">City</span>' : '<span class="chip">Corp</span>'}</td>
            <td style="font-family:var(--mono)"><b>${it.price.toFixed(1)}</b></td>
            <td class="${up ? 'good' : 'bad'}" style="font-family:var(--mono)">${up ? '+' : ''}${chg.toFixed(1)}%</td>
            <td>${this.spark(it.hist, it.price >= (it.hist[0] || it.startPrice))}</td>
            <td style="font-family:var(--mono)">${(it.divRate * 100).toFixed(1)}%</td>
            <td style="font-family:var(--mono)">${it.shares || '—'}</td>
            <td style="font-family:var(--mono)">${val ? U.num(val) : '—'}</td>
            <td>
              <button class="cmd hi" style="padding:2px 6px;font-size:11px" data-mbuy="${it.id}" data-q="5">+5</button>
              ${it.shares > 0 ? `<button class="cmd warn" style="padding:2px 6px;font-size:11px" data-msell="${it.id}" data-q="5">-5</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="sub small">Invest in defence, mining, energy, logistics and robotics corporations, or buy municipal equity in individual cities and towns. City bonds fund local infrastructure and rise as towns grow prosperous and safe; dividends are paid into your credits every few seconds.</p>`;
    el.querySelectorAll('[data-mfilt]').forEach((b) => (b.onclick = () => { M.filter = b.dataset.mfilt; el.dataset.ok = ''; this.render(); }));
    el.querySelectorAll('tr[data-msel]').forEach((r) => (r.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; M.sel = r.dataset.msel; el.dataset.ok = ''; this.render(); }));
    el.querySelectorAll('[data-mbuy]').forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); Market.buy(b.dataset.mbuy, +b.dataset.q); el.dataset.ok = ''; this.render(); UI.updateTop(); }));
    el.querySelectorAll('[data-msell]').forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); Market.sell(b.dataset.msell, +b.dataset.q); el.dataset.ok = ''; this.render(); UI.updateTop(); }));
    el.querySelectorAll('[data-mdev]').forEach((b) => (b.onclick = () => { Market.investCity(+b.dataset.mdev); el.dataset.ok = ''; this.render(); UI.updateTop(); }));
    el.querySelectorAll('[data-mloc]').forEach((b) => (b.onclick = () => { const s = G.settlements[+b.dataset.mloc]; if (s) { UI.centerOn(s.x, s.y); UI.closeWins(); } }));
  },
};
const Settings = {
  render() {
    const st = Store.get('settings', {}), el = $('setbody');
    el.innerHTML = `<div class="form"><label>Volume <input type="range" id="s-vol" min="0" max="1" step="0.05" value="${Sound.vol}"></label>
      <label class="chk"><input type="checkbox" id="s-snd" ${Sound.on ? 'checked' : ''}> Sound effects</label>
      <label class="chk"><input type="checkbox" id="s-edge" ${UI.edge ? 'checked' : ''}> Edge scrolling</label>
      <label>Particle density <select id="s-fx"><option value="0.4">Low</option><option value="0.7">Medium</option><option value="1">High</option></select></label></div>
      <h4>Key bindings</h4><p class="sub small">Click a binding, then press the new key. Arrow keys pan, mouse wheel zooms, middle-drag or right-drag pans, Ctrl+number assigns a group.</p>
      <div class="keys">${Object.keys(DEFAULT_KEYS).map((k) => `<button class="kb ${UI.rebinding === k ? 'on' : ''}" data-k="${k}"><span>${KEY_LABEL[k]}</span><kbd>${UI.rebinding === k ? '…' : U.esc(UI.keys[k].toUpperCase())}</kbd></button>`).join('')}</div><div class="row"><button class="cmd" id="s-reset">Reset keys</button></div>`;
    $('s-fx').value = String(FX.quality);
    const save = () => Store.set('settings', { vol: Sound.vol, sound: Sound.on, edge: UI.edge, fx: FX.quality });
    $('s-vol').oninput = (e) => { Sound.setVol(+e.target.value); save(); };
    $('s-snd').onchange = (e) => { Sound.on = e.target.checked; save(); };
    $('s-edge').onchange = (e) => { UI.edge = e.target.checked; save(); };
    $('s-fx').onchange = (e) => { FX.quality = +e.target.value; save(); };
    el.querySelectorAll('.kb').forEach((b) => (b.onclick = () => { UI.rebinding = b.dataset.k; this.render(); }));
    $('s-reset').onclick = () => { UI.keys = { ...DEFAULT_KEYS }; Store.set('keys', UI.keys); this.render(); };
  },
};
const SaveWin = {
  render() {
    const el = $('savebody'), inGame = G.running;
    el.innerHTML = SaveLoad.slots().map(({ k, s }) => `<div class="slot"><div><b>${k === 'auto' ? 'Autosave' : 'Slot ' + k}</b><span class="sub small">${s ? U.esc(s.name) + ' · ' + new Date(s.t).toLocaleString() : 'Empty'}</span></div><div class="row">${inGame && k !== 'auto' ? `<button class="cmd" data-save="${k}">Save</button>` : ''}${s ? `<button class="cmd hi" data-load="${k}">Load</button>` : ''}</div></div>`).join('') +
      `<h4>Transfer a save</h4><p class="sub small">Copy the text to keep a save outside this browser, or paste one in to load it.</p><textarea id="sv-text" rows="4" spellcheck="false" placeholder="Save data"></textarea><div class="row">${inGame ? '<button class="cmd" id="sv-export">Export current game</button>' : ''}<button class="cmd" id="sv-copy">Copy</button><button class="cmd hi" id="sv-import">Load pasted save</button></div><p class="reply" id="sv-msg"></p>`;
    el.querySelectorAll('[data-save]').forEach((b) => (b.onclick = () => { SaveLoad.save(b.dataset.save); this.render(); }));
    el.querySelectorAll('[data-load]').forEach((b) => (b.onclick = () => { try { SaveLoad.load(b.dataset.load); UI.closeWins(); } catch (e) { $('sv-msg').textContent = 'That save could not be loaded: ' + e.message; } }));
    const ex = $('sv-export'); if (ex) ex.onclick = () => { $('sv-text').value = SaveLoad.serialize(); $('sv-msg').textContent = 'Exported ' + Math.round($('sv-text').value.length / 1024) + ' KB.'; };
    $('sv-copy').onclick = () => { const t = $('sv-text'); navigator.clipboard && navigator.clipboard.writeText(t.value).then(() => ($('sv-msg').textContent = 'Copied.')).catch(() => { t.select(); $('sv-msg').textContent = 'Text selected — copy it with your keyboard.'; }); };
    $('sv-import').onclick = () => { try { SaveLoad.restore($('sv-text').value); UI.closeWins(); } catch (e) { $('sv-msg').textContent = 'That text is not a valid save: ' + e.message; } };
  },
};
const Help = {
  render() {
    $('helpbody').innerHTML = `<div class="help">
      <section><h4>Command</h4><ul><li><b>Left-click</b> select · <b>drag</b> box-select · <b>double-click</b> all of a type on screen · <b>shift</b> adds</li><li><b>Right-click</b> context order: move, attack, board, capture, repair, harvest, deliver aid, clear wreck</li><li><b>Ctrl + right-click</b> force fire at anything, including the ground</li><li><b>Shift + right-click</b> queue waypoints</li><li><b>Ctrl + 1–9</b> assign group · <b>1–9</b> select · double-tap to jump</li></ul></section>
      <section><h4>Camera</h4><ul><li>Arrow keys, screen edges, middle-drag or right-drag to pan</li><li>Mouse wheel or pinch to zoom</li><li>Click or drag on the minimap to move, right-click it to send units</li></ul></section>
      <section><h4>Building</h4><ul><li>Pick a structure in the sidebar; when it shows <b>PLACE</b>, click it again and click the map</li><li>Buildings must be near your existing base. Shift-place walls and trenches to keep building</li><li>Keep power positive: low power halves production and switches off turrets, SAMs and radar</li></ul></section>
      <section><h4>Economy</h4><ul><li>Ore collectors fund you. Mines need metal deposits; pumps need water; farms feed infantry</li><li>Depots turn food and metal into supplies; supplies rearm units and aircraft</li><li>Capture oil derricks, power stations, towers, the airport and harbour with engineers</li><li>Settlements you control pay taxes; trade agreements pay both sides</li></ul></section>
      <section><h4>Civilians</h4><ul><li>Splash damage near towns kills civilians and destroys homes. Reputation falls and diplomacy turns against you</li><li>Select any civilian building to evacuate, airdrop aid, buy goods or fund rebuilding</li><li>Engineers rebuild rubble and bridges; medics treat the injured</li></ul></section>
      <section><h4>Combat</h4><ul><li>Infantry seek cover in forests, towns and trenches; suppressive fire pins them</li><li>Morale breaks under heavy losses and units fall back</li><li>Units gain veterancy. Radar reveals enemy contacts on the minimap</li><li>Weather and night shorten sight; snow slows wheeled vehicles</li></ul></section></div>`;
  },
};

/* ---------------- main menu ---------------- */
const Menu = {
  opts: null, campaignIdx: null,
  init() {
    this.opts = Object.assign(Game.defaults(), Store.get('lastSetup', {}));
    this.opts.seed = (Math.random() * 1e9) | 0;
    this.show();
  },
  show() {
    $('menu').hidden = false; $('game').hidden = true;
    const prog = Store.get('campaign', 0);
    $('m-modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="mode ${this.opts.mode === k ? 'on' : ''}" data-m="${k}"><b>${m.name}</b><span>${m.desc}</span></button>`).join('');
    $('m-camp').innerHTML = CAMPAIGN.map((c, i) => `<button class="mission ${i > prog ? 'locked' : ''}" data-c="${i}" ${i > prog ? 'disabled' : ''}><b>${c.title}</b><span>${i > prog ? 'Complete the previous mission to unlock' : c.brief}</span></button>`).join('');
    $('m-modes').querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { this.opts.mode = b.dataset.m; this.show(); }));
    $('m-camp').querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => this.campaign(+b.dataset.c)));
    this.form();
    $('m-load').onclick = () => UI.toggleWin('w-save');
    $('m-help2').onclick = () => UI.toggleWin('w-help');
    $('m-set2').onclick = () => UI.toggleWin('w-set');
  },
  form() {
    const o = this.opts, sel = (id, list, v) => `<select id="${id}">${list.map(([k, n]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const facs = FACTION_KEYS.map((k) => [k, FACTIONS[k].name]), diffs = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['brutal', 'Brutal']];
    const earth = o.type === 'earth';
    if (!o.geo.lspan || !o.geo.preset) { o.geo.preset = EarthPicker.presets.some((p) => +p[0] === o.geo.span) ? String(o.geo.span) : 'custom'; o.geo.lspan = o.geo.lspan || Math.min(360, o.geo.span / Math.max(0.2, Math.cos((o.geo.lat * Math.PI) / 180))); }
    $('m-form').innerHTML = `
      ${earth ? `<div class="earthbox"><canvas id="m-earth" width="720" height="360"></canvas><div class="earthrow"><span id="m-einfo"></span><label class="inl">Region ${sel('f-span', EarthPicker.presets, o.geo.preset || 'custom')}</label></div><p class="sub small" id="m-escale"></p><p class="sub small">Click the world to centre the region · drag a box for a custom region of any size, from a single valley to the whole planet. Country borders are drawn on the map.</p></div>` : ''}
      <div class="facpick">${FACTION_KEYS.map((k) => { const F = FACTIONS[k]; return `<button class="fac ${o.player === k ? 'on' : ''}" data-f="${k}" style="--fc:${F.color}"><b>${F.name}</b><span>${F.doctrine}</span><small>${F.traits.join(' · ')}</small></button>`; }).join('')}</div>
      <div class="grid2">
        <label>Map ${sel('f-type', Object.entries(MAP_TYPES).map(([k, v]) => [k, v.name]), o.type)}</label>
        <label>Size ${sel('f-size', [['small', 'Small · 128²'], ['medium', 'Medium · 192²'], ['large', 'Large · 288²'], ['huge', 'Huge · 384²'], ['vast', 'Vast · 512²'], ['colossal', 'Colossal · 768²'], ['giant', 'Giant · 1152²'], ['planetary', 'Planetary · 1536²']], o.size)}</label>
        <label>Season ${sel('f-season', [['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter'], ['dry', 'Dry season']], o.season)}</label>
        <label>Relations ${sel('f-stance', [['ffa', 'Everyone at war'], ['teams', 'AI factions allied against you'], ['diplomatic', 'Neutral start, diplomacy decides']], o.stance)}</label>
        <label>Starting resources ${sel('f-res', [['low', 'Low'], ['normal', 'Standard'], ['high', 'High']], o.startRes || 'normal')}</label>
        <label>Day length ${sel('f-day', [['360', '6 minutes'], ['720', '12 minutes'], ['1440', '24 minutes']], String(o.dayLen))}</label>
        <label class="chk"><input type="checkbox" id="f-fog" ${o.fog ? 'checked' : ''}> Fog of war</label>
        <label class="chk"><input type="checkbox" id="f-wx" ${o.weather ? 'checked' : ''}> Dynamic weather</label>
        <label>Seed <span class="seedrow"><input id="f-seed" value="${o.seed}" inputmode="numeric"><button class="cmd" id="f-rand" type="button">New</button></span></label>
      </div>
      <h4>Opponents</h4><div id="f-ais">${o.ais.map((a, i) => `<div class="ai"><span>${i + 1}</span>${sel('ai-f-' + i, facs, a.key)}${sel('ai-d-' + i, diffs, a.diff)}${o.ais.length > 1 ? `<button class="cmd" data-rm="${i}" type="button">Remove</button>` : ''}</div>`).join('')}${o.ais.length < 3 ? '<button class="cmd" id="f-add" type="button">Add opponent</button>' : ''}</div>`;
    const read = () => {
      o.type = $('f-type').value; o.size = $('f-size').value; o.season = $('f-season').value; o.stance = $('f-stance').value; o.startRes = $('f-res').value; o.dayLen = +$('f-day').value; o.fog = $('f-fog').checked; o.weather = $('f-wx').checked; o.seed = parseInt($('f-seed').value, 10) || 1;
      o.ais = o.ais.map((a, i) => ({ key: $('ai-f-' + i).value, diff: $('ai-d-' + i).value }));
      if ($('f-span')) EarthPicker.apply(o, $('f-span').value);
    };
    $('m-form').querySelectorAll('select,input').forEach((e) => (e.onchange = () => { read(); this.preview(); }));
    $('m-form').querySelectorAll('.fac').forEach((b) => (b.onclick = () => { read(); o.player = b.dataset.f; this.form(); }));
    $('f-rand').onclick = () => { read(); o.seed = (Math.random() * 1e9) | 0; this.form(); this.preview(); };
    const add = $('f-add'); if (add) add.onclick = () => { read(); const used = [o.player, ...o.ais.map((a) => a.key)]; o.ais.push({ key: FACTION_KEYS.find((k) => !used.includes(k)) || 'steppe', diff: 'normal' }); this.form(); this.preview(); };
    $('m-form').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { read(); o.ais.splice(+b.dataset.rm, 1); this.form(); this.preview(); }));
    $('m-start').onclick = () => { read(); this.campaignIdx = null; Store.set('lastSetup', { ...o, seed: undefined }); this.launch({ ...o }); };
    this.read = read;
    $('f-type').onchange = () => { const was = o.type; read(); if (o.type === 'earth' && was !== 'earth') { o.season = Earth.defaultSeason(Earth.climate(o.geo.lat, o.geo.lon)); } o.playerStart = null; this.form(); };
    $('f-season').onchange = () => { read(); o.seasonSet = true; this.preview(); };
    const ec = $('m-earth');
    if (ec) {
      const info = () => {
        const i = EarthPicker.info(o, MAP_SIZES[o.size] || 144), g = o.geo, c = i.perTile;
        $('m-einfo').innerHTML = `<b>${U.esc(i.region)}</b> · ${g.lat.toFixed(1)}°, ${g.lon.toFixed(1)}° · ${i.climate} · land ${Math.round(i.land * 100)}%${i.land < 0.15 ? ' — <span class="bad">mostly sea, pick a coastline</span>' : ''}`;
        $('m-escale').innerHTML = `Theatre ${i.km} · map ${i.W} × ${i.H} tiles · <b>1 tile ≈ ${c < 1 ? Math.round(c * 1000) + ' m' : c.toFixed(1) + ' km'}</b> · ${i.cities} real cities · ${U.esc(i.countries.join(', ') || 'open sea')}${c > 8 ? ' · <span class="bad">planetary scale: settlements and bases are drawn at fixed size, only strategic play makes sense</span>' : c > 2.5 ? ' · strategic scale — cities shrink, missiles and fallout dominate' : ''}`;
      };
      const reseason = () => { if (!o.seasonSet) { o.season = Earth.defaultSeason(Earth.climate(o.geo.lat, o.geo.lon)); $('f-season').value = o.season; } };
      setTimeout(() => { EarthPicker.draw(ec, o); info(); }, 10);
      ec.onmousedown = (e) => { EarthPicker.down(ec, e, o); e.preventDefault(); };
      ec.onmousemove = (e) => EarthPicker.move(ec, e, o);
      const finish = (e) => { if (!EarthPicker.drag) return; if (EarthPicker.up(ec, e, o)) { reseason(); o.playerStart = null; $('f-span').value = o.geo.preset; EarthPicker.draw(ec, o); info(); this.preview(); } };
      ec.onmouseup = finish; ec.onmouseleave = (e) => { if (EarthPicker.drag) { EarthPicker.drag = null; EarthPicker.draw(ec, o); } };
      $('f-span').onchange = () => { read(); reseason(); o.playerStart = null; EarthPicker.draw(ec, o); info(); this.preview(); };
      $('f-size').addEventListener('change', () => setTimeout(info, 0));
    }
    $('m-preview').onclick = (e) => { const r = $('m-preview').getBoundingClientRect(); o.playerStart = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }; this.preview(); };
    this.preview();
  },
  preview() {
    clearTimeout(this.pt);
    this.pt = setTimeout(() => {
      const o = this.opts, cv = $('m-preview'), g = cv.getContext('2d');
      const M = MapGen.generate({ size: Math.min(144, MAP_SIZES[o.size]), type: o.type, season: o.season, seed: o.seed, factions: o.ais.length + 1, geo: o.type === 'earth' ? o.geo : null, playerStart: o.playerStart });
      const pal = (PALETTES[o.season] || PALETTES.summer).map((c) => COL.rgb(c)), img = g.createImageData(M.w, M.h);
      for (let i = 0; i < M.w * M.h; i++) { let c = pal[M.terr[i]]; let k = 0.9 + (M.hgt[i] - 0.4) * 0.4; if (M.road[i]) { c = [60, 60, 60]; k = 1; } if (M.occ[i] || 0) k = 1; if (M.tree[i] > 1) k *= 0.85; if (M.ore[i]) c = [216, 183, 64]; img.data[i * 4] = c[0] * k; img.data[i * 4 + 1] = c[1] * k; img.data[i * 4 + 2] = c[2] * k; img.data[i * 4 + 3] = 255; }
      for (const p of M.plan.civb) { const i = p.ty * M.w + p.tx; img.data[i * 4] = 225; img.data[i * 4 + 1] = 218; img.data[i * 4 + 2] = 196; }
      const tmp = U.canvas(M.w, M.h); tmp.getContext('2d').putImageData(img, 0, 0);
      const PW = M.w >= M.h ? 360 : Math.round(360 * M.w / M.h), PH = M.w >= M.h ? Math.round(360 * M.h / M.w) : 360; cv.width = PW; cv.height = PH; cv.style.aspectRatio = PW + ' / ' + PH; g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, PW, PH);
      if (M.ctry) { g.fillStyle = 'rgba(230,110,80,0.9)'; const sx = PW / M.w, sy = PH / M.h; for (let y = 0; y < M.h - 1; y++) for (let x = 0; x < M.w - 1; x++) { const i = y * M.w + x, c0 = M.ctry[i]; if (c0 && ((M.ctry[i + 1] && M.ctry[i + 1] !== c0) || (M.ctry[i + M.w] && M.ctry[i + M.w] !== c0))) g.fillRect(x * sx, y * sy, Math.max(1.2, sx * 0.55), Math.max(1.2, sy * 0.55)); } }
      const keys = [o.player, ...o.ais.map((a) => a.key)];
      M.starts.forEach((s, i) => { const x = (s.x / M.w) * PW, y = (s.y / M.h) * PH; g.fillStyle = FACTIONS[keys[i]].color; g.fillRect(x - 6, y - 6, 12, 12); g.strokeStyle = '#000'; g.strokeRect(x - 6, y - 6, 12, 12); });
      g.font = '600 11px "IBM Plex Mono", monospace'; g.fillStyle = '#f2ecd8';
      for (const t of M.towns) { if (t.kind === 'village') continue; g.fillText(t.name, (t.cx / M.w) * PW + 4, (t.cy / M.h) * PH - 4); }
      g.strokeStyle = '#fff'; g.lineWidth = 2; const p0 = M.starts[0]; if (p0) { g.beginPath(); g.arc((p0.x / M.w) * PW, (p0.y / M.h) * PH, 12, 0, 6.283); g.stroke(); g.fillStyle = '#fff'; g.fillText('YOU', (p0.x / M.w) * PW + 14, (p0.y / M.h) * PH + 4); }
      $('m-pinfo').textContent = `Click the map to choose where your base deploys · ${M.geo ? M.geo.region + ' · ' : ''}${M.ctry ? Object.keys(M.cinfo || {}).length + ' countries · ' : ''}${M.towns.length} settlements · ${M.plan.civb.length} civilian structures · ${M.plan.bridges.length} bridges`;
    }, 120);
  },
  campaign(i) {
    const c = CAMPAIGN[i]; this.campaignIdx = i;
    $('briefing').hidden = false;
    $('briefing').innerHTML = `<div class="endcard"><p class="eyebrow">Campaign · mission ${i + 1} of ${CAMPAIGN.length}</p><h2>${c.title.replace(/^\d+ · /, '')}</h2><p>${c.brief}</p><p class="sub">${MODES[c.o.mode].desc}</p><div class="row"><button class="cmd" id="b-back">Back</button><button class="cmd hi" id="b-go">Begin</button></div></div>`;
    $('b-back').onclick = () => { $('briefing').hidden = true; };
    $('b-go').onclick = () => { $('briefing').hidden = true; this.launch({ ...Game.defaults(), ...c.o, fog: true, weather: true, dayLen: 720, stance: 'ffa' }); };
  },
  launch(o) {
    $('loading').hidden = false;
    setTimeout(() => { try { Game.start(o); } catch (e) { console.error(e); alert && 0; $('m-pinfo').textContent = 'Could not start: ' + e.message; } $('loading').hidden = true; }, 30);
  },
};
