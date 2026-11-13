/**
 * Resilient target resolution. Every target form has a fallback ladder, so a copy edit
 * ("Save" → "Save changes") or a tone-mark spelling difference doesn't kill a take:
 *
 *   text    exact → substring → fuzzy (case / spacing / diacritics / Thai tone marks ignored)
 *   role    exact accessible name → substring → fuzzy
 *   #id     data-testid → data-test → data-tour → data-cy → id → name
 *   macro   project macro (config.macros) → built-in role → built-in helper
 *
 * The strategy that matched is reported (`how`), so logs show when a take only worked
 * thanks to a fallback — a hint to tighten the script.
 */

const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'textbox', 'combobox', 'heading',
  'option', 'row', 'cell', 'dialog', 'listitem', 'img', 'switch', 'slider', 'region', 'navigation', 'alert',
  'tabpanel', 'menu', 'listbox', 'grid', 'columnheader', 'searchbox', 'spinbutton', 'treeitem', 'article', 'banner']);

/** Normalise for fuzzy comparison: lower-case, no spaces/punctuation, no diacritics or Thai tone marks. */
export const FUZZY_SRC = `(s) => String(s || '').normalize('NFKD').toLowerCase()
  .replace(/[\\u0300-\\u036f\\u0e31\\u0e34-\\u0e3a\\u0e47-\\u0e4e]/g, '')
  .replace(/[\\s\\u200b.,:;!?'"()\\[\\]{}\\-_/\\\\|*]+/g, '')`;
// eslint-disable-next-line no-eval
export const fuzzy = (0, eval)(FUZZY_SRC);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let hitSeq = 0;

/**
 * In-page search used by fuzzy text and the `box` helper. Marks the best matches with
 * data-mfy-hit="<tag>" and returns how many it marked (deepest visible matches first).
 */
async function markFuzzy(scopeHandle, page, needle, tag, { container = false } = {}) {
  return page.evaluate(({ root, needle, tag, container, FUZZY }) => {
    const fz = (0, eval)(FUZZY);
    const want = fz(needle);
    if (!want) return 0;
    const base = root || document.body;
    document.querySelectorAll(`[data-mfy-hit="${tag}"]`).forEach((e) => e.removeAttribute('data-mfy-hit'));
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
    };
    const hits = [];
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (el.closest('mfy-overlay')) continue;
      const own = fz(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.value || '');
      if (!own.includes(want) || !visible(el)) continue;
      // keep only the deepest element that still contains the text
      const childHas = [...el.children].some((c) => visible(c) && fz(c.innerText || c.getAttribute?.('aria-label') || '').includes(want));
      if (!childHas) hits.push(el);
    }
    let out = hits;
    if (container) {
      // climb to a "box": the nearest ancestor that looks like a card/panel (border, shadow or own background) and is wide enough
      out = hits.map((el) => {
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          const framed = parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none' ||
            (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
          if (framed && r.width >= 140 && r.height >= 48 && a !== el) return a;
        }
        return el;
      });
    }
    // exact-ish matches first (shortest own text)
    out = [...new Set(out)].sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    out.forEach((el) => el.setAttribute('data-mfy-hit', tag));
    return out.length;
  }, { root: scopeHandle, needle, tag, container, FUZZY: FUZZY_SRC });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Candidate locators for one target, in fallback order. Each: {how, make: async () => Locator}. */
function ladder(t, scope, page, cfg) {
  const L = [];
  const text = t.value;
  const textLadder = (value, isFuzzy) => {
    if (!isFuzzy) {
      L.push({ how: 'text', make: async () => scope.getByText(value, { exact: true }) });
      L.push({ how: 'text~sub', make: async () => scope.getByText(value) });
    }
    L.push({ how: 'text~fuzzy', make: async () => {
      const tag = `f${++hitSeq}`;
      const root = scope === page ? null : await scope.elementHandle().catch(() => null);
      await markFuzzy(root, page, value, tag);
      return page.locator(`[data-mfy-hit="${tag}"]`);
    } });
  };
  switch (t.kind) {
    case 'text': textLadder(text, t.fuzzy); break;
    case 'regex': L.push({ how: 'regex', make: async () => scope.getByText(new RegExp(t.value, t.flags)) }); break;
    case 'id':
      for (const a of ['data-testid', 'data-test', 'data-tour', 'data-cy', 'id', 'name'])
        L.push({ how: a, make: async () => scope.locator(`[${a}="${t.value}"]`) });
      break;
    case 'css': L.push({ how: 'css', make: async () => scope.locator(t.value) }); break;
    case 'i18n': {
      const v = typeof cfg.i18n === 'function' ? cfg.i18n(t.value) : cfg.i18n?.[t.value];
      if (!v) throw new Error(`t:${t.value} is not in config.i18n`);
      textLadder(v, false);
      break;
    }
    case 'macro': {
      const user = cfg.macros?.[t.name];
      if (user) { L.push({ how: `macro:${t.name}`, make: async () => user(scope, t.value, { page, fuzzy: t.fuzzy }) }); break; }
      if (ROLES.has(t.name)) {
        if (t.value == null) { L.push({ how: `role:${t.name}`, make: async () => scope.getByRole(t.name) }); break; }
        if (!t.fuzzy) {
          L.push({ how: `role:${t.name}`, make: async () => scope.getByRole(t.name, { name: t.value, exact: true }) });
          L.push({ how: `role:${t.name}~sub`, make: async () => scope.getByRole(t.name, { name: t.value }) });
        }
        L.push({ how: `role:${t.name}~fuzzy`, make: async () => scope.getByRole(t.name, { name: new RegExp(t.value.split('').map(escapeRe).join('\\s*'), 'i') }) });
        break;
      }
      const helpers = {
        label: () => scope.getByLabel(t.value),
        placeholder: () => scope.getByPlaceholder(t.value),
        alt: () => scope.getByAltText(t.value),
        title: () => scope.getByTitle(t.value),
        testid: () => scope.getByTestId(t.value),
      };
      if (helpers[t.name]) { L.push({ how: t.name, make: async () => helpers[t.name]() }); break; }
      if (t.name === 'box' || t.name === 'card' || t.name === 'panel' || t.name === 'section') {
        L.push({ how: `box`, make: async () => {
          const tag = `b${++hitSeq}`;
          const root = scope === page ? null : await scope.elementHandle().catch(() => null);
          await markFuzzy(root, page, t.value, tag, { container: true });
          return page.locator(`[data-mfy-hit="${tag}"]`);
        } });
        break;
      }
      throw new Error(`unknown macro "${t.name}" — define it in manualify.config.mjs → macros, or use a role (${[...ROLES].slice(0, 8).join(', ')}…)`);
    }
    default: throw new Error(`can't locate a ${t.kind} target`);
  }
  return L;
}

/**
 * Resolve a parsed target to a visible Locator, retrying until `timeout` ms.
 * Returns { locator, how, count } or throws with a readable message.
 */
export async function resolve(page, t, cfg = {}, { timeout = 8000, scope = null, visible = true } = {}) {
  if (t.kind === 'point') return { point: { x: t.x, y: t.y }, how: 'xy', count: 1 };
  if (t.kind === 'var') throw new Error(`$${t.value} is not set`);
  const deadline = Date.now() + timeout;
  let base = scope || page;
  let lastErr;
  for (;;) {
    try {
      if (t.within) {
        const w = await resolve(page, t.within, cfg, { timeout: 0, scope, visible });
        base = w.locator;
      }
      for (const step of ladder(t, base, page, cfg)) {
        let loc = await step.make();
        if (visible) loc = loc.filter({ visible: true });
        const count = await loc.count();
        if (!count) continue;
        if (t.nth === -1) loc = loc.last();
        else if (t.nth) { if (t.nth > count) continue; loc = loc.nth(t.nth - 1); }
        else loc = loc.first();
        return { locator: loc, how: step.how, count };
      }
    } catch (e) { lastErr = e; if (/unknown macro|not in config|not set/.test(e.message)) throw e; }
    if (Date.now() >= deadline) break;
    await sleep(200);
  }
  const err = new Error(`not found${lastErr ? ` (${lastErr.message.split('\n')[0]})` : ''}`);
  err.notFound = true;
  throw err;
}

/** Bounding rect (viewport CSS px) of one or more resolved targets; union for several. */
export async function rectOf(page, targets, cfg, opts = {}) {
  const list = Array.isArray(targets) ? targets : [targets];
  let r = null;
  for (const t of list) {
    const parts = t.kind === 'union' ? t.parts : [t];
    for (const p of parts) {
      const res = await resolve(page, p, cfg, opts);
      const b = res.point ? { x: res.point.x - 1, y: res.point.y - 1, width: 2, height: 2 } : await res.locator.boundingBox();
      if (!b) throw Object.assign(new Error('has no box (hidden or detached)'), { notFound: true });
      r = r ? union(r, b) : b;
    }
  }
  return r;
}

export function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
