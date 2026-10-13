/* 页面交互：工艺长卷、反应地图与三维演示、速率曲面、图表、断案与对策。依赖 GEOM、Ink3D。 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = Ink3D.reduce;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* 把 Unicode 上下标换成 <sub>/<sup>，排版更稳 */
  const SUBS = '₀₁₂₃₄₅₆₇₈₉₊₋', SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻', PLAIN = '0123456789+−';
  const RE = /[₀-₋]+|[⁰¹²³⁴-⁻]+/g;
  const SVGNS = 'http://www.w3.org/2000/svg';
  function chemify(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const todo = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentNode.closest('script,style,sub,sup,title,[data-chem]')) continue;
      RE.lastIndex = 0;
      if (RE.test(n.nodeValue)) todo.push(n);
    }
    for (const n of todo) {
      const inSvg = !!n.parentNode.closest('svg'), src = n.nodeValue, frag = document.createDocumentFragment();
      let last = 0, back = 0;                         // back：SVG 里上下标之后要退回基线的位移（em）
      const tspan = (txt, dy, small) => { const t = document.createElementNS(SVGNS, 'tspan'); t.setAttribute('data-chem', ''); t.setAttribute('dy', dy + 'em'); if (small) t.setAttribute('font-size', '72%'); t.textContent = txt; frag.append(t); };
      const plain = (txt) => { if (!txt) return; if (back) { tspan(txt, back, false); back = 0; } else frag.append(txt); };
      src.replace(RE, (m, at) => {
        plain(src.slice(last, at));
        const sub = SUBS.includes(m[0]), txt = [...m].map((c) => PLAIN[(sub ? SUBS : SUPS).indexOf(c)]).join('');
        if (inSvg) { tspan(txt, (sub ? 0.28 : -0.5) + back / 0.72, true); back = sub ? -0.2 : 0.36; }
        else { const e = document.createElement(sub ? 'sub' : 'sup'); e.textContent = txt; frag.append(e); }
        last = at + m.length; return m;
      });
      plain(src.slice(last) || (back ? '​' : ''));
      n.replaceWith(frag);
    }
  }
  const setHTML = (el, html) => { el.innerHTML = html; chemify(el); };
  const supNum = (n) => String(n).replace(/-/g, '⁻').replace(/\d/g, (d) => SUPS[d]);
  function num(x, d = 2) {
    if (!isFinite(x)) return '–';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 0.001 && a < 100000) return String(+x.toPrecision(d));
    const e = Math.floor(Math.log10(a));
    return `${(x / 10 ** e).toFixed(1)}×10${supNum(e)}`;
  }
  const times = (x) => (x >= 100 ? Math.round(x / 10) * 10 : x >= 10 ? Math.round(x) : +x.toFixed(1));

  /* 悬停提示 */
  function makeTip(plot) { const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; plot.appendChild(tip); return tip; }
  function tips(plot) {
    const tip = makeTip(plot);
    const show = (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip.hidden = true; return; }
      setHTML(tip, t.dataset.tip); tip.hidden = false;
      const r = plot.getBoundingClientRect();
      const x = clamp(e.clientX - r.left + 14, 0, r.width - tip.offsetWidth - 4), y = e.clientY - r.top - tip.offsetHeight - 10;
      tip.style.left = x + 'px'; tip.style.top = Math.max(0, y) + 'px';
    };
    plot.addEventListener('pointermove', show);
    plot.addEventListener('pointerleave', () => { tip.hidden = true; });
    plot.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t) { setHTML(tip, t.dataset.tip); tip.hidden = false; tip.style.left = '8px'; tip.style.top = '4px'; } });
    plot.addEventListener('focusout', () => { tip.hidden = true; });
    return tip;
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /* 对数标尺条：限度线在上，数据点在下 */
  function logStrip(el, { min, max, lines = [], points = [], bands = [], unit = 'ppm', name = '' }) {
    const [, , W, H] = el.getAttribute('viewBox').split(' ').map(Number);
    const L = 30, R = 30, ay = H - 62, a = Math.log10(min), b = Math.log10(max);
    const x = (v) => L + (Math.log10(clamp(v, min, max)) - a) / (b - a) * (W - L - R);
    let s = '';
    for (const bd of bands) s += `<rect class="band ${bd.cls || ''}" x="${x(bd.a)}" y="${ay - 26}" width="${x(bd.b) - x(bd.a)}" height="26"/><text x="${(x(bd.a) + x(bd.b)) / 2}" y="${ay - 32 - (bd.row || 0) * 17}" text-anchor="middle">${bd.label}</text>`;
    for (let e = Math.ceil(a); e <= Math.floor(b); e++) {
      const v = 10 ** e;
      s += `<line class="tick" x1="${x(v)}" x2="${x(v)}" y1="${ay}" y2="${ay + 6}"/><text x="${x(v)}" y="${ay + 21}" text-anchor="middle">${+v.toPrecision(1)}</text>`;
    }
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${ay}" y2="${ay}"/><text class="axis-name" x="${L}" y="14">${name ? name + ' · ' : ''}${unit}，对数刻度</text>`;
    for (const ln of lines) {
      const top = ay - 40 - (ln.row || 0) * 17;
      s += `<line class="${ln.cls || 'lim'}" x1="${x(ln.v)}" x2="${x(ln.v)}" y1="${top + 5}" y2="${ay}"/><text class="lab ${ln.hot ? 'hot' : ''} halo-t" x="${x(ln.v)}" y="${top}" text-anchor="${ln.anchor || 'middle'}">${ln.label}</text>`;
    }
    for (const p of points) {
      const yy = ay + 40 + (p.row || 0) * 17;
      s += `<line class="tick" x1="${x(p.v)}" x2="${x(p.v)}" y1="${ay + 8}" y2="${yy - 13}"/><circle class="pt ${p.cls || 'now'}" cx="${x(p.v)}" cy="${ay}" r="6.5"/><text class="lab ${p.hot ? 'hot' : ''} halo-t" x="${x(p.v)}" y="${yy}" text-anchor="${p.anchor || 'middle'}">${p.label}</text>`;
    }
    el.innerHTML = s;
  }

  /* ---------- 顶栏高亮 ---------- */
  {
    const links = $$('.tabs a.t'), map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { links.forEach((a) => a.classList.remove('on')); map.get(e.target.id)?.classList.add('on'); } });
    }, { rootMargin: '-30% 0px -60% 0px' });
    map.forEach((_, id) => { const s = document.getElementById(id); s && io.observe(s); });
  }

  /* ================= 贰 工艺长卷 ================= */
  const STATIONS = {
    charge: {
      n: '一', name: '投料', en: 'CHARGE',
      what: '腈中间体、叠氮化钠和溶剂 DMF 进釜。现行工艺用外包回收的 DMF（Lot R-21），历史工艺用原生 DMF。',
      chem: '进料 DMF 自带的二甲胺（DMA）从这里进入体系。它是仲胺，是 NDMA 的前体。',
      ev: '<span class="tag fact">案例</span> DMA：原生 DMF 低于 1.0 mg/L，R-21 为 11.8 mg/L。含量 99.80% → 99.70%，都符合 ≥ 99.5%。',
      samp: '<span class="tag fact">摘要</span> 比较原生与回收 DMF 中的 NDMA 和 DMA。<span class="tag mine">补充</span> 顺带测亚硝酸根、甲酸、水分和其他仲胺（如二乙胺）。',
      ctrl: '回收 DMF 的质量标准加上 DMA 和 NDMA 两项，每批检验合格才放行。',
    },
    ring: {
      n: '二', name: '四唑成环', en: 'TETRAZOLE FORMATION',
      what: '加热下，叠氮根与腈基发生 [3+2] 环加成，长出四唑环。四唑是沙坦类药物的关键基团，酸性与羧酸相当。',
      chem: 'Ar–C≡N + N₃⁻ → Ar–CN₄⁻，酸化后得 1H-四唑。叠氮化钠通常过量，反应完釜里还剩 N₃⁻。',
      ev: '<span class="tag infer">推断</span> 高温下 DMF 自己也会缓慢分解出 DMA，釜内的 DMA 可能比进料时更多。案例没有给这一步的数据。',
      samp: '<span class="tag mine">补充</span> 成环结束、淬灭之前取样，测 DMA 和 NDMA。要分清「随溶剂带入」和「淬灭时生成」，这一个点最管用。',
      ctrl: '给温度和时间设上限；评估能否换成不会放出仲胺的溶剂。',
    },
    quench: {
      n: '三', name: '亚硝酸钠淬灭', en: 'NITRITE QUENCH',
      what: '酸性条件下加入亚硝酸钠，把残余的叠氮根变成氮气和一氧化二氮，免得后面放出剧毒、易爆的叠氮酸。',
      chem: 'NO₂⁻ + H⁺ ⇌ HNO₂，再生成 N₂O₃、NO⁺ 等亚硝化物种。它们的本职是打 N₃⁻，但同一釜里的 DMA 也会被打中：(CH₃)₂NH + N₂O₃ → (CH₃)₂N–NO + HNO₂。',
      ev: '<span class="tag fact">案例</span> 淬灭 pH：历史 2.9，现行 2.8，都在亚硝化的高速区。<span class="tag infer">推断</span> 亚硝酸钠要过量才淬灭得干净，过量的那部分就是多出来的亚硝化试剂。',
      samp: '<span class="tag fact">摘要</span> 淬灭前后各测一次 NDMA。<span class="tag mine">补充</span> 同时记录亚硝酸钠投料量、加料时间、温度和停留时间。',
      ctrl: '最好让含产品的物料不见亚硝酸：先分相，在水相废液里淬灭。做不到就压低过量、降温、缩短停留，淬灭后加氨基磺酸清掉余量。',
    },
    wash: {
      n: '四', name: '水洗', en: 'AQUEOUS WASHES',
      what: '用水把无机盐、亚硝酸根和其他水溶性杂质洗走。放大生产时，从三次减成了两次。',
      chem: '这一步没有新反应，只有分配和稀释。NDMA 与水互溶（log P ≈ −0.57），水洗同样带得走它。',
      ev: '<span class="tag fact">案例</span> 末次水洗后的亚硝酸根：三洗 0.4 mg/L，两洗 3.2 mg/L，正好差 8 倍。<span class="tag infer">推断</span> 一次水洗约把亚硝酸根降到八分之一。NDMA 的清除倍数未知。',
      samp: '<span class="tag fact">摘要</span> 每次水洗后测 NDMA。<span class="tag mine">补充</span> 同步测亚硝酸根和 DMA，算出每一洗的清除倍数。',
      ctrl: '恢复第三次水洗。设中控：末次水洗液亚硝酸根 ≤ 0.5 mg/L 才往下走。',
    },
    cryst: {
      n: '五', name: '结晶', en: 'CRYSTALLIZATION',
      what: 'API 从溶液里析出晶体，杂质大多留在母液里。',
      chem: '结晶本身是一次纯化。但母液里若还有亚硝酸根和胺，浓缩、降温时它们仍可能相遇。',
      ev: '案例没有给这一步的数据。',
      samp: '<span class="tag mine">补充</span> 测母液中的 NDMA，做一笔物料衡算：生成了多少，母液带走多少，晶体里留下多少。',
      ctrl: '母液不套用，或者套用前先检测。',
    },
    dry: {
      n: '六', name: '过滤 · 干燥', en: 'FILTRATION AND DRYING',
      what: '滤出晶体，洗涤滤饼，再加热除去残留溶剂。',
      chem: '湿滤饼里残留的亚硝酸根和 DMA（或者还能放出 DMA 的残留 DMF），在受热、浓缩时仍可能继续反应。亚硝胺在固态中缓慢增长，制剂里有文献先例。',
      ev: '<span class="tag todo">待检验</span> 没有数据说明 NDMA 在干燥或贮存期间是否增长。',
      samp: '<span class="tag mine">补充</span> 湿滤饼和干燥成品各测一次；留样隔一段时间复测。',
      ctrl: '滤饼洗涤充分；干燥温度设上限；成品检测残留 DMF 和亚硝酸根。',
    },
    qc: {
      n: '七', name: '成品 · 检验', en: 'RELEASE TESTING',
      what: '成品按质量标准检验后放行。常规有关物质用 UHPLC-UV。',
      chem: 'NDMA 分子小、紫外吸收弱，又只有亚 ppm 的量，UV 检测器定量不了它。',
      ev: '<span class="tag fact">案例</span> UHPLC-UV 定量限约 0.05%（500 ppm），两种工艺都是「无可报告的未知杂质」。痕量筛查在约 0.52 ppm 处有信号，身份未定。',
      samp: '<span class="tag fact">摘要</span> 用经验证的 LC-MS/MS、对照品和同位素内标检测留样，定量限 ≤ 0.40 ppm。<span class="tag mine">补充</span> 历史工艺的留样一并检测，建立基线。',
      ctrl: 'NDMA 每批用 LC-MS/MS 检验，限度 0.40 ppm。连续多批远低于限度之后，再考虑减少频次。',
    },
    recov: {
      n: '八', name: '外包回收', en: 'SOLVENT RECOVERY',
      what: '用过的 DMF 送到外部回收商，主要靠蒸馏提纯，约 80% 回收后返回，要求含量 ≥ 99.5%。回收商用共用的储罐和设备处理多家客户的溶剂。',
      chem: '蒸馏温度接近 DMF 的沸点（153 °C），DMF 会少量分解：HCON(CH₃)₂ → CO + (CH₃)₂NH。NDMA 的沸点约 152 °C，一旦混入，蒸馏分不开。DMA 沸点只有 7 °C，按理很容易赶走；回收品里还有 11.8 mg/L，说明它要么以盐的形式留了下来，要么在蒸馏和贮存中不断新生成。',
      ev: '<span class="tag fact">案例</span> 审计发现，回收商无法完整追溯各批回收溶剂用过哪些储罐。<span class="tag infer">推断</span> 交叉污染无法排除：可能带入 DMA、别的胺，甚至现成的亚硝胺。',
      samp: '<span class="tag fact">摘要</span> 调取回收商的批次与设备记录。<span class="tag mine">补充</span> 检测 R-21 和其他回收批次的 NDMA、NDEA、DMA、二乙胺。',
      ctrl: '专用设备，或清洁后经过验证；批次谱系可追溯；质量协议加定期审计。',
    },
  };

  (function buildFlow() {
    const S = $('#flow-svg'), Y = 215, panel = $('#flow-panel');
    const body = 'M-40,-52 Q-40,-64 -28,-64 L28,-64 Q40,-64 40,-52 L40,22 Q40,56 0,56 Q-40,56 -40,22 Z';
    const liquid = 'M-38,-8 Q-28,-16 -19,-8 T0,-8 T19,-8 T38,-8 L38,22 Q38,54 0,54 Q-38,54 -38,22 Z';
    const stir = '<path class="det" d="M0,-84 L0,26 M-20,26 Q0,36 20,26"/><path class="ves" d="M-9,-96 h18 v12 h-18 Z"/><path class="det" d="M-30,50 L-36,68 M30,50 L36,68"/>';
    const heat = '<path class="det" d="M-22,84 q5,-6 0,-12 q-5,-6 0,-12 M0,84 q5,-6 0,-12 q-5,-6 0,-12 M22,84 q5,-6 0,-12 q-5,-6 0,-12"/>';
    const ICON = {
      charge: '<path class="ves" d="M-42,-50 L42,-50 L14,8 L14,44 L-14,44 L-14,8 Z"/><path class="det" d="M-30,-34 Q0,-44 30,-34"/>',
      ring: `<path class="ves" d="${body}"/><path class="liq" d="${liquid}"/>${stir}`,
      quench: `<path class="ves" d="${body}"/><path class="liq" d="${liquid}"/>${stir}`,
      wash: '<path class="ves" d="M-40,-58 L40,-58 L40,0 L8,48 L8,62 L-8,62 L-8,48 L-40,0 Z"/><path class="liq" d="M-39,-16 L39,-16 L39,0 L8,48 L-8,48 L-39,0 Z"/><path class="det" d="M-39,-16 L39,-16 M-39,-38 q10,-6 20,0 t20,0 t20,0 t19,0"/><circle class="det" cx="0" cy="70" r="5"/>',
      cryst: `<path class="ves" d="${body}"/><path class="liq" d="${liquid}"/><path class="det" d="M-16,14 l7,-9 l7,9 l-7,9 Z M6,26 l6,-8 l6,8 l-6,8 Z M-2,36 l5,-7 l5,7 l-5,7 Z M12,4 l5,-6 l5,6 l-5,6 Z"/>`,
      dry: '<path class="ves" d="M-44,-52 L44,-52 L12,-6 L-12,-6 Z"/><path class="det" d="M-30,-32 L30,-32 M-27,-34 Q0,-48 27,-34"/><path class="ves" d="M-36,10 h72 v44 h-72 Z"/><path class="det" d="M-22,44 q5,-6 0,-12 q-5,-6 0,-12 M0,44 q5,-6 0,-12 q-5,-6 0,-12 M22,44 q5,-6 0,-12 q-5,-6 0,-12 M0,-6 L0,10"/>',
      qc: '<circle class="ves" cx="0" cy="-4" r="46"/><path class="det" d="M-24,10 a12,12 0 0 1 24,0 a12,12 0 0 1 24,0 M-24,10 h48"/>',
      recov: '<path class="ves" d="M-18,-60 L18,-60 L18,62 L-18,62 Z"/><path class="det" d="M-18,-36 h36 M-18,-12 h36 M-18,12 h36 M-18,36 h36 M18,-52 Q44,-60 44,-36 Q44,-18 28,-22"/>',
    };
    const tank = (x, y) => `<g transform="translate(${x},${y})"><path class="ves" d="M-24,-26 Q0,-36 24,-26 L24,26 Q0,36 -24,26 Z"/><path class="det" d="M-24,-26 Q0,-16 24,-26"/></g>`;
    const POS = { charge: [110, Y], ring: [290, Y], quench: [480, Y], wash: [690, Y], cryst: [880, Y], dry: [1060, Y], qc: [1250, Y], recov: [585, 487] };
    const SUBS0 = { ring: 'DMF，加热', cryst: '母液带走大半杂质', dry: '', recov: '' };
    const chev = (x, y, a) => `<path class="det" transform="translate(${x},${y}) rotate(${a})" d="M-7,-6 L0,0 L-7,6"/>`;

    let h = `<defs>
      <filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>
      <filter id="bleed" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="16"/></filter>
    </defs>
    <g filter="url(#bleed)"><ellipse class="mist" cx="480" cy="${Y}" rx="120" ry="92"/><ellipse class="mist" cx="700" cy="500" rx="250" ry="70"/><ellipse class="mist" cx="1250" cy="${Y}" rx="90" ry="70"/></g>
    <g filter="url(#rough)">
      <path class="pipe" d="M150,${Y} L1205,${Y}"/>
      <path class="pipe thin" d="M480,96 L480,150 M690,96 L690,156 M690,288 L690,300 L790,300 L790,346"/>
      <path class="pipe thin" d="M508,152 q9,-22 -2,-44 q-9,-22 5,-44"/>
      <g id="loop"><path class="pipe loop" d="M585,${Y} L585,424"/><path class="pipe loop" d="M585,550 L585,572 L36,572 L36,120 L110,120 L110,160"/><path class="pipe thin" d="M606,487 L672,487 M748,487 L772,487 M848,487 L872,487"/></g>
      <path class="pipe thin" id="virgin-pipe" d="M194,415 L36,415"/>
      ${chev(1205, Y, 0)}${chev(790, 346, 90)}${chev(585, 330, 90)}${chev(340, 572, 180)}${chev(36, 330, -90)}${chev(110, 160, 90)}${chev(480, 150, 90)}${chev(690, 156, 90)}
      <g id="tanks">${tank(710, 487)}${tank(810, 487)}${tank(910, 487)}</g>
      <g id="barrel" transform="translate(222,415)"><path class="ves" d="M-20,-28 L20,-28 Q27,0 20,28 L-20,28 Q-27,0 -20,-28 Z"/><path class="det" d="M-23,-10 h46 M-23,10 h46"/></g>
      <g transform="translate(480,74)"><path class="ves" d="M-8,-24 L8,-24 L8,-10 L19,16 L-19,16 L-8,-10 Z"/></g>
      <g id="drops" transform="translate(690,70)">${[-24, 0, 24].map((dx, i) => `<path class="ves" data-drop="${i}" transform="translate(${dx},0)" d="M0,-16 q-11,16 0,24 q11,-8 0,-24 Z"/>`).join('')}</g>
    </g>`;
    for (const [id, [x, y]] of Object.entries(POS)) {
      const st = STATIONS[id], recov = id === 'recov';
      h += `<g class="st" data-st="${id}" tabindex="0" role="button" aria-label="${st.name}">
        <circle class="halo" cx="${x}" cy="${y}" r="78"/>
        <g transform="translate(${x},${y})" filter="url(#rough)">${ICON[id]}${id === 'ring' ? heat : ''}</g>
        <text class="no" x="${recov ? x - 34 : x - 58}" y="${recov ? y - 52 : y - 62}">${st.n}</text>
        <text class="lbl" x="${recov ? x - 34 : x}" y="${recov ? y + 4 : y + 104}" ${recov ? 'style="text-anchor:end"' : ''}>${st.name}</text>
        <text class="sub" id="sub-${id}" x="${recov ? x - 34 : x}" y="${recov ? y + 24 : y + 124}" ${recov ? 'style="text-anchor:end"' : ''}>${recov ? '蒸馏 · 共用设备' : (SUBS0[id] || '')}</text>
      </g>`;
    }
    h += `<g id="parts"></g>
      <text class="ann" x="480" y="36" text-anchor="middle">NaNO₂ + 酸</text>
      <text class="ann" id="t-wash" x="690" y="36" text-anchor="middle"></text>
      <text class="ann" x="528" y="96">N₂↑ N₂O↑</text>
      <text class="ann" x="790" y="368" text-anchor="middle">水相废液</text>
      <text class="ann" x="597" y="322">用过的 DMF</text>
      <text class="ann" id="t-loop" x="130" y="596"></text>
      <text class="ann" x="810" y="546" text-anchor="middle">共用储罐：还装着别家客户的溶剂</text>
      <text class="ann" id="t-virgin" x="222" y="466" text-anchor="middle"></text>
      <text class="ann" x="1250" y="343" text-anchor="middle">UHPLC-UV：无可报告的未知杂质</text>
      <text class="ann" id="t-screen" x="1250" y="365" text-anchor="middle"></text>
      <g id="flags">${[[200, Y, '进料 DMF'], [385, Y, '淬灭前'], [540, Y, '淬灭后'], [785, Y, '每洗之后'], [970, Y, '母液 · 湿滤饼'], [1150, Y, '成品 · 历史留样'], [430, 572, 'R-21 等回收批']]
        .map(([x, y, t]) => `<g class="flag"><line x1="${x}" y1="${y}" x2="${x}" y2="${y - 30}"/><path d="M${x},${y - 30} l15,5 l-15,6 Z"/><text x="${x + 2}" y="${y - 37}" text-anchor="middle" class="halo-t" style="paint-order:stroke;stroke:var(--paper);stroke-width:4px">${t}</text></g>`).join('')}</g>`;
    S.innerHTML = h;

    /* 粒子 */
    const R = {
      dmaNow: [[585, 550], [585, 572], [36, 572], [36, 120], [110, 120], [110, Y], [480, Y], [690, Y], [690, 300], [790, 300], [790, 346]],
      dmaOld: [[194, 415], [36, 415], [36, 120], [110, 120], [110, Y], [480, Y], [690, Y], [690, 300], [790, 300], [790, 346]],
      no2Out: [[480, 100], [480, Y], [690, Y], [690, 300], [790, 300], [790, 346]],
      no2Stay: [[480, 100], [480, Y], [1205, Y]],
      ndmaOut: [[480, Y], [690, Y], [690, 300], [790, 300], [790, 346]],
      ndmaStay: [[480, Y], [1205, Y]],
      gas: [[506, 172], [515, 132], [504, 100], [516, 60]],
      spent: [[585, Y], [585, 424]],
    };
    const PLAN = {
      now: [['dma', 'dmaNow', 12, 4.2], ['no2', 'no2Out', 7, 4.2], ['no2', 'no2Stay', 2, 4.2], ['ndma', 'ndmaOut', 3, 5.4], ['ndma', 'ndmaStay', 3, 5.4], ['gas', 'gas', 5, 4], ['dmf', 'spent', 4, 3.2]],
      old: [['dma', 'dmaOld', 1, 4.2], ['no2', 'no2Out', 8, 4.2], ['ndma', 'ndmaOut', 1, 5.4], ['gas', 'gas', 5, 4]],
    };
    const NS = 'http://www.w3.org/2000/svg', parts = $('#parts', S);
    let P = [], mode = 'now', clock = 0, visible = false;
    function spawn() {
      parts.innerHTML = ''; P = [];
      PLAN[mode].forEach(([cls, route, n, r], gi) => {
        const pts = R[route], cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        for (let i = 0; i < n; i++) {
          const el = document.createElementNS(NS, 'circle'); el.setAttribute('class', 'dot-' + cls); el.setAttribute('r', r); parts.appendChild(el);
          P.push({ el, pts, cum, L: cum[cum.length - 1], phase: (i + 0.37 * gi) / n, seed: i * 2.4 + gi, r, born: cls === 'ndma' });
        }
      });
      draw();
    }
    function draw() {
      for (const p of P) {
        const gap = 90, s = (clock * 62 + p.phase * (p.L + gap)) % (p.L + gap);
        if (s > p.L) { p.el.setAttribute('opacity', 0); continue; }
        let k = 1; while (k < p.cum.length - 1 && p.cum[k] < s) k++;
        const u = (s - p.cum[k - 1]) / (p.cum[k] - p.cum[k - 1] || 1), a = p.pts[k - 1], b = p.pts[k];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, wob = Math.sin(s * 0.045 + p.seed) * 5;
        p.el.setAttribute('cx', a[0] + dx * u - dy / len * wob); p.el.setAttribute('cy', a[1] + dy * u + dx / len * wob);
        p.el.setAttribute('opacity', Math.min(1, s / 28, (p.L - s) / 28) * 0.92);
        if (p.born) p.el.setAttribute('r', p.r * Math.min(1, 0.3 + s / 60));
      }
    }
    let last = performance.now();
    (function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (visible && !reduce) { clock += dt; draw(); } requestAnimationFrame(loop); })(last);
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(S);
    if (reduce) clock = 5.3;

    function setMode(m) {
      mode = m; const now = m === 'now';
      $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
      $('#loop', S).classList.toggle('dim', !now); $('#tanks', S).classList.toggle('dim', !now); $('[data-st="recov"]', S).classList.toggle('dim', !now);
      $('#barrel', S).classList.toggle('dim', now); $('#virgin-pipe', S).classList.toggle('dim', now);
      $('[data-drop="2"]', S).classList.toggle('dim', now);
      const set = (id, t, hot) => { const e = $('#' + id, S); e.textContent = t; e.classList.toggle('hot', !!hot); chemify(e); };
      set('t-wash', now ? '水洗 ×2（原为 ×3）' : '水洗 ×3', now);
      set('t-loop', now ? '回收 DMF · Lot R-21 · 含量 99.70% · 回收约 80%' : '历史工艺：不走这条回路');
      set('t-virgin', now ? '原生 DMF（补足）' : '原生 DMF · 含量 99.80%');
      set('t-screen', now ? '痕量筛查：约 0.52 ppm 处有信号' : '痕量筛查：没做过', now);
      set('sub-charge', now ? 'DMA 11.8 mg/L' : 'DMA < 1.0 mg/L', now);
      set('sub-quench', now ? 'pH 2.8' : 'pH 2.9');
      set('sub-wash', now ? '末洗后 NO₂⁻ 3.2 mg/L' : '末洗后 NO₂⁻ 0.4 mg/L', now);
      spawn();
    }
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    const ft = $('#flag-toggle');
    ft.addEventListener('click', () => { const on = ft.getAttribute('aria-pressed') !== 'true'; ft.setAttribute('aria-pressed', String(on)); $('#flags', S).style.display = on ? '' : 'none'; });

    function pick(id) {
      const st = STATIONS[id];
      $$('.st', S).forEach((g) => g.classList.toggle('on', g.dataset.st === id));
      setHTML(panel, `<div><span class="p-no">${st.n}</span><div class="p-title">${st.name}</div><div class="p-sub">${st.en}</div></div>
        <div><h4>发生了什么</h4><p>${st.what}</p><h4>化学</h4><p>${st.chem}</p></div>
        <div><h4>证据</h4><p>${st.ev}</p><h4>在这里取样</h4><p>${st.samp}</p></div>
        <div><h4>对策</h4><p>${st.ctrl}</p></div>`);
    }
    $$('.st', S).forEach((g) => {
      g.addEventListener('click', () => pick(g.dataset.st));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(g.dataset.st); } });
    });
    setMode('now'); pick('quench');
  })();

  /* ================= 叁 反应 ================= */
  const RX = {
    tetrazole: {
      short: '成环', title: '成环：腈 + 叠氮 → 四唑', view: { yaw: 0, pitch: 0.5, motion: 'sway', zoom: 1.45 },
      eq: 'Ar–C≡N + N₃⁻ → Ar–CN₄⁻ →(H⁺) Ar–CN₄H',
      note: 'Ar 在这里用苯基代替，真实分子里是联苯骨架。整个过程发生在同一个平面内。',
      caps: ['叠氮根 N₃⁻ 是一根直线，朝腈基的碳靠过去。', '末端的氮进攻腈基碳，C≡N 弯了下来，成为开链的亚氨基叠氮。', '另一端的氮回头咬住腈基的氮，五元环合上：一个碳，四个氮。', '酸化，质子落在 N1 上，得到 1H-四唑。'],
    },
    protonation: {
      short: '质子化', title: '亚硝酸根的质子化阶梯', view: { yaw: 0, pitch: 0.45, motion: 'sway', zoom: 1.5 },
      eq: 'NO₂⁻ →(H⁺) HNO₂ →(H⁺) H₂O + NO⁺',
      note: '溶液里 NO⁺ 很少单独存在，更多以 N₂O₃ 这样的载体出现：2 HNO₂ ⇌ N₂O₃ + H₂O。',
      caps: ['亚硝酸根接上一个质子，成为亚硝酸 HO–N=O。pH 2.8 时大半已是这个形态。', '同一个氧再接一个质子，羟基变成了水，一个现成的离去基团。', '水离开，剩下亚硝鎓离子 NO⁺，氮氧之间是三键。'],
    },
    quench: {
      short: '淬灭', title: '淬灭的本职：销毁叠氮', view: { yaw: 0, pitch: 0.45, motion: 'sway', zoom: 1.55 },
      eq: 'HN₃ + HNO₂ → N₂↑ + N₂O↑ + H₂O',
      note: '图中用 N₃⁻ + NO⁺ 表示实际反应的两方，质子和水省去了。',
      caps: ['NO⁺ 朝叠氮根末端的氮靠近。', 'N–N 成键，得到亚硝酰叠氮 N₃–N=O，一个很不稳定的中间体。', '中间那根 N–N 键断开。', '一头成了氮气，另一头成了一氧化二氮，都以气体离开。叠氮销毁完毕。'],
    },
    hydrolysis: {
      short: '水解', title: '溶剂的裂口：DMF → 二甲胺', view: { yaw: 0.5, pitch: -1.05, motion: 'sway', zoom: 1.6 },
      eq: 'HCON(CH₃)₂ + H₂O → HCOOH + (CH₃)₂NH',
      note: '受热时还有另一条路：HCON(CH₃)₂ → CO + (CH₃)₂NH。两条路放出的都是二甲胺。',
      caps: ['水分子从酰胺平面的上方靠近羰基碳。', '水的氧接上碳，C–N 键断开，一个氢转给了氮。酸、碱、加热都会加快这一步。', '分成两块：甲酸，和二甲胺 (CH₃)₂NH。'],
    },
    nitrosation: {
      short: '亚硝化', title: '祸根：二甲胺被亚硝化成 NDMA', view: { yaw: -0.5, pitch: 0.25, motion: 'sway', zoom: 1.7 },
      eq: '(CH₃)₂NH + N₂O₃ → (CH₃)₂N–N=O + HNO₂',
      note: '速率 = k [(CH₃)₂NH] [HNO₂]²。平方来自 N₂O₃：它要两分子亚硝酸才凑得成。',
      caps: ['N₂O₃ 靠近二甲胺。只有没被质子化的胺才有孤对电子可用，pH 2.8 时大约只占一亿分之一。', '胺氮的孤对电子进攻亚硝基的氮。N₂O₃ 中间那根又长又弱的 N–N 键同时拉开。', '新的 N–N 键成形，亚硝酸根离去，氮上还挂着一个质子。', '质子交给亚硝酸根，变回 HNO₂。留下的 (CH₃)₂N–N=O 就是 NDMA。'],
    },
  };
  (function buildChem() {
    const M = $('#rx-map');
    const pill = (id, n, x, y) => `<g class="rx" data-rx="${id}" tabindex="0" role="button" aria-label="演示：${RX[id].title}"><rect x="${x - 48}" y="${y - 15}" width="96" height="30"/><text x="${x}" y="${y + 5}"><tspan class="n">${n}</tspan> ${RX[id].short}</text></g>`;
    M.innerHTML = `
      <path class="river" d="M24,84 L470,84 C560,84 600,110 650,168 L700,168"/>
      <path class="river r2" d="M24,250 L430,250 C520,250 580,210 650,168"/>
      <path class="river r2" d="M430,250 C520,250 580,290 650,332"/>
      <path class="river r3" d="M24,416 L470,416 C560,416 600,390 650,332"/>
      <path class="river bad" d="M650,332 L816,332"/>
      <path class="river" d="M650,168 L816,168"/>
      <text x="30" y="66">Ar–C≡N + N₃⁻</text><text class="cn" x="30" y="116">腈中间体 + 过量的叠氮化钠</text>
      <text x="318" y="66">Ar–CN₄H</text><text class="cn" x="318" y="116">四唑，留在产品里</text>
      <text x="470" y="66">残余 N₃⁻</text>
      <text x="30" y="232">NO₂⁻ + H⁺</text><text class="cn" x="30" y="282">亚硝酸钠 + 酸，pH ≈ 2.8</text>
      <text x="262" y="232">HNO₂</text>
      <text x="360" y="232">N₂O₃ / NO⁺</text><text class="cn" x="360" y="282">亚硝化物种</text>
      <text x="30" y="398">HCON(CH₃)₂</text><text class="cn" x="30" y="448">回收 DMF</text>
      <text x="318" y="398">(CH₃)₂NH</text><text class="cn" x="318" y="448">二甲胺 DMA，11.8 mg/L</text>
      <text x="676" y="150">N₂↑ + N₂O↑</text><text class="cn" x="676" y="200">本意：叠氮销毁</text>
      <text class="bad-t" x="676" y="314">(CH₃)₂N–N=O</text><text class="cn bad-t" x="676" y="364" style="font-family:var(--serif)">意外：NDMA</text>
      ${pill('tetrazole', '①', 230, 84)}${pill('protonation', '②', 190, 250)}${pill('quench', '③', 575, 196)}${pill('hydrolysis', '④', 230, 416)}${pill('nitrosation', '⑤', 575, 304)}`;

    const view = new Ink3D.MolView($('#rx-canvas'), { motion: 'sway', segDur: 2.7, onTime });
    const seek = $('#rx-seek'), play = $('#rx-play'), caps = $('#rx-caps');
    let cur = null;
    function onTime(t, v) {
      if (document.activeElement !== seek) seek.value = t;
      const k = Math.min(v.last - 1, Math.floor(t + 1e-6));
      $$('li', caps).forEach((li, i) => li.classList.toggle('on', i === k));
    }
    const setPlay = (on) => { on ? view.play() : view.pause(); play.textContent = on ? '❚❚' : '▶'; };
    function load(id) {
      cur = id; const r = RX[id];
      $$('.rx', M).forEach((g) => g.classList.toggle('on', g.dataset.rx === id));
      $('#rx-title').textContent = r.title;
      setHTML($('#rx-eq'), r.eq); setHTML($('#rx-note'), r.note);
      setHTML(caps, r.caps.map((c, i) => `<li data-n="${'一二三四五'[i]}" data-i="${i}"><span>${c}</span></li>`).join(''));
      view.load(GEOM.rx[id], r.view); seek.max = view.last; seek.value = 0;
      setPlay(!reduce);
    }
    $$('.rx', M).forEach((g) => {
      g.addEventListener('click', () => load(g.dataset.rx));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(g.dataset.rx); } });
    });
    play.addEventListener('click', () => setPlay(!view.playing));
    seek.addEventListener('input', () => { setPlay(false); view.seek(+seek.value); });
    caps.addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; setPlay(false); view.seek(+li.dataset.i + 1); });
    load('nitrosation');

    /* 结构式 */
    const U = 36;
    function mol(x, y, atoms, bonds) {
      let s = '';
      const pos = atoms.map(([ux, uy]) => [x + ux * U, y - uy * U]);
      for (const [i, j, o = 1] of bonds) {
        let [x1, y1] = pos[i], [x2, y2] = pos[j];
        const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
        const cut = (a) => (atoms[a][2] ? 7 + 4.5 * [...atoms[a][2]].length : 0);
        x1 += ux * cut(i); y1 += uy * cut(i); x2 -= ux * cut(j); y2 -= uy * cut(j);
        const offs = o === 2 ? [-3.2, 3.2] : o === 3 ? [-5.2, 0, 5.2] : [0];
        for (const f of offs) s += `<line class="b" x1="${x1 - uy * f}" y1="${y1 + ux * f}" x2="${x2 - uy * f}" y2="${y2 + ux * f}"/>`;
      }
      atoms.forEach(([, , lab], i) => { if (lab) s += `<text x="${pos[i][0]}" y="${pos[i][1]}">${lab}</text>`; });
      return s;
    }
    const arrow = (x1, x2, y, top, bot) => `<path class="arrow" d="M${x1},${y} L${x2},${y} M${x2 - 9},${y - 6} L${x2},${y} L${x2 - 9},${y + 6}"/><text class="cond" x="${(x1 + x2) / 2}" y="${y - 12}">${top}</text><text class="cond" x="${(x1 + x2) / 2}" y="${y + 20}">${bot}</text>`;
    const cap = (x, t, hot) => `<text class="cap ${hot ? 'hot' : ''}" x="${x}" y="172">${t}</text>`;
    const DMF = [[[-1.732, 0, 'O'], [-0.866, -0.5], [0, 0, 'N'], [0, 1], [0.866, -0.5]], [[0, 1, 2], [1, 2], [2, 3], [2, 4]]];
    const DMA = [[[-0.866, -0.5], [0, 0, 'N'], [0.866, -0.5], [0, 0.8, 'H']], [[0, 1], [1, 2], [1, 3]]];
    const NDMA = [[[-0.866, -0.5], [0, 0, 'N'], [0, 1], [0.866, -0.5, 'N'], [1.732, 0, 'O']], [[0, 1], [1, 2], [1, 3], [3, 4, 2]]];
    $('#sk-ndma').innerHTML = mol(100, 92, ...DMF) + arrow(172, 268, 92, 'H₂O，或受热', '水解 / 热分解') + mol(330, 100, ...DMA) + arrow(392, 498, 92, 'HNO₂ ⇌ N₂O₃', 'pH ≈ 3') + mol(545, 92, ...NDMA)
      + cap(92, 'DMF') + cap(330, '二甲胺 DMA') + cap(572, 'NDMA', true);
    const NIT = [[[-1.15, 0, 'Ar'], [0, 0, 'C'], [1.1, 0, 'N']], [[0, 1], [1, 2, 3]]];
    const rr = 0.85, pv = (deg) => [rr * Math.cos(deg * Math.PI / 180), rr * Math.sin(deg * Math.PI / 180)];
    const TET = [[[...pv(180)], [...pv(252), 'N'], [...pv(324), 'N'], [...pv(36), 'N'], [...pv(108), 'N'], [-1.95, 0, 'Ar'], [-0.52, -1.58, 'H']], [[0, 1], [1, 2], [2, 3, 2], [3, 4], [4, 0, 2], [5, 0], [1, 6]]];
    $('#sk-tet').innerHTML = mol(92, 92, ...NIT) + `<text x="176" y="92">+</text><text x="216" y="92">N₃⁻</text>` + arrow(262, 398, 92, 'DMF，加热', '[3+2] 环加成，再酸化') + mol(520, 86, ...TET)
      + cap(86, '芳基腈') + cap(216, '叠氮根') + cap(506, '5-取代 1H-四唑');
  })();

  /* ================= 肆 分子 ================= */
  const MOLS = [
    ['dmf', 'DMF', 'N,N-二甲基甲酰胺', 'C₃H₇NO · 73.09 g/mol', ['沸点 153 °C', '与水互溶'], '四唑步骤的反应溶剂。酰胺的 C–N 键带部分双键性质，所以 O=C–N 连同两个甲基碳都在一个平面上。这根键一断，放出来的就是二甲胺。'],
    ['dma', 'DMA', '二甲胺', 'C₂H₇N · 45.08 g/mol', ['沸点 7 °C', '共轭酸 pKa 10.73'], '仲胺：氮上两个碳，一个氢，再加一对孤对电子。氮是三角锥形的，孤对电子朝锥尖那一侧伸出去，那里就是被亚硝化的位置。'],
    ['ndma', 'NDMA', 'N-亚硝基二甲胺', 'C₂H₆N₂O · 74.08 g/mol', ['沸点约 152 °C', '与水互溶，log P ≈ −0.57', '可接受摄入量 96 ng/天'], '嫌疑最大的杂质。C₂N–N=O 这五个重原子共平面，N–N 键带部分双键性质。沸点和 DMF 只差 1 °C 左右，蒸馏分不开；溶于水，所以水洗带得走。'],
    ['hono', 'HNO₂', '亚硝酸', 'HNO₂ · 47.01 g/mol', ['pKa ≈ 3.3（文献 3.1–3.4）', '只存在于溶液中'], '亚硝酸钠遇酸生成。它自己不算强的亚硝化试剂，但两分子脱去一分子水，就成了 N₂O₃。'],
    ['n2o3', 'N₂O₃', '三氧化二氮', 'N₂O₃ · 76.01 g/mol', ['N–N 键长 1.86 Å', 'pH 2–4 时的主要亚硝化物种'], '中间那根 N–N 键特别长、特别弱，等于随身带着一个随时可以递出去的 NO⁺。它要两分子亚硝酸才凑得成，所以亚硝化的速率跟亚硝酸浓度的平方成正比。'],
    ['tetrazole', '四唑', '1H-四唑', 'CH₂N₄ · 70.05 g/mol', ['pKa ≈ 4.9', '平面芳香环'], '一个碳、四个氮的五元环，酸性与羧酸相当，是沙坦类药物与受体结合的关键基团。案例图 2 画的就是它。'],
    ['hn3', 'HN₃', '叠氮酸', 'HN₃ · 43.03 g/mol', ['pKa 4.7', '沸点 37 °C'], '残余的叠氮根一遇酸就变成它：易挥发、剧毒、易爆。成环之后必须先把叠氮淬灭掉，原因就在这里。'],
  ];
  (function buildMol() {
    const view = new Ink3D.MolView($('#mol-canvas'), { motion: 'spin', yaw: -0.6, pitch: 0.42 });
    const chips = $('#mol-chips'), panel = $('#mol-panel');
    setHTML(chips, MOLS.map(([id, s]) => `<button type="button" data-m="${id}" aria-pressed="false">${s}</button>`).join(''));
    function pick(id) {
      const m = MOLS.find((x) => x[0] === id);
      $$('button', chips).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === id)));
      view.load(GEOM.mol[id], { yaw: -0.6, pitch: 0.42, motion: 'spin', zoom: 1.12 });
      setHTML(panel, `<span class="p-no ${/[A-Z]/.test(m[1]) ? 'latin' : ''}">${m[1]}</span><div class="p-title">${m[2]}</div><div class="p-sub">${m[3]}</div><ul>${m[4].map((x) => `<li>${x}</li>`).join('')}</ul><h4>在这个案子里</h4><p>${m[5]}</p>`);
    }
    chips.addEventListener('click', (e) => { const b = e.target.closest('button'); b && pick(b.dataset.m); });
    pick('ndma');
  })();

  /* ================= 伍 速率 ================= */
  const K = 0.0017, KA = 10 ** -3.4, M_DMA = 45.084, M_NDMA = 74.08, M_NO2 = 46.005;
  const g = (pH) => { const H = 10 ** -pH; return 4 * KA * H / (KA + H) ** 2; };
  const rate = (pH, no2M, dma) => K * (dma / 1000 / M_DMA) * no2M ** 2 * g(pH);      // mol/(L·s)
  const NO2_END = 0.4 * 8 ** 3 / M_NO2, NO2_WASHED = 3.2 / M_NO2;                    // mM：回推的淬灭终点；末次水洗后
  (function buildRate() {
    const ZMAX = Math.log10(rate(3.4, 0.1, 20)), SPAN = 12.5;
    const vOf = (mM) => (Math.log10(mM) + 2) / 4;
    const I = { ph: $('#i-ph'), no2: $('#i-no2'), dma: $('#i-dma'), t: $('#i-t'), v: $('#i-v') };
    const surf = new Ink3D.SurfView($('#rate-canvas'), {
      fn: (u, v) => (Math.log10(rate(8 * u, 10 ** (-2 + 4 * v) * 1e-3, +I.dma.value)) - (ZMAX - SPAN)) / SPAN,
      xt: [0, 2, 4, 6, 8].map((p) => [p / 8, String(p)]), zt: [['0.01', 0], ['0.1', 0.25], ['1', 0.5], ['10', 0.75], ['100', 1]].map(([s, v]) => [v, s]),
      xName: 'pH', zName: '亚硝酸根 mM', yName: '生成速率（对数）',
    });
    surf.set({ ridge: 3.4 / 8, bands: SPAN, marks: [
      { u: 2.8 / 8, v: vOf(NO2_END), label: '淬灭结束时', color: 'red', lift: 0.2 },
      { u: 2.8 / 8, v: vOf(NO2_WASHED), label: '末次水洗后', color: 'ochre', lift: 0.2 },
    ] });
    function update() {
      const pH = +I.ph.value, mM = 10 ** +I.no2.value, dma = +I.dma.value, t = +I.t.value, V = +I.v.value;
      const r = rate(pH, mM * 1e-3, dma), ug = r * M_NDMA * 1e6 * 3600, ppm = ug * (t / 60) * V / 1000, ratio = ppm / 0.52;
      $('#o-ph').textContent = pH.toFixed(1); $('#o-no2').textContent = `${num(mM)} mM（${num(mM * M_NO2)} mg/L）`;
      $('#o-dma').textContent = `${dma.toFixed(1)} mg/L`; $('#o-t').textContent = t >= 120 ? `${num(t / 60)} 小时` : `${t} 分钟`; $('#o-v').textContent = `${V} L`;
      setHTML($('#r-g'), `${Math.round(g(pH) * 100)}<small>%</small>`);
      setHTML($('#r-rate'), `${num(ug)}<small>µg/(L·h)</small>`);
      setHTML($('#r-ppm'), `${num(ppm)}<small>ppm</small>`);
      let s;
      if (ratio >= 1) s = `按这组条件能生成约 ${num(ppm)} ppm，已经达到或超过 0.52 ppm。量级上不需要别的解释，前提是这些 NDMA 全都留在了产品里。`;
      else if (ratio >= 0.05) s = `约 ${num(ppm)} ppm，是 0.52 ppm 的 ${Math.round(ratio * 100)}%。还差一截：亚硝酸根浓度再高 ${times(Math.sqrt(1 / ratio))} 倍就补齐了，因为它是平方关系。`;
      else if (ratio >= 1e-4) s = `约 ${num(ppm)} ppm，比 0.52 ppm 少 ${times(1 / ratio)} 倍。单靠这组条件解释不了筛查信号；亚硝酸根浓度要高 ${times(Math.sqrt(1 / ratio))} 倍才够。`;
      else s = `约 ${num(ppm)} ppm，可以忽略。亚硝酸根稀到这个程度，溶液里的亚硝化基本停了。`;
      setHTML($('#r-verdict'), s);
      surf.set({ probe: [pH / 8, vOf(mM)] });
    }
    Object.values(I).forEach((i) => i.addEventListener('input', update));
    const PRE = { quench: { ph: 2.8, no2: Math.log10(NO2_END), dma: 11.8, t: 60 }, washed: { ph: 2.8, no2: Math.log10(NO2_WASHED), dma: 11.8, t: 480 }, old: { ph: 2.9, no2: Math.log10(NO2_END), dma: 1.0, t: 60 }, hot: { ph: 2.8, no2: Math.log10(30), dma: 11.8, t: 60 } };
    $('#rate-presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; for (const [k, v] of Object.entries(PRE[b.dataset.p])) I[k].value = v; update(); });
    I.no2.value = Math.log10(NO2_END); update();
  })();

  /* ================= 陆 水洗 ================= */
  (function buildWash() {
    const el = $('#wash-chart'), W = 560, H = 330, L = 58, R = 26, T = 22, B = 48;
    const x = (n) => L + n / 3 * (W - L - R), y = (v) => T + (3 - Math.log10(v)) / 4 * (H - T - B);
    let s = '';
    for (const v of [0.1, 1, 10, 100, 1000]) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 9}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    for (let n = 0; n <= 3; n++) s += `<line class="tick" x1="${x(n)}" x2="${x(n)}" y1="${H - B}" y2="${H - B + 6}"/><text x="${x(n)}" y="${H - B + 22}" text-anchor="middle">${n === 0 ? '淬灭后' : n + ' 洗后'}</text>`;
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><text class="axis-name" x="${L}" y="12">亚硝酸根 mg/L（对数）</text>`;
    const pts = [0, 1, 2, 3].map((n) => [n, 0.4 * 8 ** (3 - n)]);
    s += `<path class="ln old guess" d="M${pts.map(([n, v]) => `${x(n)},${y(v)}`).join(' L')}"/>`;
    const dot = (n, v, cls, lab, tip, dx = 12, dy = 4, anchor = 'start') => `<circle class="pt ${cls}" cx="${x(n)}" cy="${y(v)}" r="6.5"/><text class="lab ${cls.includes('now') && !cls.includes('hollow') ? 'hot' : ''} halo-t" x="${x(n) + dx}" y="${y(v) + dy}" text-anchor="${anchor}">${lab}</text><circle class="hit" cx="${x(n)}" cy="${y(v)}" r="18" tabindex="0" data-tip="${esc(tip)}"/>`;
    s += dot(0, pts[0][1], 'hollow old', '≈ 205', '<b>淬灭后，未洗</b><br>回推值约 205 mg/L（4.5 mM）<br>没有实测');
    s += dot(1, pts[1][1], 'hollow old', '≈ 26', '<b>一洗后</b><br>回推值约 26 mg/L<br>没有实测');
    s += dot(2, 3.2, 'now', '3.2　现行工艺到此为止', '<b>两洗后 · 现行工艺</b><br>实测 3.2 mg/L（0.07 mM）');
    s += dot(3, 0.4, 'old', '历史工艺　0.4', '<b>三洗后 · 历史工艺</b><br>实测 0.4 mg/L', 8, -14, 'end');
    el.innerHTML = s;
    tips(el.parentNode);

    const iF = $('#i-f');
    function purge() {
      const f = +iF.value, v = 0.52 / f;
      $('#o-f').textContent = `${f.toFixed(1)} 倍`;
      logStrip($('#purge-chart'), { min: 0.01, max: 1, name: 'NDMA（若筛查信号确为 NDMA）',
        lines: [{ v: 0.40, label: '限度 0.40', hot: true, row: 1 }, { v: 0.12, label: '30%', row: 0 }, { v: 0.04, label: '10%', row: 0 }],
        points: [{ v: 0.52, label: '两洗 0.52', cls: 'now', hot: true, row: 1, anchor: 'start' }, { v, label: `补第三洗 ${num(v)}`, cls: 'hollow now', row: 0, anchor: v > 0.3 ? 'end' : 'middle' }] });
      let s = `每洗清除 ${f.toFixed(1)} 倍的话，第三洗能把 0.52 降到 ${num(v)} ppm。`;
      s += v > 0.40 ? '仍然超过限度。' : v > 0.12 ? '过了限度这一关，但还在警戒线（限度的 30%）之上，余量很薄。' : v > 0.04 ? '落在限度的 10%–30% 之间。' : '低于限度的 10%。';
      s += ' 清除倍数要到 1.3 才低于限度，到 4.3 才低于限度的 30%。水洗只是兜底：源头不处理，每一批都在赌这一洗的效率。';
      setHTML($('#purge-verdict'), s);
    }
    iF.addEventListener('input', purge); purge();

    const iV = $('#i-vd');
    function dma() {
      const V = +iV.value; $('#o-vd').textContent = `${V} L`;
      const row = (name, c, lt) => { const mg = c * V, ppm = mg * M_NDMA / M_DMA; return `<tr><td>${name}</td><td class="r">${lt}${num(mg)} mg</td><td class="r">${lt}${num(ppm)} ppm</td><td class="r">${lt}${times(ppm / 0.40)} 倍</td><td class="r">${lt ? '&gt; ' : ''}${num(0.52 / ppm * 100)}%</td></tr>`; };
      setHTML($('#dma-table'), `<thead><tr><th>工艺</th><th class="r">每千克 API 带入的 DMA</th><th class="r">全部变成 NDMA 的上限</th><th class="r">是限度的</th><th class="r">0.52 ppm 只需其中</th></tr></thead><tbody>${row('现行 · 11.8 mg/L', 11.8, '')}${row('历史 · &lt; 1.0 mg/L', 1.0, '&lt; ')}</tbody>`);
    }
    iV.addEventListener('input', dma); dma();
  })();

  /* ================= 柒 检测 ================= */
  (function buildAssay() {
    logStrip($('#ladder-chart'), { min: 0.01, max: 1000, name: '同一把对数尺上的几个浓度',
      bands: [{ a: 500, b: 1000, label: 'UV 能定量的范围', row: 2 }, { a: 0.04, b: 0.12, label: '确证方法该有的定量限', cls: 'hot', row: 2 }],
      lines: [{ v: 500, label: 'UHPLC-UV 定量限 500', row: 0, cls: 'tick' }, { v: 0.40, label: 'NDMA 限度 0.40', hot: true, row: 0, anchor: 'start' }, { v: 0.11, label: 'NDEA 限度 0.11', row: 0, anchor: 'end', cls: 'tick' }],
      points: [{ v: 0.52, label: '筛查信号 0.52', cls: 'now', hot: true }] });
    const lad = $('#ladder-chart'), [, , W] = lad.getAttribute('viewBox').split(' ').map(Number);
    const lx = (v) => 30 + (Math.log10(v) + 2) / 5 * (W - 60);
    lad.insertAdjacentHTML('beforeend', `<path class="ln old" d="M${lx(0.40) + 6},114 L${lx(500) - 6},114 M${lx(0.40) + 14},109 L${lx(0.40) + 6},114 L${lx(0.40) + 14},119 M${lx(500) - 14},109 L${lx(500) - 6},114 L${lx(500) - 14},119"/><text class="lab halo-t" x="${(lx(0.40) + lx(500)) / 2}" y="118" text-anchor="middle">相差 1250 倍</text>`);

    const el = $('#hrms-chart'), W2 = 600, H = 300, L = 40, R = 16, T = 40, B = 40, X0 = 75.045, X1 = 75.075;
    const M0 = 75.0553, M15 = 75.0571, M13 = 75.0634;
    const x = (m) => L + (m - X0) / (X1 - X0) * (W2 - L - R), y = (v) => H - B - v * (H - T - B);
    const iR = $('#i-r'), iD = $('#i-d'), bOn = $('#ndma-on'), bOff = $('#ndma-off');
    let on = true, state = null;
    function draw() {
      const Rp = 10 ** +iR.value, D = +iD.value, fw = M0 / Rp, c = 4 * Math.LN2 / fw ** 2;
      const amp = [[M0, on ? 0.52 : 0], [M15, D * 0.00364], [M13, D * 0.0324]];
      const G = (m, mu) => Math.exp(-c * (m - mu) ** 2);
      const N = 260, xs = [...Array(N + 1)].map((_, i) => X0 + (X1 - X0) * i / N);
      const comp = amp.map(([mu, a]) => xs.map((m) => a * G(m, mu))), sum = xs.map((_, i) => comp[0][i] + comp[1][i] + comp[2][i]);
      const top = Math.max(...sum, 1e-9), path = (arr) => 'M' + arr.map((v, i) => `${x(xs[i]).toFixed(1)},${y(v / top).toFixed(1)}`).join(' L');
      $('#o-r').textContent = `${num(Math.round(Rp / 100) * 100, 3)}`; $('#o-d').textContent = `${D} ppm`;
      let s = `<line class="axis" x1="${L}" x2="${W2 - R}" y1="${H - B}" y2="${H - B}"/>`;
      for (const m of [75.05, 75.06, 75.07]) s += `<line class="tick" x1="${x(m)}" x2="${x(m)}" y1="${H - B}" y2="${H - B + 6}"/><text x="${x(m)}" y="${H - B + 22}" text-anchor="middle">${m.toFixed(2)}</text>`;
      s += `<text class="axis-name" x="${W2 - R}" y="${H - B + 22}" text-anchor="end">m/z</text><text class="axis-name" x="${L}" y="12">相对强度</text>`;
      [[M0, 'NDMA', 'lim'], [M15, '¹⁵N', 'ln blue'], [M13, '¹³C', 'ln ochre']].forEach(([m, t, cls], i) => { s += `<line class="${cls}" style="stroke-width:1.2" x1="${x(m)}" x2="${x(m)}" y1="${T - 8}" y2="${H - B}" opacity=".5"/><text class="lab halo-t" x="${x(m) + (i === 0 ? -4 : 4)}" y="${T - 14}" text-anchor="${i === 0 ? 'end' : 'start'}">${t}</text>`; });
      s += `<path class="area" d="${path(sum)} L${x(X1)},${y(0)} L${x(X0)},${y(0)} Z"/><path class="ln ochre" d="${path(comp[2])}"/><path class="ln blue" d="${path(comp[1])}"/><path class="ln now" d="${path(comp[0])}"/><path class="ln" style="stroke-width:2.6" d="${path(sum)}"/>`;
      s += `<g id="hx" style="display:none"><line class="cross" y1="${T - 8}" y2="${H - B}"/></g><rect class="hit" x="${L}" y="${T - 8}" width="${W2 - L - R}" height="${H - B - T + 8}"/>`;
      el.innerHTML = s; chemify(el); state = { amp, G, top };
      const fake = amp[1][1] * G(M0, M15) + amp[2][1] * G(M0, M13), app = amp[0][1] + fake;
      let v = `在 m/z 75.0553 处，仪器读到的相当于 <strong>${num(app)} ppm</strong>，其中 ${num(fake)} ppm 来自 DMF 的同位素峰。`;
      if (!on && fake >= 0.05) v += ' 样品里明明没有 NDMA，却读出了信号。';
      else if (on && fake > 0.1) v += ' 真信号被抬高了，会把一个本来只是略超限的结果报得更高。';
      else v += ' 这个分辨率下，干扰已经可以忽略。';
      v += Rp >= 42000 ? ' 分辨率过了约 42000 这道线（75.055 ÷ 0.0018），NDMA 和 ¹⁵N 峰才算分得开。' : ' 要把 NDMA 和 ¹⁵N 峰分开，分辨率需要约 42000 以上（75.055 ÷ 0.0018）。';
      setHTML($('#hrms-verdict'), v);
    }
    const tip = makeTip(el.parentNode);
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect(), m = X0 + ((e.clientX - r.left) / r.width * W2 - L) / (W2 - L - R) * (X1 - X0), hx = $('#hx', el);
      if (!state || m < X0 || m > X1) { hx && (hx.style.display = 'none'); tip.hidden = true; return; }
      hx.style.display = ''; hx.firstChild.setAttribute('x1', x(m)); hx.firstChild.setAttribute('x2', x(m));
      const [a, b, c] = state.amp.map(([mu, amp]) => amp * state.G(m, mu));
      setHTML(tip, `<b>m/z ${m.toFixed(4)}</b><br>NDMA ${num(a)} · ¹⁵N-DMF ${num(b)} · ¹³C-DMF ${num(c)}<br>合计相当于 ${num(a + b + c)} ppm`);
      tip.hidden = false; tip.style.left = clamp(e.clientX - r.left + 14, 0, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.max(0, e.clientY - r.top - tip.offsetHeight - 12) + 'px';
    });
    el.addEventListener('pointerleave', () => { const hx = $('#hx', el); hx && (hx.style.display = 'none'); tip.hidden = true; });
    const setOn = (v) => { on = v; bOn.setAttribute('aria-pressed', String(v)); bOff.setAttribute('aria-pressed', String(!v)); draw(); };
    bOn.addEventListener('click', () => setOn(true)); bOff.addEventListener('click', () => setOn(false));
    iR.addEventListener('input', draw); iD.addEventListener('input', draw); draw();
  })();

  /* ================= 捌 断案 ================= */
  const HYP = [
    { id: '甲', name: '淬灭时原位生成', prof: [0, 0, 1, 0.45, 0.2, 0.2, 0.2], grid: [0.04, 0.1, 0.35, 1], fifth: 1,
      claim: '回收 DMF 把 DMA 带进釜里，淬灭时被亚硝化物种变成 NDMA。',
      pro: '前体（DMA 多了 12 倍）、试剂（亚硝酸）、酸度（pH 2.8）三样齐全，和缬沙坦事件的机理一致。',
      con: '按水相动力学粗算，量级偏低。要凑够 0.52 ppm，需要更高的瞬时亚硝酸浓度，或者釜内有比进料更多的 DMA。',
      test: '淬灭之前测不到 NDMA，淬灭之后出现。原生 DMF 加标 DMA 到 11.8 mg/L，同样能重现。' },
    { id: '乙', name: '随回收溶剂带入', prof: [0.9, 0.9, 0.9, 0.42, 0.2, 0.2, 0.2], grid: [0, 0, 0.35, 1], fifth: 0,
      claim: 'NDMA 在回收商那里就已经混进了 R-21，比如共用储罐里残留着别家客户的物料。蒸馏分不开它。',
      pro: '回收商的追溯记录不全。NDMA 沸点约 152 °C，和 DMF 几乎相同。',
      con: '这要求回收商那边同时有胺和亚硝化来源，或者直接接触过含亚硝胺的物料，目前没有证据。',
      test: '直接在 R-21 和淬灭前的反应液里测到 NDMA。原生 DMF 加标 DMA 不能重现。' },
    { id: '丙', name: '一直都有，只是少洗了一次', prof: [0, 0, 1, 0.45, 0.2, 0.2, 0.2], old: [0, 0, 1, 0.45, 0.2, 0.08, 0.08], grid: [0.12, 1, 0.12, 1], fifth: 1,
      claim: '两种工艺都会生成 NDMA。历史工艺靠第三次水洗，把它清到了看不见的水平。',
      pro: '亚硝酸根残留差 8 倍，说明第三洗确有清除力。NDMA 溶于水。历史工艺的 DMA 按化学计量也远远够用。',
      con: '历史工艺没有筛查数据，无法直接比较。',
      test: '历史工艺的留样测出低但不是零的 NDMA。2×2 实验里水洗次数的效应明显。逐洗清除倍数实测大于 1.3。' },
    { id: '丁', name: '干燥贮存中后期生成', prof: [0, 0, 0.05, 0.03, 0.02, 0.45, 1], grid: [0.02, 0.3, 0.08, 1], fifth: 0.8,
      claim: 'API 里残留的亚硝酸根和胺（或残留 DMF），在干燥、贮存中继续反应。',
      pro: '两洗工艺的亚硝酸根残留高 8 倍。制剂里有固态缓慢生成亚硝胺的文献先例。',
      con: '按 3.2 mg/L 的亚硝酸根算，溶液里的速率小到可以忽略。固态是否不同，要看数据。',
      test: '同一批留样隔时间复测，NDMA 持续上升。干燥前后有跳变。' },
    { id: '戊', name: '分析假象，或别的亚硝胺', prof: null, grid: null, fifth: null,
      claim: '信号不是 NDMA，或者不全是。可能是残留 DMF 的同位素峰，可能是前处理时现生成的，也可能是别的亚硝胺，比如限度只有 0.11 ppm 的 NDEA。',
      pro: '筛查没有确证身份。DMF 正是工艺溶剂。回收商处理多家客户的溶剂，胺的种类不可知。',
      con: '案例没有给筛查方法的细节，无从判断。',
      test: '对照品保留时间、两对离子的比值、高分辨精确质量，任何一项对不上。或者加了清除剂后信号下降。' },
  ];
  (function buildHyp() {
    const chips = $('#hyp-chips'), el = $('#hyp-chart'), W = 600, H = 300, L = 54, R = 20, T = 26, B = 64;
    const PTS = ['进料 DMF', '淬灭前', '淬灭后', '一洗后', '二洗后', '成品', '贮存后'];
    const x = (i) => L + 20 + i / 6 * (W - L - R - 40), y = (v) => T + (1 - v) * (H - T - B);
    setHTML(chips, HYP.map((h) => `<button type="button" data-h="${h.id}" aria-pressed="false"><i>${h.id}</i>${h.name}</button>`).join(''));
    function pick(id) {
      const h = HYP.find((k) => k.id === id);
      $$('button', chips).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.h === id)));
      let s = '';
      [[0, '无'], [0.5, '中'], [1, '高']].forEach(([v, t]) => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 9}" y="${y(v) + 4}" text-anchor="end">${t}</text>`; });
      PTS.forEach((t, i) => { s += `<text x="${x(i)}" y="${H - B + 24}" text-anchor="middle">${t}</text>`; });
      s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><text class="axis-name" x="${L}" y="12">NDMA（相对水平）</text>`;
      s += `<line class="tick" x1="${(x(1) + x(2)) / 2}" x2="${(x(1) + x(2)) / 2}" y1="${T}" y2="${y(0)}" stroke-dasharray="2 5"/><text x="${(x(1) + x(2)) / 2}" y="${H - B + 46}" text-anchor="middle" class="axis-name">↑ 加亚硝酸钠</text>`;
      if (h.prof) {
        if (h.old) s += `<path class="ln old" d="M${h.old.map((v, i) => `${x(i)},${y(v)}`).join(' L')}"/>` + h.old.slice(5).map((v, i) => `<circle class="pt old" cx="${x(i + 5)}" cy="${y(v)}" r="5"/>`).join('');
        s += `<path class="ln now" d="M${h.prof.map((v, i) => `${x(i)},${y(v)}`).join(' L')}"/>`;
        h.prof.forEach((v, i) => { s += `<circle class="pt now" cx="${x(i)}" cy="${y(v)}" r="6"/><circle class="hit" cx="${x(i)}" cy="${y(v)}" r="16" tabindex="0" data-tip="${esc(`<b>${PTS[i]}</b><br>预期：${v < 0.04 ? '测不到' : v < 0.3 ? '低' : v < 0.7 ? '中等' : '高'}`)}"/>`; });
      } else {
        s += `<path class="ln old guess" d="M${x(0)},${y(0.5)} L${x(6)},${y(0.5)}"/><text class="lab halo-t" x="${W / 2}" y="${y(0.5) - 14}" text-anchor="middle">与取样位置无关：读数跟着样品里的 DMF 和亚硝酸根走</text>`;
      }
      el.innerHTML = s;
      setHTML($('#hyp-legend'), h.prof ? `<span><i class="ndma"></i>现行工艺（两洗）</span>${h.old ? '<span><i style="background:var(--ink-soft)"></i>历史工艺（多一洗）</span>' : ''}` : '<span class="pale">这种说法不预言固定的形状</span>');
      const cell = (v, lab) => (v == null ? `<div class="cell q"><i style="--v:.5"></i><em>${lab}</em></div>` : `<div class="cell"><i style="--v:${v}"></i><em>${lab}</em></div>`);
      const gv = h.grid || [null, null, null, null];
      setHTML($('#hyp-grid'), `<div></div><div>三洗</div><div>两洗</div><div class="rowh">原生 DMF</div>${cell(gv[0], '')}${cell(gv[1], '')}<div class="rowh">回收 DMF</div>${cell(gv[2], '')}${cell(gv[3], '现行')}`);
      setHTML($('#hyp-fifth'), `<div>原生 DMF + 加标 DMA · 两洗</div>${cell(h.fifth, '第五组')}`);
      setHTML($('#hyp-panel'), `<span class="p-no">${h.id}</span><div class="p-title">${h.name}</div><h4>它主张</h4><p>${h.claim}</p><h4>支持它的</h4><p>${h.pro}</p><h4>它的软肋</h4><p>${h.con}</p><h4>一锤定音的结果</h4><p>${h.test}</p>`);
    }
    chips.addEventListener('click', (e) => { const b = e.target.closest('button'); b && pick(b.dataset.h); });
    tips(el.parentNode); pick('甲');
  })();

  /* ================= 玖 对策 ================= */
  (function buildStack() {
    const box = $('#stack'), iF = $('#i-f2');
    const ITEMS = [
      { id: 'dma', label: '回收 DMF 的 DMA 压到 ≤ 1.0 mg/L', form: () => 1 / 11.8, carry: () => 1, n1: '一级关系：DMA 少多少，生成就少多少。', n2: '带进来的是现成的 NDMA，DMA 再低也无济于事。' },
      { id: 'ndma', label: '回收 DMF 增加「NDMA 不得检出」', form: () => 1, carry: () => 0, n1: '溶剂里本来没有 NDMA 的话，这一条不改变结果，但它是排除「带入」的保险。', n2: '直接堵住来源。' },
      { id: 'wash', label: '恢复第三次水洗', form: () => 1 / +iF.value, carry: () => 1 / +iF.value, n1: '清除已经生成的 NDMA，倍数待实测。', n2: '带入的 NDMA 同样洗得掉一部分。' },
      { id: 'no2', label: '亚硝酸钠的过量减半', form: () => 1 / 4, carry: () => 1, n1: '二级关系：减半得四分之一。', n2: '对已经带入的 NDMA 没有作用。' },
      { id: 'time', label: '淬灭后立即加清除剂，停留时间减半', form: () => 1 / 2, carry: () => 1, n1: '一级关系：胺和亚硝酸同处的时间减半。', n2: '对已经带入的 NDMA 没有作用。' },
    ];
    let mode = 'form';
    const on = new Set();
    const fac = (f) => (f === 0 ? '→ 0' : f === 1 ? '× 1' : `× 1/${+(1 / f).toFixed(1)}`);
    function render() {
      setHTML(box, ITEMS.map((it) => {
        return `<label><input type="checkbox" data-id="${it.id}" ${on.has(it.id) ? 'checked' : ''}><span>${it.label}</span><b>${fac(it[mode]())}</b><small>${mode === 'form' ? it.n1 : it.n2}</small></label>`;
      }).join(''));
      $('#o-f2').textContent = `${(+iF.value).toFixed(1)} 倍`;
      let v = 0.52; const chain = ['0.52'];
      for (const it of ITEMS) if (on.has(it.id)) { const f = it[mode](); v *= f; if (f !== 1) chain.push(f === 0 ? '0' : `1/${+(1 / f).toFixed(1)}`); }
      const zero = v === 0;
      logStrip($('#stack-chart'), { min: 0.001, max: 1, name: '预计的 NDMA',
        lines: [{ v: 0.40, label: '限度 0.40', hot: true, row: 1 }, { v: 0.12, label: '30%', row: 0 }, { v: 0.04, label: '10%', row: 0 }],
        points: [{ v: 0.52, label: '现状 0.52', cls: 'now', hot: true, row: 1, anchor: 'end' }, { v: zero ? 0.001 : v, label: zero ? '低于定量限' : on.size ? `叠加后 ${num(v)}` : '', cls: 'hollow now', row: 0, anchor: v < 0.004 ? 'start' : v > 0.3 ? 'end' : 'middle' }] });
      setHTML($('#stack-eq'), !on.size ? '勾选左边的措施，看它们怎么相乘' : zero ? '溶剂里不再有 NDMA → 低于定量限' : `${chain.join(' × ')} = ${num(v)} ppm`);
      let s = zero ? '来源堵住了，预计低于方法定量限。' : v > 0.40 ? '仍然超过限度。' : v > 0.12 ? '过了限度，但还在警戒线（限度的 30%）之上，余量很薄。' : v > 0.04 ? '落在限度的 10%–30% 之间。' : '低于限度的 10%。到了这个水平，才有资格谈减少检测频次。';
      if (mode === 'carry') s += ' 根因若是带入，亚硝酸和时间这两项完全不起作用。对策选错了方向，钱花了，风险还在。所以要先断案，再定对策。';
      else if (on.size >= 2) s += ' 几项措施是相乘的关系，每项都不必做到极致。';
      setHTML($('#stack-verdict'), s);
    }
    box.addEventListener('change', (e) => { const c = e.target.closest('input'); if (!c) return; c.checked ? on.add(c.dataset.id) : on.delete(c.dataset.id); render(); });
    iF.addEventListener('input', render);
    $('#stack-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; $$('#stack-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); });
    render();
  })();

  chemify(document.body);
})();
