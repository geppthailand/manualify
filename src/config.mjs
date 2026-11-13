/**
 * Project config: manualify.config.mjs (searched upward from the script, then the cwd).
 * Everything is optional; a bare `export default { baseURL: 'http://localhost:3000' }` works.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULTS as TIMING } from './mul/timing.mjs';

export const DEFAULT_CONFIG = {
  baseURL: 'http://localhost:3000',
  viewport: { width: 1920, height: 1080 },
  scale: 1.5,                // device scale factor: recordings are viewport × scale px, so zooms up to ×scale stay sharp
  fps: 30,
  chunkSeconds: 10,
  encoder: 'libx264',        // or 'h264_videotoolbox' (macOS hardware)
  locale: 'en-US',
  timezoneId: undefined,
  colorScheme: 'light',
  headless: true,
  outDir: 'manualify-out',
  macroDir: 'mul/macros',
  allow: [],                 // extra hosts the page may reach while recording (baseURL host + localhost always allowed)
  routes: [],                // [{ url: '**/api/ai/**', json: {...} | file: 'x.json' | status: 503 }] canned responses
  assert: 'warn',            // default assertion level: strict | warn | off
  locateTimeout: 8000,
  maxZoom: null,             // defaults to `scale` (zoom further and text goes soft)
  readingSpeed: TIMING.readingSpeed,
  captions: {
    font: '"Noto Sans", "Noto Sans Thai", "Helvetica Neue", Arial, sans-serif',
    size: 34, color: '#ffffff', background: 'rgba(17,24,39,.86)', bold: '#fcd34d', radius: 14, maxWidth: 0.78, band: 0.17,
  },
  chip: { background: 'rgba(17,24,39,.78)', color: '#fff', size: 24 },
  theme: { accent: '#f5a524', ink: '#1f2937' },
  cards: null,               // { logo: './logo.png', background: '#0f172a', color: '#fff' } → title/end cards
  i18n: null,                // { 'reports.export': 'Export' } or (key) => text — for t:key targets
  macros: {},                // { card: (scope, name, {page}) => scope.locator('.card').filter({ hasText: name }) }
  users: {},                 // free-form, handed to login()
  login: null,               // async (page, user, { baseURL, config }) => {}
  ready: null,               // async (page) => {} — what `wait ready` means
  state: null,               // { restore: async (name) => {}, snapshot: async (name) => {} }
  pick: null,                // async (page, locator, optionText, helpers) => {} — custom select widget
  hooks: {},                 // { seedOrders: async (page, ctx, n) => {} } — called by `run seedOrders 20`
};

export async function loadConfig({ from = process.cwd(), file = null } = {}) {
  const found = file ? path.resolve(file) : findUp(from, 'manualify.config.mjs') || findUp(process.cwd(), 'manualify.config.mjs');
  let user = {};
  if (found) user = (await import(pathToFileURL(found).href + `?t=${Date.now()}`)).default || {};
  const cfg = { ...DEFAULT_CONFIG, ...user };
  cfg.viewport = { ...DEFAULT_CONFIG.viewport, ...(user.viewport || {}) };
  cfg.captions = { ...DEFAULT_CONFIG.captions, ...(user.captions || {}) };
  cfg.chip = { ...DEFAULT_CONFIG.chip, ...(user.chip || {}) };
  cfg.theme = { ...DEFAULT_CONFIG.theme, ...(user.theme || {}) };
  cfg.root = found ? path.dirname(found) : process.cwd();
  cfg.file = found;
  cfg.outDir = path.resolve(cfg.root, cfg.outDir);
  cfg.maxZoom = cfg.maxZoom || Math.max(1.25, cfg.scale);
  return cfg;
}

function findUp(dir, name) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
    if (path.dirname(d) === d) return null;
  }
}
