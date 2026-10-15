# Magic UI · 本地集成

本目录是 **Magic UI 官方组件源码的本地适配版本**，不是仅借鉴样式或仅安装依赖。Magic UI 以源码组件形式分发；这里只引入实际使用的十组组件，不安装其 Next.js 文档站或整套脚手架。

- 上游：<https://github.com/magicuidesign/magicui>
- 固定版本：[`85f97fd27b053339af74ba9dd4ca428ee25989fb`](https://github.com/magicuidesign/magicui/tree/85f97fd27b053339af74ba9dd4ca428ee25989fb)
- 许可：**MIT，Copyright (c) Magic UI**。完整原文保存在 [`public/licenses/magic-ui-MIT.txt`](../../../public/licenses/magic-ui-MIT.txt)，生产构建会一同分发至 `<base>/licenses/magic-ui-MIT.txt`。
- 依赖：`motion` 12、`clsx` 2、兼容 Tailwind CSS 3 的 `tailwind-merge` 2。不使用 Radix UI、cmdk、shadcn 脚手架或 next-themes。

## 组件与实际入口

| 官方组件源码（固定版本） | 本项目入口 | 适配说明 |
| --- | --- | --- |
| [Magic Card](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/magic-card.tsx) | `PostCard.tsx` | 保留 Motion 径向边缘、聚光与 spring 光球；极光/霓虹主题使用光球，其余使用径向聚光。接入现有主题色，完整动效且细指针鼠标时才响应；关闭时重置目标并停止 spring。新增真正透明的 surface：移除内层实色填充，用遮罩仅绘制边框；用于文章、相邻文章导航与标签。文章内容由 BentoCard 保留原生 article、标题链接及所有元信息。 |
| [Border Beam](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/border-beam.tsx) | `PostCard.tsx` 首张置顶文章的边缘 | 保留 offset-path / offset-distance 循环，使用主题色与圆角。移出视口、页面隐藏、关闭动效或打印时卸载运动轨迹；缺少 IntersectionObserver 时退回静态边框。 |
| [Shimmer Button](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/shimmer-button.tsx) | `Home.tsx` 的空状态与加载更多按钮 | 保留锥形渐变、滑动/旋转高光与内层底板。原生 button 默认 `type="button"`；新增同层结构的 `ShimmerLink` 路由链接，避免嵌套交互元素并保留 `/Blog/` base。 |
| [Blur Fade](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/blur-fade.tsx) | `Reveal.tsx` → 文章列表 | 保留方向、模糊、透明度 variants 与一次性视口显现。移除不需要的退出动画，限制交错延迟；动效禁用/缺少观察 API 时始终可见，键盘聚焦立即清晰显示。 |
| [Aurora Text](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/aurora-text.tsx) | `Home.tsx` 的文章列表标题 | 保留渐变流动与辅助技术的单一文本读法，去掉旋转/缩放以保持阅读稳定；深浅主题使用不同的可读强调色。 |
| [Shine Border](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/shine-border.tsx) | `AppearanceSettings.tsx` 的选中主题与 `Layout.tsx` 的当前导航 | 保留径向渐变、遮罩与移动边框；仅装饰选中的原生 radio / 导航链接，使用非交互 span，保留键盘与焦点行为。 |
| [Bento Grid / Bento Card](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/bento-grid.tsx) | `PostGrid.tsx` → 首页 / 标签文章列表 | 保留网格、背景槽与 CTA 层结构，改为适合文章的错落 2:1 / 1:2 排布、移动单列、原生 article 和唯一标题链接；增加元信息/标签槽，去掉实色底板。上游 Radix 图标和 shadcn Button 换成已有 Lucide 与路由链接，不引入 Radix。 |
| [Dock](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/dock.tsx) | `Layout.tsx` 的桌面主导航 | 保留距离映射、MotionValue 与 spring 放大；支持键盘聚焦和原生 NavLink。现有 cn 替代只用于静态类名的 cva；完整动效 + 精细指针时启用放大，关闭/隐藏/打印时复位，手机保留原生菜单。 |
| [Number Ticker](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/number-ticker.tsx) | 首页、归档和标签的文章数量 | 保留视口触发与 spring 数值动画，新增立即准确的辅助技术文本、关闭/缺失 API 时的最终值回退、计时器与 spring 清理；真实数量不依赖动画结束。 |
| [Scroll Progress](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/scroll-progress.tsx) | `PostPage.tsx` 的阅读进度 | 替换手写滚动监听/width 过渡，保留 useScroll + scaleX，用当前主题色并补充 progressbar 语义。它是跟随用户滚动的功能反馈，无循环/平滑补间，关闭动效时仍即时更新，打印隐藏。 |

## 共用适配

- [`src/lib/utils.ts`](../../lib/utils.ts) 来自官方 [`registry/lib/utils.ts`](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/lib/utils.ts) 的 `clsx + twMerge` 工具。
- [`src/styles/magicui.css`](../../styles/magicui.css) 移植组件样式和官方 [`registry-ui.ts`](https://github.com/magicuidesign/magicui/blob/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/registry-ui.ts) 的 `aurora`、`shimmer-slide`、`spin-around`、`shine` keyframes，并加命名空间。将 Tailwind 4 专用语法改成 Tailwind 3 / 标准 CSS；不要求升级构建链。
- Magic Card 的 `next-themes` 改用已有 `useTheme`；Motion template hooks 移到固定位置，支持主题间切换 gradient / orb 而不改变 Hook 顺序。
- [`src/lib/visualEffects.tsx`](../../lib/visualEffects.tsx) 统一监听有效动效档位（已经包含系统减少动态效果）、页面可见性、打印和细指针；采用 `LazyMotion + domAnimation + m`。不仅设置 CSS，还切实移除无限 Motion 动画、立即结束显现动画、停止 spring。
- CSS 动画在隐藏时暂停，动效关闭/系统减少动态效果/打印时不运行。焦点、强制颜色和打印都有静态可读回退；装饰层使用 `aria-hidden` 与 `pointer-events: none`。
- Magic UI 样式仅由 `main.tsx` 引入，不进入 VS Code 共享 Markdown 样式入口。背景 Canvas、原创 SVG、主题偏好及 GitHub 写作发布流程保持独立。

升级上游时请先核对固定源码与本地适配，再运行 `npm test`、生产构建、真实浏览器外观回归和 VS Code 插件回归；不要用脚手架覆盖本目录或重新引入被排除的依赖。

## 内容优先与透明背景

首页不再渲染介绍区、插画、统计、阅读入口或主题色带，主内容从文章标题和列表开始；主题仍在设置中选择。文章卡片、正文、相邻文章导航和标签卡片均没有白色/深色实色底板。只有边框与低透明度悬停高光覆盖背景；Markdown 代码块、表单和弹窗保留自己的可读样式。
