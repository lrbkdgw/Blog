# Magic UI · 本地集成

本目录是 **Magic UI 官方组件源码的本地适配版本**，不是仅借鉴样式或仅安装依赖。Magic UI 以源码组件形式分发；这里只引入实际使用的六个组件，不安装其 Next.js 文档站或整套脚手架。

- 上游：<https://github.com/magicuidesign/magicui>
- 固定版本：[`85f97fd27b053339af74ba9dd4ca428ee25989fb`](https://github.com/magicuidesign/magicui/tree/85f97fd27b053339af74ba9dd4ca428ee25989fb)
- 许可：**MIT，Copyright (c) Magic UI**。完整原文保存在 [`public/licenses/magic-ui-MIT.txt`](../../../public/licenses/magic-ui-MIT.txt)，生产构建会一同分发至 `<base>/licenses/magic-ui-MIT.txt`。
- 依赖：`motion` 12、`clsx` 2、兼容 Tailwind CSS 3 的 `tailwind-merge` 2。不使用 Radix UI、cmdk、shadcn 脚手架或 next-themes。

## 组件与实际入口

| 官方组件源码（固定版本） | 本项目入口 | 适配说明 |
| --- | --- | --- |
| [Magic Card](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/magic-card.tsx) | `PostCard.tsx` | 保留 Motion 径向边缘、聚光与 spring 光球；极光/霓虹主题使用光球，其余使用径向聚光。接入现有主题色，完整动效且细指针鼠标时才响应；关闭时重置目标并停止 spring。保留原生 article、标题链接及所有文章元信息。 |
| [Border Beam](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/border-beam.tsx) | `Home.tsx` 的介绍区边缘 | 保留 offset-path / offset-distance 循环，使用主题色与圆角。移出视口、页面隐藏、关闭动效或打印时卸载运动轨迹；缺少 IntersectionObserver 时退回静态边框。 |
| [Shimmer Button](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/shimmer-button.tsx) | `Home.tsx` 的阅读、空状态与加载更多按钮 | 保留锥形渐变、滑动/旋转高光与内层底板。原生 button 默认 `type="button"`；新增同层结构的 `ShimmerLink` 路由链接，避免嵌套交互元素并保留 `/Blog/` base。 |
| [Blur Fade](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/blur-fade.tsx) | `Reveal.tsx` → 文章列表 | 保留方向、模糊、透明度 variants 与一次性视口显现。移除不需要的退出动画，限制交错延迟；动效禁用/缺少观察 API 时始终可见，键盘聚焦立即清晰显示。 |
| [Aurora Text](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/aurora-text.tsx) | `Home.tsx` 的标题强调文字 | 保留渐变流动与辅助技术的单一文本读法，去掉旋转/缩放以保持阅读稳定；深浅主题使用不同的可读强调色。 |
| [Shine Border](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/shine-border.tsx) | `AppearanceSettings.tsx` 的选中主题 | 保留径向渐变、遮罩与移动边框；仅装饰选中的原生 radio，使用非交互 span，保留键盘与焦点行为。 |

## 共用适配

- [`src/lib/utils.ts`](../../lib/utils.ts) 来自官方 [`registry/lib/utils.ts`](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/lib/utils.ts) 的 `clsx + twMerge` 工具。
- [`src/styles/magicui.css`](../../styles/magicui.css) 移植组件样式和官方 [`registry-ui.ts`](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/registry-ui.ts) 的 `aurora`、`shimmer-slide`、`spin-around`、`shine` keyframes，并加命名空间。将 Tailwind 4 专用语法改成 Tailwind 3 / 标准 CSS；不要求升级构建链。
- Magic Card 的 `next-themes` 改用已有 `useTheme`；Motion template hooks 移到固定位置，支持主题间切换 gradient / orb 而不改变 Hook 顺序。
- [`src/lib/visualEffects.tsx`](../../lib/visualEffects.tsx) 统一监听有效动效档位（已经包含系统减少动态效果）、页面可见性、打印和细指针；采用 `LazyMotion + domAnimation + m`。不仅设置 CSS，还切实移除无限 Motion 动画、立即结束显现动画、停止 spring。
- CSS 动画在隐藏时暂停，动效关闭/系统减少动态效果/打印时不运行。焦点、强制颜色和打印都有静态可读回退；装饰层使用 `aria-hidden` 与 `pointer-events: none`。
- Magic UI 样式仅由 `main.tsx` 引入，不进入 VS Code 共享 Markdown 样式入口。背景 Canvas、原创 SVG、主题偏好及 GitHub 写作发布流程保持独立。

升级上游时请先核对固定源码与本地适配，再运行 `npm test`、生产构建、真实浏览器外观回归和 VS Code 插件回归；不要用脚手架覆盖本目录或重新引入被排除的依赖。
