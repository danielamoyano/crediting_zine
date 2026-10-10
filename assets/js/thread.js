/* ────────────────────────────────────────────────────────────
   The line that connects the circles.

   • It passes through every element with data-line="N", in order of N.
   • It is drawn as you scroll.
   • At the end it tangles through the circles marked data-knot,
     and keeps moving a little.

   Things you may want to tweak are in SETTINGS.
   ──────────────────────────────────────────────────────────── */
(() => {
  const SETTINGS = {
    drawAt: 0.62,        // the tip of the line sits at this fraction of the window height
    ease: 0.09,          // how quickly the line catches up with the scroll (0–1)
    meander: 0.11,       // how much the line wanders between two points
    gutter: 9,           // on phones: distance of the line from the left edge (px)
    tanglePasses: 2,     // how many times the line runs through the final circles
    tangleMess: 0.34,    // how far the tangle strays from a straight path
    tangleDrift: 14,     // how much the tangle moves over time (design px)
    tangleSpeed: 0.00035 // speed of that movement
  };

  const page   = document.getElementById('page');
  const svg    = document.getElementById('thread');
  const mains  = [...svg.querySelectorAll('.thread-main')];
  const tangle = svg.querySelector('.thread-tangle');
  const clipLight = svg.querySelectorAll('#clip-light rect');
  const clipDark  = svg.querySelector('#clip-dark rect');
  const cue    = document.getElementById('scroll-cue');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* seeded random numbers, so the line looks the same on every visit */
  const rng = seed => () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  /* give every circle its own blinking rhythm */
  const r0 = rng(7);
  document.querySelectorAll('img.c').forEach(img => {
    const [fx, fy] = (img.dataset.dot || '0.5,0.5').split(',').map(Number);
    img.style.transformOrigin = `${fx * 100}% ${fy * 100}%`;   // pulse around the dot
    img.style.animationDuration = (2.6 + r0() * 2.4).toFixed(2) + 's';
    img.style.animationDelay = (-r0() * 6).toFixed(2) + 's';
  });

  let unit = 1;            // one design pixel, in CSS pixels
  let samples = [];        // [fraction of the line, lowest y reached so far]
  let knots = [];          // dot positions of the final circles
  let tanglePlan = [];     // the order in which the tangle visits them
  let mainEndY = 0, tangleEndY = 1;
  let shown = 0, shownTangle = 0;

  const visible = el => el.getClientRects().length > 0;

  function pointOf(el, origin) {
    const r = el.getBoundingClientRect();
    const [fx, fy] = (el.dataset.dot || '0.5,0.5').split(',').map(Number);
    return { x: r.left - origin.left + r.width * fx, y: r.top - origin.top + r.height * fy, via: el.classList.contains('via') };
  }

  /* smooth curve through a list of points (Catmull-Rom → Bézier) */
  function curve(pts, tension = 1) {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const k = tension / 6;
      d += `C${(p1.x + (p2.x - p0.x) * k).toFixed(1)} ${(p1.y + (p2.y - p0.y) * k).toFixed(1)} ` +
           `${(p2.x - (p3.x - p1.x) * k).toFixed(1)} ${(p2.y - (p3.y - p1.y) * k).toFixed(1)} ` +
           `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  /* add a gentle bend between far-apart points, so the line feels hand-drawn */
  function wander(pts, amount, rand, minGap) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len > minGap && !a.via && !b.via) {
        const side = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.8) * amount;
        const t = 0.38 + rand() * 0.24;
        out.push({ x: a.x + dx * t - dy * side, y: a.y + dy * t + dx * side });
      }
      out.push(b);
    }
    return out;
  }

  /* on phones the line travels down the left margin between far-apart points,
     so it doesn't run across the text */
  function gutter(pts, x) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dy = b.y - a.y;
      if (dy > 260) {
        const lead = Math.min(80, dy * 0.25);
        out.push({ x, y: a.y + lead, via: true }, { x, y: b.y - lead, via: true });
      }
      out.push(b);
    }
    return out;
  }

  function build() {
    const origin = page.getBoundingClientRect();
    const W = origin.width, H = page.scrollHeight;
    unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) ||
           Math.min(window.innerWidth, 1680) / 1512;
    if (window.innerWidth <= 820) unit = 1;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    /* dark zone → the line turns light inside it */
    const zone = [...document.querySelectorAll('[data-darkzone]')].find(visible);
    const z = zone ? zone.getBoundingClientRect() : null;
    const zt = z ? z.top - origin.top : H + 10, zb = z ? z.bottom - origin.top : H + 10;
    const set = (r, y, h) => { r.setAttribute('x', -50); r.setAttribute('width', W + 100); r.setAttribute('y', y); r.setAttribute('height', Math.max(0, h)); };
    set(clipLight[0], -50, zt + 50);
    set(clipLight[1], zb, H - zb + 50);
    set(clipDark, zt, zb - zt);

    /* main line */
    const anchors = [...document.querySelectorAll('[data-line]')]
      .filter(visible)
      .sort((a, b) => a.dataset.line - b.dataset.line)
      .map(el => pointOf(el, origin));
    const narrow = window.innerWidth <= 820;
    if (narrow) {                      // one column: simply go top to bottom
      const last = anchors.pop();
      anchors.sort((a, b) => a.y - b.y);
      anchors.push(last);
    }
    const routed = narrow ? gutter(anchors, SETTINGS.gutter) : anchors;
    const pts = wander(routed, SETTINGS.meander, rng(11), 150 * unit);
    const d = curve(pts);
    mains.forEach(p => p.setAttribute('d', d));

    /* map: how much of the line is drawn when the tip is at height y */
    samples = [];
    if (d) {
      const total = mains[0].getTotalLength(), N = 700;
      let maxY = -Infinity;
      for (let i = 0; i <= N; i++) {
        const p = mains[0].getPointAtLength(total * i / N);
        maxY = Math.max(maxY, p.y);
        samples.push([i / N, maxY]);
      }
    }
    mainEndY = anchors.length ? anchors[anchors.length - 1].y : 0;

    /* tangle */
    knots = [...document.querySelectorAll('[data-knot]')].filter(visible).map(el => pointOf(el, origin));
    const rand = rng(23);
    tanglePlan = [];
    let last = 0;
    for (let pass = 0; pass < SETTINGS.tanglePasses; pass++) {
      const order = knots.map((_, i) => i).filter(i => !(pass === 0 && i === 0));
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];
      }
      if (order[0] === last) order.push(order.shift());
      order.forEach(i => {
        tanglePlan.push({
          i,
          side: (rand() < 0.5 ? -1 : 1) * (0.35 + rand()) * SETTINGS.tangleMess,
          t: 0.3 + rand() * 0.4,
          miss: pass === 0 ? 0 : (rand() - 0.5) * 2,     // later passes no longer hit the dots exactly
          phase: rand() * Math.PI * 2,
          speed: 0.6 + rand() * 0.9
        });
        last = i;
      });
    }
    const bottom = knots.reduce((m, k) => Math.max(m, k.y), 0) + 120 * unit;
    const reachable = H - window.innerHeight * (1 - SETTINGS.drawAt) - 8;
    tangleEndY = Math.max(mainEndY + 1, Math.min(bottom, reachable));

    drawTangle(performance.now());
    update(true);
  }

  function drawTangle(now) {
    if (knots.length < 2) { tangle.setAttribute('d', ''); return; }
    const t = reduce ? 0 : now * SETTINGS.tangleSpeed;
    const drift = SETTINGS.tangleDrift * unit;
    const pts = [knots[0]];
    let prev = knots[0];
    tanglePlan.forEach((s, n) => {
      const grow = 0.35 + 0.65 * (n / tanglePlan.length);          // gets messier as it goes
      const k = knots[s.i];
      const wob = { x: Math.sin(t * s.speed + s.phase) * drift * grow, y: Math.cos(t * s.speed * 0.8 + s.phase * 1.7) * drift * grow };
      const target = { x: k.x + s.miss * 26 * unit + wob.x * Math.abs(s.miss), y: k.y - s.miss * 20 * unit + wob.y * Math.abs(s.miss) };
      const dx = target.x - prev.x, dy = target.y - prev.y;
      pts.push({ x: prev.x + dx * s.t - dy * s.side * grow + wob.x, y: prev.y + dy * s.t + dx * s.side * grow + wob.y });
      pts.push(target);
      prev = target;
    });
    tangle.setAttribute('d', curve(pts, 1.15));
  }

  function targets() {
    const tipY = window.scrollY + window.innerHeight * SETTINGS.drawAt - (page.getBoundingClientRect().top + window.scrollY);
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (samples[mid][1] <= tipY) lo = mid; else hi = mid - 1; }
    const main = samples.length && samples[lo][1] <= tipY ? samples[lo][0] : 0;
    const tang = Math.min(1, Math.max(0, (tipY - mainEndY) / (tangleEndY - mainEndY)));
    return [main, tang];
  }

  function update(jump) {
    const [m, t] = reduce ? [1, 1] : targets();
    if (jump && reduce) { shown = m; shownTangle = t; }
    shown += (m - shown) * (reduce ? 1 : SETTINGS.ease);
    shownTangle += (t - shownTangle) * (reduce ? 1 : SETTINGS.ease);
    mains.forEach(p => { p.style.strokeDashoffset = (1 - shown).toFixed(4); });
    tangle.style.strokeDashoffset = (1 - shownTangle).toFixed(4);
  }

  function frame(now) {
    if (!reduce && shownTangle > 0.002) drawTangle(now);
    update(false);
    updateCue();
    requestAnimationFrame(frame);
  }

  /* scroll button: "scroll" at the top, "back to top" at the end, hidden in between */
  const cueLabel = cue && cue.querySelector('.cue-label');
  function updateCue() {
    if (!cue) return;
    const atTop = window.scrollY < 60;
    const atEnd = window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 140;
    const up = atEnd && !atTop;
    cue.classList.toggle('gone', !atTop && !atEnd);
    if (cue.classList.contains('up') !== up) {
      cue.classList.toggle('up', up);
      cueLabel.textContent = up ? 'back to top' : 'scroll';
      cue.setAttribute('aria-label', up ? 'Back to top' : 'Scroll down');
    }
  }
  if (cue) cue.addEventListener('click', () => {
    const behavior = reduce ? 'auto' : 'smooth';
    if (cue.classList.contains('up')) window.scrollTo({ top: 0, behavior });
    else window.scrollBy({ top: window.innerHeight * 0.85, behavior });
  });

  let pending;
  const rebuild = () => { clearTimeout(pending); pending = setTimeout(build, 80); };
  window.addEventListener('resize', rebuild);
  window.addEventListener('load', build);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  if ('ResizeObserver' in window) new ResizeObserver(rebuild).observe(page);

  build();
  requestAnimationFrame(frame);
})();
