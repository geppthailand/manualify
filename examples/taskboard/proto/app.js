/* manualify prototype runtime: hash routes, delegated actions, modals, toasts, pointer drag & drop.
 * A screen is a function (state, h) → HTML. Behaviour lives in ACTIONS. Nothing persists. */
(() => {
  const S = { ...structuredClone(window.DATA || {}), modal: null, toast: null };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const h = {
    esc,
    kpi: (label, value, delta, id) => `<div class="card kpi"${id ? ` data-testid="${id}"` : ''}><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${delta ? `<div class="delta ${delta.startsWith('-') ? 'down' : 'up'}">${esc(delta)}</div>` : ''}</div>`,
    badge: (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`,
    bars: (series, id) => `<div class="bars"${id ? ` data-testid="${id}"` : ''}>${series.map(([k, v]) => `<div class="bar"><i style="height:${Math.max(4, (v / Math.max(...series.map((x) => x[1]), 1)) * 88)}%"></i><span>${esc(k)}</span></div>`).join('')}</div>`,
    progress: (pct, id) => `<div class="progress"${id ? ` data-testid="${id}"` : ''}><i style="width:${Math.min(100, pct)}%"></i></div>`,
    options: (list, sel) => list.map((o) => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join(''),
  };
  const route = () => (location.hash.replace(/^#\/?/, '') || window.START || Object.keys(window.SCREENS)[0]).split('?')[0];
  function render() {
    const r = route();
    const screen = window.SCREENS[r] || (() => `<div class="card">No screen "${esc(r)}"</div>`);
    const nav = (window.NAV || []).map(([id, label]) => `<button class="nav${id === r ? ' on' : ''}" data-go="${id}" data-testid="nav-${id}">${esc(label)}</button>`).join('');
    document.getElementById('app').innerHTML = `<div class="app"><aside class="side"><div class="brand"><i></i>${esc(window.BRAND || 'Prototype')}</div>${nav}</aside>
      <main class="main">${screen(S, h)}</main></div>
      ${S.modal && window.MODALS?.[S.modal] ? `<div class="scrim" data-close-scrim><div class="modal" role="dialog" aria-label="${esc(window.MODALS[S.modal].title)}">
        <h2>${esc(window.MODALS[S.modal].title)}</h2>${window.MODALS[S.modal].body(S, h)}</div></div>` : ''}
      ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ''}`;
  }
  const act = (name, ...a) => { const f = window.ACTIONS?.[name]; if (!f) { console.warn('no action', name); return; } const msg = f(S, ...a); if (typeof msg === 'string') toast(msg); render(); };
  function toast(msg) { S.toast = msg; render(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; render(); }, 2600); }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-go],[data-act],[data-open],[data-close],[data-close-scrim]');
    if (!el) return;
    if (el.dataset.go) { location.hash = '#/' + el.dataset.go; return; }
    if (el.dataset.open) { S.modal = el.dataset.open; render(); setTimeout(() => document.querySelector('.modal [autofocus]')?.focus(), 30); return; }
    if (el.hasAttribute('data-close') || (el.hasAttribute('data-close-scrim') && e.target === el)) { S.modal = null; render(); return; }
    if (el.dataset.act) act(el.dataset.act, { ...el.dataset }, el);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-submit]');
    if (!f) return;
    e.preventDefault();
    act(f.dataset.submit, Object.fromEntries(new FormData(f)));
  });
  // pointer drag & drop: [data-drag="id"] onto [data-drop="zone"] → ACTIONS.drop(state, id, zone)
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-drag]');
    if (!el || e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { id: el.dataset.drag, el, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, ghost: null };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    if (!drag.ghost) { drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add('ghost-drag'); document.body.appendChild(drag.ghost); drag.el.style.opacity = '.35'; }
    drag.ghost.style.left = e.clientX - drag.dx + 'px'; drag.ghost.style.top = e.clientY - drag.dy + 'px';
    document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]')?.classList.add('over');
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    const zone = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
    if (zone) act('drop', d.id, zone.dataset.drop); else render();
  });
  window.addEventListener('hashchange', () => { S.modal = null; render(); });
  window.PROTO = { state: S, render, toast };
  render();
})();
