/**
 * Check a rendered clip without anyone watching it.
 *
 *   from the take      failed step, proof/assert failures, blocked hosts, console errors
 *   from the EDL       captions shown shorter than their reading time, highlights off camera
 *                      or under a caption, too-fast camera moves, duration vs budget
 *   from the video     frozen stretches with no caption change (ffmpeg freezedetect, on a
 *                      240-px proxy so it's quick), black frames
 *   for a human / LLM  ONE contact sheet (20 tiles) instead of hundreds of frames
 */
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from '../render/render.mjs';
import { cameraAt, toOutput } from '../render/edl.mjs';
import { readSeconds, DEFAULTS } from '../mul/timing.mjs';

export async function check(videoFile, cfg, { sheet = true } = {}) {
  const meta = JSON.parse(fs.readFileSync(videoFile.replace(/\.mp4$/, '.edl.json'), 'utf8'));
  const take = JSON.parse(fs.readFileSync(path.join(meta.take, 'take.json'), 'utf8'));
  const findings = [];
  const add = (level, rule, msg, at = null, line = null) => findings.push({ level, rule, msg, at: at != null ? +(+at).toFixed(1) : null, line });
  const T = { ...DEFAULTS, readingSpeed: cfg.readingSpeed || DEFAULTS.readingSpeed };
  const out = meta.out;
  const full = { x: 0, y: 0, width: take.viewport.width, height: take.viewport.height };
  const edl = { camera: meta.camera };
  const off = meta.cardOffset || 0;

  // ---- take
  if (take.failed) add('error', 'take-failed', `take stopped at line ${take.failed.line}: ${take.failed.message}`, null, take.failed.line);
  for (const i of take.issues || []) if (i.level !== 'info') add(i.level === 'fail' ? 'error' : 'warn', i.kind, i.msg, null, i.line);
  const blocked = Object.entries(take.blocked || {});
  if (blocked.length) add('info', 'network', `blocked ${blocked.map(([h, n]) => `${h}×${n}`).join(', ')} — add to config.allow or config.routes if the page needs them`);
  if ((take.consoleErrors || []).length) add('warn', 'console', `${take.consoleErrors.length} console errors, first: ${take.consoleErrors[0].slice(0, 120)}`);
  if (take.recorder?.lateTicks > 5) add('info', 'recorder', `${take.recorder.lateTicks} late frame ticks — machine was busy; motion may stutter`);

  // ---- edit
  for (const c of meta.captions) {
    const need = readSeconds(c.text, T);
    if (c.t1 - c.t0 < need * 0.8) add('warn', 'caption-short', `"${c.text.slice(0, 40)}…" on screen ${(c.t1 - c.t0).toFixed(1)} s, needs ${need.toFixed(1)} s`, c.t0 + off, c.line);
  }
  for (const f of meta.focus) {
    const cam = cameraAt(edl, f.t, full);
    const r = toOutput(f.rect, cam, out);
    const visible = r.x + r.width > 0 && r.y + r.height > 0 && r.x < out.w && r.y < out.h;
    const insideFrame = r.x >= -2 && r.y >= -2 && r.x + r.width <= out.w + 2 && r.y + r.height <= out.h + 2;
    if (!visible) add('error', 'off-camera', `${f.kind} target is outside the frame`, f.t + off, f.line);
    else if (!insideFrame) add('warn', 'cropped', `${f.kind} target is partly outside the frame`, f.t + off, f.line);
    const cap = meta.captions.find((c) => f.t >= c.t0 && f.t <= c.t1);
    if (cap && cap.pos === 'top' && !cap.top && r.y < out.h * 0.2) add('warn', 'caption-cover', 'highlight sits under the caption in both bands', f.t + off, f.line);
  }
  for (const k of meta.camera) if (k.t1 > k.t0 && k.t1 - k.t0 < 0.3) add('info', 'camera-fast', `camera move of ${(k.t1 - k.t0).toFixed(2)} s feels jumpy`, k.t0 + off);
  const budget = take.meta?.budget;
  if (budget && (meta.duration > budget * 1.35 || meta.duration < budget * 0.5)) add('warn', 'budget', `${meta.duration.toFixed(0)} s vs budget ${budget} s`);

  // ---- video
  const probe = await ffmpeg(['-hide_banner', '-i', videoFile, '-vf', 'scale=240:-2,freezedetect=n=0.0008:d=4.5,blackdetect=d=0.4:pix_th=0.08', '-an', '-f', 'null', '-'], { capture: true }).catch((e) => e.message);
  const freezes = [...String(probe).matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_end: ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  for (const [a, b] of freezes) {
    // small changes (typing, a cursor on a big screen) fall under the pixel threshold, so a
    // freeze only counts when the timeline agrees nothing happened either
    const inSpan = (t) => t + off > a + 0.4 && t + off < b - 0.4;
    const busy = meta.captions.some((c) => inSpan(c.t0)) || meta.focus.some((f) => inSpan(f.t)) || meta.camera.some((k) => inSpan(k.t0));
    if (!busy) add('warn', 'dead-air', `${(b - a).toFixed(1)} s with a frozen picture, no action and the same caption`, a);
  }
  for (const m of String(probe).matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) add('warn', 'black', `black frames ${(+m[2] - +m[1]).toFixed(1)} s`, +m[1]);

  // ---- contact sheet (one image for review)
  let contact = null;
  if (sheet) {
    contact = videoFile.replace(/\.mp4$/, '.contact.jpg');
    const n = 20;
    const every = Math.max(0.5, meta.duration / n);
    await ffmpeg(['-y', '-loglevel', 'error', '-i', videoFile, '-vf', `fps=1/${every.toFixed(3)},scale=384:-2,tile=5x4:padding=4:color=white`, '-frames:v', '1', '-q:v', '4', contact]).catch(() => { contact = null; });
  }

  const w = { error: 15, warn: 5, info: 1 };
  const score = Math.max(0, 100 - findings.reduce((s, x) => s + w[x.level], 0));
  findings.sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.level] - { error: 0, warn: 1, info: 2 }[b.level]) || (a.at ?? 0) - (b.at ?? 0));
  const report = {
    video: videoFile, score, duration: meta.duration,
    results: take.results, findings, contact,
    summary: `${take.results.proofs.pass} proofs ok · ${take.results.asserts.pass} expects ok · ${take.results.proofs.fail + take.results.asserts.fail} failed · ${take.results.proofs.warn} warnings`,
  };
  fs.writeFileSync(videoFile.replace(/\.mp4$/, '.check.json'), JSON.stringify(report, null, 1));
  return report;
}

export function formatCheck(r) {
  const lines = [`${path.basename(r.video)}  quality ${r.score}/100  ${r.duration.toFixed(1)} s  ${r.summary}`];
  for (const f of r.findings) lines.push(`  ${f.level.padEnd(5)} ${f.at != null ? `@${f.at.toFixed(1)}s`.padEnd(8) : ''.padEnd(8)}${f.line ? `line ${f.line} ` : ''}${f.rule}: ${f.msg}`);
  if (r.contact) lines.push(`  contact sheet: ${path.relative(process.cwd(), r.contact)}`);
  return lines.join('\n');
}
