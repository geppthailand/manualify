/**
 * Edit decision list: take timeline → what the viewer sees.
 *
 *   raw time   seconds of the recording (chunks)
 *   edited     seconds of the final video (cuts removed, fast spans compressed)
 *
 * A resumed take (`record --from`) is stitched here: the previous take up to the resume
 * point, then the new take — no re-encoding of the part that was already fine.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Load a take and the chain of takes it resumes → one virtual raw timeline. */
export function loadChain(takeDir) {
  const take = JSON.parse(fs.readFileSync(path.join(takeDir, 'take.json'), 'utf8'));
  if (!take.resume) {
    return { take, sources: [{ dir: takeDir, chunks: take.chunks, from: 0, to: take.duration, shift: 0 }], events: take.events, duration: take.duration };
  }
  const prevDir = path.resolve(takeDir, take.resume.of);
  const prev = loadChain(prevDir);
  // resume.at is in the previous take's own clock; that take starts at its shift in the chain
  const at = prev.sources[prev.sources.length - 1].shift + take.resume.at;
  const sources = [];
  for (const s of prev.sources) {
    if (s.shift >= at) continue;
    sources.push({ ...s, to: Math.min(s.to, at - s.shift) });
  }
  sources.push({ dir: takeDir, chunks: take.chunks, from: 0, to: take.duration, shift: at });
  const events = [...prev.events.filter((e) => e.t < at), ...take.events.map((e) => ({ ...e, t: +(e.t + at).toFixed(3), ...(e.t1 != null ? { t1: +(e.t1 + at).toFixed(3) } : {}) }))];
  return { take, sources, events, duration: at + take.duration };
}

/**
 * Build the EDL.
 * @returns {{
 *   segments: {raw0:number, raw1:number, speed:number, ed0:number, ed1:number}[],
 *   duration: number, toEd: (raw:number)=>number,
 *   cuts: number[],                         edited times where footage jumps
 *   camera: {t0,t1,from,to}[],              transitions in edited time (viewport CSS px rects)
 *   captions: {t0,t1,text,top,line}[], chips: {t0,t1,text}[],
 *   focus: {t,rect,kind,line}[], shots: {t,raw,name,rect}[]
 * }}
 */
export function buildEdl(chain, { trimIdle = 0 } = {}) {
  const ev = [...chain.events].sort((a, b) => a.t - b.t);
  const total = chain.duration;

  // ---- cut spans (nested cut blocks + explicit cutspans)
  const cuts = [];
  let depth = 0;
  let c0 = 0;
  for (const e of ev) {
    if (e.type === 'cut') {
      if (e.on) { if (!depth++) c0 = e.t; } else if (depth && !--depth) cuts.push([c0, e.t]);
    } else if (e.type === 'cutspan') cuts.push([e.t, e.t1]);
  }
  if (depth) cuts.push([c0, total]);
  // a resumed take starts mid-scene: nothing to cut at the seam, but trim the dead first 0.3 s of each source
  const merged = mergeSpans(cuts.filter(([a, b]) => b - a > 0.02));

  // ---- fast spans
  const fasts = [];
  let f0 = null;
  let ff = 1;
  for (const e of ev) {
    if (e.type !== 'fast') continue;
    if (e.factor) { f0 = e.t; ff = e.factor; } else if (f0 != null) { fasts.push([f0, e.t, ff]); f0 = null; }
  }
  if (f0 != null) fasts.push([f0, total, ff]);

  // ---- keep spans → segments with speed
  const keep = [];
  let cur = 0;
  for (const [a, b] of merged) { if (a > cur) keep.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < total) keep.push([cur, total]);
  const segs = [];
  for (const [a, b] of keep) {
    const points = [a, b, ...fasts.flatMap(([x, y]) => [x, y]).filter((x) => x > a && x < b)].sort((p, q) => p - q);
    for (let i = 0; i < points.length - 1; i++) {
      const r0 = points[i], r1 = points[i + 1];
      if (r1 - r0 < 1 / 60) continue;
      const mid = (r0 + r1) / 2;
      const f = fasts.find(([x, y]) => mid >= x && mid < y);
      segs.push({ raw0: r0, raw1: r1, speed: f ? f[2] : 1 });
    }
  }
  // optional: squeeze idle stretches (no event for > trimIdle s) to 1 s at 4×
  if (trimIdle > 0) squeezeIdle(segs, ev, trimIdle);

  let ed = 0;
  const cutsEd = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    s.ed0 = ed;
    ed += (s.raw1 - s.raw0) / s.speed;
    s.ed1 = ed;
    if (i && Math.abs(segs[i - 1].raw1 - s.raw0) > 1e-3) cutsEd.push(+s.ed0.toFixed(3));
  }
  const duration = ed;
  const toEd = (raw) => {
    for (const s of segs) {
      if (raw < s.raw0) return s.ed0;            // inside a cut → the next edit point
      if (raw <= s.raw1) return s.ed0 + (raw - s.raw0) / s.speed;
    }
    return duration;
  };
  const speedAt = (raw) => segs.find((s) => raw >= s.raw0 && raw <= s.raw1)?.speed || 1;

  // ---- camera transitions
  const camera = [];
  for (const e of ev) {
    if (e.type !== 'camera') continue;
    const t0 = toEd(e.t);
    const inCut = merged.some(([a, b]) => e.t >= a && e.t < b);
    const dur = inCut ? 0 : (e.dur || 0) / speedAt(e.t);
    camera.push({ t0: +t0.toFixed(3), t1: +(t0 + dur).toFixed(3), to: e.rect });
  }
  // ---- captions & chips (state machines; a change inside a cut lands on the edit point)
  const spans = (type) => {
    const out = [];
    let open = null;
    for (const e of ev) {
      if (e.type !== type) continue;
      const t = toEd(e.t);
      if (open) { open.t1 = t; if (open.t1 - open.t0 > 0.05 && open.text) out.push(open); }
      open = e.text ? { t0: t, t1: duration, text: e.text, top: !!e.top, line: e.line } : null;
    }
    if (open && open.text && duration - open.t0 > 0.05) out.push(open);
    return out.map((x) => ({ ...x, t0: +x.t0.toFixed(3), t1: +x.t1.toFixed(3) }));
  };
  const focus = ev.filter((e) => e.type === 'focus').map((e) => ({ t: +toEd(e.t).toFixed(3), raw: e.t, rect: e.rect, kind: e.kind, line: e.line }));
  const shots = ev.filter((e) => e.type === 'shot').map((e) => ({ t: +toEd(e.t).toFixed(3), raw: e.t, name: e.name, rect: e.rect }));
  return { segments: segs, duration: +duration.toFixed(3), toEd, cuts: cutsEd, camera, captions: spans('caption'), chips: spans('chip'), focus, shots };
}

function mergeSpans(spans) {
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of s) {
    if (out.length && x[0] <= out[out.length - 1][1] + 0.05) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]);
    else out.push([...x]);
  }
  return out;
}

function squeezeIdle(segs, ev, limit) {
  const times = ev.filter((e) => !['step'].includes(e.type)).map((e) => e.t);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.speed !== 1) continue;
    const inside = [s.raw0, ...times.filter((t) => t > s.raw0 && t < s.raw1), s.raw1];
    for (let k = 0; k < inside.length - 1; k++) {
      const a = inside[k], b = inside[k + 1];
      if (b - a > limit) {
        const keepA = a + 0.6, keepB = b - 0.4;
        const parts = [{ raw0: s.raw0, raw1: keepA, speed: 1 }, { raw0: keepA, raw1: keepB, speed: Math.max(4, (keepB - keepA) / 1) }, { raw0: keepB, raw1: s.raw1, speed: 1 }]
          .filter((p) => p.raw1 - p.raw0 > 1 / 60);
        segs.splice(i, 1, ...parts);
        i += parts.length - 1;
        break;
      }
    }
  }
}

/** Camera rect (viewport px) at edited time t, eased between keyframes. */
export function cameraAt(edl, t, full) {
  let cur = full;
  for (const k of edl.camera) {
    if (t < k.t0) break;
    const from = cur;
    if (t >= k.t1) { cur = k.to; continue; }
    const p = (t - k.t0) / Math.max(1e-6, k.t1 - k.t0);
    const e = p * p * (3 - 2 * p);
    return lerpRect(from, k.to, e);
  }
  return cur;
}

export const lerpRect = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, width: a.width + (b.width - a.width) * e, height: a.height + (b.height - a.height) * e });

/** Map a viewport rect into output-frame px under camera `cam`. */
export function toOutput(rect, cam, out) {
  const k = out.w / cam.width;
  return { x: (rect.x - cam.x) * k, y: (rect.y - cam.y) * k, width: rect.width * k, height: rect.height * k };
}
