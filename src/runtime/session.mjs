/**
 * One run of a script: browser + guards + login + setup + player (+ recorder) → take.json.
 *
 * Take layout (out/takes/<id>/<stamp>/):
 *   chunks/0000.mp4 …   10 s H.264 chunks (keyframe each second)
 *   chunks.csv          chunk index (file,start,end)
 *   take.json           meta + timeline events + steps + proof/assert results
 *   fail.json / fail-<line>.jpg   when a step failed
 * out/takes/<id>/latest.json points at the newest take.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parse, MulError, showTarget } from '../mul/parse.mjs';
import { Recorder } from '../record/recorder.mjs';
import { Player, StepError } from './player.mjs';

const OVERLAY = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'overlay.js'), 'utf8');

/** Read a script and inline `use <macro> args` (macros/<name>.mul, $1…$n substituted). */
export function loadScript(file, cfg, depth = 0) {
  const src = fs.readFileSync(file, 'utf8');
  const doc = parse(src, { file });
  const expand = (nodes) => {
    const out = [];
    for (const n of nodes) {
      if (n.verb === 'use') {
        if (depth > 5) throw new MulError('macros nested too deep', n.line);
        const mf = [path.join(cfg.root, cfg.macroDir, `${n.name}.mul`), path.join(path.dirname(file), 'macros', `${n.name}.mul`)].find(fs.existsSync);
        if (!mf) throw new MulError(`macro "${n.name}" not found`, n.line, `create ${cfg.macroDir}/${n.name}.mul`);
        let body = fs.readFileSync(mf, 'utf8');
        n.params.forEach((p, i) => { body = body.replaceAll(`$${i + 1}`, p); });
        const sub = parse(body, { file: mf });
        // macro lines report the CALLER's line so failure cards point at the script you wrote
        const relabel = (xs) => xs.map((x) => ({ ...x, line: n.line, from: `${path.basename(mf)}:${x.line}`, children: x.children ? relabel(x.children) : undefined }));
        out.push(...expand(relabel(sub.steps)));
        continue;
      }
      if (n.children) n.children = expand(n.children);
      out.push(n);
    }
    return out;
  };
  doc.setup = expand(doc.setup);
  doc.steps = expand(doc.steps);
  return doc;
}

export function scriptId(doc, file) {
  return String(doc.meta.id || path.basename(file).replace(/\.mul$/, '')).replace(/[^\w.-]+/g, '_');
}

/**
 * @param {object} o
 * @param {string} o.file          .mul path
 * @param {object} o.cfg           loaded config
 * @param {'record'|'test'} [o.mode]
 * @param {number|string} [o.from] resume at this line (or mark name) on top of the latest take
 * @param {boolean} [o.headed]
 * @param {(s:string)=>void} [o.log]
 */
export async function runSession({ file, cfg, mode = 'record', from = null, headed = false, log = console.log, stopAt = null, atStop = null, verbose = false }) {
  const doc = loadScript(file, cfg);
  const id = scriptId(doc, file);
  const takesRoot = path.join(cfg.outDir, 'takes', id);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const takeDir = mode === 'record' ? path.join(takesRoot, stamp) : null;
  if (takeDir) fs.mkdirSync(takeDir, { recursive: true });

  // resume point
  let resume = null;
  if (from != null && mode === 'record') {
    const latest = readLatest(takesRoot);
    if (!latest) throw new Error(`--from needs an earlier take of ${id}; record it once first`);
    const prev = JSON.parse(fs.readFileSync(path.join(latest, 'take.json'), 'utf8'));
    const line = /^\d+$/.test(String(from)) ? +from : findMark(doc.steps, String(from));
    if (!line) throw new Error(`no line or mark "${from}" in ${file}`);
    const startedAt = prev.steps.find((s) => s.line >= line);
    const at = Math.min(startedAt ? startedAt.t0 : Infinity, prev.failed?.t ?? Infinity, prev.duration);
    resume = { of: path.relative(takeDir, latest), fromLine: line, at, ofResume: prev.resume || null };
    log(`↪ resuming ${id} at line ${line} (keeping ${at.toFixed(1)} s of ${path.basename(latest)})`);
  }

  if (doc.meta.state && cfg.state?.restore) { log(`· restoring state "${doc.meta.state}"`); await cfg.state.restore(doc.meta.state); }

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: cfg.viewport, deviceScaleFactor: cfg.scale, locale: cfg.locale, timezoneId: cfg.timezoneId,
    colorScheme: cfg.colorScheme, acceptDownloads: true, baseURL: cfg.baseURL,
  });
  await context.addInitScript({ content: `window.__mfyTheme = ${JSON.stringify(cfg.theme)};\n${OVERLAY}` });

  // network guard: the page may only talk to the app (and listed hosts); canned routes first
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', new URL(cfg.baseURL).hostname, ...cfg.allow]);
  const blocked = new Map();
  for (const r of cfg.routes || []) {
    await context.route(r.url, (route) => {
      if (r.json !== undefined) return route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r.json) });
      if (r.file) return route.fulfill({ status: r.status || 200, path: path.resolve(cfg.root, r.file) });
      return route.fulfill({ status: r.status || 204, body: r.body || '' });
    });
  }
  await context.route(/^https?:\/\//, (route) => {
    const host = new URL(route.request().url()).hostname;
    if (allowed.has(host) || [...allowed].some((a) => a.startsWith('*.') && host.endsWith(a.slice(1)))) return route.fallback();
    blocked.set(host, (blocked.get(host) || 0) + 1);
    return route.abort('blockedbyclient');
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 300)}`));

  const assertLevel = doc.meta.assert || cfg.assert;
  const player = new Player(page, cfg, { mode: mode === 'record' ? 'replay' : mode, takeDir, log, assertLevel });
  player.consoleErrors = consoleErrors;
  let recorder = null;
  let failed = null;
  let card = null;
  const t0 = Date.now();
  try {
    if (cfg.login && (doc.meta.user || cfg.defaultUser)) {
      const name = doc.meta.user || cfg.defaultUser;
      await cfg.login(page, cfg.users?.[name] ?? name, { baseURL: cfg.baseURL, config: cfg, name });
    }
    if (doc.meta.start) await page.goto(new URL(doc.meta.start, cfg.baseURL).href, { waitUntil: 'domcontentloaded' });
    if (cfg.ready && doc.meta.start) await cfg.ready(page);
    for (const n of doc.setup) await player.run(n);

    if (resume) {
      // fast-forward everything before the resume line without filming it
      player.replaying = true;
      for (const n of doc.steps) { if (n.line >= resume.fromLine) break; await player.run(n); }
      player.replaying = false;
    }

    if (mode === 'record') {
      await page.evaluate(([x, y]) => window.__mfy && window.__mfy.cursor(x, y), [cfg.viewport.width * 0.5, cfg.viewport.height * 0.62]).catch(() => {});
      recorder = new Recorder(page, { dir: takeDir, frame: { w: Math.round(cfg.viewport.width * cfg.scale), h: Math.round(cfg.viewport.height * cfg.scale) }, fps: cfg.fps, chunkSeconds: cfg.chunkSeconds, encoder: cfg.encoder });
      await recorder.start();
      player.rec = recorder;
      player.mode = 'record';
      if (resume) { player.emit('camera', { rect: player.cam, dur: 0 }); }
    }
    const rest = resume ? doc.steps.filter((n) => n.line >= resume.fromLine) : doc.steps;
    for (const n of rest) {
      if (stopAt && n.line >= stopAt) { if (atStop) await atStop(page, n); break; }
      if (verbose) log(`  ${String(n.line).padStart(3)} ${n.verb}${n.target ? ' ' + showTarget(n.target) : n.text ? ' ' + n.text.slice(0, 50) : ''}`);
      await player.run(n);
    }
    await player.flushCaption();
    if (player.live) { player.emit('caption', { text: '' }); await player.pause(0.6); }
  } catch (e) {
    if (!(e instanceof StepError) && !(e instanceof MulError)) failed = { line: null, message: e.message.split('\n')[0] };
    else failed = { line: e.node?.line ?? e.line, message: e.message };
    // resume point = where the failing top-level step STARTED, so its wasted attempt isn't kept
    const top = doc.steps.filter((n) => n.line <= (failed.line ?? Infinity)).pop();
    const st = top && player.steps.find((x) => x.line === top.line);
    failed.t = player.failedAt && (!top || player.failedAt.line >= top.line) ? (st ? st.t0 : player.failedAt.t0) : player.now();
    if (top && player.failedAt) failed.t = Math.min(failed.t, player.failedAt.t0);
    card = await player.failureCard(e instanceof StepError ? e : new StepError({ line: failed.line }, failed.message));
  }
  let chunks = [];
  if (recorder) chunks = await recorder.stop().catch((e) => { log(`recorder: ${e.message}`); return []; });
  await browser.close();

  const take = {
    manualify: 1, id, title: doc.meta.title || id, file: path.resolve(file), mode,
    startedAt: new Date(t0).toISOString(), wallSeconds: +((Date.now() - t0) / 1000).toFixed(1),
    viewport: cfg.viewport, scale: cfg.scale, fps: cfg.fps,
    frame: { w: Math.round(cfg.viewport.width * cfg.scale), h: Math.round(cfg.viewport.height * cfg.scale) },
    duration: recorder ? recorder.stats().seconds : 0,
    recorder: recorder ? recorder.stats() : null,
    chunks, events: player.events, steps: player.steps, results: player.results, issues: player.issues,
    blocked: Object.fromEntries(blocked), consoleErrors: consoleErrors.slice(0, 50), failed, resume, meta: doc.meta,
  };
  if (takeDir) {
    fs.writeFileSync(path.join(takeDir, 'take.json'), JSON.stringify(take, null, 1));
    fs.writeFileSync(path.join(takesRoot, 'latest.json'), JSON.stringify({ dir: takeDir }));
  }
  return { ok: !failed, take, takeDir, card };
}

export function readLatest(takesRoot) {
  const p = path.join(takesRoot, 'latest.json');
  if (!fs.existsSync(p)) return null;
  const { dir } = JSON.parse(fs.readFileSync(p, 'utf8'));
  return fs.existsSync(path.join(dir, 'take.json')) ? dir : null;
}

function findMark(steps, name) {
  for (const n of steps) {
    if (n.verb === 'mark' && n.name === name) return n.line;
    if (n.children) { const l = findMark(n.children, name); if (l) return l; }
  }
  return null;
}


export { StepError };
