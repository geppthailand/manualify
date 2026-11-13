// In-page camera props: fake cursor, click ripple, highlight boxes with label/badge, drag trail.
// Injected with context.addInitScript, so it survives navigations. Lives in a shadow root on
// <html> so the app's CSS can't touch it and React never re-renders it away.
// Everything is position:fixed, pointer-events:none, in CSS viewport px.
(() => {
  if (window.__mfy) return;
  const theme = Object.assign({ accent: '#f5a524', ink: '#1f2937', badge: '#f5a524', badgeInk: '#111' },
    window.__mfyTheme || {});
  let host, root, cursor, trail;
  let pos = { x: -100, y: -100 };
  const boxes = new Map();

  function mount() {
    if (host && host.isConnected) return true;
    if (!document.documentElement) return false;
    host = document.createElement('mfy-overlay');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial}
      .c{position:fixed;left:0;top:0;width:28px;height:28px;transform-origin:4px 3px;will-change:transform;
         filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transition:scale .12s}
      .c.press{scale:.82}
      .r{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
         border:3px solid ${theme.accent};animation:r .6s ease-out forwards}
      @keyframes r{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}
      .b{position:fixed;border:3px solid ${theme.accent};border-radius:10px;box-sizing:border-box;
         box-shadow:0 0 0 4px rgba(245,165,36,.18);animation:bi .25s ease-out}
      @keyframes bi{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:none}}
      .lbl{position:absolute;white-space:nowrap;background:${theme.ink};color:#fff;font:600 15px/1.2 system-ui,
         "Noto Sans Thai","IBM Plex Sans Thai",sans-serif;padding:6px 10px;border-radius:8px}
      .bd{position:absolute;width:26px;height:26px;border-radius:50%;background:${theme.badge};color:${theme.badgeInk};
         font:700 14px/26px system-ui;text-align:center;left:-13px;top:-13px}
      .t{position:fixed;left:0;top:0;overflow:visible}
      .spot{position:fixed;inset:0;background:rgba(15,23,42,.38);transition:clip-path .3s}
    </style><svg class="t" width="1" height="1"></svg>
    <svg class="c" viewBox="0 0 28 28"><path d="M4 3 L4 22 L9.5 17 L13 25 L16.5 23.5 L13 15.8 L20.5 15.8 Z"
      fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    cursor = root.querySelector('.c');
    trail = root.querySelector('.t');
    (document.body || document.documentElement).appendChild(host);
    place();
    return true;
  }
  function place() { if (cursor) cursor.style.transform = `translate(${pos.x - 4}px, ${pos.y - 3}px)`; }
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  const api = {
    get pos() { return { ...pos }; },
    cursor(x, y) { mount(); pos = { x, y }; place(); },
    move(x, y, ms = 600) {
      mount();
      const from = { ...pos };
      const t0 = performance.now();
      return new Promise((res) => {
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const k = ease(p);
          // slight arc: real hands don't move in straight lines
          const arc = Math.sin(Math.PI * p) * Math.min(40, Math.hypot(x - from.x, y - from.y) * 0.08);
          pos = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k - arc };
          place();
          if (trail.dataset.on) drawTrail();
          p < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
      });
    },
    press(on) { mount(); cursor.classList.toggle('press', !!on); },
    ripple(x = pos.x, y = pos.y) {
      mount();
      const r = document.createElement('div');
      r.className = 'r'; r.style.left = x + 'px'; r.style.top = y + 'px';
      root.appendChild(r); setTimeout(() => r.remove(), 700);
    },
    box(id, rect, o = {}) {
      mount();
      api.clear(id);
      const pad = o.pad ?? 6;
      const b = document.createElement('div');
      b.className = 'b';
      Object.assign(b.style, { left: rect.x - pad + 'px', top: rect.y - pad + 'px',
        width: rect.width + 2 * pad + 'px', height: rect.height + 2 * pad + 'px' });
      if (o.badge) { const d = document.createElement('div'); d.className = 'bd'; d.textContent = o.badge; b.appendChild(d); }
      if (o.label) {
        const l = document.createElement('div'); l.className = 'lbl'; l.textContent = o.label;
        const side = o.side || (rect.y > 90 ? 'top' : 'bottom');
        if (side === 'top') { l.style.left = '0'; l.style.bottom = 'calc(100% + 8px)'; }
        else if (side === 'bottom') { l.style.left = '0'; l.style.top = 'calc(100% + 8px)'; }
        else if (side === 'right') { l.style.left = 'calc(100% + 10px)'; l.style.top = '0'; }
        else { l.style.right = 'calc(100% + 10px)'; l.style.top = '0'; }
        b.appendChild(l);
      }
      root.appendChild(b); boxes.set(id, b);
    },
    clear(id) { const b = boxes.get(id); if (b) { b.remove(); boxes.delete(id); } },
    clearAll() { for (const b of boxes.values()) b.remove(); boxes.clear(); api.spot(null); },
    spot(rect) {
      mount();
      root.querySelectorAll('.spot').forEach((s) => s.remove());
      if (!rect) return;
      const s = document.createElement('div'); s.className = 'spot';
      const { x, y, width: w, height: h } = rect;
      s.style.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${x}px ${y}px,${x}px ${y + h}px,${x + w}px ${y + h}px,${x + w}px ${y}px,${x}px ${y}px)`;
      root.insertBefore(s, root.firstChild.nextSibling);
    },
    trail(on) {
      mount();
      if (on) { trail.dataset.on = '1'; trail.dataset.x = pos.x; trail.dataset.y = pos.y; drawTrail(); }
      else { delete trail.dataset.on; trail.innerHTML = ''; }
    },
    /** The topmost app element at (x, y), ignoring the overlay. */
    hit(x, y) {
      const prev = host ? host.style.display : '';
      if (host) host.style.display = 'none';
      const el = document.elementFromPoint(x, y);
      if (host) host.style.display = prev;
      return el;
    },
  };
  function drawTrail() {
    const x0 = +trail.dataset.x, y0 = +trail.dataset.y;
    trail.innerHTML = `<line x1="${x0}" y1="${y0}" x2="${pos.x}" y2="${pos.y}" stroke="${theme.accent}"
      stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round"/><circle cx="${x0}" cy="${y0}" r="6" fill="${theme.accent}"/>`;
  }
  // effect counter for click proofs: app DOM mutations (our own marks and overlay excluded)
  window.__mfyMut = 0;
  const watch = () => {
    if (!document.documentElement) return;
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes' && m.attributeName === 'data-mfy-hit') continue;
        if (m.target === host || (m.addedNodes.length === 1 && m.addedNodes[0] === host)) continue;
        window.__mfyMut++;
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  window.__mfy = api;
  if (document.documentElement) watch(); else document.addEventListener('readystatechange', watch, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
