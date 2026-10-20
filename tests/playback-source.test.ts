import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describePlaybackError,
  sourceDiagnostics,
  waitForPlayable,
} from '../client/playback-source';

test('播放错误区分下载、解码和超时，不把错误 4 判成确定的权限或网络故障', () => {
  assert.match(describePlaybackError(2).title, /下载中断/);
  assert.match(describePlaybackError(3).title, /解码失败/);
  assert.match(describePlaybackError(null, true).title, /超时/);
  assert.match(describePlaybackError(4).description, /连接、源站响应或格式/);
});

test('共同播放诊断保留错误码、端口和编解码能力，不导出路径、凭证或底层错误消息', () => {
  const video = {
    currentSrc: 'https://user:password@play.xfvod.pro:8088/private/movie.mp4?token=secret#fragment',
    networkState: 3,
    error: { code: 4, message: 'secret signed URL' },
    canPlayType: () => '',
  } as unknown as HTMLVideoElement;
  const audio = { error: null, canPlayType: () => 'probably' } as unknown as HTMLAudioElement;
  const output = sourceDiagnostics(video, audio);
  assert.deepEqual(output.source, { protocol: 'https:', host: 'play.xfvod.pro', port: '8088' });
  assert.deepEqual(output.error, { code: 4, track: 'video' });
  assert.equal(output.codecs.hevc, '');
  assert.doesNotMatch(JSON.stringify(output), /private|movie|token|secret|password|fragment|user/);
});

test('首帧等待支持取消，迟到的加载完成不能恢复旧任务', async () => {
  const video = Object.assign(new EventTarget(), {
    error: null,
    readyState: 0,
  }) as unknown as HTMLVideoElement;
  const request = new AbortController();
  const waiting = waitForPlayable(video, request.signal);
  request.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  video.dispatchEvent(new Event('loadeddata'));
  const next = waitForPlayable(video, new AbortController().signal);
  video.dispatchEvent(new Event('loadeddata'));
  await next;
});
