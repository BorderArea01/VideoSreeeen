import { isNative, nativeCall, onNative } from './native';

export function setupUpdates() {
  const $ = (id: string) => document.getElementById(id)!;
  const status = $('update-status'),
    action = $('update-action') as HTMLButtonElement;
  let state = 'idle';
  const render = (value: any) => {
    state = value.state;
    status.textContent =
      (
        {
          idle: '',
          checking: '正在检查更新…',
          current: '已是最新版本',
          available: `发现 ${value.next ?? ''} 新版本`,
          downloading: `正在下载 ${Math.round(value.progress ?? 0)}%`,
          ready: value.message || '下载完成，安装后保留设置',
          portable: value.message,
          error: value.message,
        } as Record<string, string>
      )[state] ?? '';
    action.textContent =
      state === 'available' ? '下载更新' : state === 'ready' ? '安装更新' : '检查更新';
    action.disabled = ['checking', 'downloading', 'portable'].includes(state);
  };
  if (!isNative) {
    action.hidden = true;
    status.textContent = '网页刷新即可使用已发布版本';
    return;
  }
  const run = async (command: string) => {
    action.disabled = true;
    try {
      render(await nativeCall('update', { action: command }));
    } catch (e) {
      render({ state: 'error', message: e instanceof Error ? e.message : '更新失败' });
    }
  };
  action.onclick = () =>
    void run(state === 'available' ? 'download' : state === 'ready' ? 'install' : 'check');
  onNative((type, data) => {
    if (type === 'update') render(data);
  });
  void run('status');
  setTimeout(() => {
    if (state === 'idle') void run('check');
  }, 5000);
}
