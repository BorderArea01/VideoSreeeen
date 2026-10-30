const fs = require('node:fs/promises');
const path = require('node:path');
const DIRECTORY = 'VideoSreeeen-cache';
const namespace = (userData) =>
  require('node:crypto')
    .createHash('sha256')
    .update(path.resolve(userData).toLowerCase())
    .digest('hex')
    .slice(0, 16);
async function writable(root) {
  await fs.mkdir(root, { recursive: true });
  const test = path.join(root, `.write-check-${require('node:crypto').randomUUID()}`);
  const handle = await fs.open(test, 'wx');
  await handle.close();
  await fs.unlink(test);
  return root;
}
async function cacheRoot(userData, options = {}) {
  const config = path.join(userData, 'cache-location.json');
  let text;
  try {
    text = await fs.readFile(config, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (text !== undefined)
    try {
      const saved = JSON.parse(text);
      if (
        !path.isAbsolute(saved.root) ||
        path.basename(saved.root) !== namespace(userData) ||
        path.basename(path.dirname(saved.root)) !== DIRECTORY
      )
        throw new Error('缓存目录设置无效');
      return await writable(saved.root);
    } catch (error) {
      throw new Error('所选缓存盘不可用，请在设置中重新选择；不会改用系统盘。');
    }
  const drive = options.drive ?? (process.platform === 'win32' ? 'D:\\' : undefined);
  if (drive) {
    try {
      await fs.access(drive);
      return await writable(path.join(drive, DIRECTORY, namespace(userData)));
    } catch {}
  }
  return writable(path.join(userData, 'cache', DIRECTORY, namespace(userData)));
}
async function saveCacheRoot(userData, parent) {
  const root = await writable(path.join(path.resolve(parent), DIRECTORY, namespace(userData)));
  await fs.writeFile(path.join(userData, 'cache-location.json'), JSON.stringify({ root }));
  return root;
}
module.exports = { cacheRoot, saveCacheRoot };
