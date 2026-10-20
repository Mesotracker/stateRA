'use strict';
/* =====================================================================
   CITY.RA — core.js
   Constants, math helpers, seeded RNG + noise, spatial grid, pools,
   event bus and binary encoding used by every other module.
   ===================================================================== */

const TILE = 32;
const TER = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, DESERT: 5, ROCK: 6, FARM: 7, URBAN: 8, MUD: 9 };
const TER_INFO = [
  { name: 'Deep water', water: true },
  { name: 'Shallow water', water: true },
  { name: 'Beach' },
  { name: 'Grassland' },
  { name: 'Forest', cover: 0.35 },
  { name: 'Desert' },
  { name: 'Mountain', cover: 0.25 },
  { name: 'Farmland' },
  { name: 'Urban', cover: 0.4 },
  { name: 'Wetland', cover: 0.1 },
];
// Movement cost multipliers per movement class, indexed by terrain id. 0 = impassable.
const MOVE = {
  foot:  [0, 0, 1.15, 1, 1.25, 1.15, 2.4, 1.1, 1, 1.6],
  wheel: [0, 0, 1.35, 1.1, 2.2, 1.25, 0, 1.25, 1, 2.4],
  track: [0, 0, 1.2, 1, 1.45, 1.1, 0, 1.15, 1, 1.7],
  hover: [1, 1, 1, 1, 0, 1.1, 0, 1.15, 1, 1],
  naval: [1, 1.25, 0, 0, 0, 0, 0, 0, 0, 0],
  beach: [1, 1, 1.5, 0, 0, 0, 0, 0, 0, 0],
};

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  d2: (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
  ang: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
  angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; },
  turn(a, b, max) { const d = U.angDiff(a, b); return Math.abs(d) <= max ? b : a + Math.sign(d) * max; },
  rnd: (a, b) => a + Math.random() * (b - a),
  rint: (n) => (Math.random() * n) | 0,
  pick: (arr) => arr[(Math.random() * arr.length) | 0],
  chance: (p) => Math.random() < p,
  num(n) { return Math.round(n || 0).toLocaleString('en-US'); },
  fmt(n) { n = Math.floor(n); if (Math.abs(n) >= 100000) return (n / 1000).toFixed(0) + 'k'; if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1) + 'k'; return '' + n; },
  time(sec) { sec = Math.floor(sec); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; },
  el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; },
  esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; },
};

/* ---------- colour ---------- */
const COL = {
  rgb(h) {
    if (h.charCodeAt(0) === 114) { const m = h.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]]; }
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  str(r, g, b, a) { return a == null ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`; },
  shade(hex, f) {
    const [r, g, b] = COL.rgb(hex);
    if (f < 0) return COL.str(r * (1 + f), g * (1 + f), b * (1 + f));
    return COL.str(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
  },
  mix(a, b, t) { const A = COL.rgb(a), B = COL.rgb(b); return COL.str(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); },
  alpha(hex, a) { const [r, g, b] = COL.rgb(hex); return COL.str(r, g, b, a); },
};

/* ---------- seeded RNG and value noise ---------- */
function RNG(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
class Noise {
  constructor(seed) { this.s = seed | 0; }
  v(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), s = this.s;
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  fbm(x, y, oct = 5, lac = 2, gain = 0.5) {
    let sum = 0, amp = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { sum += amp * this.v(x * f, y * f); n += amp; amp *= gain; f *= lac; }
    return sum / n;
  }
  ridge(x, y, oct = 5) {
    let sum = 0, amp = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { sum += amp * (1 - Math.abs(this.v(x * f, y * f) * 2 - 1)); n += amp; amp *= 0.5; f *= 2; }
    return sum / n;
  }
}

/* ---------- spatial grid for neighbour queries ---------- */
class Grid {
  constructor(wpx, hpx, cell = 128) {
    this.cell = cell;
    this.cols = Math.ceil(wpx / cell) + 1;
    this.rows = Math.ceil(hpx / cell) + 1;
    this.b = new Array(this.cols * this.rows);
    for (let i = 0; i < this.b.length; i++) this.b[i] = [];
    this.used = [];
  }
  clear() { for (const i of this.used) this.b[i].length = 0; this.used.length = 0; }
  add(e) {
    const cx = U.clamp((e.x / this.cell) | 0, 0, this.cols - 1), cy = U.clamp((e.y / this.cell) | 0, 0, this.rows - 1);
    const i = cy * this.cols + cx, b = this.b[i];
    if (b.length === 0) this.used.push(i);
    b.push(e);
  }
  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell, pad = 72;
    const x0 = Math.max(0, ((x - r - pad) / c) | 0), x1 = Math.min(this.cols - 1, ((x + r + pad) / c) | 0);
    const y0 = Math.max(0, ((y - r - pad) / c) | 0), y1 = Math.min(this.rows - 1, ((y + r + pad) / c) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const b = this.b[cy * this.cols + cx];
      for (let k = 0; k < b.length; k++) {
        const e = b[k], dx = e.x - x, dy = e.y - y, rr = r + (e.rad || 0);
        if (dx * dx + dy * dy <= rr * rr) out.push(e);
      }
    }
    return out;
  }
}

/* ---------- object pool ---------- */
class Pool {
  constructor(make) { this.make = make; this.free = []; }
  get() { return this.free.pop() || this.make(); }
  put(o) { this.free.push(o); }
}

/* ---------- binary heap (min) for A* ---------- */
class Heap {
  constructor() { this.i = []; this.f = []; }
  get size() { return this.i.length; }
  clear() { this.i.length = 0; this.f.length = 0; }
  push(idx, f) {
    const I = this.i, F = this.f; let n = I.length; I.push(idx); F.push(f);
    while (n > 0) { const p = (n - 1) >> 1; if (F[p] <= f) break; I[n] = I[p]; F[n] = F[p]; n = p; }
    I[n] = idx; F[n] = f;
  }
  pop() {
    const I = this.i, F = this.f, top = I[0], li = I.pop(), lf = F.pop(), len = I.length;
    if (len > 0) {
      let n = 0;
      for (;;) {
        let c = 2 * n + 1; if (c >= len) break;
        if (c + 1 < len && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        I[n] = I[c]; F[n] = F[c]; n = c;
      }
      I[n] = li; F[n] = lf;
    }
    return top;
  }
}

/* ---------- event bus ---------- */
const Bus = {
  h: {},
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); },
  emit(ev, ...a) { const l = this.h[ev]; if (l) for (const fn of l) fn(...a); },
};

/* ---------- binary <-> base64 for save files ---------- */
const B64 = {
  enc(typed) {
    const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  },
  dec(b64, Type) {
    const s = atob(b64), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return Type === Uint8Array || !Type ? u8 : new Type(u8.buffer);
  },
};

/* ---------- safe local storage ---------- */
const Store = {
  get(k, d) { try { const v = localStorage.getItem('cityra:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cityra:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem('cityra:' + k); } catch (e) { /* ignore */ } },
};

/* ---------- global game state container ---------- */
const G = {
  map: null, ents: new Map(), units: [], blds: [], civb: [], civs: [], wrecks: [], bridges: [],
  proj: [], parts: [], factions: [], dip: [], settlements: [], player: 0,
  time: 0, day: 0, hour: 9, speed: 1, paused: true, running: false, nextId: 1,
  cam: { x: 0, y: 0, z: 1 }, sel: [], groups: {}, mode: null, objectives: [], weather: { type: 'clear', k: 0, t: 120 },
  hash: null, msgs: [], cfg: {}, stats: { civCas: 0 },
};
function newId() { return G.nextId++; }
