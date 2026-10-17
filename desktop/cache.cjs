const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const JOB = /^[a-f0-9-]{36}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;
class DiskCache {
  constructor(root, event, fetcher = fetch) {
    this.root = root;
    this.event = event;
    this.fetcher = fetcher;
    this.jobs = new Map();
  }
  directory(jobId) {
    if (!JOB.test(jobId)) throw new Error('Invalid cache ID');
    return path.join(this.root, jobId);
  }
  async init() {
    await fsp.mkdir(this.root, { recursive: true });
    for (const name of await fsp.readdir(this.root))
      if (JOB.test(name)) await fsp.rm(this.directory(name), { recursive: true, force: true });
  }
  async start({ jobId, plan }) {
    if (this.jobs.size) throw new Error('已有缓存任务，请先取消');
    if (
      !plan ||
      !Array.isArray(plan.files) ||
      !plan.files.length ||
      plan.files.length > 12002 ||
      !NAME.test(plan.entry) ||
      (plan.audio && !NAME.test(plan.audio))
    )
      throw new Error('缓存计划无效');
    const names = new Set();
    for (const file of plan.files) {
      if (
        !NAME.test(file.name) ||
        file.name.includes('..') ||
        file.name === 'complete.json' ||
        names.has(file.name) ||
        (!file.url && typeof file.content !== 'string')
      )
        throw new Error('缓存文件无效');
      names.add(file.name);
    }
    if (!names.has(plan.entry) || (plan.audio && !names.has(plan.audio)))
      throw new Error('缺少缓存入口');
    const dir = this.directory(jobId);
    await fsp.mkdir(dir, { recursive: true });
    const controller = new AbortController();
    const task = { controller, done: null };
    this.jobs.set(jobId, task);
    task.done = this.download(jobId, plan, dir, controller.signal).finally(() => {
      if (this.jobs.get(jobId) === task) this.jobs.delete(jobId);
    });
    // Completion is emitted asynchronously; rejecting promises are consumed here.
    task.done.catch(() => {});
    return { started: true };
  }
  async download(jobId, plan, dir, signal) {
    let bytes = 0,
      lastEvent = 0;
    const hashes = [];
    try {
      const space = await fsp.statfs(this.root);
      const budget = Math.min(
        4 * 1024 ** 3,
        Number(space.bavail) * Number(space.bsize) - 256 * 1024 ** 2,
      );
      if (budget < 32 * 1024 ** 2) throw new Error('可用磁盘空间不足');
      for (let index = 0; index < plan.files.length; index++) {
        signal.throwIfAborted();
        const file = plan.files[index];
        const output = path.join(dir, file.name);
        const hash = createHash('sha256');
        if (typeof file.content === 'string') {
          if (Buffer.byteLength(file.content) > 2 * 1024 ** 2) throw new Error('播放列表过大');
          await fsp.writeFile(output, file.content);
          hash.update(file.content);
          bytes += Buffer.byteLength(file.content);
        } else {
          const url = new URL(file.url);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('缓存下载地址无效');
          const response = await this.fetcher(url.href, { signal });
          if (!response.ok || !response.body) throw new Error(`视频下载失败 (${response.status})`);
          const expected = Number(response.headers.get('content-length') || 0);
          let count = 0;
          const meter = new Transform({
            transform: (chunk, _enc, done) => {
              bytes += chunk.length;
              count += chunk.length;
              hash.update(chunk);
              if (bytes > budget) {
                done(new Error('视频超过磁盘缓存上限'));
                return;
              }
              const now = Date.now();
              if (now - lastEvent > 800) {
                lastEvent = now;
                this.event({
                  jobId,
                  state: 'downloading',
                  bytes,
                  progress:
                    (index + (expected ? Math.min(0.99, count / expected) : 0)) / plan.files.length,
                });
              }
              done(null, chunk);
            },
          });
          await pipeline(
            Readable.fromWeb(response.body),
            meter,
            fs.createWriteStream(output + '.part'),
            { signal },
          );
          if (!count || (expected && expected !== count)) throw new Error('视频未完整下载');
          await fsp.rename(output + '.part', output);
        }
        hashes.push(hash.digest('hex'));
      }
      signal.throwIfAborted();
      // Manifest bytes differ from network URLs but are deterministic across clients.
      const fingerprint = createHash('sha256').update(hashes.join('\n')).digest('hex');
      await fsp.writeFile(
        path.join(dir, 'complete.json'),
        JSON.stringify({ entry: plan.entry, audio: plan.audio, bytes, fingerprint }),
      );
      this.event({
        jobId,
        state: 'ready',
        bytes,
        progress: 1,
        fingerprint,
        entry: `vs-cache://${jobId}/${plan.entry}`,
        ...(plan.audio ? { audio: `vs-cache://${jobId}/${plan.audio}` } : {}),
      });
    } catch (error) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (!signal.aborted)
        this.event({
          jobId,
          state: 'error',
          bytes,
          progress: 0,
          error: String(error.message || error).slice(0, 200),
        });
    }
  }
  async clear(jobId) {
    const task = this.jobs.get(jobId);
    if (task) {
      task.controller.abort();
      await task.done;
    }
    await fsp.rm(this.directory(jobId), { recursive: true, force: true });
    return {};
  }
  async stop() {
    for (const id of [...this.jobs.keys()]) await this.clear(id);
    for (const name of await fsp.readdir(this.root))
      if (JOB.test(name)) await fsp.rm(this.directory(name), { recursive: true, force: true });
  }
  async response(request) {
    const url = new URL(request.url);
    let dir;
    try {
      dir = this.directory(url.hostname);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!NAME.test(name) || name.includes('..')) return new Response('Not found', { status: 404 });
    try {
      await fsp.access(path.join(dir, 'complete.json'));
      const file = path.join(dir, name),
        stat = await fsp.stat(file);
      if (!stat.isFile()) return new Response('', { status: 404 });
      let start = 0,
        end = stat.size - 1,
        status = 200;
      const range = request.headers.get('range');
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m) return new Response('', { status: 416 });
        if (m[1]) {
          start = Number(m[1]);
          if (m[2]) end = Math.min(end, Number(m[2]));
        } else if (m[2]) start = Math.max(0, stat.size - Number(m[2]));
        if (start > end || start >= stat.size)
          return new Response('', {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}` },
          });
        status = 206;
      }
      const type = name.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : name.endsWith('.m4a')
          ? 'audio/mp4'
          : name.endsWith('.mp4')
            ? 'video/mp4'
            : 'application/octet-stream';
      const headers = {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
        status,
        headers,
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}
module.exports = { DiskCache };
