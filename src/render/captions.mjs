/**
 * Captions, chips and title cards are laid out by Chrome and saved as transparent PNGs.
 * Why Chrome: correct shaping for every script (Thai, Arabic, CJK, emoji) with no ffmpeg
 * drawtext/libass dependency, and the same fonts the app itself uses. Cached by content hash.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (s, bold) => esc(s).replace(/\*\*(.+?)\*\*/g, `<b style="color:${bold}">$1</b>`).replace(/`(.+?)`/g, '<code>$1</code>');

function html(item, cfg0, out) {
  const k = out.w / 1920;   // styles are authored for 1920 px wide output
  // the markup goes into style="…" attributes: font family quotes must be single quotes
  const cfg = { ...cfg0, captions: { ...cfg0.captions, font: cfg0.captions.font.replace(/"/g, "'") } };
  if (item.kind === 'caption') {
    const c = cfg.captions;
    return `<div id="c" style="display:inline-block;max-width:${Math.round(out.w * c.maxWidth)}px;padding:${16 * k}px ${28 * k}px;
      border-radius:${c.radius * k}px;background:${c.background};color:${c.color};font:500 ${c.size * k}px/1.38 ${c.font};
      text-align:center;letter-spacing:.01em">${md(item.text, c.bold)}</div>`;
  }
  if (item.kind === 'chip') {
    const c = cfg.chip;
    return `<div id="c" style="display:inline-flex;align-items:center;gap:${10 * k}px;padding:${9 * k}px ${20 * k}px ${9 * k}px ${14 * k}px;border-radius:999px;
      background:${c.background};color:${c.color};font:600 ${c.size * k}px/1.2 ${cfg.captions.font};box-shadow:0 ${4 * k}px ${18 * k}px rgba(0,0,0,.18)">
      <i style="width:${10 * k}px;height:${10 * k}px;border-radius:50%;background:${cfg.theme?.accent || '#f5a524'};display:inline-block"></i>${md(item.text, cfg.captions.bold)}</div>`;
  }
  // title card (full frame)
  const c = cfg.cards || {};
  const logo = c.logo && fs.existsSync(path.resolve(cfg.root, c.logo))
    ? `<img src="data:image/png;base64,${fs.readFileSync(path.resolve(cfg.root, c.logo)).toString('base64')}" style="height:${90 * k}px;margin-bottom:${36 * k}px">` : '';
  return `<div id="c" style="width:${out.w}px;height:${out.h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:${c.background || '#0f172a'};color:${c.color || '#fff'};font-family:${cfg.captions.font};text-align:center">
    ${logo}<div style="font:700 ${64 * k}px/1.2 ${cfg.captions.font};max-width:80%">${md(item.text, c.accent || cfg.captions.bold)}</div>
    ${item.sub ? `<div style="font:400 ${30 * k}px/1.4 ${cfg.captions.font};opacity:.75;margin-top:${18 * k}px">${md(item.sub, cfg.captions.bold)}</div>` : ''}</div>`;
}

/** items: [{kind, text, sub?}] → same array with {file, w, h} filled in. */
export async function renderImages(items, cfg, out, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const todo = [];
  for (const it of items) {
    const key = crypto.createHash('sha1').update(JSON.stringify([it.kind, it.text, it.sub, out, cfg.captions, cfg.chip, cfg.cards])).digest('hex').slice(0, 16);
    it.file = path.join(cacheDir, `${it.kind}-${key}.png`);
    it.meta = `${it.file}.json`;
    if (fs.existsSync(it.file) && fs.existsSync(it.meta)) Object.assign(it, JSON.parse(fs.readFileSync(it.meta, 'utf8')));
    else todo.push(it);
  }
  if (todo.length) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: out.w, height: out.h }, deviceScaleFactor: 1 });
    for (const it of todo) {
      await page.setContent(`<html><body style="margin:0;background:transparent">${html(it, cfg, out)}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const el = page.locator('#c');
      const b = await el.boundingBox();
      await el.screenshot({ path: it.file, omitBackground: it.kind !== 'card' });
      it.w = Math.round(b.width); it.h = Math.round(b.height);
      fs.writeFileSync(it.meta, JSON.stringify({ w: it.w, h: it.h }));
    }
    await browser.close();
  }
  return items;
}
