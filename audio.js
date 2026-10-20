'use strict';
/* =====================================================================
   CITY.RA — audio.js
   Synthesised sound effects with WebAudio (no asset files). Volume
   falls off with distance from the camera centre. Starts on first click.
   To use recorded sounds, put URLs into Sound.files[name] = 'x.ogg'.
   ===================================================================== */

const Sound = {
  ctx: null, vol: 0.5, on: true, last: {}, files: {}, buffers: {},
  start() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate; this.noise = this.ctx.createBuffer(1, n, n); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      for (const k in this.files) fetch(this.files[k]).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b)).then((buf) => (this.buffers[k] = buf)).catch(() => {});
    } catch (e) { this.ctx = null; }
  },
  setVol(v) { this.vol = v; if (this.master) this.master.gain.value = v; },
  gainAt(x, y) {
    if (x == null) return 1;
    const v = Render.view(), cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, w = (v.x1 - v.x0);
    const d = Math.hypot(x - cx, y - cy) / Math.max(400, w * 0.8);
    return U.clamp(1.2 - d, 0, 1);
  },
  burst(dur, f0, f1, type, gain, filt) {
    const c = this.ctx, t = c.currentTime, g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let src;
    if (type === 'noise') { src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = f0; }
    else { src = c.createOscillator(); src.type = type; src.frequency.setValueAtTime(f0, t); src.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); }
    let node = src;
    if (filt) { const bq = c.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = filt; node.connect(bq); node = bq; }
    node.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  },
  play(name, x, y, k = 1) {
    if (!this.on || !this.ctx || G.paused) return;
    const now = this.ctx.currentTime, minGap = { rifle: 0.05, mg: 0.06, auto: 0.06, die: 0.15, boom: 0.06 }[name] || 0.03;
    if (now - (this.last[name] || 0) < minGap) return; this.last[name] = now;
    const g = this.gainAt(x, y) * k; if (g < 0.03) return;
    if (this.buffers[name]) { const s = this.ctx.createBufferSource(), gg = this.ctx.createGain(); s.buffer = this.buffers[name]; gg.gain.value = g; s.connect(gg); gg.connect(this.master); s.start(); return; }
    switch (name) {
      case 'rifle': this.burst(0.08, 1.4, 0, 'noise', 0.18 * g, 3200); break;
      case 'mg': this.burst(0.06, 1.2, 0, 'noise', 0.16 * g, 2600); break;
      case 'sniper': this.burst(0.25, 1, 0, 'noise', 0.3 * g, 5000); break;
      case 'auto': this.burst(0.1, 0.9, 0, 'noise', 0.22 * g, 1800); break;
      case 'cannon': this.burst(0.35, 0.6, 0, 'noise', 0.38 * g, 900); this.burst(0.25, 120, 40, 'sine', 0.3 * g); break;
      case 'artillery': this.burst(0.6, 0.5, 0, 'noise', 0.4 * g, 600); this.burst(0.4, 90, 30, 'sine', 0.35 * g); break;
      case 'rocket': case 'salvo': this.burst(0.45, 0.8, 0, 'noise', 0.2 * g, 2400); break;
      case 'missile': this.burst(0.6, 600, 200, 'sawtooth', 0.04 * g, 1400); this.burst(0.5, 1, 0, 'noise', 0.12 * g, 3000); break;
      case 'torp': this.burst(0.5, 200, 80, 'sine', 0.12 * g); break;
      case 'boom': this.burst(0.7 * Math.min(2, k + 0.5), 0.4, 0, 'noise', 0.5 * g, 500); this.burst(0.5, 70, 25, 'sine', 0.4 * g); break;
      case 'bigboom': this.burst(1.6, 0.3, 0, 'noise', 0.7 * g, 400); this.burst(1.2, 55, 20, 'sine', 0.6 * g); break;
      case 'whistle': this.burst(0.7, 1400, 500, 'sine', 0.05 * g); break;
      case 'die': this.burst(0.2, 300, 120, 'triangle', 0.03 * g); break;
      case 'click': this.burst(0.05, 900, 600, 'square', 0.04); break;
      case 'ready': this.burst(0.12, 660, 660, 'triangle', 0.08); setTimeout(() => this.ctx && this.burst(0.18, 880, 880, 'triangle', 0.08), 110); break;
      case 'place': this.burst(0.25, 0.7, 0, 'noise', 0.2, 700); break;
      case 'cash': this.burst(0.1, 1200, 1500, 'square', 0.025 * g); break;
      case 'capture': this.burst(0.3, 440, 880, 'triangle', 0.07 * g); break;
      case 'alert': this.burst(0.25, 520, 380, 'square', 0.06); setTimeout(() => this.ctx && this.burst(0.25, 520, 380, 'square', 0.06), 300); break;
      case 'launch': this.burst(2.5, 0.35, 0, 'noise', 0.6 * g, 700); this.burst(2, 60, 30, 'sawtooth', 0.08 * g, 300); break;
      case 'siren': for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.burst(0.5, 520, 900, 'triangle', 0.07), i * 550); break;
      case 'geiger': this.burst(0.012, 3200 + Math.random() * 1500, 2800, 'square', 0.035); break;
      case 'thunder': this.burst(2.2, 0.25, 0, 'noise', 0.45, 300); break;
    }
  },
};
Bus.on('sfx', (n, x, y, k) => Sound.play(n, x, y, k));
