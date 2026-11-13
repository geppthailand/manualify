import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChain, buildEdl, cameraAt } from '../src/render/edl.mjs';

const take = (dir, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify(obj)); };
const base = { viewport: { width: 1600, height: 900 }, scale: 1.5, fps: 30, steps: [] };

test('cuts, fast spans and captions map to edited time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfy-'));
  take(dir, { ...base, duration: 20, chunks: [{ file: 'chunks/0000.mp4', start: 0, end: 10 }, { file: 'chunks/0001.mp4', start: 10, end: 20 }], events: [
    { t: 0, type: 'cut', on: true }, { t: 3, type: 'cut', on: false },
    { t: 3.5, type: 'caption', text: 'hello' },
    { t: 8, type: 'fast', factor: 4 }, { t: 12, type: 'fast', factor: 0 },
    { t: 13, type: 'camera', rect: { x: 0, y: 0, width: 800, height: 450 }, dur: 1 },
    { t: 15, type: 'caption', text: '' },
  ] });
  const edl = buildEdl(loadChain(dir));
  assert.equal(edl.duration, 14);                     // 0–3 cut; 3–8 normal, 8–12 at ×4, 12–20 normal → 5 + 1 + 8
  assert.deepEqual(edl.captions.map((c) => [c.t0, c.t1]), [[0.5, 9]]);
  assert.equal(edl.camera[0].t0, 7);                  // raw 13 → 5 + 1 + 1
  const mid = cameraAt(edl, 7.5, { x: 0, y: 0, width: 1600, height: 900 });
  assert.ok(mid.width < 1600 && mid.width > 800);
});

test('a resumed take keeps the previous take up to the resume point', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfy-'));
  const a = path.join(root, 'a'); const b = path.join(root, 'b');
  take(a, { ...base, duration: 30, chunks: [{ file: 'chunks/0000.mp4', start: 0, end: 30 }], events: [{ t: 2, type: 'caption', text: 'one' }, { t: 25, type: 'caption', text: 'lost' }] });
  take(b, { ...base, duration: 6, chunks: [{ file: 'chunks/0000.mp4', start: 0, end: 6 }], events: [{ t: 0.5, type: 'caption', text: 'two' }], resume: { of: '../a', fromLine: 9, at: 20 } });
  const chain = loadChain(b);
  assert.equal(chain.duration, 26);
  assert.deepEqual(chain.sources.map((s) => [s.shift, s.to]), [[0, 20], [20, 6]]);
  const edl = buildEdl(chain);
  assert.deepEqual(edl.captions.map((c) => c.text), ['one', 'two']);
});
