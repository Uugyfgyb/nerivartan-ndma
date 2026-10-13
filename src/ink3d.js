/* 水墨三维：分子与反应（墨点 + 笔触）、速率曲面（层叠的山）。纯 canvas 2D，无依赖。 */
const Ink3D = (() => {
  const TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const stages = [];
  let T;
  function readTheme() {
    T = {};
    for (const [k, v] of Object.entries({ paper: '--paper', ink: '--ink', soft: '--ink-soft', pale: '--ink-pale', red: '--cinnabar', blue: '--indigo', ochre: '--ochre' })) T[k] = hex(cssVar(v));
    T.dark = T.paper[0] < 90;
    stages.forEach((s) => { s.dirty = true; });
  }
  readTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  class Stage {
    constructor(canvas, o = {}) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.yaw = o.yaw ?? -0.5; this.pitch = o.pitch ?? 0.3;
      this.yaw0 = this.yaw; this.lim = o.lim || { pitch: [-1.45, 1.45] };
      this.motion = reduce ? null : (o.motion || null);
      this.dragging = false; this.touched = false; this.dirty = true; this.visible = false; this.clock = 0;
      this.w = this.h = 1; this.dpr = 1;
      this._bind(); stages.push(this);
    }
    _bind() {
      const cv = this.cv; let px = 0, py = 0;
      cv.addEventListener('pointerdown', (e) => { this.dragging = true; this.touched = true; px = e.clientX; py = e.clientY; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); });
      cv.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        this.rotate((e.clientX - px) * 0.01, (e.clientY - py) * 0.01); px = e.clientX; py = e.clientY;
      });
      const end = () => { this.dragging = false; cv.classList.remove('grabbing'); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      cv.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
        if (!d) return; e.preventDefault(); this.touched = true; this.rotate(d[0], d[1]);
      });
      new ResizeObserver(() => this.resize()).observe(cv);
      new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; if (this.visible) this.dirty = true; }).observe(cv);
    }
    rotate(dy, dp) {
      this.yaw += dy; this.pitch += dp;
      if (this.lim.yaw) this.yaw = clamp(this.yaw, ...this.lim.yaw);
      if (this.lim.pitch) this.pitch = clamp(this.pitch, ...this.lim.pitch);
      this.dirty = true;
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
      this.w = r.width; this.h = r.height; this.dirty = true;
    }
    cam() { this._cy = Math.cos(this.yaw); this._sy = Math.sin(this.yaw); this._cp = Math.cos(this.pitch); this._sp = Math.sin(this.pitch); }
    proj(p, k, D, cx, cy) {
      const x1 = p[0] * this._cy + p[2] * this._sy, z1 = -p[0] * this._sy + p[2] * this._cy;
      const y2 = p[1] * this._cp - z1 * this._sp, z2 = p[1] * this._sp + z1 * this._cp;
      const s = D / (D - z2);
      return { x: cx + x1 * s * k, y: cy - y2 * s * k, z: z2, s };
    }
    step(dt) {
      this.clock += dt;
      if (this.motion && !this.dragging && !this.touched) {
        if (this.motion === 'spin') this.yaw += dt * 0.32;
        else this.yaw = this.yaw0 + Math.sin(this.clock * 0.55) * 0.3;
        this.dirty = true;
      }
      this.tick && this.tick(dt);
      if (this.dirty && this.w > 1) { this.dirty = false; this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.ctx.clearRect(0, 0, this.w, this.h); this.cam(); this.draw(); }
    }
  }

  /* ---------- 分子 / 反应 ---------- */
  const RAD = { C: 0.44, N: 0.42, O: 0.4, H: 0.25 };
  const ease = (u) => u * u * (3 - 2 * u);
  class MolView extends Stage {
    constructor(canvas, o = {}) {
      super(canvas, o);
      this.el = []; this.frames = []; this.t = 0; this.playing = false; this.segDur = o.segDur || 2.6; this.holdEnd = 1.6; this._hold = 0;
      this.onTime = o.onTime || null;
    }
    load(obj, view) {
      this.el = obj.el;
      this.frames = obj.frames || [{ xyz: obj.xyz, bonds: obj.bonds }];
      this.t = 0; this._hold = 0;
      let R = 0;
      for (const f of this.frames) for (const p of f.xyz) R = Math.max(R, Math.hypot(p[0], p[1], p[2]));
      this.R = R + 0.6; this.zoom = (view && view.zoom) || 1;
      this.seed = this.el.map((_, i) => [Math.sin(i * 12.9898) * 43758.5453 % TAU, Math.sin(i * 78.233) * 12345.678 % TAU]);
      this.maps = this.frames.map((f) => { const m = new Map(); f.bonds.forEach(([i, j, o]) => m.set(i < j ? i + '-' + j : j + '-' + i, o)); return m; });
      if (view) { this.yaw = this.yaw0 = view.yaw ?? this.yaw; this.pitch = view.pitch ?? this.pitch; this.motion = reduce ? null : (view.motion ?? this.motion); this.touched = false; this.clock = 0; }
      this.dirty = true; this.onTime && this.onTime(0, this);
    }
    get last() { return this.frames.length - 1; }
    play() { if (this.last < 1) return; if (this.t >= this.last) this.t = 0; this.playing = true; this._hold = 0; }
    pause() { this.playing = false; }
    seek(t) { this.t = clamp(t, 0, this.last); this.dirty = true; this.onTime && this.onTime(this.t, this); }
    tick(dt) {
      if (!this.playing) return;
      if (this.t >= this.last) { this._hold += dt; if (this._hold > this.holdEnd) { this._hold = 0; this.t = 0; } }
      else this.t = Math.min(this.last, this.t + dt / this.segDur);
      this.dirty = true; this.onTime && this.onTime(this.t, this);
    }
    state() {
      const k = Math.min(Math.floor(this.t), Math.max(0, this.last - 1)), u = this.last ? ease(clamp(this.t - k, 0, 1)) : 0;
      const A = this.frames[k], B = this.frames[Math.min(k + 1, this.last)];
      const xyz = A.xyz.map((p, i) => [p[0] + (B.xyz[i][0] - p[0]) * u, p[1] + (B.xyz[i][1] - p[1]) * u, p[2] + (B.xyz[i][2] - p[2]) * u]);
      const ma = this.maps[k], mb = this.maps[Math.min(k + 1, this.last)], bonds = [];
      for (const key of new Set([...ma.keys(), ...mb.keys()])) {
        const a = ma.get(key) || 0, b = mb.get(key) || 0, o = a + (b - a) * u;
        if (o < 0.06) continue;
        const [i, j] = key.split('-').map(Number);
        bonds.push([i, j, o, o < 0.9 || (u > 0.03 && u < 0.97 && a !== b && Math.min(a, b) < 0.9)]);
      }
      return { xyz, bonds };
    }
    draw() {
      const { ctx, w, h } = this, st = this.state();
      const D = this.R * 4.6, k = Math.min(Math.min(w, h) / 2 / (this.R * 1.1) * this.zoom, h * 0.17), cx = w / 2, cy = h / 2 - h * 0.02;
      // 墨影
      ctx.save(); ctx.translate(cx, Math.min(h * 0.9, cy + this.R * k * 0.93)); ctx.scale(1, 0.2);
      const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, this.R * k * 0.95);
      sh.addColorStop(0, rgb(T.ink, T.dark ? 0.22 : 0.13)); sh.addColorStop(1, rgb(T.ink, 0));
      ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, this.R * k * 0.95, 0, TAU); ctx.fill(); ctx.restore();

      const P = st.xyz.map((p) => this.proj(p, k, D, cx, cy));
      let z0 = Infinity, z1 = -Infinity;
      P.forEach((p) => { z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
      P.forEach((p, i) => { p.r = RAD[this.el[i]] * k * p.s; p.f = z1 - z0 < 0.3 ? 0 : (z1 - p.z) / (z1 - z0) * 0.62; });
      const items = P.map((p, i) => ({ z: p.z, i }));
      st.bonds.forEach((b) => items.push({ z: (P[b[0]].z + P[b[1]].z) / 2 - 0.02, b }));
      items.sort((a, b) => a.z - b.z);
      for (const it of items) it.b ? this._bond(P[it.b[0]], P[it.b[1]], it.b[2], it.b[3], k) : this._atom(P[it.i], it.i);
    }
    _bond(a, b, order, live, k) {
      const { ctx } = this;
      let dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy); if (L < 1) return; dx /= L; dy /= L;
      const ra = a.r * 0.8, rb = b.r * 0.8; if (L <= ra + rb + 1) return;
      const x1 = a.x + dx * ra, y1 = a.y + dy * ra, x2 = b.x - dx * rb, y2 = b.y - dy * rb, nx = -dy, ny = dx;
      const fade = (a.f + b.f) / 2, wA = 0.11 * k * a.s, wB = 0.11 * k * b.s, g = 0.2 * k * (a.s + b.s) / 2;
      const l1 = clamp(order - 1, 0, 1), l2 = clamp(order - 2, 0, 1);
      const lines = [[-g / 2 * l1 * (1 - l2), Math.min(1, order)]];
      if (l1 > 0.03) lines.push([g / 2 * l1 * (1 + l2), l1]);
      if (l2 > 0.03) lines.push([-g * l2, l2]);
      lines.forEach(([off, alpha], n) => {
        if (n === 0 && order < 0.9) {
          ctx.save(); ctx.strokeStyle = rgb(T.red, clamp(order * 1.7, 0.15, 1)); ctx.lineWidth = Math.max(1.6, (wA + wB) / 2 * 0.8); ctx.lineCap = 'round';
          ctx.setLineDash([Math.max(3, g * 0.55), Math.max(4, g * 0.7)]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore(); return;
        }
        const col = live && n > 0 ? T.red : mix(T.ink, T.paper, fade * 0.75);
        ctx.fillStyle = rgb(col, n === 0 ? 1 : 0.35 + alpha * 0.65);
        const ox = nx * off, oy = ny * off;
        ctx.beginPath();
        ctx.moveTo(x1 + ox + nx * wA / 2, y1 + oy + ny * wA / 2); ctx.lineTo(x2 + ox + nx * wB / 2, y2 + oy + ny * wB / 2);
        ctx.lineTo(x2 + ox - nx * wB / 2, y2 + oy - ny * wB / 2); ctx.lineTo(x1 + ox - nx * wA / 2, y1 + oy - ny * wA / 2);
        ctx.closePath(); ctx.fill();
      });
    }
    _atom(p, i) {
      const { ctx } = this, el = this.el[i], r = p.r, [s1, s2] = this.seed[i];
      const col = el === 'N' ? T.blue : el === 'O' ? T.red : T.ink;
      const path = (rr) => {
        ctx.beginPath();
        for (let a = 0; a <= 36; a++) { const th = a / 36 * TAU, q = rr * (1 + 0.035 * Math.sin(3 * th + s1) + 0.025 * Math.sin(5 * th + s2)); a ? ctx.lineTo(p.x + q * Math.cos(th), p.y + q * Math.sin(th)) : ctx.moveTo(p.x + q * Math.cos(th), p.y + q * Math.sin(th)); }
        ctx.closePath();
      };
      if (el === 'H') {
        const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
        g.addColorStop(0, rgb(T.paper)); g.addColorStop(1, rgb(mix(T.paper, T.ink, 0.16 - p.f * 0.1)));
        ctx.fillStyle = g; path(r); ctx.fill();
        ctx.strokeStyle = rgb(mix(T.ink, T.paper, 0.25 + p.f * 0.6)); ctx.lineWidth = Math.max(1, r * 0.13); ctx.stroke();
        return;
      }
      const halo = ctx.createRadialGradient(p.x, p.y, r * 0.7, p.x, p.y, r * 1.75);
      halo.addColorStop(0, rgb(col, 0.2 * (1 - p.f))); halo.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.75, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(p.x - r * 0.36, p.y - r * 0.4, r * 0.05, p.x, p.y, r * 1.02);
      g.addColorStop(0, rgb(mix(col, T.paper, 0.46 + p.f * 0.3)));
      g.addColorStop(0.55, rgb(mix(col, T.paper, 0.14 + p.f * 0.5)));
      g.addColorStop(1, rgb(mix(col, T.paper, p.f * 0.55)));
      ctx.fillStyle = g; path(r); ctx.fill();
      if (el !== 'C' && r > 8) {
        ctx.fillStyle = rgb(T.paper, 0.95 - p.f * 0.3); ctx.font = `600 ${Math.round(r * 1.02)}px "Noto Serif SC", serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(el, p.x, p.y + r * 0.04);
      }
    }
  }

  /* ---------- 曲面：层叠的山 ---------- */
  /* u：横向（pH）；v：纵深，v = 1 在远处；高度 0–1。远处高、近处低，像一道道山脊叠上去。 */
  class SurfView extends Stage {
    constructor(canvas, o = {}) {
      super(canvas, { yaw: -0.42, pitch: 0.4, lim: { yaw: [-1.15, 1.15], pitch: [0.12, 1.1] }, ...o });
      this.nx = o.nx || 48; this.nz = o.nz || 32;
      this.fn = o.fn; this.bands = 0; this.marks = []; this.probe = null; this.ridge = null;
      this.xt = o.xt || []; this.zt = o.zt || []; this.xName = o.xName || ''; this.zName = o.zName || ''; this.yName = o.yName || '';
    }
    set(o) { Object.assign(this, o); this.dirty = true; }
    P(u, v, hgt) { return this.proj([(u * 2 - 1) * 1.25, hgt * 1.2 - 0.62, (1 - v * 2) * 0.95], this._k, 6.4, this.w / 2, this.h * 0.47); }
    draw() {
      const { ctx, w, h, nx, nz } = this;
      this._k = Math.min(w / 3.75, h / 2.72);
      const H = (u, v) => clamp(this.fn(u, v), 0, 1.04);
      const G = []; let h0 = Infinity, h1 = -Infinity;
      for (let j = 0; j <= nz; j++) { const row = []; for (let i = 0; i <= nx; i++) { const u = i / nx, v = j / nz, hh = H(u, v); h0 = Math.min(h0, hh); h1 = Math.max(h1, hh); row.push({ h: hh, p: this.P(u, v, hh) }); } G.push(row); }
      const base = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => this.P(u, v, 0));
      ctx.fillStyle = rgb(T.ink, T.dark ? 0.1 : 0.05); ctx.beginPath(); base.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgb(T.ink, 0.5); ctx.lineWidth = 1.2; ctx.stroke();
      {   // 高度轴立在远处的角上，先画，让山挡住它
        const cu = this.P(1, 0.5, 0).z > this.P(0, 0.5, 0).z ? 0 : 1, b = this.P(cu, 1, 0), t = this.P(cu, 1, 1.02);
        ctx.strokeStyle = rgb(T.ink, 0.4); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        this._top = t;
      }
      const quads = [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = G[j][i], b = G[j][i + 1], c = G[j + 1][i + 1], d = G[j + 1][i];
        quads.push({ a, b, c, d, j, z: (a.p.z + b.p.z + c.p.z + d.p.z) / 4, h: (a.h + b.h + c.h + d.h) / 4 });
      }
      quads.sort((p, q) => p.z - q.z);
      const lerp = (m, n, L) => { const t = (L - m.h) / (n.h - m.h); return [m.p.x + (n.p.x - m.p.x) * t, m.p.y + (n.p.y - m.p.y) * t]; };
      for (const q of quads) {
        const tone = 0.04 + Math.pow((q.h - h0) / (h1 - h0 || 1), 1.2) * 0.52;
        const col = rgb(mix(T.paper, T.ink, tone));
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(q.a.p.x, q.a.p.y); ctx.lineTo(q.b.p.x, q.b.p.y); ctx.lineTo(q.c.p.x, q.c.p.y); ctx.lineTo(q.d.p.x, q.d.p.y); ctx.closePath(); ctx.fill(); ctx.stroke();
        // 沿 pH 方向的山形线：每条是一个亚硝酸根浓度
        const strong = (q.j + 1) % 4 === 0;
        ctx.strokeStyle = rgb(T.ink, strong ? 0.5 + tone * 0.4 : 0.1 + tone * 0.25); ctx.lineWidth = strong ? 1.3 : 0.7;
        ctx.beginPath(); ctx.moveTo(q.d.p.x, q.d.p.y); ctx.lineTo(q.c.p.x, q.c.p.y); ctx.stroke();
        // 等高墨线：相邻两道差 10 倍
        if (this.bands) {
          const lo = Math.min(q.a.h, q.b.h, q.c.h, q.d.h), hi = Math.max(q.a.h, q.b.h, q.c.h, q.d.h);
          for (let n = Math.ceil(lo * this.bands); n <= hi * this.bands; n++) {
            const L = n / this.bands, pts = [];
            for (const [m, k] of [[q.a, q.b], [q.b, q.c], [q.c, q.d], [q.d, q.a]]) if ((m.h - L) * (k.h - L) < 0) pts.push(lerp(m, k, L));
            if (pts.length >= 2) { ctx.strokeStyle = rgb(T.paper, 0.55); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke(); }
          }
        }
      }
      const line = (pts, col, wdt, dash) => { ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.setLineDash(dash || []); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.setLineDash([]); };
      const along = (f) => [...Array(49)].map((_, i) => f(i / 48));
      if (this.ridge != null) line(along((v) => this.P(this.ridge, v, H(this.ridge, v) + 0.006)), rgb(T.red, 0.95), 1.8, [5, 5]);
      const text = (s, x, y, col, align = 'left', size = 13, bold = false) => {
        ctx.font = `${bold ? 600 : 400} ${size}px "Noto Serif SC", "Songti SC", serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = rgb(T.paper, 0.92); ctx.strokeText(s, x, y); ctx.fillStyle = col; ctx.fillText(s, x, y);
      };
      this._axes(text);
      const dot = (p, col, r) => { ctx.fillStyle = rgb(T.paper); ctx.beginPath(); ctx.arc(p.x, p.y, r + 2, 0, TAU); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); };
      if (this.probe) {
        const [pu, pv] = this.probe, col = rgb(T.blue);
        line(along((u) => this.P(u, pv, H(u, pv) + 0.006)), col, 1.7);
        line(along((v) => this.P(pu, v, H(pu, v) + 0.006)), col, 1.7);
        dot(this.P(pu, pv, H(pu, pv)), col, 5);
      }
      for (const m of this.marks) {
        const top = this.P(m.u, m.v, H(m.u, m.v)), tip = this.P(m.u, m.v, H(m.u, m.v) + (m.lift ?? 0.2)), col = rgb(T[m.color || 'red']);
        line([top, tip], col, 1.3); dot(top, col, 4.5);
        text(m.label, tip.x + (m.align === 'right' ? -6 : 6), tip.y - 3, col, m.align || 'left', 13, true);
      }
    }
    _axes(text) {
      const { ctx } = this, soft = rgb(T.soft), pale = rgb(T.pale);
      // 刻度放在离观察者近的两条边上
      const nearV = this.P(0.5, 1, 0).z > this.P(0.5, 0, 0).z ? 1 : 0, nearU = this.P(1, 0.5, 0).z > this.P(0, 0.5, 0).z ? 1 : 0;
      const out = (p, q, d) => { const dx = p.x - q.x, dy = p.y - q.y, L = Math.hypot(dx, dy) || 1; return [p.x + dx / L * d, p.y + dy / L * d]; };
      ctx.strokeStyle = soft; ctx.lineWidth = 1;
      for (const [u, s] of this.xt) {
        const p = this.P(u, nearV, 0), q = this.P(u, nearV ? 0.9 : 0.1, 0), [x1, y1] = out(p, q, 6), [x2, y2] = out(p, q, 18);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x1, y1); ctx.stroke(); text(s, x2, y2, soft, 'center', 12.5);
      }
      { const p = this.P(0.5, nearV, 0), q = this.P(0.5, nearV ? 0.9 : 0.1, 0), [x, y] = out(p, q, 40); text(this.xName, x, y, pale, 'center', 12.5); }
      for (const [v, s] of this.zt) {
        const p = this.P(nearU, v, 0), q = this.P(nearU ? 0.9 : 0.1, v, 0), [x1, y1] = out(p, q, 6), [x2, y2] = out(p, q, 12);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x1, y1); ctx.stroke(); text(s, x2, y2, soft, nearU ? 'left' : 'right', 12.5);
      }
      { const p = this.P(nearU, 0.5, 0), q = this.P(nearU ? 0.9 : 0.1, 0.5, 0), [x, y] = out(p, q, 50); text(this.zName, x, y + 16, pale, nearU ? 'left' : 'right', 12.5); }
      text(this.yName, this._top.x, this._top.y - 12, pale, 'center', 12.5);
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const s of stages) if (s.visible) s.step(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { MolView, SurfView, reduce, theme: () => T };
})();
