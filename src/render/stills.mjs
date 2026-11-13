/**
 * Stills straight from the chunks: open the one chunk that holds time t, seek ≤ 1 s, grab a
 * frame at recording resolution (viewport × scale). Nothing is stored until asked for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadChain } from './edl.mjs';
import { ffmpeg } from './render.mjs';

/** Locate raw time t → {file, local} across a (possibly resumed) take chain. */
export function chunkAt(chain, t) {
  for (const src of chain.sources) {
    if (t < src.shift + src.from || t > src.shift + src.to) continue;
    const local = t - src.shift;
    const c = src.chunks.find((k) => local >= k.start && local < k.end) || src.chunks[src.chunks.length - 1];
    return { file: path.join(src.dir, c.file), local: Math.max(0, local - c.start) };
  }
  return null;
}

export async function grab(chain, t, outFile, { crop = null, scale = 1, width = null } = {}) {
  const at = chunkAt(chain, t);
  if (!at) throw new Error(`t=${t} is outside the take`);
  const vf = [];
  if (crop) {
    const c = { x: Math.max(0, Math.round(crop.x * scale)), y: Math.max(0, Math.round(crop.y * scale)), w: Math.round(crop.width * scale), h: Math.round(crop.height * scale) };
    vf.push(`crop=${c.w}:${c.h}:${c.x}:${c.y}`);
  }
  if (width) vf.push(`scale=${width}:-2`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await ffmpeg(['-y', '-loglevel', 'error', '-ss', String(at.local.toFixed(3)), '-i', at.file, ...(vf.length ? ['-vf', vf.join(',')] : []), '-frames:v', '1', outFile]);
  return outFile;
}

/** Every `shot` in the take → <out>/stills/<id>/<name>.png (cropped to clip=, padded 16 px). */
export async function stills(takeDir, cfg) {
  const chain = loadChain(takeDir);
  const shots = chain.events.filter((e) => e.type === 'shot');
  const dir = path.join(cfg.outDir, 'stills', chain.take.id);
  const files = [];
  for (const s of shots) {
    const pad = 16;
    const crop = s.rect ? { x: s.rect.x - pad, y: s.rect.y - pad, width: s.rect.width + 2 * pad, height: s.rect.height + 2 * pad } : null;
    if (crop) {
      crop.x = Math.max(0, crop.x); crop.y = Math.max(0, crop.y);
      crop.width = Math.min(chain.take.viewport.width - crop.x, crop.width);
      crop.height = Math.min(chain.take.viewport.height - crop.y, crop.height);
    }
    files.push(await grab(chain, s.t + 0.05, path.join(dir, `${s.name}.png`), { crop, scale: chain.take.scale }));
  }
  return files;
}
