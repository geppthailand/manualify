/**
 * Vibe check: judge a script BEFORE recording it. Pure function over the parsed script and
 * the shared timing model — no browser, no video, no tokens spent looking at frames.
 *
 * Output: { score 0–100, seconds, stats, findings: [{level, line, rule, msg}], strip }
 *   error  = will look broken / can't run          (−15)
 *   warn   = will look worse than it should         (−5)
 *   info   = worth a glance                         (−1)
 */
import { walk, showTarget } from './parse.mjs';
import { DEFAULTS, simulate, captionChars } from './timing.mjs';

const ACTIONS = new Set(['click', 'type', 'pick', 'drag', 'key', 'hover']);
const MOTION = new Set(['click', 'hover', 'point', 'type', 'pick', 'drag', 'scroll', 'zoom', 'pan', 'unzoom', 'key', 'spot', 'go']);

export function vibe(doc, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const findings = [];
  const add = (level, line, rule, msg) => findings.push({ level, line, rule, msg });

  for (const e of doc.errors || []) add('error', e.line, 'parse', e.message.replace(/^line \d+: /, ''));

  const sim = simulate(doc.steps, c);
  const visible = sim.items.filter((i) => !i.cut);
  const seconds = sim.seconds;

  // ---- budget
  const budget = doc.meta.budget;
  if (budget) {
    const r = seconds / budget;
    if (r > 1.6 || r < 0.4) add('warn', 0, 'budget', `≈${seconds.toFixed(0)} s vs budget ${budget} s — split the topic or add substance`);
    else if (r > 1.25 || r < 0.6) add('info', 0, 'budget', `≈${seconds.toFixed(0)} s vs budget ${budget} s`);
  }

  // ---- captions
  for (const cap of sim.captions) {
    const n = captionChars(cap.text);
    if (n > c.maxCaption) add('warn', cap.line, 'caption-long', `${n} chars — split into two captions (max ${c.maxCaption})`);
    if (/<<.*>>/.test(cap.text)) add('error', cap.line, 'blank', 'caption still has a <<blank>>');
  }
  const firstCap = sim.captions[0];
  if (!firstCap) add('warn', 0, 'no-captions', 'no `say` at all — viewers get no explanation');
  else if (firstCap.t0 > 3) add('warn', firstCap.line, 'silent-open', `first caption appears at ${firstCap.t0.toFixed(1)} s — open with what this clip shows`);

  // unexplained stretches: edited time between caption starts
  const starts = sim.captions.map((x) => x.t0).concat([seconds]);
  let prev = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] - prev > 12) add('warn', sim.captions[i - 1]?.line || 0, 'unexplained', `${(starts[i] - prev).toFixed(0)} s with the same caption (or none) — add a \`say\` mid-way`);
    prev = starts[i];
  }

  // ---- dead air: visible stretches with no motion and no new caption
  let idle = 0;
  let idleFrom = null;
  for (const it of visible) {
    const d = it.ed1 - it.ed0;
    const moving = MOTION.has(it.node.verb) || it.node.verb === 'say';
    if (!moving && d > 0) { idle += d; idleFrom = idleFrom ?? it.node.line; } else {
      if (idle > 4) add('warn', idleFrom, 'dead-air', `${idle.toFixed(1)} s with nothing moving — cut it, speed it up, or point at something`);
      idle = 0; idleFrom = null;
    }
    if (it.node.verb === 'read' && d > 5) add('info', it.node.line, 'long-read', `caption needs ${d.toFixed(1)} s of reading with nothing happening — show something while it's up`);
  }
  if (idle > 4) add('warn', idleFrom, 'dead-air', `${idle.toFixed(1)} s with nothing moving at the end`);

  // ---- zoom
  let zoomed = null;
  const zooms = [];
  for (const it of visible) {
    const v = it.node.verb;
    if (v === 'zoom') {
      if (zoomed) add('info', it.node.line, 'zoom-chain', 'zoom while zoomed — fine for a pan, otherwise `unzoom` first');
      zoomed = it; zooms.push(it);
      const next = visible.find((x) => x.ed0 >= it.ed1 && x !== it && ['point', 'click', 'say', 'type', 'pick', 'drag', 'spot', 'hover'].includes(x.node.verb));
      if (!next || next.ed0 - it.ed1 > 3) add('info', it.node.line, 'zoom-empty', 'zoom with nothing pointed at or said soon after — why zoom here?');
    } else if (v === 'unzoom') {
      if (!zoomed) add('error', it.node.line, 'unzoom', '`unzoom` without a zoom');
      else if (it.ed0 - zoomed.ed1 > 15) add('warn', zoomed.node.line, 'zoom-long', `zoomed for ${(it.ed0 - zoomed.ed1).toFixed(0)} s — viewers lose context; unzoom sooner`);
      zoomed = null;
    }
  }
  if (seconds > 10 && zooms.length / (seconds / 60) > 6) add('warn', 0, 'zoom-dizzy', `${zooms.length} zooms in ${seconds.toFixed(0)} s — too busy`);

  // ---- targets & verification (walk everything, including setup)
  let actions = 0;
  let verified = 0;
  let expects = 0;
  const checkTarget = (t, line) => {
    if (!t) return;
    for (const x of Array.isArray(t) ? t : [t]) {
      if (x.kind === 'blank' || (typeof x.value === 'string' && /<<.*>>/.test(x.value))) add('error', line, 'blank', `target ${showTarget(x)} not filled in`);
      if (x.kind === 'css' && (/(\.[\w-]+.*){3,}|nth-child|>\s*div|^div/.test(x.value)))
        add('warn', line, 'fragile', `css(${x.value}) breaks on restyles — prefer #testid, role:"name" or an adapter macro`);
      if (x.kind === 'point') add('warn', line, 'fragile', `${showTarget(x)} is a raw coordinate — breaks on any layout change`);
      if ((x.kind === 'text' || x.kind === 'macro') && captionChars(x.value) > 40) add('info', line, 'fragile', `long text target ${showTarget(x)} — copy edits will break it`);
      if (x.nth && x.nth > 2) add('info', line, 'fragile', `${showTarget(x)} relies on position`);
      if (x.within) checkTarget(x.within, line);
      if (x.kind === 'union') checkTarget(x.parts, line);
    }
  };
  walk([...doc.setup, ...doc.steps], (n) => {
    checkTarget(n.target, n.line);
    checkTarget(n.targets, n.line);
    checkTarget(n.opts?.to, n.line);
    checkTarget(n.opts?.clip, n.line);
    for (const e of n.expects || []) { expects++; checkTarget(e.target, n.line); }
    if (ACTIONS.has(n.verb)) { actions++; if (n.expects?.length) verified++; }
    for (const [k, val] of Object.entries({ text: n.verb === 'say' ? '' : n.text, value: n.value, ...(n.opts || {}) }))
      if (typeof val === 'string' && /<<.*>>/.test(val)) add('error', n.line, 'blank', `${k} still has a <<blank>>`);
  });
  const assertMode = doc.meta.assert || 'warn';
  if (assertMode !== 'off' && actions >= 3 && expects === 0)
    add('warn', 0, 'untested', `${actions} actions and no \`expect\` — add \`=> expect …\` so a take that silently didn't work fails`);
  else if (assertMode !== 'off' && actions - verified > 4)
    add('info', 0, 'untested', `${actions - verified} of ${actions} actions have no explicit expectation (implicit proofs still run)`);

  // ---- structure
  const sections = doc.steps.filter((s) => s.verb === 'section').length;
  if (seconds > 45 && !sections) add('info', 0, 'sections', 'long clip with no `== section` — chapters help viewers scan');
  walk(doc.steps, (n, anc) => {
    const inCut = anc.some((a) => a.verb === 'cut');
    if (!inCut && n.verb === 'go') add('info', n.line, 'load-on-camera', '`go` outside `cut` — the page load will be filmed');
    if (!inCut && n.verb === 'wait' && (n.until === 'ready' || n.until === 'network')) add('info', n.line, 'load-on-camera', `\`wait ${n.until}\` outside \`cut\``);
  });
  const lastVisible = [...visible].reverse().find((x) => x.node.verb !== 'read');
  if (lastVisible && ACTIONS.has(lastVisible.node.verb) && !(lastVisible.node.opts?.hold > 1))
    add('info', lastVisible.node.line, 'abrupt-end', 'clip ends right on an action — hold on the result or close with a `say`');

  // ---- score
  const w = { error: 15, warn: 5, info: 1 };
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + w[f.level], 0));
  findings.sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.level] - { error: 0, warn: 1, info: 2 }[b.level] || a.line - b.line));
  return {
    score,
    seconds: +seconds.toFixed(1),
    stats: { captions: sim.captions.length, actions, expects, zooms: zooms.length, sections, cutSeconds: +(sim.rawSeconds - visible.reduce((s, i) => s + (i.t1 - i.t0), 0)).toFixed(1) },
    findings,
    strip: strip(sim, seconds),
  };
}

/** One character per second of edited time: S caption change, c click, t type, p point, z zoom, d drag, ~ scroll, . idle. */
function strip(sim, seconds) {
  const n = Math.max(1, Math.ceil(seconds));
  const cells = Array(n).fill('.');
  const mark = { click: 'c', type: 't', pick: 'k', point: 'p', spot: 'p', hover: 'h', zoom: 'z', pan: 'z', unzoom: 'u', drag: 'd', scroll: '~', key: 'k', go: 'g' };
  for (const it of sim.items) {
    if (it.cut) continue;
    const ch = mark[it.node.verb];
    if (!ch) continue;
    for (let s = Math.floor(it.ed0); s < Math.min(n, Math.ceil(it.ed1)); s++) if (cells[s] === '.') cells[s] = ch;
  }
  for (const cap of sim.captions) { const s = Math.min(n - 1, Math.floor(cap.t0)); cells[s] = 'S'; }
  return cells.join('');
}

/** Compact text report (what the CLI prints). */
export function formatVibe(file, v) {
  const lines = [`${file}  vibe ${v.score}/100  ≈${v.seconds}s  captions ${v.stats.captions} · actions ${v.stats.actions} · expects ${v.stats.expects} · zooms ${v.stats.zooms} · cut ${v.stats.cutSeconds}s`];
  lines.push(`  ${v.strip}`);
  for (const f of v.findings) lines.push(`  ${f.level.padEnd(5)} ${String(f.line || '-').padStart(3)}  ${f.rule}: ${f.msg}`);
  return lines.join('\n');
}
