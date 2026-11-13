/**
 * Page inventory as compact text — what an LLM needs to write targets WITHOUT a screenshot.
 *
 *   button:"Export PDF"   #export-pdf    (1604,92 132×36)
 *   tab:"Settings"                        (420,180 96×40)
 *   textbox:"Search"      placeholder     (60,140 300×36)
 *
 * Each line's first column is a ready-to-paste .mul target (best available: testid, then
 * role + name, then text). `near` narrows to things that look like a given text.
 */
import { FUZZY_SRC, fuzzy } from './locate.mjs';

export async function inventory(page, { limit = 120, near = null } = {}) {
  const items = await page.evaluate(({ FUZZY }) => {
    const fz = (0, eval)(FUZZY);
    const sel = 'a,button,input,select,textarea,summary,[role],[onclick],[tabindex]:not([tabindex="-1"]),h1,h2,h3,h4,label,[data-testid],[data-test],[data-tour],[data-cy],th,[contenteditable="true"]';
    const implicit = { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', SUMMARY: 'button', TH: 'columnheader', LABEL: 'label' };
    const inputRole = (el) => ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', range: 'slider', search: 'searchbox' }[el.type] || 'textbox');
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('mfy-overlay')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      const role = el.getAttribute('role') || (el.tagName === 'INPUT' ? inputRole(el) : implicit[el.tagName]) || 'generic';
      const name = (el.getAttribute('aria-label') || (el.labels && el.labels[0]?.innerText) || el.innerText || el.getAttribute('placeholder') ||
        el.getAttribute('title') || el.getAttribute('alt') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-tour') || el.getAttribute('data-cy') || '';
      if (!name && !testid) continue;
      const key = `${role}|${name}|${Math.round(r.x)}|${Math.round(r.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role, name, testid, id: el.id || '', placeholder: !!el.getAttribute('placeholder') && !el.getAttribute('aria-label'),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), fz: fz(name) });
    }
    return out;
  }, { FUZZY: FUZZY_SRC });

  let list = items;
  if (near) {
    const want = fuzzy(near);
    const score = (it) => {
      if (!want) return 0;
      if (it.fz === want) return 3;
      if (it.fz.includes(want) || (it.fz && want.includes(it.fz))) return 2;
      return similarity(it.fz, want) > 0.55 ? 1 : 0;
    };
    list = items.map((it) => ({ ...it, s: score(it) })).filter((it) => it.s > 0).sort((a, b) => b.s - a.s);
  } else list = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  return list.slice(0, limit).map((it) => ({ ...it, target: bestTarget(it) }));
}

const ROLE_OK = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'textbox', 'combobox', 'heading', 'option', 'switch', 'slider', 'searchbox', 'columnheader', 'row', 'cell', 'dialog', 'listitem']);

export function bestTarget(it) {
  if (it.testid) return `#${it.testid}`;
  const q = JSON.stringify(it.name);
  if (ROLE_OK.has(it.role) && it.name) return `${it.role}:${q}`;
  if (it.role === 'label') return `label:${q}`;
  return it.name ? q : `#${it.id}`;
}

export function formatInventory(list) {
  const w = Math.min(46, Math.max(...list.map((i) => i.target.length), 10));
  return list.map((i) => `${i.target.padEnd(w)}  ${(i.testid && !i.target.startsWith('#') ? '#' + i.testid : i.id && !i.testid ? 'id=' + i.id : '').padEnd(14)}(${i.x},${i.y} ${i.w}×${i.h})`).join('\n');
}

/** Dice coefficient on bigrams — cheap "looks like" score for near-miss suggestions. */
function similarity(a, b) {
  if (!a || !b) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a); const B = grams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / Math.max(1, a.length + b.length - 2);
}
