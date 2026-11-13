/** `manualify inspect <path>`: open the page like a recording would (login, guards) and list targets. */
import { chromium } from 'playwright';
import { inventory, formatInventory } from '../runtime/inspect.mjs';

export async function inspectPage(cfg, where, { near = null, user = null } = {}) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: cfg.viewport, locale: cfg.locale, colorScheme: cfg.colorScheme, baseURL: cfg.baseURL });
    const page = await context.newPage();
    const who = user || cfg.defaultUser;
    if (cfg.login && who) await cfg.login(page, cfg.users?.[who] ?? who, { baseURL: cfg.baseURL, config: cfg, name: who });
    await page.goto(new URL(where, cfg.baseURL).href, { waitUntil: 'domcontentloaded' });
    if (cfg.ready) await cfg.ready(page); else await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const list = await inventory(page, { near, limit: near ? 15 : 120 });
    const head = `${page.url()}  "${await page.title()}"  ${list.length} targets${near ? ` like "${near}"` : ''}`;
    return `${head}\n${list.length ? formatInventory(list) : '(nothing matched)'}`;
  } finally { await browser.close(); }
}
