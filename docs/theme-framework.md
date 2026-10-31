# 主题框架与维护

默认暖夜是常驻基础层；天光和紫电是独立扩展模块。主题随应用构建分发，运行时通过注册表加载、移除或重新注册，选择列表自动更新。新增主题不需要修改 `appearance.ts` 或其他主题。主题只拥有外观资源，房间、播放器、缓存、聊天和语音仍由原功能模块管理。

```text
client/themes/
  classic/                 默认基础样式、默认清单
  core/                    types / registry / controller / scope / picker
  shared/                  通用面板布局、结构样式、悬停抽样
  daylight/                天光：manifest / index / styles / controls / scene / fracture / assets
  signal/                  紫电：manifest / index / styles / motion / fonts / scene / assets
  catalog.ts               自动发现清单，注册已安装主题
```

`client/appearance.ts` 只负责偏好、随机分配和主题选择界面。默认样式从 `classic/base.css` 常驻加载；扩展模块的 CSS 使用 Vite `?inline` 返回文本，启用时由控制器安装，卸载时从页面移除。字体和图片在主题自己的目录，只有启用对应模块才申请资源；浏览器可以复用已下载资源缓存。没有同时运行的新旧场景类或第二套旧样式入口。

## 注册与生命周期

`ThemeDefinition` 提供 ID、名称、排序、浏览器栏颜色、轻量预览及 `load()`。`catalog.ts` 使用 `*/manifest.ts` 自动发现，入口由清单的动态导入按需加载；默认主题单独保证存在，不能卸载。旧偏好 ID `classic` / `glitch` / `signal` 保持兼容。

`ThemeController.select(id)` 保留当前主题直到新模块完成加载，再同步切换样式与效果。快速选择使用递增代次和注册实例核对，迟到模块不挂载。加载失败保留原主题并允许重试；挂载或释放失败清理可释放资源，退回常驻默认主题并显示不可用状态。正在加载的主题被移除或控制器销毁后，晚到响应也不能重新启用。

`ThemeScope` 统一持有事件监听、观察器、计时器、动画帧、装饰节点、样式和临时属性。卸载幂等，先中止事件并停止观察 / 定时 / 绘制，再执行自定义释放，恢复临时属性和删除装饰节点；一次释放失败不跳过后续释放。图片 `onload` 或第三方效果等附加资源使用 `defer()` 登记。异步回调使用 `guard()` 或检查 `signal`，不能在卸载后重新挂接资源。

公共 `PanelLayout` 通过锚点临时移动现有控件，卸载时放回原位置并删除锚点。它不包含主题 ID 判断，通过 `moveHeading` 等明确布局选项供模块选用；不移动或重建音视频元素，也不获取麦克风、改缓存、操作房间。主题专用规则限定在自己的 `data-theme` / 自有装饰节点内，借用的应用节点不归主题所有。

运行时维护示例，适用于应用内受信的开发代码：

```ts
import { themeRegistry } from '../client/themes/catalog';
import { themeController } from '../client/appearance';

const saved = themeRegistry.get('signal')!;
themeRegistry.unregister('signal'); // 当前正在使用时，恢复默认并释放紫电资源。
themeRegistry.register(saved); // 自动重新出现在选择界面。
await themeController.select('signal');
```

这套接口不修改用户当前媒体或播放进度。新目录需要经过一次构建进入分发包；“运行时装卸”和浏览器开发服务器的源码热更新分别处理。应用不从用户粘贴的链接加载主题脚本。

## 新增主题

新建 `client/themes/aurora/manifest.ts`，仅声明元数据与懒加载入口：

```ts
import type { ThemeDefinition } from '../core/types';

export default {
  id: 'aurora',
  name: '极光',
  order: 30,
  themeColor: '#123456',
  preview: { background: '#123456', panel: '#f7fbff', accent: '#2277dd', border: '#aaccee' },
  load: () => import('./index'),
} satisfies ThemeDefinition;
```

同目录 `index.ts`：

```ts
import css from './styles.css?inline';
import type { ThemeScope } from '../core/scope';

export const styles = [css];
export function mount(scope: ThemeScope) {
  const decoration = scope.own(document.createElement('div'));
  decoration.className = 'aurora-decoration';
  decoration.setAttribute('aria-hidden', 'true');
  document.body.prepend(decoration);
  // 使用 scope.listen / observe / timeout / frame / defer 管理附加效果。
}
```

同目录 `styles.css`：

```css
:root[data-theme='aurora'] {
  --bg: #123456;
  --panel: #f7fbff;
  --text: #123456;
  --orange: #2277dd;
}
.aurora-decoration {
  position: fixed;
  inset: 0;
  pointer-events: none;
}
```

预览由通用选择器读取清单生成。主题目录可按职责拆分样式、字体或绘制算法，但入口必须唯一；新功能直接归入本主题，替换旧规则，不叠加散落补丁。跨主题需求通过 `shared/` 显式共享，不能导入另一个主题的私有样式来“顺带”补齐布局。

## 验收与资产维护

- `tests/theme-framework.test.ts`：注册约束、快速切换、失败与重试、卸载 / 替换中迟到响应、释放错误、目录所有权。
- `npm run test:theme-framework`：隔离开发服务器加载真实应用模块，24 次切换、两主题卸载 / 重插、临时第三主题、资源归零、视频不重载和无房间操作；生产应用没有测试桥接。
- `npm run test:appearance`、`npm run test:signal-theme`：保持真实双端播放、语音接收、聊天、全屏、窄屏、字体、动效与像素保护。
- 控件改动继续执行 `test:daylight-controls` / `test:playback-tabs`，避免破坏统一按钮和既有高度修复。

所有任务沿用受控串行入口。原字体及来源记录移动到 `signal/assets/fonts/`，字体许可继续由公开 `licenses/fonts/` 分发；维护脚本 `scripts/fetch-theme-fonts.mjs` 已改用新目录。天光原图在 `daylight/assets/`。旧晴空原图保存在 `docs/design/legacy-assets/`，不再参与应用打包；历史验证文档中的旧文件路径和哈希代表当时的版本，当前源码以本指南为准。

采用 [Vite glob 清单与动态导入](https://vite.dev/guide/features.html#glob-import)、[CSS 文本导入](https://vite.dev/guide/features.html#disabling-css-injection-into-the-page) 和 [DOM AbortSignal 事件生命周期](https://dom.spec.whatwg.org/#dom-eventtarget-addeventlistener)，没有引入新的运行时第三方依赖。
