// Trusted app main process only. Original-site session owns all credentials;
// neither Cookie headers nor account metadata are returned to the renderer.
const { net } = require('electron');
module.exports = function accountReader(siteSession, allowed) {
  return (url, signal) =>
    new Promise((resolve, reject) => {
      if (!allowed(url)) return reject(new Error('B 站本机识别地址无效'));
      signal.throwIfAborted();
      const request = net.request({
        url,
        session: siteSession,
        credentials: 'include',
        redirect: 'error',
        referrerPolicy: 'unsafe-url',
      });
      request.setHeader('Referer', 'https://www.bilibili.com/');
      request.setHeader('Accept', 'application/json');
      let settled = false;
      const stop = () => {
        finish(new Error('已取消识别'));
        request.abort();
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', stop);
        error ? reject(error) : resolve(result);
      };
      signal.addEventListener('abort', stop, { once: true });
      request.on('error', () => finish(new Error('B 站本机接口连接失败，请稍后重试')));
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          finish(new Error(`B 站本机接口暂不可用（HTTP ${response.statusCode}）`));
          request.abort();
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 512 * 1024) {
            finish(new Error('B 站识别响应超过大小限制'));
            request.abort();
          } else chunks.push(chunk);
        });
        response.on('error', () => finish(new Error('B 站本机接口读取失败')));
        response.on('aborted', () => finish(new Error('B 站本机接口读取中断')));
        response.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
      });
      request.end();
    });
};
