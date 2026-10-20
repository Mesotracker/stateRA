'use strict';
/* =====================================================================
   CITY.RA — sprites.js
   Procedural sprite atlas, drawn once at 3x resolution and cached:
   shaded and camouflaged vehicles with tracks, wheels, hatches and
   turrets; detailed infantry; aircraft and ships; buildings with lit
   roofs, texture and ambient occlusion; trees; soft particle puffs.

   REPLACING ART: put an image into SPR.overrides before the game starts:
     SPR.overrides['unit:mbt'] = 'assets/mbt.png';      // top-down, facing right
     SPR.overrides['bld:power'] = 'assets/power.png';   // footprint w*32 x h*32
     SPR.overrides['civ:house'] = 'assets/house.png';
   ===================================================================== */

const SPR = {
  S: 3,
  cache: new Map(),
  overrides: {},
  images: {},
  loadOverrides(done) {
    const keys = Object.keys(SPR.overrides);
    if (!keys.length) return done();
    let left = keys.length;
    for (const k of keys) {
      const img = new Image();
      img.onload = () => { SPR.images[k] = img; if (--left === 0) done(); };
      img.onerror = () => { if (--left === 0) done(); };
      img.src = SPR.overrides[k];
    }
  },
};

const ARCH = {
  modern: { wall: '#7d8693', roof: '#a7b0bb', roof2: '#8b95a3', rad: 2, trim: '#5d6672' },
  brutal: { wall: '#5d5953', roof: '#87817a', roof2: '#6c675f', rad: 0, trim: '#45413c' },
  harbor: { wall: '#b4bdb9', roof: '#e1e6e3', roof2: '#b4c0bb', rad: 5, trim: '#8f9c97' },
  timber: { wall: '#6b4f34', roof: '#8a6a44', roof2: '#6a4f33', rad: 1, trim: '#4a3624' },
};
const CAMO = {
  meridian: ['#6f7b73', '#58645c', '#8a948b', '#4a544d'],
  steppe: ['#6f6b46', '#575431', '#8c855a', '#45422a'],
  league: ['#8b9590', '#717c78', '#a6aea9', '#5d6764'],
  highland: ['#6a6e44', '#4e5535', '#8a7a52', '#3f432c'],
};

/* ---------- primitives ---------- */
function rr(x, X, Y, W, H, r) {
  r = Math.max(0, Math.min(r, W / 2, H / 2));
  x.beginPath(); x.moveTo(X + r, Y); x.lineTo(X + W - r, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + r);
  x.lineTo(X + W, Y + H - r); x.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H); x.lineTo(X + r, Y + H);
  x.quadraticCurveTo(X, Y + H, X, Y + H - r); x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y); x.closePath();
}
function fillRR(x, X, Y, W, H, r, fill, stroke, lw) { rr(x, X, Y, W, H, r); x.fillStyle = fill; x.fill(); if (stroke) { x.lineWidth = lw || 1; x.strokeStyle = stroke; x.stroke(); } }
function circ(x, X, Y, R, fill, stroke, lw) { x.beginPath(); x.arc(X, Y, Math.max(0.1, R), 0, Math.PI * 2); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.lineWidth = lw || 1; x.strokeStyle = stroke; x.stroke(); } }
function line(x, a, b, c, d, col, w) { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.strokeStyle = col; x.lineWidth = w || 1; x.stroke(); }
function poly(x, pts, fill, stroke, lw) { x.beginPath(); x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath(); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 1; x.stroke(); } }
function polyPath(x, pts) { x.beginPath(); x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath(); }
function lg(x, x0, y0, x1, y1, stops) { const g = x.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => g.addColorStop(Array.isArray(c) ? c[0] : i / (stops.length - 1), Array.isArray(c) ? c[1] : c)); return g; }
function rg(x, cx, cy, r0, r1, stops) { const g = x.createRadialGradient(cx, cy, r0, cx, cy, r1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
function mk(w, h) {
  const c = U.canvas(w * SPR.S, h * SPR.S), x = c.getContext('2d');
  x.scale(SPR.S, SPR.S); x.lineJoin = 'round'; x.lineCap = 'round';
  return { c, x, w, h };
}
function centered(L, W, pad = 5) { const s = mk(L + pad * 2, W + pad * 2); s.x.translate(s.w / 2, s.h / 2); return s; }
function silhouette(src, col, blur) {
  const c = U.canvas(src.width, src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
  if (blur) { const c2 = U.canvas(src.width, src.height), x2 = c2.getContext('2d'); x2.filter = 'blur(' + blur + 'px)'; x2.drawImage(c, 0, 0); if (x2.filter !== 'none') return c2; }
  return c;
}
function hazard(x, X, Y, W, H) {
  x.save(); rr(x, X, Y, W, H, 0); x.clip(); x.fillStyle = '#d9b43a'; x.fillRect(X, Y, W, H);
  x.strokeStyle = '#222'; x.lineWidth = 2;
  for (let i = -H; i < W + H; i += 5) { x.beginPath(); x.moveTo(X + i, Y + H); x.lineTo(X + i + H, Y); x.stroke(); }
  x.restore();
}
/* grain texture used to roughen every sprite */
SPR.noise = (function () {
  let c = null;
  return function () {
    if (c) return c; c = U.canvas(96, 96); const g = c.getContext('2d'), img = g.createImageData(96, 96), r = RNG(91);
    for (let i = 0; i < 96 * 96; i++) { const v = 100 + r() * 155; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0); return c;
  };
})();
function grit(s, a = 0.16) {
  const c = s.c, w = c.width, h = c.height, t = U.canvas(w, h), g = t.getContext('2d');
  g.fillStyle = g.createPattern(SPR.noise(), 'repeat'); g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(c, 0, 0);
  const x = c.getContext('2d'); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = a; x.globalCompositeOperation = 'overlay'; x.drawImage(t, 0, 0); x.restore();
}
function camo(x, pathFn, cols, seed, scale = 1) {
  x.save(); pathFn(); x.clip();
  const r = RNG(seed);
  for (let i = 0; i < 26; i++) {
    const cx = r.range(-24, 24) * scale, cy = r.range(-14, 14) * scale, rad = r.range(2.5, 6) * scale;
    x.fillStyle = cols[1 + (i % 3)]; x.globalAlpha = 0.55;
    x.beginPath(); for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, rr2 = rad * (0.6 + r() * 0.6); k ? x.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2 * 0.7) : x.moveTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2 * 0.7); } x.closePath(); x.fill();
  }
  x.globalAlpha = 1; x.restore();
}
function sheen(x, pathFn, L, W, k = 1) {
  // light from the upper left: top-left highlight, bottom-right shade
  x.save(); pathFn(); x.clip();
  x.fillStyle = lg(x, -L / 2, -W / 2, L / 3, W / 2, ['rgba(255,255,255,' + 0.22 * k + ')', 'rgba(255,255,255,0)', 'rgba(0,0,0,' + 0.28 * k + ')']);
  x.fillRect(-L, -W, L * 2, W * 2); x.restore();
}

/* ---------- unit colours ---------- */
SPR.unitColors = function (fk) {
  const F = FACTIONS[fk], cam = CAMO[fk];
  return { base: COL.mix(cam[0], F.color, 0.1), cam, fc: F.color, dark: F.dark, light: F.light };
};

SPR.unit = function (key, fk) {
  const ck = 'u:' + key + ':' + fk;
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const P = SPR.unitColors(fk), d = UNITS[key];
  let out;
  if (d.cat === 'inf') out = drawInfantry(key, P);
  else if (d.cat === 'air') out = drawAir(key, P);
  else if (d.cat === 'sea') out = drawShip(key, P);
  else out = drawVehicle(key, P);
  const ov = SPR.images['unit:' + key];
  if (ov) { const s = mk(out.w, out.h); s.x.drawImage(ov, 0, 0, out.w, out.h); out.body = s.c; out.tur = null; }
  if (!out.inf) out.shadow = silhouette(out.body, d.cat === 'air' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.38)', d.cat === 'air' ? 3 : 2);
  if (out.tur) out.turShadow = silhouette(out.tur, 'rgba(0,0,0,0.3)', 2);
  out.wreck = silhouette(out.body, 'rgba(26,22,20,0.92)');
  SPR.cache.set(ck, out);
  return out;
};

/* ---------- vehicle parts ---------- */
function tracks(x, L, W, tw = 5.4, skirt, base) {
  for (const s of [-1, 1]) {
    const y = s * (W / 2 - tw / 2);
    fillRR(x, -L / 2, y - tw / 2, L, tw, 1.6, lg(x, 0, y - tw / 2, 0, y + tw / 2, ['#2b2a27', '#1a1917', '#2b2a27']));
    x.lineWidth = 0.55;
    for (let i = -L / 2 + 1; i < L / 2 - 0.5; i += 1.5) { x.strokeStyle = (Math.round(i * 2) & 1) ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.35)'; x.beginPath(); x.moveTo(i, y - tw / 2 + 0.4); x.lineTo(i, y + tw / 2 - 0.4); x.stroke(); }
    if (skirt) {
      const sy = s > 0 ? y + tw / 2 - 2.2 : y - tw / 2;
      fillRR(x, -L / 2 + 1.5, sy, L - 3, 2.2, 0.6, COL.shade(base, -0.12), COL.shade(base, -0.45), 0.4);
      for (let i = 1; i < 5; i++) line(x, -L / 2 + 1.5 + (i * (L - 3)) / 5, sy + 0.2, -L / 2 + 1.5 + (i * (L - 3)) / 5, sy + 2, 'rgba(0,0,0,0.3)', 0.4);
    } else for (let i = 0; i < 6; i++) { const px = -L / 2 + 2.5 + (i * (L - 5)) / 5; circ(x, px, y, tw * 0.32, '#3b3a36', '#141412', 0.4); circ(x, px, y, tw * 0.12, '#55524c'); }
  }
}
function wheels(x, L, W, n) {
  for (let i = 0; i < n; i++) {
    const px = -L / 2 + 3.2 + (i * (L - 6.4)) / Math.max(1, n - 1);
    for (const s of [-1, 1]) { fillRR(x, px - 2.4, s * (W / 2 - 0.6) - 1.7, 4.8, 3.4, 1.2, lg(x, px - 2.4, 0, px + 2.4, 0, ['#2a2a28', '#151514', '#2a2a28']), '#0c0c0b', 0.4); line(x, px - 1.6, s * (W / 2 - 0.6), px + 1.6, s * (W / 2 - 0.6), 'rgba(255,255,255,0.12)', 0.5); }
  }
}
function hullShape(L, W, kind) {
  if (kind === 'wedge') return [L / 2 - 5, -W / 2, L / 2, -W / 2 + 2.5, L / 2, W / 2 - 2.5, L / 2 - 5, W / 2, -L / 2 + 1, W / 2, -L / 2, W / 2 - 1, -L / 2, -W / 2 + 1, -L / 2 + 1, -W / 2];
  if (kind === 'apc') return [L / 2 - 6, -W / 2, L / 2, -W / 2 + 3, L / 2, W / 2 - 3, L / 2 - 6, W / 2, -L / 2, W / 2, -L / 2, -W / 2];
  return [L / 2 - 1.5, -W / 2, L / 2, -W / 2 + 1.5, L / 2, W / 2 - 1.5, L / 2 - 1.5, W / 2, -L / 2 + 1.5, W / 2, -L / 2, W / 2 - 1.5, -L / 2, -W / 2 + 1.5, -L / 2 + 1.5, -W / 2];
}
function hull(x, L, W, P, kind = 'box', seed = 1, o = {}) {
  const pts = hullShape(L, W, kind), path = () => polyPath(x, pts);
  path(); x.fillStyle = P.base; x.fill();
  camo(x, path, P.cam, seed, L / 30);
  sheen(x, path, L, W, 1.1);
  path(); x.strokeStyle = COL.shade(P.base, -0.55); x.lineWidth = 0.7; x.stroke();
  // glacis plate and engine deck
  if (kind !== 'box') { x.save(); path(); x.clip(); x.fillStyle = 'rgba(255,255,255,0.1)'; x.fillRect(L / 2 - 5, -W, 6, W * 2); x.restore(); line(x, L / 2 - 5, -W / 2 + 0.6, L / 2 - 5, W / 2 - 0.6, 'rgba(0,0,0,0.3)', 0.6); }
  if (o.deck !== false) {
    const dx = -L / 2 + 1.5, dw = Math.min(9, L * 0.3);
    fillRR(x, dx, -W / 2 + 2.2, dw, W - 4.4, 0.6, 'rgba(0,0,0,0.18)');
    for (let i = 0; i < 6; i++) line(x, dx + 1 + i * (dw - 2) / 5, -W / 2 + 2.8, dx + 1 + i * (dw - 2) / 5, W / 2 - 2.8, 'rgba(0,0,0,0.4)', 0.45);
    circ(x, -L / 2 + 0.8, W / 2 - 3, 0.9, '#1a1a18');
  }
  // headlights and tools
  fillRR(x, L / 2 - 1.4, -W / 2 + 1, 1, 1.6, 0.3, '#e6e2c8'); fillRR(x, L / 2 - 1.4, W / 2 - 2.6, 1, 1.6, 0.3, '#e6e2c8');
  line(x, -L / 4, -W / 2 + 1.2, L / 6, -W / 2 + 1.2, 'rgba(30,26,20,0.7)', 0.5);
  return path;
}
function barrel(x, x0, len, w, col, brake = true) {
  fillRR(x, x0, -w / 2, len, w, w / 2, lg(x, 0, -w / 2, 0, w / 2, [COL.shade(col, 0.15), COL.shade(col, -0.25), COL.shade(col, -0.55)]));
  if (len > 10) fillRR(x, x0 + len * 0.45, -w * 0.8, len * 0.16, w * 1.6, w * 0.7, COL.shade(col, -0.3));
  if (brake) fillRR(x, x0 + len - w * 1.4, -w * 0.85, w * 1.5, w * 1.7, 0.4, COL.shade(col, -0.4));
}
function turret(x, r, bl, bw, P, o = {}) {
  const b = P.base;
  if (bl) barrel(x, r * 0.5, bl + r * 0.5, bw, '#4b4a42');
  const pts = o.round ? null : [r * 1.15, -r * 0.55, r * 0.7, -r * 0.95, -r * 0.9, -r * 0.95, -r * 1.25, -r * 0.6, -r * 1.25, r * 0.6, -r * 0.9, r * 0.95, r * 0.7, r * 0.95, r * 1.15, r * 0.55];
  const path = () => { if (pts) polyPath(x, pts); else { x.beginPath(); x.ellipse(0, 0, r * 1.1, r, 0, 0, Math.PI * 2); } };
  path(); x.fillStyle = COL.shade(b, 0.04); x.fill();
  camo(x, path, P.cam, 7 + r * 3, r / 9);
  sheen(x, path, r * 2.4, r * 2, 1.3);
  path(); x.strokeStyle = COL.shade(b, -0.6); x.lineWidth = 0.7; x.stroke();
  // mantlet
  if (bl) fillRR(x, r * 0.75, -bw * 1.2, r * 0.5, bw * 2.4, 0.6, COL.shade(b, -0.25));
  // commander cupola + loader hatch
  circ(x, -r * 0.25, -r * 0.42, r * 0.33, lg(x, -r * 0.5, -r * 0.7, 0, -r * 0.1, [COL.shade(b, 0.25), COL.shade(b, -0.25)]), COL.shade(b, -0.6), 0.5);
  circ(x, -r * 0.25, -r * 0.42, r * 0.15, '#2b2c2a');
  fillRR(x, -r * 0.45, r * 0.15, r * 0.5, r * 0.4, 0.4, COL.shade(b, -0.12), COL.shade(b, -0.5), 0.35);
  // smoke dischargers
  for (const sy of [-1, 1]) for (let i = 0; i < 3; i++) circ(x, r * 0.55 - i * 0.9, sy * (r * 0.9 + 0.2), 0.45, '#2a2a28');
  // antenna and bustle
  line(x, -r * 1.05, -r * 0.6, -r * 1.05 - 6, -r * 0.75, 'rgba(20,20,20,0.75)', 0.4);
  if (!o.noBustle) fillRR(x, -r * 1.55, -r * 0.6, r * 0.35, r * 1.2, 0.5, 'rgba(40,36,28,0.55)');
  circ(x, -r * 0.8, r * 0.55, 0.9, P.fc);
}
function cab(x, X, Y, W, H, col) {
  fillRR(x, X, Y, W, H, 1.2, lg(x, X, Y, X + W, Y + H, [COL.shade(col, 0.2), COL.shade(col, -0.2)]), COL.shade(col, -0.5), 0.5);
  fillRR(x, X + W - 2.2, Y + 0.8, 1.6, H - 1.6, 0.5, lg(x, X + W - 2, Y, X + W, Y + H, ['#a8cbe0', '#456f8c']));
}

function drawVehicle(key, P) {
  const b = P.base;
  let L = 26, W = 15, s, t = null, tox = 0;
  const T = (len, wid, fn) => { const ts = centered(len, wid, 3); fn(ts.x); grit(ts, 0.12); return ts; };
  const std = (r, bl, bw, o = {}) => T((r + bl) * 2 + 4, r * 2.6, (x) => turret(x, r, bl, bw, P, o));
  const rws = (r, gun, o = {}) => T((r + 10) * 2, r * 2.6, (x) => { // remote weapon station
    barrel(x, 0, gun, 1.1, '#2c2c2a', false); fillRR(x, -r, -r * 0.8, r * 1.8, r * 1.6, 0.8, COL.shade(b, -0.05), COL.shade(b, -0.6), 0.5); sheen(x, () => rr(x, -r, -r * 0.8, r * 1.8, r * 1.6, 0.8), r * 2, r * 2); circ(x, -r * 0.2, r * 0.3, 0.7, '#9fc3d8'); });
  switch (key) {
    case 'harvester': L = 31; W = 21; s = centered(L, W); tracks(s.x, L, W, 5.4); hull(s.x, L - 2, W - 5, { ...P, base: '#9a854c', cam: ['#9a854c', '#8a7642', '#a9935a', '#7a6838'] }, 'box', 3, { deck: false });
      fillRR(s.x, -L / 2 + 2, -W / 2 + 3.5, L - 12, W - 7, 1.4, lg(s.x, 0, -6, 0, 6, ['#5a5040', '#3a342a'])); for (let i = 0; i < 14; i++) circ(s.x, -L / 2 + 4 + (i % 5) * 3.6, -4.5 + ((i / 5) | 0) * 4, 1.6 + (i % 3) * 0.3, i % 2 ? '#e0c050' : '#c8a838');
      cab(s.x, L / 2 - 9, -W / 2 + 3.5, 7.5, W - 7, P.fc); line(s.x, -L / 2 + 1, -W / 2 + 3, L / 2 - 10, -W / 2 + 3, '#2a2a28', 0.6); break;
    case 'jeep': L = 20; W = 11.5; s = centered(L, W); wheels(s.x, L - 3, W + 1, 2);
      hull(s.x, L, W - 1.5, P, 'box', 11, { deck: false }); fillRR(s.x, -3, -W / 2 + 1.6, 8, W - 3.2, 1, 'rgba(25,25,22,0.55)'); fillRR(s.x, 5, -W / 2 + 1.4, 1.2, W - 2.8, 0.4, '#8db4cc');
      for (const sy of [-2, 2]) circ(s.x, -1, sy, 1.2, '#3a3a36'); fillRR(s.x, -L / 2 + 0.5, -2, 2.5, 4, 0.5, '#3a3a36');
      t = T(18, 8, (x) => { circ(x, 0, 0, 1.8, '#2c2c2a'); barrel(x, 0, 7, 0.9, '#262624', false); }); tox = -2; break;
    case 'scout': L = 22; W = 13; s = centered(L, W); wheels(s.x, L - 2, W + 1, 3); hull(s.x, L, W - 2, P, 'wedge', 13); t = rws(2.6, 9); tox = -1; break;
    case 'apc': L = 26; W = 14; s = centered(L, W); wheels(s.x, L - 2, W + 1, 4); hull(s.x, L, W - 1.5, P, 'apc', 17);
      for (const sy of [-3, 3]) fillRR(s.x, -L / 2 + 2, sy - 1.6, 6, 3.2, 0.6, COL.shade(b, -0.1), 'rgba(0,0,0,0.5)', 0.4); fillRR(s.x, -L / 2 - 0.3, -3.5, 1.2, 7, 0.4, '#2c2c2a');
      t = rws(2.4, 8); tox = 4; break;
    case 'ifv': L = 25; W = 15; s = centered(L, W); tracks(s.x, L, W, 5, true, b); hull(s.x, L - 2, W - 4, P, 'wedge', 19); t = std(4.3, 11, 1.4, { noBustle: true }); tox = 1; break;
    case 'mbt': L = 29; W = 17; s = centered(L, W); tracks(s.x, L, W, 5.6, true, b); hull(s.x, L - 2, W - 4.5, P, 'wedge', 23); t = std(5.8, 15, 1.9); tox = -1; break;
    case 'heavy': L = 33; W = 20; s = centered(L, W); tracks(s.x, L, W, 6.4, true, b); hull(s.x, L - 2, W - 5.5, { ...P, base: COL.shade(b, -0.06) }, 'wedge', 29); t = std(7.2, 17, 2.4); tox = -2; break;
    case 'spg': L = 29; W = 16; s = centered(L, W); tracks(s.x, L, W, 5.2, false); hull(s.x, L - 2, W - 4, P, 'box', 31, { deck: false });
      t = T(40, 16, (x) => { barrel(x, 0, 23, 2, '#4b4a42'); fillRR(x, -14, -6.5, 15, 13, 1.5, P.base); camo(x, () => rr(x, -14, -6.5, 15, 13, 1.5), P.cam, 33, 0.5); sheen(x, () => rr(x, -14, -6.5, 15, 13, 1.5), 16, 13); rr(x, -14, -6.5, 15, 13, 1.5); x.strokeStyle = COL.shade(b, -0.6); x.lineWidth = 0.6; x.stroke(); circ(x, -9, -3, 1.6, COL.shade(b, -0.3)); circ(x, -11, 3.5, 0.9, P.fc); }); tox = -3; break;
    case 'mlrs': L = 27; W = 14; s = centered(L, W); wheels(s.x, L - 2, W + 1, 3); hull(s.x, L, W - 2, P, 'box', 37, { deck: false }); cab(s.x, L / 2 - 7.5, -W / 2 + 2, 6.5, W - 4, b);
      t = T(22, 14, (x) => { fillRR(x, -9, -5.5, 16, 11, 1, lg(x, -9, -5, 7, 5, [COL.shade(b, 0.12), COL.shade(b, -0.3)]), '#1e1e1c', 0.5); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) circ(x, 6.4, -3.5 + i * 3.5 + j * 0, 1.1, '#141412'); circ(x, -6, 0, 1.2, P.fc); line(x, -9, 0, 7, 0, 'rgba(0,0,0,0.35)', 0.5); }); tox = -4; break;
    case 'aatruck': L = 24; W = 14; s = centered(L, W); wheels(s.x, L - 2, W + 1, 3); hull(s.x, L, W - 2, P, 'box', 41, { deck: false });
      t = T(26, 16, (x) => { for (const y of [-2.4, 2.4]) barrel(x, 0, 12, 1.1, '#2c2c2a', false); circ(x, 0, 0, 4.6, lg(x, -4, -4, 4, 4, [COL.shade(b, 0.2), COL.shade(b, -0.3)]), '#1e1e1c', 0.6); x.beginPath(); x.ellipse(-4, 0, 1.6, 4, 0, 0, Math.PI * 2); x.fillStyle = '#d6dade'; x.fill(); }); tox = -2; break;
    case 'engveh': L = 29; W = 18; s = centered(L, W); tracks(s.x, L, W, 5.4); hull(s.x, L - 4, W - 5, { ...P, base: '#a58b3c', cam: ['#a58b3c', '#957d34', '#b39a4a', '#87702c'] }, 'box', 43);
      fillRR(s.x, L / 2 - 1.5, -W / 2 - 0.5, 3.4, W + 1, 0.6, lg(s.x, L / 2, 0, L / 2 + 3, 0, ['#7a7466', '#3e3a32']), '#2a2620', 0.5); line(s.x, -5, 2, 9, -7, '#3a3832', 2.2); circ(s.x, -5, 2, 2.6, '#4a4842'); hazard(s.x, -L / 2 + 3, W / 2 - 4.5, 8, 2); break;
    case 'recovery': L = 27; W = 14; s = centered(L, W); wheels(s.x, L - 2, W + 1, 3); hull(s.x, L, W - 2, P, 'box', 47, { deck: false }); cab(s.x, L / 2 - 7.5, -W / 2 + 2, 6.5, W - 4, b);
      line(s.x, L / 2 - 9, 0, -L / 2 - 2, 0, '#c9a33a', 2.2); line(s.x, L / 2 - 9, 0, -L / 2 - 2, 0, 'rgba(255,255,255,0.3)', 0.6); circ(s.x, -L / 2 - 2, 0, 1.6, '#2a2a28'); break;
    case 'supply': L = 27; W = 13; s = centered(L, W); wheels(s.x, L - 2, W + 1, 3); cab(s.x, L / 2 - 7.5, -W / 2 + 1, 7, W - 2, b);
      fillRR(s.x, -L / 2, -W / 2, L - 8.5, W, 1.6, lg(s.x, 0, -W / 2, 0, W / 2, ['#958f6a', '#6f6a4c']), '#3d3a28', 0.6); for (let i = 0; i < 4; i++) line(s.x, -L / 2 + 3.5 + i * 4.6, -W / 2 + 0.5, -L / 2 + 3.5 + i * 4.6, W / 2 - 0.5, 'rgba(40,36,24,0.5)', 0.8); fillRR(s.x, -6, -2, 4, 4, 0.5, P.fc); break;
    case 'mammoth': L = 39; W = 27; s = centered(L, W);
      for (const sy of [-1, 1]) { s.x.save(); s.x.translate(0, sy * (W / 2 - 4)); tracks(s.x, L, 8, 3.8); s.x.restore(); }
      hull(s.x, L - 2, W - 9, { ...P, base: COL.shade(b, -0.1) }, 'wedge', 53);
      t = T(44, 26, (x) => { for (const y of [-3.3, 3.3]) { x.save(); x.translate(0, y); barrel(x, 4, 17, 2.4, '#45443d'); x.restore(); } x.save(); turret(x, 8.4, 0, 0, P); x.restore(); for (const sy of [-10.5, 10.5]) { fillRR(x, -9, sy - 2.2, 9, 4.4, 1, '#3a3a34', '#1a1a18', 0.4); for (let i = 0; i < 3; i++) circ(x, -1.5, sy - 1.4 + i * 1.4, 0.55, '#c33'); } }); tox = -2; break;
    case 'wavecutter': L = 31; W = 18; s = centered(L, W); fillRR(s.x, -L / 2, -W / 2, L, W, 8, lg(s.x, 0, -W / 2, 0, W / 2, ['#2a2a28', '#151514', '#2a2a28']));
      { const path = () => rr(s.x, -L / 2 + 2, -W / 2 + 2, L - 4, W - 4, 6); path(); s.x.fillStyle = b; s.x.fill(); camo(s.x, path, P.cam, 59, 0.8); sheen(s.x, path, L, W); }
      for (const sy of [-4.2, 4.2]) { circ(s.x, -L / 2 + 5.5, sy, 3.4, rg(s.x, -L / 2 + 5.5, sy, 0.5, 3.4, ['#555', '#222']), '#111', 0.5); line(s.x, -L / 2 + 5.5, sy - 3, -L / 2 + 5.5, sy + 3, '#666', 0.5); }
      t = std(4, 10, 1.4, { noBustle: true }); tox = 3; break;
    case 'mech': L = 24; W = 22; s = centered(L, W);
      // Bipedal robotic walker chassis with hydraulic legs & foot pads
      for (const sy of [-1, 1]) {
        const ly = sy * 7.2;
        // Foot pad with three armored toes
        poly(s.x, [4.5, ly - 2.6, 7.5, ly - 1.8, 7.5, ly + 1.8, 4.5, ly + 2.6, -4.5, ly + 2.2, -4.5, ly - 2.2], '#2c3034', '#141618', 0.5);
        // Hydraulic leg strut & knee actuator
        fillRR(s.x, -2.5, ly - 1.5, 6.5, 3, 0.9, lg(s.x, -2, ly - 1.5, 4, ly + 1.5, ['#68727a', '#383e44']), '#181a1c', 0.45);
        circ(s.x, 2.2, ly, 1.4, '#4a5258', '#151719', 0.4);
        line(s.x, 0, sy * 3, 1.5, ly, '#8a949c', 1.1);
      }
      // Central hip & engine block
      fillRR(s.x, -5.5, -5.5, 11, 11, 2.2, lg(s.x, -5, -5, 5, 5, [COL.shade(b, 0.15), COL.shade(b, -0.3)]), '#181a1c', 0.6);
      t = T(32, 24, (x) => {
        // Left arm: heavy rotary autocannon + barrel shroud
        for (const dy of [-0.9, 0, 0.9]) line(x, 3, -7.8 + dy, 14, -7.8 + dy, '#2a2e32', 0.75);
        fillRR(x, 2, -9.2, 8.5, 2.8, 0.6, '#3e444a', '#151719', 0.4);
        // Right arm: twin anti-armor missile pod
        fillRR(x, -2, 6.2, 10, 3.6, 0.8, lg(x, -2, 6, 8, 10, [COL.shade(b, 0.2), COL.shade(b, -0.25)]), '#151719', 0.45);
        for (const dy of [7.1, 8.9]) circ(x, 7.8, dy, 0.75, '#d44');
        // Armored mech upper torso carapace
        const pts = [6.5, -4.2, 8.2, -2, 8.2, 2, 6.5, 4.2, -5.5, 5.8, -7.5, 3.2, -7.5, -3.2, -5.5, -5.8];
        poly(x, pts, lg(x, -7, -6, 8, 6, [COL.shade(b, 0.28), b, COL.shade(b, -0.32)]), COL.shade(b, -0.6), 0.65);
        // Glowing optical sensor visor & reactor core vent
        fillRR(x, 5.2, -2.2, 2.2, 4.4, 0.6, '#0d1822');
        fillRR(x, 5.6, -1.8, 1.5, 3.6, 0.4, '#3cf0ff');
        circ(x, -1.5, 0, 2.2, rg(x, -1.5, 0, 0.2, 2.2, ['#7ff6ff', P.fc, '#1c2a38']), '#14181c', 0.4);
        // Shoulder pauldrons
        for (const sy of [-1, 1]) fillRR(x, -3.5, sy * 5.6 - 1.6, 6.5, 3.2, 0.9, COL.shade(b, 0.12), COL.shade(b, -0.5), 0.4);
      });
      tox = 0; break;
    default: L = 24; W = 14; s = centered(L, W); hull(s.x, L, W, P);
  }
  grit(s, 0.14);
  return { body: s.c, w: s.w, h: s.h, tur: t ? t.c : null, tw: t ? t.w : 0, th: t ? t.h : 0, tox };
}

function drawInfantry(key, P) {
  const S = 16, frames = 4, s = mk(S * frames, S);
  if (key === 'robosoldier') {
    // Autonomous biped robot soldier: titanium chassis, articulated servo limbs, optical visor, pulse rifle
    const metal = COL.mix('#687480', P.fc, 0.16), dark = '#252b31', glow = '#38f2ff';
    for (let f = 0; f < frames; f++) {
      const x = s.x; x.save(); x.translate(S * f + S / 2, S / 2);
      if (f === 3) x.scale(1.22, 0.88);
      const stride = f === 1 ? 2.4 : f === 2 ? -2.4 : 0;
      // Servo legs & mechanical feet
      for (const [side, off] of [[-1, stride], [1, -stride]]) {
        const ly = side * 2.1;
        fillRR(x, -2.2 + off * 0.55, ly - 0.85, 3.4, 1.7, 0.5, dark, '#111', 0.3);
        circ(x, -2.2 + off * 0.55 + (off >= 0 ? 2.8 : 0.2), ly, 0.75, '#4b545c');
      }
      // Power pack & micro-antenna on back
      fillRR(x, -4.6, -2.4, 2.7, 4.8, 0.7, lg(x, -4.6, -2.4, -1.9, 2.4, [COL.shade(metal, 0.15), dark]), '#111', 0.35);
      circ(x, -3.3, 0, 0.75, P.fc);
      line(x, -3.8, -2.1, -5.2, -3.2, '#8a96a2', 0.45);
      circ(x, -5.2, -3.2, 0.45, glow);
      // Armored chest & shoulder actuator plates
      fillRR(x, -2.1, -3.8, 4.2, 7.6, 1.4, lg(x, -2, -3.8, 2, 3.8, [COL.shade(metal, 0.3), metal, COL.shade(metal, -0.35)]), '#14181c', 0.4);
      for (const sy of [-3.2, 3.2]) {
        fillRR(x, -1.5, sy - 0.9, 3.0, 1.8, 0.5, COL.shade(metal, 0.2), '#181c20', 0.3);
        circ(x, 0, sy, 0.55, P.fc);
      }
      // Heavy pulse carbine & cooling shroud + robotic arms
      fillRR(x, 0.6, 0.6, 8.2, 1.45, 0.35, '#1e2328', '#0d1012', 0.3);
      fillRR(x, 2.4, 0.85, 3.8, 0.7, 0.2, glow);
      line(x, 0.3, 2.6, 3.4, 1.5, metal, 1.15);
      line(x, 0.3, -2.4, 2.0, 0.6, metal, 1.1);
      circ(x, 3.5, 1.5, 0.6, dark);
      circ(x, 2.1, 0.6, 0.6, dark);
      // Angular sensor head & glowing cyan visor slit
      fillRR(x, -1.3, -1.85, 3.5, 3.7, 1.0, lg(x, -1.3, -1.8, 2.2, 1.8, [COL.shade(metal, 0.35), COL.shade(metal, -0.25)]), '#111519', 0.4);
      fillRR(x, 1.1, -1.35, 1.1, 2.7, 0.35, glow);
      x.restore();
    }
    grit(s, 0.08);
    return { body: s.c, w: S, h: S, frames, inf: true };
  }
  const uni = key === 'spec' ? '#2c3238' : key === 'ghost' ? '#3b4a34' : key === 'medic' ? '#c6ccc4' : key === 'engineer' ? COL.mix(P.cam[0], '#b8963a', 0.35) : P.cam[0];
  const vestCol = key === 'medic' ? '#e8ece6' : key === 'spec' ? '#1e2226' : COL.shade(uni, -0.22);
  const skin = ['#dfb692', '#ba8c68', '#865b40'][(key.length + P.fc.length) % 3];
  for (let f = 0; f < frames; f++) {
    const x = s.x; x.save(); x.translate(S * f + S / 2, S / 2);
    const prone = f === 3;
    if (prone) x.scale(1.28, 0.86);
    const lg2 = f === 1 ? 2.3 : f === 2 ? -2.3 : 0;
    // Articulated legs, knee pads & combat boots
    for (const [side, off] of [[-1, lg2], [1, -lg2]]) {
      const ly = side * 1.85;
      fillRR(x, -2.0 + off * 0.55, ly - 0.9, 3.3, 1.8, 0.75, lg(x, -2, ly - 0.9, 1.5, ly + 0.9, [COL.shade(uni, -0.15), COL.shade(uni, -0.38)]), 'rgba(0,0,0,0.45)', 0.3);
      // Knee pad
      circ(x, -0.4 + off * 0.55, ly, 0.65, 'rgba(30,32,28,0.65)');
      // Combat boot
      fillRR(x, -1.8 + off * 0.55 + (off >= 0 ? 2.1 : -0.7), ly - 0.7, 1.5, 1.4, 0.5, '#1b1917');
    }
    // Tactical rucksack, bedroll & gear pouches
    const pack = key === 'engineer' ? '#c9a038' : key === 'medic' ? '#eaede8' : key === 'aa' || key === 'at' ? '#485038' : COL.shade(uni, -0.22);
    fillRR(x, -4.6, -2.5, 2.9, 5.0, 1.0, lg(x, -4.6, -2.5, -1.7, 2.5, [COL.shade(pack, 0.18), COL.shade(pack, -0.32)]), 'rgba(0,0,0,0.5)', 0.38);
    line(x, -3.2, -2.3, -3.2, 2.3, 'rgba(0,0,0,0.28)', 0.4);
    if (key === 'at' || key === 'aa') {
      // Spare rocket tube strapped to pack
      fillRR(x, -5.1, -3.1, 1.2, 6.2, 0.4, '#3d4432', '#1a1d16', 0.3);
    }
    // Torso, shoulder pads & plate carrier vest with magazine pouches
    const bw = key === 'exo' ? 4.6 : 3.6;
    x.beginPath(); x.ellipse(-0.1, 0, 2.55, bw, 0, 0, Math.PI * 2);
    x.fillStyle = lg(x, -2.2, -bw, 2.2, bw, [COL.shade(uni, 0.24), uni, COL.shade(uni, -0.32)]);
    x.fill(); x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 0.38; x.stroke();
    // Tactical plate carrier & chest rig
    fillRR(x, -1.6, -2.4, 2.9, 4.8, 0.9, vestCol, 'rgba(0,0,0,0.4)', 0.3);
    if (key !== 'medic') {
      for (const py of [-1.4, 0, 1.4]) fillRR(x, 0.2, py - 0.45, 0.9, 0.9, 0.2, COL.shade(vestCol, -0.2));
    }
    // Shoulder webbing straps
    line(x, -1.6, -1.5, 0.8, -1.5, 'rgba(20,20,18,0.45)', 0.5);
    line(x, -1.6, 1.5, 0.8, 1.5, 'rgba(20,20,18,0.45)', 0.5);
    if (key === 'exo') {
      fillRR(x, -2.3, -4.4, 4.4, 8.8, 1.6, lg(x, -2, -4, 2, 4, [COL.shade(P.base, 0.28), COL.shade(P.base, -0.25)]), '#151515', 0.45);
      circ(x, 0, -3.5, 1.1, '#3a3c38', '#111', 0.3); circ(x, 0, 3.5, 1.1, '#3a3c38', '#111', 0.3);
    }
    if (key === 'ghost' || key === 'sniper') {
      for (let i = 0; i < 11; i++) circ(x, U.lerp(-3.2, 2.5, ((i * 37) % 10) / 10), U.lerp(-3.5, 3.5, ((i * 53) % 10) / 10), 0.95, i % 2 ? '#4d6838' : '#6e7e48');
    }
    if (key === 'medic') {
      fillRR(x, -0.55, -1.7, 1.1, 3.4, 0.2, '#d63e34');
      fillRR(x, -1.7, -0.55, 3.4, 1.1, 0.2, '#d63e34');
    }
    // Articulated arms, elbows & gloved hands gripping weapon
    const wc = '#1a1b1c', metalGun = '#383b3e';
    const arm = (sx, sy, ex, ey, hx, hy) => {
      x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(ex, ey, hx, hy);
      x.strokeStyle = COL.shade(uni, -0.06); x.lineWidth = 1.25; x.stroke();
      circ(x, hx, hy, 0.65, skin, 'rgba(0,0,0,0.35)', 0.25);
    };
    if (key === 'at' || key === 'aa') {
      // Shoulder-fired launcher with front/rear flared bell & sight
      fillRR(x, -3.8, -2.65, 11.4, 1.85, 0.7, lg(x, 0, -2.65, 0, -0.8, [key === 'aa' ? '#6e726a' : '#5a6644', '#2b3024']), '#141612', 0.35);
      fillRR(x, -4.3, -2.85, 1.2, 2.25, 0.3, '#222');
      fillRR(x, 6.8, -2.8, 1.1, 2.15, 0.3, '#222');
      arm(0.1, -2.4, 1.2, -2.8, 2.6, -1.7);
      arm(0.1, 2.2, 1.6, 1.2, 1.4, -0.9);
    } else if (key !== 'medic') {
      const L = key === 'sniper' ? 11.2 : key === 'mg' || key === 'exo' ? 9.2 : key === 'engineer' ? 5.8 : 7.6;
      const gunW = key === 'mg' || key === 'exo' ? 1.55 : 1.15;
      // Rifle stock, receiver, handguard, barrel & flash hider
      fillRR(x, -0.4, 0.75, L * 0.72, gunW, 0.35, wc);
      line(x, 1.0, 0.75 + gunW * 0.5, L + 0.6, 0.75 + gunW * 0.5, metalGun, gunW * 0.65);
      line(x, 1.2, 0.6, 4.2, 0.6, 'rgba(255,255,255,0.18)', 0.35);
      // Curved magazine
      fillRR(x, 2.4, 1.5, 1.2, 1.2, 0.25, '#2b2d2f');
      if (key === 'sniper' || key === 'spec' || key === 'ghost') {
        // Telescopic optic / red-dot sight & suppressor
        fillRR(x, 2.2, 0.3, 2.8, 0.75, 0.3, '#2c3034');
        if (key === 'spec' || key === 'ghost') fillRR(x, L - 0.6, 0.85, 2.4, 0.85, 0.3, '#222528');
      }
      if (key === 'mg') {
        // Box ammo mag & deployed bipod legs
        fillRR(x, 2.6, 1.7, 2.0, 1.6, 0.3, '#3c462d', '#181c12', 0.3);
        line(x, 7.8, 1.5, 9.0, 2.9, '#2a2c2e', 0.55);
        line(x, 7.8, 1.5, 9.0, 0.1, '#2a2c2e', 0.55);
      }
      arm(-0.2, 2.3, 1.4, 2.7, 1.8, 1.45);
      arm(-0.1, -2.3, 2.2, -1.4, 4.1, 1.0);
    } else {
      // Medic carrying trauma kit
      fillRR(x, 1.2, 0.8, 2.8, 2.2, 0.5, '#f0f2ee', '#555', 0.35);
      line(x, 2.6, 1.2, 2.6, 2.6, '#d63e34', 0.6);
      line(x, 1.9, 1.9, 3.3, 1.9, '#d63e34', 0.6);
      arm(0, 2.3, 1.2, 2.4, 2.2, 1.6);
      arm(0, -2.2, 1.4, -1.2, 1.8, -0.4);
    }
    // Realistic ballistic helmet with rim, chinstrap, goggles/NVG mount & faction patch
    const hc = key === 'engineer' ? '#e4be3c' : key === 'medic' ? '#eff2ee' : key === 'recon' ? '#767a56' : key === 'spec' ? '#1e2226' : COL.shade(uni, -0.06);
    circ(x, 0.6, 0.1, 2.15, 'rgba(0,0,0,0.28)');
    circ(x, 0.45, 0, 2.15, rg(x, -0.35, -0.75, 0.2, 2.3, [COL.shade(hc, 0.38), hc, COL.shade(hc, -0.42)]), 'rgba(0,0,0,0.6)', 0.38);
    // Helmet band / camouflage scrim
    x.beginPath(); x.arc(0.45, 0, 1.85, -1.1, 1.1); x.strokeStyle = 'rgba(25,28,24,0.45)'; x.lineWidth = 0.5; x.stroke();
    // Tactical goggles / NVG on front of helmet
    if (key === 'spec' || key === 'ghost' || key === 'recon') {
      fillRR(x, 1.75, -1.1, 1.2, 2.2, 0.35, '#181c20');
      circ(x, 2.35, -0.5, 0.38, '#52e07c');
      circ(x, 2.35, 0.5, 0.38, '#52e07c');
    } else if (key !== 'engineer') {
      fillRR(x, 1.4, -1.25, 0.85, 2.5, 0.3, '#2a2e32', '#111', 0.25);
    }
    if (key !== 'spec' && key !== 'ghost') circ(x, -0.65, -0.85, 0.55, P.fc);
    x.restore();
  }
  grit(s, 0.08);
  return { body: s.c, w: S, h: S, frames, inf: true };
}

function drawAir(key, P) {
  const b = COL.mix('#8e969d', P.fc, 0.14), dk = COL.shade(b, -0.5);
  let s;
  const body = (pts, seed) => { const path = () => polyPath(s.x, pts); path(); s.x.fillStyle = b; s.x.fill(); s.x.save(); path(); s.x.clip(); s.x.fillStyle = lg(s.x, 0, -24, 0, 24, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.16)', 'rgba(0,0,0,0.3)']); s.x.fillRect(-40, -30, 80, 60); s.x.restore(); path(); s.x.strokeStyle = dk; s.x.lineWidth = 0.55; s.x.stroke(); };
  const canopy = (X, Y, L, W) => { s.x.beginPath(); s.x.ellipse(X, Y, L, W, 0, 0, Math.PI * 2); s.x.fillStyle = lg(s.x, X - L, Y - W, X + L, Y + W, ['#d4ecf8', '#5d8eb0', '#1f3c52']); s.x.fill(); s.x.strokeStyle = '#1a2a36'; s.x.lineWidth = 0.4; s.x.stroke(); circ(s.x, X + L * 0.2, Y - W * 0.3, W * 0.35, 'rgba(255,255,255,0.6)'); };
  const roundel = (X, Y, r) => { circ(s.x, X, Y, r, '#f2f0e8'); circ(s.x, X, Y, r * 0.65, P.fc); };
  const fuselageShade = (L, W) => { s.x.fillStyle = lg(s.x, 0, -W, 0, W, ['rgba(0,0,0,0.3)', 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.35)']); };
  switch (key) {
    case 'fighter': s = centered(30, 26, 3);
      body([15, 0, 11, -1.4, 3, -2.6, -3, -12.5, -7.5, -12.5, -6, -3.2, -11, -2.8, -14, -7, -15.5, -7, -14.5, -1.5, -15, 0, -14.5, 1.5, -15.5, 7, -14, 7, -11, 2.8, -6, 3.2, -7.5, 12.5, -3, 12.5, 3, 2.6, 11, 1.4]);
      for (const y of [-6, 6]) fillRR(s.x, -3, y - 0.5, 7, 1, 0.5, '#d8d8d0'); line(s.x, 13, 0, -13, 0, 'rgba(255,255,255,0.25)', 0.8);
      canopy(6, 0, 3.6, 1.3); for (const y of [-1.4, 1.4]) circ(s.x, -15, y, 0.9, '#2a2a28', '#555', 0.4); roundel(-4.5, -8.5, 1.4); roundel(-4.5, 8.5, 1.4); break;
    case 'bomber': s = centered(40, 50, 3);
      body([20, 0, 15, -2.2, 6, -3, -4, -24, -10, -24, -5, -3.4, -15, -2.6, -19, -9.5, -21, -9.5, -19.5, 0, -21, 9.5, -19, 9.5, -15, 2.6, -5, 3.4, -10, 24, -4, 24, 6, 3, 15, 2.2]);
      for (const y of [-15, -8.5, 8.5, 15]) { fillRR(s.x, -4 - Math.abs(y) * 0.22, y - 1.6, 7, 3.2, 1.6, lg(s.x, 0, y - 1.6, 0, y + 1.6, ['#6b7077', '#34383c'])); circ(s.x, -4.5 - Math.abs(y) * 0.22, y, 1, '#1a1a18'); }
      canopy(15, 0, 3, 1.5); line(s.x, 18, 0, -18, 0, 'rgba(255,255,255,0.2)', 1); roundel(-7, -17, 2); roundel(-7, 17, 2); break;
    case 'gunship': s = centered(32, 16, 3);
      fillRR(s.x, -16, -1, 12, 2, 1, b, dk, 0.4); fillRR(s.x, -16, -3.2, 2.2, 6.4, 0.8, COL.shade(b, -0.2), dk, 0.4);
      s.x.beginPath(); s.x.ellipse(2, 0, 10.5, 3.8, 0, 0, Math.PI * 2); fuselageShade(10, 3.8); s.x.fill(); s.x.beginPath(); s.x.ellipse(2, 0, 10.5, 3.8, 0, 0, Math.PI * 2); s.x.globalCompositeOperation = 'destination-over'; s.x.fillStyle = b; s.x.fill(); s.x.globalCompositeOperation = 'source-over'; s.x.strokeStyle = dk; s.x.lineWidth = 0.5; s.x.stroke();
      fillRR(s.x, -1.5, -7.5, 3, 15, 1, COL.shade(b, -0.2), dk, 0.4); for (const y of [-6.5, 6.5]) fillRR(s.x, -2.5, y - 1.3, 5, 2.6, 1.2, '#3a3c3a'); canopy(8, 0, 3.2, 1.8); canopy(4.5, 0, 2, 1.5); circ(s.x, -6, 0, 1, P.fc); break;
    case 'thelo': s = centered(38, 14, 3);
      fillRR(s.x, -18, -5, 36, 10, 4.5, b, dk, 0.6); s.x.save(); rr(s.x, -18, -5, 36, 10, 4.5); s.x.clip(); fuselageShade(18, 5); s.x.fillRect(-20, -6, 40, 12); s.x.restore();
      canopy(13.5, 0, 3, 2.6); for (const xx of [-10, 10]) circ(s.x, xx, 0, 2, '#3a3c3a', dk, 0.4); for (let i = 0; i < 4; i++) fillRR(s.x, -6 + i * 4, -4.2, 2.2, 1.2, 0.4, '#2a3640'); roundel(-2, 3, 1.2); break;
    case 'reconplane': s = centered(28, 38, 3);
      body([14, 0, 9, -1.6, 2.5, -1.6, 2, -18, -2, -18, -2.5, -1.6, -10, -1.2, -12, -6.5, -13.5, -6.5, -13, 0, -13.5, 6.5, -12, 6.5, -10, 1.2, -2.5, 1.6, -2, 18, 2, 18, 2.5, 1.6, 9, 1.6]);
      circ(s.x, 0, 0, 3.8, null, 'rgba(230,230,230,0.6)', 0.5); s.x.beginPath(); s.x.ellipse(-3, 0, 2.6, 1.6, 0, 0, Math.PI * 2); s.x.fillStyle = '#d8d8d0'; s.x.fill(); canopy(7, 0, 2.6, 1.2); fillRR(s.x, 13.5, -3.5, 1, 7, 0.4, '#222'); roundel(-0.5, -12, 1.3); roundel(-0.5, 12, 1.3); break;
    case 'cas': s = centered(32, 36, 3);
      body([16, 0, 10, -2.2, 4, -2.2, 2, -17, -3, -17, -3.5, -2.2, -9, -2.2, -12, -8.5, -14.5, -8.5, -13.5, 0, -14.5, 8.5, -12, 8.5, -9, 2.2, -3.5, 2.2, -3, 17, 2, 17, 4, 2.2, 10, 2.2]);
      for (const y of [-5, 5]) { fillRR(s.x, -10, y - 2.1, 7, 4.2, 2, lg(s.x, 0, y - 2, 0, y + 2, ['#7a7f86', '#3a3e42'])); circ(s.x, -10.2, y, 1.2, '#1a1a18'); }
      for (const y of [-12, -9, 9, 12]) fillRR(s.x, -1, y - 0.6, 5, 1.2, 0.5, '#d0d0c8'); canopy(9, 0, 3, 1.4); roundel(-1, -14, 1.3); roundel(-1, 14, 1.3); break;
    case 'stratos': s = centered(40, 20, 3);
      fillRR(s.x, -20, -1.5, 12, 3, 1, b, dk, 0.4); fillRR(s.x, -20, -4.5, 2.6, 9, 1, COL.shade(b, -0.2), dk, 0.4);
      fillRR(s.x, -10, -5.5, 28, 11, 5, b, dk, 0.6); s.x.save(); rr(s.x, -10, -5.5, 28, 11, 5); s.x.clip(); fuselageShade(14, 5.5); s.x.fillRect(-12, -7, 32, 14); s.x.restore();
      fillRR(s.x, -3.5, -9.5, 5, 19, 1.6, COL.shade(b, -0.2), dk, 0.4); for (const y of [-8.5, -4.5, 4.5, 8.5]) fillRR(s.x, -4, y - 1.4, 6, 2.8, 1.3, '#3a3c3a'); canopy(13, 0, 3.6, 2.4); circ(s.x, -6, 0, 1.5, P.fc); break;
    case 'recondrone': s = centered(22, 22, 3);
      // Quadcopter tactical recon UAV: carbon-fiber X-arms, four rotor shrouds, electro-optical gimbal dome
      for (const [rx, ry] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) {
        line(s.x, 0, 0, rx, ry, '#2c3238', 1.5);
        circ(s.x, rx, ry, 3.8, 'rgba(30,36,42,0.35)', '#4a545e', 0.6);
        circ(s.x, rx, ry, 1.1, '#20262c');
      }
      fillRR(s.x, -4.5, -2.6, 9, 5.2, 2.2, lg(s.x, -4, -2.5, 4, 2.5, [COL.shade(b, 0.25), '#2c343c']), dk, 0.5);
      circ(s.x, 3.2, 0, 1.6, rg(s.x, 2.8, -0.4, 0.2, 1.6, ['#7cf6ff', '#1b6c88', '#0c2230']), '#111', 0.4);
      circ(s.x, -1.5, 0, 1.0, P.fc);
      break;
    case 'kamikaze': s = centered(20, 18, 3);
      // Loitering munition (Lancet / Shahed delta-cruciform style) with shaped-charge warhead cone
      body([9.5, 0, 5.5, -1.2, 1.5, -1.3, -2.5, -7.8, -5.5, -7.8, -4.5, -1.3, -8.5, -1.1, -9.5, -3.5, -9.5, 3.5, -8.5, 1.1, -4.5, 1.3, -5.5, 7.8, -2.5, 7.8, 1.5, 1.3, 5.5, 1.2]);
      poly(s.x, [9.5, 0, 5.8, -1.15, 5.8, 1.15], '#e05038', dk, 0.35);
      circ(s.x, 7.2, 0, 0.65, '#ffea78');
      circ(s.x, -2, 0, 1.1, P.fc);
      break;
    case 'ucav': s = centered(30, 38, 3);
      // Stealth flying-wing UCAV (X-47B / RQ-170 style) with dorsal intake & internal bay seams
      body([12, 0, 5, -6.5, -5.5, -18, -9.5, -18, -5.5, -6, -9, -2.5, -7.5, 0, -9, 2.5, -5.5, 6, -9.5, 18, -5.5, 18, 5, 6.5]);
      poly(s.x, [6.5, 0, 3.2, -2.2, 1.5, -1.4, 1.5, 1.4, 3.2, 2.2], '#222830');
      line(s.x, 8.5, 0, -6.5, 0, 'rgba(60,240,255,0.45)', 0.7);
      for (const y of [-7.5, 7.5]) roundel(-2.5, y, 1.3);
      break;
    default: s = centered(20, 20, 3); circ(s.x, 0, 0, 8, b);
  }
  grit(s, 0.08);
  return {
    body: s.c, w: s.w, h: s.h, tur: null,
    rotor: key === 'gunship' ? [[0, 0, 14]]
      : key === 'thelo' ? [[-10, 0, 13], [10, 0, 13]]
      : key === 'stratos' ? [[-1, 0, 16]]
      : key === 'recondrone' ? [[-6.5, -6.5, 3.4], [6.5, -6.5, 3.4], [-6.5, 6.5, 3.4], [6.5, 6.5, 3.4]]
      : null,
  };
}

function drawShip(key, P) {
  const b = COL.mix('#8e969c', P.fc, 0.12), dk = COL.shade(b, -0.55), deck = '#7d8084';
  let s, t = null, tox = 0;
  const hullP = (L, W) => {
    const pts = [L / 2, 0, L / 2 - W * 1.1, -W / 2, -L / 2 + 2, -W / 2, -L / 2, -W / 2 + 2, -L / 2, W / 2 - 2, -L / 2 + 2, W / 2, L / 2 - W * 1.1, W / 2];
    poly(s.x, pts, lg(s.x, 0, -W / 2, 0, W / 2, [COL.shade(b, 0.1), b, COL.shade(b, -0.35)]), dk, 0.7);
    const inner = pts.map((v, i) => v * (i % 2 ? 0.78 : 0.94)); poly(s.x, inner, deck);
    for (let i = -L / 2 + 3; i < L / 2 - W; i += 2.2) line(s.x, i, -W / 2 * 0.74, i, W / 2 * 0.74, 'rgba(0,0,0,0.08)', 0.4);
  };
  const block = (X, Y, W, H) => { fillRR(s.x, X + 1, Y + 1, W, H, 1, 'rgba(0,0,0,0.3)'); fillRR(s.x, X, Y, W, H, 1, lg(s.x, X, Y, X + W, Y + H, [COL.shade(b, 0.28), COL.shade(b, -0.1)]), dk, 0.4); };
  const gun = (r, bl) => { const ts = centered((r + bl) * 2, r * 2 + 2, 3); barrel(ts.x, 0, bl + r * 0.4, 1.2, '#44464a', false); circ(ts.x, 0, 0, r, lg(ts.x, -r, -r, r, r, [COL.shade(b, 0.3), COL.shade(b, -0.25)]), dk, 0.5); ts.x.beginPath(); ts.x.ellipse(-r * 0.2, 0, r * 0.9, r * 0.75, 0, -1.2, 1.2); ts.x.strokeStyle = 'rgba(255,255,255,0.25)'; ts.x.lineWidth = 0.5; ts.x.stroke(); grit(ts, 0.1); return ts; };
  switch (key) {
    case 'patrol': s = centered(29, 10); hullP(29, 10); block(-7, -3, 9, 6); fillRR(s.x, 0.5, -2, 1.2, 4, 0.4, '#5d8eb0'); line(s.x, -3, 0, -3, -6, '#333', 0.5); circ(s.x, -12, 0, 1, P.fc); t = gun(2.2, 6); tox = 7.5; break;
    case 'destroyer': s = centered(56, 15); hullP(56, 15); block(-16, -4.5, 24, 9); block(-11, -3, 12, 6); circ(s.x, -5, 0, 2.4, rg(s.x, -5.5, -0.6, 0.3, 2.4, ['#f2f2f2', '#9aa0a5']));
      fillRR(s.x, -22, -4.5, 6, 9, 0.6, '#5c6064'); for (let i = 0; i < 8; i++) fillRR(s.x, -21.5 + (i % 4) * 1.4, -3.8 + ((i / 4) | 0) * 4, 1.1, 3.4, 0.2, '#3a3e42'); circ(s.x, -25, 0, 3, null, '#e8e2d0', 0.6); line(s.x, 2, -6, 2, 6, '#555', 0.6); circ(s.x, 6, 0, 0.9, P.fc); t = gun(3.2, 10); tox = 16; break;
    case 'tship': s = centered(50, 17); hullP(50, 17); block(-23, -6, 9, 12);
      const cc = ['#a8553a', '#3c6a8c', '#c9a43a', '#5a7d4a', '#8a3a3a']; for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) { const X = -12 + i * 4.8, Y = -5.2 + j * 5.2; fillRR(s.x, X, Y, 4.4, 4.6, 0.3, lg(s.x, X, Y, X + 4.4, Y + 4.6, [COL.shade(cc[(i + j * 3) % 5], 0.15), COL.shade(cc[(i + j * 3) % 5], -0.25)])); line(s.x, X + 1.4, Y + 0.4, X + 1.4, Y + 4.2, 'rgba(0,0,0,0.25)', 0.3); line(s.x, X + 3, Y + 0.4, X + 3, Y + 4.2, 'rgba(0,0,0,0.25)', 0.3); }
      circ(s.x, 20, 0, 1.4, P.fc); break;
    case 'lcraft': s = centered(31, 15); fillRR(s.x, -15.5, -7.5, 31, 15, 2, lg(s.x, 0, -7.5, 0, 7.5, [COL.shade(b, 0.12), COL.shade(b, -0.3)]), dk, 0.7); fillRR(s.x, -11, -5.5, 22, 11, 1, '#6c6e66');
      for (let i = 0; i < 6; i++) line(s.x, -10 + i * 4, -5, -10 + i * 4, 5, 'rgba(0,0,0,0.15)', 0.4); fillRR(s.x, 12, -6.5, 3, 13, 0.8, lg(s.x, 12, 0, 15, 0, [COL.shade(b, 0.1), COL.shade(b, -0.35)])); block(-15.5, -4, 5, 8); circ(s.x, -13, 0, 0.9, P.fc); break;
    case 'sub': s = centered(44, 10); s.x.beginPath(); s.x.ellipse(0, 0, 22, 4.6, 0, 0, Math.PI * 2); s.x.fillStyle = lg(s.x, 0, -4.6, 0, 4.6, ['#4b5258', '#2b3034', '#1a1d20']); s.x.fill(); s.x.strokeStyle = '#111416'; s.x.lineWidth = 0.6; s.x.stroke();
      fillRR(s.x, 1, -1.8, 8, 3.6, 1.6, lg(s.x, 1, -1.8, 9, 1.8, ['#3e454a', '#22272a'])); for (const y of [-3.5, 3.5]) line(s.x, 3, 0, 3, y, '#2a2f33', 1); line(s.x, -21, -4.5, -21, 4.5, '#2a2f33', 1.4); circ(s.x, -10, 0, 0.8, P.fc); break;
    case 'nsupply': s = centered(44, 14); hullP(44, 14); for (let i = 0; i < 3; i++) circ(s.x, -13 + i * 7, 0, 3.2, rg(s.x, -13.8 + i * 7, -1, 0.4, 3.2, ['#ece7d2', '#a59f88']), dk, 0.4); block(8, -4.5, 7, 9);
      line(s.x, -17, -5, -8, 5, '#c9a33a', 1.2); circ(s.x, 16, 0, 1, P.fc); break;
    default: s = centered(30, 10); hullP(30, 10);
  }
  grit(s, 0.1);
  return { body: s.c, w: s.w, h: s.h, tur: t ? t.c : null, tw: t ? t.w : 0, th: t ? t.h : 0, tox };
}

/* ---------- military buildings ---------- */
SPR.bld = function (key, fk, level = 1) {
  const ck = 'b:' + key + ':' + fk + ':' + level;
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const d = BLDS[key], F = FACTIONS[fk], A = ARCH[F.arch], W = d.w * TILE, H = d.h * TILE, pad = 10;
  const s = mk(W + pad, H + pad), x = s.x;
  const ov = SPR.images['bld:' + key];
  if (ov) x.drawImage(ov, 0, 0, W, H);
  else { drawMil(x, key, A, F, W, H, level); grit(s, 0.14); }
  const out = { img: s.c, w: s.w, h: s.h };
  SPR.cache.set(ck, out);
  return out;
};

// raised block with cast shadow, lit roof, ambient occlusion and edge highlight
function slab(x, X, Y, W, H, A, roof, wall, h = 4) {
  roof = roof || A.roof; wall = wall || A.wall;
  x.fillStyle = 'rgba(0,0,0,0.3)'; rr(x, X + h + 1, Y + h + 1, W, H, A.rad); x.fill();
  x.fillStyle = 'rgba(0,0,0,0.15)'; rr(x, X + h * 0.5, Y + h * 0.5, W + 2, H + 2, A.rad); x.fill();
  fillRR(x, X + 1, Y + 2, W, H, A.rad, lg(x, X, Y + H, X + W, Y + H, [COL.shade(wall, -0.1), COL.shade(wall, -0.35)]));
  rr(x, X, Y, W, H - h * 0.5, A.rad); x.fillStyle = lg(x, X, Y, X + W * 0.7, Y + H, [COL.shade(roof, 0.14), roof, COL.shade(roof, -0.12)]); x.fill();
  x.strokeStyle = COL.shade(wall, -0.45); x.lineWidth = 0.8; x.stroke();
  line(x, X + 1.5, Y + 1, X + W - 1.5, Y + 1, 'rgba(255,255,255,0.28)', 0.8); line(x, X + 1, Y + 1.5, X + 1, Y + H - h * 0.5 - 1.5, 'rgba(255,255,255,0.18)', 0.8);
}
function vents(x, X, Y, n, col) { for (let i = 0; i < n; i++) { const cx = X + i * 7; fillRR(x, cx + 0.8, Y + 0.8, 5, 4, 0.8, 'rgba(0,0,0,0.3)'); fillRR(x, cx, Y, 5, 4, 0.8, lg(x, cx, Y, cx + 5, Y + 4, [COL.shade(col, 0.25), COL.shade(col, -0.2)]), 'rgba(0,0,0,0.4)', 0.4); for (let k = 1; k < 4; k++) line(x, cx + 0.8, Y + k, cx + 4.2, Y + k, 'rgba(0,0,0,0.3)', 0.4); } }
function tower(x, cx, cy, r) {
  circ(x, cx + 4, cy + 4, r, 'rgba(0,0,0,0.32)');
  circ(x, cx, cy, r, rg(x, cx - r * 0.4, cy - r * 0.4, r * 0.1, r, ['#e2e5e5', '#b4b8b9', '#7f8385']), '#6d7173', 1);
  circ(x, cx, cy, r * 0.66, rg(x, cx + r * 0.15, cy + r * 0.15, 0, r * 0.66, ['#2e3133', '#4f5457']));
}
function tank(x, cx, cy, r, col = '#d8d4c4') { circ(x, cx + 3, cy + 3, r, 'rgba(0,0,0,0.3)'); circ(x, cx, cy, r, rg(x, cx - r * 0.4, cy - r * 0.4, r * 0.1, r, [COL.shade(col, 0.2), col, COL.shade(col, -0.35)]), COL.shade(col, -0.5), 0.8); circ(x, cx, cy, r * 0.55, null, 'rgba(0,0,0,0.18)', 0.6); }
function flag(x, X, Y, col) { line(x, X, Y, X, Y - 11, '#ddd', 0.8); poly(x, [X, Y - 11, X + 7, Y - 9, X, Y - 7], col); }
function pad(x, W, H) { fillRR(x, 1, 1, W - 2, H - 2, 3, 'rgba(88,90,84,0.55)'); for (let i = 8; i < W; i += 16) line(x, i, 2, i, H - 2, 'rgba(0,0,0,0.07)', 0.6); }

function drawMil(x, key, A, F, W, H, lvl) {
  const fc = F.color;
  switch (key) {
    case 'hq':
      pad(x, W, H); slab(x, 6, 6, W - 12, H - 14, A, null, null, 7);
      slab(x, 16, 14, W - 40, H - 40, A, A.roof2, A.wall, 3); vents(x, 18, H - 30, 3, A.roof);
      circ(x, W - 24, 24, 10, '#3d4044', '#9aa', 1); x.fillStyle = '#e8e8e0'; x.font = 'bold 11px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', W - 24, 24.5);
      for (let i = 0; i < 3; i++) { line(x, 20 + i * 6, 18, 20 + i * 6, 4, '#c8ccd0', 0.9); circ(x, 20 + i * 6, 4, 1, '#e44'); }
      fillRR(x, 10, H - 22, W - 20, 5, 1, fc); flag(x, 13, 17, fc);
      if (lvl > 1) for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; circ(x, W / 2 + Math.cos(a) * (W / 2 - 3), H / 2 + Math.sin(a) * (H / 2 - 3), 2.4, '#a39670', '#5c553f', 0.5); }
      break;
    case 'power':
      pad(x, W, H); slab(x, 4, 20, W - 8, H - 26, A); vents(x, 10, H - 18, 4, A.roof);
      tower(x, 17, 15, 13); tower(x, W - 17, 15, 13);
      fillRR(x, 8, H - 9, W - 16, 3, 1, fc);
      if (lvl > 1) for (let i = 0; i < 4; i++) fillRR(x, 8 + i * 12, 26, 8, 5, 1, '#d9b43a');
      break;
    case 'refinery':
      pad(x, W, H); slab(x, 4, 4, W * 0.55, H - 20, A); vents(x, 10, 10, 3, A.roof2);
      tank(x, W * 0.7, 17, 10); tank(x, W * 0.7 + 18, 17, 10); line(x, W * 0.55, 16, W * 0.62, 16, '#888', 2.5);
      hazard(x, W / 2 - 18, H - 14, 36, 10); fillRR(x, 8, 30, 16, 4, 1, fc); if (lvl > 1) tank(x, 22, 30, 6, '#d6b94a');
      break;
    case 'barracks':
      pad(x, W, H); for (let i = 0; i < 2; i++) { slab(x, 4, 5 + i * 26, W - 14, 18, A, A.roof2); line(x, 6, 13.5 + i * 26, W - 12, 13.5 + i * 26, COL.shade(A.roof2, -0.35), 1.2); for (let k = 0; k < 6; k++) line(x, 8 + k * 7, 6 + i * 26, 8 + k * 7, 13 + i * 26, 'rgba(255,255,255,0.08)', 0.6); }
      flag(x, W - 6, 32, fc); fillRR(x, 6, H - 8, 18, 3, 1, fc); if (lvl > 1) fillRR(x, W - 12, 38, 8, 20, 1, '#5a6a4a');
      break;
    case 'factory':
      pad(x, W, H); slab(x, 4, 4, W - 8, H - 24, A, null, null, 7);
      x.save(); rr(x, 4, 4, W - 8, H - 28, A.rad); x.clip();
      for (let i = 0; i < 7; i++) { const yy = 6 + i * 9; poly(x, [4, yy, W - 4, yy, W - 4, yy + 5, 4, yy + 7.5], lg(x, 0, yy, 0, yy + 8, [COL.shade(A.roof, 0.18), COL.shade(A.roof, -0.15)])); fillRR(x, 6, yy + 5, W - 12, 1.8, 0, '#7fa9c6'); }
      x.restore();
      hazard(x, W / 2 - 22, H - 22, 44, 5); fillRR(x, W / 2 - 18, H - 17, 36, 13, 1, lg(x, 0, H - 17, 0, H - 4, ['#1e2022', '#3a3e42'])); for (let i = 1; i < 6; i++) line(x, W / 2 - 18, H - 17 + i * 2.2, W / 2 + 18, H - 17 + i * 2.2, 'rgba(255,255,255,0.08)', 0.5);
      fillRR(x, 6, H - 22, 10, 18, 1, fc); if (lvl > 1) tank(x, W - 14, H - 12, 5, '#888');
      break;
    case 'hangar':
      pad(x, W, H); fillRR(x, 2, H * 0.48, W - 4, H * 0.5, 2, lg(x, 0, H * 0.5, 0, H, ['#55595c', '#45494c']));
      for (let i = 0; i < 4; i++) { const cx = 16 + i * 22, cy = H * 0.75; circ(x, cx, cy, 8, null, 'rgba(217,180,58,0.6)', 1); line(x, cx - 4, cy - 4, cx + 4, cy + 4, '#d9b43a', 1.2); line(x, cx + 4, cy - 4, cx - 4, cy + 4, '#d9b43a', 1.2); }
      x.fillStyle = 'rgba(0,0,0,0.3)'; rr(x, 9, 9, W - 14, H * 0.45, 14); x.fill();
      rr(x, 4, 4, W - 12, H * 0.43, 14); x.fillStyle = lg(x, 0, 4, 0, 4 + H * 0.43, [COL.shade(A.roof, -0.25), COL.shade(A.roof, 0.22), COL.shade(A.roof, -0.3)]); x.fill(); x.strokeStyle = COL.shade(A.wall, -0.35); x.lineWidth = 1; x.stroke();
      for (let i = 1; i < 9; i++) line(x, 4 + i * (W - 12) / 9, 6, 4 + i * (W - 12) / 9, H * 0.43 + 2, 'rgba(0,0,0,0.18)', 0.8);
      fillRR(x, 8, 8, 10, 4, 1, fc);
      break;
    case 'shipyard':
      fillRR(x, 2, 2, W - 4, H * 0.42, 2, '#6d6f68'); slab(x, 6, 4, W * 0.4, H * 0.3, A);
      fillRR(x, W * 0.5, 6, W * 0.42, 10, 1, '#7a7a74');
      for (const yy of [H * 0.44, H * 0.9]) fillRR(x, 2, yy, W - 4, 5, 1, lg(x, 0, yy, 0, yy + 5, ['#9a8664', '#6c5a3e']), '#4e4433', 0.6);
      for (let i = 0; i < 6; i++) line(x, 6 + i * 16, H * 0.44, 6 + i * 16, H * 0.95, '#5e5136', 2);
      line(x, W - 16, 12, W - 16, H * 0.8, '#d9b43a', 2.5); line(x, W - 28, 16, W - 4, 16, '#d9b43a', 2); line(x, W - 28, 16, W - 16, 12, '#d9b43a', 1);
      fillRR(x, 10, 10, 12, 4, 1, fc);
      break;
    case 'radar':
      pad(x, W, H); slab(x, 6, 18, W - 12, H - 24, A); vents(x, 10, H - 14, 2, A.roof);
      circ(x, W / 2, H / 2 - 4, 9, '#55595d', '#2b2d2f', 1); circ(x, W / 2, H / 2 - 4, 4, '#3a3d40'); fillRR(x, 10, H - 9, 16, 3, 1, fc);
      if (lvl > 1) { line(x, 8, 10, 8, -4, '#ccc', 1); line(x, W - 8, 10, W - 8, -4, '#ccc', 1); }
      break;
    case 'lab':
      pad(x, W, H); slab(x, 4, 32, W - 8, H - 36, A);
      circ(x, W / 2 + 4, 27, 19, 'rgba(0,0,0,0.32)'); circ(x, W / 2, 23, 19, rg(x, W / 2 - 7, 15, 2, 22, ['#f6f8fa', '#b6c1cb', '#7d8994']), '#5f6872', 1);
      for (let i = -2; i <= 2; i++) { x.beginPath(); x.ellipse(W / 2, 23, Math.abs(i) * 4 + 0.5, 19, 0, 0, Math.PI * 2); x.strokeStyle = 'rgba(70,80,90,0.18)'; x.lineWidth = 0.6; x.stroke(); }
      fillRR(x, 8, H - 8, 16, 3, 1, fc);
      break;
    case 'fueldepot':
      pad(x, W, H); for (let i = 0; i < 4; i++) { const cx = 17 + (i % 2) * 30, cy = 17 + ((i / 2) | 0) * 30; tank(x, cx, cy, 12); circ(x, cx, cy, 2, fc); }
      line(x, 17, 32, 47, 32, '#666', 2.5); break;
    case 'depot':
      pad(x, W, H); slab(x, 4, 4, 28, 26, A); for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const X = 36 + (i % 2) * 12, Y = 6 + j * 9 + ((i / 2) | 0) * 28; fillRR(x, X + 1, Y + 1, 10, 7, 0.6, 'rgba(0,0,0,0.3)'); fillRR(x, X, Y, 10, 7, 0.6, lg(x, X, Y, X + 10, Y + 7, [j % 2 ? '#9a8a5c' : '#7f8a60', j % 2 ? '#6a5c38' : '#56603c']), '#2a2a1a', 0.5); line(x, X + 5, Y, X + 5, Y + 7, 'rgba(0,0,0,0.25)', 0.5); }
      for (let i = 0; i < 3; i++) fillRR(x, 4 + i * 10, 36, 8, 22, 2, lg(x, 4 + i * 10, 0, 12 + i * 10, 0, ['#8a9468', '#5c6440']), '#444a30', 0.5); fillRR(x, 6, 8, 12, 3, 1, fc); break;
    case 'ammo':
      pad(x, W, H); for (let i = 0; i < 2; i++) { fillRR(x, 7 + i * 30, 8, 24, 50, 10, 'rgba(0,0,0,0.3)'); fillRR(x, 5 + i * 30, 6, 24, 50, 10, rg(x, 12 + i * 30, 20, 2, 30, ['#7d8e4d', '#5d6e3d', '#3e4a28']), '#34401f', 1); fillRR(x, 11 + i * 30, 40, 12, 14, 2, '#2e2e2a'); }
      poly(x, [W / 2, 4, W / 2 + 5, 12, W / 2 - 5, 12], '#e3b82b', '#222', 0.6); break;
    case 'repair':
      pad(x, W, H); fillRR(x, 4, 4, W - 8, H - 8, 2, '#4a4e51'); hazard(x, 8, 8, W - 16, 5); hazard(x, 8, H - 13, W - 16, 5);
      circ(x, W / 2, H / 2, 13, null, '#d9b43a', 2);
      line(x, W - 12, 12, W - 12, H - 12, '#d9b43a', 3); line(x, W - 12, 14, W / 2, H / 2, '#d9b43a', 2); line(x, W - 12, 14, W / 2, H / 2, 'rgba(255,255,255,0.3)', 0.6); fillRR(x, 8, 18, 10, 4, 1, fc); break;
    case 'medical':
      pad(x, W, H); for (let i = 0; i < 2; i++) { const X = 6 + i * 4, Y = 6 + i * 22; fillRR(x, X + 3, Y + 3, W - 16, 22, 4, 'rgba(0,0,0,0.25)'); fillRR(x, X, Y, W - 16, 22, 4, lg(x, 0, Y, 0, Y + 22, ['#f2f4f0', '#c8cdc4', '#eef0ea']), '#9aa096', 1); line(x, X + 2, Y + 11, X + W - 18, Y + 11, '#b0b6aa', 1); }
      fillRR(x, W / 2 - 3, 8, 6, 16, 1, '#2f9e55'); fillRR(x, W / 2 - 8, 13, 16, 6, 1, '#2f9e55'); fillRR(x, 8, H - 8, 14, 3, 1, fc); break;
    case 'mine':
      pad(x, W, H); circ(x, 18, H - 18, 14, rg(x, 14, H - 22, 2, 15, ['#8a7e6c', '#6b6052', '#544a3e'])); slab(x, W - 30, H - 28, 24, 22, A);
      for (const [a, b2] of [[W / 2 - 8, H / 2 + 6], [W / 2 + 16, H / 2 + 6], [W / 2 + 4, H / 2 + 8]]) line(x, a, b2, W / 2 + 4, 6, '#2e2e2c', 1.6);
      circ(x, W / 2 + 4, 8, 4.5, null, '#3b3b3b', 1.6); fillRR(x, 6, 6, 12, 3, 1, fc); break;
    case 'farm':
      fillRR(x, 1, 1, W - 2, H - 2, 2, '#6f7f3c'); for (let i = 0; i < 12; i++) line(x, 4, 6 + i * 7.6, W * 0.62, 6 + i * 7.6, i % 2 ? '#8a9a4a' : '#b39d4e', 3.2);
      slab(x, W * 0.66, 8, W * 0.3, 32, A, '#9a3f2f', '#6e2e22'); line(x, W * 0.66, 23, W * 0.96, 23, 'rgba(0,0,0,0.35)', 1); tank(x, W * 0.81, 60, 9, '#cfcfc3'); fillRR(x, W * 0.7, H - 10, 14, 3, 1, fc); break;
    case 'pump':
      pad(x, W, H); slab(x, 4, 4, 30, 24, A); tank(x, 46, 46, 12, '#a9bfca'); circ(x, 46, 46, 7, rg(x, 44, 44, 0, 7, ['#7fb0cc', '#3d6f8e'])); line(x, 20, 30, 40, 44, '#666', 3); fillRR(x, 6, 8, 12, 3, 1, fc); break;
    case 'logistics':
      pad(x, W, H); slab(x, 4, 4, W * 0.55, H - 10, A, null, null, 5); for (let i = 0; i < 8; i++) line(x, 8, 8 + i * 6, W * 0.55, 8 + i * 6, 'rgba(0,0,0,0.12)', 1);
      const cc = ['#a8553a', '#3c6a8c', '#c9a43a', '#5a7d4a']; for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { const X = W * 0.62 + i * 11, Y = 6 + j * 13; fillRR(x, X + 1, Y + 1, 9, 11, 0.6, 'rgba(0,0,0,0.3)'); fillRR(x, X, Y, 9, 11, 0.6, lg(x, X, Y, X + 9, Y, [COL.shade(cc[(i + j) % 4], 0.2), COL.shade(cc[(i + j) % 4], -0.25)]), '#222', 0.4); }
      fillRR(x, 8, 8, 14, 4, 1, fc); break;
    case 'shelter':
      pad(x, W, H); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const X = 4 + j * 30, Y = 4 + i * 19; fillRR(x, X + 2, Y + 2, 26, 16, 5, 'rgba(0,0,0,0.25)'); fillRR(x, X, Y, 26, 16, 5, lg(x, 0, Y, 0, Y + 16, ['#eef3f6', '#c1ced6', '#e6edf1']), '#93a2ab', 1); line(x, X + 2, Y + 8, X + 24, Y + 8, '#a9b8c0', 1); }
      fillRR(x, W / 2 - 6, H / 2 - 2, 12, 4, 1, fc); break;
    case 'wall':
      fillRR(x, 3, 4, W - 2, H - 2, 1, 'rgba(0,0,0,0.35)'); fillRR(x, 1, 1, W - 2, H - 2, 1, lg(x, 0, 0, W, H, [COL.shade(A.wall, 0.25), COL.shade(A.wall, -0.1)]), COL.shade(A.wall, -0.45), 1);
      line(x, 2, H / 2, W - 2, H / 2, COL.shade(A.wall, -0.25), 1); line(x, W / 2, 2, W / 2, H / 2, COL.shade(A.wall, -0.25), 1); line(x, W / 4, H / 2, W / 4, H - 2, COL.shade(A.wall, -0.25), 1); break;
    case 'trench':
      poly(x, [2, 10, 10, 4, 18, 12, 26, 4, 30, 8, 30, 24, 22, 28, 14, 20, 6, 28, 2, 22], lg(x, 0, 0, 0, 30, ['#4a3c2b', '#5f4e38']), '#3b2f22', 1);
      for (let i = 0; i < 8; i++) circ(x, 4 + i * 3.8, 6 + (i % 2) * 3, 2.1, rg(x, 3.5 + i * 3.8, 5 + (i % 2) * 3, 0.3, 2.1, ['#c2b38c', '#8d7f5c']), '#5b5038', 0.4); break;
    case 'bunker':
      x.fillStyle = 'rgba(0,0,0,0.32)'; rr(x, 8, 8, W - 8, H - 8, 16); x.fill(); fillRR(x, 3, 3, W - 8, H - 8, 16, rg(x, W / 2 - 8, H / 2 - 8, 4, W / 2, [COL.shade(A.wall, 0.3), COL.shade(A.wall, 0.05), COL.shade(A.wall, -0.25)]), COL.shade(A.wall, -0.45), 1.5);
      fillRR(x, 12, 12, W - 26, H - 26, 8, COL.shade(A.wall, -0.05)); for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; fillRR(x, W / 2 - 6 + Math.cos(a) * 18, H / 2 - 4 + Math.sin(a) * 18, 8, 3, 1, '#0e0e0e'); }
      circ(x, W / 2 - 2, H / 2 - 2, 3, fc); break;
    case 'tower':
      fillRR(x, 8, 8, 24, 24, 1, 'rgba(0,0,0,0.35)'); for (const [a, b2] of [[4, 4], [24, 4], [4, 24], [24, 24]]) circ(x, a, b2, 1.6, '#4a3a2a');
      fillRR(x, 4, 4, 22, 22, 1, F.arch === 'timber' ? '#8a6a44' : COL.shade(A.roof, -0.05), '#3a2e22', 1); poly(x, [4, 4, 26, 4, 15, 15], COL.shade(A.roof, 0.18)); poly(x, [26, 4, 26, 26, 15, 15], COL.shade(A.roof, -0.1)); poly(x, [4, 26, 26, 26, 15, 15], COL.shade(A.roof, -0.25)); circ(x, 15, 15, 2, fc); break;
    case 'turret':
      fillRR(x, 4, 4, W - 2, H - 2, 3, 'rgba(0,0,0,0.32)'); fillRR(x, 1, 1, W - 2, H - 2, 3, lg(x, 0, 0, W, H, [COL.shade(A.wall, 0.2), COL.shade(A.wall, -0.15)]), COL.shade(A.wall, -0.45), 1);
      for (const [a, b2] of [[4, 4], [W - 4, 4], [4, H - 4], [W - 4, H - 4]]) circ(x, a, b2, 1.3, '#333'); break;
    case 'sam':
      pad(x, W, H); fillRR(x, 6, 6, W - 12, H - 12, 6, lg(x, 6, 6, W - 6, H - 6, [COL.shade(A.wall, 0.1), COL.shade(A.wall, -0.2)]), COL.shade(A.wall, -0.45), 1); circ(x, W / 2, H / 2, 14, '#4a4e51'); fillRR(x, 6, H - 10, 12, 3, 1, fc); break;
    case 'coastal':
      pad(x, W, H); fillRR(x, 4, 4, W - 8, H - 8, 4, lg(x, 4, 4, W - 4, H - 4, ['#86847a', '#5c5a50']), '#4d4b42', 1.5); circ(x, W / 2, H / 2, 17, '#5c5b52', '#3a3932', 1); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; circ(x, W / 2 + Math.cos(a) * 25, H / 2 + Math.sin(a) * 25, 2.3, '#a39670'); } break;
    case 'abm':
      pad(x, W, H); fillRR(x, 5, 5, W - 10, H - 10, 3, lg(x, 5, 5, W - 5, H - 5, [COL.shade(A.wall, 0.15), COL.shade(A.wall, -0.2)]), COL.shade(A.wall, -0.45), 1);
      fillRR(x, 8, 8, 20, 14, 2, '#3e4246'); for (let i = 0; i < 4; i++) fillRR(x, 10 + i * 4.5, 10, 3, 10, 1, lg(x, 0, 10, 0, 20, ['#f0f0ea', '#b0b2aa']));
      circ(x, W - 18, H - 18, 11, rg(x, W - 21, H - 21, 1, 11, ['#f4f4f0', '#c8cacc', '#8a8e92']), '#5a5e62', 1); fillRR(x, 8, H - 10, 12, 3, 1, fc); break;
    case 'silo':
      pad(x, W, H); fillRR(x, 4, 4, W - 8, H - 8, 4, '#5a5c58', '#3a3c38', 1);
      circ(x, W / 2, H / 2, 20, rg(x, W / 2 - 6, H / 2 - 6, 2, 22, ['#9a9c96', '#6e706a', '#4a4c48']), '#2a2c28', 1.5);
      x.save(); x.beginPath(); x.arc(W / 2, H / 2, 17, 0, Math.PI * 2); x.clip(); for (let i = -40; i < 40; i += 6) line(x, W / 2 + i, H / 2 - 20, W / 2 + i + 20, H / 2 + 20, 'rgba(217,180,58,0.5)', 2.5); x.restore();
      line(x, W / 2 - 17, H / 2, W / 2 + 17, H / 2, '#222', 1.4); circ(x, W / 2, H / 2, 4, '#2a2c28'); fillRR(x, 6, 6, 10, 3, 1, fc); break;
  }
}

SPR.bldTurret = function (key, fk, level) {
  const ck = 'bt:' + key + ':' + fk + ':' + level;
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const P = SPR.unitColors(fk), b = COL.shade(P.base, 0.05);
  let s = null;
  if (key === 'turret') { const heavy = level > 1; s = centered(34, 18, 2); barrel(s.x, 0, 16, heavy ? 3.4 : 2.4, '#45443d'); s.x.save(); turret(s.x, heavy ? 7.2 : 6.2, 0, 0, P, { noBustle: true }); s.x.restore(); }
  else if (key === 'sam') { s = centered(28, 22, 2); fillRR(s.x, -8, -8, 14, 16, 2, lg(s.x, -8, -8, 6, 8, [COL.shade(b, 0.2), COL.shade(b, -0.3)]), COL.shade(b, -0.6), 1); for (const y of [-5, -1.7, 1.7, 5]) { fillRR(s.x, -2, y - 1.3, 14, 2.6, 1.2, lg(s.x, 0, y - 1.3, 0, y + 1.3, ['#f8f8f2', '#b8b8b0'])); circ(s.x, 12, y, 1.2, '#c33'); } }
  else if (key === 'coastal') { s = centered(48, 24, 2); barrel(s.x, 2, 22, 4, '#45443d'); circ(s.x, -6, 0, 11, rg(s.x, -9, -3, 1, 11, [COL.shade(b, 0.3), b, COL.shade(b, -0.35)]), COL.shade(b, -0.6), 1.2); }
  else if (key === 'radar') { s = centered(26, 30, 2); s.x.beginPath(); s.x.ellipse(0, 0, 4.2, 12.5, 0, 0, Math.PI * 2); s.x.fillStyle = lg(s.x, -4, 0, 4, 0, ['#f2f4f6', '#a8aeb4']); s.x.fill(); s.x.strokeStyle = '#6a7076'; s.x.lineWidth = 1; s.x.stroke(); line(s.x, 0, 0, 8, 0, '#555', 1.5); for (let i = -10; i <= 10; i += 4) line(s.x, -3, i, 3, i, 'rgba(0,0,0,0.12)', 0.5); }
  else if (key === 'hq') { s = centered(26, 14, 2); barrel(s.x, 0, 11, 1.8, '#3a3a36'); circ(s.x, -2, 0, 5, lg(s.x, -6, -5, 4, 5, [COL.shade(b, 0.25), COL.shade(b, -0.3)]), '#222', 0.8); }
  if (s) grit(s, 0.1);
  const out = s ? { img: s.c, w: s.w, h: s.h } : null;
  SPR.cache.set(ck, out);
  return out;
};

/* ---------- civilian buildings ---------- */
const ROOFS = ['#a5583a', '#8f6b4d', '#6d7280', '#9b4a3a', '#7a6a5a', '#b06f45', '#5f6f62', '#8a5a48'];
SPR.civ = function (key, v = 0) {
  const ck = 'c:' + key + ':' + (v % 8);
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const d = CIVB[key], W = d.w * TILE, H = d.h * TILE, s = mk(W + 8, H + 8), x = s.x;
  const ov = SPR.images['civ:' + key];
  if (ov) x.drawImage(ov, 0, 0, W, H); else { drawCiv(x, key, W, H, v); grit(s, 0.16); }
  const out = { img: s.c, w: s.w, h: s.h };
  SPR.cache.set(ck, out);
  return out;
};
function pitched(x, X, Y, W, H, col, horiz = true) {
  x.fillStyle = 'rgba(0,0,0,0.32)'; x.fillRect(X + 4, Y + 4, W, H);
  x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(X - 1, Y - 1, W + 4, H + 4);
  const A = COL.shade(col, 0.14), B = COL.shade(col, -0.22);
  if (horiz) {
    poly(x, [X, Y, X + W, Y, X + W, Y + H / 2, X, Y + H / 2], lg(x, 0, Y, 0, Y + H / 2, [COL.shade(col, 0.2), A]));
    poly(x, [X, Y + H / 2, X + W, Y + H / 2, X + W, Y + H, X, Y + H], lg(x, 0, Y + H / 2, 0, Y + H, [B, COL.shade(col, -0.32)]));
    for (let i = 1; i < 4; i++) { line(x, X, Y + (i * H) / 8, X + W, Y + (i * H) / 8, 'rgba(0,0,0,0.14)', 0.5); line(x, X, Y + H / 2 + (i * H) / 8, X + W, Y + H / 2 + (i * H) / 8, 'rgba(0,0,0,0.18)', 0.5); }
    line(x, X, Y + H / 2, X + W, Y + H / 2, COL.shade(col, 0.4), 0.8);
  } else {
    poly(x, [X, Y, X + W / 2, Y, X + W / 2, Y + H, X, Y + H], lg(x, X, 0, X + W / 2, 0, [COL.shade(col, 0.2), A]));
    poly(x, [X + W / 2, Y, X + W, Y, X + W, Y + H, X + W / 2, Y + H], lg(x, X + W / 2, 0, X + W, 0, [B, COL.shade(col, -0.32)]));
    for (let i = 1; i < 4; i++) { line(x, X + (i * W) / 8, Y, X + (i * W) / 8, Y + H, 'rgba(0,0,0,0.14)', 0.5); line(x, X + W / 2 + (i * W) / 8, Y, X + W / 2 + (i * W) / 8, Y + H, 'rgba(0,0,0,0.18)', 0.5); }
    line(x, X + W / 2, Y, X + W / 2, Y + H, COL.shade(col, 0.4), 0.8);
  }
  x.strokeStyle = COL.shade(col, -0.5); x.lineWidth = 0.7; x.strokeRect(X, Y, W, H);
}
function flatRoof(x, X, Y, W, H, col, h = 4) {
  x.fillStyle = 'rgba(0,0,0,0.32)'; x.fillRect(X + h, Y + h, W, H);
  x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(X - 1, Y - 1, W + 3, H + 3);
  x.fillStyle = COL.shade(col, -0.32); x.fillRect(X + 1, Y + 2, W, H);
  x.fillStyle = lg(x, X, Y, X + W, Y + H, [COL.shade(col, 0.12), col, COL.shade(col, -0.1)]); x.fillRect(X, Y, W, H - h * 0.4);
  x.strokeStyle = COL.shade(col, 0.3); x.lineWidth = 1.2; x.strokeRect(X + 0.8, Y + 0.8, W - 1.6, H - h * 0.4 - 1.6);
  x.strokeStyle = COL.shade(col, -0.45); x.lineWidth = 0.6; x.strokeRect(X + 0.3, Y + 0.3, W - 0.6, H - h * 0.4 - 0.6);
}
function ac(x, X, Y) { fillRR(x, X + 0.8, Y + 0.8, 5, 4, 0.6, 'rgba(0,0,0,0.3)'); fillRR(x, X, Y, 5, 4, 0.6, '#8e9296', '#55595c', 0.4); circ(x, X + 2.5, Y + 2, 1.3, '#4a4e52'); }
function greenCross(x, cx, cy, r) { fillRR(x, cx - r / 3, cy - r, (r * 2) / 3, r * 2, 1, '#2f9e55'); fillRR(x, cx - r, cy - r / 3, r * 2, (r * 2) / 3, 1, '#2f9e55'); }
function yard(x, W, H, col = '#6f8a4f') { fillRR(x, 1, 1, W - 2, H - 2, 1, lg(x, 0, 0, W, H, [COL.shade(col, 0.08), COL.shade(col, -0.08)])); }
function drawCiv(x, key, W, H, v) {
  const roof = ROOFS[v % ROOFS.length];
  switch (key) {
    case 'house': yard(x, W, H); fillRR(x, W - 9, H - 7, 6, 4, 0.5, '#8a8a84'); pitched(x, 5, 5, W - 11, H - 13, roof, v % 2 === 0); fillRR(x, W - 11, 7, 3, 4, 0.5, '#5a4a3f'); break;
    case 'ruin': fillRR(x, 2, 2, W - 4, H - 4, 1, '#6d675c'); for (let i = 0; i < 11; i++) fillRR(x, 4 + (i * 7) % (W - 10), 4 + (i * 11) % (H - 10), 5, 3, 0.5, i % 2 ? '#8a8378' : '#5b554c');
      line(x, 4, 4, W - 6, 4, '#a39b8e', 2.2); line(x, 4, 4, 4, H - 8, '#a39b8e', 2.2); line(x, 4, 4, W - 6, 4, 'rgba(0,0,0,0.3)', 0.6); break;
    case 'apartment': flatRoof(x, 3, 3, W - 8, H - 8, v % 2 ? '#a19f99' : '#8f9196', 7);
      for (let i = 0; i < 4; i++) ac(x, 9 + (i % 2) * 24, 9 + ((i / 2) | 0) * 24); fillRR(x, W / 2 - 6, H / 2 - 6, 12, 10, 1, lg(x, 0, H / 2 - 6, 0, H / 2 + 4, ['#8a8c90', '#6a6c70']), '#4a4c50', 0.5); if (v % 3 === 0) fillRR(x, 8, H - 22, 18, 10, 2, '#5d7d48'); break;
    case 'shop': flatRoof(x, 3, 3, W - 8, H - 12, '#aca69a'); ac(x, 8, 7); for (let i = 0; i < 4; i++) fillRR(x, 3 + i * 6, H - 11, 6, 6, 0, i % 2 ? '#ece6d6' : ['#c0503a', '#3c7a9c', '#3a8a5a', '#c99a2a'][v % 4]); break;
    case 'restaurant': flatRoof(x, 3, 3, W - 8, H - 14, '#b28a62'); for (let i = 0; i < 3; i++) { circ(x, 7 + i * 8 + 1, H - 5, 3, 'rgba(0,0,0,0.25)'); circ(x, 7 + i * 8, H - 6, 3, rg(x, 6 + i * 8, H - 7, 0.4, 3, [['#e86a4a', '#f2ece0'][i % 2], ['#a43a22', '#c8c0b0'][i % 2]])); } break;
    case 'supermarket': fillRR(x, 1, 1, W - 2, H - 2, 1, '#55585a'); for (let i = 0; i < 6; i++) line(x, 6 + i * 9, H - 18, 6 + i * 9, H - 4, '#ddd', 0.8); for (let i = 0; i < 3; i++) fillRR(x, 8 + i * 18, H - 14, 6, 3, 1, ['#c0503a', '#e3e1d8', '#3c6a9c'][i]);
      flatRoof(x, 3, 3, W - 8, H - 26, '#cbc6ba'); fillRR(x, 6, 6, W - 16, 4, 1, '#d65a3a'); ac(x, 12, 14); ac(x, 22, 14); break;
    case 'market': flatRoof(x, 2, 3, W - 6, H - 8, '#b9b0a0'); for (let i = 0; i < 8; i++) fillRR(x, 4 + i * 7, 5, 4, H - 14, 1, lg(x, 0, 5, 0, H - 9, [i % 2 ? '#d0604a' : '#f0eadc', i % 2 ? '#9a3a28' : '#c8c0b0'])); break;
    case 'bank': flatRoof(x, 3, 3, W - 8, H - 10, '#cec7b4'); for (let i = 0; i < 6; i++) circ(x, 8 + i * 9, H - 8, 2, rg(x, 7.5 + i * 9, H - 8.5, 0.2, 2, ['#fff', '#b8b2a2'])); fillRR(x, W / 2 - 8, 8, 16, 6, 1, '#b39b54'); break;
    case 'hospital': flatRoof(x, 3, 3, W - 8, H - 8, '#e9ece8', 7); fillRR(x, W * 0.36, 3, W * 0.3, H - 10, 0, '#d8ddd8'); ac(x, W * 0.4, 10); ac(x, W * 0.5, 10);
      circ(x, W - 22, 20, 12, '#5b6066', '#e8e8e8', 1.4); x.fillStyle = '#fff'; x.font = 'bold 12px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', W - 22, 21); greenCross(x, 22, 22, 8); break;
    case 'clinic': flatRoof(x, 3, 3, W - 8, H - 8, '#e9ece8'); greenCross(x, W / 2 - 2, H / 2 - 2, 5); break;
    case 'school': yard(x, W, H, '#5c7a46'); fillRR(x, W / 2, H / 2 + 2, W / 2 - 4, H / 2 - 6, 1, '#b3734a'); line(x, W * 0.75, H / 2 + 2, W * 0.75, H - 4, '#eee', 0.8); circ(x, W * 0.75, H * 0.75, 3, null, '#eee', 0.6);
      flatRoof(x, 3, 3, W - 8, H / 2 - 2, '#caa87c'); flatRoof(x, 3, 3, W / 2 - 4, H - 8, '#caa87c'); break;
    case 'university': yard(x, W, H, '#5e7c48'); for (let i = 0; i < 6; i++) circ(x, 30 + (i % 3) * 18, 34 + ((i / 3) | 0) * 26, 4, rg(x, 29 + (i % 3) * 18, 33 + ((i / 3) | 0) * 26, 0.4, 4, ['#5f8a45', '#2f4f25']));
      flatRoof(x, 3, 3, W - 8, 20, '#bba58c'); flatRoof(x, 3, H - 26, W - 8, 20, '#bba58c'); flatRoof(x, 3, 3, 20, H - 8, '#aa947a'); circ(x, W - 20, H / 2, 10, rg(x, W - 23, H / 2 - 3, 1, 10, ['#c5d2db', '#7d8c96']), '#555', 1); break;
    case 'police': flatRoof(x, 3, 3, W - 8, H - 10, '#dadee3'); fillRR(x, 3, 3, W - 8, 4, 0, '#2f5aa8'); fillRR(x, 10, H - 9, 8, 4, 1, '#2f5aa8'); fillRR(x, 22, H - 9, 8, 4, 1, '#eee'); break;
    case 'fire': flatRoof(x, 3, 3, W - 8, H - 16, '#c0503a', 5); for (let i = 0; i < 3; i++) fillRR(x, 7 + i * 17, H - 16, 13, 10, 1, lg(x, 0, H - 16, 0, H - 6, ['#d8cab8', '#a89a88'])); fillRR(x, 9, H - 8, 9, 5, 1, '#c22'); break;
    case 'cityhall': fillRR(x, 1, 1, W - 2, H - 2, 1, '#8a8a7c'); flatRoof(x, 5, 5, W - 12, H - 16, '#dcd3bc', 6);
      circ(x, W / 2 + 2, H / 2 - 2, 12, 'rgba(0,0,0,0.3)'); circ(x, W / 2, H / 2 - 4, 12, rg(x, W / 2 - 4, H / 2 - 8, 2, 13, ['#c9e2d6', '#4f8f7a', '#2f5f4f']), '#3a6a5a', 1);
      for (let i = 0; i < 6; i++) circ(x, 10 + i * 9, H - 10, 1.8, '#f2ecdc'); line(x, W - 10, 10, W - 10, 0, '#ddd', 0.8); poly(x, [W - 10, 0, W - 4, 2, W - 10, 4], '#4a8ab0'); break;
    case 'farmhouse': yard(x, W, H, '#7b8a4c'); pitched(x, 4, 4, W - 14, H - 12, '#9a3f2f'); tank(x, W - 7, H - 7, 4.5, '#cfcfc3'); break;
    case 'factory': flatRoof(x, 3, 3, W - 8, H - 8, '#8c8c86', 7); x.save(); x.beginPath(); x.rect(3, 3, W - 8, H - 12); x.clip(); for (let i = 0; i < 6; i++) { poly(x, [3 + i * 15, 4, 18 + i * 15, 4, 18 + i * 15, H - 12, 3 + i * 15, H - 9], lg(x, 3 + i * 15, 0, 18 + i * 15, 0, ['#9c9c96', '#76766f'])); line(x, 18 + i * 15, 4, 18 + i * 15, H - 12, '#7fa9c6', 1.6); } x.restore();
      tank(x, W - 14, 12, 5, '#7a6a60'); tank(x, W - 28, 12, 4, '#7a6a60'); break;
    case 'warehouse': flatRoof(x, 3, 3, W - 8, H - 8, '#9ca2a4', 6); for (let i = 0; i < 10; i++) line(x, 5, 6 + i * 5, W - 7, 6 + i * 5, i % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)', 1.2); break;
    case 'construction': fillRR(x, 1, 1, W - 2, H - 2, 1, '#a08a62'); fillRR(x, 8, 8, 26, 26, 1, '#9a9a94', '#666', 1); for (let i = 0; i < 4; i++) line(x, 10 + i * 7, 10, 10 + i * 7, 32, '#7a5a40', 1);
      line(x, W - 12, H - 10, W - 12, 6, '#e3b82b', 2.5); line(x, 4, 8, W - 6, 8, '#e3b82b', 2); fillRR(x, 4, H - 14, 12, 8, 1, '#e3b82b'); for (let i = 0; i < 5; i++) circ(x, 38 + (i % 2) * 6, 40 + ((i / 2) | 0) * 6, 2.4, '#8a8072'); break;
    case 'waterplant': fillRR(x, 1, 1, W - 2, H - 2, 2, '#7d8783'); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const cx = 16 + i * 30, cy = 16 + j * 30; circ(x, cx, cy, 12, '#c5ccc9'); circ(x, cx, cy, 10, rg(x, cx - 3, cy - 3, 1, 10, ['#8fc0d8', '#3e7598'])); line(x, cx - 9, cy, cx + 9, cy, '#c5ccc9', 1); } break;
    case 'substation': fillRR(x, 1, 1, W - 2, H - 2, 1, '#8b8a82', '#555', 1); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { fillRR(x, 9 + i * 18, 9 + j * 18, 9, 9, 1, 'rgba(0,0,0,0.3)'); fillRR(x, 8 + i * 18, 8 + j * 18, 9, 9, 1, lg(x, 8 + i * 18, 8 + j * 18, 17 + i * 18, 17 + j * 18, ['#7a7f84', '#44484c']), '#2e3134', 0.6); }
      for (let i = 0; i < 3; i++) line(x, 4, 12 + i * 18, W - 4, 12 + i * 18, '#333', 0.6); break;
    case 'powerstation': fillRR(x, 1, 1, W - 2, H - 2, 1, '#7a7a74'); flatRoof(x, 4, H / 2, W * 0.55, H / 2 - 6, '#9a9a94', 5);
      tower(x, W - 24, 19, 15); tower(x, W - 54, 19, 15); tank(x, 14, 12, 5, '#7a6a60'); break;
    case 'transit': flatRoof(x, 3, 3, W - 8, H - 10, '#7f9aa6'); for (let i = 0; i < 3; i++) fillRR(x, 6 + i * 19, H - 9, 15, 5, 1, '#c9a43a'); break;
    case 'station': flatRoof(x, 2, 6, W - 4, H - 16, '#8b6f5a'); fillRR(x, 4, H - 10, W - 8, 3, 0, '#c8c3b6'); circ(x, W / 2, 12, 4, '#ece6d8', '#555', 0.8); break;
    case 'fuelstation': fillRR(x, 1, 1, W - 2, H - 2, 1, '#5d6064'); fillRR(x, 6, 7, W - 8, 14, 1, 'rgba(0,0,0,0.3)'); fillRR(x, 4, 4, W - 8, 14, 1, lg(x, 0, 4, 0, 18, ['#f2eee6', '#cfcac0']), '#999', 0.6); fillRR(x, 4, 4, W - 8, 3, 0, '#d65a3a');
      for (let i = 0; i < 2; i++) fillRR(x, 8 + i * 10, 22, 4, 5, 0.6, '#ddd'); break;
    case 'commtower': circ(x, W / 2 + 2, H / 2 + 2, 8, 'rgba(0,0,0,0.3)'); poly(x, [W / 2, 4, W - 6, H - 6, 6, H - 6], null, '#8a8f94', 1.6); line(x, W / 2, 4, W / 2, H - 6, '#8a8f94', 1); for (let i = 1; i < 4; i++) line(x, W / 2 - i * 3, 4 + i * 6, W / 2 + i * 3, 4 + i * 6, '#8a8f94', 0.6); circ(x, W / 2, 6, 2.4, '#d33'); break;
    case 'checkpoint': fillRR(x, 1, 1, W - 2, H - 2, 1, '#6a6a64'); fillRR(x, 4, 4, 12, 10, 1, '#d6d6cc', '#777', 0.8); for (let i = 0; i < 5; i++) line(x, 16 + i * 3, H / 2 + 6, 19 + i * 3, H / 2 + 6, i % 2 ? '#eee' : '#d33', 2.4);
      for (let i = 0; i < 4; i++) fillRR(x, 4 + i * 6, H - 8, 4, 4, 0.5, '#bdb7a5'); break;
    case 'derrick': circ(x, W / 2, H / 2 + 4, 11, rg(x, W / 2, H / 2 + 4, 1, 11, ['rgba(16,12,8,0.75)', 'rgba(30,24,16,0)'])); fillRR(x, 6, H / 2 + 2, W - 12, 4, 1, '#3a3a36'); line(x, 8, H / 2, W - 8, 8, '#2f2f2c', 2.6); circ(x, W - 8, 8, 3, '#d65a3a'); line(x, W / 2, H / 2 + 4, W / 2 - 2, 10, '#2f2f2c', 1.5); break;
    case 'airport': flatRoof(x, 3, 3, W - 8, H - 18, '#d1d8dd', 7); for (let i = 0; i < 6; i++) fillRR(x, 10 + i * 18, 8, 12, 6, 1, lg(x, 0, 8, 0, 14, ['#a8cbe0', '#5a86a4']));
      for (let i = 0; i < 4; i++) fillRR(x, 14 + i * 28, H - 16, 4, 14, 1, '#9aa0a2'); break;
    case 'port': fillRR(x, 1, 1, W - 2, H * 0.45, 1, '#7a7a74'); flatRoof(x, 4, 4, W * 0.45, H * 0.35, '#9aa0a2');
      for (let i = 0; i < 5; i++) fillRR(x, W * 0.55 + (i % 3) * 12, 6 + ((i / 3) | 0) * 12, 10, 10, 0.5, ['#a8553a', '#3c6a8c', '#c9a43a'][i % 3]);
      fillRR(x, 2, H * 0.45, W - 4, H * 0.5, 1, lg(x, 0, H * 0.45, 0, H, ['#9a8664', '#6c5a3e']), '#4e4433', 1); line(x, W - 18, H * 0.4, W - 18, H - 4, '#d9b43a', 2.5); line(x, W - 30, H * 0.5, W - 6, H * 0.5, '#d9b43a', 2); break;
    default: flatRoof(x, 3, 3, W - 8, H - 8, roof);
  }
}

SPR.rubble = function (w, h, seed = 1) {
  const ck = 'r:' + w + ':' + h + ':' + (seed % 4);
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const W = w * TILE, H = h * TILE, s = mk(W, H), x = s.x, r = RNG(seed * 31 + w * 7 + h);
  fillRR(x, 2, 2, W - 4, H - 4, 3, rg(x, W / 2, H / 2, 2, Math.max(W, H) * 0.6, ['rgba(40,36,32,0.95)', 'rgba(70,64,56,0.85)']));
  for (let i = 0; i < w * h * 18; i++) { const px = r.range(3, W - 6), py = r.range(3, H - 6), c = r.chance(0.5) ? '#857d70' : r.chance(0.5) ? '#4a4540' : '#a0978a'; fillRR(x, px + 0.8, py + 0.8, r.range(2, 7), r.range(2, 5), 0.6, 'rgba(0,0,0,0.35)'); fillRR(x, px, py, r.range(2, 7), r.range(2, 5), 0.6, c); }
  for (let i = 0; i < w * 3; i++) line(x, r.range(2, W - 2), r.range(2, H - 2), r.range(2, W - 2), r.range(2, H - 2), '#3a3530', 1.6);
  grit(s, 0.2);
  const out = { img: s.c, w: W, h: H }; SPR.cache.set(ck, out); return out;
};

/* ---------- ore, trees, puffs ---------- */
SPR.ore = (function () { let c = null; return function () { if (c) return c; const s = mk(32, 32), x = s.x; const r = RNG(7);
  for (let i = 0; i < 9; i++) { const cx = r.range(5, 27), cy = r.range(5, 27), sz = r.range(2.2, 4.4); circ(x, cx + 1, cy + 1.5, sz * 0.9, 'rgba(0,0,0,0.25)'); poly(x, [cx, cy - sz * 1.5, cx + sz, cy - sz * 0.1, cx + sz * 0.3, cy + sz * 0.8, cx - sz * 0.8, cy + sz * 0.4, cx - sz, cy - sz * 0.3], lg(x, cx - sz, cy - sz, cx + sz, cy + sz, ['#fff2a8', '#e2bf45', '#8a6a1c']), '#6a5216', 0.5); line(x, cx, cy - sz * 1.4, cx + sz * 0.2, cy + sz * 0.6, 'rgba(255,255,255,0.45)', 0.4); }
  c = s.c; return c; }; })();

const TREE_PAL = {
  summer: { broad: ['#3e6a2c', '#4b7a34', '#335a26'], conifer: ['#2b4a2a', '#34563a'], palm: ['#4f7a32', '#5f8a3a'] },
  autumn: { broad: ['#a5632a', '#c0882f', '#8a4a20', '#7a7a30'], conifer: ['#2b4a2a', '#34563a'], palm: ['#6a7a32'] },
  winter: { broad: ['#7a7468', '#8a8478'], conifer: ['#3a5a4a', '#2f4f42'], palm: ['#6a7a5a'], snow: true },
  dry: { broad: ['#5f6a2c', '#727a38', '#4c5a26'], conifer: ['#3c5230', '#465c36'], palm: ['#6a8a3a', '#7a8a40'] },
};
SPR.tree = function (kind, season, v) {
  const ck = 't:' + kind + ':' + season + ':' + v;
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const P = TREE_PAL[season] || TREE_PAL.summer, r = RNG(v * 97 + kind.length * 13), s = centered(26, 26, 2), x = s.x;
  const cols = P[kind] || P.broad, col = cols[v % cols.length];
  if (kind === 'conifer') {
    for (let layer = 0; layer < 3; layer++) {
      const R = 10 - layer * 3;
      x.beginPath(); for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, rad = k % 2 ? R * 0.55 : R; k ? x.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : x.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); } x.closePath();
      x.fillStyle = rg(x, -R * 0.35, -R * 0.35, 0.5, R, [COL.shade(col, 0.25 + layer * 0.1), col, COL.shade(col, -0.35)]); x.fill();
      if (P.snow) { x.fillStyle = 'rgba(240,244,246,0.6)'; x.fill(); }
    }
    circ(x, 0, 0, 1, '#2a2218');
  } else if (kind === 'palm') {
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + r() * 0.3; x.save(); x.rotate(a); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(5, -2.5, 11, 0.5); x.quadraticCurveTo(5, 1.6, 0, 0); x.fillStyle = lg(x, 0, 0, 11, 0, [COL.shade(col, 0.15), COL.shade(col, -0.25)]); x.fill(); x.restore(); }
    circ(x, 0, 0, 1.6, '#5a4630');
  } else {
    const lobes = 5 + (v % 3);
    for (let k = 0; k < lobes; k++) { const a = (k / lobes) * Math.PI * 2 + r() * 0.5, d = 4 + r() * 2, R = 5 + r() * 2.5;
      circ(x, Math.cos(a) * d, Math.sin(a) * d, R, rg(x, Math.cos(a) * d - R * 0.4, Math.sin(a) * d - R * 0.4, 0.4, R, [COL.shade(col, 0.3), col, COL.shade(col, -0.32)])); }
    circ(x, -1, -1, 5, rg(x, -2.5, -2.5, 0.4, 5, [COL.shade(col, 0.35), COL.shade(col, 0.05)]));
    if (P.snow) for (let k = 0; k < 6; k++) circ(x, r.range(-6, 4), r.range(-6, 4), 1.2, 'rgba(240,244,246,0.55)');
  }
  grit(s, 0.12);
  const out = { img: s.c, shadow: silhouette(s.c, 'rgba(0,0,0,0.3)', 2), w: s.w, h: s.h };
  SPR.cache.set(ck, out); return out;
};

SPR.puff = function (c) {
  const ck = 'p:' + c; let p = SPR.cache.get(ck); if (p) return p;
  p = U.canvas(64, 64); const g = p.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(' + c + ',1)'); gr.addColorStop(0.45, 'rgba(' + c + ',0.6)'); gr.addColorStop(1, 'rgba(' + c + ',0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); SPR.cache.set(ck, p); return p;
};

SPR.civAgent = function (type, v) {
  const ck = 'ca:' + type + ':' + v;
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const cars = ['#c0503a', '#3c6a9c', '#e3e1d8', '#3d3f42', '#7a8a4a', '#c99a2a', '#8a8f94'];
  let s;
  const box = (L, W, col, roofCol) => { s = centered(L, W, 2); fillRR(s.x, -L / 2 + 0.6, -W / 2 + 0.8, L, W, 2, 'rgba(0,0,0,0.3)'); fillRR(s.x, -L / 2, -W / 2, L, W, 2, lg(s.x, 0, -W / 2, 0, W / 2, [COL.shade(col, 0.25), col, COL.shade(col, -0.3)]), COL.shade(col, -0.5), 0.5);
    fillRR(s.x, -L / 4, -W / 2 + 1.1, L / 2, W - 2.2, 1, roofCol || COL.shade(col, 0.12)); fillRR(s.x, L / 4 - 0.6, -W / 2 + 1.3, 2.4, W - 2.6, 0.6, lg(s.x, 0, -W / 2, 0, W / 2, ['#b8d8ea', '#3d6a88'])); fillRR(s.x, -L / 4 - 1.6, -W / 2 + 1.5, 1.4, W - 3, 0.5, '#3d6a88'); };
  switch (type) {
    case 'car': box(12, 6.5, cars[v % cars.length]); break;
    case 'van': box(14, 7, '#e7e5dc'); fillRR(s.x, -5, -1, 6, 2, 0.5, '#d65a3a'); break;
    case 'truck': s = centered(20, 8, 2); fillRR(s.x, -10, -4, 15, 8, 1, lg(s.x, 0, -4, 0, 4, [COL.shade(['#6d6f68', '#8a5a3a', '#3c6a8c'][v % 3], 0.2), ['#6d6f68', '#8a5a3a', '#3c6a8c'][v % 3]]), '#222', 0.5); fillRR(s.x, 5, -3.5, 5, 7, 1, '#d9d4c4', '#333', 0.5); fillRR(s.x, 8.4, -3, 1.2, 6, 0.4, '#5a86a4'); break;
    case 'bus': s = centered(24, 8, 2); fillRR(s.x, -12, -4, 24, 8, 2, lg(s.x, 0, -4, 0, 4, ['#f0c050', '#c9961a']), '#5a4410', 0.6); for (let i = 0; i < 5; i++) fillRR(s.x, -9 + i * 4.2, -3.2, 2.8, 6.4, 0.5, '#e8ce7a'); fillRR(s.x, 10.5, -3, 1, 6, 0.3, '#5a86a4'); break;
    case 'ambulance': box(14, 7, '#f2f2ee'); greenCross(s.x, -2, 0, 2.5); break;
    case 'police': box(12, 6.5, '#e8e8ec', '#2f5aa8'); break;
    case 'fire': s = centered(18, 8, 2); fillRR(s.x, -9, -4, 18, 8, 1.5, lg(s.x, 0, -4, 0, 4, ['#e0423a', '#a01a14']), '#5a0f0c', 0.6); line(s.x, -7, 0, 6, 0, '#ccc', 1.4); fillRR(s.x, 6.5, -3, 1.2, 6, 0.4, '#5a86a4'); break;
    case 'tractor': s = centered(12, 9, 2); fillRR(s.x, -6, -4.5, 5, 9, 1, '#222'); fillRR(s.x, -3, -3, 9, 6, 1.5, lg(s.x, 0, -3, 0, 3, ['#4aaa4a', '#2a6a2a']), '#1a4a1a', 0.6); break;
    case 'train': s = centered(30, 9, 2); fillRR(s.x, -15, -4.5, 30, 9, 2, lg(s.x, 0, -4.5, 0, 4.5, ['#7a8aaa', '#4a5a7a']), '#222', 0.6); fillRR(s.x, 8, -4, 6, 8, 1, '#c99a2a'); break;
    case 'wagon': s = centered(30, 9, 2); fillRR(s.x, -15, -4.5, 30, 9, 1, lg(s.x, 0, -4.5, 0, 4.5, [COL.shade(['#7a5a3a', '#6d6f68', '#4a6a5a'][v % 3], 0.2), COL.shade(['#7a5a3a', '#6d6f68', '#4a6a5a'][v % 3], -0.25)]), '#222', 0.6); for (let i = 1; i < 5; i++) line(s.x, -15 + i * 6, -4, -15 + i * 6, 4, 'rgba(0,0,0,0.25)', 0.5); break;
    case 'crew': box(13, 7, '#e3b82b'); break;
    default: {
      // 3-frame animated civilian pedestrian sprite sheet (idle, left stride, right stride)
      const S = 10;
      s = mk(S * 3, S);
      const coatCols = ['#3b5978', '#8c4638', '#4b6844', '#7a6852', '#524b6e', '#b58938', '#3c444c', '#985262', '#5d7a78', '#c6bcb0'];
      const hairCols = ['#241c16', '#5a3c24', '#8c6238', '#18181a', '#b89458', '#686868'];
      const skinCols = ['#e6c2a0', '#c4926c', '#7a5238'];
      const coat = coatCols[v % coatCols.length];
      const pants = COL.shade(coatCols[(v + 3) % coatCols.length], -0.28);
      const hair = hairCols[v % hairCols.length];
      const skin = skinCols[v % skinCols.length];
      const hasBag = v % 3 === 0, hasHat = v % 5 === 0;
      for (let f = 0; f < 3; f++) {
        const x = s.x; x.save(); x.translate(f * S + S / 2, S / 2);
        const stride = f === 1 ? 1.5 : f === 2 ? -1.5 : 0;
        // Soft ground shadow
        circ(x, 0.5, 0.6, 2.7, 'rgba(0,0,0,0.28)');
        // Walking legs & shoes
        for (const [side, off] of [[-1, stride], [1, -stride]]) {
          fillRR(x, -1.2 + off * 0.65, side * 1.3 - 0.6, 2.3, 1.2, 0.5, pants);
          circ(x, -1.2 + off * 0.65 + (off >= 0 ? 2.0 : -0.1), side * 1.3, 0.55, '#1e1b18');
        }
        // Optional backpack
        if (hasBag) fillRR(x, -2.8, -1.5, 1.6, 3.0, 0.6, COL.shade(coat, -0.35), 'rgba(0,0,0,0.4)', 0.3);
        // Shoulders / coat torso
        x.beginPath(); x.ellipse(0, 0, 1.85, 2.65, 0, 0, Math.PI * 2);
        x.fillStyle = lg(x, -1.8, -2.6, 1.8, 2.6, [COL.shade(coat, 0.22), coat, COL.shade(coat, -0.3)]);
        x.fill(); x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.3; x.stroke();
        // Swinging arms & hands
        for (const [side, off] of [[-1, -stride], [1, stride]]) {
          line(x, 0, side * 2.1, 0.6 + off * 0.55, side * 2.15, COL.shade(coat, -0.08), 0.95);
          circ(x, 0.8 + off * 0.55, side * 2.15, 0.45, skin);
        }
        // Head & hair / hat
        circ(x, 0.35, 0, 1.45, skin, 'rgba(0,0,0,0.35)', 0.25);
        if (hasHat) {
          circ(x, 0.2, 0, 1.55, COL.shade(coat, 0.15), 'rgba(0,0,0,0.4)', 0.25);
        } else {
          x.beginPath(); x.arc(0.15, 0, 1.42, 0.65, -0.65); x.closePath();
          x.fillStyle = hair; x.fill();
        }
        x.restore();
      }
      const out = { img: s.c, w: S, h: S, ped: true }; SPR.cache.set(ck, out); return out;
    }
  }
  const out = { img: s.c, w: s.w, h: s.h }; SPR.cache.set(ck, out); return out;
};

/* ---------- UI icons ---------- */
SPR.icon = function (kind, key, fk) {
  const ck = 'i:' + kind + ':' + key + ':' + fk;
  if (SPR.cache.has(ck)) return SPR.cache.get(ck);
  const c = U.canvas(132, 96), x = c.getContext('2d');
  x.fillStyle = lg(x, 0, 0, 0, 96, ['#4a5a3e', '#3a4730']); x.fillRect(0, 0, 132, 96);
  x.globalAlpha = 0.25; x.fillStyle = x.createPattern(SPR.noise(), 'repeat'); x.fillRect(0, 0, 132, 96); x.globalAlpha = 1;
  x.fillStyle = rg(x, 66, 48, 10, 80, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']); x.fillRect(0, 0, 132, 96);
  if (kind === 'unit') {
    const sp = SPR.unit(key, fk), d = UNITS[key];
    const sc = d.cat === 'inf' ? 4.4 : Math.min(116 / sp.w, 84 / sp.h, 3.6);
    x.save(); x.translate(66, 50); x.rotate(-0.5);
    if (sp.inf) { x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.ellipse(4, 6, 22, 16, 0, 0, 6.28); x.fill(); x.drawImage(sp.body, 0, 0, 16 * SPR.S, 16 * SPR.S, -8 * sc, -8 * sc, 16 * sc, 16 * sc); }
    else { if (sp.shadow) x.drawImage(sp.shadow, -sp.w * sc / 2 + 5, -sp.h * sc / 2 + 7, sp.w * sc, sp.h * sc); x.drawImage(sp.body, -sp.w * sc / 2, -sp.h * sc / 2, sp.w * sc, sp.h * sc); if (sp.tur) { x.translate(sp.tox * sc, 0); x.drawImage(sp.tur, -sp.tw * sc / 2, -sp.th * sc / 2, sp.tw * sc, sp.th * sc); } }
    x.restore();
  } else if (kind === 'bld') {
    const sp = SPR.bld(key, fk, 1), sc = Math.min(118 / sp.w, 86 / sp.h, 2.6);
    x.drawImage(sp.img, 66 - sp.w * sc / 2, 50 - sp.h * sc / 2, sp.w * sc, sp.h * sc);
    const t = SPR.bldTurret(key, fk, 1); if (t) { const d = BLDS[key]; x.save(); x.translate(66 - sp.w * sc / 2 + d.w * TILE * sc / 2, 50 - sp.h * sc / 2 + d.h * TILE * sc / 2); x.rotate(-0.6); x.drawImage(t.img, -t.w * sc / 2, -t.h * sc / 2, t.w * sc, t.h * sc); x.restore(); }
  } else if (kind === 'tech') {
    x.fillStyle = '#1c2327'; x.fillRect(0, 0, 132, 96);
    x.strokeStyle = FACTIONS[fk].color; x.lineWidth = 3; x.beginPath(); x.arc(66, 48, 26, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#d7dde2'; x.font = '600 26px "Saira Condensed", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(TECH[key].name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase(), 66, 50);
  }
  SPR.cache.set(ck, c);
  return c;
};
