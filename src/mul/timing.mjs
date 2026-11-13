/**
 * One timing model for the player AND the vibe check, so the estimate is what you get.
 *
 * Captions are "lazy": `say` shows the caption and returns at once; the NEXT `say` (or the
 * end of the clip) waits only for whatever reading time is still left. Actions therefore
 * happen while a caption is being read, and nobody has to hand-tune pauses.
 */

export const DEFAULTS = {
  readingSpeed: 14,      // characters per second a viewer reads comfortably (Thai ≈ 13, English ≈ 15)
  minRead: 1.6,          // shortest time any caption stays up
  maxCaption: 90,        // longer captions should be split
  move: { slow: 0.95, normal: 0.6, fast: 0.35 },
  clickPre: 0.3,         // settle on the target before pressing
  clickPost: 0.6,        // let the viewer see the result
  pointHold: 1.2,
  zoomIn: { slow: 1.2, normal: 0.8, fast: 0.5, snap: 0 },
  typeDelay: 0.055,      // per character
  pick: 1.6,
  drag: 1.4,
  scroll: 0.9,
  loadGuess: 1.2,        // `wait ready` / `go` when we can't know
};

/** Visible characters of a caption (markdown markers don't count). */
export function captionChars(text) {
  return [...String(text || '').replace(/\*\*|__|`/g, '')].length;
}

export function readSeconds(text, cfg = DEFAULTS) {
  return Math.max(cfg.minRead, captionChars(text) / cfg.readingSpeed);
}

export function speedOf(node) {
  if (node.mods?.includes('slow') || node.opts?.slow || node.opts?.speed === 'slow') return 'slow';
  if (node.mods?.includes('fast') || node.opts?.fast || node.opts?.speed === 'fast') return 'fast';
  if (node.opts?.snap || node.opts?.instant) return 'snap';
  return 'normal';
}

/** Seconds a statement takes on camera (before cut/fast editing). Captions: 0 (lazy). */
export function stepSeconds(node, cfg = DEFAULTS) {
  const sp = speedOf(node);
  const mv = cfg.move[sp === 'snap' ? 'fast' : sp];
  const hold = node.opts?.hold;
  switch (node.verb) {
    case 'say': case 'chip': case 'section': case 'hush': case 'note': case 'mark': case 'shot': case 'expect':
      return 0;
    case 'wait': return node.seconds ?? cfg.loadGuess;
    case 'go': return cfg.loadGuess;
    case 'click': return mv + cfg.clickPre + (hold ?? cfg.clickPost);
    case 'hover': return mv + (hold ?? 0.6);
    case 'point': case 'spot': return mv + (hold ?? cfg.pointHold);
    case 'type': return mv + cfg.clickPre + captionChars(node.value) * cfg.typeDelay + (hold ?? 0.5);
    case 'pick': return mv + cfg.pick + (hold ?? 0.4);
    case 'key': return 0.4 + (hold ?? 0.4);
    case 'drag': return mv + cfg.drag + (hold ?? 0.6);
    case 'scroll': return cfg.scroll + (hold ?? 0.2);
    case 'zoom': case 'pan': return cfg.zoomIn[sp] + (hold ?? 0.3);
    case 'unzoom': return cfg.zoomIn[sp] + (hold ?? 0.2);
    case 'use': return 2;   // unknown macro body; vibe expands macros when it can
    case 'run': return hold ?? 0.5;
    default: return 0;
  }
}

/**
 * Simulate a parsed script → a flat list of {node, t0, t1, edited: {t0, t1}, cut, fast} plus
 * caption spans, using the same rules as the player. `edited` times are what the viewer sees.
 */
export function simulate(steps, cfg = DEFAULTS) {
  const out = [];
  const captions = [];
  let raw = 0;
  let ed = 0;
  let cap = null;   // {text, t0 (edited), need}
  const flushCaption = (atEd) => {
    if (!cap) return 0;
    const left = Math.max(0, cap.t0 + cap.need - atEd);
    return left;
  };
  const visit = (nodes, ctx) => {
    for (const n of nodes) {
      if (n.verb === 'cut' || n.verb === 'fast' || n.verb === 'quiet' || n.verb === 'retry') {
        visit(n.children || [], { cut: ctx.cut || n.verb === 'cut', fast: n.verb === 'fast' ? (n.factor || 3) : ctx.fast });
        continue;
      }
      if (n.verb === 'say' || n.verb === 'hush') {
        // the previous caption must have been readable before it is replaced
        const wait = ctx.cut ? 0 : flushCaption(ed);
        if (wait > 0) { out.push({ node: { verb: 'read', line: n.line }, t0: raw, t1: raw + wait, ed0: ed, ed1: ed + wait, cut: false }); raw += wait; ed += wait; }
        if (cap) { cap.t1 = ed; captions.push(cap); cap = null; }
        if (n.verb === 'say' && !ctx.cut) {
          cap = { text: n.text, line: n.line, t0: ed, need: Math.max(readSeconds(n.text, cfg), n.opts?.hold || 0), top: n.mods?.includes('top') };
          if (n.mods?.includes('wait')) { const w = cap.need; out.push({ node: n, t0: raw, t1: raw + w, ed0: ed, ed1: ed + w }); raw += w; ed += w; continue; }
        }
        out.push({ node: n, t0: raw, t1: raw, ed0: ed, ed1: ed, cut: ctx.cut });
        continue;
      }
      const d = stepSeconds(n, cfg);
      const e = ctx.cut ? 0 : d / (ctx.fast || 1);
      out.push({ node: n, t0: raw, t1: raw + d, ed0: ed, ed1: ed + e, cut: !!ctx.cut, fast: ctx.fast || 0 });
      raw += d;
      ed += e;
    }
  };
  visit(steps, { cut: false, fast: 0 });
  const tail = flushCaption(ed);
  if (tail > 0) { out.push({ node: { verb: 'read', line: cap.line }, t0: raw, t1: raw + tail, ed0: ed, ed1: ed + tail }); raw += tail; ed += tail; }
  if (cap) { cap.t1 = ed; captions.push(cap); }
  return { items: out, captions, rawSeconds: raw, seconds: ed };
}
