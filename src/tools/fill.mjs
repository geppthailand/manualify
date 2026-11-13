/**
 * Fill-the-blanks assistant: run the script (test mode, fast) up to the first line with a
 * <<blank>>, then list what's on screen that looks like the blank's description. The LLM
 * pastes a target and reruns — no screenshots, a few hundred tokens per blank.
 */
import fs from 'node:fs';
import { runSession, loadScript } from '../runtime/session.mjs';
import { walk } from '../mul/parse.mjs';
import { inventory, formatInventory } from '../runtime/inspect.mjs';

const BLANK = /<<([^>]*)>>/;

function firstBlank(doc) {
  let hit = null;
  walk(doc.steps, (n) => {
    if (hit) return;
    const strs = [JSON.stringify(n.target || ''), JSON.stringify(n.targets || ''), JSON.stringify(n.opts || {}), n.value || '', n.verb === 'go' ? n.text || '' : ''];
    for (const s of strs) { const m = String(s).match(BLANK); if (m) { hit = { line: n.line, verb: n.verb, desc: m[1] }; return; } }
  });
  return hit;
}

export async function fillAssist(file, cfg, { log = () => {} } = {}) {
  const doc = loadScript(file, cfg);
  const blank = firstBlank(doc);
  if (!blank) return `no <<blanks>> left in ${file} — run \`manualify vibe ${file}\``;
  const top = doc.steps.find((n) => n.line >= blank.line) || doc.steps[doc.steps.length - 1];
  let report = '';
  await runSession({
    file, cfg, mode: 'test', log: () => {}, stopAt: top.line,
    atStop: async (page) => {
      const words = blank.desc.split(/[\s,/]+/).filter((w) => w.length > 2);
      const seen = new Map();
      for (const q of [blank.desc, ...words]) for (const it of await inventory(page, { near: q, limit: 8 })) if (!seen.has(it.target)) seen.set(it.target, it);
      const near = [...seen.values()].slice(0, 12);
      const all = await inventory(page, { limit: 40 });
      report = [`line ${blank.line} ${blank.verb} <<${blank.desc}>>  — page ${page.url()}`,
        near.length ? `looks like:\n${formatInventory(near)}` : 'nothing looks like it; everything on screen:',
        near.length ? '' : formatInventory(all)].filter(Boolean).join('\n');
    },
  });
  return report || `stopped before line ${blank.line}, but the page couldn't be inspected`;
}
