import { icon } from './icons';

export type PlaybackChoice = 'screen' | 'link' | 'file';

export const playbackPickerMarkup = `
<section id="playback-picker" class="source-card">
  <div class="section-heading"><span>${icon('film', 18)} 播放方式</span><span id="current-playback" class="current-playback" role="status">尚未选择视频</span></div>
  <div class="playback-tabs" role="tablist" aria-label="选择或更换视频的方式">
    <button id="choose-screen" role="tab" aria-selected="true" aria-controls="screen-choice" tabindex="0">${icon('expand', 18)}<span>共享画面<small>一人播放，全员观看</small></span></button>
    <button id="choose-link" role="tab" aria-selected="false" aria-controls="link-choice" tabindex="-1">${icon('link', 18)}<span>共同播放<small>各自加载，同步进度</small></span></button>
    <button id="choose-file" role="tab" aria-selected="false" aria-controls="file-choice" tabindex="-1">${icon('film', 18)}<span>本地视频<small>选择文件，实时提供</small></span></button>
  </div>
  <section id="screen-choice" class="playback-choice" role="tabpanel" aria-labelledby="choose-screen">
    <p class="playback-copy">适合 B 站等网站。提供者在原站播放，观众直接接收画面；进度在原站操作。</p>
    <div class="choice-actions"><button id="broadcast-screen" class="button accent" type="button" title="选择正在播放视频的标签页，并勾选共享音频">选择标签页 / 屏幕</button><button id="broadcast-site" class="button accent" type="button" hidden>共享客户端原站画面</button></div>
    <p id="screen-unavailable" class="dialog-note" hidden>此设备不能提供屏幕画面，可以接收电脑成员的共享，或选择本地视频。</p>
    <details id="screen-open-details" class="advanced"><summary>还没打开原站？</summary><form id="screen-page-form" class="source-form"><span class="input-icon">${icon('link', 18)}</span><input id="screen-page-url" type="url" aria-label="原站页面地址" placeholder="粘贴 B 站、喜番或蜜柑页面地址" required><button class="button soft" type="submit">打开原站</button></form><p id="screen-open-note" class="dialog-note">原站播放后，回到这里选择该标签页。仅打开原站不会开始共享。</p></details>
  </section>
  <section id="link-choice" class="playback-choice" role="tabpanel" aria-labelledby="choose-link" hidden>
    <p id="link-capability" class="playback-copy"></p>
    <form id="source-form" class="source-form"><span class="input-icon">${icon('link', 18)}</span><input id="source-url" type="url" aria-label="视频页面或视频文件地址" placeholder="粘贴 MP4、WebM 或 HLS 视频直链" required><button class="button accent" type="submit">同步此链接</button></form>
    <div id="link-unavailable" class="link-unavailable" hidden><p id="link-error" role="alert"></p><button id="link-use-screen" class="button soft" type="button">改用共享画面</button></div>
    <details id="site-source-options" class="advanced" hidden><summary>原站与视频源</summary><div class="site-chips"><button data-site="bilibili">哔哩哔哩</button><button data-site="xifan">喜番</button><button data-site="mgn">蜜柑</button></div><button id="extract-button" class="text-button" hidden title="仅适用于房间成员均可直接访问的视频源">识别并共享原站视频源</button></details>
  </section>
  <section id="file-choice" class="playback-choice" role="tabpanel" aria-labelledby="choose-file" hidden><p class="playback-copy">选择本机视频，实时传给房间；提供者保持在线。无需整部上传，支持同步暂停和进度。</p><button id="local-video-button" class="button accent" type="button">选择视频文件</button><input id="local-video-input" type="file" accept="video/*,.mkv,.mp4,.webm,.mov" hidden><small class="file-format" title="实际格式支持取决于当前浏览器或客户端的解码器">推荐 H.264 / AAC 的 MP4 文件</small></section>
  <div id="active-source" class="source-actions active-source" hidden><span id="provider" class="subtle"></span><span id="broadcast-status" class="subtle" role="status"></span><button id="next-episode" class="button soft small" type="button" title="读取原站剧集列表，让整个房间切换到下一集；B站支持同一视频的分P" hidden>下一集 →</button><button id="stop-broadcast" class="text-button" type="button" hidden>停止共享</button></div>
</section>`;

// This selection only changes the input panel. The room's playback mode remains
// authoritative and changes only when a video is actually submitted or shared.
export class PlaybackPicker {
  private selected: PlaybackChoice = 'screen';
  private observedMedia = '';
  constructor(private changed?: (choice: PlaybackChoice) => void) {
    const choices: PlaybackChoice[] = ['screen', 'link', 'file'];
    for (const choice of choices) {
      const tab = document.getElementById('choose-' + choice)!;
      tab.onclick = () => this.select(choice);
      tab.onkeydown = (event) => {
        const index = choices.indexOf(this.selected);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 2
              : event.key === 'ArrowRight'
                ? (index + 1) % 3
                : event.key === 'ArrowLeft'
                  ? (index + 2) % 3
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        this.select(choices[next]!);
        document.getElementById('choose-' + this.selected)!.focus();
      };
    }
  }
  select(choice: PlaybackChoice) {
    this.selected = choice;
    this.changed?.(choice);
    for (const mode of ['screen', 'link', 'file']) {
      const tab = document.getElementById('choose-' + mode)!;
      tab.setAttribute('aria-selected', String(mode === choice));
      tab.tabIndex = mode === choice ? 0 : -1;
      document.getElementById(mode + '-choice')!.hidden = mode !== choice;
    }
  }
  observe(mediaId: string, actual: PlaybackChoice) {
    if (mediaId === this.observedMedia) return;
    this.observedMedia = mediaId;
    if (mediaId) this.select(actual);
  }
}
