'use strict';
/* =====================================================================
   CITY.RA — earth.js
   Real-world geography: decodes the embedded land mask, samples land,
   approximate climate zones and mountain ranges for any point on Earth,
   names regions, and draws the world picker used in the setup screen.
   Factions remain fictional; Earth supplies the terrain.
   ===================================================================== */

const Earth = {
  land: null, W: 0, H: 0,
  decode() {
    this.decodeCountries();
    if (this.land) return;
    const E = EARTH_MASK, W = E.w, H = E.h, bin = atob(E.rle), n = bin.length;
    const land = new Uint8Array(W * H);
    let p = 0;
    for (let y = 0; y < H; y++) {
      let x = 0, v = 0, o = y * W;
      while (x < W && p < n) {
        let run = 0, sh = 0, b;
        do { b = bin.charCodeAt(p++); run |= (b & 127) << sh; sh += 7; } while (b & 128);
        if (v) land.fill(1, o + x, o + Math.min(W, x + run));
        x += run; v ^= 1;
      }
    }
    this.land = land; this.W = W; this.H = H;
  },
  idx(lat, lon) {
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    const x = U.clamp(Math.floor((lon + 180) / EARTH_MASK.step), 0, this.W - 1), y = U.clamp(Math.floor((90 - lat) / EARTH_MASK.step), 0, this.H - 1);
    return y * this.W + x;
  },
  isLand(lat, lon) { return this.land[this.idx(lat, lon)] === 1; },
  // bilinear land fraction 0..1
  landF(lat, lon) {
    const s = EARTH_MASK.step, fx = (lon + 180) / s - 0.5, fy = (90 - lat) / s - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0, W = this.W, H = this.H;
    const g = (x, y) => this.land[U.clamp(y, 0, H - 1) * W + ((x % W) + W) % W];
    return g(x0, y0) * (1 - kx) * (1 - ky) + g(x0 + 1, y0) * kx * (1 - ky) + g(x0, y0 + 1) * (1 - kx) * ky + g(x0 + 1, y0 + 1) * kx * ky;
  },


  /* ---------- countries (Natural Earth raster, 0.1 deg) and real cities ---------- */
  cty: null,
  decodeCountries() {
    if (this.cty) return;
    const E = COUNTRY_DATA, W = E.w, H = E.h, bin = atob(E.rle), n = bin.length, a = new Uint8Array(W * H);
    let p = 0;
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W && p < n) {
        const v = bin.charCodeAt(p++); let run = 0, sh = 0, b;
        do { b = bin.charCodeAt(p++); run |= (b & 127) << sh; sh += 7; } while (b & 128);
        if (v) a.fill(v, y * W + x, y * W + Math.min(W, x + run));
        x += run;
      }
    }
    this.cty = a; this.CTW = W; this.CTH = H;
  },
  countryRaw(lat, lon) {
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    const x = U.clamp(Math.floor((lon + 180) / COUNTRY_DATA.step), 0, this.CTW - 1), y = U.clamp(Math.floor((90 - lat) / COUNTRY_DATA.step), 0, this.CTH - 1);
    return this.cty[y * this.CTW + x];
  },
  countryName(i) { return i > 0 ? COUNTRY_DATA.names[i] : ''; },
  // smoothed country lookup: majority of a small gaussian neighbourhood, so borders are curves instead of 11 km staircases
  country(lat, lon) {
    const st = COUNTRY_DATA.step, fx = (lon + 180) / st - 0.5, fy = (90 - lat) / st - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), W = this.CTW, H = this.CTH;
    const g = (x, y) => this.cty[U.clamp(y, 0, H - 1) * W + (((x % W) + W) % W)];
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    if (a === b && a === c && a === d) return a;
    const votes = {}; let best = 0, bw = -1;
    for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
      const dx = x0 + i - fx, dy = y0 + j - fy, w = Math.exp(-(dx * dx + dy * dy) / 0.9), v = g(x0 + i, y0 + j);
      const t = (votes[v] || 0) + w; votes[v] = t; if (t > bw) { bw = t; best = v; }
    }
    return best;
  },
  /* the lat/lon rectangle of a theatre. span = latitude span (deg); lspan = longitude span (deg) */
  rect(g) {
    const lspan = g.lspan || Math.min(360, g.span / Math.max(0.2, Math.cos((g.lat * Math.PI) / 180)));
    return { lat0: g.lat - g.span / 2, lat1: g.lat + g.span / 2, lon0: g.lon - lspan / 2, lon1: g.lon + lspan / 2, lspan };
  },
  // tile dimensions for a theatre: the long side gets `size` tiles, tiles are square at the centre latitude
  dims(g, size) {
    const r = this.rect(g), kmW = r.lspan * 111.2 * Math.max(0.15, Math.cos((g.lat * Math.PI) / 180)), kmH = g.span * 111.2;
    let W = size, H = size;
    if (kmW >= kmH) H = Math.round(size * kmH / kmW); else W = Math.round(size * kmW / kmH);
    W = U.clamp(W, 64, size); H = U.clamp(H, 64, size);
    return { W, H, kmW, kmH, km: Math.max(kmW / W, kmH / H) };
  },
  citiesIn(r) {
    const out = [];
    for (const c of CITY_DATA) {
      let lo = c[2]; if (lo < r.lon0) lo += 360; if (lo > r.lon1) lo -= 360;
      if (c[1] >= r.lat0 && c[1] <= r.lat1 && lo >= r.lon0 && lo <= r.lon1) out.push({ name: c[0], lat: c[1], lon: lo, pop: c[3], ctry: c[4], cap: !!c[5] });
    }
    return out;
  },
  countriesIn(r, n = 4) {
    const cnt = {};
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { const c = this.countryRaw(r.lat1 - ((i + 0.5) / 24) * (r.lat1 - r.lat0), r.lon0 + ((j + 0.5) / 24) * (r.lon1 - r.lon0)); if (c) cnt[c] = (cnt[c] || 0) + 1; }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => this.countryName(+k));
  },

  /* approximate mountain ranges as polylines [lat, lon] with half-width (deg) and peak */
  RANGES: [
    [[[27.5, 73], [29, 80], [28, 86], [27.8, 92], [28.5, 97]], 1.6, 1], [[[35, 70], [36, 75], [35.5, 78]], 1.3, 1], [[[42, 70], [42.5, 78], [43, 86]], 1.2, 0.85],
    [[[44, 6.5], [46, 8], [46.5, 10.5], [47, 13], [47.5, 15]], 0.7, 0.85], [[[42.8, -1.8], [42.6, 2.5]], 0.45, 0.7], [[[49.5, 19], [48.5, 24], [46, 25.5], [45.5, 22.5]], 0.6, 0.55],
    [[[43.5, 40], [42.5, 45], [41, 48.5]], 0.6, 0.85], [[[36.5, 45.5], [33, 48], [30, 52], [28, 56]], 0.9, 0.7], [[[66, 64], [60, 59.5], [55, 59], [51, 58]], 0.8, 0.45],
    [[[31, -8], [33, -4], [35.3, 2], [36.5, 8]], 0.7, 0.65], [[[62, -135], [56, -125], [50, -116], [45, -111], [40, -106], [35, -106]], 2, 0.8], [[[49, -121], [44, -122], [38, -119.5], [35, -118]], 0.8, 0.7],
    [[[47, -69], [43, -74], [38, -80], [34.5, -84]], 1, 0.4], [[[10, -73], [2, -77.5], [-6, -78], [-14, -73], [-18, -69], [-28, -69], [-36, -70.5], [-44, -72], [-51, -73]], 1.3, 1],
    [[[69, 18], [65, 14], [61.5, 8.5]], 0.9, 0.55], [[[13.5, 38.5], [9, 39], [7, 37]], 1.3, 0.65], [[[-15, 145], [-25, 151], [-33, 150], [-37, 146.5]], 0.9, 0.35],
    [[[35.5, 137.5], [37.5, 139]], 0.5, 0.65], [[[45.5, 15], [43.5, 17.5], [42, 20.5], [40, 21.5]], 0.6, 0.5], [[[44.2, 10], [42.3, 13.5], [40.3, 16]], 0.4, 0.45],
    [[[37, 30], [38.2, 36], [39, 42]], 0.9, 0.55], [[[50.5, 85], [48, 90]], 1.2, 0.65], [[[16, -98], [19, -100], [24, -104.5], [29, -107.5]], 0.9, 0.55],
    [[[-1, 29.5], [-8, 30.5]], 0.6, 0.55], [[[34, 102], [32, 98], [36, 92]], 1.5, 0.85], [[[24, 46.5], [20, 42], [16, 43.5]], 0.7, 0.45], [[[-29, 29.5], [-32, 26]], 0.8, 0.5],
  ],
  PLATEAUS: [[30, 37, 78, 100, 0.75], [33, 39, 53, 62, 0.4], [-24, -14, -70, -64, 0.75], [7, 14, 35, 41, 0.5], [38, 46, 88, 96, 0.35]],
  elev(lat, lon) {
    let e = 0;
    for (const [pts, w, pk] of this.RANGES) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [a1, o1] = pts[i], [a2, o2] = pts[i + 1];
        const dx = o2 - o1, dy = a2 - a1, L = dx * dx + dy * dy, t = L ? U.clamp(((lon - o1) * dx + (lat - a1) * dy) / L, 0, 1) : 0;
        const d = Math.hypot(lon - (o1 + dx * t), lat - (a1 + dy * t)) / w;
        if (d < 1.6) e = Math.max(e, pk * Math.exp(-d * d * 1.6));
      }
    }
    for (const [la0, la1, lo0, lo1, h] of this.PLATEAUS) if (lat > la0 && lat < la1 && lon > lo0 && lon < lo1) e = Math.max(e, h);
    return e;
  },
  DESERTS: [[15, 31, -17, 34], [14, 31, 34, 59], [24, 37, 55, 73], [37, 45, 52, 68], [36, 45, 76, 110], [-31, -19, 117, 142], [24, 37, -117, -102.5], [-28, -17, -71.5, -69], [-28, -17, 12, 25], [-50, -38, -70, -65], [30, 40, 85, 100]],
  climate(lat0, lon0) {
    const lat = lat0 + Math.sin(lon0 * 0.45) * 1.6 + Math.sin(lon0 * 1.7 + lat0) * 0.7, lon = lon0 + Math.sin(lat0 * 0.5) * 2.2 + Math.sin(lat0 * 2.1 + lon0 * 0.3) * 0.9;
    const a = Math.abs(lat);
    for (const [la0, la1, lo0, lo1] of this.DESERTS) if (lat > la0 && lat < la1 && lon > lo0 && lon < lo1) return 'arid';
    if (a > 66) return 'polar';
    if (a > 54) return 'boreal';
    if (a < 11) return 'tropical';
    if (a < 22) return 'savanna';
    if (lat > 30 && lat < 45 && lon > -10 && lon < 42) return 'mediterranean';
    return 'temperate';
  },
  CLIMATE_LABEL: { polar: 'Polar tundra', boreal: 'Boreal forest', tropical: 'Tropical rainforest', savanna: 'Savanna', mediterranean: 'Mediterranean', temperate: 'Temperate', arid: 'Arid desert' },
  defaultSeason(c) { return c === 'polar' ? 'winter' : c === 'arid' || c === 'savanna' ? 'dry' : c === 'boreal' ? 'autumn' : 'summer'; },

  REGIONS: [
    ['Western Europe', 47, 3], ['British Isles', 54, -3], ['Scandinavia', 62, 14], ['Baltic', 57, 23], ['Central Europe', 50, 14], ['Balkans', 43, 21], ['Iberia', 40, -4], ['Italy', 42.5, 12.5], ['Eastern Europe', 50, 30], ['Black Sea', 44, 34],
    ['Caucasus', 42, 44], ['Anatolia', 39, 33], ['Levant', 33, 36], ['Mesopotamia', 33, 44], ['Arabian Peninsula', 23, 46], ['Persian Gulf', 27, 51], ['Iranian Plateau', 32, 54], ['Central Asia', 42, 64], ['Hindu Kush', 34, 68], ['Indian Subcontinent', 22, 79],
    ['Himalaya', 29, 85], ['Tibet', 33, 89], ['Bay of Bengal', 18, 89], ['Indochina', 16, 103], ['Malay Archipelago', 1, 110], ['Philippines', 12, 122], ['South China', 25, 112], ['North China Plain', 36, 116], ['Korean Peninsula', 37.5, 127.5], ['Japan', 36, 138],
    ['Mongolia', 46, 103], ['Siberia', 60, 100], ['Russian Far East', 55, 135], ['Arctic Russia', 70, 75], ['Ural region', 57, 60], ['Volga basin', 53, 46], ['North Africa', 31, 5], ['Nile valley', 26, 31.5], ['Sahara', 22, 10], ['Sahel', 14, 5],
    ['Horn of Africa', 8, 44], ['West Africa', 8, -4], ['Congo basin', -1, 22], ['East Africa', -3, 36], ['Southern Africa', -26, 27], ['Madagascar', -19, 46.5], ['Australia', -25, 134], ['Eastern Australia', -32, 150], ['New Zealand', -42, 173], ['Indonesia', -5, 118],
    ['Alaska', 64, -152], ['Canadian Shield', 55, -85], ['Pacific Northwest', 47, -122], ['California', 37, -120], ['Great Plains', 41, -100], ['Rocky Mountains', 41, -107], ['Great Lakes', 44, -84], ['US Northeast', 41.5, -74], ['US Southeast', 33, -84], ['Gulf of Mexico', 27, -91],
    ['Mexico', 22, -102], ['Central America', 13, -86], ['Caribbean', 18.5, -73], ['Venezuela', 7, -66], ['Amazon basin', -4, -62], ['Andes', -14, -72], ['Brazilian Highlands', -16, -46], ['Pampas', -35, -62], ['Patagonia', -46, -69], ['Greenland', 72, -40], ['Iceland', 65, -18], ['Antarctica', -78, 0],
  ],
  regionName(lat, lon) {
    let best = null, bd = 1e9;
    for (const [n, la, lo] of this.REGIONS) { const d = Math.hypot((lon - lo) * Math.cos((lat * Math.PI) / 180), lat - la); if (d < bd) { bd = d; best = n; } }
    return bd < 14 ? best : 'Open ocean';
  },
  // fraction of land in a theatre box
  theatreLand(lat, lon, span) {
    const lonSpan = span / Math.max(0.2, Math.cos((lat * Math.PI) / 180)); let n = 0, l = 0;
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { n++; l += this.isLand(lat + span / 2 - ((i + 0.5) / 24) * span, lon - lonSpan / 2 + ((j + 0.5) / 24) * lonSpan) ? 1 : 0; }
    return l / n;
  },

  /* world picker image (equirectangular) */
  CLIMATE_COL: { polar: [226, 232, 234], boreal: [58, 84, 52], tropical: [42, 98, 46], savanna: [150, 146, 78], mediterranean: [128, 132, 76], temperate: [88, 118, 62], arid: [204, 176, 120] },
  worldImage(w, h) {
    this.decode();
    const c = U.canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), D = img.data;
    for (let y = 0; y < h; y++) {
      const lat = 90 - ((y + 0.5) / h) * 180;
      for (let x = 0; x < w; x++) {
        const lon = -180 + ((x + 0.5) / w) * 360, o = (y * w + x) * 4;
        const lf = this.landF(lat, lon);
        if (lf > 0.5) {
          const col = this.CLIMATE_COL[this.climate(lat, lon)], e = this.elev(lat, lon), n = 0.92 + hash2(x, y, 3) * 0.12;
          const k = n * (1 - e * 0.15), m = e * 70;
          D[o] = Math.min(255, col[0] * k + m); D[o + 1] = Math.min(255, col[1] * k + m * 0.95); D[o + 2] = Math.min(255, col[2] * k + m * 0.9);
        } else {
          const coast = lf > 0.05 ? 1 : 0;
          D[o] = 14 + coast * 30; D[o + 1] = 38 + coast * 40 + Math.abs(lat) * 0.15; D[o + 2] = 62 + coast * 45;
        }
        D[o + 3] = 255;
      }
    }
    // country borders
    const cc = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { const lat = 90 - ((y + 0.5) / h) * 180; for (let x = 0; x < w; x++) cc[y * w + x] = this.countryRaw(lat, -180 + ((x + 0.5) / w) * 360); }
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const a = cc[y * w + x], b = cc[y * w + x + 1], c = cc[(y + 1) * w + x];
      if (a && ((b && b !== a) || (c && c !== a))) { const o = (y * w + x) * 4; D[o] = D[o] * 0.45 + 140; D[o + 1] = D[o + 1] * 0.45 + 125; D[o + 2] = D[o + 2] * 0.45 + 90; }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(220,230,235,0.12)'; g.lineWidth = 1;
    for (let la = -60; la <= 60; la += 30) { const y = ((90 - la) / 180) * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let lo = -150; lo <= 150; lo += 30) { const x = ((lo + 180) / 360) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    return c;
  },
};

/* ---------- world picker widget for the setup screen ---------- */
const EarthPicker = {
  // latitude span in degrees; 'custom' means the user dragged a rectangle
  presets: [['0.5', 'Skirmish · 55 km'], ['1.2', 'Local war · 130 km'], ['2.5', 'Regional · 280 km'], ['4', 'National · 440 km'], ['6.5', 'Wide · 720 km'], ['10', 'Continental · 1,100 km'], ['20', 'Multi-nation · 2,200 km'], ['40', 'Super-region · 4,400 km'], ['150', 'Whole world · 16,000 km'], ['custom', 'Custom — drag a box on the map']],
  apply(o, span) {
    const g = o.geo;
    if (span === 'custom') { g.preset = 'custom'; return; }
    g.preset = String(span); g.span = +span;
    if (g.span >= 100) { g.lat = 5; g.lon = 0; g.span = 150; g.lspan = 360; } else { g.lspan = Math.min(360, g.span / Math.max(0.2, Math.cos((g.lat * Math.PI) / 180))); }
    g.lat = U.clamp(g.lat, -85 + g.span / 2, 85 - g.span / 2);
  },
  draw(cv, o) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    if (!this.img || this.img.width !== W) this.img = Earth.worldImage(W, H);
    g.drawImage(this.img, 0, 0);
    const r = Earth.rect(o.geo), drag = this.drag;
    const rr = drag ? drag.r : r;
    const x = ((rr.lon0 + 180) / 360) * W, y = ((90 - rr.lat1) / 180) * H, w = ((rr.lon1 - rr.lon0) / 360) * W, h = ((rr.lat1 - rr.lat0) / 180) * H;
    g.fillStyle = 'rgba(240,199,122,0.10)'; g.fillRect(x, y, Math.max(4, w), Math.max(4, h));
    g.strokeStyle = '#f0c77a'; g.lineWidth = 2; g.strokeRect(x, y, Math.max(4, w), Math.max(4, h));
    g.strokeStyle = 'rgba(240,199,122,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + w / 2, 0); g.lineTo(x + w / 2, y); g.moveTo(x + w / 2, y + h); g.lineTo(x + w / 2, H); g.moveTo(0, y + h / 2); g.lineTo(x, y + h / 2); g.moveTo(x + w, y + h / 2); g.lineTo(W, y + h / 2); g.stroke();
    // large cities as dots
    g.fillStyle = 'rgba(255,238,190,0.85)';
    for (const c of CITY_DATA) { if (c[3] < 2500) continue; g.fillRect(((c[2] + 180) / 360) * W - 1, ((90 - c[1]) / 180) * H - 1, 2, 2); }
  },
  ll(cv, e) {
    const r = cv.getBoundingClientRect(), fx = U.clamp((e.clientX - r.left) / r.width, 0, 1), fy = U.clamp((e.clientY - r.top) / r.height, 0, 1);
    return { lat: U.clamp(90 - fy * 180, -85, 85), lon: -180 + fx * 360 };
  },
  down(cv, e, o) { this.drag = { a: this.ll(cv, e), moved: false, r: Earth.rect(o.geo) }; },
  move(cv, e, o) {
    const d = this.drag; if (!d) return; const b = this.ll(cv, e);
    if (Math.abs(b.lat - d.a.lat) + Math.abs(b.lon - d.a.lon) > 1.2) d.moved = true;
    if (d.moved) d.r = { lat0: Math.min(d.a.lat, b.lat), lat1: Math.max(d.a.lat, b.lat), lon0: Math.min(d.a.lon, b.lon), lon1: Math.max(d.a.lon, b.lon) };
    this.draw(cv, o);
  },
  up(cv, e, o) {
    const d = this.drag; this.drag = null; if (!d) return false;
    const g = o.geo;
    if (d.moved) {
      const r = d.r, span = Math.max(0.3, r.lat1 - r.lat0), lspan = Math.max(0.3, r.lon1 - r.lon0);
      g.lat = (r.lat0 + r.lat1) / 2; g.lon = (r.lon0 + r.lon1) / 2; g.span = span; g.lspan = lspan; g.preset = 'custom';
    } else {
      const p = this.ll(cv, e); g.lat = p.lat; g.lon = p.lon;
      if (g.preset === 'custom') { g.preset = '2.5'; g.span = 2.5; }
      this.apply(o, g.preset);
    }
    return true;
  },
  info(o, size) {
    const g = o.geo, r = Earth.rect(g), c = Earth.climate(g.lat, g.lon), dm = Earth.dims(g, size || 256);
    let land = 0, n = 0;
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) { n++; land += Earth.isLand(r.lat1 - ((i + 0.5) / 20) * (r.lat1 - r.lat0), r.lon0 + ((j + 0.5) / 20) * (r.lon1 - r.lon0)) ? 1 : 0; }
    return { region: g.span >= 100 ? 'Entire planet' : Earth.regionName(g.lat, g.lon), climate: g.span >= 100 ? 'All zones' : Earth.CLIMATE_LABEL[c], season: Earth.defaultSeason(c), land: land / n, km: Math.round(dm.kmW) + ' × ' + Math.round(dm.kmH) + ' km', perTile: dm.km, W: dm.W, H: dm.H, countries: Earth.countriesIn(r, 4), cities: Earth.citiesIn(r).length };
  },
};
