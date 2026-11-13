#!/usr/bin/env node
/**
 * manualify — script-driven screen recording for web apps.
 * Run `manualify help` for the command list; docs/ has the long form.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { parse, MulError } from '../src/mul/parse.mjs';
import { vibe, formatVibe } from '../src/mul/vibe.mjs';
import { runSession, loadScript, scriptId, readLatest } from '../src/runtime/session.mjs';
import { render, ffmpeg } from '../src/render/render.mjs';
import { check, formatCheck } from '../src/check/check.mjs';
import { stills, grab } from '../src/render/stills.mjs';
import { loadChain } from '../src/render/edl.mjs';
import { serveStatic } from '../src/tools/serve.mjs';
import { planFromStoryboard } from '../src/tools/plan.mjs';
import { specFromDemo } from '../src/tools/spec.mjs';
import { fillAssist } from '../src/tools/fill.mjs';
import { inspectPage } from '../src/tools/inspect-cli.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;

const HELP = `manualify ${VERSION} — .mul scripts → recorded, edited, checked videos

  setup     init [--skill-only]               config + mul/ + Claude Code skill in this project
  author    new <name> [--title T]            topic skeleton with <<blanks>>
            plan <storyboard.md>              storyboard → .mul skeletons (fill-the-blanks)
            inspect <path|url> [--near TEXT]  page inventory as ready-to-paste targets (no screenshot)
            fill <file.mul>                   run to the first <<blank>> and list candidates for it
            vibe <file.mul…>                  judge scripts before recording (score, length, findings)
  run       test <file.mul> [--base URL]      run actions + assertions fast, no video (acceptance test)
            record <file.mul> [--from LINE|MARK] [--headed]
            render <id|file.mul> [--preview]
            check <id|file.mul>               quality report + contact sheet
            make <file.mul…> [--force] [--preview]   vibe → record → render → check, skips unchanged
  media     stills <id|file.mul>              every \`shot\` as PNG, cut from the chunks
            frame <id|file.mul> <seconds> [--raw]    one frame as a small JPEG for a quick look
            join <out.mp4> <id…>              concatenate rendered clips (chapters)
  demo      demo new <name>                   demo-driven development: brief + prototype + demo.mul
            demo make <dir>                   serve the prototype, record and render the demo
            spec <dir>                        build spec (screens, elements, acceptance) from a demo
            serve <dir> [--port N]            static server for prototypes`;

// ------------------------------------------------------------ args
const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['from', 'title', 'near', 'base', 'port', 'user', 'config', 'out'].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const cmd = pos.shift();
const log = (s) => console.log(s);

async function cfgFor(file) {
  const cfg = await loadConfig({ from: file ? path.dirname(path.resolve(file)) : process.cwd(), file: flags.config });
  if (flags.base) cfg.baseURL = flags.base;
  if (flags.headed) cfg.headless = false;
  return cfg;
}

/** id | file.mul | take dir → latest take dir */
async function takeOf(ref, cfg) {
  if (fs.existsSync(path.join(ref, 'take.json'))) return path.resolve(ref);
  let id = ref;
  if (ref.endsWith('.mul')) id = scriptId(parse(fs.readFileSync(ref, 'utf8')), ref);
  const dir = readLatest(path.join(cfg.outDir, 'takes', id));
  if (!dir) throw new Error(`no take for "${id}" in ${cfg.outDir} — record it first`);
  return dir;
}

function videoOf(ref, cfg) {
  if (ref.endsWith('.mp4')) return path.resolve(ref);
  const id = ref.endsWith('.mul') ? scriptId(parse(fs.readFileSync(ref, 'utf8')), ref) : ref;
  const pv = flags.preview ? '.preview' : '';
  return path.join(cfg.outDir, 'videos', `${id}${pv}.mp4`);
}

function printCard(r) {
  if (!r.card) return;
  const c = r.card;
  log(`✗ line ${c.line}${c.verb ? ' ' + c.verb : ''}: ${c.message}`);
  if (c.near?.length) log(`  looks like: ${c.near.join('   ')}`);
  if (c.inventory) log(`  on screen:\n${c.inventory.split('\n').map((l) => '    ' + l).join('\n')}`);
  if (c.screenshot) log(`  screenshot: ${path.relative(process.cwd(), c.screenshot)}`);
  if (r.take?.duration) log(`  resume after fixing: manualify record ${path.relative(process.cwd(), r.take.file)} --from ${c.line}`);
}

function vibeOne(file, cfg) {
  const src = fs.readFileSync(file, 'utf8');
  const doc = parse(src, { file, tolerant: true });
  return vibe(doc, { readingSpeed: cfg.readingSpeed });
}

// ------------------------------------------------------------ commands
const commands = {
  async help() { log(HELP); },

  async init() {
    const root = process.cwd();
    const skillDst = path.join(root, '.claude', 'skills', 'manualify');
    fs.mkdirSync(skillDst, { recursive: true });
    fs.copyFileSync(path.join(PKG, 'skill', 'SKILL.md'), path.join(skillDst, 'SKILL.md'));
    log(`+ .claude/skills/manualify/SKILL.md`);
    if (flags['skill-only']) return;
    const put = (rel, from) => {
      const dst = path.join(root, rel);
      if (fs.existsSync(dst)) { log(`= ${rel} (exists, kept)`); return; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(PKG, from), dst);
      log(`+ ${rel}`);
    };
    put('manualify.config.mjs', 'templates/manualify.config.mjs');
    put('mul/example.mul', 'templates/topic.mul');
    put('mul/macros/README.md', 'templates/macros-README.md');
    const gi = path.join(root, '.gitignore');
    const line = 'manualify-out/';
    if (!fs.existsSync(gi) || !fs.readFileSync(gi, 'utf8').includes(line)) { fs.appendFileSync(gi, `\n${line}\n`); log('+ .gitignore: manualify-out/'); }
    log('\nnext: edit manualify.config.mjs (baseURL, login), then `npx manualify inspect /` and write mul/*.mul');
  },

  async new() {
    const name = pos[0];
    if (!name) throw new Error('usage: manualify new <name> [--title "…"]');
    const dst = path.resolve(name.endsWith('.mul') ? name : path.join('mul', `${name}.mul`));
    if (fs.existsSync(dst)) throw new Error(`${dst} exists`);
    let t = fs.readFileSync(path.join(PKG, 'templates', 'topic.mul'), 'utf8');
    t = t.replace(/^@id .*$/m, `@id ${path.basename(dst, '.mul')}`).replace(/^@title .*$/m, `@title ${flags.title || '<<title>>'}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, t);
    log(`+ ${path.relative(process.cwd(), dst)}  (fill the <<blanks>>; \`manualify fill\` helps)`);
  },

  async plan() {
    const file = pos[0];
    if (!file) throw new Error('usage: manualify plan <storyboard.md> [--out mul/]');
    const outDir = path.resolve(flags.out || 'mul');
    for (const f of planFromStoryboard(fs.readFileSync(file, 'utf8'), outDir)) log(`+ ${path.relative(process.cwd(), f)}`);
  },

  async inspect() {
    const cfg = await cfgFor(null);
    log(await inspectPage(cfg, pos[0] || '/', { near: flags.near, user: flags.user }));
  },

  async fill() {
    const file = pos[0];
    const cfg = await cfgFor(file);
    log(await fillAssist(file, cfg, { log }));
  },

  async vibe() {
    const files = pos.length ? pos : fs.readdirSync('mul').filter((f) => f.endsWith('.mul')).map((f) => path.join('mul', f));
    const cfg = await cfgFor(files[0]);
    let worst = 100;
    for (const f of files) { const v = vibeOne(f, cfg); worst = Math.min(worst, v.score); log(formatVibe(path.relative(process.cwd(), f), v)); }
    if (worst < 50) process.exitCode = 1;
  },

  async test() {
    const file = pos[0];
    const cfg = await cfgFor(file);
    const r = await runSession({ file, cfg, mode: 'test', headed: !cfg.headless, log: flags.quiet ? () => {} : log, verbose: !!flags.verbose });
    const { proofs, asserts } = r.take.results;
    log(`${r.ok && !asserts.fail && !proofs.fail ? '✓' : '✗'} ${path.basename(file)}  expects ${asserts.pass} ok / ${asserts.fail} failed · proofs ${proofs.pass} ok / ${proofs.warn} warn / ${proofs.fail} failed · ${r.take.wallSeconds}s`);
    printCard(r);
    if (!r.ok || asserts.fail || proofs.fail) process.exitCode = 1;
  },

  async record() {
    const file = pos[0];
    const cfg = await cfgFor(file);
    const r = await runSession({ file, cfg, mode: 'record', from: flags.from ?? null, headed: !cfg.headless, log: flags.quiet ? () => {} : log, verbose: !!flags.verbose });
    const t = r.take;
    const size = t.chunks.reduce((s, c) => s + fs.statSync(path.join(r.takeDir, c.file)).size, 0);
    log(`${r.ok ? '●' : '✗'} take ${path.relative(process.cwd(), r.takeDir)}  ${t.duration}s raw · ${(size / 1e6).toFixed(1)} MB in ${t.chunks.length} chunks · expects ${t.results.asserts.pass}/${t.results.asserts.pass + t.results.asserts.fail} · proofs ${t.results.proofs.pass} ok ${t.results.proofs.warn} warn ${t.results.proofs.fail} fail`);
    printCard(r);
    if (!r.ok) process.exitCode = 1;
    return r;
  },

  async render() {
    const cfg = await cfgFor(pos[0]?.endsWith('.mul') ? pos[0] : null);
    return render(await takeOf(pos[0], cfg), cfg, { preview: !!flags.preview, log });
  },

  async check() {
    const cfg = await cfgFor(pos[0]?.endsWith('.mul') ? pos[0] : null);
    const r = await check(videoOf(pos[0], cfg), cfg);
    log(formatCheck(r));
    if (r.findings.some((f) => f.level === 'error')) process.exitCode = 1;
    return r;
  },

  async make() {
    const files = pos.length ? pos : fs.readdirSync('mul').filter((f) => f.endsWith('.mul')).map((f) => path.join('mul', f));
    const rows = [];
    for (const file of files) {
      const cfg = await cfgFor(file);
      const doc = loadScript(file, cfg);
      const id = scriptId(doc, file);
      const v = vibeOne(file, cfg);
      if (v.findings.some((f) => f.level === 'error') && !flags.force) { log(formatVibe(file, v)); rows.push([id, 'vibe errors', v.score, '-']); process.exitCode = 1; continue; }
      const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).update(cfg.file ? fs.readFileSync(cfg.file) : '').update(VERSION).update(flags.preview ? 'p' : 'f').digest('hex');
      const madeFile = path.join(cfg.outDir, 'takes', id, 'made.json');
      const made = fs.existsSync(madeFile) ? JSON.parse(fs.readFileSync(madeFile, 'utf8')) : null;
      if (!flags.force && made?.hash === hash && fs.existsSync(made.video)) { rows.push([id, 'unchanged', made.quality, path.relative(process.cwd(), made.video)]); continue; }
      log(`── ${id}  (vibe ${v.score}, ≈${v.seconds}s)`);
      const r = await runSession({ file, cfg, mode: 'record', headed: !cfg.headless, log: flags.verbose ? log : () => {} });
      if (!r.ok) { printCard(r); rows.push([id, 'take failed', 0, '-']); process.exitCode = 1; continue; }
      const meta = await render(r.takeDir, cfg, { preview: !!flags.preview, log });
      const c = await check(meta.file, cfg);
      log(formatCheck(c));
      fs.writeFileSync(madeFile, JSON.stringify({ hash, video: meta.file, quality: c.score, at: new Date().toISOString() }));
      rows.push([id, 'made', c.score, path.relative(process.cwd(), meta.file)]);
    }
    log('\n' + rows.map(([id, st, q, v]) => `${id.padEnd(18)} ${st.padEnd(12)} ${String(q).padStart(3)}  ${v}`).join('\n'));
  },

  async stills() {
    const cfg = await cfgFor(pos[0]?.endsWith('.mul') ? pos[0] : null);
    for (const f of await stills(await takeOf(pos[0], cfg), cfg)) log(`+ ${path.relative(process.cwd(), f)}`);
  },

  async frame() {
    const [ref, t] = pos;
    const cfg = await cfgFor(ref?.endsWith('.mul') ? ref : null);
    const secs = parseFloat(t || '0');
    const outFile = path.join(cfg.outDir, 'frames', `${path.basename(ref).replace(/\.\w+$/, '')}-${flags.raw ? 'raw' : 'ed'}-${secs.toFixed(1)}.jpg`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    if (flags.raw) await grab(loadChain(await takeOf(ref, cfg)), secs, outFile, { width: 960 });
    else await ffmpeg(['-y', '-loglevel', 'error', '-ss', String(secs), '-i', videoOf(ref, cfg), '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', outFile]);
    log(outFile);
  },

  async join() {
    const [outFile, ...refs] = pos;
    const cfg = await cfgFor(null);
    const list = path.join(cfg.outDir, '.cache', 'join.txt');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, refs.map((r) => `file '${videoOf(r, cfg).replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outFile]);
    log(`▶ ${outFile}`);
  },

  async serve() {
    const dir = pos[0] || '.';
    const port = +(flags.port || 4873);
    await serveStatic(dir, port);
    log(`serving ${dir} on http://localhost:${port}  (ctrl-c to stop)`);
  },

  async demo() {
    const sub = pos.shift();
    if (sub === 'new') {
      const name = pos[0];
      if (!name) throw new Error('usage: manualify demo new <name>');
      const dst = path.resolve('demos', name);
      if (fs.existsSync(dst)) throw new Error(`${dst} exists`);
      fs.cpSync(path.join(PKG, 'templates', 'demo'), dst, { recursive: true });
      log(`+ demos/${name}/  brief.md · proto/ (screens.js, data.js) · demo.mul · manualify.config.mjs`);
      log(`next: fill brief.md, sketch screens in proto/screens.js, script demo.mul, then \`manualify demo make demos/${name}\``);
      return;
    }
    if (sub === 'make') {
      const dir = path.resolve(pos[0] || '.');
      const cfg = await loadConfig({ from: dir });
      const port = +(new URL(cfg.baseURL).port || 4873);
      const server = await serveStatic(path.join(dir, 'proto'), port);
      try {
        const file = path.join(dir, 'demo.mul');
        pos.splice(0, pos.length, file);
        await commands.make();
      } finally { server.close(); }
      return;
    }
    throw new Error('usage: manualify demo new <name> | demo make <dir>');
  },

  async spec() {
    const dir = path.resolve(pos[0] || '.');
    const file = specFromDemo(dir);
    log(`+ ${path.relative(process.cwd(), file)}`);
  },
};

// ------------------------------------------------------------ main
(async () => {
  const fn = commands[cmd || 'help'];
  if (!fn) { log(`unknown command "${cmd}"\n\n${HELP}`); process.exitCode = 2; return; }
  try { await fn(); } catch (e) {
    if (e instanceof MulError) log(`✗ ${e.message}`);
    else log(`✗ ${flags.debug ? e.stack : e.message}`);
    process.exitCode = 1;
  }
})();
