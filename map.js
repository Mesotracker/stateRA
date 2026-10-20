'use strict';
/* =====================================================================
   CITY.RA — map.js
   Procedural world generation: heightfield, coasts, rivers and lakes,
   biomes, base sites, cities/towns/villages with street grids and
   zoned buildings, highways with bridges, railway, airport, harbour,
   power grid, resources, ruins, checkpoints and forests.
   ===================================================================== */

const SEA = 0.35, ROCKH = 0.8;
const CLIMATES = ['temperate', 'polar', 'boreal', 'tropical', 'savanna', 'mediterranean', 'arid'];
const MAP_SIZES = { small: 128, medium: 192, large: 288, huge: 384, vast: 512, colossal: 768, giant: 1152, planetary: 1536 };
const MAP_TYPES = {
  continental: { name: 'Continental heartland', water: 0.07, rock: 0.06, rivers: 2 },
  coastal:     { name: 'Coastal front', water: 0.32, rock: 0.05, rivers: 1 },
  river:       { name: 'River valley', water: 0.03, rock: 0.07, rivers: 1, main: true },
  archipelago: { name: 'Archipelago', water: 0.5, rock: 0.03, rivers: 0 },
  desert:      { name: 'Desert expanse', water: 0.02, rock: 0.05, rivers: 0, dry: true },
  highlands:   { name: 'Highland passes', water: 0.05, rock: 0.15, rivers: 2 },
  earth:       { name: 'Real Earth — pick a theatre', water: 0, rock: 0, rivers: 1, earth: true },
};

function newMap(W, H) {
  const N = W * H;
  return {
    w: W, h: H, terr: new Uint8Array(N), hgt: new Float32Array(N), road: new Uint8Array(N), rail: new Uint8Array(N),
    ore: new Uint16Array(N), res: new Uint8Array(N), tree: new Uint8Array(N), occ: new Int32Array(N), block: new Uint8Array(N),
    towns: [], starts: [], props: [], poles: [], craters: [], plan: { civb: [], bridges: [] }, season: 'summer', type: 'continental', seed: 1,
  };
}

const MapGen = {
  generate(o) {
    const T = Object.assign({}, MAP_TYPES[o.type] || MAP_TYPES.continental), seed = o.seed >>> 0;
    const useEarth = !!(T.earth && o.geo && typeof Earth !== 'undefined');
    let dm = null; if (useEarth) { Earth.decode(); dm = Earth.dims(o.geo, o.size); }
    const W = dm ? dm.W : o.size, H = dm ? dm.H : o.size, N = W * H, Sm = Math.min(W, H), Ar = Math.sqrt(W * H);
    const r = RNG(seed), n1 = new Noise(seed), n2 = new Noise(seed ^ 0x5bd1e995), n3 = new Noise(seed ^ 0x9e3779b9);
    const M = newMap(W, H); M.seed = seed; M.type = o.type; M.season = o.season || 'summer'; M.km = dm ? dm.km : 0.5;
    const idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

    /* ---- 1. height: real Earth or procedural ---- */
    let bio = null;
    if (useEarth) {
      const g = o.geo, rc = Earth.rect(g);
      bio = new Array(N); const counts = {}; M.cl = new Uint8Array(N); M.ctry = new Uint8Array(N);
      const coarse = {};
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const lat = rc.lat1 - ((y + 0.5) / H) * (rc.lat1 - rc.lat0), lon = rc.lon0 + ((x + 0.5) / W) * (rc.lon1 - rc.lon0);
        const i = idx(x, y), ck = (x >> 3) + ',' + (y >> 3);
        let c = coarse[ck]; if (!c) c = coarse[ck] = { e: Earth.elev(lat, lon), cl: Earth.climate(lat, lon) };
        const lf = Earth.landF(lat, lon) + (n1.fbm(x / 16, y / 16, 4) - 0.5) * 0.6 + (n2.v(x / 5, y / 5) - 0.5) * 0.12;
        const relief = (n1.fbm(x / 30, y / 30, 5) - 0.5);
        if (lf > 0.5) M.hgt[i] = U.clamp(SEA + 0.04 + (lf - 0.5) * 0.18 + c.e * 0.55 + relief * (0.18 + c.e * 0.35) + Math.max(0, n1.ridge(x / 24, y / 24, 4) - 0.6) * c.e * 0.8, SEA + 0.01, 1);
        else M.hgt[i] = U.clamp(SEA - 0.02 - (0.5 - lf) * 0.5, 0, SEA - 0.005);
        bio[i] = c.cl; counts[c.cl] = (counts[c.cl] || 0) + 1; M.cl[i] = CLIMATES.indexOf(c.cl);
        M.ctry[i] = Earth.country(lat + (n2.v(x / 9, y / 9) - 0.5) * 0.02, lon + (n3.v(x / 9, y / 9) - 0.5) * 0.02);
      }
      M.geo = { lat: g.lat, lon: g.lon, span: g.span, lspan: rc.lspan, lat0: rc.lat0, lat1: rc.lat1, lon0: rc.lon0, lon1: rc.lon1, preset: g.preset, region: g.span >= 100 ? 'Entire planet' : Earth.regionName(g.lat, g.lon) };
      const main = Object.entries(counts).sort((p, q) => q[1] - p[1])[0][0];
      M.climate = main;
      if (main === 'arid') T.dry = true;
    } else {
    const raw = new Float32Array(N), side = r.int(4), sc = 44 * (W / 144) ** 0.35;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let h = n1.fbm(x / sc, y / sc, 5);
      const nx = x / W, ny = y / H;
      if (o.type === 'coastal') {
        const t = [nx, 1 - nx, ny, 1 - ny][side];
        h = h * 0.65 + t * 0.6 + (n2.v(x / 18, y / 18) - 0.5) * 0.12;
      } else if (o.type === 'archipelago') {
        const d = Math.hypot(nx - 0.5, ny - 0.5);
        h = h * 0.95 + n2.fbm(x / 22, y / 22, 3) * 0.35 - d * 0.55;
      } else if (o.type === 'highlands') {
        h = n1.ridge(x / (sc * 1.1), y / (sc * 1.1), 5) * 0.75 + h * 0.35;
      }
      raw[idx(x, y)] = h;
    }
    // remap by percentile so every map hits its water/rock targets
    const sorted = Float32Array.from(raw).sort();
    const sea = sorted[Math.floor(N * T.water)], rock = sorted[Math.floor(N * (1 - T.rock))], mx = sorted[N - 1], mn = sorted[0];
    for (let i = 0; i < N; i++) {
      const h = raw[i];
      M.hgt[i] = h < sea ? SEA * (h - mn) / Math.max(1e-6, sea - mn) : h < rock ? SEA + (ROCKH - SEA) * (h - sea) / (rock - sea) : ROCKH + 0.2 * (h - rock) / Math.max(1e-6, mx - rock);
    }
    }

    /* ---- 2. rivers ---- */
    const carve = (cx, cy, rad) => {
      for (let dy = -Math.ceil(rad); dy <= rad; dy++) for (let dx = -Math.ceil(rad); dx <= rad; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy); if (!inb(x, y)) continue;
        const d = Math.hypot(dx, dy); if (d > rad) continue;
        const i = idx(x, y), target = SEA - 0.02 - (1 - d / rad) * 0.06;
        if (M.hgt[i] > target) M.hgt[i] = target;
      }
    };
    const walk = (sx, sy, tx, ty, w0, w1) => {
      let x = sx, y = sy; const total = Math.hypot(tx - sx, ty - sy) * 1.6, ns = r() * 1000;
      for (let s = 0; s < total * 1.6; s++) {
        const des = Math.atan2(ty - y, tx - x), ang = des + (n3.v(s * 0.035, ns) - 0.5) * 2.2;
        x += Math.cos(ang) * 0.6; y += Math.sin(ang) * 0.6;
        if (!inb(x | 0, y | 0)) break;
        carve(x, y, U.lerp(w0, w1, Math.min(1, s / total)));
        if (Math.hypot(tx - x, ty - y) < 1.5) break;
      }
    };
    if (T.main) {
      const vert = r.chance(0.5), ph = r() * 6;
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 0.125) {
        const a = t * (vert ? H : W), b = (vert ? W : H) * (0.5 + Math.sin(t * Math.PI * 2 + ph) * 0.16 + (r() - 0.5) * 0.1);
        pts.push(vert ? [b, a] : [a, b]);
      }
      pts[0] = vert ? [pts[0][0], -2] : [-2, pts[0][1]]; pts[pts.length - 1] = vert ? [pts[pts.length - 1][0], H + 2] : [W + 2, pts[pts.length - 1][1]];
      for (let i = 0; i < pts.length - 1; i++) walk(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2.2, 2.6);
    }
    for (let k = 0; k < T.rivers + Math.round(Ar / 130); k++) {
      // source on high ground, mouth at nearest edge or water
      let best = null;
      for (let t = 0; t < 200; t++) { const x = r.int(W), y = r.int(H), h = M.hgt[idx(x, y)]; if (h > 0.6 && h < ROCKH) { best = [x, y]; break; } }
      if (!best) continue;
      const [sx, sy] = best;
      let tx, ty, bd = 1e9;
      for (let t = 0; t < 400; t++) { const x = r.int(W), y = r.int(H); if (M.hgt[idx(x, y)] < SEA - 0.05) { const d = Math.hypot(x - sx, y - sy); if (d < bd && d > 18) { bd = d; tx = x; ty = y; } } }
      if (tx == null) { const e = r.int(4); tx = e === 0 ? 0 : e === 1 ? W - 1 : sx; ty = e === 2 ? 0 : e === 3 ? H - 1 : sy; if (e < 2) ty = sy + (r() - 0.5) * H * 0.4; else tx = sx + (r() - 0.5) * W * 0.4; }
      walk(sx, sy, tx, ty, 0.9, 2.0);
    }

    /* ---- 3. classify terrain ---- */
    const water = (i) => M.hgt[i] < SEA;
    // water bodies: size per component (large = sea or big lake)
    const comp = new Int32Array(N).fill(-1), compSize = [];
    for (let i = 0; i < N; i++) {
      if (!water(i) || comp[i] >= 0) continue;
      const id = compSize.length; let n = 0; const st = [i]; comp[i] = id;
      while (st.length) { const c = st.pop(); n++; const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = cx + dx, y = cy + dy; if (!inb(x, y)) continue; const j = idx(x, y); if (comp[j] < 0 && water(j)) { comp[j] = id; st.push(j); } } }
      compSize.push(n);
    }
    const bfsDist = (src, max) => {
      const d = new Uint8Array(N).fill(255), q = [];
      for (let i = 0; i < N; i++) if (src(i)) { d[i] = 0; q.push(i); }
      for (let h = 0; h < q.length; h++) { const c = q[h]; if (d[c] >= max) continue; const cx = c % W, cy = (c / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = cx + dx, y = cy + dy; if (!inb(x, y)) continue; const j = idx(x, y); if (d[j] === 255) { d[j] = d[c] + 1; q.push(j); } } }
      return d;
    };
    const wd = bfsDist((i) => water(i), 8);
    const ld = bfsDist((i) => !water(i), 4);
    const bigWater = (i) => water(i) && compSize[comp[i]] > 250;
    const bd = bfsDist(bigWater, 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y), h = M.hgt[i];
      if (water(i)) { M.terr[i] = ld[i] <= 2 ? TER.SHALLOW : TER.DEEP; continue; }
      let m = n2.fbm(x / 30, y / 30, 4) + (wd[i] < 6 ? (6 - wd[i]) * 0.025 : 0);
      const B = bio ? bio[i] : null;
      if (h >= ROCKH) M.terr[i] = TER.ROCK;
      else if (bd[i] <= 2 && h < SEA + 0.06) M.terr[i] = B === 'polar' ? TER.GRASS : TER.SAND;
      else if (B && B !== 'temperate') {
        if (B === 'arid') M.terr[i] = wd[i] < 3 && m > 0.5 ? TER.GRASS : m > 0.78 ? TER.GRASS : TER.DESERT;
        else if (B === 'polar') M.terr[i] = m > 0.74 ? TER.FOREST : m > 0.6 && wd[i] < 4 ? TER.MUD : TER.GRASS;
        else if (B === 'boreal') M.terr[i] = m > 0.47 ? TER.FOREST : m > 0.42 && wd[i] < 4 ? TER.MUD : TER.GRASS;
        else if (B === 'tropical') M.terr[i] = m > 0.42 ? TER.FOREST : wd[i] < 3 ? TER.MUD : TER.GRASS;
        else if (B === 'savanna') M.terr[i] = m > 0.72 ? TER.FOREST : m < 0.3 ? TER.DESERT : TER.GRASS;
        else M.terr[i] = m > 0.66 ? TER.FOREST : m < 0.3 ? TER.DESERT : TER.GRASS;
      }
      else if (T.dry) M.terr[i] = m > 0.66 || wd[i] < 3 ? (m > 0.72 ? TER.FOREST : TER.GRASS) : TER.DESERT;
      else if (m > 0.6) M.terr[i] = TER.FOREST;
      else if (m > 0.54 && wd[i] <= 3 && h < SEA + 0.1) M.terr[i] = TER.MUD;
      else if (m < 0.3 && o.type !== 'archipelago' && n3.v(x / 20, y / 20) > 0.62) M.terr[i] = TER.DESERT;
      else M.terr[i] = TER.GRASS;
    }
    const flatType = T.dry ? TER.DESERT : TER.GRASS;
    const isLand = (x, y) => inb(x, y) && !TER_INFO[M.terr[idx(x, y)]].water;
    const goodGround = (x, y) => { if (!inb(x, y)) return false; const t = M.terr[idx(x, y)]; return t !== TER.DEEP && t !== TER.SHALLOW && t !== TER.ROCK; };

    // land components so all bases share a landmass when possible
    const lcomp = new Int32Array(N).fill(-1), lsize = [];
    for (let i = 0; i < N; i++) {
      if (lcomp[i] >= 0 || !goodGround(i % W, (i / W) | 0)) continue;
      const id = lsize.length; let n = 0; const st = [i]; lcomp[i] = id;
      while (st.length) { const c = st.pop(); n++; const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = cx + dx, y = cy + dy; if (!goodGround(x, y)) continue; const j = idx(x, y); if (lcomp[j] < 0) { lcomp[j] = id; st.push(j); } } }
      lsize.push(n);
    }
    let mainLand = 0; for (let i = 1; i < lsize.length; i++) if (lsize[i] > lsize[mainLand]) mainLand = i;

    /* ---- 3b. real cities of the theatre (placed after the bases, which keep clear of them) ---- */
    const realList = [];
    if (useEarth) {
      const rc = Earth.rect(M.geo), capN = Math.max(6, Math.round(Ar / 14));
      for (const c of Earth.citiesIn(rc).sort((p, q) => q.pop - p.pop).slice(0, capN)) {
        const popK = Math.max(8, c.pop), rk = Math.sqrt((popK * 1000 / 6500) / Math.PI), big = c.pop >= 300 || (c.cap && c.pop >= 150), kind = big ? 'city' : c.pop >= 90 ? 'town' : 'village';
        const R = kind === 'city' ? U.clamp(Math.round(rk / M.km), 4, 14) : kind === 'town' ? U.clamp(Math.round(rk / M.km), 3, 8) : 3;
        realList.push({ c, kind, R, x: ((c.lon - rc.lon0) / (rc.lon1 - rc.lon0)) * W, y: ((rc.lat1 - c.lat) / (rc.lat1 - rc.lat0)) * H });
      }
    }

    /* ---- 4. base sites ---- */
    const reserved = new Uint8Array(N);
    const clearArea = (cx, cy, rad) => { for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) { if (!inb(x, y)) continue; const d = Math.hypot(x - cx, y - cy); if (d > rad) continue; const i = idx(x, y); if (M.terr[i] === TER.DEEP || M.terr[i] === TER.SHALLOW) continue; M.terr[i] = flatType; M.hgt[i] = U.lerp(M.hgt[i], 0.5, 0.75); M.tree[i] = 0; if (d < rad - 2) reserved[i] = 1; } };
    const areaOK = (cx, cy, rad, strict) => { for (let y = cy - rad; y <= cy + rad; y += 2) for (let x = cx - rad; x <= cx + rad; x += 2) { if (Math.hypot(x - cx, y - cy) > rad) continue; if (!inb(x, y)) return false; const t = M.terr[idx(x, y)]; if (t === TER.DEEP || t === TER.SHALLOW || (strict && t === TER.ROCK)) return false; } return true; };
    const nF = o.factions || 2, ringX = W * (nF > 2 ? 0.36 : 0.34), ringY = H * (nF > 2 ? 0.36 : 0.34);
    const ps = o.playerStart, ang0 = ps ? Math.atan2(ps.fy - 0.5, ps.fx - 0.5) : r() * Math.PI * 2;
    for (let f = 0; f < nF; f++) {
      const a = ang0 + (f / nF) * Math.PI * 2;
      let ax = W / 2 + Math.cos(a) * ringX, ay = H / 2 + Math.sin(a) * ringY;
      if (f === 0 && ps) { ax = U.clamp(ps.fx, 0.08, 0.92) * W; ay = U.clamp(ps.fy, 0.08, 0.92) * H; }
      const wantComp = f > 0 && M.starts[0] ? lcomp[idx(M.starts[0].x, M.starts[0].y)] : mainLand;
      let best = null, bdist = 1e9;
      for (let y = 10; y < H - 10; y += 2) for (let x = 10; x < W - 10; x += 2) {
        let d = Math.hypot(x - ax, y - ay) + (lcomp[idx(x, y)] !== wantComp && (o.type !== 'archipelago') ? Sm * 0.25 : 0); if (M.ctry && f > 0 && M.starts.some((q) => M.ctry[idx(q.x, q.y)] === M.ctry[idx(x, y)])) d += Sm * 0.2; if (d > bdist || d > Sm * 0.6) continue;
        if (o.type !== 'archipelago' && !T.earth && lcomp[idx(x, y)] !== mainLand) continue;
        if (T.earth && f === 0 && ps && d > Sm * 0.2) continue;
        if (!areaOK(x, y, 7, false)) continue;
        if (realList.some((q) => Math.hypot(q.x - x, q.y - y) < q.R + 12)) continue;
        if (M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < Sm * (nF > 3 ? 0.24 : 0.3))) continue;
        bdist = d; best = { x, y };
      }
      if (!best) best = { x: Math.round(U.clamp(ax, 12, W - 12)), y: Math.round(U.clamp(ay, 12, H - 12)) };
      M.starts.push(best); clearArea(best.x, best.y, 10);
    }

    /* ---- 5. settlements: real cities sized by population on Earth maps, generated towns elsewhere ---- */
    const names = TOWN_NAMES.slice(); for (let i = names.length - 1; i > 0; i--) { const j = r.int(i + 1); [names[i], names[j]] = [names[j], names[i]]; }
    let nameI = 0;
    const tryTown = (town, cx0, cy0, search) => {
      const R = town.r;
      for (let k = 0; k < (search ? 80 : 500); k++) {
        let x, y;
        if (search) { const a = r() * 6.283, d = Math.sqrt(r()) * search; x = Math.round(cx0 + Math.cos(a) * d); y = Math.round(cy0 + Math.sin(a) * d); }
        else { x = 8 + r.int(W - 16); y = 8 + r.int(H - 16); }
        if (x < 6 || y < 6 || x > W - 7 || y > H - 7) continue;
        if (!areaOK(x, y, town.real ? 3 : Math.max(3, R - 3), true)) continue;
        if (M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < (town.real ? R + 9 : R + 15))) continue;
        if (M.towns.some((q) => Math.hypot(q.cx - x, q.cy - y) < (town.real ? (q.r + R) * 0.8 + 2 : q.r + R + 5))) continue;
        town.cx = x; town.cy = y; town.idx = M.towns.length; if (M.ctry) town.ctry = M.ctry[idx(x, y)];
        M.towns.push(town); layoutTown(M, town, r, n3, reserved, idx, inb, goodGround); return true;
      }
      return false;
    };
    if (useEarth) {
      let nReal = 0;
      for (const q of realList) {
        const c = q.c, town = { name: c.name, kind: q.kind, r: q.R, cx: 0, cy: 0, idx: 0, real: true, pop: c.pop, capital: c.cap, lat: c.lat, lon: c.lon };
        if (tryTown(town, q.x, q.y, Math.max(6, q.R * 1.1))) nReal++;
      }
      const nFill = Math.round(Ar / 22);
      for (let t = 0; t < nFill; t++) { const kind = t < Math.round(nFill * 0.2) ? 'town' : 'village', R = kind === 'town' ? 5 : 3; tryTown({ name: names[nameI++ % names.length] + (nameI > names.length ? ' ' + Math.ceil(nameI / names.length) : ''), kind, r: R }, 0, 0, 0); }
    } else {
      const nTowns = Math.max(3, Math.round(W / 34));
      for (let t = 0; t < nTowns; t++) {
        const kind = t === 0 ? 'city' : t < 3 ? 'town' : 'village';
        const R = kind === 'city' ? (W <= 128 ? 6 : 8) : kind === 'town' ? 5 : 3;
        // prefer sites near the centre (cities) and coasts, as before
        let best = null, bs = -1e9;
        for (let k = 0; k < 500; k++) {
          const x = 8 + r.int(W - 16), y = 8 + r.int(H - 16);
          if (!areaOK(x, y, Math.max(3, R - 3), true)) continue;
          if (M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < R + 15)) continue;
          if (M.towns.some((q) => Math.hypot(q.cx - x, q.cy - y) < q.r + R + 7)) continue;
          let sc2 = r() * 10 - Math.hypot(x - W / 2, y - H / 2) * (kind === 'city' ? 0.25 : 0.02);
          if (kind === 'city' && bd[idx(x, y)] < 255) sc2 += 6;
          if (sc2 > bs) { bs = sc2; best = { x, y }; }
        }
        if (!best) continue;
        const town = { name: names[t % names.length], kind, cx: best.x, cy: best.y, r: R, idx: M.towns.length };
        M.towns.push(town);
        layoutTown(M, town, r, n3, reserved, idx, inb, goodGround);
      }
    }

    /* ---- 6. civil power station + grid ---- */
    const plan = M.plan.civb;
    const footFree = (tx, ty, w, h) => { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) { if (!goodGround(x, y)) return false; const i = idx(x, y); if (reserved[i] || M.road[i] || M.rail[i]) return false; } return true; };
    const reserve = (tx, ty, w, h) => { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) { const i = idx(x, y); reserved[i] = 1; M.tree[i] = 0; } };
    const placeNear = (type, cx, cy, rmin, rmax, town, extra) => {
      const d = CIVB[type];
      for (let k = 0; k < 300; k++) { const a = r() * Math.PI * 2, rr2 = r.range(rmin, rmax), x = Math.round(cx + Math.cos(a) * rr2), y = Math.round(cy + Math.sin(a) * rr2);
        if (footFree(x, y, d.w, d.h) && (!extra || extra(x, y))) { reserve(x, y, d.w, d.h); const p = { type, tx: x, ty: y, town, v: r.int(7) }; plan.push(p); return p; } }
      return null;
    };
    const city = M.towns[0];
    if (city) {
      const ps = placeNear('powerstation', city.cx, city.cy, city.r + 3, city.r + 9, 0);
      if (ps) for (const p of plan) if (p.type === 'substation') {
        const ax = ps.tx + 1.5, ay = ps.ty + 1, bx = p.tx + 1, by = p.ty + 1, L = Math.hypot(bx - ax, by - ay); if (L > W * 0.75) continue;
        const n = Math.max(1, Math.round(L / 5)); let px = ax, py = ay;
        for (let s = 1; s <= n; s++) { const qx = U.lerp(ax, bx, s / n), qy = U.lerp(ay, by, s / n); M.poles.push([px, py, qx, qy]); px = qx; py = qy; }
      }
    }

    /* ---- 7. airport + harbour ---- */
    if (city && Ar >= 120) {
      for (let k = 0; k < 400; k++) {
        const a = r() * Math.PI * 2, d = r.range(city.r + 5, city.r + 16), x = Math.round(city.cx + Math.cos(a) * d) - 9, y = Math.round(city.cy + Math.sin(a) * d);
        if (!footFree(x, y, 19, 6)) continue;
        reserve(x, y, 19, 3); for (let yy = y; yy < y + 6; yy++) for (let xx = x; xx < x + 19; xx++) { const i = idx(xx, yy); M.terr[i] = flatType === TER.DESERT ? TER.DESERT : TER.GRASS; M.tree[i] = 0; }
        M.props.push({ t: 'runway', x, y, w: 19, h: 3 });
        plan.push({ type: 'airport', tx: x + 3, ty: y + 4, town: 0, v: 0 }); reserve(x + 3, y + 4, 4, 2);
        city.airport = { x: x + 5, y: y + 6 };
        break;
      }
    }
    if (city) {
      let done = false;
      for (let rr2 = 2; rr2 < city.r + 10 && !done; rr2++) for (let k = 0; k < 40 && !done; k++) {
        const a = r() * Math.PI * 2, x = Math.round(city.cx + Math.cos(a) * rr2), y = Math.round(city.cy + Math.sin(a) * rr2);
        if (!footFree(x, y, 3, 2)) continue;
        let wet = 0; for (let xx = x; xx < x + 3; xx++) { const j = idx(xx, y + 2); if (inb(xx, y + 2) && bigWater(j)) wet++; }
        if (wet < 2) continue;
        reserve(x, y, 3, 2); plan.push({ type: 'port', tx: x, ty: y, town: 0, v: 0 });
        M.props.push({ t: 'pier', x: x + 0.3, y: y + 2, w: 0.7, h: 2.5 }, { t: 'pier', x: x + 2, y: y + 2, w: 0.7, h: 3 }); done = true; city.port = { x: x + 1, y: y - 1 };
      }
    }

    /* ---- 8. highways ---- */
    const nodes = [];
    for (const t of M.towns) { const c = nearestRoad(M, t.cx, t.cy, 6) || { x: t.cx, y: t.cy }; nodes.push(c); }
    for (const s of M.starts) nodes.push({ x: s.x, y: s.y + 4 });
    if (city && city.airport) nodes.push(city.airport);
    if (city && city.port) nodes.push(city.port);
    const edges = [], inT = [0];
    const used = new Set();
    while (inT.length < nodes.length) {
      let bi = -1, bj = -1, bdd = 1e9;
      for (const i of inT) for (let j = 0; j < nodes.length; j++) { if (inT.includes(j)) continue; const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y); if (d < bdd) { bdd = d; bi = i; bj = j; } }
      if (bj < 0) break; inT.push(bj); edges.push([bi, bj]); used.add(bi + ',' + bj);
    }
    for (let e = 0; e < Math.max(1, (nodes.length / 4) | 0); e++) { const i = r.int(nodes.length), j = r.int(nodes.length); if (i !== j && !used.has(i + ',' + j) && !used.has(j + ',' + i)) edges.push([i, j]); }
    const roadCost = (i) => { const t = M.terr[i]; if (M.road[i]) return 0.35; if (reserved[i] && !M.road[i]) return 40; return [22, 16, 1.6, 1, 2.6, 1.15, 14, 1.4, 1, 3][t] + (M.rail[i] ? 1.5 : 0); };
    for (const [a, b] of edges) {
      const p = astarGen(M, nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y, roadCost); if (!p) continue;
      let span = null;
      for (const i of p) {
        const t = M.terr[i];
        if (t === TER.DEEP || t === TER.SHALLOW) { M.road[i] = 3; M.tree[i] = 0; if (!span) { span = { tiles: [], rail: false }; M.plan.bridges.push(span); } span.tiles.push(i); }
        else { if (!M.road[i]) M.road[i] = 2; if (M.road[i] === 3) { /* existing bridge */ } M.tree[i] = 0; if (t === TER.ROCK || t === TER.FOREST || t === TER.MUD) M.terr[i] = t === TER.ROCK ? TER.DESERT : TER.GRASS; span = null; }
      }
    }

    /* ---- 9. railway ---- */
    if (M.towns.length >= 2 && Ar >= 120) {
      let far = 1; for (let i = 1; i < M.towns.length; i++) if (M.towns[i].kind !== 'village' && Math.hypot(M.towns[i].cx - city.cx, M.towns[i].cy - city.cy) > Math.hypot(M.towns[far].cx - city.cx, M.towns[far].cy - city.cy)) far = i;
      const tA = M.towns[0], tB = M.towns[far];
      const railCost = (i) => { const t = M.terr[i]; if (M.rail[i]) return 0.4; if (reserved[i]) return 60; return [26, 20, 2, 1, 3, 1.2, 30, 1.5, 2.5, 4][t] + (M.road[i] ? 4 : 0); };
      const sx = tA.cx + tA.r + 2, ex = tB.cx - tB.r - 2;
      const p = astarGen(M, U.clamp(sx, 1, W - 2), tA.cy + 1, U.clamp(ex, 1, W - 2), tB.cy + 1, railCost);
      if (p && p.length > 10) {
        let span = null;
        for (const i of p) { const t = M.terr[i]; M.tree[i] = 0;
          if (t === TER.DEEP || t === TER.SHALLOW) { M.rail[i] = 2; if (M.road[i] === 3) { /* shared crossing */ } if (!span) { span = { tiles: [], rail: true }; M.plan.bridges.push(span); } span.tiles.push(i); }
          else { M.rail[i] = 1; span = null; } }
        M.railPath = p;
        const st = p[Math.min(4, p.length - 1)]; const sx2 = st % W, sy2 = (st / W) | 0;
        for (const [ox, oy] of [[0, -2], [0, 1], [-1, -2], [-1, 1]]) if (footFree(sx2 + ox, sy2 + oy, 3, 1)) { reserve(sx2 + ox, sy2 + oy, 3, 1); plan.push({ type: 'station', tx: sx2 + ox, ty: sy2 + oy, town: 0, v: 0 }); break; }
      }
    }

    /* ---- 10. roadside and countryside structures ---- */
    const hw = []; for (let i = 0; i < N; i++) if (M.road[i] === 2) hw.push(i);
    const roadside = (type, count, minGap) => {
      const spots = []; let tries = 0;
      while (spots.length < count && tries++ < count * 60 && hw.length) {
        const i = hw[r.int(hw.length)], x = i % W, y = (i / W) | 0;
        if (spots.some((s) => Math.hypot(s[0] - x, s[1] - y) < minGap) || M.towns.some((t) => Math.hypot(t.cx - x, t.cy - y) < t.r + 2) || M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 12)) continue;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (footFree(x + ox, y + oy, 1, 1)) { reserve(x + ox, y + oy, 1, 1); plan.push({ type, tx: x + ox, ty: y + oy, town: -1, v: r.int(7) }); spots.push([x, y]); break; }
      }
    };
    roadside('fuelstation', Math.round(Ar / 40), 24);
    roadside('checkpoint', Math.round(Ar / 50) + 1, 30);
    for (let k = 0, made = 0; k < 300 && made < Math.round(Ar / 35); k++) {
      const x = r.int(W), y = r.int(H), i = idx(x, y);
      if (M.hgt[i] < 0.62 || M.hgt[i] >= ROCKH || !footFree(x, y, 1, 1)) continue;
      if (M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 12)) continue;
      reserve(x, y, 1, 1); plan.push({ type: 'commtower', tx: x, ty: y, town: -1, v: 0 }); made++;
    }
    // ruins: abandoned hamlets
    for (let k = 0; k < Math.round(Ar / 50) + 1; k++) {
      const x = 6 + r.int(W - 12), y = 6 + r.int(H - 12);
      if (!areaOK(x, y, 3, true) || M.towns.some((t) => Math.hypot(t.cx - x, t.cy - y) < t.r + 5) || M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 14)) continue;
      const n = 3 + r.int(4);
      for (let j = 0; j < n; j++) { const px = x + r.int(7) - 3, py = y + r.int(7) - 3; if (footFree(px, py, 1, 1)) { reserve(px, py, 1, 1); plan.push({ type: 'ruin', tx: px, ty: py, town: -1, v: r.int(4), abandoned: true }); } }
    }

    /* ---- 11. resources ---- */
    const oreBlob = (cx, cy, rad, amt) => { for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) { if (!goodGround(x, y)) continue; const d = Math.hypot(x - cx, y - cy) + (n3.v(x * 0.4, y * 0.4) - 0.5) * 2; if (d > rad) continue; const i = idx(x, y); if (reserved[i] || M.road[i] || M.rail[i]) continue; M.ore[i] = Math.round(amt * (1 - d / (rad + 1)) + 120); M.tree[i] = 0; } };
    const ringSpot = (cx, cy, rmin, rmax, ok) => { for (let k = 0; k < 200; k++) { const a = r() * Math.PI * 2, d = r.range(rmin, rmax), x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d); if (ok(x, y)) return { x, y }; } return null; };
    const metal = (x, y) => { for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) { if (inb(xx, yy)) { const i = idx(xx, yy); if (!TER_INFO[M.terr[i]].water) { M.res[i] = 1; M.tree[i] = 0; if (M.terr[i] === TER.ROCK) M.terr[i] = flatType; } } } };
    const freeLand = (x, y, n) => { for (let yy = y; yy < y + n; yy++) for (let xx = x; xx < x + n; xx++) if (!goodGround(xx, yy) || reserved[idx(xx, yy)] || M.road[idx(xx, yy)]) return false; return true; };
    const derrick = (x, y, town) => { reserve(x, y, 1, 1); M.res[idx(x, y)] = 2; plan.push({ type: 'derrick', tx: x, ty: y, town: -1, v: 0 }); };
    for (const s of M.starts) {
      for (let k = 0; k < 2; k++) { const p = ringSpot(s.x, s.y, 9, 13, (x, y) => freeLand(x - 2, y - 2, 5)); if (p) oreBlob(p.x, p.y, 3, 600); }
      const m = ringSpot(s.x, s.y, 9, 14, (x, y) => freeLand(x, y, 3)); if (m) metal(m.x, m.y);
      const d = ringSpot(s.x, s.y, 13, 19, (x, y) => freeLand(x, y, 1)); if (d) derrick(d.x, d.y);
    }
    const neutral = (n, fn) => { for (let k = 0, made = 0; k < n * 40 && made < n; k++) { const x = 4 + r.int(W - 8), y = 4 + r.int(H - 8); if (M.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 18)) continue; if (M.towns.some((t) => Math.hypot(t.cx - x, t.cy - y) < t.r + 3)) continue; if (fn(x, y)) made++; } };
    neutral(Math.round(Ar / 22), (x, y) => { if (!freeLand(x - 2, y - 2, 5)) return false; oreBlob(x, y, 2 + r.int(3), 700); return true; });
    neutral(Math.round(Ar / 40) + 1, (x, y) => { if (!freeLand(x, y, 3)) return false; metal(x, y); return true; });
    neutral(Math.round(Ar / 30) + (T.dry ? 3 : 1), (x, y) => { if (!freeLand(x, y, 1)) return false; derrick(x, y); return true; });

    /* ---- 12. trees ---- */
    for (let i = 0; i < N; i++) {
      if (reserved[i] || M.road[i] || M.rail[i] || M.ore[i] || M.res[i]) { M.tree[i] = 0; continue; }
      if (M.tree[i]) continue; // town yards keep their planted trees
      const t = M.terr[i];
      if (t === TER.FOREST) M.tree[i] = 2 + (hash2(i, 3, seed) > 0.5 ? 1 : 0);
      else if (t === TER.GRASS && hash2(i, 7, seed) < 0.05) M.tree[i] = 1;
      else if (t === TER.MUD && hash2(i, 9, seed) < 0.12) M.tree[i] = 1;
      else if (t === TER.DESERT && hash2(i, 5, seed) < 0.008) M.tree[i] = 1;
    }
    for (const s of M.starts) for (let y = s.y - 9; y <= s.y + 9; y++) for (let x = s.x - 9; x <= s.x + 9; x++) if (inb(x, y) && Math.hypot(x - s.x, y - s.y) < 9) M.tree[idx(x, y)] = 0;
    if (M.ctry) {
      const acc = {};
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const c = M.ctry[idx(x, y)]; if (!c || (M.terr[idx(x, y)] === TER.DEEP)) continue; const a = acc[c] || (acc[c] = { id: c, x: 0, y: 0, n: 0 }); a.x += x; a.y += y; a.n++; }
      M.cinfo = Object.values(acc).filter((a) => a.n > 12).map((a) => ({ id: a.id, name: Earth.countryName(a.id), x: a.x / a.n, y: a.y / a.n, n: a.n * 4 }));
    }
    return M;
  },

  blank(size, season) {
    const M = newMap(size, size); M.season = season || 'summer'; M.type = 'custom'; M.seed = 1;
    M.terr.fill(TER.GRASS); M.hgt.fill(0.5);
    M.starts = [{ x: 14, y: 14 }, { x: size - 15, y: size - 15 }, { x: size - 15, y: 14 }, { x: 14, y: size - 15 }];
    return M;
  },
};

function nearestRoad(M, cx, cy, rad) {
  let best = null, bd = 1e9;
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
    if (x < 0 || y < 0 || x >= M.w || y >= M.h) continue;
    if (!M.road[y * M.w + x]) continue;
    const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}

/* A* used only at generation time (roads, rails) */
function astarGen(M, sx, sy, tx, ty, cost) {
  const W = M.w, H = M.h, N = W * H;
  sx = U.clamp(Math.round(sx), 0, W - 1); sy = U.clamp(Math.round(sy), 0, H - 1); tx = U.clamp(Math.round(tx), 0, W - 1); ty = U.clamp(Math.round(ty), 0, H - 1);
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N), heap = new Heap();
  const s = sy * W + sx, t = ty * W + tx; g[s] = 0; heap.push(s, 0);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  let n = 0;
  while (heap.size) {
    const c = heap.pop(); if (c === t) break; if (closed[c]) continue; closed[c] = 1; if (++n > N) break;
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of D) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x; if (closed[j]) continue;
      const ng = g[c] + cost(j);
      if (ng < g[j]) { g[j] = ng; from[j] = c; heap.push(j, ng + (Math.abs(x - tx) + Math.abs(y - ty)) * 0.95); }
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const p = []; for (let c = t; c !== -1 && c !== s; c = from[c]) p.push(c); p.push(s); return p.reverse();
}

/* ---------- town layout ---------- */
function layoutTown(M, town, r, n3, reserved, idx, inb, goodGround) {
  const { cx, cy, r: R, kind } = town, W = M.w;
  const plan = M.plan.civb;
  const B = kind === 'city' ? 6 : 7;
  const inside = (x, y) => Math.hypot(x - cx, y - cy) / R + (n3.v(x * 0.17, y * 0.17) - 0.5) * 0.35 < 1;
  const okTile = (x, y) => goodGround(x, y) && !reserved[idx(x, y)];
  const put = (type, x, y) => {
    const d = CIVB[type];
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) { const i = idx(xx, yy); reserved[i] = 1; M.tree[i] = 0; if (M.terr[i] === TER.FOREST || M.terr[i] === TER.MUD) M.terr[i] = TER.GRASS; }
    plan.push({ type, tx: x, ty: y, town: town.idx, v: r.int(7) });
  };
  const fits = (type, x, y, x0, y0, x1, y1) => {
    const d = CIVB[type]; if (x < x0 || y < y0 || x + d.w > x1 || y + d.h > y1) return false;
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) { if (!okTile(xx, yy) || M.road[idx(xx, yy)]) return false; }
    return true;
  };
  if (kind === 'village') {
    const horiz = r.chance(0.5);
    for (let k = -R - 2; k <= R + 2; k++) { const x = horiz ? cx + k : cx, y = horiz ? cy : cy + k; if (goodGround(x, y)) { M.road[idx(x, y)] = 1; M.tree[idx(x, y)] = 0; } }
    for (let k = 1; k <= Math.ceil(R * 0.7); k++) { const x = horiz ? cx : cx + k, y = horiz ? cy + k : cy; if (goodGround(x, y)) { M.road[idx(x, y)] = 1; M.tree[idx(x, y)] = 0; } }
    const want = ['farmhouse', 'farmhouse', 'house', 'house', 'house', 'house', 'shop'];
    if (r.chance(0.6)) want.push('clinic'); if (r.chance(0.5)) want.push('school'); if (r.chance(0.5)) want.push('substation'); if (r.chance(0.4)) want.push('restaurant'); want.push('house', 'house', 'farmhouse');
    let wi = 0;
    for (let k = -R; k <= R && wi < want.length; k += 2) for (const side of [-1, 1]) {
      if (wi >= want.length) break; const t = want[wi], d = CIVB[t];
      const x = horiz ? cx + k : side < 0 ? cx - d.w : cx + 1, y = horiz ? (side < 0 ? cy - d.h : cy + 1) : cy + k;
      if (fits(t, x, y, 0, 0, W, M.h)) { put(t, x, y); wi++; }
    }
    // fields
    for (let f = 0; f < 4; f++) {
      const a = r() * Math.PI * 2, d = R + 2 + r.int(4), fx = Math.round(cx + Math.cos(a) * d) - 2, fy = Math.round(cy + Math.sin(a) * d) - 2, fw = 4 + r.int(3), fh = 3 + r.int(3);
      let ok = true; for (let y = fy; y < fy + fh && ok; y++) for (let x = fx; x < fx + fw; x++) if (!okTile(x, y) || M.road[idx(x, y)]) { ok = false; break; }
      if (!ok) continue;
      for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) { const i = idx(x, y); M.terr[i] = TER.FARM; M.tree[i] = 0; }
    }
    town.bounds = { x0: cx - R - 4, y0: cy - R - 4, x1: cx + R + 4, y1: cy + R + 4 };
    return;
  }
  // street grid
  const ox = cx - Math.floor(R / B) * B, oy = cy - Math.floor(R / B) * B;
  for (let y = cy - R - 1; y <= cy + R + 1; y++) for (let x = cx - R - 1; x <= cx + R + 1; x++) {
    if (!inb(x, y) || !inside(x, y) || !goodGround(x, y)) continue;
    const i = idx(x, y);
    if ((x - ox) % B === 0 || (y - oy) % B === 0) { M.road[i] = 1; M.tree[i] = 0; if (M.terr[i] !== TER.SAND) M.terr[i] = TER.GRASS; }
    const d = Math.hypot(x - cx, y - cy) / R;
    if (!M.road[i] && d < (kind === 'city' ? 0.72 : 0.42)) { M.terr[i] = TER.URBAN; M.tree[i] = 0; }
    else if (!M.road[i] && (M.terr[i] === TER.FOREST || M.terr[i] === TER.MUD)) M.terr[i] = TER.GRASS;
  }
  const specials = kind === 'city'
    ? ['cityhall', 'hospital', 'university', 'police', 'fire', 'school', 'school', 'bank', 'supermarket', 'supermarket', 'market', 'transit', 'waterplant', 'substation', 'substation', 'construction', 'clinic', 'restaurant', 'restaurant', 'restaurant', 'factory', 'factory', 'factory', 'warehouse', 'warehouse', 'warehouse']
    : ['cityhall', r.chance(0.5) ? 'hospital' : 'clinic', 'school', 'police', 'fire', 'supermarket', 'market', 'waterplant', 'substation', 'transit', 'construction', 'factory', 'warehouse', 'restaurant', 'restaurant'];
  const indAng = r() * Math.PI * 2;
  const fill = (zone) => {
    const roll = r();
    if (zone === 'core') return roll < 0.45 ? 'apartment' : roll < 0.7 ? 'shop' : roll < 0.85 ? 'restaurant' : 'apartment';
    if (zone === 'ind') return roll < 0.5 ? 'warehouse' : roll < 0.8 ? 'factory' : 'house';
    if (zone === 'mid') return roll < 0.35 ? 'apartment' : roll < 0.75 ? 'house' : 'shop';
    return roll < 0.88 ? 'house' : 'shop';
  };
  const blocks = [];
  for (let by = oy - B; by <= cy + R; by += B) for (let bx = ox - B; bx <= cx + R; bx += B) {
    const mx = bx + B / 2, my = by + B / 2; if (!inside(Math.round(mx), Math.round(my))) continue;
    blocks.push({ bx: bx + 1, by: by + 1, d: Math.hypot(mx - cx, my - cy) / R, a: Math.atan2(my - cy, mx - cx) });
  }
  blocks.sort((a, b) => a.d - b.d);
  for (const bl of blocks) {
    const zone = Math.abs(U.angDiff(bl.a, indAng)) < 0.7 && bl.d > 0.35 ? 'ind' : bl.d < 0.38 ? 'core' : bl.d < 0.7 ? 'mid' : 'outer';
    const x0 = bl.bx, y0 = bl.by, x1 = bl.bx + B - 1, y1 = bl.by + B - 1;
    let fails = 0;
    while (fails < 12) {
      let type, special = -1;
      if (specials.length && r.chance(0.7)) {
        special = specials.findIndex((s) => (zone === 'ind') === (CIVB[s].zone === 'ind' || s === 'construction'));
        if (special < 0) special = r.chance(0.3) ? 0 : -1;
        if (special >= 0) type = specials[special];
      }
      if (!type) type = fill(zone);
      const d = CIVB[type], cand = [];
      for (let y = y0; y <= y1 - d.h; y++) for (let x = x0; x <= x1 - d.w; x++) if (x === x0 || y === y0 || x + d.w === x1 || y + d.h === y1) cand.push([x, y]);
      for (let i = cand.length - 1; i > 0; i--) { const j = r.int(i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
      let placed = false;
      for (const [x, y] of cand) if (fits(type, x, y, x0, y0, x1, y1)) { put(type, x, y); placed = true; break; }
      if (placed) { if (special >= 0) specials.splice(special, 1); } else fails++;
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (!inb(x, y)) continue; const i = idx(x, y); if (!reserved[i] && !M.road[i] && goodGround(x, y) && r.chance(0.35)) M.tree[i] = 1; }
  }
  town.bounds = { x0: cx - R - 3, y0: cy - R - 3, x1: cx + R + 3, y1: cy + R + 3 };
}
