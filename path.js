'use strict';
/* =====================================================================
   CITY.RA — path.js
   Tile A* with a binary heap and stamp arrays (no per-search clearing),
   movement-class costs, partial paths, line-of-sight smoothing, a
   per-frame request queue, and connected-component maps used by the AI.
   ===================================================================== */

const Path = {
  init(M) {
    this.M = M; const N = M.w * M.h; this.N = N;
    this.g = new Float32Array(N); this.from = new Int32Array(N); this.seen = new Uint32Array(N); this.closed = new Uint32Array(N);
    this.stamp = 1; this.heap = new Heap(); this.q = []; this.comp = {};
    this.rebuildComponents();
  },

  // movement cost of entering tile i (0 = blocked)
  cost(mc, i) {
    const M = this.M, t = M.terr[i];
    if (mc === 'naval' || mc === 'beach') {
      const c = MOVE[mc][t]; if (!c) return 0;
      if (M.occ[i]) { const e = G.ents.get(M.occ[i]); if (e && e.kind !== 'bridge') return 0; }
      return c;
    }
    let c;
    const rd = M.road[i];
    if (rd === 3) c = 0.7;
    else if (rd === 4) return 0;
    else if (M.rail[i] === 2) { if (mc === 'wheel') return 0; c = 1; }
    else if (M.rail[i] === 3 && TER_INFO[t].water) return 0;
    else { c = MOVE[mc][t]; if (!c) return 0; if (rd) c *= 0.55; }
    const o = M.occ[i];
    if (o) { const e = G.ents.get(o); if (e && !(e.d && e.d.walk && mc === 'foot')) return 0; }
    if (M.block[i] && mc !== 'foot') c += 6;
    if (M.tree[i] > 1 && mc === 'wheel') c += 0.8;
    return c;
  },

  passable(mc, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.M.w || ty >= this.M.h) return false;
    if (mc === 'air') return true;
    return this.cost(mc, ty * this.M.w + tx) > 0;
  },

  nearestPassable(mc, tx, ty, maxR, fx, fy) {
    let best = -1, bd = 1e9;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (!this.passable(mc, x, y)) continue;
        const d = Math.hypot(dx, dy) + (fx != null ? Math.hypot(x - fx, y - fy) * 0.02 : 0);
        if (d < bd) { bd = d; best = y * this.M.w + x; }
      }
      if (best >= 0) return best;
    }
    return -1;
  },

  find(mc, sx, sy, tx, ty, maxN) {
    if (!maxN) maxN = Math.min(45000, Math.max(14000, this.N / 6));
    const M = this.M, W = M.w, H = M.h;
    sx = U.clamp(sx, 0, W - 1); sy = U.clamp(sy, 0, H - 1); tx = U.clamp(tx, 0, W - 1); ty = U.clamp(ty, 0, H - 1);
    let t = ty * W + tx;
    if (this.cost(mc, t) === 0) { t = this.nearestPassable(mc, tx, ty, 8, sx, sy); if (t < 0) return null; tx = t % W; ty = (t / W) | 0; }
    const s = sy * W + sx; if (s === t) return [t];
    const st = ++this.stamp, g = this.g, from = this.from, seen = this.seen, closed = this.closed, heap = this.heap;
    heap.clear(); g[s] = 0; seen[s] = st; from[s] = -1;
    const h = (i) => { const dx = Math.abs((i % W) - tx), dy = Math.abs(((i / W) | 0) - ty); return (dx + dy + (1.414 - 2) * Math.min(dx, dy)) * 0.75; };
    heap.push(s, h(s));
    let best = s, bestH = h(s), n = 0, found = false;
    while (heap.size) {
      const c = heap.pop();
      if (c === t) { found = true; break; }
      if (closed[c] === st) continue; closed[c] = st;
      if (++n > maxN) break;
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = DX8[k], dy = DY8[k], x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x; if (closed[j] === st) continue;
        const cst = this.cost(mc, j); if (!cst) continue;
        if (dx && dy && (!this.cost(mc, cy * W + x) || !this.cost(mc, y * W + cx))) continue;
        const ng = g[c] + cst * (dx && dy ? 1.414 : 1);
        if (seen[j] !== st || ng < g[j]) {
          seen[j] = st; g[j] = ng; from[j] = c;
          const hj = h(j); heap.push(j, ng + hj);
          if (hj < bestH) { bestH = hj; best = j; }
        }
      }
    }
    const end = found ? t : best;
    if (end === s) return null;
    const p = []; for (let c = end; c !== -1; c = from[c]) { p.push(c); if (c === s) break; }
    return p.reverse();
  },

  // straight segment check for path smoothing
  lineOK(mc, ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.35), W = this.M.w;
    for (let i = 1; i < n; i++) {
      const x = Math.floor(U.lerp(ax, bx, i / n)), y = Math.floor(U.lerp(ay, by, i / n));
      const c = this.cost(mc, y * W + x); if (!c || c > 1.7) return false;
    }
    return true;
  },

  smooth(mc, tiles, ex, ey) {
    const W = this.M.w, pts = tiles.map((i) => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    if (ex != null) pts[pts.length - 1] = [ex / TILE, ey / TILE];
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 12);
      while (j > i + 1 && !this.lineOK(mc, pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
      out.push({ x: pts[j][0] * TILE, y: pts[j][1] * TILE });
      i = j;
    }
    return out;
  },

  // queued requests, processed with a time budget each frame
  request(u, wx, wy) {
    u.pathReq = { x: wx, y: wy }; u.path = null;
    this.q.push(u.id);
  },
  process(budget = 5) {
    const t0 = performance.now(); let n = 0;
    while (this.q.length && (n < 3 || performance.now() - t0 < budget)) {
      const u = G.ents.get(this.q.shift()); n++;
      if (!u || !u.pathReq || u.dead) continue;
      const r = u.pathReq; u.pathReq = null;
      const mc = u.d.mc;
      const tiles = this.find(mc, (u.x / TILE) | 0, (u.y / TILE) | 0, (r.x / TILE) | 0, (r.y / TILE) | 0);
      if (!tiles) { u.path = null; u.pathFail = (u.pathFail || 0) + 1; continue; }
      const last = tiles[tiles.length - 1], exact = last === ((r.y / TILE) | 0) * this.M.w + ((r.x / TILE) | 0);
      u.path = this.smooth(mc, tiles, exact ? r.x : null, exact ? r.y : null); u.pi = 0; u.pathFail = 0;
    }
  },

  rebuildComponents() {
    for (const mc of ['track', 'naval']) {
      const M = this.M, N = this.N, W = M.w, comp = new Int32Array(N).fill(-1); let id = 0;
      for (let i = 0; i < N; i++) {
        if (comp[i] >= 0 || !this.terrOK(mc, i)) continue;
        const st = [i]; comp[i] = id;
        while (st.length) { const c = st.pop(), cx = c % W, cy = (c / W) | 0;
          for (let k = 0; k < 4; k++) { const x = cx + DX8[k], y = cy + DY8[k]; if (x < 0 || y < 0 || x >= W || y >= M.h) continue; const j = y * W + x; if (comp[j] < 0 && this.terrOK(mc, j)) { comp[j] = id; st.push(j); } } }
        id++;
      }
      this.comp[mc] = comp;
    }
  },
  terrOK(mc, i) { // terrain-only passability, ignores buildings
    const M = this.M, t = M.terr[i];
    if (mc === 'naval') return MOVE.naval[t] > 0;
    if (M.road[i] === 3 || M.rail[i] === 2) return true;
    return MOVE.track[t] > 0 || MOVE.foot[t] > 0;
  },
  sameComp(mc, ax, ay, bx, by) {
    const c = this.comp[mc]; if (!c) return true; const W = this.M.w;
    const a = c[(ay | 0) * W + (ax | 0)], b = c[(by | 0) * W + (bx | 0)];
    if (a < 0 || b < 0) { // check neighbours of buildings
      const ra = a >= 0 ? a : this.nearComp(c, ax | 0, ay | 0), rb = b >= 0 ? b : this.nearComp(c, bx | 0, by | 0);
      return ra >= 0 && ra === rb;
    }
    return a === b;
  },
  nearComp(c, x, y) { const W = this.M.w; for (let r = 1; r < 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= this.M.h) continue; const v = c[yy * W + xx]; if (v >= 0) return v; } return -1; },
};
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
