/**
 * Player: runs a parsed .mul script against a live page and writes the timeline.
 *
 * Modes
 *   record  real pacing, overlay animations, recorder running, timeline events
 *   test    same actions + proofs + expectations, no recording, no pacing (acceptance test)
 *   replay  used by `--from`: fast-forward the steps before the resume point (no checks)
 *
 * Every action carries implicit PROOFS (target visible, not covered, on camera, had an
 * effect, value really typed, element really moved). Explicit `expect`s add assertions.
 * A failing step produces a failure card (screenshot + look-alike targets + resume hint).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolve, rectOf, union } from './locate.mjs';
import { inventory, formatInventory } from './inspect.mjs';
import { showTarget } from '../mul/parse.mjs';
import { DEFAULTS as TIMING, readSeconds, speedOf } from '../mul/timing.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export class StepError extends Error {
  constructor(node, msg, extra = {}) {
    super(msg);
    this.node = node;
    Object.assign(this, extra);
  }
}

export class Player {
  constructor(page, cfg, { mode = 'record', recorder = null, takeDir = null, log = () => {}, assertLevel = 'warn' } = {}) {
    this.page = page;
    this.cfg = cfg;
    this.T = { ...TIMING, readingSpeed: cfg.readingSpeed || TIMING.readingSpeed };
    this.mode = mode;
    this.rec = recorder;
    this.takeDir = takeDir;
    this.log = log;
    this.assertLevel = assertLevel;
    this.events = [];
    this.steps = [];
    this.results = { proofs: { pass: 0, warn: 0, fail: 0 }, asserts: { pass: 0, warn: 0, fail: 0 } };
    this.issues = [];
    const { width, height } = cfg.viewport;
    this.full = { x: 0, y: 0, width, height };
    this.cam = { ...this.full };
    this.cap = null;
    this.cutDepth = 0; this.cutStart = 0; this.cutAcc = 0;
    this.fastFactor = 0; this.fastStart = 0; this.fastSaved = 0;
    this.boxes = 0;
    this.clock0 = performance.now();
    this.requests = 0;
    page.on('request', () => { this.requests++; });
  }

  // ------------------------------------------------------------ clocks & events

  now() { return this.rec ? this.rec.now() : (performance.now() - this.clock0) / 1000; }
  /** Viewer's clock: raw time minus cut spans, with fast spans compressed. */
  edNow() {
    const t = this.now();
    let ed = t - this.cutAcc - this.fastSaved;
    if (this.cutDepth) ed -= t - this.cutStart;
    else if (this.fastFactor) ed -= (t - this.fastStart) * (1 - 1 / this.fastFactor);
    return ed;
  }
  emit(type, data = {}) { if (this.mode === 'record') this.events.push({ t: +this.now().toFixed(3), type, ...data }); }
  get live() { return this.mode === 'record'; }
  get quick() { return this.mode !== 'record' || this.cutDepth > 0; }
  async pause(sec) { if (this.live) await sleep(sec * 1000 * (this.cutDepth ? 0.25 : 1)); }

  // ------------------------------------------------------------ running

  async runAll(steps, { from = null } = {}) {
    for (const n of steps) {
      if (from && n.line < from && !this.replaying) continue;
      await this.run(n);
    }
    await this.flushCaption();
    if (this.live) { this.emit('caption', { text: '' }); await this.pause(0.5); }
  }

  async run(n) {
    const t0 = this.now();
    this.emit('step', { line: n.line, verb: n.verb, phase: 'start' });
    let ok = true;
    try {
      await this.exec(n);
    } catch (e) {
      ok = false;
      if (!(e instanceof StepError)) e = new StepError(n, e.message.split('\n')[0], { cause: e });
      if (!n.optional && this.failedAt == null) this.failedAt = { line: n.line, t0 };
      if (n.optional) {
        this.log(`  · ${n.line} ${n.verb}? skipped (${e.message})`);
        if (this.live) this.events.push({ t: +t0.toFixed(3), type: 'cutspan', t1: +this.now().toFixed(3), why: 'optional step skipped' });
      } else throw e;
    }
    this.emit('step', { line: n.line, verb: n.verb, phase: 'end', ok });
    if (this.mode !== 'replay') this.steps.push({ line: n.line, verb: n.verb, t0: +t0.toFixed(3), t1: +this.now().toFixed(3), ok });
  }

  async exec(n) {
    switch (n.verb) {
      case 'section': await this.clearBoxes(); this.emit('chip', { text: n.text }); return;
      case 'chip': this.emit('chip', { text: n.text }); return;
      case 'say': return this.say(n);
      case 'hush': await this.flushCaption(); this.emit('caption', { text: '' }); this.cap = null; return;
      case 'note': case 'mark': this.emit('mark', { name: n.name || n.text, line: n.line }); return;
      case 'go': return this.go(n);
      case 'wait': return this.wait(n);
      case 'click': return this.click(n);
      case 'hover': return this.hover(n);
      case 'point': case 'spot': return this.point(n);
      case 'type': return this.type(n);
      case 'pick': return this.pick(n);
      case 'key': for (const k of n.keys) { await this.page.keyboard.press(k); await this.pause(0.25); } await this.expectAll(n); return;
      case 'drag': return this.drag(n);
      case 'scroll': return this.scroll(n);
      case 'zoom': return this.zoom(n, false);
      case 'pan': return this.zoom(n, true);
      case 'unzoom': return this.unzoom(n);
      case 'shot': {
        const rect = n.opts.clip ? await rectOf(this.page, n.opts.clip, this.cfg, { timeout: this.cfg.locateTimeout }).catch(() => null) : null;
        this.emit('shot', { name: n.name, rect });
        return;
      }
      case 'unpoint': return this.clearBoxes();
      case 'expect': return this.expectAll(n);
      case 'cut': {
        this.emit('cut', { on: true });
        if (!this.cutDepth++) this.cutStart = this.now();
        try { for (const c of n.children) await this.run(c); } finally {
          if (!--this.cutDepth) this.cutAcc += this.now() - this.cutStart;
          this.emit('cut', { on: false });
        }
        return;
      }
      case 'fast': {
        const f = n.factor || 3;
        this.emit('fast', { factor: f });
        this.fastFactor = f; this.fastStart = this.now();
        try { for (const c of n.children) await this.run(c); } finally {
          this.fastSaved += (this.now() - this.fastStart) * (1 - 1 / f);
          this.fastFactor = 0;
          this.emit('fast', { factor: 0 });
        }
        return;
      }
      case 'quiet': { const q = this.noBoxes; this.noBoxes = true; try { for (const c of n.children) await this.run(c); } finally { this.noBoxes = q; } return; }
      case 'retry': {
        const times = n.times || 2;
        for (let attempt = 0; ; attempt++) {
          const t0 = this.now();
          try { for (const c of n.children) await this.run(c); return; } catch (e) {
            if (attempt + 1 >= times) throw e;
            this.log(`  ↻ ${n.line} retry ${attempt + 1}/${times - 1}: ${e.message}`);
            if (this.live) this.events.push({ t: +t0.toFixed(3), type: 'cutspan', t1: +this.now().toFixed(3), why: 'retried' });
          }
        }
      }
      case 'run': {
        // escape hatch: anything the language can't say lives in config.hooks (seed data, fake a camera, call an API)
        const fn = this.cfg.hooks?.[n.name];
        if (!fn) throw new StepError(n, `hook "${n.name}" is not in config.hooks`);
        await fn(this.page, { player: this, config: this.cfg, live: this.live }, ...n.params);
        await this.expectAll(n);
        return;
      }
      case 'use': throw new StepError(n, `macro "${n.name}" was not expanded (is ${this.cfg.macroDir}/${n.name}.mul there?)`);
      default: throw new StepError(n, `verb ${n.verb} is not supported by the player`);
    }
  }

  // ------------------------------------------------------------ captions

  async say(n) {
    if (this.mode === 'replay') { this.cap = null; return; }
    await this.flushCaption();
    const text = n.text || '';
    const top = n.mods.includes('top') || !!n.opts.top;
    this.emit('caption', { text, top, line: n.line });
    this.cap = { ed0: this.edNow(), need: Math.max(readSeconds(text, this.T), n.opts.hold || 0) };
    if (n.mods.includes('wait')) await this.flushCaption();
  }

  /** Wait until the current caption has been readable for its reading time (viewer's clock). */
  async flushCaption() {
    if (!this.cap || !this.live || this.cutDepth) return;
    const left = this.cap.ed0 + this.cap.need - this.edNow();
    if (left > 0) await sleep(left * 1000 * (this.fastFactor || 1));
  }

  // ------------------------------------------------------------ geometry

  async target(n, t = n.target, { timeout } = {}) {
    try {
      const res = await resolve(this.page, t, this.cfg, { timeout: timeout ?? (n.optional ? 1500 : this.cfg.locateTimeout) });
      if (/~/.test(res.how || '') && !t.fuzzy) this.note(n, 'proof', 'warn', `matched ${showTarget(t)} only via ${res.how} — tighten the target`);
      if (res.count > 1 && !t.nth) this.note(n, 'proof', 'info', `${showTarget(t)} matched ${res.count} elements; used the first`);
      return res;
    } catch (e) {
      if (e.notFound) throw new StepError(n, `${showTarget(t)} not found`, { target: t });
      throw new StepError(n, e.message, { target: t });
    }
  }

  async box(res) {
    if (res.point) return { x: res.point.x - 1, y: res.point.y - 1, width: 2, height: 2 };
    const b = await res.locator.boundingBox();
    if (!b) throw new Error('target has no box');
    return b;
  }

  /** Bring a target into the viewport (smooth, filmed) and keep it on camera. */
  async frame(n, res) {
    let b = await this.box(res);
    const vh = this.full.height;
    const vw = this.full.width;
    if (!res.point && (b.y < 0 || b.y + b.height > vh || b.x < 0 || b.x + b.width > vw)) {
      await res.locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }));
      await sleep(this.live ? 700 : 150);
      b = await this.box(res);
      this.note(n, 'proof', 'info', 'target was off-screen; scrolled it into view');
    }
    if (!inside(b, this.cam, 4)) {
      if (this.cam.width < this.full.width) {
        const next = this.camFor(b, { keepSize: b.width <= this.cam.width && b.height <= this.cam.height });
        this.note(n, 'proof', 'warn', 'target was off camera; the camera followed it');
        await this.setCam(next, 'fast');
      }
    }
    return b;
  }

  /** Throw if something else would receive a click at the target's centre. Returns a clickable point. */
  async clickPoint(n, res, b) {
    if (res.point) return res.point;
    const pts = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];
    for (const [fx, fy] of pts) {
      const x = b.x + b.width * fx;
      const y = b.y + b.height * fy;
      const ok = await res.locator.evaluate((el, [x, y]) => {
        const hit = window.__mfy ? window.__mfy.hit(x, y) : document.elementFromPoint(x, y);
        return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
      }, [x, y]).catch(() => false);
      if (ok) { if (fx !== 0.5 || fy !== 0.5) this.note(n, 'proof', 'info', 'centre was covered; clicked a visible part'); return { x, y }; }
    }
    const cover = await this.page.evaluate(([x, y]) => {
      const h = window.__mfy ? window.__mfy.hit(x, y) : document.elementFromPoint(x, y);
      return h ? `${h.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}${h.className && typeof h.className === 'string' ? '.' + h.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(h.innerText || '').trim().slice(0, 30)}"` : 'nothing';
    }, [b.x + b.width / 2, b.y + b.height / 2]);
    throw new StepError(n, `${showTarget(n.target)} is covered by ${cover}`);
  }

  async moveTo(x, y, speed = 'normal') {
    const sec = this.quick ? 0.12 : this.T.move[speed === 'snap' ? 'fast' : speed] ?? this.T.move.normal;
    await Promise.all([
      this.page.evaluate(([x, y, ms]) => window.__mfy && window.__mfy.move(x, y, ms), [x, y, sec * 1000]).catch(() => {}),
      this.page.mouse.move(x, y, { steps: this.quick ? 2 : 10 }),
    ]);
  }

  async clearBoxes() {
    if (!this.boxes) return;
    await this.page.evaluate(() => window.__mfy && window.__mfy.clearAll()).catch(() => {});
    this.boxes = 0;
  }

  async drawBox(rect, o) {
    if (this.noBoxes || this.mode === 'test') return;
    await this.page.evaluate(([r, o]) => window.__mfy && window.__mfy.box('b' + Date.now(), r, o), [rect, o]).catch(() => {});
    this.boxes++;
  }

  // ------------------------------------------------------------ camera

  camFor(rect, { pad = 40, scale = null, keepSize = false } = {}) {
    const { width: vw, height: vh } = this.full;
    const aspect = vw / vh;
    let w;
    if (keepSize) w = this.cam.width;
    else if (scale) w = vw / scale;
    else w = Math.max(rect.width + 2 * pad, (rect.height + 2 * pad) * aspect, vw / this.cfg.maxZoom);
    w = Math.min(vw, w);
    const h = w / aspect;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const x = Math.min(Math.max(0, cx - w / 2), vw - w);
    const y = Math.min(Math.max(0, cy - h / 2), vh - h);
    return { x: +x.toFixed(1), y: +y.toFixed(1), width: +w.toFixed(1), height: +h.toFixed(1) };
  }

  async setCam(rect, speed = 'normal') {
    const dur = this.T.zoomIn[speed] ?? this.T.zoomIn.normal;
    this.cam = rect;
    this.emit('camera', { rect, dur });
    await this.pause(dur);
  }

  async zoom(n, pan) {
    const rect = await rectOf(this.page, n.targets, this.cfg, { timeout: this.cfg.locateTimeout })
      .catch((e) => { throw new StepError(n, `${showTarget(n.targets)}: ${e.message}`); });
    const cam = this.camFor(rect, { pad: n.opts.pad ?? 40, scale: n.opts.scale, keepSize: pan && this.cam.width < this.full.width });
    if (rect.width > cam.width + 2 || rect.height > cam.height + 2) this.note(n, 'proof', 'warn', `zoom area doesn't fit at max zoom ×${this.cfg.maxZoom}; it will be cropped`);
    await this.setCam(cam, speedOf(n));
    if (n.opts.hold) await this.pause(n.opts.hold);
    await this.expectAll(n);
  }

  async unzoom(n) { await this.setCam({ ...this.full }, speedOf(n)); if (n.opts.hold) await this.pause(n.opts.hold); }

  // ------------------------------------------------------------ effects

  async effectMark() {
    const mut = await this.page.evaluate(() => window.__mfyMut || 0).catch(() => 0);
    return { mut, url: this.page.url(), req: this.requests };
  }

  async effectCheck(n, before, waitMs) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const now = await this.effectMark();
      if (now.mut > before.mut || now.url !== before.url || now.req > before.req) { this.results.proofs.pass++; return true; }
      if (Date.now() >= deadline) break;
      await sleep(100);
    }
    this.note(n, 'proof', 'warn', `${n.verb} ${showTarget(n.target)} had no visible effect (no DOM change, navigation or request)`);
    return false;
  }

  // ------------------------------------------------------------ actions

  async go(n) {
    const url = new URL(n.text, this.cfg.baseURL).href;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (this.cfg.ready) await this.cfg.ready(this.page);
    this.emit('nav', { url });
    await this.expectAll(n);
  }

  async wait(n) {
    if (n.seconds != null) return this.pause(n.seconds);
    if (n.until === 'ready') {
      if (this.cfg.ready) await this.cfg.ready(this.page);
      else await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      return;
    }
    if (n.until === 'idle' || n.until === 'network') return this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    if (n.until === 'visible') { await this.target(n, n.target, { timeout: 15000 }); return; }
    if (n.until === 'gone') {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const r = await resolve(this.page, n.target, this.cfg, { timeout: 0 }).catch(() => null);
        if (!r) return;
        await sleep(200);
      }
      throw new StepError(n, `${showTarget(n.target)} still visible after 15 s`);
    }
  }

  async hover(n) {
    const res = await this.target(n);
    const b = await this.frame(n, res);
    await this.moveTo(b.x + b.width / 2, b.y + b.height / 2, speedOf(n));
    this.emit('focus', { rect: b, kind: 'hover', line: n.line });
    await this.pause(n.opts.hold ?? 0.6);
    await this.expectAll(n);
  }

  async point(n) {
    const res = await this.target(n);
    const b = await this.frame(n, res);
    if (!n.opts.keep) await this.clearBoxes();
    await this.drawBox(b, { label: n.opts.label, badge: n.opts.badge, side: n.opts.side });
    if (n.verb === 'spot' || n.opts.spot) await this.page.evaluate((r) => window.__mfy && window.__mfy.spot(r), b).catch(() => {});
    // rest the arrow tip inside the lower-right of the target so it doesn't hide the text
    const x = b.x + Math.min(b.width * 0.85, b.width - 6);
    const y = b.y + Math.min(b.height * 0.8, b.height - 4);
    await this.moveTo(x, y, speedOf(n));
    this.emit('focus', { rect: b, kind: 'point', line: n.line });
    this.results.proofs.pass++;
    await this.pause(n.opts.hold ?? this.T.pointHold);
    await this.expectAll(n);
  }

  async click(n) {
    const res = await this.target(n);
    const b = await this.frame(n, res);
    const pt = await this.clickPoint(n, res, b);
    if (!n.opts.keep) await this.clearBoxes();
    if (n.opts.label || n.opts.badge) await this.drawBox(b, { label: n.opts.label, badge: n.opts.badge, side: n.opts.side });
    const dl = n.expects.some((e) => e.page === 'download') ? this.page.waitForEvent('download', { timeout: 10000 }) : null;
    await this.moveTo(pt.x, pt.y, speedOf(n));
    this.emit('focus', { rect: b, kind: 'click', line: n.line });
    await this.pause(this.T.clickPre);
    const before = await this.effectMark();
    const button = n.mods.includes('right') || n.opts.right ? 'right' : 'left';
    await this.page.evaluate(() => window.__mfy && window.__mfy.press(true)).catch(() => {});
    await this.page.mouse.click(pt.x, pt.y, { button, clickCount: n.mods.includes('double') || n.opts.double ? 2 : 1, delay: 70 });
    await this.page.evaluate(([x, y]) => window.__mfy && (window.__mfy.press(false), window.__mfy.ripple(x, y)), [pt.x, pt.y]).catch(() => {});
    if (n.opts.effect !== 'none') await this.effectCheck(n, before, 1500);
    if (dl) this.download = await dl.then(async (d) => {
      const file = path.join(this.takeDir || '.', 'downloads', d.suggestedFilename());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await d.saveAs(file);
      return file;
    }).catch(() => null);
    await this.pause(n.opts.hold ?? this.T.clickPost);
    if (!n.opts.keep && (n.opts.label || n.opts.badge)) await this.clearBoxes();
    await this.expectAll(n);
  }

  async type(n) {
    const res = await this.target(n);
    const b = await this.frame(n, res);
    const pt = await this.clickPoint(n, res, b);
    if (n.opts.label || n.opts.badge) { await this.clearBoxes(); await this.drawBox(b, { label: n.opts.label, badge: n.opts.badge }); }
    await this.moveTo(pt.x, pt.y, speedOf(n));
    this.emit('focus', { rect: b, kind: 'type', line: n.line });
    await this.pause(this.T.clickPre);
    await this.page.mouse.click(pt.x, pt.y, { delay: 50 });
    if (n.opts.clear !== false) { await this.page.keyboard.press('ControlOrMeta+A'); await this.page.keyboard.press('Backspace'); }
    await this.page.keyboard.type(String(n.value), { delay: this.quick ? 0 : this.T.typeDelay * 1000 });
    const got = await res.locator.evaluate((el) => (el.value !== undefined ? el.value : el.innerText) || '').catch(() => null);
    if (got != null && !String(got).includes(String(n.value))) this.note(n, 'proof', 'fail', `typed "${n.value}" but the field shows "${String(got).slice(0, 60)}"`);
    else this.results.proofs.pass++;
    await this.pause(n.opts.hold ?? 0.5);
    await this.expectAll(n);
  }

  async pick(n) {
    const res = await this.target(n);
    const b = await this.frame(n, res);
    const pt = await this.clickPoint(n, res, b);
    await this.moveTo(pt.x, pt.y, speedOf(n));
    this.emit('focus', { rect: b, kind: 'pick', line: n.line });
    const want = String(n.value);
    if (this.cfg.pick) {
      await this.cfg.pick(this.page, res.locator, want, { moveTo: (x, y) => this.moveTo(x, y), pause: (s) => this.pause(s) });
    } else if (await res.locator.evaluate((el) => el.tagName === 'SELECT')) {
      await this.page.mouse.click(pt.x, pt.y);
      await res.locator.selectOption({ label: want }).catch(() => res.locator.selectOption(want));
      await this.page.keyboard.press('Escape').catch(() => {});
    } else {
      await this.page.mouse.click(pt.x, pt.y, { delay: 50 });
      await this.pause(0.35);
      const opt = await this.findOption(want, res);
      if (!opt) throw new StepError(n, `option "${want}" not found after opening ${showTarget(n.target)}`);
      const ob = await opt.boundingBox();
      await this.moveTo(ob.x + ob.width / 2, ob.y + ob.height / 2, 'fast');
      await this.pause(0.2);
      await this.page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height / 2, { delay: 50 });
    }
    const shown = await res.locator.evaluate((el) => (el.tagName === 'SELECT' ? el.selectedOptions[0]?.text : (el.innerText || el.value || el.closest('[class*=select],[role=combobox]')?.innerText)) || '').catch(() => '');
    if (shown && !shown.toLowerCase().includes(want.toLowerCase())) this.note(n, 'proof', 'warn', `picked "${want}" but the control shows "${shown.slice(0, 40)}"`);
    else this.results.proofs.pass++;
    await this.pause(n.opts.hold ?? 0.4);
    await this.expectAll(n);
  }

  /** Find a visible option in an open dropdown; type to filter or scroll virtual lists if needed. */
  async findOption(want, res) {
    const page = this.page;
    const tryFind = async () => {
      for (const loc of [
        page.getByRole('option', { name: want, exact: true }), page.getByRole('option', { name: want }),
        page.getByRole('menuitem', { name: want }),
        page.locator('[role=listbox],[role=menu],[class*=dropdown],[class*=menu],[class*=popover],[class*=options]').getByText(want, { exact: true }),
      ]) {
        const v = loc.filter({ visible: true });
        if (await v.count()) return v.first();
      }
      return null;
    };
    let opt = await tryFind();
    if (opt) return opt;
    const editable = await res.locator.evaluate((el) => {
      const i = el.matches('input') ? el : el.querySelector('input');
      return !!i && !i.readOnly && getComputedStyle(i).opacity !== '0';
    }).catch(() => false);
    if (editable) { await page.keyboard.type(want, { delay: this.quick ? 0 : 40 }); await sleep(300); opt = await tryFind(); if (opt) return opt; }
    // virtual lists render only what's in view: wheel through the list
    const list = page.locator('[role=listbox],[class*=virtual-list],[class*=dropdown] [class*=holder],[class*=menu]').filter({ visible: true }).last();
    if (await list.count()) {
      const lb = await list.boundingBox();
      await page.mouse.move(lb.x + lb.width / 2, lb.y + Math.min(lb.height / 2, 60));
      for (let i = 0; i < 30 && !opt; i++) { await page.mouse.wheel(0, 120); await sleep(80); opt = await tryFind(); }
    }
    return opt;
  }

  async drag(n) {
    const res = await this.target(n);
    const b = await this.frame(n, res);
    const pt = await this.clickPoint(n, res, b);
    let dest;
    let destRect = null;
    if (n.opts.to) {
      destRect = await rectOf(this.page, n.opts.to, this.cfg, { timeout: this.cfg.locateTimeout }).catch((e) => { throw new StepError(n, `drag destination ${showTarget(n.opts.to)}: ${e.message}`); });
      dest = { x: destRect.x + destRect.width / 2, y: destRect.y + Math.min(destRect.height / 2, 80) };
    } else dest = { x: pt.x + n.opts.by.dx, y: pt.y + n.opts.by.dy };
    if (!this.noBoxes && (n.opts.label || n.opts.badge)) { await this.clearBoxes(); await this.drawBox(b, { label: n.opts.label, badge: n.opts.badge }); }
    await this.moveTo(pt.x, pt.y, speedOf(n));
    const startCenter = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await this.pause(0.25);
    const m = this.page.mouse;
    await m.down();
    await this.page.evaluate(() => window.__mfy && (window.__mfy.press(true), window.__mfy.trail(true))).catch(() => {});
    // nudge first: many drag libraries need a few px of movement to start a drag
    await m.move(pt.x + 6, pt.y + 6, { steps: 3 });
    const steps = this.quick ? 8 : 28;
    const dur = this.quick ? 0.1 : this.T.drag;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = pt.x + (dest.x - pt.x) * e;
      const y = pt.y + (dest.y - pt.y) * e;
      await m.move(x, y);
      await this.page.evaluate(([x, y]) => window.__mfy && window.__mfy.cursor(x, y), [x, y]).catch(() => {});
      await sleep((dur * 1000) / steps);
    }
    await sleep(120);
    await m.up();
    await this.page.evaluate(() => window.__mfy && (window.__mfy.press(false), window.__mfy.trail(false))).catch(() => {});
    this.emit('focus', { rect: union(b, destRect || { x: dest.x - 20, y: dest.y - 20, width: 40, height: 40 }), kind: 'drag', line: n.line });
    await sleep(250);
    // proof: the element (looked up again) really moved, or now sits in the destination
    const after = await resolve(this.page, n.target, this.cfg, { timeout: 2000 }).then((r) => r.locator.boundingBox()).catch(() => null);
    const moved = after && (Math.hypot(after.x + after.width / 2 - startCenter.x, after.y + after.height / 2 - startCenter.y) > 15);
    const landed = after && destRect && inside({ x: after.x + after.width / 2, y: after.y + after.height / 2, width: 0, height: 0 }, destRect, 2);
    if (!moved && !landed) this.note(n, 'proof', 'fail', `drag ${showTarget(n.target)} did not move it`);
    else this.results.proofs.pass++;
    await this.pause(n.opts.hold ?? 0.6);
    await this.expectAll(n);
  }

  async scroll(n) {
    if (n.target) {
      const res = await this.target(n);
      const b0 = await this.box(res);
      await this.moveTo(this.full.width * 0.55, Math.min(Math.max(b0.y, 200), this.full.height - 200), 'fast');
      await res.locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } else {
      const steps = 12;
      for (let i = 0; i < steps; i++) { await this.page.mouse.wheel(0, n.dy / steps); await sleep(this.quick ? 5 : (this.T.scroll * 1000) / steps); }
    }
    await this.pause(this.T.scroll);
    await this.expectAll(n);
  }

  // ------------------------------------------------------------ assertions

  note(n, kind, level, msg) {
    if (this.mode === 'replay') return;
    const bucket = kind === 'proof' ? this.results.proofs : this.results.asserts;
    if (level === 'fail') bucket.fail++;
    else if (level === 'warn') bucket.warn++;
    if (level === 'info') { this.issues.push({ line: n.line, kind, level, msg }); return; }
    this.issues.push({ line: n.line, kind, level, msg });
    this.emit(kind, { line: n.line, ok: false, level, msg });
    this.log(`  ${level === 'fail' ? '✗' : '⚠'} ${n.line} ${msg}`);
    const strict = (this.assertLevel === 'strict' && kind === 'proof' && level === 'fail');
    if (strict) throw new StepError(n, msg);
  }

  async expectAll(n) {
    if (this.mode === 'replay') return;
    for (const e of n.expects || []) {
      if (e.page === 'download') {
        if (this.download) { this.results.asserts.pass++; this.emit('assert', { line: n.line, ok: true, msg: `download ${path.basename(this.download)}` }); this.download = null; }
        else this.fail(n, e, 'expected a download, none happened');
        continue;
      }
      const res = await this.check(e);
      if (res.ok) { this.results.asserts.pass++; this.emit('assert', { line: n.line, ok: true, msg: res.msg }); }
      else this.fail(n, e, res.msg);
    }
  }

  fail(n, e, msg) {
    const level = e.level || this.assertLevel;
    if (level === 'off') return;
    const full = `expect ${e.page || showTarget(e.target)} ${e.page ? `${e.op || ''} ${e.value || ''}` : e.preds.map((p) => p.name + (p.op ? p.op + p.value : '')).join(' ')} — ${msg}`;
    if (level === 'strict') { this.results.asserts.fail++; this.emit('assert', { line: n.line, ok: false, level, msg: full }); throw new StepError(n, full); }
    this.note(n, 'assert', 'fail', full);
  }

  /** Evaluate one expectation, polling up to ~4 s. → {ok, msg} */
  async check(e, timeout = 4000) {
    const deadline = Date.now() + timeout;
    let last = { ok: false, msg: 'not checked' };
    for (;;) {
      last = await this.checkOnce(e).catch((err) => ({ ok: false, msg: err.message.split('\n')[0] }));
      if (last.ok || Date.now() >= deadline || this.mode === 'replay') return last;
      await sleep(200);
    }
  }

  async checkOnce(e) {
    const page = this.page;
    if (e.page === 'url' || e.page === 'title') {
      const got = e.page === 'url' ? page.url() : await page.title();
      const v = String(e.value);
      const ok = e.op === '=' ? got === v : v.startsWith('/') && v.endsWith('/') && v.length > 2 ? new RegExp(v.slice(1, -1)).test(got) : got.includes(v);
      return { ok, msg: `${e.page} is ${got}` };
    }
    if (e.page === 'no-errors' || e.page === 'nothing-broken') {
      const errs = this.consoleErrors?.length || 0;
      return { ok: errs === 0, msg: `${errs} console/page errors` };
    }
    const preds = e.preds;
    const wantsGone = preds.some((p) => p.name === 'hidden' || p.name === 'gone');
    let res = null;
    try { res = await resolve(page, e.target, this.cfg, { timeout: 0, visible: !preds.some((p) => p.name === 'present') }); } catch { res = null; }
    for (const p of preds) {
      switch (p.name) {
        case 'visible': if (!res) return { ok: false, msg: 'not visible' }; break;
        case 'present': if (!res) return { ok: false, msg: 'not in the page' }; break;
        case 'hidden': case 'gone': if (res) return { ok: false, msg: 'still visible' }; break;
        case 'count': {
          let n = 0;
          if (res) n = res.count;
          const ok = { '=': n === p.value, '>=': n >= p.value, '<=': n <= p.value, '>': n > p.value, '<': n < p.value }[p.op];
          if (!ok) return { ok: false, msg: `count is ${n}` };
          break;
        }
        default: {
          if (!res) return { ok: false, msg: 'not visible' };
          const L = res.locator;
          if (p.name === 'enabled' && !(await L.isEnabled())) return { ok: false, msg: 'disabled' };
          if (p.name === 'disabled' && (await L.isEnabled())) return { ok: false, msg: 'enabled' };
          if (p.name === 'checked' && !(await L.isChecked())) return { ok: false, msg: 'not checked' };
          if (p.name === 'unchecked' && (await L.isChecked())) return { ok: false, msg: 'checked' };
          if (p.name === 'editable' && !(await L.isEditable())) return { ok: false, msg: 'not editable' };
          if (p.name === 'focused' && !(await L.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)))) return { ok: false, msg: 'not focused' };
          if (p.name === 'inview') { const b = await L.boundingBox(); if (!b || !inside(b, this.cam, 2)) return { ok: false, msg: 'not inside the camera frame' }; }
          if (p.name === 'text' || p.name === 'value') {
            const got = p.name === 'text' ? await L.innerText() : await L.inputValue().catch(() => L.innerText());
            const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
            const ok = p.op === '=' ? norm(got) === norm(p.value) : norm(got).toLowerCase().includes(norm(p.value).toLowerCase());
            if (!ok) return { ok: false, msg: `${p.name} is "${norm(got).slice(0, 60)}"` };
          }
        }
      }
    }
    return { ok: true, msg: `${showTarget(e.target)} ${preds.map((p) => p.name).join(' ')}${wantsGone ? '' : ''}` };
  }

  // ------------------------------------------------------------ failure card

  async failureCard(err) {
    const n = err.node || {};
    const card = { line: n.line, verb: n.verb, message: err.message, target: n.target ? showTarget(n.target) : null, near: [], screenshot: null };
    try {
      if (this.takeDir) {
        card.screenshot = path.join(this.takeDir, `fail-${n.line || 0}.jpg`);
        await this.page.screenshot({ path: card.screenshot, type: 'jpeg', quality: 60, scale: 'css' });
      }
      const needle = err.target?.value || n.target?.value;
      if (needle) card.near = (await inventory(this.page, { near: String(needle), limit: 6 })).map((i) => i.target);
      if (!card.near.length) card.inventory = formatInventory(await inventory(this.page, { limit: 25 }));
    } catch { /* best effort */ }
    if (this.takeDir) fs.writeFileSync(path.join(this.takeDir, 'fail.json'), JSON.stringify(card, null, 1));
    return card;
  }
}

function inside(b, c, slack = 0) {
  return b.x >= c.x - slack && b.y >= c.y - slack && b.x + b.width <= c.x + c.width + slack && b.y + b.height <= c.y + c.height + slack;
}
