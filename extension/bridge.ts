declare const chrome: any;
const origin = location.origin;
if (window === window.top) {
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (
      event.source !== window ||
      event.origin !== origin ||
      message?.channel !== 'videosreeeen-source-request' ||
      typeof message.id !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(message.id) ||
      !['ping', 'resolve', 'next', 'cancel'].includes(message.action) ||
      (message.action !== 'ping' &&
        message.action !== 'cancel' &&
        (typeof message.url !== 'string' || message.url.length > 2048))
    )
      return;
    chrome.runtime
      .sendMessage({ id: message.id, action: message.action, url: message.url })
      .then((result: unknown) =>
        window.postMessage(
          { channel: 'videosreeeen-source-response', id: message.id, result },
          origin,
        ),
      )
      .catch(() =>
        window.postMessage(
          {
            channel: 'videosreeeen-source-response',
            id: message.id,
            result: { error: '扩展已更新或断开，请刷新本页', code: 'UNAVAILABLE' },
          },
          origin,
        ),
      );
  });
}
export {};
