/**
 * Render: chunks + EDL → final mp4 in ONE ffmpeg pass.
 *
 *   per kept span   `-ss local -t dur -i chunk_k.mp4`   (seek inside one 10 s chunk, ≤ 1 s decode)
 *   concat → constant fps → camera (zoompan, eased keyframes) → output size
 *   → flash at cut points (eq brightness) → caption/chip PNG overlays (fade in/out) → H.264
 *
 * Caption placement is decided here, geometrically: a caption moves to the top when any
 * highlighted target would sit under the caption band at that moment (camera applied).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadChain, buildEdl, cameraAt, toOutput } from './edl.mjs';
import { renderImages } from './captions.mjs';

const r3 = (x) => +(+x).toFixed(3);

export function outputSize(cfg, preview) {
  const w = preview ? 960 : (cfg.output?.width || 1920);
  const h = Math.round((w * cfg.viewport.height) / cfg.viewport.width / 2) * 2;
  return { w, h };
}

/** Decide top/bottom per caption. Returns the same captions with .y and .pos. */
export function placeCaptions(edl, cfg, out, full) {
  const band = out.h * (1 - cfg.captions.band);
  for (const c of edl.captions) {
    let collide = false;
    for (const f of edl.focus) {
      if (f.t < c.t0 - 0.3 || f.t > c.t1) continue;
      for (const t of [Math.max(f.t, c.t0), Math.min(c.t1, f.t + 1.2)]) {
        const r = toOutput(f.rect, cameraAt(edl, t, full), out);
        if (r.y + r.height > band - 10 && r.y < out.h) collide = true;
      }
    }
    c.collide = collide;
    c.pos = c.top || collide ? 'top' : 'bottom';
  }
  return edl.captions;
}

/** Expression for a camera value at time T (seconds) from keyframes, smoothstep-eased. */
function camExpr(edl, full, pick, T = 'it') {
  let expr = String(r3(pick(full)));
  let prev = full;
  const parts = [];
  for (const k of edl.camera) {
    const a = r3(pick(prev));
    const b = r3(pick(k.to));
    if (k.t1 > k.t0 && a !== b) {
      const p = `((${T}-${r3(k.t0)})/${r3(k.t1 - k.t0)})`;
      parts.push({ t0: k.t0, t1: k.t1, ramp: `(${a}+(${r3(b - a)})*${p}*${p}*(3-2*${p}))`, end: b });
    } else parts.push({ t0: k.t0, t1: k.t0, ramp: null, end: b });
    prev = k.to;
  }
  // build from the back: if(T<t0_1, v0, if(T<t1_1, ramp1, if(T<t0_2, v1, …)))
  let tail = parts.length ? String(parts[parts.length - 1].end) : expr;
  for (let i = parts.length - 1; i >= 0; i--) {
    const before = i === 0 ? expr : String(parts[i - 1].end);
    const inner = parts[i].ramp ? `if(lt(${T},${r3(parts[i].t1)}),${parts[i].ramp},${tail})` : tail;
    tail = `if(lt(${T},${r3(parts[i].t0)}),${before},${inner})`;
  }
  return tail;
}

/** Split kept segments into per-chunk input pieces. */
function pieces(chain, edl) {
  const out = [];
  for (const s of edl.segments) {
    for (const src of chain.sources) {
      const a = Math.max(s.raw0, src.shift + src.from);
      const b = Math.min(s.raw1, src.shift + src.to);
      if (b - a < 1 / 60) continue;
      for (const c of src.chunks) {
        const ca = Math.max(a, src.shift + c.start);
        const cb = Math.min(b, src.shift + c.end);
        if (cb - ca < 1 / 60) continue;
        out.push({ file: path.join(src.dir, c.file), ss: r3(ca - src.shift - c.start), dur: r3(cb - ca), speed: s.speed });
      }
    }
  }
  return out;
}

export async function render(takeDir, cfg, { preview = false, outFile, log = () => {} } = {}) {
  const chain = loadChain(takeDir);
  const take = chain.take;
  const edl = buildEdl(chain, { trimIdle: cfg.trimIdle || 0 });
  if (edl.duration < 0.2) throw new Error('nothing to render (everything was cut?)');
  const out = outputSize(cfg, preview);
  const fps = take.fps || cfg.fps;
  const scale = take.scale;
  const full = { x: 0, y: 0, width: take.viewport.width, height: take.viewport.height };
  placeCaptions(edl, cfg, out, full);

  const cache = path.join(cfg.outDir, '.cache', 'images');
  const caps = edl.captions.map((c) => ({ kind: 'caption', text: c.text, span: c }));
  // section chips are chapter markers: shown briefly at the top, not parked over the app's UI
  const chipSecs = cfg.chip.seconds ?? 2.8;
  const chips = edl.chips.map((c) => ({ kind: 'chip', text: c.text, span: { ...c, t1: Math.min(c.t1, c.t0 + chipSecs) } }));
  const card = cfg.cards && take.title ? [{ kind: 'card', text: take.title, sub: take.meta?.subtitle || '' }] : [];
  await renderImages([...caps, ...chips, ...card], cfg, out, cache);

  const P = pieces(chain, edl);
  const args = ['-y', '-loglevel', 'error', '-stats_period', '2'];
  P.forEach((p) => args.push('-ss', String(p.ss), '-t', String(p.dur), '-i', p.file));
  const imgStart = P.length;
  const overlays = [...caps, ...chips];
  overlays.forEach((o) => args.push('-itsoffset', String(r3(o.span.t0)), '-loop', '1', '-framerate', String(fps), '-t', String(r3(o.span.t1 - o.span.t0)), '-i', o.file));
  if (card.length) args.push('-loop', '1', '-framerate', String(fps), '-t', '2.4', '-i', card[0].file);

  const f = [];
  P.forEach((p, i) => f.push(`[${i}:v]setpts=PTS-STARTPTS${p.speed !== 1 ? `,setpts=PTS/${p.speed}` : ''}[p${i}]`));
  f.push(`${P.map((_, i) => `[p${i}]`).join('')}concat=n=${P.length}:v=1:a=0,fps=${fps},setpts=N/(${fps}*TB),format=yuv420p[raw]`);

  const zoomed = edl.camera.some((k) => k.to.width < full.width - 0.5);
  if (zoomed) {
    const W = camExpr(edl, full, (r) => r.width * scale);
    const X = camExpr(edl, full, (r) => r.x * scale);
    const Y = camExpr(edl, full, (r) => r.y * scale);
    f.push(`[raw]zoompan=z='iw/(${W})':x='${X}':y='${Y}':d=1:s=${out.w}x${out.h}:fps=${fps}[cam]`);
  } else f.push(`[raw]scale=${out.w}:${out.h}:flags=lanczos[cam]`);

  // a short bright flash at every edit point tells the viewer time was skipped
  let last = 'cam';
  if (edl.cuts.length) {
    const b = edl.cuts.slice(0, 60).map((c) => `max(0,0.32*(1-abs(t-${r3(c)})/0.12))`).join('+');
    f.push(`[cam]eq=brightness='${b}':eval=frame[fl]`);
    last = 'fl';
  }

  const marginX = Math.round(out.w * 0.04);
  const marginY = Math.round(out.h * 0.045);
  overlays.forEach((o, i) => {
    const idx = imgStart + i;
    const s = o.span;
    const fd = Math.min(0.18, (s.t1 - s.t0) / 3);
    f.push(`[${idx}:v]format=rgba,fade=t=in:st=${r3(s.t0)}:d=${r3(fd)}:alpha=1,fade=t=out:st=${r3(s.t1 - fd)}:d=${r3(fd)}:alpha=1[i${i}]`);
    let x, y;
    if (o.kind === 'chip') {
      const pos = cfg.chip.position || 'top-center';
      x = pos === 'top-left' ? marginX : pos === 'top-right' ? `W-w-${marginX}` : '(W-w)/2';
      y = marginY;
    } else {
      x = `(W-w)/2`;
      const chipH = chips.some((c) => c.span.t0 < s.t1 && c.span.t1 > s.t0) ? Math.round(out.h * 0.075) : 0;
      y = s.pos === 'top' ? marginY + chipH : `H-h-${marginY}`;
    }
    f.push(`[${last}][i${i}]overlay=x=${x}:y=${y}:eof_action=pass:format=auto[o${i}]`);
    last = `o${i}`;
  });
  if (card.length) {
    const ci = imgStart + overlays.length;
    f.push(`[${ci}:v]scale=${out.w}:${out.h},format=yuv420p,setsar=1,fade=t=out:st=2.0:d=0.4[card]`);
    f.push(`[${last}]setsar=1[mainv]`, `[card][mainv]concat=n=2:v=1:a=0[final]`);
    last = 'final';
  }
  f.push(`[${last}]format=yuv420p[v]`);

  const videos = path.join(cfg.outDir, 'videos');
  fs.mkdirSync(videos, { recursive: true });
  const file = outFile || path.join(videos, `${take.id}${preview ? '.preview' : ''}.mp4`);
  const script = path.join(cfg.outDir, '.cache', `${take.id}.filter.txt`);
  fs.writeFileSync(script, f.join(';\n'));
  args.push('-/filter_complex', script, '-map', '[v]', '-r', String(fps),
    '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file);
  const t0 = Date.now();
  await ffmpeg(args);
  const meta = {
    file, take: takeDir, duration: edl.duration + (card.length ? 2.4 : 0), out, preview, renderedIn: +((Date.now() - t0) / 1000).toFixed(1),
    cardOffset: card.length ? 2.4 : 0,
    captions: edl.captions, chips: edl.chips, cuts: edl.cuts, camera: edl.camera, focus: edl.focus, shots: edl.shots, segments: edl.segments,
  };
  fs.writeFileSync(file.replace(/\.mp4$/, '.edl.json'), JSON.stringify(meta, null, 1));
  log(`▶ ${path.relative(process.cwd(), file)}  ${meta.duration.toFixed(1)} s  (${P.length} spans, ${edl.cuts.length} cuts, ${edl.captions.length} captions, rendered in ${meta.renderedIn} s)`);
  return meta;
}

export function ffmpeg(args, { capture = false } = {}) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
    let err = '';
    let outBuf = '';
    p.stderr.on('data', (d) => { err += d; });
    if (capture) p.stdout.on('data', (d) => { outBuf += d; });
    p.on('close', (code) => (code === 0 ? res(capture ? outBuf + err : err) : rej(new Error(`ffmpeg failed (${code}): ${err.trim().split('\n').slice(-4).join(' | ')}`))));
  });
}
