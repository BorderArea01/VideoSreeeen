import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import type { ImageMeta, ImageStorage } from './images';

/** Only this process's own temporary directory is ever removed. */
export class ImageFiles implements ImageStorage {
  private root = mkdtemp(join(tmpdir(), 'videosreeeen-images-'));
  private metas = new Map<string, ImageMeta>();
  async list() {
    return [...this.metas.values()];
  }
  async meta(value: ImageMeta) {
    this.metas.set(value.id, { ...value });
  }
  async put(id: string, index: number, value: Uint8Array) {
    await writeFile(join(await this.root, `${id}-${index}`), value);
  }
  async get(id: string, index: number) {
    return readFile(join(await this.root, `${id}-${index}`)).catch(() => undefined);
  }
  async delete(value: ImageMeta) {
    for (let i = 0; i < Math.ceil(value.size / 65536); i++)
      await rm(join(await this.root, `${value.id}-${i}`), { force: true });
    this.metas.delete(value.id);
  }
  async close() {
    const root = resolve(await this.root);
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('videosreeeen-images-'))
      throw new Error('临时目录不在预期范围');
    await rm(root, { recursive: true, force: true });
  }
}
