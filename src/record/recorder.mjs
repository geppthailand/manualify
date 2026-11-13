/**
 * Recorder: Chrome DevTools screencast → ffmpeg → short mp4 chunks.
 *
 * Why chunks: a take is written once, straight to H.264 (no JPEG frame folders, no repack
 * pass), and any moment is reachable by opening ONE chunk and seeking ≤ 1 s (GOP = 1 s).
 * Static screens cost almost nothing — duplicated frames compress to skip blocks.
 *
 * Time base: frames are written at a fixed rate against the wall clock (the latest
 * screencast frame is repeated until a new one arrives), so video time == seconds since
 * start(). Timeline events use the same clock (rec.now()).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class Recorder {
  /**
   * @param {import('playwright').Page} page
   * @param {object} o
   * @param {string} o.dir           take directory (chunks land in <dir>/chunks)
   * @param {{w:number,h:number}} o.frame  capture size in device px (viewport × DSF)
   * @param {number} [o.fps=30]
   * @param {number} [o.chunkSeconds=10]
   * @param {string} [o.encoder='libx264']  or 'h264_videotoolbox'
   * @param {number} [o.quality=85]   screencast JPEG quality
   */
  constructor(page, o) {
    this.page = page;
    this.dir = o.dir;
    this.frame = o.frame;
    this.fps = o.fps || 30;
    this.chunkSeconds = o.chunkSeconds || 10;
    this.encoder = o.encoder || 'libx264';
    this.quality = o.quality || 85;
    this.latest = null;
    this.written = 0;
    this.t0 = 0;
    this.late = 0;
    this.running = false;
  }

  /** Seconds since recording started (the video clock). */
  now() { return this.running || this.t0 ? (performance.now() - this.t0) / 1000 : 0; }

  async start() {
    const chunks = path.join(this.dir, 'chunks');
    fs.mkdirSync(chunks, { recursive: true });
    const enc = this.encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-q:v', '70', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-tune', 'stillimage'];
    const g = String(this.fps);   // keyframe every second → any seek decodes ≤ 1 s
    this.ff = spawn('ffmpeg', [
      '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(this.fps), '-i', 'pipe:0',
      '-vf', `scale=${this.frame.w}:${this.frame.h}:flags=lanczos,format=yuv420p`,
      ...enc, '-g', g, '-keyint_min', g, '-sc_threshold', '0',
      '-force_key_frames', `expr:gte(t,n_forced*${this.chunkSeconds})`,
      '-f', 'segment', '-segment_time', String(this.chunkSeconds), '-segment_format', 'mp4',
      '-reset_timestamps', '1', '-segment_list', path.join(this.dir, 'chunks.csv'),
      '-segment_list_type', 'csv', path.join(chunks, '%04d.mp4'),
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.ffErr = '';
    this.ff.stderr.on('data', (d) => { this.ffErr += d; });
    this.ffDone = new Promise((res) => this.ff.on('close', res));
    this.ff.stdin.on('error', () => {});

    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (f) => {
      this.latest = Buffer.from(f.data, 'base64');
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: this.quality, maxWidth: this.frame.w, maxHeight: this.frame.h, everyNthFrame: 1,
    });
    // first frame before the clock starts, so t = 0 already shows the page
    for (let i = 0; i < 100 && !this.latest; i++) await new Promise((r) => setTimeout(r, 20));
    if (!this.latest) this.latest = await this.page.screenshot({ type: 'jpeg', quality: this.quality });
    this.t0 = performance.now();
    this.running = true;
    this.tick = setInterval(() => this.pump(), 1000 / this.fps / 2);
    this.pump();
  }

  pump() {
    if (!this.running || !this.latest) return;
    const due = Math.floor(((performance.now() - this.t0) / 1000) * this.fps) + 1;
    if (due - this.written > 2) this.late++;
    while (this.written < due) {
      this.ff.stdin.write(this.latest);
      this.written++;
    }
  }

  /** Stop, flush, and return the chunk index [{file, start, end}]. */
  async stop() {
    this.pump();
    this.running = false;
    clearInterval(this.tick);
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await this.cdp.detach().catch(() => {});
    this.ff.stdin.end();
    const code = await this.ffDone;
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${this.ffErr.trim().slice(-400)}`);
    return readChunkIndex(this.dir);
  }

  stats() {
    return { frames: this.written, seconds: +(this.written / this.fps).toFixed(2), lateTicks: this.late };
  }
}

/** chunks.csv → [{file, start, end}] (file relative to the take dir). */
export function readChunkIndex(dir) {
  const csv = path.join(dir, 'chunks.csv');
  if (!fs.existsSync(csv)) return [];
  return fs.readFileSync(csv, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    const [file, start, end] = l.split(',');
    return { file: path.join('chunks', file), start: +start, end: +end };
  });
}
