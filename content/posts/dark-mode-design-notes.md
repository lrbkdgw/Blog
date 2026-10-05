---
title: "做一个不刺眼的深色模式"
date: "2025-09-06"
updated: "2026-10-05"
summary: "纯黑背景 + 纯白文字并不是深色模式，它只是反色。记录一些关于对比度、层级和色彩的实践。"
---

很多网站的深色模式，是把 `#fff` 换成 `#000`、`#000` 换成 `#fff` 就收工了。结果就是晚上看着比白天还累。

## 不要用纯黑，也不要用纯白

纯黑（`#000000`）背景配纯白（`#ffffff`）文字的对比度是 21:1，远超 WCAG AAA 的要求——但**过高的对比度会产生光晕效应**（halation），文字边缘在视觉上晕开，长时间阅读非常疲劳。

这个站点用的是：

```css
/* 背景略带蓝调的深灰，而不是纯黑 */
--bg: #0d1017;
/* 正文用浅灰而非纯白 */
--text: #b0b8c9;
```

对比度落在 12:1 左右，足够清晰，又不会刺眼。

## 用亮度而不是阴影表达层级

浅色模式里，我们靠**阴影**把卡片从背景中「抬起来」。但在深色背景上，阴影几乎不可见——影子本来就是黑的。

深色模式里正确的做法是反过来：**越靠近用户的层级越亮**。

```css
.card {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

一层半透明白色叠加，就能自然地产生"浮起来"的感觉，而且嵌套时会自动累加。

## 饱和色需要降下来

同一个品牌蓝，在白底上看着刚好，在黑底上会显得荧光、发飘。原因是深色背景下人眼对饱和度更敏感。

处理方式有两种：

1. 深色模式下换用**更浅、更低饱和**的色阶（比如从 `brand-600` 换到 `brand-300`）
2. 降低强调色的使用面积，只用在真正需要注意力的地方

| 用途 | 浅色模式 | 深色模式 |
| --- | --- | --- |
| 正文链接 | `brand-600` | `brand-300` |
| 主按钮背景 | 渐变 500→700 | 保持不变（白字够清楚） |
| 边框 | `ink-200` | `rgba(255,255,255,.1)` |

## 避免切换时闪白

最常见的翻车现场：刷新页面时先闪一下白色，然后才变黑。原因是主题状态由 JS 决定，而 JS 在 CSS 之后才执行。

解决办法是在 `<head>` 里放一段**阻塞式**的内联脚本，在页面渲染前就把 class 打上：

```html
<script>
  (function () {
    var stored = localStorage.getItem('theme')
    var dark = stored
      ? stored === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches
    if (dark) document.documentElement.classList.add('dark')
  })()
</script>
```

这段代码很小，阻塞的时间可以忽略，但能彻底消除闪烁。

## 顺带一提：View Transition

Chrome 系浏览器支持 `document.startViewTransition()`，可以让明暗切换变成一次平滑的交叉淡入：

```ts
const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
if (doc.startViewTransition) {
  doc.startViewTransition(() => setTheme(next))
} else {
  setTheme(next)
}
```

不支持的浏览器会直接走 `else` 分支，是一个零成本的渐进增强。记得同时检查 `prefers-reduced-motion`，尊重那些对动效敏感的用户。

> 深色模式不是「把颜色取反」，而是**在低光环境下重新设计一遍视觉层级**。

