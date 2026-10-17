const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const BLOCK = 256 * 1024;
const MAX = 4 * 1024 ** 3;
const nameOK = (s) =>
  typeof s === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(s) &&
  !s.includes('..') &&
  s !== 'complete.json';
class BlockCache {
  constructor(cache) {
    this.cache = cache;
    this.jobs = new Map();
    this.requests = new Map();
    this.cancelled = new Set();
  }
  cancel(id) {
    this.cancelled.add(id);
    if (this.cancelled.size > 256) this.cancelled.delete(this.cancelled.values().next().value);
    this.jobs.delete(id);
    for (const [controller, job] of this.requests) if (job === id) controller.abort();
  }
  async call(p) {
    if (['probe', 'fetch', 'text'].includes(p.action)) return this.network(p);
    const dir = this.cache.directory(p.jobId);
    if (this.cancelled.has(p.jobId)) throw new Error('缓存任务已取消');
    if (p.action === 'init') {
      if (this.jobs.size || this.cache.jobs.size) throw new Error('已有缓存任务');
      if (!Array.isArray(p.files) || !p.files.length || p.files.length > 2)
        throw new Error('分块计划无效');
      const total = p.files.reduce((n, f) => n + f.size, 0);
      const space = await fs.statfs(this.cache.root);
      if (
        !Number.isSafeInteger(total) ||
        total <= 0 ||
        total > Math.min(MAX, Number(space.bavail) * Number(space.bsize) - 256 * 1024 ** 2)
      )
        throw new Error('分块缓存超过可用磁盘空间');
      const files = new Map();
      for (const f of p.files) {
        if (!nameOK(f.name) || !Number.isSafeInteger(f.size) || f.size <= 0 || files.has(f.name))
          throw new Error('分块文件无效');
        files.set(f.name, { size: f.size, blocks: new Set() });
      }
      if (!files.has(p.entry) || (p.audio && !files.has(p.audio))) throw new Error('缓存入口无效');
      await fs.mkdir(dir, { recursive: true });
      if (this.cancelled.has(p.jobId)) {
        await fs.rm(dir, { recursive: true, force: true });
        throw new Error('缓存任务已取消');
      }
      this.jobs.set(p.jobId, { files, entry: p.entry, audio: p.audio });
      return {};
    }
    const job = this.jobs.get(p.jobId);
    if (!job) throw new Error('缓存任务已取消');
    if (p.action === 'finish') {
      const hashes = [];
      let bytes = 0;
      for (const [name, f] of job.files) {
        if (f.blocks.size !== Math.ceil(f.size / BLOCK)) throw new Error('分块尚未完整');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path.join(dir, name))) hash.update(chunk);
        hashes.push(hash.digest('hex'));
        bytes += f.size;
      }
      if (this.jobs.get(p.jobId) !== job) throw new Error('缓存任务已取消');
      const fingerprint = createHash('sha256').update(hashes.join('\n')).digest('hex');
      await fs.writeFile(path.join(dir, 'complete.json'), JSON.stringify({ bytes, fingerprint }));
      return {
        state: 'ready',
        jobId: p.jobId,
        progress: 1,
        bytes,
        fingerprint,
        entry: `vs-cache://${p.jobId}/${job.entry}`,
        ...(job.audio ? { audio: `vs-cache://${p.jobId}/${job.audio}` } : {}),
      };
    }
    const f = job.files.get(p.name);
    if (
      !f ||
      !Number.isSafeInteger(p.offset) ||
      p.offset < 0 ||
      p.offset % BLOCK !== 0 ||
      p.offset >= f.size
    )
      throw new Error('分块地址无效');
    const length = Math.min(BLOCK, f.size - p.offset);
    const file = path.join(dir, p.name);
    if (p.action === 'put') {
      if (typeof p.data !== 'string' || p.data.length > 350000) throw new Error('分块过大');
      const data = Buffer.from(p.data, 'base64');
      if (data.length !== length) throw new Error('分块长度不符');
      let handle;
      try {
        handle = await fs.open(file, 'r+');
      } catch {
        handle = await fs.open(file, 'w+');
      }
      try {
        await handle.write(data, 0, length, p.offset);
      } finally {
        await handle.close();
      }
      if (this.jobs.get(p.jobId) !== job) throw new Error('缓存任务已取消');
      f.blocks.add(p.offset);
      return {};
    }
    if (p.action === 'get' && f.blocks.has(p.offset)) {
      const handle = await fs.open(file, 'r');
      try {
        const data = Buffer.alloc(length);
        const { bytesRead } = await handle.read(data, 0, length, p.offset);
        if (bytesRead !== length) throw new Error('分块读取不完整');
        return data.toString('base64');
      } finally {
        await handle.close();
      }
    }
    throw new Error('分块不可用');
  }
  async network(p) {
    this.cache.directory(p.jobId);
    if (this.cancelled.has(p.jobId)) throw new Error('缓存任务已取消');
    const url = new URL(p.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('下载地址无效');
    const headers = { 'Accept-Encoding': 'identity' };
    if (p.referer && /^https?:\/\//.test(p.referer)) headers.Referer = p.referer;
    if (p.action !== 'text') {
      if (
        !Number.isSafeInteger(p.offset ?? 0) ||
        (p.offset ?? 0) < 0 ||
        !Number.isSafeInteger(p.length ?? 1) ||
        (p.length ?? 1) < 1 ||
        (p.length ?? 1) > BLOCK
      )
        throw new Error('下载范围无效');
      headers.Range = `bytes=${p.offset ?? 0}-${(p.offset ?? 0) + (p.length ?? 1) - 1}`;
    }
    const controller = new AbortController();
    this.requests.set(controller, p.jobId);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(url, { headers, signal: controller.signal });
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
      if (
        !r.ok ||
        (p.action !== 'text' &&
          (r.status !== 206 ||
            !match ||
            Number(match[1]) !== (p.offset ?? 0) ||
            Number(match[2]) !== (p.offset ?? 0) + (p.length ?? 1) - 1))
      ) {
        await r.body?.cancel();
        throw new Error('源站不支持安全分块下载');
      }
      const reader = r.body.getReader();
      const parts = [];
      let size = 0;
      const max = p.action === 'text' ? 2 * 1024 ** 2 : (p.length ?? 1);
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > max) {
          await reader.cancel();
          throw new Error('下载超过分块上限');
        }
        parts.push(Buffer.from(part.value));
      }
      if (p.action !== 'text' && size !== max) throw new Error('分块未完整下载');
      if (p.action === 'probe') return { size: Number(match[3]) };
      const data = Buffer.concat(parts);
      return p.action === 'text' ? data.toString('utf8') : data.toString('base64');
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }
}
module.exports = { BlockCache };
